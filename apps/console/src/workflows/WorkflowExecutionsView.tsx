import { useMemo, useState } from 'react';
import type { EnvironmentKind } from '@elshad/domain';
import type { RunDto, RunStepDto, WorkflowDto } from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  XCircle,
} from 'lucide-react';
import { findWorkflowForRun, getWorkflowTriggerKind } from './workflowTemplates.js';

export interface WorkflowExecutionsViewProps {
  workflows: WorkflowDto[];
  runs: RunDto[];
  stepsByRunId: Record<string, RunStepDto[]>;
  environment: EnvironmentKind;
  loading: boolean;
  onRefresh: () => void;
  onInspectOnCanvas: (run: RunDto, workflow: WorkflowDto | null) => Promise<void> | void;
  onCancelRun: (runId: string) => Promise<void> | void;
  onRerunWorkflow: (run: RunDto, workflow: WorkflowDto | null) => Promise<void> | void;
  onLoadRunSteps: (runId: string) => Promise<RunStepDto[]> | RunStepDto[];
  onRunSelectedWorkflow: () => void;
}

function getRunDurationMs(run: RunDto): number {
  if (run.startedAt && run.endedAt) {
    const diff = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    if (Number.isFinite(diff) && diff >= 0) return diff;
  }
  return 0;
}

