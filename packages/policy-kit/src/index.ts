import { PlatformError, type ErrorCode, type TenantContext } from '@elshad/domain';
import { withSpan } from '@elshad/telemetry';

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type SideEffectClass = 'read' | 'write' | 'destructive' | 'external_comms';
export type ApprovalMode = 'never' | 'auto' | 'always';
export type PolicyEffect = 'allow' | 'deny' | 'require_approval';
export type PolicyPoint =
  | 'tool_call'
  | 'data_access'
  | 'memory_read'
  | 'memory_write'
  | 'model_select'
  | 'egress'
  | 'promotion'
  | 'publish';
export type PolicyRolloutMode = 'audit_only' | 'enforce';
export type RiskTier = 'low' | 'medium' | 'high';

export interface DeclarativePolicyCondition {
  readonly points?: readonly PolicyPoint[];
  readonly sideEffectClasses?: readonly SideEffectClass[];
  readonly environments?: readonly ('dev' | 'staging' | 'prod')[];
  readonly toolNames?: readonly string[];
  /** Triggers when evaluated autonomyLevel exceeds maxAutonomyLevel. */
  readonly maxAutonomyLevel?: AutonomyLevel;
  readonly untrustedContentInContext?: boolean;
  readonly dataClassifications?: readonly string[];
  /** Triggers when cumulativeSpendMicroUsd exceeds maxSpendMicroUsd. */
  readonly maxSpendMicroUsd?: number;
  readonly riskTiers?: readonly RiskTier[];
}

export interface DeclarativePolicy {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId?: string | null;
  readonly slug: string;
  readonly name: string;
  readonly description?: string | null;
  readonly point: PolicyPoint;
  readonly mode: PolicyRolloutMode;
  readonly version: number;
  readonly effect: PolicyEffect;
  readonly condition: DeclarativePolicyCondition;
  readonly regoSource: string;
  readonly createdBy: string;
  readonly approvedBy?: string | null;
}

export interface ToolGrantScope {
  readonly allowed_domains?: readonly string[];
  readonly allowed_methods?: readonly string[];
  readonly max_calls_per_run?: number;
}

export interface PolicyEvalInput {
  readonly ctx: TenantContext;
  readonly action: 'tool.invoke' | 'agent.publish' | 'model.call';
  readonly point?: PolicyPoint;
  readonly environment?: 'dev' | 'staging' | 'prod';
  readonly autonomyLevel: AutonomyLevel;
  readonly sideEffectClass?: SideEffectClass;
  readonly toolName?: string;
  readonly approvalMode?: ApprovalMode;
  readonly untrustedContentInContext?: boolean;
  readonly dataClassifications?: readonly string[];
  readonly cumulativeSpendMicroUsd?: number;
  readonly riskTier?: RiskTier;
  readonly targetUrl?: string;
  readonly httpMethod?: string;
  readonly grantScope?: ToolGrantScope;
  readonly toolCallCountInRun?: number;
  readonly customPolicies?: readonly DeclarativePolicy[];
  readonly policyFlags?: {
    readonly allowL4Autonomy?: boolean;
    readonly policyIds?: readonly string[];
  };
}

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reasonCode: ErrorCode | 'POL_ALLOWED';
  readonly reason: string;
  readonly matchedPolicyIds: readonly string[];
  readonly auditOnlyMatchedPolicyIds?: readonly string[];
}

/**
 * PolicyEvaluator abstraction extracted from day 1 (PRD D15, E0.3-1).
 * Later slices swap in Rego/OPA or DB-backed policy engines without touching runtime callers.
 */
export interface PolicyEvaluator {
  evaluate(input: PolicyEvalInput): Promise<PolicyDecision>;
}

