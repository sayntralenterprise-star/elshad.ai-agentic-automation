import { useMemo, useState } from 'react';
import type { WorkflowEdgeDto, WorkflowNodeDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { Copy, Link2, Pin, Sparkles, Trash2 } from 'lucide-react';
import { NodeConfigForm } from './NodeConfigForm.js';
import {
  CATEGORY_META,
  evaluateExpressionPreview,
  getNodeCategory,
  type NodeExecutionOverlayEntry,
} from './workflowTemplates.js';

export interface WorkflowInspectorPanelProps {
  selectedNode: WorkflowNodeDto | null;
  allNodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
  nodeNameInput: string;
  nodeConfigInput: string;
  nodeConfigError: string | null;
  nodeOnErrorMode: 'fail' | 'continue' | 'retry' | 'route';
  isSelectedNodePinned: boolean;
  pinJsonInput: string;
  pinJsonError: string | null;
  triggerPayloadText: string;
  pinnedData: Record<string, unknown[]>;
  overlayEntry?: NodeExecutionOverlayEntry;
  onUpdateNodeName: (name: string) => void;
  onUpdateNodeConfig: (raw: string) => void;
  onUpdateNodeOnError: (mode: 'fail' | 'continue' | 'retry' | 'route') => void;
  onUpdateRetryConfig: (max: number, backoffMs: number) => void;
  onUpdateNodeNote: (note: string) => void;
  onPinToggle: (enabled: boolean) => void;
  onPinJsonChange: (raw: string) => void;
  onDeleteSelectedNode: () => void;
  onDuplicateSelectedNode: () => void;
  onAddEdge: (fromId: string, toId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
}

type InspectorTab = 'parameters' | 'settings' | 'input' | 'output' | 'error' | 'notes';

const TABS: Array<{ key: InspectorTab; label: string }> = [
  { key: 'parameters', label: 'Parameters' },
  { key: 'settings', label: 'Settings' },
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
  { key: 'error', label: 'Error handling' },
  { key: 'notes', label: 'Notes' },
];

export function WorkflowInspectorPanel({
  selectedNode,
  allNodes,
  edges,
  nodeNameInput,
  nodeConfigInput,
  nodeConfigError,
  nodeOnErrorMode,
  isSelectedNodePinned,
  pinJsonInput,
  pinJsonError,
  triggerPayloadText,
  pinnedData,
  overlayEntry,
  onUpdateNodeName,
  onUpdateNodeConfig,
  onUpdateNodeOnError,
  onUpdateRetryConfig,
  onUpdateNodeNote,
  onPinToggle,
  onPinJsonChange,
  onDeleteSelectedNode,
  onDuplicateSelectedNode,
  onAddEdge,
  onRemoveEdge,
}: WorkflowInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('parameters');
  const [exprInput, setExprInput] = useState('Urgent: {{trigger.body.message}}');
  const [connectTargetId, setConnectTargetId] = useState('');

  const upstreamNodes = useMemo(() => {
    if (!selectedNode) return [];
    const parentIds = new Set(
      edges.filter((e) => e.to.node === selectedNode.id).map((e) => e.from.node),
    );
    return allNodes.filter((n) => parentIds.has(n.id));
  }, [allNodes, edges, selectedNode]);

  const outgoingEdges = useMemo(
    () => (selectedNode ? edges.filter((e) => e.from.node === selectedNode.id) : []),
    [edges, selectedNode],
  );

  const sampleContext = useMemo(() => {
    let triggerBody: Record<string, unknown> = { message: 'Server latency alert!' };
    try {
      const parsed = JSON.parse(triggerPayloadText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        triggerBody = parsed as Record<string, unknown>;
      }
    } catch {
      // Keep default sample trigger body on malformed JSON
    }
    const prevNode = upstreamNodes[0];
    const prevPinned = prevNode ? (pinnedData[prevNode.id] ?? []) : [];
    const prevFirst = Array.isArray(prevPinned) ? prevPinned[0] : undefined;
    const prevSample =
      prevFirst && typeof prevFirst === 'object'
        ? (prevFirst as Record<string, unknown>)
        : { priority: 'high', summary: String(triggerBody.message ?? 'Triage item'), ok: true };
    return {
      trigger: { body: triggerBody },
      $prev: prevSample,
    };
  }, [pinnedData, triggerPayloadText, upstreamNodes]);

  const autocompleteTokens = useMemo(() => {
    const tokens = [
      '{{trigger.body.message}}',
      '{{$prev.priority}}',
      '{{$prev.summary}}',
      '=$prev.priority',
    ];
    for (const k of Object.keys(sampleContext.$prev)) {
      const candidate = `{{$prev.${k}}}`;
      if (!tokens.includes(candidate)) tokens.push(candidate);
    }
    return tokens;
  }, [sampleContext]);

  const evalResult = useMemo(
    () => evaluateExpressionPreview(exprInput, sampleContext),
    [exprInput, sampleContext],
  );

  const connectableNodes = useMemo(() => {
    if (!selectedNode) return [];
    const existingTargets = new Set(outgoingEdges.map((e) => e.to.node));
    return allNodes.filter((n) => n.id !== selectedNode.id && !existingTargets.has(n.id));
  }, [allNodes, outgoingEdges, selectedNode]);

  const catMeta = selectedNode
    ? CATEGORY_META[getNodeCategory(selectedNode.type)] ?? CATEGORY_META.control!
    : CATEGORY_META.control!;

  return (
    <aside
      aria-label="Node Inspector"
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <h2 style={{ margin: 0, fontSize: '15px' }}>Node Inspector</h2>
        {selectedNode && (
          <div style={{ display: 'inline-flex', gap: '4px' }}>
            <button
              type="button"
              aria-label="Duplicate selected node"
              onClick={onDuplicateSelectedNode}
              style={{
                padding: '4px 7px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <Copy size={11} aria-hidden="true" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              aria-label="Delete selected node"
              onClick={onDeleteSelectedNode}
              style={{
                padding: '4px 8px',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--danger-bg)',
                color: 'var(--danger)',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Trash2 size={12} aria-hidden="true" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>

      {!selectedNode ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
          Select a node on the canvas to inspect config, upstream expressions, error handling, or pinned test data.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              <code>{selectedNode.id}</code>
            </div>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '9999px',
                backgroundColor: catMeta.tint,
                color: catMeta.accent,
              }}
            >
              {selectedNode.type}
            </span>
          </div>

          <div>
            <label htmlFor="inspector-node-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              Node Name
            </label>
            <input
              id="inspector-node-name"
              type="text"
              value={nodeNameInput}
              onChange={(e) => onUpdateNodeName(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
              }}
            />
          </div>

          {/* 6-tab Inspector Switcher */}
          <div
            role="tablist"
            aria-label="Node inspector tabs"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '6px',
            }}
          >
            {TABS.map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: selected ? '1px solid var(--brand)' : '1px solid transparent',
                    backgroundColor: selected ? 'var(--lavender)' : 'var(--surface-raised)',
                    color: selected ? 'var(--brand)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" aria-label={TABS.find((t) => t.key === activeTab)?.label ?? 'Parameters'} style={{ display: 'grid', gap: '8px' }}>
            {activeTab === 'parameters' && (
              <>
                <NodeConfigForm
                  nodeType={selectedNode.type}
                  nodeConfigInput={nodeConfigInput}
                  onUpdateNodeConfig={onUpdateNodeConfig}
                />
                <div>
                  <label htmlFor="inspector-node-config" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                    Config JSON (supports JSONata <code>=expr</code> or <code>{'{{ expr }}'}</code>)
                  </label>
                  <textarea
                    id="inspector-node-config"
                    rows={5}
                    value={nodeConfigInput}
                    onChange={(e) => onUpdateNodeConfig(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '11.5px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                  {nodeConfigError && (
                    <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '4px' }}>
                      {nodeConfigError}
                    </div>
                  )}
                </div>

                {/* Expression Editor with Autocomplete & Live Preview */}
                <div
                  style={{
                    border: '1px solid var(--lavender-border)',
                    backgroundColor: 'var(--lavender-soft)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px',
                    display: 'grid',
                    gap: '6px',
                  }}
                >
                  <label
                    htmlFor="inspector-expression-editor"
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: 'var(--brand)',
                    }}
                  >
                    <Sparkles size={12} aria-hidden="true" />
                    <span>Expression Editor (Upstream Autocomplete)</span>
                  </label>
                  <input
                    id="inspector-expression-editor"
                    type="text"
                    value={exprInput}
                    onChange={(e) => setExprInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '11.5px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {autocompleteTokens.map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        onClick={() => setExprInput((prev) => `${prev} ${tok}`.trim())}
                        style={{
                          padding: '2px 6px',
                          borderRadius: '9999px',
                          border: '1px solid var(--lavender-border)',
                          backgroundColor: 'var(--surface)',
                          color: 'var(--brand)',
                          fontFamily: 'var(--font-mono, monospace)',
                          fontSize: '10.5px',
                          cursor: 'pointer',
                        }}
                      >
                        {tok}
                      </button>
                    ))}
                  </div>
                  <div
                    aria-label="Expression evaluation preview"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--obsidian)',
                      color: evalResult.valid ? '#A6F4C5' : '#FDA29B',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '11px',
                    }}
                  >
                    Preview: {evalResult.value}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'settings' && (
              <div style={{ display: 'grid', gap: '8px', fontSize: '12px' }}>
                <div>
                  Position: <code>({Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)})</code>
                </div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Link2 size={12} aria-hidden="true" />
                    <span>Outgoing Connections ({outgoingEdges.length})</span>
                  </div>
                  {outgoingEdges.map((edge) => {
                    const target = allNodes.find((n) => n.id === edge.to.node);
                    return (
                      <div
                        key={edge.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--surface-raised)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <span>→ {target?.name ?? edge.to.node}</span>
                        <button
                          type="button"
                          onClick={() => onRemoveEdge(edge.id)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--danger)',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                  {connectableNodes.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <select
                        aria-label="Connect to target node"
                        value={connectTargetId || connectableNodes[0]!.id}
                        onChange={(e) => setConnectTargetId(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '4px 6px',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '11.5px',
                        }}
                      >
                        {connectableNodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const target = connectTargetId || connectableNodes[0]!.id;
                          if (target) onAddEdge(selectedNode.id, target);
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--brand)',
                          backgroundColor: 'var(--surface)',
                          color: 'var(--brand)',
                          fontWeight: 600,
                          fontSize: '11.5px',
                          cursor: 'pointer',
                        }}
                      >
                        Connect
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'input' && (
              <div style={{ display: 'grid', gap: '6px', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-secondary)' }}>
                  Upstream nodes ({upstreamNodes.length}):{' '}
                  {upstreamNodes.length > 0
                    ? upstreamNodes.map((n) => n.name).join(', ')
                    : 'Trigger root'}
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--obsidian)',
                    color: '#E2E8F0',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '11px',
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(sampleContext, null, 2)}
                </pre>
              </div>
            )}

            {activeTab === 'output' && (
              <div style={{ display: 'grid', gap: '6px', fontSize: '12px' }}>
                {overlayEntry && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <StatusChip
                      label={overlayEntry.status}
                      tone={
                        overlayEntry.status === 'succeeded'
                          ? 'success'
                          : overlayEntry.status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    />
                    <span>{overlayEntry.durationMs}ms</span>
                  </div>
                )}
                <pre
                  style={{
                    margin: 0,
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--obsidian)',
                    color: '#A6F4C5',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '11px',
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(
                    overlayEntry?.output ??
                      pinnedData[selectedNode.id] ?? {
                        note: 'Run "Test Workflow" or pin sample output data below.',
                      },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}

            {activeTab === 'error' && (
              <div style={{ display: 'grid', gap: '8px' }}>
                <div>
                  <label htmlFor="inspector-on-error" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                    On Error Policy
                  </label>
                  <select
                    id="inspector-on-error"
                    value={nodeOnErrorMode}
                    onChange={(e) =>
                      onUpdateNodeOnError(
                        e.target.value as 'fail' | 'continue' | 'retry' | 'route',
                      )
                    }
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <option value="fail">fail (halt run)</option>
                    <option value="continue">continue (forward empty/error)</option>
                    <option value="retry">retry (3x exponential)</option>
                    <option value="route">route (error port)</option>
                  </select>
                </div>
                {nodeOnErrorMode === 'retry' && (
                  <div style={{ display: 'flex', gap: '6px', fontSize: '11.5px', alignItems: 'center' }}>
                    <span>Max retries:</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={selectedNode.onError?.retry?.max ?? 3}
                      onChange={(e) =>
                        onUpdateRetryConfig(
                          Math.max(1, Number(e.target.value) || 3),
                          selectedNode.onError?.retry?.backoff_ms ?? 500,
                        )
                      }
                      style={{ width: '56px', padding: '4px', border: '1px solid var(--border)' }}
                    />
                    <span>Backoff ms:</span>
                    <input
                      type="number"
                      min={100}
                      step={100}
                      value={selectedNode.onError?.retry?.backoff_ms ?? 500}
                      onChange={(e) =>
                        onUpdateRetryConfig(
                          selectedNode.onError?.retry?.max ?? 3,
                          Math.max(100, Number(e.target.value) || 500),
                        )
                      }
                      style={{ width: '72px', padding: '4px', border: '1px solid var(--border)' }}
                    />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
              <div>
                <label htmlFor="inspector-node-note" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Node Implementation Notes
                </label>
                <textarea
                  id="inspector-node-note"
                  rows={4}
                  placeholder="Document assumptions, rate limits, or escalation rules for teammates..."
                  value={typeof selectedNode.config?._note === 'string' ? selectedNode.config._note : ''}
                  onChange={(e) => onUpdateNodeNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              </div>
            )}
          </div>

          {/* Always-mounted Pin Output Data (Test-from-Here) section */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: '10px',
              display: 'grid',
              gap: '6px',
            }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={isSelectedNodePinned}
                onChange={(e) => onPinToggle(e.target.checked)}
              />
              <Pin size={13} aria-hidden="true" />
              <span>Pin Output Data (Test-from-Here)</span>
            </label>
            <label htmlFor="inspector-pin-json" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Pinned Output JSON Array
            </label>
            <textarea
              id="inspector-pin-json"
              rows={3}
              value={pinJsonInput}
              onChange={(e) => onPinJsonChange(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '11.5px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            />
            {pinJsonError && (
              <div style={{ fontSize: '11px', color: 'var(--danger)' }}>{pinJsonError}</div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