export function WorkflowExecutionsView({
  workflows,
  runs,
  stepsByRunId,
  environment,
  loading,
  onRefresh,
  onInspectOnCanvas,
  onCancelRun,
  onRerunWorkflow,
  onLoadRunSteps,
  onRunSelectedWorkflow,
}: WorkflowExecutionsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [envFilter, setEnvFilter] = useState<string>(environment);
  const [timelineRunId, setTimelineRunId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const workflowRuns = useMemo(() => {
    return runs.filter(
      (r) =>
        r.subjectType === 'workflow_version' ||
        r.subjectType === 'workflow' ||
        findWorkflowForRun(r, workflows) !== null,
    );
  }, [runs, workflows]);

  const rows = useMemo(() => {
    return workflowRuns.map((run) => {
      const wf = findWorkflowForRun(run, workflows);
      const triggerKind =
        (run as unknown as { triggerType?: string }).triggerType ??
        run.labels?.trigger ??
        (wf ? getWorkflowTriggerKind(wf) : 'manual');
      const durationMs = getRunDurationMs(run);
      return { run, wf, triggerKind, durationMs };
    });
  }, [workflowRuns, workflows]);

  const filtered = useMemo(() => {
    return rows.filter(({ run, wf, triggerKind }) => {
      if (workflowFilter !== 'all' && wf?.id !== workflowFilter) return false;
      if (statusFilter !== 'all' && run.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${run.id} ${wf?.name ?? ''} ${triggerKind} ${run.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, workflowFilter, statusFilter, searchQuery]);

  const analytics = useMemo(() => {
    const total = rows.length;
    const succeeded = rows.filter((r) => r.run.status === 'succeeded').length;
    const failed = rows.filter(
      (r) => r.run.status === 'failed' || r.run.status === 'timed_out',
    ).length;
    const running = rows.filter(
      (r) =>
        r.run.status === 'running' ||
        r.run.status === 'queued' ||
        r.run.status === 'waiting_approval',
    ).length;
    const avgMs =
      total > 0
        ? Math.round(rows.reduce((acc, r) => acc + r.durationMs, 0) / total)
        : 0;
    return { total, succeeded, failed, running, avgMs };
  }, [rows]);

  function handleExportCsv() {
    const header = ['run_id', 'workflow', 'trigger', 'status', 'duration_ms', 'cost_micro_usd', 'started_at'];
    const csvRows = [
      header.join(','),
      ...filtered.map(({ run, wf, triggerKind, durationMs }) =>
        [
          run.id,
          `"${(wf?.name ?? run.subjectVersionId ?? 'workflow').replace(/"/g, '""')}"`,
          triggerKind,
          run.status,
          String(durationMs),
          String(run.costMicroUsd ?? 0),
          run.startedAt ?? run.createdAt,
        ].join(','),
      ),
    ];
    const csvText = csvRows.join('\n');
    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof navigator !== 'undefined' &&
      !navigator.userAgent.includes('jsdom')
    ) {
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `elshad-workflow-executions-${environment}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    setExportNotice(`Exported ${filtered.length} workflow execution row(s) to CSV.`);
  }

  async function handleToggleTimeline(runId: string) {
    if (timelineRunId === runId) {
      setTimelineRunId(null);
      return;
    }
    await onLoadRunSteps(runId);
    setTimelineRunId(runId);
  }

  const activeTimelineRow = rows.find((r) => r.run.id === timelineRunId) ?? null;
  const activeTimelineSteps = timelineRunId ? stepsByRunId[timelineRunId] ?? [] : [];

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Workflow Executions
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Inspect execution outcomes, step timelines, and open runs directly on the visual canvas.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={{
              minHeight: '34px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            style={{
              minHeight: '34px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--brand)',
              backgroundColor: 'var(--surface)',
              color: 'var(--brand)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Download size={14} aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {exportNotice && <SuccessNotice message={exportNotice} />}

      {/* 5 Execution Analytics Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: '12px',
        }}
      >
        {[
          {
            label: 'Total Executions',
            value: analytics.total,
            iconBg: 'var(--lavender)',
            iconColor: 'var(--brand)',
            icon: <Activity size={17} aria-hidden="true" />,
          },
          {
            label: 'Successful',
            value: analytics.succeeded,
            iconBg: 'var(--success-bg)',
            iconColor: 'var(--success)',
            icon: <CheckCircle2 size={17} aria-hidden="true" />,
          },
          {
            label: 'Failed',
            value: analytics.failed,
            iconBg: 'var(--danger-bg)',
            iconColor: 'var(--danger)',
            icon: <XCircle size={17} aria-hidden="true" />,
          },
          {
            label: 'Running',
            value: analytics.running,
            iconBg: 'var(--info-bg)',
            iconColor: 'var(--info)',
            icon: <Play size={17} aria-hidden="true" />,
          },
          {
            label: 'Avg Duration',
            value: `${analytics.avgMs}ms`,
            iconBg: 'var(--warning-bg)',
            iconColor: 'var(--warning)',
            icon: <Clock size={17} aria-hidden="true" />,
          },
        ].map((card) => (
          <section
            key={card.label}
            aria-label={card.label}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '9999px',
                backgroundColor: card.iconBg,
                color: card.iconColor,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {card.icon}
            </span>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.1 }}>{card.value}</div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {card.label}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Filters & Execution Table */}
      <section
        aria-label="Workflow execution history"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-card)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search
              size={14}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '9px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="search"
              aria-label="Search executions"
              placeholder="Search run ID or workflow..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                minHeight: '32px',
                padding: '4px 10px 4px 28px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
              }}
            />
          </div>

          <select
            aria-label="Filter executions by workflow"
            value={workflowFilter}
            onChange={(e) => setWorkflowFilter(e.target.value)}
            style={{
              minHeight: '32px',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12.5px',
            }}
          >
            <option value="all">All workflows</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter executions by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              minHeight: '32px',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12.5px',
            }}
          >
            <option value="all">All statuses</option>
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
            <option value="running">running</option>
            <option value="waiting_approval">waiting_approval</option>
            <option value="cancelled">cancelled</option>
          </select>

          <select
            aria-label="Filter executions by environment"
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            style={{
              minHeight: '32px',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12.5px',
            }}
          >
            <option value="dev">DEV</option>
            <option value="staging">STAGING</option>
            <option value="prod">PROD</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '20px' }}>
            <StateView
              state="empty"
              title="No workflow executions yet"
              description="Run a workflow from the Canvas Builder or trigger an active webhook to populate execution telemetry."
              actionLabel="Test Current Workflow"
              onAction={onRunSelectedWorkflow}
            />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              aria-label="Workflow executions"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-raised)',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                  }}
                >
                  <th style={{ padding: '10px 14px' }}>Workflow</th>
                  <th style={{ padding: '10px 14px' }}>Trigger</th>
                  <th style={{ padding: '10px 14px' }}>Start Time</th>
                  <th style={{ padding: '10px 14px' }}>Duration</th>
                  <th style={{ padding: '10px 14px' }}>Status</th>
                  <th style={{ padding: '10px 14px' }}>Cost</th>
                  <th style={{ padding: '10px 14px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ run, wf, triggerKind, durationMs }) => {
                  const canCancel =
                    run.status === 'running' ||
                    run.status === 'queued' ||
                    run.status === 'waiting_approval';
                  return (
                    <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 700 }}>{wf?.name ?? run.subjectVersionId}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          <code>{run.id}</code>
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <StatusChip label={String(triggerKind)} tone="neutral" />
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {run.startedAt ?? run.createdAt}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{durationMs}ms</td>
                      <td style={{ padding: '12px 14px' }}>
                        <StatusChip
                          label={run.status}
                          tone={
                            run.status === 'succeeded'
                              ? 'success'
                              : run.status === 'failed' || run.status === 'timed_out'
                                ? 'danger'
                                : run.status === 'waiting_approval'
                                  ? 'warning'
                                  : 'info'
                          }
                        />
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {run.costMicroUsd ?? 0} micro-USD
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => void onInspectOnCanvas(run, wf)}
                            style={{
                              minHeight: '28px',
                              padding: '4px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: 'none',
                              backgroundColor: 'var(--brand)',
                              color: '#fff',
                              fontWeight: 600,
                              fontSize: '12px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Eye size={12} aria-hidden="true" />
                            <span>Inspect on Canvas</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleTimeline(run.id)}
                            style={{
                              minHeight: '28px',
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border)',
                              backgroundColor: 'var(--surface)',
                              color: 'var(--text-primary)',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            Timeline
                          </button>
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => void onCancelRun(run.id)}
                              style={{
                                minHeight: '28px',
                                padding: '4px 8px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--danger)',
                                backgroundColor: 'var(--danger-bg)',
                                color: 'var(--danger)',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Square size={11} aria-hidden="true" />
                              <span>Cancel</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void onRerunWorkflow(run, wf)}
                            style={{
                              minHeight: '28px',
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border)',
                              backgroundColor: 'var(--surface)',
                              color: 'var(--text-primary)',
                              fontSize: '12px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <RotateCcw size={12} aria-hidden="true" />
                            <span>Re-run</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Execution Timeline Drawer */}
      {activeTimelineRow && (
        <section
          aria-label="Execution timeline details"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--lavender-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <div>
              <strong>Execution Timeline</strong> — <code>{activeTimelineRow.run.id}</code>
            </div>
            <button
              type="button"
              onClick={() => setTimelineRunId(null)}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-raised)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Hide Timeline
            </button>
          </div>
          {activeTimelineSteps.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Run completed inline ({activeTimelineRow.durationMs}ms total). Open on canvas to inspect node execution status overlay.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '6px' }}>
              {activeTimelineSteps.map((step) => (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    fontSize: '12px',
                  }}
                >
                  <span>
                    <strong>#{step.seq}</strong> {step.type}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>{step.latencyMs}ms</span>
                    <StatusChip
                      label={step.status}
                      tone={step.status === 'succeeded' ? 'success' : 'neutral'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
