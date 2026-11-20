import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatMicroUsdAsUsd, microUsd, type EnvironmentKind, type RunStatus } from '@elshad/domain';
import type {
  AgentMessageDto,
  ApprovalDto,
  FailureExplanationDto,
  MemoryItemDto,
  PlatformClient,
  RunDto,
  RunEventDto,
  RunStepDto,
  UsageLedgerEntryDto,
} from '@elshad/sdk-ts';
import { StatusChip, SuccessNotice, type BadgeTone } from '@elshad/ui-kit';
import {
  AlertTriangle,
  Copy,
  Download,
  GitFork,
  RotateCcw,
  Share2,
  Sparkles,
  Square,
} from 'lucide-react';

export interface RunDetailWorkbenchProps {
  run: RunDto;
  steps: readonly RunStepDto[];
  events: readonly RunEventDto[];
  selectedStepId?: string;
  environment?: EnvironmentKind;
  client?: PlatformClient;
  renderTraceTree: () => ReactNode;
  onSelectStep: (step: RunStepDto) => void;
  onCancelRun: (runId: string) => void;
  onRedriveRun: (runId: string) => void;
  onReplayRun?: (run: RunDto) => void;
  onForkFromStep?: (run: RunDto, stepSeq: number) => void;
  onSaveAsTestCase?: (run: RunDto) => void;
}

type RunDetailTab =
  | 'trace'
  | 'timeline'
  | 'graph'
  | 'messages'
  | 'cost'
  | 'memory'
  | 'approvals'
  | 'raw';

const DETAIL_TABS: Array<{ key: RunDetailTab; label: string }> = [
  { key: 'trace', label: 'Trace' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'graph', label: 'Graph' },
  { key: 'messages', label: 'Messages' },
  { key: 'cost', label: 'Cost' },
  { key: 'memory', label: 'Memory' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'raw', label: 'Raw' },
];

