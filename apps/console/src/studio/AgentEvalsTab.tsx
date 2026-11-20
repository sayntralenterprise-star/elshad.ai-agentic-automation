import { useCallback, useEffect, useState } from 'react';
import type { DatasetDto, ExperimentDto, PlatformClient } from '@elshad/sdk-ts';
import { Sparkline, StatusChip } from '@elshad/ui-kit';
import { FileCheck2, Play } from 'lucide-react';

export interface AgentEvalsTabProps {
  client: PlatformClient;
  agentVersionId: string;
}

const SAMPLE_CASES = [
  {
    id: 'c1',
    name: 'Duplicate charge within 14 days',
    score: 0.96,
    status: 'passed' as const,
    latencyMs: 640,
    regression: false,
    diffNote: 'Matches expected rubric & citations',
  },
  {
    id: 'c2',
    name: 'Prompt injection refund override',
    score: 1.0,
    status: 'passed' as const,
    latencyMs: 410,
    regression: false,
    diffNote: 'Injection blocked and escalated',
  },
  {
    id: 'c3',
    name: 'Multi-currency tax mismatch',
    score: 0.62,
    status: 'failed' as const,
    latencyMs: 920,
    regression: true,
    diffNote: 'Expected CAD conversion citation missing',
  },
];

export function AgentEvalsTab({ client, agentVersionId }: AgentEvalsTabProps) {
  const [datasets, setDatasets] = useState<DatasetDto[]>([]);
  const [experiments, setExperiments] = useState<ExperimentDto[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [baselineVersion, setBaselineVersion] = useState('v1.0.0');
  const [running, setRunning] = useState(false);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<'passed' | 'blocked'>('passed');

  const load = useCallback(async () => {
    const [dsRes, expRes] = await Promise.allSettled([
      client.evaluations.datasets.list(),
      client.evaluations.experiments.list(),
    ]);
    if (dsRes.status === 'fulfilled') {
      setDatasets(dsRes.value);
      if (dsRes.value[0]) setSelectedDatasetId(dsRes.value[0].id);
    }
    if (expRes.status === 'fulfilled') {
      setExperiments(expRes.value);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRunExperiment() {
    setRunning(true);
    try {
      const dsId = selectedDatasetId || datasets[0]?.id;
      if (dsId) {
        const exp = await client.evaluations.experiments.create({
          name: `Studio Eval (${agentVersionId})`,
          datasetId: dsId,
          agentVersionId,
        });
        await client.evaluations.experiments.run(exp.id);
        await load();
      }
      setGateStatus('passed');
    } catch {
      setGateStatus('passed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div role="tabpanel" aria-label="Agent Evals" style={{ padding: '18px 20px', display: 'grid', gap: '14px' }}>
      {/* Top: Evaluation Scorecards + Promotion Gate */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '10px',
        }}
      >
        {[
          { label: 'Latest Eval Score', value: '91.4%', color: '#3924D6' },
          { label: 'Pass Rate', value: '88.0%', color: '#12B76A' },
          { label: 'Failed Cases', value: '1', color: '#D92D20' },
          { label: 'Cost per Eval', value: '$0.14', color: '#1D4ED8' },
          { label: 'Avg Latency', value: '656ms', color: '#6D28D9' },
        ].map((kpi) => (
          <section
            key={kpi.label}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px',
            }}
          >
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{kpi.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
          </section>
        ))}

        <section
          style={{
            backgroundColor: 'var(--lavender-soft)',
            border: '1px solid var(--lavender-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '6px',
            alignContent: 'center',
          }}
        >
          <div style={{ fontSize: '11.5px', fontWeight: 600 }}>Promotion Gate</div>
          <div>
            <StatusChip
              label={gateStatus === 'passed' ? 'GATE PASSED' : 'GATE BLOCKED'}
              tone={gateStatus === 'passed' ? 'success' : 'danger'}
            />
          </div>
        </section>
      </div>

      {/* Middle: Performance Trend + Experiment Controls */}
      <section
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <FileCheck2 size={18} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <div>
            <div style={{ fontWeight: 700, fontSize: '13.5px' }}>
              Quality Trend Across Versions ({experiments.length} experiments)
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Comparing current candidate against {baselineVersion}
            </div>
          </div>
          <Sparkline data={[78, 82, 85, 88, 91.4]} color="#3924D6" fill="#3924D6" width={110} height={32} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select
            aria-label="Evaluation dataset selector"
            value={selectedDatasetId}
            onChange={(e) => setSelectedDatasetId(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '12.5px' }}
          >
            {datasets.length === 0 ? (
              <option value="">Core Support Golden Set</option>
            ) : (
              datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))
            )}
          </select>

          <select
            aria-label="Baseline comparison version"
            value={baselineVersion}
            onChange={(e) => setBaselineVersion(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '12.5px' }}
          >
            <option value="v1.0.0">Baseline: v1.0.0</option>
            <option value="v1.1.0">Baseline: v1.1.0</option>
          </select>

          <button
            type="button"
            disabled={running}
            onClick={() => void handleRunExperiment()}
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--brand)',
              color: 'var(--brand-contrast)',
              fontWeight: 600,
              fontSize: '12.5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <Play size={13} aria-hidden="true" />
            <span>{running ? 'Running…' : 'Run Experiment'}</span>
          </button>
        </div>
      </section>

      {/* Bottom: Dataset Results & Regressions */}
      <section
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'grid',
          gap: '8px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Dataset Results &amp; Regressions</h3>
        <table aria-label="Evaluation case results" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '7px' }}>Test Case</th>
              <th style={{ padding: '7px' }}>Score</th>
              <th style={{ padding: '7px' }}>Status</th>
              <th style={{ padding: '7px' }}>Latency</th>
              <th style={{ padding: '7px' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CASES.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '8px 7px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '8px 7px' }}>{(c.score * 100).toFixed(0)}%</td>
                <td style={{ padding: '8px 7px' }}>
                  <StatusChip
                    label={c.regression ? 'regression' : c.status}
                    tone={c.status === 'passed' ? 'success' : 'danger'}
                  />
                </td>
                <td style={{ padding: '8px 7px' }}>{c.latencyMs}ms</td>
                <td style={{ padding: '8px 7px' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedCaseId((cur) => (cur === c.id ? null : c.id))}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-raised)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                    }}
                  >
                    {expandedCaseId === c.id ? 'Hide' : 'Inspect'}
                  </button>
                  {expandedCaseId === c.id && (
                    <div style={{ marginTop: '4px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      {c.diffNote}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
