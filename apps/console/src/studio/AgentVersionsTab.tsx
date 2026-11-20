import { useState } from 'react';
import type { AgentDiffDto, AgentDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { GitCompare, GitFork, History, RotateCcw, Rocket } from 'lucide-react';

export interface AgentVersionsTabProps {
  agent: AgentDto;
  versionDiff: AgentDiffDto | null;
  onComputeDiff: () => void;
  onRestoreVersion: (semver: string) => void;
  onForkVersion: (semver: string) => void;
  onPromoteTab: () => void;
}

export function AgentVersionsTab({
  agent,
  versionDiff,
  onComputeDiff,
  onRestoreVersion,
  onForkVersion,
  onPromoteTab,
}: AgentVersionsTabProps) {
  const [selectedVerId, setSelectedVerId] = useState<string>(
    agent.draftVersion?.id ?? agent.publishedVersion?.id ?? agent.versions[0]?.id ?? '',
  );
  const [compareVerId, setCompareVerId] = useState<string>(
    agent.publishedVersion?.id ?? agent.versions[0]?.id ?? '',
  );

  const selectedVer =
    agent.versions.find((v) => v.id === selectedVerId) ??
    agent.draftVersion ??
    agent.publishedVersion ??
    agent.versions[0];
  const compareVer = agent.versions.find((v) => v.id === compareVerId) ?? agent.versions[0];

  const getSummary = (def: Record<string, unknown> | undefined) => {
    const model = ((def?.model ?? {}) as { model?: string }).model ?? 'mock/react-default';
    const prompt = String(((def?.prompt ?? {}) as { system?: string }).system ?? '');
    const tools = Array.isArray(def?.tools) ? def.tools.length : 0;
    const maxSteps = Number(((def?.limits ?? {}) as { max_steps?: number }).max_steps ?? 25);
    return { model, prompt, tools, maxSteps };
  };

  const leftSummary = getSummary(selectedVer?.definition);
  const rightSummary = getSummary(compareVer?.definition);

  return (
    <div
      role="tabpanel"
      aria-label="Agent Versions"
      style={{
        padding: '18px 20px',
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        gap: '16px',
        alignItems: 'start',
      }}
    >
      {/* Left: Version Timeline */}
      <section
        aria-label="Version timeline"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px',
          display: 'grid',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13.5px' }}>
          <History size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Version Timeline ({agent.versions.length})</span>
        </div>

        <div style={{ display: 'grid', gap: '6px' }}>
          {agent.versions.map((ver) => {
            const active = ver.id === selectedVer?.id;
            return (
              <button
                key={ver.id}
                type="button"
                onClick={() => setSelectedVerId(ver.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  border: active ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                  backgroundColor: active ? 'var(--lavender-soft)' : 'var(--surface)',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>v{ver.semver}</strong>
                  <StatusChip
                    label={ver.state}
                    tone={ver.state === 'published' ? 'success' : 'neutral'}
                  />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {ver.message ?? 'Configuration snapshot'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  By {ver.createdBy} · {ver.createdAt.slice(0, 10)} · Eval 91%
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Right: Version Details + Side-by-Side Comparison */}
      <section
        aria-label="Version inspector and comparison"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
              Version v{selectedVer?.semver ?? '1.0.0'} Details
            </h3>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Hash: <code>{selectedVer?.definitionHash ?? 'sha256'}</code>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {selectedVer && (
              <>
                <button
                  type="button"
                  onClick={() => onRestoreVersion(selectedVer.semver)}
                  style={{
                    minHeight: '30px',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>Restore Version</span>
                </button>
                <button
                  type="button"
                  onClick={() => onForkVersion(selectedVer.semver)}
                  style={{
                    minHeight: '30px',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <GitFork size={12} aria-hidden="true" />
                  <span>Fork Version</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onPromoteTab}
              style={{
                minHeight: '30px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: 'var(--brand)',
                color: 'var(--brand-contrast)',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              <Rocket size={12} aria-hidden="true" />
              <span>Submit Promotion Request</span>
            </button>
          </div>
        </div>

        {/* Side-by-Side Comparison */}
        <div
          style={{
            padding: '12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px' }}>
              <GitCompare size={14} style={{ color: 'var(--brand)' }} aria-hidden="true" />
              <span>Side-by-Side Comparison</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <select
                aria-label="Compare against version"
                value={compareVerId}
                onChange={(e) => setCompareVerId(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '12px' }}
              >
                {agent.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Compare: v{v.semver} ({v.state})
                  </option>
                ))}
              </select>
              {agent.publishedVersion && agent.draftVersion && (
                <button
                  type="button"
                  onClick={onComputeDiff}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Compute API Diff
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
            <div style={{ padding: '10px', borderRadius: '6px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <strong>Selected: v{selectedVer?.semver ?? '1.0.0'}</strong>
              <div>Model: {leftSummary.model}</div>
              <div>Tools: {leftSummary.tools}</div>
              <div>Max Steps: {leftSummary.maxSteps}</div>
              <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
                Prompt: {leftSummary.prompt.slice(0, 90) || '—'}
              </div>
            </div>
            <div style={{ padding: '10px', borderRadius: '6px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <strong>Baseline: v{compareVer?.semver ?? '1.0.0'}</strong>
              <div>Model: {rightSummary.model}</div>
              <div>Tools: {rightSummary.tools}</div>
              <div>Max Steps: {rightSummary.maxSteps}</div>
              <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
                Prompt: {rightSummary.prompt.slice(0, 90) || '—'}
              </div>
            </div>
          </div>

          {versionDiff && (
            <div style={{ fontSize: '12px' }}>
              <strong>Detected Changes ({versionDiff.changes.length}):</strong>{' '}
              {versionDiff.changes.map((c) => `${c.path} (${c.kind})`).join(', ')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
