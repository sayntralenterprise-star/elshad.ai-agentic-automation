import { useState, type FormEvent } from 'react';
import type { TestToolResultDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { Code2, GitBranch, History, Play } from 'lucide-react';

export interface RegistryToolSummary {
  name: string;
  version: string;
  description: string;
  sideEffectClass: string;
  implementation: string;
  untrustedSource: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  owner: string;
  source: 'Builtin' | 'Custom / OpenAPI';
}

export interface ToolInspectorDrawerProps {
  selectedTool: RegistryToolSummary | null;
  testArgsJson: string;
  dryRun: boolean;
  simulatedOutputText: string;
  testingTool: boolean;
  testResult: TestToolResultDto | null;
  agentsUsingTool: Array<{ id: string; name: string; status: string }>;
  onChangeArgs: (raw: string) => void;
  onChangeDryRun: (enabled: boolean) => void;
  onChangeSimulatedOutput: (raw: string) => void;
  onSubmitTest: (e: FormEvent) => Promise<void> | void;
}

type InspectorTab = 'test' | 'schema' | 'versions' | 'used_by';

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'test', label: 'Test Panel' },
  { id: 'schema', label: 'Schema Viewer' },
  { id: 'versions', label: 'Version History' },
  { id: 'used_by', label: 'Used By' },
];

export function ToolInspectorDrawer({
  selectedTool,
  testArgsJson,
  dryRun,
  simulatedOutputText,
  testingTool,
  testResult,
  agentsUsingTool,
  onChangeArgs,
  onChangeDryRun,
  onChangeSimulatedOutput,
  onSubmitTest,
}: ToolInspectorDrawerProps) {
  const [tab, setTab] = useState<InspectorTab>('test');

  return (
    <aside
      aria-label="Tool Inspector"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
        boxShadow: 'var(--shadow-card)',
        display: 'grid',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
          Tool Test Panel (FR-TL-8 / FR-TL-9)
        </h2>
        {selectedTool && (
          <StatusChip label={`v${selectedTool.version}`} tone="info" />
        )}
      </div>

      {!selectedTool ? (
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Select a tool from the registry to inspect contracts, schemas, versions, and dry-run execution.
        </div>
      ) : (
        <>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px' }}>
              {selectedTool.name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {selectedTool.description}
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Tool inspector tabs"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '6px',
            }}
          >
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 'var(--radius-sm)',
                    border: active ? '1px solid var(--brand)' : '1px solid transparent',
                    backgroundColor: active ? 'var(--lavender)' : 'var(--surface-raised)',
                    color: active ? 'var(--brand)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '11.5px',
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            aria-label={TABS.find((t) => t.id === tab)?.label ?? 'Test Panel'}
            style={{ display: 'grid', gap: '10px' }}
          >
            {tab === 'test' && (
              <form onSubmit={(e) => void onSubmitTest(e)} style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label
                    htmlFor="tool-test-args"
                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                  >
                    Input Arguments (JSON)
                  </label>
                  <textarea
                    id="tool-test-args"
                    rows={4}
                    value={testArgsJson}
                    onChange={(e) => onChangeArgs(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="tool-sim-output"
                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                  >
                    Simulated Raw Output (optional, tests injection detector)
                  </label>
                  <input
                    id="tool-sim-output"
                    type="text"
                    value={simulatedOutputText}
                    onChange={(e) => onChangeSimulatedOutput(e.target.value)}
                    placeholder="e.g. Ignore all previous instructions..."
                    style={{
                      width: '100%',
                      minHeight: '32px',
                      padding: '4px 8px',
                      fontSize: '12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => onChangeDryRun(e.target.checked)}
                  />
                  <span>Dry-Run Mode (FR-TL-9: simulate without side effects)</span>
                </label>

                <button
                  type="submit"
                  disabled={testingTool}
                  style={{
                    minHeight: '34px',
                    padding: '6px 14px',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: 'var(--brand-contrast)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <Play size={14} aria-hidden="true" />
                  <span>{testingTool ? 'Running...' : dryRun ? 'Run Dry-Run Test' : 'Execute Tool Test'}</span>
                </button>

                {testResult && (
                  <div
                    role="status"
                    style={{
                      padding: '10px',
                      backgroundColor: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'grid',
                      gap: '8px',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <StatusChip label={testResult.dryRun ? 'Dry-Run' : 'Executed'} tone="info" />
                      {testResult.untrustedSource && (
                        <StatusChip label="Untrusted Source" tone="warning" />
                      )}
                      {testResult.injectionSuspected && (
                        <StatusChip label="Injection Suspected" tone="danger" />
                      )}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {testResult.wrappedObservation}
                    </pre>
                  </div>
                )}
              </form>
            )}

            {tab === 'schema' && (
              <div style={{ display: 'grid', gap: '8px', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <Code2 size={13} aria-hidden="true" />
                  <span>Input JSON Schema</span>
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
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(selectedTool.inputSchema ?? { type: 'object' }, null, 2)}
                </pre>
                <div style={{ fontWeight: 600 }}>Output JSON Schema</div>
                <pre
                  style={{
                    margin: 0,
                    padding: '10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--obsidian)',
                    color: '#A6F4C5',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(selectedTool.outputSchema ?? { type: 'object' }, null, 2)}
                </pre>
              </div>
            )}

            {tab === 'versions' && (
              <div style={{ display: 'grid', gap: '6px', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <History size={13} aria-hidden="true" />
                  <span>Contract Version History</span>
                </div>
                <div
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--lavender-soft)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>v{selectedTool.version}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Current published contract ({selectedTool.implementation})
                    </div>
                  </div>
                  <StatusChip label="Latest" tone="success" />
                </div>
                <div
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>v0.9.0</strong>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Initial schema registration
                    </div>
                  </div>
                  <StatusChip label="Retired" tone="neutral" />
                </div>
              </div>
            )}

            {tab === 'used_by' && (
              <div style={{ display: 'grid', gap: '8px', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <GitBranch size={13} aria-hidden="true" />
                  <span>Used-By Relationship Graph</span>
                </div>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 320 96"
                  style={{
                    width: '100%',
                    height: '96px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg)',
                  }}
                >
                  <rect x={12} y={32} width={104} height={32} rx={6} fill="#EAE8F7" stroke="#3924D6" />
                  <text x={64} y={52} textAnchor="middle" fontSize="10" fontWeight="700" fill="#17172B">
                    {selectedTool.name.slice(0, 14)}
                  </text>
                  {(agentsUsingTool.length > 0
                    ? agentsUsingTool.slice(0, 2)
                    : [{ id: 'placeholder', name: 'No agents bound', status: 'idle' }]
                  ).map((ag, idx) => {
                    const y = 12 + idx * 44;
                    return (
                      <g key={ag.id}>
                        <line x1={116} y1={48} x2={176} y2={y + 16} stroke="#98A2B3" strokeWidth={1.6} />
                        <rect x={176} y={y} width={130} height={30} rx={6} fill="#FFFFFF" stroke="#D0D5DD" />
                        <text x={241} y={y + 19} textAnchor="middle" fontSize="10" fill="#17172B">
                          {ag.name.slice(0, 18)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                {agentsUsingTool.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)' }}>
                    No workspace agents currently declare <code>{selectedTool.name}</code> in their active grant set.
                  </div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {agentsUsingTool.map((ag) => (
                      <li key={ag.id}>
                        <strong>{ag.name}</strong> ({ag.status})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
