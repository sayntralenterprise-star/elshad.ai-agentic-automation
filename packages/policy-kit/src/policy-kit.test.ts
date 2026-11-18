import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  type OrgId,
  type PrincipalId,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import { DefaultV1PolicyEvaluator, enforcePolicyDecision } from './index.js';

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
});
