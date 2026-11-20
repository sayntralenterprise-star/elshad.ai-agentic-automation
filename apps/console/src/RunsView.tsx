import { useMemo, useState } from 'react';
import {
  formatMicroUsdAsUsd,
  microUsd,
  type EnvironmentKind,
  type RunStatus,
} from '@elshad/domain';
import type {
  DlqItemDto,
  PlatformClient,
  RunDto,
  RunEventDto,
  RunStepDto,
} from '@elshad/sdk-ts';
import {
  Sparkline,
  StateView,
  StatusChip,
  SuccessNotice,
  type BadgeTone,
} from '@elshad/ui-kit';
import {
  Activity,
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Coins,
  Download,
  Search,
} from 'lucide-react';
import { RunDetailWorkbench } from './runs/RunDetailWorkbench.js';

const ROW_HEIGHT_PX = 34;
const VIEWPORT_HEIGHT_PX = 340;
const OVERSCAN_ROWS = 6;

function statusTone(status: RunStatus | string): BadgeTone {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'timed_out':
    case 'budget_exceeded':
    case 'policy_blocked':
      return 'danger';
    case 'running':
      return 'info';
    case 'waiting_approval':
    case 'waiting_input':
    case 'waiting_timer':
    case 'waiting_child':
      return 'warning';
    default:
      return 'neutral';
  }
}

function getRunDurationMs(run: RunDto): number {
  if (run.startedAt && run.endedAt) {
    const diff = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    if (Number.isFinite(diff) && diff >= 0) return diff;
  }
  return 0;
}

export interface VirtualizedTraceTreeProps {
  steps: readonly RunStepDto[];
  selectedStepId?: string;
  onSelectStep: (step: RunStepDto) => void;
}

/**
 * Windowed trace tree supporting 5,000+ spans under 1s render budget (E0.2-7, P.9).
 */
