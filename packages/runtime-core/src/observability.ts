import { randomUUID } from 'node:crypto';
import { PlatformError, type TenantContext } from '@elshad/domain';
import type { ExecutionEngine, RunRecord, RunStepRecord } from '@elshad/execution';
import { exportRunToOtelGenAi, type OtelExportPayload } from '@elshad/telemetry';

export type AlertMetric = 'failure_rate' | 'cost_spike' | 'latency_p95' | 'queue_depth';
export type AlertOperator = 'gt' | 'gte';
export type AlertIncidentStatus = 'firing' | 'acknowledged' | 'resolved';

export interface ObservabilityOverview {
  windowHours: number;
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  successRate: number;
  failureRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalCostUsd: number;
  costPerRunUsd: number;
  costPerSuccessfulOutcomeUsd: number;
  tokensIn: number;
  tokensOut: number;
  queueDepth: number;
  approvalPendingCount: number;
  failureByClass: Array<{ failureClass: string; count: number }>;
  costByAgent: Array<{
    agentId: string;
    runs: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  costByModel: Array<{
    model: string;
    calls: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  dailySeries: Array<{
    bucket: string;
    runs: number;
    failed: number;
    costUsd: number;
  }>;
}

export interface FailureExplanation {
  runId: string;
  status: string;
  failureClass: string;
  rootCause: string;
  failingStepSeq: number | null;
  failingStepType: string | null;
  remediation: string[];
}

export interface AlertRuleRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  windowMinutes: number;
  channels: string[];
  enabled: boolean;
  lastFiredAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertIncidentRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  ruleId: string;
  metric: AlertMetric;
  observedValue: number;
  threshold: number;
  status: AlertIncidentStatus;
  summary: string;
  firedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface NormalizedRunSnapshot {
  id: string;
  orgId: string;
  workspaceId: string;
  subjectType: string;
  subjectVersionId: string;
  status: string;
  failureClass: string | null;
  terminationReason: string | null;
  costMicroUsd: number;
  tokensIn: number;
  tokensOut: number;
  createdAtMs: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
}

export interface NormalizedStepSnapshot {
  id: string;
  runId: string;
  seq: number;
  type: string;
  status: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costMicroUsd: number;
  latencyMs: number | null;
  errorMessage: string | null;
  startedAtMs: number;
  endedAtMs: number | null;
}

export interface ObservabilityDataStore {
  listRunsSince(orgId: string, sinceMs: number, workspaceId?: string): Promise<NormalizedRunSnapshot[]>;
  listStepsForRuns(orgId: string, runIds: string[]): Promise<NormalizedStepSnapshot[]>;
  getRun(orgId: string, runId: string): Promise<NormalizedRunSnapshot | null>;
  countPendingApprovals(orgId: string, workspaceId?: string): Promise<number>;
  listAlertRules(orgId: string, workspaceId?: string, enabledOnly?: boolean): Promise<AlertRuleRecord[]>;
  createAlertRule(rule: Omit<AlertRuleRecord, 'id' | 'lastFiredAt' | 'createdAt' | 'updatedAt'>): Promise<AlertRuleRecord>;
  deleteAlertRule(orgId: string, id: string): Promise<boolean>;
  touchAlertRuleFired(orgId: string, id: string, firedAt: string): Promise<void>;
  listAlertIncidents(orgId: string, workspaceId?: string): Promise<AlertIncidentRecord[]>;
  hasFiringIncidentForRule(orgId: string, ruleId: string): Promise<boolean>;
  createAlertIncident(
    incident: Omit<AlertIncidentRecord, 'id' | 'acknowledgedAt' | 'resolvedAt'>,
  ): Promise<AlertIncidentRecord>;
  updateAlertIncidentStatus(
    orgId: string,
    id: string,
    status: 'acknowledged' | 'resolved',
  ): Promise<AlertIncidentRecord | null>;
}

function normalizeExecutionRun(r: RunRecord): NormalizedRunSnapshot {
  return {
    id: r.id,
    orgId: r.org_id,
    workspaceId: r.workspace_id,
    subjectType: r.subject_type,
    subjectVersionId: r.subject_version_id,
    status: r.status,
    failureClass: r.failure_class ?? null,
    terminationReason: r.termination_reason ?? null,
    costMicroUsd: Number(r.cost_micro_usd ?? 0),
    tokensIn: Number(r.usage?.tokens_in ?? 0),
    tokensOut: Number(r.usage?.tokens_out ?? 0),
    createdAtMs: Date.parse(r.created_at),
    startedAtMs: r.started_at ? Date.parse(r.started_at) : null,
    endedAtMs: r.ended_at ? Date.parse(r.ended_at) : null,
  };
}

function normalizeExecutionStep(s: RunStepRecord): NormalizedStepSnapshot {
  return {
    id: s.id,
    runId: s.run_id,
    seq: s.seq,
    type: s.type,
    status: s.status,
    model: s.model,
    tokensIn: s.tokens_in,
    tokensOut: s.tokens_out,
    costMicroUsd: Number(s.cost_micro_usd ?? 0),
    latencyMs: s.latency_ms,
    errorMessage: s.error ? String((s.error as Record<string, unknown>).message ?? JSON.stringify(s.error)) : null,
    startedAtMs: Date.parse(s.started_at || s.created_at),
    endedAtMs: s.ended_at ? Date.parse(s.ended_at) : null,
  };
}

export class ExecutionObservabilityStore implements ObservabilityDataStore {
  private readonly rules = new Map<string, AlertRuleRecord>();
  private readonly incidents = new Map<string, AlertIncidentRecord>();

  constructor(
    private readonly executionEngine: ExecutionEngine,
    private readonly pendingApprovalsCounter: (orgId: string, workspaceId?: string) => number = () => 0,
  ) {}

  async listRunsSince(orgId: string, sinceMs: number, workspaceId?: string): Promise<NormalizedRunSnapshot[]> {
    const runs = await this.executionEngine.listRuns(orgId, workspaceId ? { workspaceId } : undefined);
    return runs.map(normalizeExecutionRun).filter((r) => r.createdAtMs >= sinceMs);
  }

  async listStepsForRuns(orgId: string, runIds: string[]): Promise<NormalizedStepSnapshot[]> {
    const all: NormalizedStepSnapshot[] = [];
    for (const runId of runIds) {
      const steps = await this.executionEngine.listSteps(orgId, runId);
      for (const s of steps) all.push(normalizeExecutionStep(s));
    }
    return all.sort((a, b) => a.seq - b.seq);
  }

  async getRun(orgId: string, runId: string): Promise<NormalizedRunSnapshot | null> {
    const r = await this.executionEngine.getRun(orgId, runId);
    return r ? normalizeExecutionRun(r) : null;
  }

  async countPendingApprovals(orgId: string, workspaceId?: string): Promise<number> {
    return this.pendingApprovalsCounter(orgId, workspaceId);
  }

  async listAlertRules(orgId: string, workspaceId?: string, enabledOnly?: boolean): Promise<AlertRuleRecord[]> {
    return Array.from(this.rules.values())
      .filter((r) => r.orgId === orgId)
      .filter((r) => !workspaceId || r.workspaceId === workspaceId)
      .filter((r) => !enabledOnly || r.enabled)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAlertRule(
    input: Omit<AlertRuleRecord, 'id' | 'lastFiredAt' | 'createdAt' | 'updatedAt'>,
  ): Promise<AlertRuleRecord> {
    const now = new Date().toISOString();
    const record: AlertRuleRecord = {
      ...input,
      id: randomUUID(),
      lastFiredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.set(record.id, record);
    return record;
  }

  async deleteAlertRule(orgId: string, id: string): Promise<boolean> {
    const existing = this.rules.get(id);
    if (!existing || existing.orgId !== orgId) return false;
    this.rules.delete(id);
    return true;
  }

  async touchAlertRuleFired(orgId: string, id: string, firedAt: string): Promise<void> {
    const existing = this.rules.get(id);
    if (existing && existing.orgId === orgId) {
      existing.lastFiredAt = firedAt;
      existing.updatedAt = firedAt;
    }
  }

  async listAlertIncidents(orgId: string, workspaceId?: string): Promise<AlertIncidentRecord[]> {
    return Array.from(this.incidents.values())
      .filter((i) => i.orgId === orgId)
      .filter((i) => !workspaceId || i.workspaceId === workspaceId)
      .sort((a, b) => b.firedAt.localeCompare(a.firedAt));
  }

  async hasFiringIncidentForRule(orgId: string, ruleId: string): Promise<boolean> {
    return Array.from(this.incidents.values()).some(
      (i) => i.orgId === orgId && i.ruleId === ruleId && i.status === 'firing',
    );
  }

  async createAlertIncident(
    input: Omit<AlertIncidentRecord, 'id' | 'acknowledgedAt' | 'resolvedAt'>,
  ): Promise<AlertIncidentRecord> {
    const record: AlertIncidentRecord = {
      ...input,
      id: randomUUID(),
      acknowledgedAt: null,
      resolvedAt: null,
    };
    this.incidents.set(record.id, record);
    return record;
  }

  async updateAlertIncidentStatus(
    orgId: string,
    id: string,
    status: 'acknowledged' | 'resolved',
  ): Promise<AlertIncidentRecord | null> {
    const existing = this.incidents.get(id);
    if (!existing || existing.orgId !== orgId) return null;
    const now = new Date().toISOString();
    existing.status = status;
    if (status === 'acknowledged') existing.acknowledgedAt = now;
    if (status === 'resolved') existing.resolvedAt = now;
    return existing;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export class ObservabilityEngine {
  constructor(private readonly store: ObservabilityDataStore) {}

  async getOverview(
    ctx: TenantContext,
    input: { workspaceId?: string; windowHours?: number } = {},
  ): Promise<ObservabilityOverview> {
    const windowHours = Math.max(1 / 60, Math.min(720, input.windowHours ?? 24));
    const sinceMs = Date.now() - windowHours * 3600_000;
    const runs = await this.store.listRunsSince(ctx.orgId, sinceMs, input.workspaceId);
    const steps = await this.store.listStepsForRuns(
      ctx.orgId,
      runs.map((r) => r.id),
    );
    const approvalPendingCount = await this.store.countPendingApprovals(ctx.orgId, input.workspaceId);

    const totalRuns = runs.length;
    const succeededRuns = runs.filter((r) => r.status === 'succeeded').length;
    const failedRuns = runs.filter(
      (r) => r.status === 'failed' || r.status === 'timed_out' || r.status === 'cancelled',
    ).length;
    const queueDepth = runs.filter(
      (r) => r.status === 'queued' || r.status === 'running' || r.status === 'waiting',
    ).length;

    const durations = runs
      .map((r) => (r.startedAtMs !== null && r.endedAtMs !== null ? Math.max(0, r.endedAtMs - r.startedAtMs) : null))
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);

    let totalCostMicro = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    const failureCounts = new Map<string, number>();
    const agentMap = new Map<
      string,
      { agentId: string; runs: number; costMicro: number; tokensIn: number; tokensOut: number }
    >();
    const dailyMap = new Map<string, { bucket: string; runs: number; failed: number; costMicro: number }>();

    for (const run of runs) {
      totalCostMicro += run.costMicroUsd;
      tokensIn += run.tokensIn;
      tokensOut += run.tokensOut;

      if (run.status === 'failed' || run.status === 'timed_out') {
        const cls = run.failureClass ?? run.terminationReason ?? 'unknown';
        failureCounts.set(cls, (failureCounts.get(cls) ?? 0) + 1);
      }

      const agentKey = `${run.subjectType}:${run.subjectVersionId}`;
      const existingAgent = agentMap.get(agentKey) ?? {
        agentId: agentKey,
        runs: 0,
        costMicro: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
      existingAgent.runs += 1;
      existingAgent.costMicro += run.costMicroUsd;
      existingAgent.tokensIn += run.tokensIn;
      existingAgent.tokensOut += run.tokensOut;
      agentMap.set(agentKey, existingAgent);

      const bucket = new Date(run.createdAtMs).toISOString().slice(0, 10);
      const dayEntry = dailyMap.get(bucket) ?? { bucket, runs: 0, failed: 0, costMicro: 0 };
      dayEntry.runs += 1;
      if (run.status === 'failed' || run.status === 'timed_out') dayEntry.failed += 1;
      dayEntry.costMicro += run.costMicroUsd;
      dailyMap.set(bucket, dayEntry);
    }

    const modelMap = new Map<
      string,
      { model: string; calls: number; costMicro: number; tokensIn: number; tokensOut: number }
    >();
    for (const step of steps) {
      if (!step.model) continue;
      const m = modelMap.get(step.model) ?? {
        model: step.model,
        calls: 0,
        costMicro: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
      m.calls += 1;
      m.costMicro += step.costMicroUsd;
      m.tokensIn += step.tokensIn ?? 0;
      m.tokensOut += step.tokensOut ?? 0;
      modelMap.set(step.model, m);
    }

    const totalCostUsd = totalCostMicro / 1_000_000;
    return {
      windowHours,
      totalRuns,
      succeededRuns,
      failedRuns,
      successRate: totalRuns > 0 ? succeededRuns / totalRuns : 1,
      failureRate: totalRuns > 0 ? failedRuns / totalRuns : 0,
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      p99DurationMs: percentile(durations, 99),
      totalCostUsd,
      costPerRunUsd: totalRuns > 0 ? totalCostUsd / totalRuns : 0,
      costPerSuccessfulOutcomeUsd: succeededRuns > 0 ? totalCostUsd / succeededRuns : 0,
      tokensIn,
      tokensOut,
      queueDepth,
      approvalPendingCount,
      failureByClass: Array.from(failureCounts.entries()).map(([failureClass, count]) => ({
        failureClass,
        count,
      })),
      costByAgent: Array.from(agentMap.values()).map((a) => ({
        agentId: a.agentId,
        runs: a.runs,
        costUsd: a.costMicro / 1_000_000,
        tokensIn: a.tokensIn,
        tokensOut: a.tokensOut,
      })),
      costByModel: Array.from(modelMap.values()).map((m) => ({
        model: m.model,
        calls: m.calls,
        costUsd: m.costMicro / 1_000_000,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
      })),
      dailySeries: Array.from(dailyMap.values())
        .sort((a, b) => a.bucket.localeCompare(b.bucket))
        .map((d) => ({
          bucket: d.bucket,
          runs: d.runs,
          failed: d.failed,
          costUsd: d.costMicro / 1_000_000,
        })),
    };
  }

  async explainFailure(ctx: TenantContext, runId: string): Promise<FailureExplanation> {
    const run = await this.store.getRun(ctx.orgId, runId);
    if (!run) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }
    const steps = await this.store.listStepsForRuns(ctx.orgId, [runId]);
    const failingStep = [...steps].reverse().find((s) => s.status === 'failed') ?? null;
    const stepErrorText = failingStep?.errorMessage ?? '';
    const failureClass = run.failureClass ?? run.terminationReason ?? 'unknown';

    let rootCause = `Run ended with status "${run.status}"`;
    const remediation: string[] = [];

    if (failureClass.includes('policy') || stepErrorText.toLowerCase().includes('policy')) {
      rootCause = `Policy guard blocked execution${failingStep ? ` at step #${failingStep.seq} (${failingStep.type})` : ''}: ${stepErrorText || failureClass}`;
      remediation.push('Review the matched policy rule in Governance -> Policies and adjust tool grants or autonomy level.');
    } else if (failureClass.includes('budget') || failureClass.includes('limit')) {
      rootCause = `Execution halted because a run limit or workspace budget (${failureClass}) was reached.`;
      remediation.push('Increase step/token/cost limits on the agent version or raise the workspace budget.');
    } else if (failureClass.includes('timeout') || run.status === 'timed_out') {
      rootCause = `Run timed out${failingStep ? ` during step #${failingStep.seq} (${failingStep.type})` : ''}.`;
      remediation.push('Increase step timeout or inspect external tool/model latency.');
    } else if (failingStep) {
      rootCause = `Step #${failingStep.seq} (${failingStep.type}) failed: ${stepErrorText || 'unexpected tool or model error'}`;
      remediation.push('Inspect step inputs/outputs in the run trace and verify downstream connector credentials.');
    } else {
      remediation.push('Inspect run events and audit log for full context.');
    }

    return {
      runId: run.id,
      status: run.status,
      failureClass,
      rootCause,
      failingStepSeq: failingStep ? failingStep.seq : null,
      failingStepType: failingStep ? failingStep.type : null,
      remediation,
    };
  }

  async exportRunOtel(ctx: TenantContext, runId: string): Promise<OtelExportPayload> {
    const run = await this.store.getRun(ctx.orgId, runId);
    if (!run) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${runId} not found`);
    }
    const steps = await this.store.listStepsForRuns(ctx.orgId, [runId]);
    return exportRunToOtelGenAi({
      id: run.id,
      orgId: run.orgId,
      workspaceId: run.workspaceId,
      agentId: run.subjectVersionId,
      status: run.status,
      startedAt: new Date(run.startedAtMs ?? run.createdAtMs).toISOString(),
      finishedAt: run.endedAtMs ? new Date(run.endedAtMs).toISOString() : null,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costMicroUsd / 1_000_000,
      errorMessage: run.failureClass ?? run.terminationReason,
      steps: steps.map((s) => ({
        id: s.id,
        stepIndex: s.seq,
        kind: s.type,
        status: s.status,
        startedAt: new Date(s.startedAtMs).toISOString(),
        finishedAt: s.endedAtMs ? new Date(s.endedAtMs).toISOString() : null,
        durationMs: s.latencyMs,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        costUsd: s.costMicroUsd / 1_000_000,
        model: s.model,
        errorMessage: s.errorMessage,
      })),
    });
  }

  async listAlertRules(ctx: TenantContext, workspaceId?: string): Promise<AlertRuleRecord[]> {
    return this.store.listAlertRules(ctx.orgId, workspaceId);
  }

  async createAlertRule(
    ctx: TenantContext,
    input: {
      workspaceId: string;
      name: string;
      metric: AlertMetric;
      operator?: AlertOperator;
      threshold: number;
      windowMinutes?: number;
      channels?: string[];
      enabled?: boolean;
    },
  ): Promise<AlertRuleRecord> {
    return this.store.createAlertRule({
      orgId: ctx.orgId,
      workspaceId: input.workspaceId,
      name: input.name,
      metric: input.metric,
      operator: input.operator ?? 'gt',
      threshold: input.threshold,
      windowMinutes: input.windowMinutes ?? 5,
      channels: input.channels ?? ['in_app'],
      enabled: input.enabled ?? true,
      createdBy: ctx.principal?.id ?? null,
    });
  }

  async deleteAlertRule(ctx: TenantContext, id: string): Promise<void> {
    const deleted = await this.store.deleteAlertRule(ctx.orgId, id);
    if (!deleted) {
      throw new PlatformError('RES_NOT_FOUND', `Alert rule ${id} not found`);
    }
  }

  async listAlertIncidents(ctx: TenantContext, workspaceId?: string): Promise<AlertIncidentRecord[]> {
    return this.store.listAlertIncidents(ctx.orgId, workspaceId);
  }

  async acknowledgeAlertIncident(ctx: TenantContext, id: string): Promise<AlertIncidentRecord> {
    const updated = await this.store.updateAlertIncidentStatus(ctx.orgId, id, 'acknowledged');
    if (!updated) {
      throw new PlatformError('RES_NOT_FOUND', `Alert incident ${id} not found`);
    }
    return updated;
  }

  async resolveAlertIncident(ctx: TenantContext, id: string): Promise<AlertIncidentRecord> {
    const updated = await this.store.updateAlertIncidentStatus(ctx.orgId, id, 'resolved');
    if (!updated) {
      throw new PlatformError('RES_NOT_FOUND', `Alert incident ${id} not found`);
    }
    return updated;
  }

  async evaluateAlertRules(
    ctx: TenantContext,
    workspaceId?: string,
  ): Promise<{ evaluatedCount: number; firedIncidents: AlertIncidentRecord[] }> {
    const rules = await this.store.listAlertRules(ctx.orgId, workspaceId, true);
    const firedIncidents: AlertIncidentRecord[] = [];

    for (const rule of rules) {
      const overview = await this.getOverview(ctx, {
        workspaceId: rule.workspaceId,
        windowHours: Math.max(1 / 60, rule.windowMinutes / 60),
      });

      let observed = 0;
      if (rule.metric === 'failure_rate') observed = overview.failureRate;
      else if (rule.metric === 'cost_spike') observed = overview.totalCostUsd;
      else if (rule.metric === 'latency_p95') observed = overview.p95DurationMs;
      else if (rule.metric === 'queue_depth') observed = overview.queueDepth;

      const breached =
        rule.operator === 'gte' ? observed >= rule.threshold : observed > rule.threshold;
      if (!breached) continue;

      if (await this.store.hasFiringIncidentForRule(ctx.orgId, rule.id)) {
        continue;
      }

      const now = new Date().toISOString();
      const incident = await this.store.createAlertIncident({
        orgId: ctx.orgId,
        workspaceId: rule.workspaceId,
        ruleId: rule.id,
        metric: rule.metric,
        observedValue: observed,
        threshold: rule.threshold,
        status: 'firing',
        summary: `Alert "${rule.name}" fired: ${rule.metric}=${observed.toFixed(3)} ${rule.operator} ${rule.threshold}`,
        firedAt: now,
      });

      await this.store.touchAlertRuleFired(ctx.orgId, rule.id, now);
      firedIncidents.push(incident);
    }

    return { evaluatedCount: rules.length, firedIncidents };
  }
}
