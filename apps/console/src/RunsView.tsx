import { useMemo, useState } from 'react';
import { formatMicroUsdAsUsd, microUsd, type RunStatus } from '@elshad/domain';
import type { DlqItemDto, RunDto, RunEventDto, RunStepDto } from '@elshad/sdk-ts';
import { StateView, StatusChip, type BadgeTone } from '@elshad/ui-kit';

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

export interface RunsViewProps {
  runs: readonly RunDto[];
  dlqItems: readonly DlqItemDto[];
  loading: boolean;
  error: { message: string; code?: string } | null;
  selectedRun: RunDto | null;
  selectedSteps: readonly RunStepDto[];
  selectedEvents: readonly RunEventDto[];
  selectedStepId?: string;
  onRefresh: () => void;
  onStartSampleRun: () => void;
  onSelectRun: (runId: string) => void;
  onSelectStep: (step: RunStepDto) => void;
  onCancelRun: (runId: string) => void;
  onRedriveRun: (runId: string) => void;
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
  onRefresh,
  onStartSampleRun,
  onSelectRun,
  onSelectStep,
  onCancelRun,
  onRedriveRun,
  onSaveAsTestCase,
}: RunsViewProps) {
  const [tab, setTab] = useState<'runs' | 'dlq'>('runs');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredRuns = useMemo(() => {
    if (statusFilter === 'all') return runs;
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <h1 style={{ margin: 0, fontSize: '22px' }}>Runs &amp; Traces</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setTab('runs')}
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: tab === 'runs' ? 'var(--info-bg)' : 'var(--surface-raised)',
              color: 'var(--text-primary)',
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
              backgroundColor: tab === 'dlq' ? 'var(--danger-bg)' : 'var(--surface-raised)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            DLQ ({dlqItems.length})
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
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="run-status-filter" style={{ fontWeight: 600 }}>
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
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="all">All statuses</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>

          {filteredRuns.length === 0 ? (
            <StateView
              state="empty"
              title="No runs yet"
              description="Start a durable run to inspect checkpoints, trace spans, and live SSE events."
              actionLabel="Start Durable Run"
              onAction={onStartSampleRun}
            />
          ) : (
            <table
              aria-label="Runs list"
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
                  <th style={{ padding: '10px' }}>Status</th>
                  <th style={{ padding: '10px' }}>Steps</th>
                  <th style={{ padding: '10px' }}>Cost</th>
                  <th style={{ padding: '10px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>{run.id}</td>
                    <td style={{ padding: '10px' }}>
                      <StatusChip label={run.status} tone={statusTone(run.status)} />
                    </td>
                    <td style={{ padding: '10px' }}>{run.usage.steps}</td>
                    <td style={{ padding: '10px' }}>
                      {formatMicroUsdAsUsd(microUsd(run.costMicroUsd), 5)}
                    </td>
                    <td style={{ padding: '10px', display: 'flex', gap: '8px' }}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedRun && (
            <section
              aria-label="Run detail"
              style={{
                padding: '16px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                display: 'grid',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0, fontSize: '16px' }}>
                  Run Trace: <code>{selectedRun.id}</code>
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {onSaveAsTestCase && (
                    <button
                      type="button"
                      onClick={() => onSaveAsTestCase(selectedRun)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--brand)',
                        color: 'var(--brand-contrast)',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Save as Test Case
                    </button>
                  )}
                  <StatusChip label={`${selectedEvents.length} events`} tone="info" />
                  <StatusChip label={selectedRun.status} tone={statusTone(selectedRun.status)} />
                </div>
              </div>

              <VirtualizedTraceTree
                steps={selectedSteps}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
