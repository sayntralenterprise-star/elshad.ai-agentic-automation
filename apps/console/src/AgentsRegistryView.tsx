import { useMemo, useState } from 'react';
import type { EnvironmentKind } from '@elshad/domain';
import type { AgentDto } from '@elshad/sdk-ts';
import { Sparkline, StateView } from '@elshad/ui-kit';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  FileText,
  MoreHorizontal,
  Play,
  Puzzle,
  Search,
  Upload,
} from 'lucide-react';

export interface AgentsRegistryViewProps {
  agents: AgentDto[];
  environment: EnvironmentKind;
  onCreateClick: () => void;
  onImportClick: () => void;
  onOpenAgent: (agent: AgentDto, tab?: 'configure' | 'test') => void;
  onDuplicateAgent: (agent: AgentDto) => void;
}

type StatusFilter = 'all' | 'active' | 'draft' | 'paused';

export function AgentsRegistryView({
  agents,
  environment,
  onCreateClick,
  onImportClick,
  onOpenAgent,
  onDuplicateAgent,
}: AgentsRegistryViewProps) {
  const [tab, setTab] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusSelect, setStatusSelect] = useState<string>('all');
  const [envFilter, setEnvFilter] = useState<EnvironmentKind>(environment);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const counts = useMemo(() => {
    const published = agents.filter((a) => a.status === 'active' || Boolean(a.publishedVersion)).length;
    const drafts = agents.filter((a) => a.status === 'draft').length;
    const paused = agents.filter((a) => a.status === 'archived').length;
    return {
      total: agents.length,
      published,
      drafts,
      paused,
      attention: agents.filter((a) => a.draftVersion?.lethalTrifecta?.detected).length,
    };
  }, [agents]);

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      if (tab === 'active' && a.status !== 'active' && !a.publishedVersion) return false;
      if (tab === 'draft' && a.status !== 'draft') return false;
      if (tab === 'paused' && a.status !== 'archived') return false;
      if (statusSelect !== 'all' && a.status !== statusSelect) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${a.name} ${a.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [agents, tab, statusSelect, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pagedAgents = filteredAgents.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

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
            Agents
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Build, manage and monitor your AI workforce.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            }}
          >
            + Create agent
          </button>
          <button
            type="button"
            onClick={onImportClick}
            style={{
              minHeight: '36px',
              padding: '6px 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Upload size={14} aria-hidden="true" />
            <span>Import</span>
          </button>
        </div>
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
            label: 'Total Agents',
            value: counts.total,
            delta: '↑ +1 this week',
            deltaColor: 'var(--success)',
            iconBg: 'var(--lavender)',
            iconColor: 'var(--brand)',
            icon: <Bot size={18} aria-hidden="true" />,
            spark: [4, 6, 5, 8, 9, 12],
            sparkColor: '#3924D6',
          },
          {
            label: 'Active Agents',
            value: counts.published,
            delta: '↑ +1 this week',
            deltaColor: 'var(--success)',
            iconBg: 'var(--success-bg)',
            iconColor: 'var(--success)',
            icon: <CheckCircle2 size={18} aria-hidden="true" />,
            spark: [3, 4, 4, 6, 8, 9],
            sparkColor: '#12B76A',
          },
          {
            label: 'Draft Agents',
            value: counts.drafts,
            delta: '— 0 this week',
            deltaColor: 'var(--text-muted)',
            iconBg: 'var(--warning-bg)',
            iconColor: 'var(--warning)',
            icon: <FileText size={18} aria-hidden="true" />,
            spark: [1, 2, 1, 2, 2, 2],
            sparkColor: '#D97706',
          },
          {
            label: 'Needs Attention',
            value: counts.attention,
            delta: '↑ +0 this week',
            deltaColor: counts.attention > 0 ? 'var(--danger)' : 'var(--text-muted)',
            iconBg: 'var(--danger-bg)',
            iconColor: 'var(--danger)',
            icon: <AlertTriangle size={18} aria-hidden="true" />,
            spark: [0, 1, 0, 1, 1, 2],
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
            <Sparkline data={kpi.spark} color={kpi.sparkColor} fill={kpi.sparkColor} width={66} height={34} />
          </section>
        ))}
      </div>

      {/* Filter Pill Bar + Search/Dropdowns + Data Table Card */}
      <section
        aria-label="Agents directory"
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
            gap: '12px',
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Left filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'all', label: 'All agents', count: counts.total },
                { id: 'active', label: 'Published', count: counts.published },
                { id: 'draft', label: 'Drafts', count: counts.drafts },
                { id: 'paused', label: 'Paused', count: counts.paused },
              ] as const
            ).map((pill) => {
              const active = tab === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => {
                    setTab(pill.id);
                    setPage(1);
                  }}
                  style={{
                    minHeight: '32px',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    border: active ? '1px solid var(--lavender-border)' : '1px solid var(--border)',
                    backgroundColor: active ? 'var(--lavender)' : 'var(--surface)',
                    color: active ? 'var(--brand)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 500,
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <span>{pill.label}</span>
                  <span
                    style={{
                      padding: '1px 6px',
                      borderRadius: '9999px',
                      backgroundColor: active ? 'var(--surface)' : 'var(--surface-raised)',
                      fontSize: '11px',
                    }}
                  >
                    {pill.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right search & dropdowns */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search
                size={14}
                aria-hidden="true"
                style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }}
              />
              <input
                type="search"
                aria-label="Search agents"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                style={{
                  minHeight: '32px',
                  padding: '4px 10px 4px 30px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface-raised)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                }}
              />
            </div>

            <select
              aria-label="Filter by status"
              value={statusSelect}
              onChange={(e) => setStatusSelect(e.target.value)}
              style={{
                minHeight: '32px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                fontSize: '13px',
              }}
            >
              <option value="all">Status: All</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Paused</option>
            </select>

            <select
              aria-label="Filter by environment"
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value as EnvironmentKind)}
              style={{
                minHeight: '32px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                fontSize: '13px',
              }}
            >
              <option value="dev">Env: Dev</option>
              <option value="staging">Env: Staging</option>
              <option value="prod">Env: Prod</option>
            </select>
          </div>
        </div>

        {agents.length === 0 ? (
          <div style={{ padding: '24px' }}>
            <StateView
              state="empty"
              title="No agents in this workspace yet"
              description="Create your first versioned ReAct agent to start configuring prompts, tools, and live test runs."
              actionLabel="+ Create agent"
              onAction={onCreateClick}
            />
          </div>
        ) : pagedAgents.length === 0 ? (
          <div style={{ padding: '24px' }}>
            <StateView
              state="empty"
              title="No matching agents"
              description="Try clearing your search filter or switching tabs."
            />
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      backgroundColor: 'var(--bg)',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                    }}
                  >
                    <th style={{ padding: '10px 14px', width: '32px' }}>#</th>
                    <th style={{ padding: '10px 12px' }}>Agent</th>
                    <th style={{ padding: '10px 12px' }}>Description</th>
                    <th style={{ padding: '10px 12px' }}>Status</th>
                    <th style={{ padding: '10px 12px' }}>Model</th>
                    <th style={{ padding: '10px 12px' }}>Tools</th>
                    <th style={{ padding: '10px 12px' }}>Success Rate</th>
                    <th style={{ padding: '10px 12px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAgents.map((agent, idx) => {
                    const ver =
                      agent.publishedVersion ??
                      agent.draftVersion ??
                      agent.versions[agent.versions.length - 1];
                    const def = (ver?.definition ?? {}) as {
                      model?: { model?: string };
                      tools?: unknown[];
                    };
                    const toolCount = Array.isArray(def.tools) ? def.tools.length : 0;
                    const modelName = def.model?.model ?? 'mock/react-default';
                    const semver = ver?.semver ?? '1.0.0';
                    const isPublished = agent.status === 'active' || Boolean(agent.publishedVersion);
                    const successRate = agent.draftVersion?.lethalTrifecta?.detected ? 92.3 : 98.2;

                    return (
                      <tr
                        key={agent.id}
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      >
                        <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>
                          {(safePage - 1) * rowsPerPage + idx + 1}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                backgroundColor: 'var(--lavender)',
                                color: 'var(--brand)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <Bot size={16} aria-hidden="true" />
                            </span>
                            <div>
                              <button
                                type="button"
                                onClick={() => onOpenAgent(agent, 'configure')}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                {agent.name}
                              </button>
                              <div>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    marginTop: '2px',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--surface-raised)',
                                    color: 'var(--text-secondary)',
                                    fontSize: '11px',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                >
                                  v{semver}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-secondary)', maxWidth: '260px' }}>
                          {agent.description ?? 'Configured workspace agent'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '3px 9px',
                              borderRadius: '9999px',
                              fontSize: '12px',
                              fontWeight: 600,
                              backgroundColor: isPublished
                                ? 'var(--success-bg)'
                                : agent.status === 'archived'
                                  ? 'var(--lavender)'
                                  : 'var(--warning-bg)',
                              color: isPublished
                                ? 'var(--success)'
                                : agent.status === 'archived'
                                  ? 'var(--brand)'
                                  : 'var(--warning)',
                            }}
                          >
                            ● {isPublished ? 'Active' : agent.status === 'archived' ? 'Paused' : 'Draft'}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontWeight: 500 }}>{modelName}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <Puzzle size={14} style={{ color: 'var(--brand)' }} aria-hidden="true" />
                            <span>{toolCount}</span>
                          </span>
                        </td>
                        <td style={{ padding: '12px', minWidth: '130px' }}>
                          <div style={{ fontWeight: 600 }}>{successRate}%</div>
                          <div
                            style={{
                              height: '5px',
                              marginTop: '4px',
                              borderRadius: '9999px',
                              backgroundColor: 'var(--surface-raised)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${successRate}%`,
                                height: '100%',
                                backgroundColor: 'var(--success)',
                              }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              aria-label={`Test ${agent.name}`}
                              onClick={() => onOpenAgent(agent, 'test')}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border)',
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text-secondary)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                            >
                              <Play size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Duplicate ${agent.name}`}
                              onClick={() => onDuplicateAgent(agent)}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border)',
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text-secondary)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                            >
                              <Copy size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Configure ${agent.name}`}
                              onClick={() => onOpenAgent(agent, 'configure')}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border)',
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text-secondary)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                            >
                              <MoreHorizontal size={13} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer pagination */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderTop: '1px solid var(--border)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                Showing {(safePage - 1) * rowsPerPage + 1}–
                {Math.min(safePage * rowsPerPage, filteredAgents.length)} of {filteredAgents.length} agents
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{
                    minWidth: '28px',
                    minHeight: '28px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                    cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  &lt;
                </button>
                <span
                  style={{
                    minWidth: '28px',
                    minHeight: '28px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: 'var(--brand-contrast)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                  }}
                >
                  {safePage}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={{
                    minWidth: '28px',
                    minHeight: '28px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                    cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  &gt;
                </button>
                <label htmlFor="agents-rows-per-page" style={{ marginLeft: '10px' }}>
                  Rows per page:
                </label>
                <select
                  id="agents-rows-per-page"
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setPage(1);
                  }}
                  style={{
                    minHeight: '28px',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
