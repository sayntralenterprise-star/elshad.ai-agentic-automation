import { createHash } from 'node:crypto';
import { PlatformError, type TenantContext } from '@elshad/domain';

// ============================================================================
// Multi-agent Types & Contracts (E1.4, FR-RT-20..24, §5.1, M.1)
// ============================================================================

export type TeamPattern =
  | 'supervisor_specialists'
  | 'sequential_pipeline'
  | 'parallel_fanout_aggregate'
  | 'critic_pair'
  | 'router';

export type TeamMemberRole = 'supervisor' | 'specialist' | 'critic' | 'worker' | 'router';

export type AgentMessagePurpose =
  | 'delegation_request'
  | 'delegation_response'
  | 'blackboard_update'
  | 'critic_feedback'
  | 'error_rejection';

export interface TeamMemberConfig {
  id: string;
  teamId: string;
  agentId: string;
  role: TeamMemberRole;
  readKeys: string[];
  writeKeys: string[];
  maxSteps: number;
  timeoutSeconds: number;
  maxSpendMicroUsd: number;
}

export interface TeamHandoffContract {
  id: string;
  teamId: string;
  fromAgentId: string;
  toAgentId: string;
  name: string;
  description?: string;
  handoffSchema: Record<string, unknown>;
  returnSchema: Record<string, unknown>;
}

export interface TeamDefinition {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  pattern: TeamPattern;
  supervisorAgentId?: string | null;
  members: TeamMemberConfig[];
  handoffs: TeamHandoffContract[];
  config?: Record<string, unknown>;
}

export interface HandoffArtifact {
  id: string;
  name: string;
  type: string;
  uri?: string;
  data?: unknown;
}

/**
 * Typed Handoff Object per PRD FR-RT-21 (line 265):
 * { goal, context_summary, artifacts[], constraints, return_schema }
 */
export interface TypedHandoffPayload {
  goal: string;
  context_summary: string;
  artifacts: HandoffArtifact[];
  constraints: Record<string, unknown>;
  return_schema: Record<string, unknown>;
}

export interface BlackboardUpdate {
  key: string;
  value: unknown;
  agentId: string;
  timestamp: string;
  operation: 'set' | 'delete' | 'append';
}

export interface BlackboardState {
  runId: string;
  version: number;
  data: Record<string, unknown>;
  history: BlackboardUpdate[];
}

export interface AgentMessage {
  id: string;
  runId: string;
  senderAgentId: string;
  receiverAgentId: string;
  purpose: AgentMessagePurpose;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface MultiAgentRunLimits {
  maxDepth: number; // default 3 per FR-RT-23
  maxFanout: number; // default 8 per FR-RT-23
  maxTotalSpendMicroUsd?: number;
}

export interface ChildRunAttribution {
  childRunId: string;
  parentRunId: string;
  agentId: string;
  role: string;
  status: 'completed' | 'failed';
  tokensIn: number;
  tokensOut: number;
  costMicroUsd: number;
  durationMs: number;
}

export interface MultiAgentExecutionResult {
  rootRunId: string;
  finalOutput: Record<string, unknown>;
  blackboard: BlackboardState;
  messages: AgentMessage[];
  childRuns: ChildRunAttribution[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostMicroUsd: number;
  durationMs: number;
}

// ============================================================================
// Run-Scoped Shared Blackboard Manager (FR-RT-22)
// ============================================================================

export class BlackboardManager {
  private runId: string;
  private version: number;
  private state: Map<string, unknown>;
  private history: BlackboardUpdate[];

  constructor(runId: string, initialData: Record<string, unknown> = {}) {
    this.runId = runId;
    this.version = 1;
    this.state = new Map(Object.entries(initialData));
    this.history = [];
  }