function matchesDomainPattern(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const norm = pattern.trim().toLowerCase();
  if (norm === '*') return true;
  if (norm.startsWith('*.')) {
    const suffix = norm.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  if (norm.startsWith('.')) {
    const suffix = norm.slice(1);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === norm;
}

export class DefaultV1PolicyEvaluator implements PolicyEvaluator {
  async evaluate(input: PolicyEvalInput): Promise<PolicyDecision> {
    return withSpan(
      'policy.evaluate',
      {
        'elshad.org_id': input.ctx.orgId,
        'elshad.workspace_id': input.ctx.workspaceId ?? undefined,
        'policy.action': input.action,
        'policy.autonomy_level': input.autonomyLevel,
        'policy.tool_name': input.toolName,
      },
      async () => this.evaluateSync(input),
    );
  }

  private evaluateSync(input: PolicyEvalInput): PolicyDecision {
    const extraPolicyIds = [...(input.policyFlags?.policyIds ?? [])];
    const point = derivePolicyPoint(input);

    const auditOnlyMatched: string[] = [];
    const matchedEnforceDeny: DeclarativePolicy[] = [];
    const matchedEnforceApproval: DeclarativePolicy[] = [];

    for (const pol of input.customPolicies ?? []) {
      const matched = matchesDeclarativePolicy(pol.point, pol.condition, {
        point,
        sideEffectClass: input.sideEffectClass,
        environment: input.environment,
        toolName: input.toolName,
        autonomyLevel: input.autonomyLevel,
        untrustedContentInContext: input.untrustedContentInContext,
        dataClassifications: input.dataClassifications,
        cumulativeSpendMicroUsd: input.cumulativeSpendMicroUsd,
        riskTier: input.riskTier,
      });
      if (!matched) continue;
      if (pol.mode === 'audit_only') {
        auditOnlyMatched.push(pol.slug);
      } else if (pol.effect === 'deny') {
        matchedEnforceDeny.push(pol);
      } else if (pol.effect === 'require_approval') {
        matchedEnforceApproval.push(pol);
      } else {
        extraPolicyIds.push(pol.slug);
      }
    }

    const withAuditOnly = (decision: PolicyDecision): PolicyDecision =>
      auditOnlyMatched.length > 0
        ? { ...decision, auditOnlyMatchedPolicyIds: auditOnlyMatched }
        : decision;

    // DOC-Q-016: L4 autonomy is rejected unless workspace policy explicitly enables it.
    if (input.autonomyLevel === 4 && !input.policyFlags?.allowL4Autonomy) {
      return withAuditOnly({
        effect: 'deny',
        reasonCode: 'POL_DENIED',
        reason: 'Autonomy level L4 is disabled unless workspace policy explicitly permits it.',
        matchedPolicyIds: ['pol-v1-l4-guard', ...extraPolicyIds],
      });
    }

    // FR-GOV-11: High-risk agents require autonomy L2 or lower.
    if (input.riskTier === 'high' && input.autonomyLevel > 2) {
      return withAuditOnly({
        effect: 'deny',
        reasonCode: 'POL_DENIED',
        reason: 'High-risk tier agents require autonomy level L2 or lower (FR-GOV-11).',
        matchedPolicyIds: ['pol-v1-high-risk-tier-cap', ...extraPolicyIds],
      });
    }

    if (input.action === 'tool.invoke') {
      const sideEffect = input.sideEffectClass ?? 'read';

      // PRD FR-TL-5 / E0.3-6: Untrusted content in context blocks external communications
      // and destructive actions automatically.
      if (
        input.untrustedContentInContext &&
        (sideEffect === 'external_comms' || sideEffect === 'destructive')
      ) {
        return withAuditOnly({
          effect: 'deny',
          reasonCode: 'POL_UNTRUSTED_CONTEXT',
          reason: `Untrusted content in run context blocks automatic ${sideEffect} tool invocation (${input.toolName ?? 'unknown'}).`,
          matchedPolicyIds: ['pol-v1-untrusted-egress-guard', ...extraPolicyIds],
        });
      }

      // Narrowed grant scope: allowed_domains
      if (input.targetUrl && input.grantScope?.allowed_domains?.length) {
        let hostname = '';
        try {
          hostname = new URL(input.targetUrl).hostname;
        } catch {
          return withAuditOnly({
            effect: 'deny',
            reasonCode: 'POL_DENIED',
            reason: `Invalid target URL for domain policy check: ${input.targetUrl}`,
            matchedPolicyIds: ['pol-v1-scope-domain', ...extraPolicyIds],
          });
        }
        const allowed = input.grantScope.allowed_domains.some((p) =>
          matchesDomainPattern(hostname, p),
        );
        if (!allowed) {
          return withAuditOnly({
            effect: 'deny',
            reasonCode: 'POL_DENIED',
            reason: `Target domain "${hostname}" is outside the tool grant allowed_domains scope.`,
            matchedPolicyIds: ['pol-v1-scope-domain', ...extraPolicyIds],
          });
        }
      }

      // Narrowed grant scope: allowed_methods
      if (input.httpMethod && input.grantScope?.allowed_methods?.length) {
        const method = input.httpMethod.toUpperCase();
        const allowedMethods = input.grantScope.allowed_methods.map((m) => m.toUpperCase());
        if (!allowedMethods.includes(method)) {
          return withAuditOnly({
            effect: 'deny',
            reasonCode: 'POL_DENIED',
            reason: `HTTP method "${method}" is outside the tool grant allowed_methods scope.`,
            matchedPolicyIds: ['pol-v1-scope-method', ...extraPolicyIds],
          });
        }
      }

      // Narrowed grant scope: max_calls_per_run
      if (
        input.grantScope?.max_calls_per_run !== undefined &&
        input.toolCallCountInRun !== undefined &&
        input.toolCallCountInRun >= input.grantScope.max_calls_per_run
      ) {
        return withAuditOnly({
          effect: 'deny',
          reasonCode: 'POL_DENIED',
          reason: `Tool "${input.toolName ?? 'unknown'}" exceeded grant max_calls_per_run (${input.grantScope.max_calls_per_run}).`,
          matchedPolicyIds: ['pol-v1-scope-call-cap', ...extraPolicyIds],
        });
      }
    }

    if (matchedEnforceDeny.length > 0) {
      return withAuditOnly({
        effect: 'deny',
        reasonCode: 'POL_DENIED',
        reason: `Denied by enforced policy "${matchedEnforceDeny[0]!.name}" (${matchedEnforceDeny[0]!.slug}).`,
        matchedPolicyIds: [...matchedEnforceDeny.map((p) => p.slug), ...extraPolicyIds],
      });
    }

    if (matchedEnforceApproval.length > 0) {
      return withAuditOnly({
        effect: 'require_approval',
        reasonCode: 'POL_APPROVAL_REQUIRED',
        reason: `Approval required by enforced policy "${matchedEnforceApproval[0]!.name}" (${matchedEnforceApproval[0]!.slug}).`,
        matchedPolicyIds: [...matchedEnforceApproval.map((p) => p.slug), ...extraPolicyIds],
      });
    }

    if (input.action === 'tool.invoke') {
      const sideEffect = input.sideEffectClass ?? 'read';

      if (input.approvalMode === 'always') {
        return withAuditOnly({
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: `Tool "${input.toolName ?? 'unknown'}" requires explicit human approval.`,
          matchedPolicyIds: ['pol-v1-explicit-approval', ...extraPolicyIds],
        });
      }

      // FR-RT-7 Autonomy matrix L0..L3
      if (input.autonomyLevel <= 1 && sideEffect !== 'read') {
        return withAuditOnly({
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: `Autonomy level L${input.autonomyLevel} requires approval before ${sideEffect} tool invocation.`,
          matchedPolicyIds: ['pol-v1-autonomy-matrix', ...extraPolicyIds],
        });
      }

      if (input.autonomyLevel === 2 && sideEffect === 'destructive') {
        return withAuditOnly({
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: 'Autonomy level L2 requires approval for destructive tool actions.',
          matchedPolicyIds: ['pol-v1-autonomy-matrix', ...extraPolicyIds],
        });
      }

      if (
        input.autonomyLevel === 3 &&
        sideEffect === 'destructive' &&
        input.approvalMode !== 'never'
      ) {
        return withAuditOnly({
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: 'Destructive tool invocation requires approval unless explicitly configured never.',
          matchedPolicyIds: ['pol-v1-destructive-guard', ...extraPolicyIds],
        });
      }
    }

    return withAuditOnly({
      effect: 'allow',
      reasonCode: 'POL_ALLOWED',
      reason: 'Allowed by default v1 policy.',
      matchedPolicyIds: ['pol-v1-default-allow', ...extraPolicyIds],
    });
  }
}

export function enforcePolicyDecision(decision: PolicyDecision): void {
  if (decision.effect === 'allow') return;
  const code: ErrorCode =
    decision.reasonCode === 'POL_ALLOWED'
      ? decision.effect === 'require_approval'
        ? 'POL_APPROVAL_REQUIRED'
        : 'POL_DENIED'
      : decision.reasonCode;
  throw new PlatformError(code, decision.reason, {
    effect: decision.effect,
    matched_policy_ids: [...decision.matchedPolicyIds],
  });
}

function derivePolicyPoint(input: PolicyEvalInput): PolicyPoint {
  if (input.point) return input.point;
  if (input.action === 'agent.publish') return 'publish';
  if (input.action === 'model.call') return 'model_select';
  return 'tool_call';
}

export interface PolicyEvaluationSnapshot {
  readonly point: PolicyPoint;
  readonly sideEffectClass?: SideEffectClass;
  readonly environment?: 'dev' | 'staging' | 'prod';
  readonly toolName?: string;
  readonly autonomyLevel: AutonomyLevel;
  readonly untrustedContentInContext?: boolean;
  readonly dataClassifications?: readonly string[];
  readonly cumulativeSpendMicroUsd?: number;
  readonly riskTier?: RiskTier;
}

export function matchesDeclarativePolicy(
  policyPoint: PolicyPoint,
  condition: DeclarativePolicyCondition,
  snapshot: PolicyEvaluationSnapshot,
): boolean {
  if (condition.points && condition.points.length > 0) {
    if (!condition.points.includes(snapshot.point)) return false;
  } else if (snapshot.point !== policyPoint) {
    return false;
  }

  if (condition.sideEffectClasses && condition.sideEffectClasses.length > 0) {
    if (!snapshot.sideEffectClass || !condition.sideEffectClasses.includes(snapshot.sideEffectClass)) {
      return false;
    }
  }
  if (condition.environments && condition.environments.length > 0) {
    if (!snapshot.environment || !condition.environments.includes(snapshot.environment)) {
      return false;
    }
  }
  if (condition.toolNames && condition.toolNames.length > 0) {
    if (!snapshot.toolName || !condition.toolNames.includes(snapshot.toolName)) {
      return false;
    }
  }
  if (condition.maxAutonomyLevel !== undefined) {
    if (snapshot.autonomyLevel <= condition.maxAutonomyLevel) return false;
  }
  if (condition.maxSpendMicroUsd !== undefined) {
    if ((snapshot.cumulativeSpendMicroUsd ?? 0) <= condition.maxSpendMicroUsd) return false;
  }
  if (condition.untrustedContentInContext !== undefined) {
    if (Boolean(snapshot.untrustedContentInContext) !== condition.untrustedContentInContext) {
      return false;
    }
  }
  if (condition.dataClassifications && condition.dataClassifications.length > 0) {
    if (
      !snapshot.dataClassifications ||
      !snapshot.dataClassifications.some((cls) => condition.dataClassifications!.includes(cls))
    ) {
      return false;
    }
  }
  if (condition.riskTiers && condition.riskTiers.length > 0) {
    if (!snapshot.riskTier || !condition.riskTiers.includes(snapshot.riskTier)) {
      return false;
    }
  }
  return true;
}

/**
 * Compiles a structured declarative policy definition into OPA/Rego source (FR-GOV-4, FR-GOV-8, D7).
 */
export function compileDeclarativePolicyToRego(input: {
  slug: string;
  point: PolicyPoint;
  effect: PolicyEffect;
  condition: DeclarativePolicyCondition;
}): string {
  const pkgSlug = input.slug.replace(/[^a-zA-Z0-9_]/g, '_');
  const clauses: string[] = [];
  if (input.condition.points?.length) {
    clauses.push(`  input.point in ${JSON.stringify(input.condition.points)}`);
  } else {
    clauses.push(`  input.point == ${JSON.stringify(input.point)}`);
  }
  if (input.condition.environments?.length) {
    clauses.push(`  input.environment in ${JSON.stringify(input.condition.environments)}`);
  }
  if (input.condition.sideEffectClasses?.length) {
    clauses.push(
      `  input.side_effect_class in ${JSON.stringify(input.condition.sideEffectClasses)}`,
    );
  }
  if (input.condition.toolNames?.length) {
    clauses.push(`  input.tool_name in ${JSON.stringify(input.condition.toolNames)}`);
  }
  if (input.condition.maxAutonomyLevel !== undefined) {
    clauses.push(`  input.autonomy_level > ${input.condition.maxAutonomyLevel}`);
  }
  if (input.condition.maxSpendMicroUsd !== undefined) {
    clauses.push(`  input.cumulative_spend_micro_usd > ${input.condition.maxSpendMicroUsd}`);
  }
  if (input.condition.untrustedContentInContext !== undefined) {
    clauses.push(
      `  input.untrusted_content_in_context == ${String(input.condition.untrustedContentInContext)}`,
    );
  }
  if (input.condition.dataClassifications?.length) {
    clauses.push(
      `  some cls in input.data_classifications; cls in ${JSON.stringify(input.condition.dataClassifications)}`,
    );
  }
  if (input.condition.riskTiers?.length) {
    clauses.push(`  input.risk_tier in ${JSON.stringify(input.condition.riskTiers)}`);
  }

  return [
    `package elshad.governance.${pkgSlug}`,
    `import rego.v1`,
    ``,
    `default effect := "allow"`,
    ``,
    `effect := ${JSON.stringify(input.effect)} if {`,
    ...clauses,
    `}`,
  ].join('\n');
}

export interface PolicyTemplateSpec {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly point: PolicyPoint;
  readonly effect: PolicyEffect;
  readonly condition: DeclarativePolicyCondition;
  readonly regoSource: string;
}

const RAW_POLICY_TEMPLATES: Array<Omit<PolicyTemplateSpec, 'regoSource'>> = [
  {
    slug: 'tpl-no-destructive-prod-without-approval',
    name: 'No destructive actions in prod without approval',
    description: 'Requires human approval before any destructive tool invocation in production.',
    point: 'tool_call',
    effect: 'require_approval',
    condition: {
      environments: ['prod'],
      sideEffectClasses: ['destructive'],
    },
  },
  {
    slug: 'tpl-external-comms-prod-approval',
    name: 'External communications require approval in prod',
    description: 'Gates outbound Slack, email, and webhook side effects in prod.',
    point: 'tool_call',
    effect: 'require_approval',
    condition: {
      environments: ['prod'],
      sideEffectClasses: ['external_comms'],
    },
  },
  {
    slug: 'tpl-pii-data-access-approval',
    name: 'PII handling approval gate',
    description: 'Requires approval before tools touching PII run in staging or prod.',
    point: 'tool_call',
    effect: 'require_approval',
    condition: {
      environments: ['staging', 'prod'],
      dataClassifications: ['pii'],
    },
  },
  {
    slug: 'tpl-financial-spend-threshold',
    name: 'Financial threshold gate ($10 USD)',
    description: 'Requires approval once cumulative spend exceeds 10,000,000 micro-USD in prod.',
    point: 'tool_call',
    effect: 'require_approval',
    condition: {
      environments: ['prod'],
      maxSpendMicroUsd: 10_000_000,
    },
  },
  {
    slug: 'tpl-high-risk-autonomy-cap',
    name: 'High-risk tier L2 autonomy cap',
    description: 'Denies tool calls above autonomy L2 for high-risk agents (FR-GOV-11).',
    point: 'tool_call',
    effect: 'deny',
    condition: {
      riskTiers: ['high'],
      maxAutonomyLevel: 2,
    },
  },
];

export const BUILTIN_POLICY_TEMPLATES: readonly PolicyTemplateSpec[] = RAW_POLICY_TEMPLATES.map(
  (tpl) => ({
    ...tpl,
    regoSource: compileDeclarativePolicyToRego(tpl),
  }),
);

export interface HistoricalRunSnapshotForPolicySim {
  readonly runId: string;
  readonly point?: PolicyPoint;
  readonly environment?: 'dev' | 'staging' | 'prod';
  readonly autonomyLevel: AutonomyLevel;
  readonly sideEffectClass?: SideEffectClass;
  readonly toolName?: string;
  readonly untrustedContentInContext?: boolean;
  readonly dataClassifications?: readonly string[];
  readonly cumulativeSpendMicroUsd?: number;
  readonly riskTier?: RiskTier;
}

export interface PolicySimulationReport {
  readonly policyId: string;
  readonly policySlug: string;
  readonly totalRunsEvaluated: number;
  readonly matchedCount: number;
  readonly blockedCount: number;
  readonly approvalRequiredCount: number;
  readonly sampleAffectedRunIds: readonly string[];
  readonly durationMs: number;
}

/**
 * Simulates a proposed declarative policy across historical run snapshots (FR-GOV-7, §5.7 < 60s for 10k runs).
 */
export function simulatePolicyAgainstRuns(
  policy: Pick<DeclarativePolicy, 'id' | 'slug' | 'point' | 'effect' | 'condition'>,
  runs: readonly HistoricalRunSnapshotForPolicySim[],
): PolicySimulationReport {
  const startedMs = Date.now();
  let matchedCount = 0;
  let blockedCount = 0;
  let approvalRequiredCount = 0;
  const sampleAffectedRunIds: string[] = [];

  for (let i = 0; i < runs.length; i += 1) {
    const r = runs[i]!;
    const matched = matchesDeclarativePolicy(policy.point, policy.condition, {
      point: r.point ?? policy.point,
      environment: r.environment,
      autonomyLevel: r.autonomyLevel,
      sideEffectClass: r.sideEffectClass,
      toolName: r.toolName,
      untrustedContentInContext: r.untrustedContentInContext,
      dataClassifications: r.dataClassifications,
      cumulativeSpendMicroUsd: r.cumulativeSpendMicroUsd,
      riskTier: r.riskTier,
    });
    if (!matched) continue;

    matchedCount += 1;
    if (policy.effect === 'deny') {
      blockedCount += 1;
    } else if (policy.effect === 'require_approval') {
      approvalRequiredCount += 1;
    }
    if (policy.effect !== 'allow' && sampleAffectedRunIds.length < 25) {
      sampleAffectedRunIds.push(r.runId);
    }
  }

  return {
    policyId: policy.id,
    policySlug: policy.slug,
    totalRunsEvaluated: runs.length,
    matchedCount,
    blockedCount,
    approvalRequiredCount,
    sampleAffectedRunIds,
    durationMs: Date.now() - startedMs,
  };
}
