import { createHash } from 'node:crypto';
import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  TERMINAL_RUN_STATUSES,
  assertRunTransition,
  assertWorkItemTransition,
  type Clock,
  type FailureClass,
  type IdGen,
  type RunStatus,
  type TenantContext,
  type WorkItemStatus,
} from '@elshad/domain';
import type { CloudEvent, EventBus } from '@elshad/platform-kit';

export type TerminationReason = 'final_answer' | 'limit_reached' | 'escalated' | 'error' | 'cancelled';

export interface RunUsage {
  steps: number;
  tokens_in: number;
  tokens_out: number;
  tool_calls: number;
}

export interface RunLimits {
  max_steps: number;
  max_tokens: number;
  max_wall_time_ms: number;
  max_cost_micro_usd: number;
}

export interface RunRecord {
  id: string;
  org_id: string;
  workspace_id: string;
  environment_id: string;
  root_run_id: string;
  parent_run_id: string | null;
  subject_type: string;
  subject_version_id: string;
  status: RunStatus;
  failure_class: FailureClass | null;
  termination_reason: TerminationReason | null;
  initiator_id: string;
  on_behalf_of_id: string | null;
  trigger: Record<string, unknown>;
  input: unknown;
  output: unknown;
  limits: RunLimits;
  usage: RunUsage;
  cost_micro_usd: number;
  wait: WaitCondition | null;
  flags: Record<string, boolean>;
  labels: Record<string, string>;
  last_event_seq: number;
  engine_version: string;
  attempt_group: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface RunStepRecord {
  id: string;
  run_id: string;
  org_id: string;
  seq: number;
  type: 'llm_call' | 'tool_call' | 'decision' | 'handoff' | 'approval' | 'memory_op' | 'node';
  agent_id: string | null;
  status: 'succeeded' | 'failed';
  attempt: number;
  idempotency_key: string;
  summary: Record<string, unknown>;
  input: unknown;
  output: unknown;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_micro_usd: number;
  latency_ms: number;
  error: Record<string, unknown> | null;
  started_at: string;
  ended_at: string;
  created_at: string;
}

export interface RunEventRecord {
  run_id: string;
  seq: number;
  org_id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface CheckpointState {
  seq: number;
  cursor: number;
  scratchpad: Record<string, unknown>;
  messages: unknown[];
  blackboard: Record<string, unknown>;
  engine_version: string;
}

export interface CheckpointRecord {
  run_id: string;
  seq: number;
  org_id: string;
  state: CheckpointState;
  state_ref: string;
  size_bytes: number;
  milestone: boolean;
  created_at: string;
}

export interface WorkItemRecord {
  id: string;
  org_id: string;
  workspace_id: string;
  queue: string;
  priority: number;
  run_id: string;
  kind: 'execute_run' | 'resume_run';
  payload: Record<string, unknown>;
  serialize_key: string | null;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempts: number;
  max_attempts: number;
  status: WorkItemStatus;
  last_error: Record<string, unknown> | null;
  created_at: string;
}

export interface TimerRecord {
  id: string;
  org_id: string;
  run_id: string;
  kind: string;
  fire_at: string;
  payload: Record<string, unknown>;
  fired_at: string | null;
}

export interface OutboxRecord {
  id: string;
  org_id: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  traceparent: string | null;
  created_at: string;
  published_at: string | null;
  attempts: number;
}

export interface EffectLedgerRecord {
  org_id: string;
  idempotency_key: string;
  run_id: string;
  step_seq: number;
  attempt_group: number;
  status: 'succeeded' | 'failed';
  result: unknown;
  expires_at: string;
  created_at: string;
}

export interface Lease {
  workItemId: string;
  runId: string;
  orgId: string;
  workspaceId: string;
  workerId: string;
  attempt: number;
  leaseExpiresAt: string;
  payload: Record<string, unknown>;
}

export interface CreateRunRequest {
  workspaceId: string;
  environmentId: string;
  subjectType: string;
  subjectVersionId: string;
  parentRunId?: string | null;
  rootRunId?: string;
  trigger?: Record<string, unknown>;
  input?: unknown;
  limits?: Partial<RunLimits>;
  labels?: Record<string, string>;
  queue?: string;
  priority?: number;
  serializeKey?: string | null;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}

export interface WaitCondition {
  kind: 'approval' | 'input' | 'timer' | 'child';
  ref?: string;
  fireAt?: string;
  reason?: string;
}

export interface TurnStepInput {
  seq: number;
  type: RunStepRecord['type'];
  agentId?: string | null;
  status?: 'succeeded' | 'failed';
  attempt?: number;
  summary?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costMicroUsd?: number;
  latencyMs?: number;
  error?: Record<string, unknown> | null;
}

export interface TurnCommit {
  steps: TurnStepInput[];
  checkpoint: CheckpointState;
  milestone?: boolean;
}

export interface RunOutcome {
  status: 'succeeded' | 'timed_out' | 'budget_exceeded' | 'policy_blocked';
  terminationReason: TerminationReason;
  output?: unknown;
}

export interface RunSignal {
  kind: 'approval' | 'input' | 'timer' | 'child';
  reason: string;
  payload?: Record<string, unknown>;
}

export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  randomFn?: () => number;
}

const DEFAULT_LIMITS: RunLimits = {
  max_steps: 25,
  max_tokens: 200_000,
  max_wall_time_ms: 900_000,
  max_cost_micro_usd: 2_000_000,
};

const EFFECT_LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_DURATION_MS = 60_000;
const MAX_NON_MILESTONE_CHECKPOINTS = 5;

/**
 * Computes idempotency key per PRD N.2.8 & DOC-Q-005:
 * sha256(run_id + ":" + step_seq + ":" + attempt_group)
 */
export function computeEffectIdempotencyKey(
  runId: string,
  stepSeq: number,
  attemptGroup = 1,
): string {
  return createHash('sha256').update(`${runId}:${stepSeq}:${attemptGroup}`, 'utf8').digest('hex');
}

/**
 * Exponential backoff with jitter per PRD N.2.7:
 * delay = min(cap, base * 2^(attempt-1)) * (0.5 + random()/2)
 */
export function computeBackoffDelayMs(attempt: number, opts: BackoffOptions = {}): number {
  const baseMs = opts.baseMs ?? 1_000;
  const capMs = opts.capMs ?? 60_000;
  const rand = opts.randomFn ?? Math.random;
  const raw = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(raw * (0.5 + rand() / 2));
}

export interface EffectLedger {
  lookup(orgId: string, idempotencyKey: string): Promise<EffectLedgerRecord | null>;
  executeOnce<T>(
    orgId: string,
    meta: { runId: string; stepSeq: number; attemptGroup?: number },
    effectFn: () => Promise<T>,
  ): Promise<{ deduplicated: boolean; idempotencyKey: string; result: T }>;
}

export class InMemoryEffectLedger implements EffectLedger {
  private readonly entries = new Map<string, EffectLedgerRecord>();