  /**
   * Get all data readable by the agent based on readKeys scope.
   * If readKeys is empty, agent cannot read any custom keys (or if wildcard '*' is present, reads all).
   */
  getState(agentId?: string, readKeys?: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const allowAll = !readKeys || readKeys.includes('*');

    for (const [k, v] of this.state.entries()) {
      if (allowAll || (readKeys && readKeys.includes(k))) {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Get a specific key from blackboard, enforcing read scope.
   */
  get(key: string, agentId?: string, readKeys?: string[]): unknown {
    if (readKeys && !readKeys.includes('*') && !readKeys.includes(key)) {
      throw new PlatformError(
        'MEM_SCOPE_DENIED',
        `Agent ${agentId ?? 'anonymous'} does not have read access to blackboard key "${key}". Allowed read keys: [${readKeys.join(', ')}]`,
      );
    }
    return this.state.get(key);
  }

  /**
   * Set key-value pair in blackboard, enforcing write scope and optimistic locking (CAS).
   */
  set(
    key: string,
    value: unknown,
    agentId: string,
    writeKeys?: string[],
    expectedVersion?: number,
  ): { success: boolean; version: number } {
    if (writeKeys && !writeKeys.includes('*') && !writeKeys.includes(key)) {
      throw new PlatformError(
        'MEM_SCOPE_DENIED',
        `Agent ${agentId} is not permitted to write to blackboard key "${key}". Allowed write keys: [${writeKeys.join(', ')}]`,
      );
    }

    if (expectedVersion !== undefined && expectedVersion !== this.version) {
      throw new PlatformError(
        'RES_CONFLICT',
        `Blackboard optimistic concurrency conflict: expected version ${expectedVersion}, current version ${this.version}`,
      );
    }

    this.state.set(key, value);
    this.version += 1;

    this.history.push({
      key,
      value,
      agentId,
      timestamp: new Date().toISOString(),
      operation: 'set',
    });

    return { success: true, version: this.version };
  }

  /**
   * Delete key from blackboard.
   */
  delete(key: string, agentId: string, writeKeys?: string[]): boolean {
    if (writeKeys && !writeKeys.includes('*') && !writeKeys.includes(key)) {
      throw new PlatformError(
        'MEM_SCOPE_DENIED',
        `Agent ${agentId} is not permitted to delete blackboard key "${key}".`,
      );
    }

    const existed = this.state.delete(key);
    if (existed) {
      this.version += 1;
      this.history.push({
        key,
        value: null,
        agentId,
        timestamp: new Date().toISOString(),
        operation: 'delete',
      });
    }
    return existed;
  }

  /**
   * Snapshot current blackboard state.
   */
  snapshot(): BlackboardState {
    const data: Record<string, unknown> = {};
    for (const [k, v] of this.state.entries()) {
      data[k] = v;
    }
    return {
      runId: this.runId,
      version: this.version,
      data,
      history: [...this.history],
    };
  }
}

// ============================================================================
// Typed Handoff Validator (FR-RT-21)
// ============================================================================

export class TypedHandoffValidator {
  /**
   * Enforces typed handoff structure:
   * { goal, context_summary, artifacts[], constraints, return_schema }
   */
  static validate(payload: unknown): TypedHandoffPayload {
    if (!payload || typeof payload !== 'object') {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Handoff payload must be a non-null object.');
    }

    const p = payload as Record<string, unknown>;

    if (typeof p['goal'] !== 'string' || p['goal'].trim().length === 0) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Typed handoff requires a non-empty string "goal". Free-text-only handoffs are forbidden (FR-RT-21).');
    }

    if (typeof p['context_summary'] !== 'string') {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Typed handoff requires a "context_summary" string.');
    }

    if (!Array.isArray(p['artifacts'])) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Typed handoff requires an "artifacts" array.');
    }

    for (const art of p['artifacts']) {
      if (!art || typeof art !== 'object' || typeof art.name !== 'string' || typeof art.type !== 'string') {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Each handoff artifact must specify "name" and "type".');
      }
    }

    if (!p['constraints'] || typeof p['constraints'] !== 'object') {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Typed handoff requires a "constraints" object.');
    }

    if (!p['return_schema'] || typeof p['return_schema'] !== 'object') {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Typed handoff requires a "return_schema" object.');
    }

    return {
      goal: p['goal'],
      context_summary: p['context_summary'],
      artifacts: p['artifacts'] as HandoffArtifact[],
      constraints: p['constraints'] as Record<string, unknown>,
      return_schema: p['return_schema'] as Record<string, unknown>,
    };
  }
}

// ============================================================================
// Delegation Engine & Guardrails (FR-RT-20, FR-RT-23, FR-RT-24)
// ============================================================================

export class DelegationEngine {
  private maxDepth: number;
  private maxFanout: number;
  private messages: AgentMessage[];
  private fanoutCounts: Map<string, number>; // senderId -> number of delegations

