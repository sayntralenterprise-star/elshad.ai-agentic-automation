import { PlatformError, type ErrorCode, type TenantContext } from '@elshad/domain';
import { withSpan } from '@elshad/telemetry';

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type SideEffectClass = 'read' | 'write' | 'destructive' | 'external_comms';
export type ApprovalMode = 'never' | 'auto' | 'always';
export type PolicyEffect = 'allow' | 'deny' | 'require_approval';

export interface ToolGrantScope {
  readonly allowed_domains?: readonly string[];
  readonly allowed_methods?: readonly string[];
  readonly max_calls_per_run?: number;
}

export interface PolicyEvalInput {
  readonly ctx: TenantContext;
  readonly action: 'tool.invoke' | 'agent.publish' | 'model.call';
  readonly autonomyLevel: AutonomyLevel;
  readonly sideEffectClass?: SideEffectClass;
  readonly toolName?: string;
  readonly approvalMode?: ApprovalMode;
  readonly untrustedContentInContext?: boolean;
  readonly targetUrl?: string;
  readonly httpMethod?: string;
  readonly grantScope?: ToolGrantScope;
  readonly toolCallCountInRun?: number;
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
    const extraPolicyIds = input.policyFlags?.policyIds ?? [];

    // DOC-Q-016: L4 autonomy is rejected unless workspace policy explicitly enables it.
    if (input.autonomyLevel === 4 && !input.policyFlags?.allowL4Autonomy) {
      return {
        effect: 'deny',
        reasonCode: 'POL_DENIED',
        reason: 'Autonomy level L4 is disabled unless workspace policy explicitly permits it.',
        matchedPolicyIds: ['pol-v1-l4-guard', ...extraPolicyIds],
      };
    }

    if (input.action === 'tool.invoke') {
      const sideEffect = input.sideEffectClass ?? 'read';

      // PRD FR-TL-5 / E0.3-6: Untrusted content in context blocks external communications
      // and destructive actions automatically.
      if (
        input.untrustedContentInContext &&
        (sideEffect === 'external_comms' || sideEffect === 'destructive')
      ) {
        return {
          effect: 'deny',
          reasonCode: 'POL_UNTRUSTED_CONTEXT',
          reason: `Untrusted content in run context blocks automatic ${sideEffect} tool invocation (${input.toolName ?? 'unknown'}).`,
          matchedPolicyIds: ['pol-v1-untrusted-egress-guard', ...extraPolicyIds],
        };
      }

      // Narrowed grant scope: allowed_domains
      if (input.targetUrl && input.grantScope?.allowed_domains?.length) {
        let hostname = '';
        try {
          hostname = new URL(input.targetUrl).hostname;
        } catch {
          return {
            effect: 'deny',
            reasonCode: 'POL_DENIED',
            reason: `Invalid target URL for domain policy check: ${input.targetUrl}`,
            matchedPolicyIds: ['pol-v1-scope-domain', ...extraPolicyIds],
          };
        }
        const allowed = input.grantScope.allowed_domains.some((p) =>
          matchesDomainPattern(hostname, p),
        );
        if (!allowed) {
          return {
            effect: 'deny',
            reasonCode: 'POL_DENIED',
            reason: `Target domain "${hostname}" is outside the tool grant allowed_domains scope.`,
            matchedPolicyIds: ['pol-v1-scope-domain', ...extraPolicyIds],
          };
        }
      }

      // Narrowed grant scope: allowed_methods
      if (input.httpMethod && input.grantScope?.allowed_methods?.length) {
        const method = input.httpMethod.toUpperCase();
        const allowedMethods = input.grantScope.allowed_methods.map((m) => m.toUpperCase());
        if (!allowedMethods.includes(method)) {
          return {
            effect: 'deny',
            reasonCode: 'POL_DENIED',
            reason: `HTTP method "${method}" is outside the tool grant allowed_methods scope.`,
            matchedPolicyIds: ['pol-v1-scope-method', ...extraPolicyIds],
          };
        }
      }

      // Narrowed grant scope: max_calls_per_run
      if (
        input.grantScope?.max_calls_per_run !== undefined &&
        input.toolCallCountInRun !== undefined &&
        input.toolCallCountInRun >= input.grantScope.max_calls_per_run
      ) {
        return {
          effect: 'deny',
          reasonCode: 'POL_DENIED',
          reason: `Tool "${input.toolName ?? 'unknown'}" exceeded grant max_calls_per_run (${input.grantScope.max_calls_per_run}).`,
          matchedPolicyIds: ['pol-v1-scope-call-cap', ...extraPolicyIds],
        };
      }

      if (input.approvalMode === 'always') {
        return {
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: `Tool "${input.toolName ?? 'unknown'}" requires explicit human approval.`,
          matchedPolicyIds: ['pol-v1-explicit-approval', ...extraPolicyIds],
        };
      }

      // FR-RT-7 Autonomy matrix L0..L3
      if (input.autonomyLevel <= 1 && sideEffect !== 'read') {
        return {
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: `Autonomy level L${input.autonomyLevel} requires approval before ${sideEffect} tool invocation.`,
          matchedPolicyIds: ['pol-v1-autonomy-matrix', ...extraPolicyIds],
        };
      }

      if (input.autonomyLevel === 2 && sideEffect === 'destructive') {
        return {
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: 'Autonomy level L2 requires approval for destructive tool actions.',
          matchedPolicyIds: ['pol-v1-autonomy-matrix', ...extraPolicyIds],
        };
      }

      if (
        input.autonomyLevel === 3 &&
        sideEffect === 'destructive' &&
        input.approvalMode !== 'never'
      ) {
        return {
          effect: 'require_approval',
          reasonCode: 'POL_APPROVAL_REQUIRED',
          reason: 'Destructive tool invocation requires approval unless explicitly configured never.',
          matchedPolicyIds: ['pol-v1-destructive-guard', ...extraPolicyIds],
        };
      }
    }

    return {
      effect: 'allow',
      reasonCode: 'POL_ALLOWED',
      reason: 'Allowed by default v1 policy.',
      matchedPolicyIds: ['pol-v1-default-allow', ...extraPolicyIds],
    };
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