  constructor(private readonly clock: Clock = new SystemClock()) {}

  async lookup(orgId: string, idempotencyKey: string): Promise<EffectLedgerRecord | null> {
    const rec = this.entries.get(idempotencyKey);
    if (!rec || rec.org_id !== orgId) return null;
    if (this.clock.now().getTime() >= Date.parse(rec.expires_at)) {
      this.entries.delete(idempotencyKey);
      return null;
    }
    return rec;
  }

  async executeOnce<T>(
    orgId: string,
    meta: { runId: string; stepSeq: number; attemptGroup?: number },
    effectFn: () => Promise<T>,
  ): Promise<{ deduplicated: boolean; idempotencyKey: string; result: T }> {
    const attemptGroup = meta.attemptGroup ?? 1;
    const key = computeEffectIdempotencyKey(meta.runId, meta.stepSeq, attemptGroup);
    const existing = await this.lookup(orgId, key);
    if (existing) {
      return { deduplicated: true, idempotencyKey: key, result: existing.result as T };
    }

    const result = await effectFn();
    const nowMs = this.clock.now().getTime();
    this.entries.set(key, {
      org_id: orgId,
      idempotency_key: key,
      run_id: meta.runId,
      step_seq: meta.stepSeq,
      attempt_group: attemptGroup,
      status: 'succeeded',
      result,
      expires_at: new Date(nowMs + EFFECT_LEDGER_TTL_MS).toISOString(),
      created_at: new Date(nowMs).toISOString(),
    });
    return { deduplicated: false, idempotency_key: key, idempotencyKey: key, result } as {
      deduplicated: boolean;
      idempotencyKey: string;
      result: T;
    };
  }
}

export interface ExecutionEngine {
  createRun(ctx: TenantContext, req: CreateRunRequest): Promise<RunRecord>;
  claim(workerId: string, queues: string[], max: number): Promise<Lease[]>;
  heartbeat(lease: Lease): Promise<boolean>;
  loadState(lease: Lease): Promise<CheckpointState | null>;
  commitTurn(lease: Lease, turn: TurnCommit): Promise<void>;
  suspend(lease: Lease, wait: WaitCondition): Promise<void>;
  signal(ctx: TenantContext, runId: string, sig: RunSignal): Promise<RunRecord>;
  complete(lease: Lease, outcome: RunOutcome): Promise<RunRecord>;
  retryOrFail(lease: Lease, err: PlatformError): Promise<{ retried: boolean; nextAvailableAt?: string }>;
  cancel(ctx: TenantContext, runId: string, reason: string): Promise<RunRecord>;
  redrive(ctx: TenantContext, runIds: string[], inputPatch?: unknown): Promise<RunRecord[]>;
  getRun(orgId: string, runId: string): Promise<RunRecord | null>;
  listRuns(orgId: string, filter?: { workspaceId?: string; status?: RunStatus }): Promise<RunRecord[]>;
  listSteps(orgId: string, runId: string): Promise<RunStepRecord[]>;
  listEvents(orgId: string, runId: string, afterSeq?: number): Promise<RunEventRecord[]>;
  listCheckpoints(orgId: string, runId: string): Promise<CheckpointRecord[]>;
  listDlq(orgId: string, workspaceId?: string): Promise<WorkItemRecord[]>;
  requeueExpiredLeases(now?: Date): Promise<number>;
  fireDueTimers(now?: Date, batch?: number): Promise<number>;
  drainOutbox(batch: number, bus: EventBus): Promise<number>;
}

export interface InMemoryExecutionEngineOptions {
  clock?: Clock;
  idGen?: IdGen;
  leaseDurationMs?: number;
  backoff?: BackoffOptions;
}

export class InMemoryExecutionEngine implements ExecutionEngine {
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  private readonly leaseDurationMs: number;
  private readonly backoff: BackoffOptions;

