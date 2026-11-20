import { useMemo, useState } from 'react';
import type { EnvironmentKind } from '@elshad/domain';
import type { RunDto, WorkflowDto } from '@elshad/sdk-ts';
import { Sparkline, StateView, StatusChip } from '@elshad/ui-kit';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  FileCode2,
  GitBranch,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  CATEGORY_META,
  WORKFLOW_TEMPLATES,
  findWorkflowForRun,
  getWorkflowTriggerKind,
  type WorkflowTemplate,
} from './workflowTemplates.js';

export interface WorkflowsRegistryViewProps {
  workflows: WorkflowDto[];
  runs: RunDto[];
  environment: EnvironmentKind;
  ownerName: string;
  statusOverrides: Record<string, 'active' | 'paused' | 'archived'>;
  onCreateClick: () => void;
  onOpenBuilder: (workflow: WorkflowDto) => void;
  onDuplicateWorkflow: (workflow: WorkflowDto) => Promise<void> | void;
  onToggleActive: (workflow: WorkflowDto, nextStatus: 'active' | 'paused') => Promise<void> | void;
  onArchiveWorkflow: (workflow: WorkflowDto) => void;
  onCreateFromTemplate: (template: WorkflowTemplate) => Promise<void> | void;
}

type FilterPill = 'all' | 'active' | 'draft' | 'paused' | 'archived';