  constructor(limits?: Partial<MultiAgentRunLimits>) {
    this.maxDepth = limits?.maxDepth ?? 3; // Default depth 3 (FR-RT-23)
    this.maxFanout = limits?.maxFanout ?? 8; // Default fanout 8 (FR-RT-23)
    this.messages = [];
    this.fanoutCounts = new Map();
  }

  /**
   * Validate delegation constraints (depth and fan-out) per FR-RT-23.
   */
  validateDelegation(fromAgentId: string, toAgentId: string, currentDepth: number): void {
    if (currentDepth >= this.maxDepth) {
      throw new PlatformError(
        'RUN_DEPTH_EXCEEDED',
        `Delegation depth limit exceeded: current depth ${currentDepth} reaches or exceeds max allowable depth ${this.maxDepth} (FR-RT-23).`,
      );
    }

    const currentFanout = (this.fanoutCounts.get(fromAgentId) ?? 0) + 1;
    if (currentFanout > this.maxFanout) {
      throw new PlatformError(
        'VAL_LIMIT_EXCEEDS_CEILING',
        `Delegation fan-out limit exceeded: agent ${fromAgentId} attempted ${currentFanout} delegations, exceeding max fan-out limit of ${this.maxFanout} (FR-RT-23).`,
      );
    }

    this.fanoutCounts.set(fromAgentId, currentFanout);
  }

  /**
   * Records every inter-agent message in the run trace (FR-RT-24).
   */
  recordMessage(
    runId: string,
    senderAgentId: string,
    receiverAgentId: string,
    purpose: AgentMessagePurpose,
    payload: Record<string, unknown>,
  ): AgentMessage {
    const msg: AgentMessage = {
      id: `msg_${createHash('sha256').update(`${runId}:${Date.now()}:${this.messages.length}`).digest('hex').slice(0, 16)}`,
      runId,
      senderAgentId,
      receiverAgentId,
      purpose,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);
    return msg;
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }
}

// ============================================================================
// Multi-Agent Coordinator (Supervisor + Specialists Benchmark Runner)
// ============================================================================

export interface SpecialistRunner {
  (
    agentId: string,
    handoff: TypedHandoffPayload,
    blackboard: BlackboardManager,
    memberConfig: TeamMemberConfig,
    tenantContext: TenantContext,
  ): Promise<{
    output: Record<string, unknown>;
    tokensIn: number;
    tokensOut: number;
    costMicroUsd: number;
    durationMs: number;
  }>;
}

export class MultiAgentCoordinator {
  private team: TeamDefinition;
  private delegationEngine: DelegationEngine;
  private blackboard: BlackboardManager;
  private memberMap: Map<string, TeamMemberConfig>;

  constructor(
    team: TeamDefinition,
    rootRunId: string,
    initialBlackboard: Record<string, unknown> = {},
    limits?: Partial<MultiAgentRunLimits>,
  ) {
    this.team = team;
    this.delegationEngine = new DelegationEngine(limits);
    this.blackboard = new BlackboardManager(rootRunId, initialBlackboard);
    this.memberMap = new Map(team.members.map((m) => [m.agentId, m]));
  }

  getBlackboard(): BlackboardManager {
    return this.blackboard;
  }

  getDelegationEngine(): DelegationEngine {
    return this.delegationEngine;
  }

