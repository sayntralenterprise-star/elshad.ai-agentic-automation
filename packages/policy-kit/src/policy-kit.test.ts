import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  type OrgId,
  type PrincipalId,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import {
  BUILTIN_POLICY_TEMPLATES,
  DefaultV1PolicyEvaluator,
  compileDeclarativePolicyToRego,
  enforcePolicyDecision,
  simulatePolicyAgainstRuns,
  type DeclarativePolicy,
  type HistoricalRunSnapshotForPolicySim,
} from './index.js';

const ctx: TenantContext = {
  orgId: '01930000-0000-7000-8000-000000000001' as OrgId,
  workspaceId: '01930000-0000-7000-8000-000000000002' as WorkspaceId,
  principal: {
    id: '01930000-0000-7000-8000-000000000003' as PrincipalId,
    type: 'user',
  },
  requestId: 'req_test_1',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
};

describe('@elshad/policy-kit DefaultV1PolicyEvaluator [E0.3-1, D15]', () => {
  const evaluator = new DefaultV1PolicyEvaluator();

  it('allows read tools at L0..L3 and enforces autonomy approval rules for side effects', async () => {
    const readL0 = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 0,
      sideEffectClass: 'read',
      toolName: 'current_time',
    });
    expect(readL0.effect).toBe('allow');

    const writeL1 = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 1,
      sideEffectClass: 'write',
      toolName: 'http_request',
    });
    expect(writeL1.effect).toBe('require_approval');
    expect(writeL1.reasonCode).toBe('POL_APPROVAL_REQUIRED');

    const writeL2 = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 2,
      sideEffectClass: 'write',
      toolName: 'http_request',
      approvalMode: 'auto',
    });
    expect(writeL2.effect).toBe('allow');

    const destructiveL2 = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 2,
      sideEffectClass: 'destructive',
      toolName: 'db_drop',
      approvalMode: 'auto',
    });
    expect(destructiveL2.effect).toBe('require_approval');
  });

  it('rejects L4 autonomy unless workspace policy flag explicitly enables it [DOC-Q-016]', async () => {
    const denied = await evaluator.evaluate({
      ctx,
      action: 'agent.publish',
      autonomyLevel: 4,
    });
    expect(denied.effect).toBe('deny');
    expect(() => enforcePolicyDecision(denied)).toThrow(PlatformError);

    const allowed = await evaluator.evaluate({
      ctx,
      action: 'agent.publish',
      autonomyLevel: 4,
      policyFlags: { allowL4Autonomy: true },
    });
    expect(allowed.effect).toBe('allow');
  });

  it('denies external_comms when untrusted content is in context [E0.3-6]', async () => {
    const decision = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 3,
      sideEffectClass: 'external_comms',
      toolName: 'http_request',
      untrustedContentInContext: true,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reasonCode).toBe('POL_UNTRUSTED_CONTEXT');
  });

  it('enforces allowed_domains, allowed_methods, and max_calls_per_run scope narrowing [FR-TL-3]', async () => {
    const badDomain = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 2,
      sideEffectClass: 'read',
      toolName: 'web_fetch',
      targetUrl: 'https://evil.example.net/secret',
      grantScope: { allowed_domains: ['docs.example.com', '*.trusted.org'] },
    });
    expect(badDomain.effect).toBe('deny');
    expect(badDomain.reasonCode).toBe('POL_DENIED');

    const goodWildcard = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 2,
      sideEffectClass: 'read',
      toolName: 'web_fetch',
      targetUrl: 'https://api.trusted.org/v1/items',
      httpMethod: 'GET',
      grantScope: {
        allowed_domains: ['docs.example.com', '*.trusted.org'],
        allowed_methods: ['GET'],
        max_calls_per_run: 5,
      },
      toolCallCountInRun: 2,
    });
    expect(goodWildcard.effect).toBe('allow');

    const capped = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      autonomyLevel: 2,
      sideEffectClass: 'read',
      toolName: 'web_fetch',
      grantScope: { max_calls_per_run: 2 },
      toolCallCountInRun: 2,
    });
    expect(capped.effect).toBe('deny');
  });

  it('compiles declarative policies to Rego, enforces high-risk L2 cap, distinguishes audit_only vs enforce, and simulates 10,000 runs < 5s [FR-GOV-4..11]', async () => {
    expect(BUILTIN_POLICY_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    const tpl = BUILTIN_POLICY_TEMPLATES.find(
      (t) => t.slug === 'tpl-no-destructive-prod-without-approval',
    );
    expect(tpl).toBeDefined();
    expect(tpl!.regoSource).toContain('package elshad.governance.tpl_no_destructive_prod_without_approval');

    const rego = compileDeclarativePolicyToRego({
      slug: 'block-prod-delete',
      point: 'tool_call',
      effect: 'deny',
      condition: {
        environments: ['prod'],
        toolNames: ['db_drop'],
        riskTiers: ['high'],
      },
    });
    expect(rego).toContain('import rego.v1');
    expect(rego).toContain('input.environment in ["prod"]');

    const auditOnlyPolicy: DeclarativePolicy = {
      id: 'pol_1',
      orgId: ctx.orgId,
      slug: 'shadow-pii-watch',
      name: 'Shadow PII Watch',
      point: 'tool_call',
      mode: 'audit_only',
      version: 1,
      effect: 'deny',
      condition: {
        environments: ['prod'],
        dataClassifications: ['pii'],
      },
      regoSource: compileDeclarativePolicyToRego({
        slug: 'shadow-pii-watch',
        point: 'tool_call',
        effect: 'deny',
        condition: { environments: ['prod'], dataClassifications: ['pii'] },
      }),
      createdBy: ctx.principal.id,
    };

    const enforcePolicy: DeclarativePolicy = {
      ...auditOnlyPolicy,
      id: 'pol_2',
      slug: 'enforce-prod-spend-gate',
      name: 'Enforce Prod Spend Gate',
      mode: 'enforce',
      effect: 'require_approval',
      condition: {
        environments: ['prod'],
        maxSpendMicroUsd: 500_000,
      },
    };

    // audit_only does not block execution, only flags auditOnlyMatchedPolicyIds
    const auditOnlyRes = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      point: 'tool_call',
      environment: 'prod',
      autonomyLevel: 2,
      sideEffectClass: 'read',
      toolName: 'crm_lookup',
      dataClassifications: ['pii'],
      cumulativeSpendMicroUsd: 100_000,
      customPolicies: [auditOnlyPolicy, enforcePolicy],
    });
    expect(auditOnlyRes.effect).toBe('allow');
    expect(auditOnlyRes.auditOnlyMatchedPolicyIds).toEqual(['shadow-pii-watch']);

    // Enforce mode blocks / requires approval when spend exceeds threshold
    const enforcedRes = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      point: 'tool_call',
      environment: 'prod',
      autonomyLevel: 2,
      sideEffectClass: 'read',
      toolName: 'crm_lookup',
      dataClassifications: ['pii'],
      cumulativeSpendMicroUsd: 750_000,
      customPolicies: [auditOnlyPolicy, enforcePolicy],
    });
    expect(enforcedRes.effect).toBe('require_approval');
    expect(enforcedRes.matchedPolicyIds).toContain('enforce-prod-spend-gate');
    expect(enforcedRes.auditOnlyMatchedPolicyIds).toEqual(['shadow-pii-watch']);

    // High-risk tier enforces L2 cap (FR-GOV-11)
    const highRiskL3 = await evaluator.evaluate({
      ctx,
      action: 'tool.invoke',
      environment: 'staging',
      autonomyLevel: 3,
      sideEffectClass: 'read',
      riskTier: 'high',
    });
    expect(highRiskL3.effect).toBe('deny');
    expect(highRiskL3.reasonCode).toBe('POL_DENIED');

    // Simulate across 10,000 runs (FR-GOV-7)
    const history: HistoricalRunSnapshotForPolicySim[] = Array.from({ length: 10_000 }, (_, i) => ({
      runId: `run_${i + 1}`,
      point: 'tool_call',
      environment: i % 10 === 0 ? 'prod' : 'dev',
      autonomyLevel: 2,
      sideEffectClass: i % 20 === 0 ? 'destructive' : 'read',
      toolName: i % 20 === 0 ? 'db_drop' : 'http_get',
      cumulativeSpendMicroUsd: i * 1000,
    }));

    const simReport = simulatePolicyAgainstRuns(
      {
        id: 'pol_sim_1',
        slug: 'sim-destructive-prod',
        point: 'tool_call',
        effect: 'deny',
        condition: { environments: ['prod'], sideEffectClasses: ['destructive'] },
      },
      history,
    );
    expect(simReport.totalRunsEvaluated).toBe(10_000);
    expect(simReport.matchedCount).toBe(500);
    expect(simReport.blockedCount).toBe(500);
    expect(simReport.approvalRequiredCount).toBe(0);
    expect(simReport.sampleAffectedRunIds.length).toBeLessThanOrEqual(25);
    expect(simReport.durationMs).toBeLessThan(5000);
  });
});