export function VirtualizedTraceTree({
  steps,
  selectedStepId,
  onSelectStep,
}: VirtualizedTraceTreeProps) {
  const [scrollTop, setScrollTop] = useState(0);

  const visibleCount = Math.ceil(VIEWPORT_HEIGHT_PX / ROW_HEIGHT_PX);
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const endIdx = Math.min(steps.length, startIdx + visibleCount + OVERSCAN_ROWS * 2);

  const visibleSlice = useMemo(() => steps.slice(startIdx, endIdx), [steps, startIdx, endIdx]);
  const totalHeight = steps.length * ROW_HEIGHT_PX;

  if (steps.length === 0) {
    return (
      <StateView
        state="empty"
        title="No steps recorded yet"
        description="Steps will appear here as the worker executes turns and commits checkpoints."
      />
    );
  }

  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
        Showing {visibleSlice.length} rendered of {steps.length} total spans (virtualized)
      </div>
      <div
        role="tree"
        aria-label="Run trace spans"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          height: `${VIEWPORT_HEIGHT_PX}px`,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--surface)',
          position: 'relative',
        }}
      >
        <div role="presentation" style={{ height: `${totalHeight}px`, position: 'relative' }}>
          <div
            role="presentation"
            style={{
              position: 'absolute',
              top: `${startIdx * ROW_HEIGHT_PX}px`,
              left: 0,
              right: 0,
            }}
          >
            {visibleSlice.map((step) => {
              const selected = step.id === selectedStepId;
              return (
                <button
                  key={step.id}
                  type="button"
                  role="treeitem"
                  aria-selected={selected}
                  onClick={() => onSelectStep(step)}
                  style={{
                    width: '100%',
                    height: `${ROW_HEIGHT_PX}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 12px',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: selected ? 'var(--info-bg)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    textAlign: 'left',
                  }}
                >
                  <span>
                    #{step.seq} · {step.type}
                  </span>
                  <span style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span>{step.latencyMs}ms</span>
                    <span>{formatMicroUsdAsUsd(microUsd(step.costMicroUsd), 5)}</span>
                    <StatusChip
                      label={step.status}
                      tone={step.status === 'succeeded' ? 'success' : 'danger'}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SavedRunFilter {
  name: string;
  statusFilter: string;
  failureFilter: string;
  minCostMicro: number;
}

export interface RunsViewProps {
  runs: readonly RunDto[];
  dlqItems: readonly DlqItemDto[];
  loading: boolean;
  error: { message: string; code?: string } | null;
  selectedRun: RunDto | null;
  selectedSteps: readonly RunStepDto[];
  selectedEvents: readonly RunEventDto[];
  selectedStepId?: string;
  client?: PlatformClient;
  environment?: EnvironmentKind;
  onRefresh: () => void;
  onStartSampleRun: () => void;
  onSelectRun: (runId: string) => void;
  onSelectStep: (step: RunStepDto) => void;
  onCancelRun: (runId: string) => void;
  onRedriveRun: (runId: string) => void;
  onBulkCancel?: (runIds: string[]) => void;
  onBulkRedrive?: (runIds: string[]) => void;
  onReplayRun?: (run: RunDto) => void;
  onForkFromStep?: (run: RunDto, stepSeq: number) => void;
  onSaveAsTestCase?: (run: RunDto) => void;
}

export function RunsView({
  runs,
  dlqItems,
  loading,
  error,
  selectedRun,
  selectedSteps,
  selectedEvents,
  selectedStepId,
  client,
  environment = 'dev',
  onRefresh,
  onStartSampleRun,
  onSelectRun,
  onSelectStep,
  onCancelRun,
  onRedriveRun,
  onBulkCancel,
  onBulkRedrive,
  onReplayRun,
  onForkFromStep,
  onSaveAsTestCase,
}: RunsViewProps) {
  const [tab, setTab] = useState<'runs' | 'dlq'>('runs');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [triggerFilter, setTriggerFilter] = useState<string>('all');
  const [failureFilter, setFailureFilter] = useState<string>('all');
  const [minCostMicro, setMinCostMicro] = useState<number>(0);
  const [minDurationMs, setMinDurationMs] = useState<number>(0);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedFilters, setSavedFilters] = useState<SavedRunFilter[]>([
    { name: 'Failed Runs', statusFilter: 'failed', failureFilter: 'all', minCostMicro: 0 },
    { name: 'High Cost (>=100µUSD)', statusFilter: 'all', failureFilter: 'all', minCostMicro: 100 },
  ]);

  const kpis = useMemo(() => {
    const succeeded = runs.filter((r) => r.status === 'succeeded').length;
    const failed = runs.filter(
      (r) =>
        r.status === 'failed' ||
        r.status === 'timed_out' ||
        r.status === 'budget_exceeded' ||
        r.status === 'policy_blocked',
    ).length;
    const totalMicro = runs.reduce((acc, r) => acc + (r.costMicroUsd ?? 0), 0);
    return { total: runs.length, succeeded, failed, totalMicro };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (subjectFilter !== 'all' && r.subjectType !== subjectFilter) return false;
      const trig = r.labels?.trigger ?? 'manual';
      if (triggerFilter !== 'all' && trig !== triggerFilter) return false;
      if (failureFilter !== 'all' && (r.failureClass ?? 'none') !== failureFilter) return false;
      if (minCostMicro > 0 && r.costMicroUsd < minCostMicro) return false;
      if (minDurationMs > 0 && getRunDurationMs(r) < minDurationMs) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${r.id} ${r.subjectVersionId} ${r.initiatorId} ${r.status} ${r.failureClass ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    runs,
    statusFilter,
    subjectFilter,
    triggerFilter,
    failureFilter,
    minCostMicro,
    minDurationMs,
    searchQuery,
  ]);

  function handleSaveCurrentFilter() {
    const label = `Filter ${savedFilters.length + 1} (${statusFilter})`;
    setSavedFilters((prev) => [
      ...prev,
      { name: label, statusFilter, failureFilter, minCostMicro },
    ]);
    setNotice(`Saved filter preset "${label}".`);
  }

  function handleExportCsv() {
    const header = ['run_id', 'subject', 'status', 'environment', 'trigger', 'initiator', 'duration_ms', 'cost_micro_usd', 'failure_class'];
    const lines = [
      header.join(','),
      ...filteredRuns.map((r) =>
        [
          r.id,
          `${r.subjectType}:${r.subjectVersionId}`,
          r.status,
          environment,
          r.labels?.trigger ?? 'manual',
          r.initiatorId,
          String(getRunDurationMs(r)),
          String(r.costMicroUsd),
          r.failureClass ?? '',
        ].join(','),
      ),
    ];
    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof navigator !== 'undefined' &&
      !navigator.userAgent.includes('jsdom')
    ) {
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `elshad-runs-${environment}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    setNotice(`Exported ${filteredRuns.length} run(s) to CSV.`);
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Runs &amp; Traces
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            Central durable execution log across agents and workflows with virtualized span inspection.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setTab('runs')}
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: tab === 'runs' ? 'var(--lavender)' : 'var(--surface)',
              color: tab === 'runs' ? 'var(--brand)' : 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Runs ({runs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('dlq')}
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: tab === 'dlq' ? 'var(--danger-bg)' : 'var(--surface)',
              color: tab === 'dlq' ? 'var(--danger)' : 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            DLQ ({dlqItems.length})
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Download size={13} aria-hidden="true" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onStartSampleRun}
            style={{
              minHeight: '32px',
              padding: '4px 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--brand)',
              color: 'var(--brand-contrast)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Start Durable Run
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
        }}
      >
        {[
          {
            label: 'Total Runs',
            value: kpis.total,
            iconBg: 'var(--lavender)',
            iconColor: 'var(--brand)',
            icon: <Activity size={17} aria-hidden="true" />,
            spark: [2, 4, 3, 5, 4, Math.max(1, kpis.total)],
            sparkColor: '#3924D6',
          },
          {
            label: 'Succeeded',
            value: kpis.succeeded,
            iconBg: 'var(--success-bg)',
            iconColor: 'var(--success)',
            icon: <CheckCircle2 size={17} aria-hidden="true" />,
            spark: [1, 3, 2, 4, 3, Math.max(1, kpis.succeeded)],
            sparkColor: '#12B76A',
          },
          {
            label: 'Failed / Blocked',
            value: kpis.failed,
            iconBg: 'var(--danger-bg)',
            iconColor: 'var(--danger)',
            icon: <AlertTriangle size={17} aria-hidden="true" />,
            spark: [0, 1, 0, 1, 0, kpis.failed],
            sparkColor: '#D92D20',
          },
          {
            label: 'Total Spend',
            value: formatMicroUsdAsUsd(microUsd(kpis.totalMicro), 4),
            iconBg: 'var(--warning-bg)',
            iconColor: 'var(--warning)',
            icon: <Coins size={17} aria-hidden="true" />,
            spark: [10, 22, 18, 28, 25, 32],
            sparkColor: '#D97706',
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
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            </div>
            <Sparkline data={card.spark} color={card.sparkColor} fill={card.sparkColor} width={58} height={28} />
          </section>
        ))}
      </div>

      {notice && <SuccessNotice message={notice} />}

      {loading && (
        <StateView
          state="loading"
          title="Loading runs"
          description="Fetching durable runs and execution traces..."
        />
      )}

      {!loading && error && (
        <StateView
          state={error.code === 'AUTH_FORBIDDEN' ? 'forbidden' : 'error'}
          title={error.code === 'AUTH_FORBIDDEN' ? 'Permission required' : 'Failed to load runs'}
          description={error.message}
          errorCode={error.code}
          requiredPermission={error.code === 'AUTH_FORBIDDEN' ? 'run:read' : undefined}
          actionLabel="Retry"
          onAction={onRefresh}
        />
      )}

      {!loading && !error && tab === 'dlq' && (
        <section aria-label="Dead-letter queue">
          {dlqItems.length === 0 ? (
            <StateView
              state="empty"
              title="Dead-letter queue is empty"
              description="Runs that exhaust all retries will appear here for inspection and re-drive."
            />
          ) : (
            <table
              aria-label="DLQ items"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px' }}>Run ID</th>
                  <th style={{ padding: '10px' }}>Queue</th>
                  <th style={{ padding: '10px' }}>Attempts</th>
                  <th style={{ padding: '10px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dlqItems.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>{item.runId}</td>
                    <td style={{ padding: '10px' }}>{item.queue}</td>
                    <td style={{ padding: '10px' }}>
                      {item.attempts}/{item.maxAttempts}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <button
                        type="button"
                        onClick={() => onRedriveRun(item.runId)}
                        style={{
                          minHeight: '28px',
                          padding: '4px 10px',
                          border: '1px solid var(--brand)',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--brand)',
                          color: 'var(--brand-contrast)',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Re-drive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {!loading && !error && tab === 'runs' && (
        <div style={{ display: 'grid', gap: '14px' }}>
          {/* Multi-filter & Saved Filters Card */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px',
              boxShadow: 'var(--shadow-card)',
              display: 'grid',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 200px' }}>
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
                  aria-label="Search runs"
                  placeholder="Search run ID, agent/workflow, initiator..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '32px',
                    padding: '4px 8px 4px 28px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12.5px',
                  }}
                />
              </div>

              <label htmlFor="run-status-filter" style={{ fontSize: '12px', fontWeight: 600 }}>
                Status filter
              </label>
              <select
                id="run-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  minHeight: '32px',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <option value="all">All statuses</option>
                <option value="queued">queued</option>
                <option value="running">running</option>
                <option value="succeeded">succeeded</option>
                <option value="failed">failed</option>
                <option value="waiting_approval">waiting_approval</option>
                <option value="cancelled">cancelled</option>
              </select>

              <select
                aria-label="Filter by agent or workflow"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                style={{
                  minHeight: '32px',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <option value="all">All subjects</option>
                <option value="agent_version">Agents</option>
                <option value="workflow_version">Workflows</option>
              </select>

              <select
                aria-label="Filter runs by trigger"
                value={triggerFilter}
                onChange={(e) => setTriggerFilter(e.target.value)}
                style={{
                  minHeight: '32px',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <option value="all">All triggers</option>
                <option value="manual">manual</option>
                <option value="webhook">webhook</option>
                <option value="schedule">schedule</option>
              </select>

              <select
                aria-label="Filter by failure class"
                value={failureFilter}
                onChange={(e) => setFailureFilter(e.target.value)}
                style={{
                  minHeight: '32px',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <option value="all">All failures</option>
                <option value="none">No failure</option>
                <option value="timeout">timeout</option>
                <option value="policy_denied">policy_denied</option>
                <option value="tool_error">tool_error</option>
              </select>

              <input
                type="number"
                min={0}
                aria-label="Minimum cost micro-USD"
                placeholder="Min µUSD"
                value={minCostMicro || ''}
                onChange={(e) => setMinCostMicro(Number(e.target.value) || 0)}
                style={{
                  width: '92px',
                  minHeight: '32px',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              />

              <input
                type="number"
                min={0}
                aria-label="Minimum duration ms"
                placeholder="Min ms"
                value={minDurationMs || ''}
                onChange={(e) => setMinDurationMs(Number(e.target.value) || 0)}
                style={{
                  width: '84px',
                  minHeight: '32px',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              />

              <button
                type="button"
                onClick={handleSaveCurrentFilter}
                style={{
                  minHeight: '32px',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--brand)',
                  backgroundColor: 'var(--lavender-soft)',
                  color: 'var(--brand)',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <BookmarkPlus size={12} aria-hidden="true" />
                <span>Save Filter</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11.5px' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Saved filters:</span>
              {savedFilters.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setStatusFilter(preset.statusFilter);
                    setFailureFilter(preset.failureFilter);
                    setMinCostMicro(preset.minCostMicro);
                  }}
                  style={{
                    padding: '2px 10px',
                    borderRadius: '9999px',
                    border: '1px solid var(--lavender-border)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--brand)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {preset.name}
                </button>
              ))}
              {(statusFilter !== 'all' || failureFilter !== 'all' || minCostMicro > 0 || minDurationMs > 0 || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all');
                    setSubjectFilter('all');
                    setTriggerFilter('all');
                    setFailureFilter('all');
                    setMinCostMicro(0);
                    setMinDurationMs(0);
                    setSearchQuery('');
                  }}
                  style={{
                    padding: '2px 8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {selectedRunIds.length > 0 && (
            <div
              role="region"
              aria-label="Bulk run actions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--lavender-soft)',
                border: '1px solid var(--lavender-border)',
                fontSize: '12.5px',
              }}
            >
              <strong>{selectedRunIds.length} run(s) selected</strong>
              <button
                type="button"
                onClick={() => {
                  if (onBulkCancel) onBulkCancel(selectedRunIds);
                  else selectedRunIds.forEach((id) => onCancelRun(id));
                  setNotice(`Cancelled ${selectedRunIds.length} selected run(s).`);
                  setSelectedRunIds([]);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--danger)',
                  backgroundColor: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Bulk Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onBulkRedrive) onBulkRedrive(selectedRunIds);
                  else selectedRunIds.forEach((id) => onRedriveRun(id));
                  setNotice(`Re-drove ${selectedRunIds.length} selected run(s).`);
                  setSelectedRunIds([]);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--brand)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--brand)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Bulk Re-drive
              </button>
              <button
                type="button"
                onClick={() => setSelectedRunIds([])}
                style={{
                  padding: '4px 8px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}

          {filteredRuns.length === 0 ? (
            <StateView
              state="empty"
              title="No runs yet"
              description="Start a durable run to inspect checkpoints, trace spans, and live SSE events."
              actionLabel="Start Durable Run"
              onAction={onStartSampleRun}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                aria-label="Runs list"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  fontSize: '12.5px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-raised)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <th style={{ padding: '10px', width: '32px' }}>
                      <input
                        type="checkbox"
                        aria-label="Select all runs"
                        checked={
                          filteredRuns.length > 0 &&
                          selectedRunIds.length === filteredRuns.length
                        }
                        onChange={(e) =>
                          setSelectedRunIds(
                            e.target.checked ? filteredRuns.map((r) => r.id) : [],
                          )
                        }
                      />
                    </th>
                    <th style={{ padding: '10px' }}>Run ID</th>
                    <th style={{ padding: '10px' }}>Agent / Workflow</th>
                    <th style={{ padding: '10px' }}>Status</th>
                    <th style={{ padding: '10px' }}>Env</th>
                    <th style={{ padding: '10px' }}>Trigger</th>
                    <th style={{ padding: '10px' }}>Initiator</th>
                    <th style={{ padding: '10px' }}>Duration</th>
                    <th style={{ padding: '10px' }}>Cost</th>
                    <th style={{ padding: '10px' }}>Failure</th>
                    <th style={{ padding: '10px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((run) => {
                    const checked = selectedRunIds.includes(run.id);
                    const durationMs = getRunDurationMs(run);
                    return (
                      <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px' }}>
                          <input
                            type="checkbox"
                            aria-label={`Select run ${run.id}`}
                            checked={checked}
                            onChange={(e) =>
                              setSelectedRunIds((prev) =>
                                e.target.checked
                                  ? [...prev, run.id]
                                  : prev.filter((id) => id !== run.id),
                              )
                            }
                          />
                        </td>
                        <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>{run.id}</td>
                        <td style={{ padding: '10px' }}>
                          <code>{run.subjectVersionId}</code>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <StatusChip label={run.status} tone={statusTone(run.status)} />
                        </td>
                        <td style={{ padding: '10px', textTransform: 'uppercase', fontWeight: 600 }}>
                          {environment}
                        </td>
                        <td style={{ padding: '10px' }}>{run.labels?.trigger ?? 'manual'}</td>
                        <td style={{ padding: '10px' }}>
                          <code>{run.initiatorId}</code>
                        </td>
                        <td style={{ padding: '10px' }}>{durationMs}ms</td>
                        <td style={{ padding: '10px' }}>
                          {formatMicroUsdAsUsd(microUsd(run.costMicroUsd), 5)}
                        </td>
                        <td style={{ padding: '10px', color: run.failureClass ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {run.failureClass ?? '—'}
                        </td>
                        <td style={{ padding: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => onSelectRun(run.id)}
                            style={{
                              minHeight: '28px',
                              padding: '4px 10px',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'var(--surface-raised)',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Inspect Trace
                          </button>
                          {(run.status === 'queued' || run.status === 'running') && (
                            <button
                              type="button"
                              onClick={() => onCancelRun(run.id)}
                              style={{
                                minHeight: '28px',
                                padding: '4px 10px',
                                border: '1px solid var(--danger)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--danger-bg)',
                                color: 'var(--danger)',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          )}
                          {(run.status === 'failed' || run.status === 'timed_out') && (
                            <button
                              type="button"
                              onClick={() => onRedriveRun(run.id)}
                              style={{
                                minHeight: '28px',
                                padding: '4px 10px',
                                border: '1px solid var(--brand)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--surface)',
                                color: 'var(--brand)',
                                cursor: 'pointer',
                              }}
                            >
                              Re-drive
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedRun && (
            <RunDetailWorkbench
              run={selectedRun}
              steps={selectedSteps}
              events={selectedEvents}
              selectedStepId={selectedStepId}
              environment={environment}
              client={client}
              renderTraceTree={() => (
                <VirtualizedTraceTree
                  steps={selectedSteps}
                  selectedStepId={selectedStepId}
                  onSelectStep={onSelectStep}
                />
              )}
              onSelectStep={onSelectStep}
              onCancelRun={onCancelRun}
              onRedriveRun={onRedriveRun}
              onReplayRun={onReplayRun}
              onForkFromStep={onForkFromStep}
              onSaveAsTestCase={onSaveAsTestCase}
            />
          )}
        </div>
      )}
    </div>
  );
}