  readonly runs = new Map<string, RunRecord>();
  readonly steps = new Map<string, RunStepRecord[]>();
  readonly events = new Map<string, RunEventRecord[]>();
  readonly checkpoints = new Map<string, CheckpointRecord[]>();
  readonly workItems = new Map<string, WorkItemRecord>();
  readonly timers = new Map<string, TimerRecord>();
  readonly outbox: OutboxRecord[] = [];

  private readonly workspaceWeights = new Map<string, number>();
  private readonly workspaceVirtualTime = new Map<string, number>();

  constructor(opts: InMemoryExecutionEngineOptions = {}) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
    this.leaseDurationMs = opts.leaseDurationMs ?? LEASE_DURATION_MS;
    this.backoff = opts.backoff ?? {};
  }

  setWorkspaceWeight(workspaceId: string, weight: number): void {
    this.workspaceWeights.set(workspaceId, Math.max(0.1, weight));
  }

  private appendRunEvent(
    run: RunRecord,
    type: string,
    data: Record<string, unknown>,
    traceparent: string | null = null,
  ): RunEventRecord {
    const nowIso = this.clock.now().toISOString();
    run.last_event_seq += 1;
    const evt: RunEventRecord = {
      run_id: run.id,
      seq: run.last_event_seq,
      org_id: run.org_id,
      type,
      data,
      created_at: nowIso,
    };
    const list = this.events.get(run.id) ?? [];
    list.push(evt);
    this.events.set(run.id, list);

    this.outbox.push({
      id: this.idGen.uuidv7(this.clock.now().getTime()),
      org_id: run.org_id,
      type,
      subject: run.id,
      payload: { run_id: run.id, seq: evt.seq, ...data },
      traceparent,
      created_at: nowIso,
      published_at: null,
      attempts: 0,
    });
    return evt;
  }