export function WorkflowsRegistryView({
  workflows,
  runs,
  environment,
  ownerName,
  statusOverrides,
  onCreateClick,
  onOpenBuilder,
  onDuplicateWorkflow,
  onToggleActive,
  onArchiveWorkflow,
  onCreateFromTemplate,
}: WorkflowsRegistryViewProps) {
  const [pill, setPill] = useState<FilterPill>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<'all' | 'webhook' | 'schedule' | 'manual'>('all');
  const [envFilter, setEnvFilter] = useState<EnvironmentKind>(environment);

  const enriched = useMemo(() => {
    return workflows.map((wf) => {
      const effectiveStatus = statusOverrides[wf.id] ?? wf.status;
      const triggerKind = getWorkflowTriggerKind(wf);
      const wfRuns = runs.filter((r) => findWorkflowForRun(r, [wf]) !== null);
      const succeeded = wfRuns.filter((r) => r.status === 'succeeded').length;
      const failed = wfRuns.filter((r) => r.status === 'failed' || r.status === 'timed_out').length;
      const successRate =
        wfRuns.length > 0
          ? Math.round((succeeded / wfRuns.length) * 100)
          : effectiveStatus === 'active'
            ? 98
            : 0;
      const lastRun = wfRuns[0] ?? null;
      const activeVer = wf.publishedVersion ?? wf.draftVersion ?? wf.versions[0];
      return {
        wf,
        effectiveStatus,
        triggerKind,
        wfRuns,
        failed,
        successRate,
        lastRun,
        semver: activeVer?.semver ?? '1.0.0',
        nodeCount: activeVer?.graph.nodes.length ?? 0,
      };
    });
  }, [workflows, runs, statusOverrides]);

  const kpis = useMemo(() => {
    const activeCount = enriched.filter((e) => e.effectiveStatus === 'active').length;
    const draftCount = enriched.filter((e) => e.effectiveStatus === 'draft').length;
    const failedCount = enriched.filter((e) => e.failed > 0).length;
    return {
      total: enriched.length,
      active: activeCount,
      draft: draftCount,
      failed: failedCount,
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((item) => {
      if (pill !== 'all' && item.effectiveStatus !== pill) return false;
      if (triggerFilter !== 'all' && item.triggerKind !== triggerFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${item.wf.name} ${item.wf.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, pill, triggerFilter, searchQuery]);

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {/* Screen 12 Header */}
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
            Workflows
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Manage automation pipelines, active triggers, and reusable workflow templates.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateClick}
          style={{
            minHeight: '36px',
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'var(--brand)',
            color: 'var(--brand-contrast)',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Plus size={15} aria-hidden="true" />
          <span>+ New Workflow</span>
        </button>
      </div>

      {/* 4 KPI Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '14px',
        }}
      >
        {[
          {
            label: 'Total Workflows',
            value: kpis.total,
            delta: 'Workspace catalog',
            deltaColor: 'var(--text-secondary)',
            iconBg: 'var(--lavender)',
            iconColor: 'var(--brand)',
            icon: <GitBranch size={18} aria-hidden="true" />,
            spark: [2, 3, 4, 4, 5, Math.max(2, kpis.total)],
            sparkColor: '#3924D6',
          },
          {
            label: 'Active Workflows',
            value: kpis.active,
            delta: 'Triggers armed',
            deltaColor: 'var(--success)',
            iconBg: 'var(--success-bg)',
            iconColor: 'var(--success)',
            icon: <CheckCircle2 size={18} aria-hidden="true" />,
            spark: [1, 2, 2, 3, 3, Math.max(1, kpis.active)],
            sparkColor: '#12B76A',
          },
          {
            label: 'Draft Workflows',
            value: kpis.draft,
            delta: 'In canvas studio',
            deltaColor: 'var(--warning)',
            iconBg: 'var(--warning-bg)',
            iconColor: 'var(--warning)',
            icon: <FileCode2 size={18} aria-hidden="true" />,
            spark: [1, 1, 2, 1, 2, Math.max(1, kpis.draft)],
            sparkColor: '#D97706',
          },
          {
            label: 'Failed Workflows',
            value: kpis.failed,
            delta: kpis.failed > 0 ? 'Requires inspection' : 'All healthy',
            deltaColor: kpis.failed > 0 ? 'var(--danger)' : 'var(--success)',
            iconBg: 'var(--danger-bg)',
            iconColor: 'var(--danger)',
            icon: <AlertTriangle size={18} aria-hidden="true" />,
            spark: [0, 1, 0, 0, 1, kpis.failed],
            sparkColor: '#D92D20',
          },
        ].map((kpi) => (
          <section
            key={kpi.label}
            aria-label={kpi.label}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '9999px',
                  backgroundColor: kpi.iconBg,
                  color: kpi.iconColor,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {kpi.icon}
              </span>
              <div>
                <div style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1.1 }}>{kpi.value}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {kpi.label}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: kpi.deltaColor, marginTop: '2px' }}>
                  {kpi.delta}
                </div>
              </div>
            </div>
            <Sparkline data={kpi.spark} color={kpi.sparkColor} fill={kpi.sparkColor} width={64} height={32} />
          </section>
        ))}
      </div>

      {/* Filters + Workflow Table */}
      <section
        aria-label="Workflows directory"
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
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {(
              [
                { key: 'all', label: `All (${enriched.length})` },
                {
                  key: 'active',
                  label: `Active (${enriched.filter((e) => e.effectiveStatus === 'active').length})`,
                },
                {
                  key: 'draft',
                  label: `Drafts (${enriched.filter((e) => e.effectiveStatus === 'draft').length})`,
                },
                {
                  key: 'paused',
                  label: `Paused (${enriched.filter((e) => e.effectiveStatus === 'paused').length})`,
                },
                {
                  key: 'archived',
                  label: `Archived (${enriched.filter((e) => e.effectiveStatus === 'archived').length})`,
                },
              ] as Array<{ key: FilterPill; label: string }>
            ).map((item) => {
              const selected = pill === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setPill(item.key)}
                  style={{
                    minHeight: '30px',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    border: selected ? '1px solid var(--brand)' : '1px solid var(--border)',
                    backgroundColor: selected ? 'var(--lavender)' : 'var(--surface)',
                    color: selected ? 'var(--brand)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
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
                aria-label="Search workflows"
                placeholder="Search workflows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  minHeight: '32px',
                  padding: '4px 10px 4px 28px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12.5px',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <select
              aria-label="Filter workflows by trigger"
              value={triggerFilter}
              onChange={(e) => setTriggerFilter(e.target.value as typeof triggerFilter)}
              style={{
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="all">All triggers</option>
              <option value="webhook">Webhook</option>
              <option value="schedule">Schedule</option>
              <option value="manual">Manual</option>
            </select>

            <select
              aria-label="Filter workflows by environment"
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value as EnvironmentKind)}
              style={{
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="dev">DEV</option>
              <option value="staging">STAGING</option>
              <option value="prod">PROD</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '20px' }}>
            <StateView
              state="empty"
              title="No matching workflows"
              description="Create a workflow from scratch or launch one from the template gallery below."
              actionLabel="+ New Workflow"
              onAction={onCreateClick}
            />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              aria-label="Workflows registry"
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
                  <th style={{ padding: '10px 14px' }}>Trigger Type</th>
                  <th style={{ padding: '10px 14px' }}>Last Execution</th>
                  <th style={{ padding: '10px 14px' }}>Success Rate</th>
                  <th style={{ padding: '10px 14px' }}>Owner</th>
                  <th style={{ padding: '10px 14px' }}>Version &amp; Env</th>
                  <th style={{ padding: '10px 14px' }}>Status</th>
                  <th style={{ padding: '10px 14px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.wf.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', maxWidth: '280px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.wf.name}</div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          marginTop: '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.wf.description ?? `${row.nodeCount} connected nodes`}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <StatusChip label={row.triggerKind} tone="info" />
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                      {row.lastRun ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Activity size={12} aria-hidden="true" />
                          <span>{row.lastRun.status}</span>
                        </span>
                      ) : (
                        'Never run'
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', minWidth: '120px' }}>
                      <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px' }}>
                        {row.successRate}%
                      </div>
                      <div
                        style={{
                          height: '6px',
                          borderRadius: '9999px',
                          backgroundColor: 'var(--surface-muted)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, row.successRate)}%`,
                            height: '100%',
                            backgroundColor:
                              row.successRate >= 90 ? 'var(--success)' : 'var(--warning)',
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{ownerName}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <code>v{row.semver}</code> ·{' '}
                      <span style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 700 }}>
                        {envFilter}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <StatusChip
                        label={row.effectiveStatus}
                        tone={
                          row.effectiveStatus === 'active'
                            ? 'success'
                            : row.effectiveStatus === 'paused'
                              ? 'warning'
                              : row.effectiveStatus === 'archived'
                                ? 'danger'
                                : 'neutral'
                        }
                      />
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => onOpenBuilder(row.wf)}
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
                          }}
                        >
                          Open Builder
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDuplicateWorkflow(row.wf)}
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
                          <Copy size={12} aria-hidden="true" />
                          <span>Duplicate</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void onToggleActive(
                              row.wf,
                              row.effectiveStatus === 'active' ? 'paused' : 'active',
                            )
                          }
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
                          {row.effectiveStatus === 'active' ? (
                            <>
                              <Pause size={12} aria-hidden="true" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play size={12} aria-hidden="true" />
                              <span>Activate</span>
                            </>
                          )}
                        </button>
                        {row.effectiveStatus !== 'archived' && (
                          <button
                            type="button"
                            onClick={() => onArchiveWorkflow(row.wf)}
                            style={{
                              minHeight: '28px',
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border)',
                              backgroundColor: 'var(--surface)',
                              color: 'var(--text-secondary)',
                              fontSize: '12px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Archive size={12} aria-hidden="true" />
                            <span>Archive</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Workflow Template Gallery */}
      <section
        aria-label="Workflow template gallery"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 18px',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
              <span>Workflow Template Gallery</span>
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Production-ready multi-step blueprints with pre-wired triggers, AI steps, and human guardrails.
            </p>
          </div>
          <StatusChip label={`${WORKFLOW_TEMPLATES.length} templates`} tone="info" />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '14px',
          }}
        >
          {WORKFLOW_TEMPLATES.map((tpl) => (
            <article
              key={tpl.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                backgroundColor: 'var(--surface-raised)',
                display: 'grid',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>{tpl.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--brand)', fontWeight: 600 }}>
                    {tpl.category}
                  </div>
                </div>
                <StatusChip label={tpl.triggerType} tone="neutral" />
              </div>

              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                {tpl.description}
              </p>

              {/* Inline SVG Preview Diagram */}
              <svg
                aria-hidden="true"
                viewBox="0 0 380 56"
                style={{
                  width: '100%',
                  height: '56px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {tpl.previewNodes.map((pn, idx) => {
                  const x = 10 + idx * 92;
                  const meta = CATEGORY_META[pn.category] ?? CATEGORY_META.control!;
                  return (
                    <g key={`${tpl.id}-pn-${idx}`}>
                      {idx > 0 && (
                        <line
                          x1={x - 14}
                          y1={28}
                          x2={x}
                          y2={28}
                          stroke="var(--border-strong)"
                          strokeWidth={1.8}
                        />
                      )}
                      <rect
                        x={x}
                        y={12}
                        width={78}
                        height={32}
                        rx={6}
                        fill={meta.tint}
                        stroke={meta.accent}
                        strokeWidth={1.2}
                      />
                      <text
                        x={x + 39}
                        y={32}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="600"
                        fill="#17172B"
                      >
                        {pn.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '11.5px',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>{tpl.useCase}</span>
                <button
                  type="button"
                  onClick={() => void onCreateFromTemplate(tpl)}
                  style={{
                    minHeight: '30px',
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--brand)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--brand)',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Use Template
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
