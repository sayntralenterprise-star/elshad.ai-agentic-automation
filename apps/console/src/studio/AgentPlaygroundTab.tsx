import { useState, type FormEvent } from 'react';
import type { EnvironmentKind } from '@elshad/domain';
import type { AgentDto, RunDto, RunStepDto, UsageLedgerEntryDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { Play, Share2 } from 'lucide-react';

export interface AgentPlaygroundTabProps {
  selectedAgent: AgentDto;
  studioEnv: EnvironmentKind;
  onEnvChange: (env: EnvironmentKind) => void;
  testPrompt: string;
  onTestPromptChange: (prompt: string) => void;
  dryRun: boolean;
  onDryRunChange: (dryRun: boolean) => void;
  runningTest: boolean;
  lastRun: RunDto | null;
  lastSteps: RunStepDto[];
  lastLedger: UsageLedgerEntryDto[];
  savedTestCases: Array<{ prompt: string; runId: string }>;
  onRunTest: (e: FormEvent) => void;
  onSaveAsTestCase: (prompt: string, runId: string) => void;
}

export function AgentPlaygroundTab({
  selectedAgent,
  studioEnv,
  onEnvChange,
  testPrompt,
  onTestPromptChange,
  dryRun,
  onDryRunChange,
  runningTest,
  lastRun,
  lastSteps,
  lastLedger,
  savedTestCases,
  onRunTest,
  onSaveAsTestCase,
}: AgentPlaygroundTabProps) {
  const [mockTools, setMockTools] = useState(true);
  const [seed, setSeed] = useState(42);
  const [persona, setPersona] = useState('standard_user');
  const [shareCopied, setShareCopied] = useState(false);

  return (
    <div role="tabpanel" aria-label="Test Playground" style={{ padding: '18px 20px', display: 'grid', gap: '14px' }}>
      {/* Developer Controls Strip (Screen 07) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          padding: '10px 12px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          fontSize: '12px',
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span>Version:</span>
          <strong>{selectedAgent.draftVersion?.semver ?? selectedAgent.publishedVersion?.semver ?? '1.0.0'}</strong>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span>Env:</span>
          <select
            aria-label="Playground environment"
            value={studioEnv}
            onChange={(e) => onEnvChange(e.target.value as EnvironmentKind)}
            style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}
          >
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <input type="checkbox" checked={mockTools} onChange={(e) => setMockTools(e.target.checked)} />
          <span>Mock tools</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span>Seed</span>
          <input
            type="number"
            aria-label="Random seed"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
            style={{ width: '58px', padding: '3px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}
          />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span>Persona</span>
          <select
            aria-label="Simulated persona"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}
          >
            <option value="standard_user">Standard User</option>
            <option value="enterprise_admin">Enterprise Admin</option>
            <option value="adversarial">Adversarial</option>
          </select>
        </label>
      </div>

      {/* Three-Panel Testing Workspace: Input | Response | Live Trace */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '300px 1fr 310px',
          gap: '14px',
          alignItems: 'start',
        }}
      >
        {/* Panel 1: Input */}
        <form
          onSubmit={onRunTest}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <label htmlFor="playground-prompt" style={{ fontWeight: 700, fontSize: '13.5px' }}>
            Test Prompt
          </label>
          <textarea
            id="playground-prompt"
            rows={5}
            required
            value={testPrompt}
            onChange={(e) => onTestPromptChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12.5px',
            }}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => onDryRunChange(e.target.checked)}
            />
            <span>Dry-run (validate policies &amp; args without executing external tools)</span>
          </label>
          <button
            type="submit"
            disabled={runningTest}
            style={{
              minHeight: '36px',
              padding: '6px 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--brand)',
              color: 'var(--brand-contrast)',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <Play size={14} aria-hidden="true" />
            <span>{runningTest ? 'Running…' : 'Run Test'}</span>
          </button>
        </form>

        {/* Panel 2: Streaming Response & Metrics */}
        <section
          aria-label="Playground Response"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '10px',
            minHeight: '220px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Response</h3>
            {lastRun && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => onSaveAsTestCase(testPrompt, lastRun.id)}
                  style={{
                    minHeight: '28px',
                    padding: '4px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save as test case
                </button>
                <button
                  type="button"
                  onClick={() => setShareCopied(true)}
                  style={{
                    minHeight: '28px',
                    padding: '4px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <Share2 size={12} aria-hidden="true" />
                  <span>{shareCopied ? 'Link Copied' : 'Share'}</span>
                </button>
              </div>
            )}
          </div>

          {!lastRun ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Run a test prompt on the left to stream live agent output, cost, and step trace.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px' }}>
                <StatusChip
                  label={`${lastRun.status} (${lastRun.terminationReason ?? 'done'})`}
                  tone={lastRun.status === 'succeeded' ? 'success' : 'warning'}
                />
                <span>
                  Cost: <strong>{lastRun.costMicroUsd} micro-USD</strong>
                </span>
                <span>
                  Tokens: {lastRun.usage.tokensIn} in / {lastRun.usage.tokensOut} out
                </span>
              </div>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12.5px',
                  wordBreak: 'break-word',
                }}
              >
                <strong>Output:</strong> <code>{JSON.stringify(lastRun.output)}</code>
              </div>
              {savedTestCases.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--brand)', fontWeight: 600 }}>
                  Saved eval test cases: {savedTestCases.length}
                </div>
              )}
            </>
          )}
        </section>

        {/* Panel 3: Live Execution Trace */}
        <aside
          aria-label="Live Execution Trace"
          style={{
            backgroundColor: 'var(--lavender-soft)',
            border: '1px solid var(--lavender-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '8px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700 }}>
            Execution Trace ({lastSteps.length} steps · {lastLedger.length} ledger rows)
          </h3>
          {lastSteps.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Step-by-step LLM &amp; tool spans appear here once executed.
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '16px', display: 'grid', gap: '6px', fontSize: '12px' }}>
              {lastSteps.map((s) => (
                <li key={s.id}>
                  <code>
                    #{s.seq} {s.type}
                  </code>{' '}
                  — {s.status} ({s.costMicroUsd} micro-USD, {s.latencyMs}ms)
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