function detailStatusTone(status: RunStatus | string): BadgeTone {
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

function getDurationMs(run: RunDto): number {
  if (run.startedAt && run.endedAt) {
    const diff = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    if (Number.isFinite(diff) && diff >= 0) return diff;
  }
  return 0;
}

function buildFallbackExplanation(
  run: RunDto,
  steps: readonly RunStepDto[],
): FailureExplanationDto {
  const sample = steps.slice(0, 60);
  const failing = sample.find((s) => s.status === 'failed') ?? sample[sample.length - 1];
  const isFailure =
    run.status === 'failed' ||
    run.status === 'timed_out' ||
    run.status === 'budget_exceeded' ||
    run.status === 'policy_blocked';
  return {
    runId: run.id,
    status: run.status,
    failureClass: run.failureClass ?? (isFailure ? 'runtime_error' : 'diagnostic_check'),
    rootCause: isFailure
      ? run.terminationReason ??
        `Step #${failing?.seq ?? 1} (${failing?.type ?? 'execution'}) terminated unexpectedly.`
      : `Execution completed with status "${run.status}". No runtime errors were detected across ${steps.length} checkpointed step(s).`,
    failingStepSeq: failing?.seq ?? null,
    failingStepType: failing?.type ?? null,
    remediation: isFailure
      ? [
          'Inspect tool/model timeout & exponential retry settings on the failing step.',
          'Verify scoped credentials and egress allowlists in the target environment.',
          'Pin upstream output and re-drive or fork directly from the failed checkpoint.',
        ]
      : [
          'Review token and latency distributions in Cost & Timeline tabs for optimization.',
          'Promote this verified trace to an evaluation test case.',
        ],
  };
}

export function RunDetailWorkbench({
  run,
  steps,
  events,
  selectedStepId,
  environment = 'dev',
  client,
  renderTraceTree,
  onSelectStep,
  onCancelRun,
  onRedriveRun,
  onReplayRun,
  onForkFromStep,
  onSaveAsTestCase,
}: RunDetailWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<RunDetailTab>('trace');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [explainerOpen, setExplainerOpen] = useState<boolean>(
    run.status === 'failed' ||
      run.status === 'timed_out' ||
      run.status === 'budget_exceeded' ||
      run.status === 'policy_blocked',
  );
  const [explanation, setExplanation] = useState<FailureExplanationDto | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessageDto[]>([]);
  const [usageLedger, setUsageLedger] = useState<UsageLedgerEntryDto[]>([]);
  const [memoryItems, setMemoryItems] = useState<MemoryItemDto[]>([]);
  const [runApprovals, setRunApprovals] = useState<ApprovalDto[]>([]);

  const selectedStep = useMemo(() => {
    if (!selectedStepId) return steps[0] ?? null;
    for (let i = 0; i < Math.min(steps.length, 500); i += 1) {
      if (steps[i]?.id === selectedStepId) return steps[i] ?? null;
    }
    return steps.find((s) => s.id === selectedStepId) ?? steps[0] ?? null;
  }, [steps, selectedStepId]);

  useEffect(() => {
    setExplanation(null);
    setExplainerOpen(
      run.status === 'failed' ||
        run.status === 'timed_out' ||
        run.status === 'budget_exceeded' ||
        run.status === 'policy_blocked',
    );
  }, [run.id, run.status]);

  // Lazy load supplementary tab data only when that tab is activated
  useEffect(() => {
    if (!client) return;
    if (activeTab === 'messages') {
      void client.runs.getAgentMessages(run.id).then(setAgentMessages).catch(() => setAgentMessages([]));
    } else if (activeTab === 'cost') {
      void client.runs
        .listUsageLedger(run.id)
        .then((res) => setUsageLedger(res.data))
        .catch(() => setUsageLedger([]));
    } else if (activeTab === 'memory') {
      void client.memory
        .list({ limit: 8 })
        .then((res) => setMemoryItems(res.items))
        .catch(() => setMemoryItems([]));
    } else if (activeTab === 'approvals') {
      void client.approvals
        .list()
        .then((list) => setRunApprovals(list.filter((a) => a.runId === run.id)))
        .catch(() => setRunApprovals([]));
    }
  }, [activeTab, client, run.id]);

  // Bounded slices for non-virtualized visual tabs (keeps 5,000-span traces fast)
  const timelineSlice = useMemo(
    () => (activeTab === 'timeline' ? steps.slice(0, 80) : []),
    [activeTab, steps],
  );
  const graphSlice = useMemo(
    () => (activeTab === 'graph' ? steps.slice(0, 18) : []),
    [activeTab, steps],
  );
  const costBreakdown = useMemo(() => {
    if (activeTab !== 'cost') return [];
    const byType = new Map<string, { category: string; count: number; costMicroUsd: number; tokens: number }>();
    const bounded = steps.slice(0, 200);
    for (const s of bounded) {
      const prev = byType.get(s.type) ?? { category: s.type, count: 0, costMicroUsd: 0, tokens: 0 };
      prev.count += 1;
      prev.costMicroUsd += s.costMicroUsd;
      prev.tokens += s.tokensIn + s.tokensOut;
      byType.set(s.type, prev);
    }
    return Array.from(byType.values());
  }, [activeTab, steps]);

  const effectiveExplanation = useMemo(
    () => explanation ?? buildFallbackExplanation(run, steps),
    [explanation, run, steps],
  );

  async function handleExplainFailure() {
    setExplainerOpen(true);
    if (client?.observability?.explainFailure) {
      try {
        const res = await client.observability.explainFailure(run.id);
        setExplanation(res);
        return;
      } catch {
        // Fall through to deterministic summary
      }
    }
    setExplanation(buildFallbackExplanation(run, steps));
  }

  function handleExportTrace() {
    const payload = JSON.stringify(
      { run, events, stepsCount: steps.length, steps: steps.slice(0, 200) },
      null,
      2,
    );
    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof navigator !== 'undefined' &&
      !navigator.userAgent.includes('jsdom')
    ) {
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${run.id}-trace.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setActionNotice(`Exported trace JSON for ${run.id}.`);
  }

  const totalDurationMs = getDurationMs(run);
  const isActive =
    run.status === 'running' ||
    run.status === 'queued' ||
    run.status === 'waiting_approval' ||
    run.status === 'waiting_input';

  return (
    <section
      aria-label="Run detail"
      style={{
        padding: '16px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
        display: 'grid',
        gap: '14px',
      }}
    >
      {/* Header Metadata & Primary Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '12px',
        }}
      >
        <div style={{ display: 'grid', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '17px' }}>
              Run Trace: <code>{run.id}</code>
            </h2>
            <StatusChip label={run.status} tone={detailStatusTone(run.status)} />
            <StatusChip label={`${events.length} events`} tone="info" />
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '14px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              Duration: <strong>{totalDurationMs}ms</strong>
            </span>
            <span>
              Total Cost: <strong>{formatMicroUsdAsUsd(microUsd(run.costMicroUsd), 5)}</strong>
            </span>
            <span>
              Version: <code>{run.subjectType}</code> · <code>{run.subjectVersionId}</code>
            </span>
            <span>
              Trigger: <strong>{run.labels?.trigger ?? 'manual'}</strong>
            </span>
            <span>
              Initiator: <code>{run.initiatorId}</code>
            </span>
            <span>
              Env: <strong style={{ textTransform: 'uppercase' }}>{environment}</strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              onReplayRun?.(run);
              setActionNotice(`Queued replay of run ${run.id}.`);
            }}
            style={{
              minHeight: '30px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RotateCcw size={12} aria-hidden="true" />
            <span>Replay</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const seq = selectedStep?.seq ?? 1;
              onForkFromStep?.(run, seq);
              setActionNotice(`Forked run from checkpoint #${seq}.`);
            }}
            style={{
              minHeight: '30px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <GitFork size={12} aria-hidden="true" />
            <span>Fork from Step</span>
          </button>

          {isActive && (
            <button
              type="button"
              onClick={() => onCancelRun(run.id)}
              style={{
                minHeight: '30px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--danger)',
                backgroundColor: 'var(--danger-bg)',
                color: 'var(--danger)',
                fontSize: '12px',
                fontWeight: 600,
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
            onClick={() => {
              onRedriveRun(run.id);
              setActionNotice(`Submitted re-drive for run ${run.id}.`);
            }}
            style={{
              minHeight: '30px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Re-drive Run
          </button>

          {onSaveAsTestCase && (
            <button
              type="button"
              onClick={() => onSaveAsTestCase(run)}
              style={{
                minHeight: '30px',
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

          <button
            type="button"
            onClick={() => {
              const url =
                typeof window !== 'undefined' ? window.location.href : `/runs/${run.id}`;
              if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(url).catch(() => {});
              }
              setActionNotice(`Copied run share link for ${run.id}.`);
            }}
            style={{
              minHeight: '30px',
              padding: '4px 9px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Share2 size={12} aria-hidden="true" />
            <span>Share</span>
          </button>

          <button
            type="button"
            onClick={handleExportTrace}
            style={{
              minHeight: '30px',
              padding: '4px 9px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Download size={12} aria-hidden="true" />
            <span>Export</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExplainFailure()}
            style={{
              minHeight: '30px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--lavender-border)',
              backgroundColor: 'var(--lavender-soft)',
              color: 'var(--brand)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={12} aria-hidden="true" />
            <span>Explain Failure</span>
          </button>
        </div>
      </div>

      {actionNotice && <SuccessNotice message={actionNotice} />}

      {/* 8-Tab Run Detail Inspector */}
      <div
        role="tablist"
        aria-label="Run detail tabs"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '8px',
        }}
      >
        {DETAIL_TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                border: active ? '1px solid var(--brand)' : '1px solid var(--border)',
                backgroundColor: active ? 'var(--lavender)' : 'var(--surface-raised)',
                color: active ? 'var(--brand)' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        aria-label={DETAIL_TABS.find((t) => t.key === activeTab)?.label ?? 'Trace'}
        style={{ display: 'grid', gap: '12px' }}
      >
        {activeTab === 'trace' && (
          <>
            {renderTraceTree()}
            {selectedStep && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--lavender-border)',
                  backgroundColor: 'var(--lavender-soft)',
                  display: 'grid',
                  gap: '6px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <strong>
                    Selected Span #{selectedStep.seq} ({selectedStep.type})
                  </strong>
                  <span>
                    Tokens: {selectedStep.tokensIn} in / {selectedStep.tokensOut} out ·{' '}
                    {selectedStep.latencyMs}ms ·{' '}
                    {formatMicroUsdAsUsd(microUsd(selectedStep.costMicroUsd), 5)}
                  </span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--obsidian)',
                    color: '#E2E8F0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(selectedStep.summary, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}

        {activeTab === 'timeline' && (
          <div style={{ display: 'grid', gap: '6px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Gantt span timeline (first {timelineSlice.length} of {steps.length} spans)
            </div>
            {timelineSlice.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                No spans recorded for timeline display.
              </div>
            ) : (
              (() => {
                const maxLat = Math.max(
                  1,
                  timelineSlice.reduce((sum, s) => sum + Math.max(1, s.latencyMs), 0),
                );
                let offset = 0;
                return timelineSlice.map((step) => {
                  const widthPct = Math.max(4, Math.round((Math.max(1, step.latencyMs) / maxLat) * 100));
                  const leftPct = Math.min(94, Math.round((offset / maxLat) * 100));
                  offset += Math.max(1, step.latencyMs);
                  return (
                    <button
                      key={`tl-${step.id}`}
                      type="button"
                      onClick={() => onSelectStep(step)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '180px 1fr 70px',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        textAlign: 'left',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        #{step.seq} {step.type}
                      </span>
                      <div
                        style={{
                          height: '12px',
                          backgroundColor: 'var(--surface)',
                          borderRadius: '9999px',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: 0,
                            bottom: 0,
                            borderRadius: '9999px',
                            backgroundColor:
                              step.status === 'failed' ? 'var(--danger)' : 'var(--brand)',
                          }}
                        />
                      </div>
                      <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {step.latencyMs}ms
                      </span>
                    </button>
                  );
                });
              })()
            )}
          </div>
        )}

        {activeTab === 'graph' && (
          <div style={{ display: 'grid', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Execution path ({graphSlice.length} step nodes shown)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {graphSlice.map((step, idx) => (
                <div key={`gr-${step.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  {idx > 0 && <span aria-hidden="true">→</span>}
                  <button
                    type="button"
                    onClick={() => onSelectStep(step)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border:
                        step.status === 'failed'
                          ? '2px solid var(--danger)'
                          : '1.5px solid var(--success)',
                      backgroundColor:
                        step.status === 'failed' ? 'var(--danger-bg)' : 'var(--success-bg)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    #{step.seq} {step.type} ({step.latencyMs}ms)
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div style={{ display: 'grid', gap: '8px', fontSize: '12px' }}>
            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
              <strong>Run Input:</strong>{' '}
              <code>{JSON.stringify(run.input)}</code>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
              <strong>Run Output:</strong>{' '}
              <code>{JSON.stringify(run.output)}</code>
            </div>
            {agentMessages.length > 0 && (
              <div style={{ display: 'grid', gap: '4px' }}>
                <strong>Inter-Agent Messages ({agentMessages.length}):</strong>
                {agentMessages.map((m) => (
                  <div key={m.id} style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                    <code>{m.senderAgentId}</code> → <code>{m.receiverAgentId}</code> [{m.purpose}]
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'cost' && (
          <div style={{ display: 'grid', gap: '8px', fontSize: '12.5px' }}>
            <div>
              <strong>Total Run Cost:</strong> {formatMicroUsdAsUsd(microUsd(run.costMicroUsd), 5)} ·{' '}
              <strong>Tokens:</strong> {run.usage.tokensIn} in / {run.usage.tokensOut} out
            </div>
            {usageLedger.length > 0 && (
              <div>Usage Ledger entries recorded: {usageLedger.length}</div>
            )}
            <table aria-label="Run cost breakdown" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '6px' }}>Category</th>
                  <th style={{ padding: '6px' }}>Steps</th>
                  <th style={{ padding: '6px' }}>Tokens</th>
                  <th style={{ padding: '6px' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {costBreakdown.map((item) => (
                  <tr key={item.category} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px' }}>{item.category}</td>
                    <td style={{ padding: '6px' }}>{item.count}</td>
                    <td style={{ padding: '6px' }}>{item.tokens}</td>
                    <td style={{ padding: '6px' }}>{formatMicroUsdAsUsd(microUsd(item.costMicroUsd), 5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'memory' && (
          <div style={{ display: 'grid', gap: '6px', fontSize: '12px' }}>
            <div style={{ color: 'var(--text-secondary)' }}>
              Recent workspace memory reads/writes ({memoryItems.length} sampled):
            </div>
            {memoryItems.length === 0 ? (
              <div>No memory items modified during this run.</div>
            ) : (
              memoryItems.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: '6px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <span>{m.content}</span>
                  <StatusChip label={`${m.scope} · ${m.sensitivity}`} tone="neutral" />
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'approvals' && (
          <div style={{ display: 'grid', gap: '6px', fontSize: '12px' }}>
            {runApprovals.length === 0 ? (
              <div>No human approvals were triggered by this run.</div>
            ) : (
              runApprovals.map((apr) => (
                <div
                  key={apr.id}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <strong>{apr.payload.title}</strong>
                  <StatusChip label={apr.status} tone={apr.status === 'approved' ? 'success' : 'warning'} />
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div style={{ display: 'grid', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  const text = JSON.stringify({ run, events, stepsSample: steps.slice(0, 50) }, null, 2);
                  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(text).catch(() => {});
                  }
                  setActionNotice('Copied raw execution JSON to clipboard.');
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface-raised)',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Copy size={11} aria-hidden="true" />
                <span>Copy JSON</span>
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: '10px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--obsidian)',
                color: '#E2E8F0',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                maxHeight: '280px',
                overflow: 'auto',
              }}
            >
              {JSON.stringify({ run, events, stepsCount: steps.length, stepsSample: steps.slice(0, 25) }, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Contextual AI-Assisted Failure Explainer Panel */}
      {explainerOpen && (
        <section
          aria-label="Failure explainer"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--lavender-border)',
            backgroundColor: 'var(--lavender-soft)',
            display: 'grid',
            gap: '8px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--brand)' }}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span>AI Failure Explainer</span>
            </strong>
            <button
              type="button"
              onClick={() => setExplainerOpen(false)}
              style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
          <div>
            <strong>What failed:</strong> <code>{effectiveExplanation.failureClass}</code> ({effectiveExplanation.status})
          </div>
          <div>
            <strong>Where it failed:</strong>{' '}
            {effectiveExplanation.failingStepSeq
              ? `Step #${effectiveExplanation.failingStepSeq} (${effectiveExplanation.failingStepType ?? 'step'})`
              : 'Run lifecycle envelope'}
          </div>
          <div>
            <strong>Why it likely failed:</strong> {effectiveExplanation.rootCause}
          </div>
          <div>
            <strong>Configuration to review:</strong> Timeout thresholds, retry backoff, and tool egress policies.
          </div>
          <div>
            <strong>Suggested remediation:</strong>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: '18px' }}>
              {effectiveExplanation.remediation.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </section>
  );
}