  private assertActiveLease(lease: Lease): { item: WorkItemRecord; run: RunRecord } {
    const item = this.workItems.get(lease.workItemId);
    if (!item || item.org_id !== lease.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Work item ${lease.workItemId} not found`);
    }
    if (item.status !== 'leased' || item.lease_owner !== lease.workerId) {
      throw new PlatformError('RES_CONFLICT', 'Worker no longer owns lease for work item', {
        work_item_id: lease.workItemId,
      });
    }
    const nowMs = this.clock.now().getTime();
    if (item.lease_expires_at && nowMs > Date.parse(item.lease_expires_at)) {
      throw new PlatformError('RES_CONFLICT', 'Worker lease expired', {
        work_item_id: lease.workItemId,
      });
    }
    const run = this.runs.get(lease.runId);
    if (!run || run.org_id !== lease.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${lease.runId} not found`);
    }
    return { item, run };
  }

  async createRun(ctx: TenantContext, req: CreateRunRequest): Promise<RunRecord> {
    const nowMs = this.clock.now().getTime();
    const nowIso = new Date(nowMs).toISOString();
    const runId = this.idGen.uuidv7(nowMs);
    const rootRunId = req.rootRunId ?? runId;

    const run: RunRecord = {
      id: runId,
      org_id: ctx.orgId,
      workspace_id: req.workspaceId,
      environment_id: req.environmentId,
      root_run_id: rootRunId,
      parent_run_id: req.parentRunId ?? null,
      subject_type: req.subjectType,
      subject_version_id: req.subjectVersionId,
      status: 'queued',
      failure_class: null,
      termination_reason: null,
      initiator_id: ctx.principal.id,
      on_behalf_of_id: ctx.onBehalfOf?.id ?? null,
      trigger: req.trigger ?? { type: 'api' },
      input: req.input ?? {},
      output: null,
      limits: { ...DEFAULT_LIMITS, ...req.limits },
      usage: { steps: 0, tokens_in: 0, tokens_out: 0, tool_calls: 0 },
      cost_micro_usd: 0,
      wait: null,
      flags: {},
      labels: req.labels ?? {},
      last_event_seq: 0,
      engine_version: '1.0.0',
      attempt_group: 1,
      created_at: nowIso,
      started_at: null,
      ended_at: null,
    };

    this.runs.set(runId, run);
    this.steps.set(runId, []);
    this.events.set(runId, []);
    this.checkpoints.set(runId, []);

    this.appendRunEvent(run, 'run.created', {
      subject: { type: run.subject_type, version_id: run.subject_version_id },
      environment_id: run.environment_id,
      trigger: run.trigger,
      initiator: ctx.principal.id,
      labels: run.labels,
    });

    const workItem: WorkItemRecord = {
      id: this.idGen.uuidv7(nowMs),
      org_id: ctx.orgId,
      workspace_id: req.workspaceId,
      queue: req.queue ?? 'default',
      priority: req.priority ?? 5,
      run_id: runId,
      kind: 'execute_run',
      payload: req.payload ?? {},
      serialize_key: req.serializeKey ?? null,
      available_at: nowIso,
      lease_owner: null,
      lease_expires_at: null,
      attempts: 0,
      max_attempts: req.maxAttempts ?? 5,
      status: 'ready',
      last_error: null,
      created_at: nowIso,
    };
    this.workItems.set(workItem.id, workItem);

    return structuredClone(run);
  }

  async claim(workerId: string, queues: string[], max: number): Promise<Lease[]> {
    const nowMs = this.clock.now().getTime();
    const queueSet = new Set(queues);
    const leases: Lease[] = [];

    const activeSerializeKeys = new Set<string>();
    for (const wi of this.workItems.values()) {
      if (wi.status === 'leased' && wi.serialize_key !== null) {
        activeSerializeKeys.add(`${wi.workspace_id}:${wi.serialize_key}`);
      }
    }

    const candidates = [...this.workItems.values()].filter(
      (wi) =>
        wi.status === 'ready' &&
        queueSet.has(wi.queue) &&
        Date.parse(wi.available_at) <= nowMs &&
        (wi.serialize_key === null ||
          !activeSerializeKeys.has(`${wi.workspace_id}:${wi.serialize_key}`)),
    );

    // Weighted fair scheduling across workspaces, then priority DESC, available_at ASC
    candidates.sort((a, b) => {
      const vtA = this.workspaceVirtualTime.get(a.workspace_id) ?? 0;
      const vtB = this.workspaceVirtualTime.get(b.workspace_id) ?? 0;
      if (vtA !== vtB) return vtA - vtB;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return Date.parse(a.available_at) - Date.parse(b.available_at);
    });

    for (const item of candidates) {
      if (leases.length >= max) break;
      if (
        item.serialize_key !== null &&
        activeSerializeKeys.has(`${item.workspace_id}:${item.serialize_key}`)
      ) {
        continue;
      }

      const run = this.runs.get(item.run_id);
      if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
        item.status = 'done';
        continue;
      }

      assertWorkItemTransition(item.status, 'leased');
      if (run.status === 'queued') {
        assertRunTransition('queued', 'running');
        run.status = 'running';
        if (!run.started_at) {
          run.started_at = new Date(nowMs).toISOString();
        }
      }

      item.status = 'leased';
      item.lease_owner = workerId;
      item.lease_expires_at = new Date(nowMs + this.leaseDurationMs).toISOString();
      item.attempts += 1;

      if (item.serialize_key !== null) {
        activeSerializeKeys.add(`${item.workspace_id}:${item.serialize_key}`);
      }

      const weight = this.workspaceWeights.get(item.workspace_id) ?? 1;
      const currVt = this.workspaceVirtualTime.get(item.workspace_id) ?? 0;
      this.workspaceVirtualTime.set(item.workspace_id, currVt + 1 / weight);

      this.appendRunEvent(run, 'run.started', {
        worker_id: workerId,
        attempt: item.attempts,
      });

      leases.push({
        workItemId: item.id,
        runId: item.run_id,
        orgId: item.org_id,
        workspaceId: item.workspace_id,
        workerId,
        attempt: item.attempts,
        leaseExpiresAt: item.lease_expires_at,
        payload: structuredClone(item.payload),
      });
    }

    return leases;
  }

  async heartbeat(lease: Lease): Promise<boolean> {
    const item = this.workItems.get(lease.workItemId);
    const run = this.runs.get(lease.runId);
    if (!item || !run) return false;
    if (item.status !== 'leased' || item.lease_owner !== lease.workerId) return false;
    const nowMs = this.clock.now().getTime();
    if (item.lease_expires_at && nowMs > Date.parse(item.lease_expires_at)) return false;
    if (TERMINAL_RUN_STATUSES.has(run.status)) return false;

    const newExpiry = new Date(nowMs + this.leaseDurationMs).toISOString();
    item.lease_expires_at = newExpiry;
    lease.leaseExpiresAt = newExpiry;
    return true;
  }

  async loadState(lease: Lease): Promise<CheckpointState | null> {
    this.assertActiveLease(lease);
    const list = this.checkpoints.get(lease.runId) ?? [];
    const latest = list[list.length - 1];
    return latest ? structuredClone(latest.state) : null;
  }

  async commitTurn(lease: Lease, turn: TurnCommit): Promise<void> {
    const { run } = this.assertActiveLease(lease);
    const nowMs = this.clock.now().getTime();
    const nowIso = new Date(nowMs).toISOString();
    const runSteps = this.steps.get(run.id) ?? [];

    for (const s of turn.steps) {
      const stepId = this.idGen.uuidv7(nowMs);
      const idempKey = computeEffectIdempotencyKey(run.id, s.seq, run.attempt_group);
      const stepRec: RunStepRecord = {
        id: stepId,
        run_id: run.id,
        org_id: run.org_id,
        seq: s.seq,
        type: s.type,
        agent_id: s.agentId ?? null,
        status: s.status ?? 'succeeded',
        attempt: s.attempt ?? lease.attempt,
        idempotency_key: idempKey,
        summary: s.summary ?? {},
        input: s.input ?? null,
        output: s.output ?? null,
        model: s.model ?? null,
        tokens_in: s.tokensIn ?? 0,
        tokens_out: s.tokensOut ?? 0,
        cost_micro_usd: s.costMicroUsd ?? 0,
        latency_ms: s.latencyMs ?? 0,
        error: s.error ?? null,
        started_at: nowIso,
        ended_at: nowIso,
        created_at: nowIso,
      };
      runSteps.push(stepRec);

      run.usage.steps += 1;
      run.usage.tokens_in += stepRec.tokens_in;
      run.usage.tokens_out += stepRec.tokens_out;
      if (stepRec.type === 'tool_call') {
        run.usage.tool_calls += 1;
      }
      run.cost_micro_usd += stepRec.cost_micro_usd;

      this.appendRunEvent(run, 'run.step.started', {
        step_id: stepRec.id,
        seq: stepRec.seq,
        type: stepRec.type,
      });
      this.appendRunEvent(
        run,
        stepRec.status === 'failed' ? 'run.step.failed' : 'run.step.completed',
        {
          step_id: stepRec.id,
          seq: stepRec.seq,
          type: stepRec.type,
          summary: stepRec.summary,
          latency_ms: stepRec.latency_ms,
          cost_micro_usd: stepRec.cost_micro_usd,
        },
      );
    }
    this.steps.set(run.id, runSteps);

    const cpList = this.checkpoints.get(run.id) ?? [];
    const serialized = JSON.stringify(turn.checkpoint);
    const cp: CheckpointRecord = {
      run_id: run.id,
      seq: turn.checkpoint.seq,
      org_id: run.org_id,
      state: structuredClone(turn.checkpoint),
      state_ref: `checkpoint://${run.id}/${turn.checkpoint.seq}`,
      size_bytes: Buffer.byteLength(serialized, 'utf8'),
      milestone: turn.milestone ?? false,
      created_at: nowIso,
    };
    const filteredExisting = cpList.filter((existing) => existing.seq !== cp.seq);
    filteredExisting.push(cp);

    // Retention per D25: keep last 5 non-milestone checkpoints + all milestones
    const milestones = filteredExisting.filter((c) => c.milestone);
    const nonMilestones = filteredExisting
      .filter((c) => !c.milestone)
      .slice(-MAX_NON_MILESTONE_CHECKPOINTS);
    const retained = [...milestones, ...nonMilestones].sort((a, b) => a.seq - b.seq);
    this.checkpoints.set(run.id, retained);
  }

  async suspend(lease: Lease, wait: WaitCondition): Promise<void> {
    const { item, run } = this.assertActiveLease(lease);
    const targetStatus: RunStatus =
      wait.kind === 'approval'
        ? 'waiting_approval'
        : wait.kind === 'input'
          ? 'waiting_input'
          : wait.kind === 'timer'
            ? 'waiting_timer'
            : 'waiting_child';

    assertRunTransition(run.status, targetStatus);
    assertWorkItemTransition(item.status, 'done');

    run.status = targetStatus;
    run.wait = structuredClone(wait);
    item.status = 'done';
    item.lease_owner = null;
    item.lease_expires_at = null;

    if (wait.kind === 'timer' || wait.fireAt) {
      const fireAt = wait.fireAt ?? this.clock.now().toISOString();
      const timer: TimerRecord = {
        id: this.idGen.uuidv7(this.clock.now().getTime()),
        org_id: run.org_id,
        run_id: run.id,
        kind: wait.kind,
        fire_at: fireAt,
        payload: { reason: wait.reason ?? 'timer_wait' },
        fired_at: null,
      };
      this.timers.set(timer.id, timer);
    }

    this.appendRunEvent(run, 'run.waiting', { wait });
  }

  async signal(ctx: TenantContext, runId: string, sig: RunSignal): Promise<RunRecord> {
    const run = this.runs.get(runId);
    if (!run || run.org_id !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }

    assertRunTransition(run.status, 'queued');
    run.status = 'queued';
    run.wait = null;

    this.appendRunEvent(run, 'run.resumed', {
      kind: sig.kind,
      reason: sig.reason,
      payload: sig.payload ?? {},
    });

    const nowMs = this.clock.now().getTime();
    const nowIso = new Date(nowMs).toISOString();
    const prevItems = [...this.workItems.values()].filter((w) => w.run_id === run.id);
    const basePriority = prevItems[prevItems.length - 1]?.priority ?? 5;
    const baseQueue = prevItems[prevItems.length - 1]?.queue ?? 'default';

    const nextItem: WorkItemRecord = {
      id: this.idGen.uuidv7(nowMs),
      org_id: run.org_id,
      workspace_id: run.workspace_id,
      queue: baseQueue,
      priority: Math.min(10, basePriority + 1), // N.1: priority boost (+1)
      run_id: run.id,
      kind: 'resume_run',
      payload: { signal: sig },
      serialize_key: null,
      available_at: nowIso,
      lease_owner: null,
      lease_expires_at: null,
      attempts: 0,
      max_attempts: 5,
      status: 'ready',
      last_error: null,
      created_at: nowIso,
    };
    this.workItems.set(nextItem.id, nextItem);
    return structuredClone(run);
  }

  async complete(lease: Lease, outcome: RunOutcome): Promise<RunRecord> {
    const { item, run } = this.assertActiveLease(lease);
    assertRunTransition(run.status, outcome.status);
    assertWorkItemTransition(item.status, 'done');

    const nowIso = this.clock.now().toISOString();
    run.status = outcome.status;
    run.termination_reason = outcome.terminationReason;
    run.output = outcome.output ?? null;
    run.ended_at = nowIso;

    item.status = 'done';
    item.lease_owner = null;
    item.lease_expires_at = null;

    this.appendRunEvent(run, 'run.completed', {
      status: run.status,
      termination_reason: run.termination_reason,
      usage: run.usage,
      cost_micro_usd: run.cost_micro_usd,
    });

    return structuredClone(run);
  }

  async retryOrFail(
    lease: Lease,
    err: PlatformError,
  ): Promise<{ retried: boolean; nextAvailableAt?: string }> {
    const item = this.workItems.get(lease.workItemId);
    const run = this.runs.get(lease.runId);
    if (!item || !run || item.org_id !== lease.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run/work item not found for lease ${lease.workItemId}`);
    }

    const nowMs = this.clock.now().getTime();
    const errRecord = {
      code: err.code,
      message: err.message,
      failure_class: err.failureClass,
      retryable: err.retryable,
    };

    if (err.retryable && item.attempts < item.max_attempts) {
      assertWorkItemTransition(item.status, 'ready');
      const delayMs = computeBackoffDelayMs(item.attempts, this.backoff);
      const nextAvailableAt = new Date(nowMs + delayMs).toISOString();
      item.status = 'ready';
      item.available_at = nextAvailableAt;
      item.lease_owner = null;
      item.lease_expires_at = null;
      item.last_error = errRecord;
      return { retried: true, nextAvailableAt };
    }

    assertWorkItemTransition(item.status, 'dead');
    item.status = 'dead';
    item.lease_owner = null;
    item.lease_expires_at = null;
    item.last_error = errRecord;

    if (!TERMINAL_RUN_STATUSES.has(run.status)) {
      assertRunTransition(run.status, 'failed');
      run.status = 'failed';
      run.failure_class = err.failureClass;
      run.termination_reason = 'error';
      run.ended_at = new Date(nowMs).toISOString();
    }

    this.appendRunEvent(run, 'dlq.item.added', {
      work_item_id: item.id,
      failure_class: err.failureClass,
      error: errRecord,
    });
    this.appendRunEvent(run, 'run.completed', {
      status: run.status,
      termination_reason: run.termination_reason,
      failure_class: run.failure_class,
      usage: run.usage,
    });

    return { retried: false };
  }

  async cancel(ctx: TenantContext, runId: string, reason: string): Promise<RunRecord> {
    const run = this.runs.get(runId);
    if (!run || run.org_id !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }

    assertRunTransition(run.status, 'cancelled');
    const nowIso = this.clock.now().toISOString();
    run.status = 'cancelled';
    run.termination_reason = 'cancelled';
    run.ended_at = nowIso;
    run.wait = null;

    for (const wi of this.workItems.values()) {
      if (wi.run_id === run.id && (wi.status === 'ready' || wi.status === 'leased')) {
        wi.status = 'done';
        wi.lease_owner = null;
        wi.lease_expires_at = null;
      }
    }

    for (const tm of this.timers.values()) {
      if (tm.run_id === run.id && tm.fired_at === null) {
        tm.fired_at = nowIso;
      }
    }

    this.appendRunEvent(run, 'run.completed', {
      status: 'cancelled',
      termination_reason: 'cancelled',
      reason,
    });

    // Propagate cooperative cancellation to non-terminal child runs (FR-ORC-8)
    for (const candidate of this.runs.values()) {
      if (
        candidate.org_id === ctx.orgId &&
        candidate.parent_run_id === run.id &&
        !TERMINAL_RUN_STATUSES.has(candidate.status)
      ) {
        await this.cancel(ctx, candidate.id, `Parent run ${run.id} cancelled: ${reason}`);
      }
    }

    return structuredClone(run);
  }

  async redrive(ctx: TenantContext, runIds: string[], inputPatch?: unknown): Promise<RunRecord[]> {
    const nowMs = this.clock.now().getTime();
    const nowIso = new Date(nowMs).toISOString();
    const redriven: RunRecord[] = [];

    for (const runId of runIds) {
      const run = this.runs.get(runId);
      if (!run || run.org_id !== ctx.orgId) {
        throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
      }
      assertRunTransition(run.status, 'queued');

      run.status = 'queued';
      run.failure_class = null;
      run.termination_reason = null;
      run.ended_at = null;
      if (inputPatch !== undefined) {
        run.input = inputPatch;
        run.attempt_group += 1;
      }

      // Mark any dead work items for this run as done (superseded by redrive)
      for (const wi of this.workItems.values()) {
        if (wi.run_id === run.id && wi.status === 'dead') {
          wi.status = 'done';
        }
      }

      const workItem: WorkItemRecord = {
        id: this.idGen.uuidv7(nowMs),
        org_id: run.org_id,
        workspace_id: run.workspace_id,
        queue: 'default',
        priority: 6,
        run_id: run.id,
        kind: 'execute_run',
        payload: { redriven: true },
        serialize_key: null,
        available_at: nowIso,
        lease_owner: null,
        lease_expires_at: null,
        attempts: 0,
        max_attempts: 5,
        status: 'ready',
        last_error: null,
        created_at: nowIso,
      };
      this.workItems.set(workItem.id, workItem);
      this.appendRunEvent(run, 'run.resumed', { reason: 'dlq_redrive' });
      redriven.push(structuredClone(run));
    }

    return redriven;
  }

  async getRun(orgId: string, runId: string): Promise<RunRecord | null> {
    const run = this.runs.get(runId);
    if (!run || run.org_id !== orgId) return null;
    return structuredClone(run);
  }

  async listRuns(
    orgId: string,
    filter: { workspaceId?: string; status?: RunStatus } = {},
  ): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => {
        if (r.org_id !== orgId) return false;
        if (filter.workspaceId && r.workspace_id !== filter.workspaceId) return false;
        if (filter.status && r.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => structuredClone(r));
  }

  async listSteps(orgId: string, runId: string): Promise<RunStepRecord[]> {
    const run = this.runs.get(runId);
    if (!run || run.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }
    return structuredClone(this.steps.get(runId) ?? []);
  }

  async listEvents(orgId: string, runId: string, afterSeq = 0): Promise<RunEventRecord[]> {
    const run = this.runs.get(runId);
    if (!run || run.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }
    return (this.events.get(runId) ?? [])
      .filter((e) => e.seq > afterSeq)
      .map((e) => structuredClone(e));
  }

  async listCheckpoints(orgId: string, runId: string): Promise<CheckpointRecord[]> {
    const run = this.runs.get(runId);
    if (!run || run.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }
    return structuredClone(this.checkpoints.get(runId) ?? []);
  }

  async listDlq(orgId: string, workspaceId?: string): Promise<WorkItemRecord[]> {
    return [...this.workItems.values()]
      .filter(
        (wi) =>
          wi.org_id === orgId &&
          wi.status === 'dead' &&
          (!workspaceId || wi.workspace_id === workspaceId),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((wi) => structuredClone(wi));
  }

  async requeueExpiredLeases(now: Date = this.clock.now()): Promise<number> {
    const nowMs = now.getTime();
    let count = 0;
    for (const wi of this.workItems.values()) {
      if (
        wi.status === 'leased' &&
        wi.lease_expires_at !== null &&
        Date.parse(wi.lease_expires_at) <= nowMs
      ) {
        if (wi.attempts < wi.max_attempts) {
          assertWorkItemTransition('leased', 'ready');
          wi.status = 'ready';
          wi.lease_owner = null;
          wi.lease_expires_at = null;
          wi.available_at = now.toISOString();
          count += 1;
        } else {
          assertWorkItemTransition('leased', 'dead');
          wi.status = 'dead';
          wi.lease_owner = null;
          wi.lease_expires_at = null;
          const run = this.runs.get(wi.run_id);
          if (run && !TERMINAL_RUN_STATUSES.has(run.status)) {
            assertRunTransition(run.status, 'failed');
            run.status = 'failed';
            run.failure_class = 'timeout';
            run.termination_reason = 'error';
            run.ended_at = now.toISOString();
            this.appendRunEvent(run, 'dlq.item.added', {
              work_item_id: wi.id,
              failure_class: 'timeout',
            });
          }
          count += 1;
        }
      }
    }
    return count;
  }

  async fireDueTimers(now: Date = this.clock.now(), batch = 100): Promise<number> {
    const nowMs = now.getTime();
    let fired = 0;

    for (const timer of this.timers.values()) {
      if (fired >= batch) break;
      if (timer.fired_at === null && Date.parse(timer.fire_at) <= nowMs) {
        timer.fired_at = now.toISOString();
        const run = this.runs.get(timer.run_id);
        if (run && run.status === 'waiting_timer') {
          await this.signal(
            {
              orgId: run.org_id as TenantContext['orgId'],
              principal: { id: run.initiator_id as TenantContext['principal']['id'], type: 'service_account' },
              requestId: `req_timer_${timer.id}`,
              traceId: '0'.repeat(32),
            },
            run.id,
            { kind: 'timer', reason: 'timer_fired', payload: timer.payload },
          );
        }
        fired += 1;
      }
    }
    return fired;
  }

  async drainOutbox(batch: number, bus: EventBus): Promise<number> {
    let published = 0;
    const nowIso = this.clock.now().toISOString();

    for (const row of this.outbox) {
      if (published >= batch) break;
      if (row.published_at !== null) continue;
      const run = this.runs.get(row.subject);
      const evt: CloudEvent = {
        specversion: '1.0',
        id: row.id,
        source: 'platform/engine',
        type: row.type,
        subject: row.subject,
        time: row.created_at,
        datacontenttype: 'application/json',
        orgid: row.org_id,
        workspaceid: run?.workspace_id,
        traceparent: row.traceparent ?? undefined,
        schema: 1,
        data: row.payload,
      };
      await bus.publish(evt);
      row.published_at = nowIso;
      published += 1;
    }
    return published;
  }
}
