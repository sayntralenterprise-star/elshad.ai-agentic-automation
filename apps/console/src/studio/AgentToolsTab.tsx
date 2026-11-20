import { useMemo, useState } from 'react';
import type { ToolContractDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import {
  Play,
  Puzzle,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Wrench,
} from 'lucide-react';

export interface ToolBindingDraft {
  tool: string;
  approval: 'never' | 'auto' | 'always';
  allowedDomainsText: string;
  permittedResources?: string;
}

export interface AgentToolsTabProps {
  toolsCatalog: ToolContractDto[];
  draftToolBindings: ToolBindingDraft[];
  liveTrifectaWarning: boolean;
  agentName: string;
  onToggleTool: (toolName: string) => void;
  onUpdateBinding: (toolName: string, patch: Partial<ToolBindingDraft>) => void;
}

type ToolCategory =
  | 'All'
  | 'Web'
  | 'Data'
  | 'Communication'
  | 'Files'
  | 'APIs'
  | 'Internal Tools'
  | 'Workflow Tools';

const CATEGORIES: readonly ToolCategory[] = [
  'All',
  'Web',
  'Data',
  'Communication',
  'Files',
  'APIs',
  'Internal Tools',
  'Workflow Tools',
];

function classifyTool(t: ToolContractDto): Exclude<ToolCategory, 'All'> {
  const n = `${t.name} ${t.description}`.toLowerCase();
  if (n.includes('web') || n.includes('search') || n.includes('fetch')) return 'Web';
  if (n.includes('kb') || n.includes('sql') || n.includes('db') || n.includes('data')) return 'Data';
  if (t.sideEffectClass === 'external_comms' || n.includes('slack') || n.includes('email')) {
    return 'Communication';
  }
  if (n.includes('file') || n.includes('doc') || n.includes('pdf')) return 'Files';
  if (n.includes('workflow') || n.includes('flow')) return 'Workflow Tools';
  if (n.includes('http') || n.includes('api')) return 'APIs';
  return 'Internal Tools';
}

export function AgentToolsTab({
  toolsCatalog,
  draftToolBindings,
  liveTrifectaWarning,
  agentName,
  onToggleTool,
  onUpdateBinding,
}: AgentToolsTabProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ToolCategory>('All');
  const [selectedToolName, setSelectedToolName] = useState<string>(
    draftToolBindings[0]?.tool ?? toolsCatalog[0]?.name ?? '',
  );
  const [dryRunResult, setDryRunResult] = useState<string | null>(null);

  const filteredCatalog = useMemo(() => {
    return toolsCatalog.filter((t) => {
      if (category !== 'All' && classifyTool(t) !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${t.name} ${t.description}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [toolsCatalog, category, search]);

  const activeTool =
    toolsCatalog.find((t) => t.name === selectedToolName) ??
    toolsCatalog.find((t) => draftToolBindings.some((b) => b.tool === t.name)) ??
    toolsCatalog[0] ??
    null;

  const activeBinding = activeTool
    ? draftToolBindings.find((b) => b.tool === activeTool.name)
    : undefined;

  return (
    <div role="tabpanel" aria-label="Agent Tools" style={{ padding: '18px 20px', display: 'grid', gap: '14px' }}>
      {liveTrifectaWarning && (
        <div
          role="alert"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--warning-bg)',
            border: '1px solid var(--warning)',
            color: 'var(--warning)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ShieldAlert size={16} aria-hidden="true" />
          <span>
            Lethal Trifecta Warning: Combining private data access, untrusted external input, and
            external communication tools requires strict domain allowlists or explicit approval.
          </span>
        </div>
      )}

      {/* Three-Column Workspace (Screen 04) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '250px 1fr 300px',
          gap: '14px',
          alignItems: 'start',
        }}
      >
        {/* Left: Searchable Tool Catalogue */}
        <section
          aria-label="Tool catalogue"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Puzzle size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Tool Catalogue ({toolsCatalog.length})</span>
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={13} aria-hidden="true" style={{ position: 'absolute', left: '9px', color: 'var(--text-muted)' }} />
            <input
              type="search"
              aria-label="Search tool catalogue"
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px 6px 28px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                fontSize: '12.5px',
              }}
            />
          </div>

          <select
            aria-label="Tool category filter"
            value={category}
            onChange={(e) => setCategory(e.target.value as ToolCategory)}
            style={{
              width: '100%',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              fontSize: '12.5px',
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                Category: {c}
              </option>
            ))}
          </select>

          <div style={{ display: 'grid', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
            {filteredCatalog.map((tool) => {
              const checked = draftToolBindings.some((b) => b.tool === tool.name);
              const isSelected = activeTool?.name === tool.name;
              return (
                <div
                  key={tool.name}
                  style={{
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '1px solid var(--brand)' : '1px solid var(--border-subtle)',
                    backgroundColor: isSelected ? 'var(--lavender-soft)' : 'var(--surface)',
                    display: 'grid',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        aria-label={`Enable tool ${tool.name}`}
                        checked={checked}
                        onChange={() => {
                          onToggleTool(tool.name);
                          setSelectedToolName(tool.name);
                        }}
                      />
                      <span>{tool.name}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setSelectedToolName(tool.name)}
                      aria-label={`Select ${tool.name} details`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--brand)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Inspect
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {classifyTool(tool)} · {tool.sideEffectClass}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Center: Granted Tools Assigned to Agent */}
        <section
          aria-label="Granted agent tools"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>
                Granted Tools ({draftToolBindings.length})
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Tools currently bound to <strong>{agentName}</strong>.
              </p>
            </div>
          </div>

          {draftToolBindings.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--border)',
                color: 'var(--text-secondary)',
                fontSize: '13px',
              }}
            >
              No tools granted yet. Select tools from the catalogue on the left to bind them.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {draftToolBindings.map((binding) => {
                const contract = toolsCatalog.find((t) => t.name === binding.tool);
                const isSelected = activeTool?.name === binding.tool;
                return (
                  <div
                    key={binding.tool}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'var(--lavender-soft)' : 'var(--surface)',
                      display: 'grid',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Wrench size={14} style={{ color: 'var(--brand)' }} aria-hidden="true" />
                        <strong style={{ fontSize: '13px' }}>{binding.tool}</strong>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-raised)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          v{contract?.version ?? '1.0.0'}
                        </span>
                        <StatusChip
                          label={contract?.sideEffectClass ?? 'read'}
                          tone={
                            contract?.sideEffectClass === 'external_comms' ||
                            contract?.sideEffectClass === 'destructive'
                              ? 'warning'
                              : 'neutral'
                          }
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedToolName(binding.tool)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--surface)',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Configure
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${binding.tool}`}
                          onClick={() => onToggleTool(binding.tool)}
                          style={{
                            padding: '4px 6px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--surface)',
                            color: 'var(--danger)',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {contract?.description ?? 'Workspace registered tool'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '12px' }}>
                      <span>Approval: <strong>{binding.approval}</strong></span>
                      <span>24h Calls: 1,240</span>
                      <span>Error Rate: 0.4%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Selected Tool Configuration & Permissions */}
        <aside
          aria-label="Tool permissions and testing"
          style={{
            backgroundColor: 'var(--lavender-soft)',
            border: '1px solid var(--lavender-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13.5px' }}>
            <Settings2 size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>{activeTool ? activeTool.name : 'Select a Tool'}</span>
          </div>

          {activeTool ? (
            <>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {activeTool.description}
              </div>

              <div>
                <label
                  htmlFor={`approval-${activeTool.name}`}
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                >
                  Approval override
                </label>
                <select
                  id={`approval-${activeTool.name}`}
                  aria-label={`Approval mode for ${activeTool.name}`}
                  disabled={!activeBinding}
                  value={activeBinding?.approval ?? 'auto'}
                  onChange={(e) =>
                    onUpdateBinding(activeTool.name, {
                      approval: e.target.value as ToolBindingDraft['approval'],
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                  }}
                >
                  <option value="auto">auto</option>
                  <option value="always">always (require HITL)</option>
                  <option value="never">never</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor={`domains-${activeTool.name}`}
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                >
                  Allowed domains
                </label>
                <input
                  id={`domains-${activeTool.name}`}
                  type="text"
                  aria-label={`Allowed domains for ${activeTool.name}`}
                  disabled={!activeBinding}
                  placeholder="e.g., docs.example.com, api.stripe.com"
                  value={activeBinding?.allowedDomainsText ?? ''}
                  onChange={(e) =>
                    onUpdateBinding(activeTool.name, { allowedDomainsText: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor={`resources-${activeTool.name}`}
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                >
                  Permitted resources
                </label>
                <input
                  id={`resources-${activeTool.name}`}
                  type="text"
                  disabled={!activeBinding}
                  placeholder="e.g., tickets:read, kb:public"
                  value={activeBinding?.permittedResources ?? ''}
                  onChange={(e) =>
                    onUpdateBinding(activeTool.name, { permittedResources: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  setDryRunResult(
                    JSON.stringify(
                      {
                        tool: activeTool.name,
                        status: 'dry_run_ok',
                        side_effect: activeTool.sideEffectClass,
                        latency_ms: 42,
                      },
                      null,
                      2,
                    ),
                  )
                }
                style={{
                  minHeight: '32px',
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--brand)',
                  color: 'var(--brand-contrast)',
                  fontWeight: 600,
                  fontSize: '12.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <Play size={13} aria-hidden="true" />
                <span>Test Tool Execution</span>
              </button>

              {dryRunResult && (
                <pre
                  style={{
                    margin: 0,
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--obsidian)',
                    color: 'var(--obsidian-text)',
                    fontSize: '11px',
                    overflowX: 'auto',
                  }}
                >
                  {dryRunResult}
                </pre>
              )}

              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', borderTop: '1px solid var(--lavender-border)', paddingTop: '8px' }}>
                <strong>Used by agents:</strong> {agentName}, support-triage, invoice-extractor
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