  /**
   * Execute supervisor delegating to specialists with typed handoffs,
   * run-scoped blackboard mutations, and cost/token roll-up to the root run.
   */
  async executeSupervisorWorkflow(
    rootRunId: string,
    tenantContext: TenantContext,
    supervisorInput: Record<string, unknown>,
    specialistRunner: SpecialistRunner,
  ): Promise<MultiAgentExecutionResult> {
    const startTime = Date.now();
    const supervisorId = this.team.supervisorAgentId ?? 'supervisor';
    const childRuns: ChildRunAttribution[] = [];

    let totalTokensIn = 150; // initial supervisor orchestration tokens
    let totalTokensOut = 80;
    let totalCostMicroUsd = 1500; // supervisor orchestration base cost

    // Initial message to supervisor
    this.delegationEngine.recordMessage(
      rootRunId,
      'system',
      supervisorId,
      'delegation_request',
      { input: supervisorInput },
    );

    // Write initial input to blackboard under permitted keys
    for (const [k, v] of Object.entries(supervisorInput)) {
      this.blackboard.set(k, v, supervisorId, ['*']);
    }

    // Determine specialist tasks from team members
    const specialists = this.team.members.filter((m) => m.role === 'specialist');

    for (const spec of specialists) {
      // 1. Enforce depth & fanout guardrails (FR-RT-23)
      this.delegationEngine.validateDelegation(supervisorId, spec.agentId, 1);

      // 2. Prepare Typed Handoff Payload (FR-RT-21)
      const rawPayload = {
        goal: `Execute specialist workflow for ${spec.agentId}`,
        context_summary: `Supervisor delegating sub-task for ${spec.agentId} based on initial query`,
        artifacts: [
          {
            id: `art_${spec.agentId}`,
            name: `${spec.agentId}_context`,
            type: 'structured_context',
            data: this.blackboard.getState(spec.agentId, spec.readKeys),
          },
        ],
        constraints: {
          max_steps: spec.maxSteps,
          timeout_seconds: spec.timeoutSeconds,
          max_spend_micro_usd: spec.maxSpendMicroUsd,
        },
        return_schema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            result: { type: 'object' },
          },
        },
      };

      const validatedHandoff = TypedHandoffValidator.validate(rawPayload);

      // 3. Record delegation request message (FR-RT-24)
      this.delegationEngine.recordMessage(
        rootRunId,
        supervisorId,
        spec.agentId,
        'delegation_request',
        { handoff: validatedHandoff },
      );

      // 4. Invoke specialist in child run (FR-RT-20)
      const childRunId = `run_child_${createHash('sha256').update(`${rootRunId}:${spec.agentId}`).digest('hex').slice(0, 12)}`;

      const childOutcome = await specialistRunner(
        spec.agentId,
        validatedHandoff,
        this.blackboard,
        spec,
        tenantContext,
      );

      // 5. Roll up cost and tokens into parent usage ledger (FR-RT-20)
      totalTokensIn += childOutcome.tokensIn;
      totalTokensOut += childOutcome.tokensOut;
      totalCostMicroUsd += childOutcome.costMicroUsd;

      childRuns.push({
        childRunId,
        parentRunId: rootRunId,
        agentId: spec.agentId,
        role: spec.role,
        status: 'completed',
        tokensIn: childOutcome.tokensIn,
        tokensOut: childOutcome.tokensOut,
        costMicroUsd: childOutcome.costMicroUsd,
        durationMs: childOutcome.durationMs,
      });

      // 6. Record delegation response message (FR-RT-24)
      this.delegationEngine.recordMessage(
        rootRunId,
        spec.agentId,
        supervisorId,
        'delegation_response',
        { output: childOutcome.output },
      );
    }

    const durationMs = Date.now() - startTime;
    const finalBlackboardState = this.blackboard.snapshot();

    const finalOutput = {
      status: 'success',
      supervisor: supervisorId,
      summary: `Completed multi-agent collaboration across ${specialists.length} specialists with full cost roll-up`,
      blackboardState: finalBlackboardState.data,
      totalChildRuns: childRuns.length,
    };

    return {
      rootRunId,
      finalOutput,
      blackboard: finalBlackboardState,
      messages: this.delegationEngine.getMessages(),
      childRuns,
      totalTokensIn,
      totalTokensOut,
      totalCostMicroUsd,
      durationMs,
    };
  }
}
