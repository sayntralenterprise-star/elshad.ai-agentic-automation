import { useCallback, useEffect, useState } from 'react';
import { formatMicroUsdAsUsd, microUsd, PlatformError } from '@elshad/domain';
import type {
  DatasetDto,
  ExperimentDto,
  ExperimentResultDto,
  GraderDto,
  PlatformClient,
  TestCaseDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice, type BadgeTone } from '@elshad/ui-kit';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileCheck2,
  FlaskConical,
  Play,
  Plus,
  Wrench,
  XCircle,
} from 'lucide-react';

export interface EvaluationsViewProps {
  client: PlatformClient;
  workspaceId?: string;
  initialSaveRunId?: string | null;
}

type EvalTab = 'datasets' | 'graders' | 'experiments';

export function EvaluationsView({ client, workspaceId }: EvaluationsViewProps) {
  const [activeTab, setActiveTab] = useState<EvalTab>('datasets');

  // Datasets & Test Cases state
  const [datasets, setDatasets] = useState<DatasetDto[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCaseDto[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(null);

  // Graders state
  const [graders, setGraders] = useState<GraderDto[]>([]);

  // Experiments state
  const [experiments, setExperiments] = useState<ExperimentDto[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [experimentResults, setExperimentResults] = useState<ExperimentResultDto[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  // Status & notifications
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal / Form toggles
  const [showNewDatasetModal, setShowNewDatasetModal] = useState(false);
  const [showNewTestCaseModal, setShowNewTestCaseModal] = useState(false);
  const [showNewGraderModal, setShowNewGraderModal] = useState(false);
  const [showNewExpModal, setShowNewExpModal] = useState(false);

  // Form states
  const [newDsName, setNewDsName] = useState('');
  const [newDsDesc, setNewDsDesc] = useState('');
  const [newDsTags, setNewDsTags] = useState('billing, regression');

  const [newTcName, setNewTcName] = useState('');
  const [newTcInputs, setNewTcInputs] = useState('{\n  "prompt": "User requesting refund"\n}');
  const [newTcExpected, setNewTcExpected] = useState('{\n  "result": "Refund approved"\n}');
  const [newTcDifficulty, setNewTcDifficulty] = useState<'easy' | 'medium' | 'hard' | 'adversarial'>('medium');

  const [newGrdName, setNewGrdName] = useState('');
  const [newGrdType, setNewGrdType] = useState<GraderDto['type']>('exact_match');
  const [newGrdConfig, setNewGrdConfig] = useState('{\n  "case_sensitive": false,\n  "trim": true\n}');

  const [newExpName, setNewExpName] = useState('');
  const [newExpAgentVerId, setNewExpAgentVerId] = useState('');
  const [newExpBaselineId, setNewExpBaselineId] = useState('');
  const [newExpMinPassRate, setNewExpMinPassRate] = useState('0.95');

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dsList, grdList, expList] = await Promise.all([
        client.evaluations.datasets.list(),
        client.evaluations.graders.list(),
        client.evaluations.experiments.list(),
      ]);
      setDatasets(dsList);
      setGraders(grdList);
      setExperiments(expList);
      if (dsList.length > 0 && !selectedDatasetId) {
        setSelectedDatasetId(dsList[0]!.id);
      }
      if (expList.length > 0 && !selectedExperimentId) {
        setSelectedExperimentId(expList[0]!.id);
      }
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, selectedDatasetId, selectedExperimentId]);

  useEffect(() => {
    void loadData();
  }, [loadData, workspaceId]);

  // Load test cases when selected dataset changes
  useEffect(() => {
    if (!selectedDatasetId) {
      setTestCases([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cases = await client.evaluations.datasets.listTestCases(selectedDatasetId);
        if (!cancelled) {
          setTestCases(cases);
          setSelectedTestCaseId(cases[0]?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedDatasetId]);

  // Load experiment results when selected experiment changes
  useEffect(() => {
    if (!selectedExperimentId) {
      setExperimentResults([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await client.evaluations.experiments.results(selectedExperimentId);
        if (!cancelled) {
          setExperimentResults(res);
          setSelectedResultId(res[0]?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedExperimentId]);

  // Handlers for creating entities
  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    try {
      const tags = newDsTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const created = await client.evaluations.datasets.create({
        name: newDsName.trim(),
        description: newDsDesc.trim() || undefined,
        tags,
      });
      setDatasets((prev) => [created, ...prev]);
      setSelectedDatasetId(created.id);
      setShowNewDatasetModal(false);
      setNewDsName('');
      setNewDsDesc('');
      setNotice(`Created evaluation dataset "${created.name}"`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateTestCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDatasetId) return;
    setActionLoading(true);
    setError(null);
    try {
      const parsedInputs = JSON.parse(newTcInputs) as Record<string, unknown>;
      const parsedExpected = newTcExpected.trim()
        ? (JSON.parse(newTcExpected) as Record<string, unknown>)
        : undefined;

      const created = await client.evaluations.datasets.createTestCase(selectedDatasetId, {
        name: newTcName.trim(),
        inputs: parsedInputs,
        expectedOutput: parsedExpected,
        difficulty: newTcDifficulty,
      });
      setTestCases((prev) => [created, ...prev]);
      setSelectedTestCaseId(created.id);
      setShowNewTestCaseModal(false);
      setNewTcName('');
      setNotice(`Created test case "${created.name}"`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateGrader = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    try {
      const config = JSON.parse(newGrdConfig) as Record<string, unknown>;
      const created = await client.evaluations.graders.create({
        name: newGrdName.trim(),
        type: newGrdType,
        config,
      });
      setGraders((prev) => [created, ...prev]);
      setShowNewGraderModal(false);
      setNewGrdName('');
      setNotice(`Created grader "${created.name}"`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDatasetId) return;
    setActionLoading(true);
    setError(null);
    try {
      const minPassRate = Number(newExpMinPassRate) || 0.95;
      const created = await client.evaluations.experiments.create({
        name: newExpName.trim(),
        datasetId: selectedDatasetId,
        agentVersionId: newExpAgentVerId.trim() || 'agv_latest',
        baselineVersionId: newExpBaselineId.trim() || undefined,
        graderIds: graders.map((g) => g.id),
        releaseGateConfig: { min_pass_rate: minPassRate, fail_on_critical_regression: true },
      });
      setExperiments((prev) => [created, ...prev]);
      setSelectedExperimentId(created.id);
      setShowNewExpModal(false);
      setNewExpName('');
      setNotice(`Created experiment "${created.name}"`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunExperiment = async (expId: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const updated = await client.evaluations.experiments.run(expId);
      setExperiments((prev) => prev.map((e) => (e.id === expId ? updated : e)));
      const res = await client.evaluations.experiments.results(expId);
      setExperimentResults(res);
      setSelectedResultId(res[0]?.id ?? null);
      setNotice(
        `Experiment run completed. Verdict: ${updated.gateVerdict?.toUpperCase() ?? 'COMPLETED'}`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);
  const selectedExperiment = experiments.find((e) => e.id === selectedExperimentId);
  const selectedResult = experimentResults.find((r) => r.id === selectedResultId);

  const verdictTone = (verdict?: string | null): BadgeTone => {
    if (verdict === 'passed') return 'success';
    if (verdict === 'failed') return 'danger';
    if (verdict === 'warning') return 'warning';
    return 'neutral';
  };

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* Header & Sub-nav */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCheck2 size={24} color="var(--primary)" />
            Evaluations &amp; Release Gates
          </h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
            Golden datasets, automated graders, side-by-side experiments, and CI/CD promotion gates (PRD §5.6, §7.3.9)
          </p>
        </div>

        {/* Tab Buttons */}
        <div
          role="tablist"
          aria-label="Evaluation Navigation Tabs"
          style={{
            display: 'flex',
            gap: '4px',
            backgroundColor: 'var(--surface-sunken)',
            padding: '4px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'datasets'}
            onClick={() => setActiveTab('datasets')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'datasets' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'datasets' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'datasets' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Database size={16} />
            Datasets &amp; Test Cases
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'graders'}
            onClick={() => setActiveTab('graders')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'graders' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'graders' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'graders' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Wrench size={16} />
            Pluggable Graders
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'experiments'}
            onClick={() => setActiveTab('experiments')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'experiments' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'experiments' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'experiments' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FlaskConical size={16} />
            Experiments &amp; Gates
          </button>
        </div>
      </div>

      {notice && <SuccessNotice message={notice} />}
      {error && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <StateView
          state="loading"
          title="Loading evaluation framework..."
          description="Fetching datasets, graders, and experiment runs."
        />
      )}

      {!loading && activeTab === 'datasets' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>
          {/* Datasets Sidebar */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '15px' }}>Golden Sets</h2>
              <button
                type="button"
                onClick={() => setShowNewDatasetModal(true)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                }}
              >
                <Plus size={14} /> New Set
              </button>
            </div>

            {datasets.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                No datasets created yet.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {datasets.map((ds) => {
                  const isSelected = ds.id === selectedDatasetId;
                  return (
                    <button
                      key={ds.id}
                      type="button"
                      onClick={() => setSelectedDatasetId(ds.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border)',
                        backgroundColor: isSelected ? 'var(--primary-subtle, rgba(59,130,246,0.08))' : 'var(--surface)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'grid',
                        gap: '4px',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                        {ds.name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {ds.description || 'No description'}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {ds.tags.map((t) => (
                          <StatusChip key={t} label={t} tone="neutral" />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Test Cases Table & Details */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {selectedDataset ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '18px' }}>{selectedDataset.name}</h2>
                    <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      {testCases.length} test cases in golden set
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewTestCaseModal(true)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    <Plus size={16} /> Add Test Case
                  </button>
                </div>

                {testCases.length === 0 ? (
                  <StateView
                    state="empty"
                    title="No test cases in this golden set"
                    description="Add a test case manually, import JSONL, or click 'Save as Test Case' on any production run."
                  />
                ) : (
                  <table
                    aria-label="Test Cases Table"
                    style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
                  >
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '8px' }}>Test Case</th>
                        <th style={{ padding: '8px' }}>Difficulty</th>
                        <th style={{ padding: '8px' }}>Weight</th>
                        <th style={{ padding: '8px' }}>Provenance</th>
                        <th style={{ padding: '8px' }}>Inputs Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testCases.map((tc) => {
                        const isSelected = tc.id === selectedTestCaseId;
                        return (
                          <tr
                            key={tc.id}
                            onClick={() => setSelectedTestCaseId(tc.id)}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              cursor: 'pointer',
                              backgroundColor: isSelected ? 'var(--primary-subtle, rgba(59,130,246,0.05))' : 'transparent',
                            }}
                          >
                            <td style={{ padding: '10px 8px', fontWeight: 500 }}>
                              {tc.name}
                            </td>
                            <td style={{ padding: '10px 8px' }}>
                              <StatusChip
                                label={tc.difficulty}
                                tone={
                                  tc.difficulty === 'adversarial' || tc.difficulty === 'hard'
                                    ? 'danger'
                                    : tc.difficulty === 'medium'
                                    ? 'warning'
                                    : 'success'
                                }
                              />
                            </td>
                            <td style={{ padding: '10px 8px' }}>{tc.weight}x</td>
                            <td style={{ padding: '10px 8px' }}>
                              {tc.sourceRunId ? (
                                <StatusChip label={`Run: ${tc.sourceRunId.slice(0, 10)}`} tone="info" />
                              ) : (
                                <StatusChip label="Manual" tone="neutral" />
                              )}
                            </td>
                            <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {JSON.stringify(tc.inputs).slice(0, 50)}...
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <StateView
                state="empty"
                title="Select a dataset"
                description="Choose an existing golden set or create a new one."
              />
            )}
          </div>
        </div>
      )}

      {!loading && activeTab === 'graders' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Pluggable Automated Graders (FR-EV-2)</h2>
            <button
              type="button"
              onClick={() => setShowNewGraderModal(true)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
              }}
            >
              <Plus size={16} /> New Grader
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {graders.map((grd) => (
              <div
                key={grd.id}
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>{grd.name}</div>
                  <StatusChip label={grd.type} tone="info" />
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {grd.description || 'Configured evaluator'}
                </p>
                <div style={{ marginTop: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Config:
                  </span>
                  <pre
                    style={{
                      margin: '4px 0 0 0',
                      padding: '8px',
                      backgroundColor: 'var(--surface-sunken)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(grd.config, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && activeTab === 'experiments' && (
        <div style={{ display: 'grid', gap: '20px' }}>
          {/* Experiments Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Experiment Runs &amp; Release Gates (FR-EV-3, FR-EV-4)</h2>
            <button
              type="button"
              onClick={() => setShowNewExpModal(true)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
              }}
            >
              <Plus size={16} /> New Experiment
            </button>
          </div>

          {/* Experiments Selector Bar */}
          {experiments.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                overflowX: 'auto',
                paddingBottom: '4px',
              }}
            >
              {experiments.map((exp) => {
                const isSelected = exp.id === selectedExperimentId;
                return (
                  <button
                    key={exp.id}
                    type="button"
                    onClick={() => setSelectedExperimentId(exp.id)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'var(--primary-subtle, rgba(59,130,246,0.08))' : 'var(--surface)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {exp.name}
                    </span>
                    <StatusChip label={exp.gateVerdict ?? exp.status} tone={verdictTone(exp.gateVerdict)} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected Experiment View */}
          {selectedExperiment ? (
            <div style={{ display: 'grid', gap: '16px' }}>
              {/* Summary Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Release Gate Verdict</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {selectedExperiment.gateVerdict === 'passed' ? (
                      <CheckCircle2 color="var(--success)" size={20} />
                    ) : selectedExperiment.gateVerdict === 'failed' ? (
                      <XCircle color="var(--danger)" size={20} />
                    ) : (
                      <AlertTriangle color="var(--warning)" size={20} />
                    )}
                    {(selectedExperiment.gateVerdict ?? 'PENDING').toUpperCase()}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Pass Rate</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}>
                    {selectedExperiment.metrics['pass_rate'] !== undefined
                      ? `${(Number(selectedExperiment.metrics['pass_rate']) * 100).toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {String(selectedExperiment.metrics['passed_cases'] ?? 0)} / {String(selectedExperiment.metrics['total_cases'] ?? 0)} cases passed
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Average Score</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}>
                    {selectedExperiment.metrics['avg_score'] !== undefined
                      ? `${Number(selectedExperiment.metrics['avg_score']).toFixed(2)}`
                      : 'N/A'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {String(selectedExperiment.metrics['regression_count'] ?? 0)} regressions vs baseline
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Total Cost &amp; Latency</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>
                    {selectedExperiment.metrics['total_cost_micro_usd'] !== undefined
                      ? formatMicroUsdAsUsd(microUsd(Number(selectedExperiment.metrics['total_cost_micro_usd'])), 4)
                      : '$0.00'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Avg {String(selectedExperiment.metrics['avg_duration_ms'] ?? 0)} ms per case
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleRunExperiment(selectedExperiment.id)}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 600,
                  }}
                >
                  <Play size={16} /> Run Evaluation Experiment
                </button>
              </div>

              {/* Results Matrix & Diff Viewer */}
              <div style={{ display: 'grid', gridTemplateColumns: selectedResult ? '1fr 380px' : '1fr', gap: '16px' }}>
                <div
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>
                    Results Matrix ({experimentResults.length} test cases evaluated)
                  </h3>
                  {experimentResults.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                      Click &quot;Run Evaluation Experiment&quot; to execute all cases and view results.
                    </p>
                  ) : (
                    <table
                      aria-label="Experiment Results Matrix"
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                          <th style={{ padding: '8px' }}>Test Case</th>
                          <th style={{ padding: '8px' }}>Verdict</th>
                          <th style={{ padding: '8px' }}>Score</th>
                          <th style={{ padding: '8px' }}>Duration</th>
                          <th style={{ padding: '8px' }}>Graders</th>
                          <th style={{ padding: '8px' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {experimentResults.map((r) => {
                          const isSelected = r.id === selectedResultId;
                          return (
                            <tr
                              key={r.id}
                              style={{
                                borderBottom: '1px solid var(--border)',
                                backgroundColor: isSelected ? 'var(--primary-subtle, rgba(59,130,246,0.05))' : 'transparent',
                              }}
                            >
                              <td style={{ padding: '8px', fontWeight: 500 }}>
                                {r.testCaseId}
                                {r.isRegression && (
                                  <span style={{ marginLeft: '6px' }}>
                                    <StatusChip label="Regression" tone="danger" />
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px' }}>
                                <StatusChip label={r.passed ? 'PASSED' : 'FAILED'} tone={r.passed ? 'success' : 'danger'} />
                              </td>
                              <td style={{ padding: '8px', fontWeight: 600 }}>{r.score.toFixed(2)}</td>
                              <td style={{ padding: '8px' }}>{r.durationMs} ms</td>
                              <td style={{ padding: '8px' }}>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  {r.graderResults.filter((g: Record<string, unknown>) => Boolean(g['passed'])).length} / {r.graderResults.length} passed
                                </span>
                              </td>
                              <td style={{ padding: '8px' }}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedResultId(r.id)}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border)',
                                    backgroundColor: 'var(--surface-raised)',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  Diff <ChevronRight size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Diff & Graders Drawer */}
                {selectedResult && (
                  <div
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '16px',
                      display: 'grid',
                      gap: '12px',
                      maxHeight: '600px',
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ margin: 0, fontSize: '14px' }}>Case Evaluation Inspector</h4>
                      <StatusChip label={selectedResult.passed ? 'PASSED' : 'FAILED'} tone={selectedResult.passed ? 'success' : 'danger'} />
                    </div>

                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        Actual Output:
                      </span>
                      <pre
                        style={{
                          margin: '4px 0',
                          padding: '8px',
                          backgroundColor: 'var(--surface-sunken)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          overflowX: 'auto',
                        }}
                      >
                        {JSON.stringify(selectedResult.actualOutput, null, 2)}
                      </pre>
                    </div>

                    {selectedResult.diff && (
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--danger)', textTransform: 'uppercase' }}>
                          Mismatches / Diff:
                        </span>
                        <pre
                          style={{
                            margin: '4px 0',
                            padding: '8px',
                            backgroundColor: 'var(--danger-bg)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            overflowX: 'auto',
                          }}
                        >
                          {JSON.stringify(selectedResult.diff, null, 2)}
                        </pre>
                      </div>
                    )}

                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        Grader Breakdown:
                      </span>
                      <div style={{ display: 'grid', gap: '6px', marginTop: '4px' }}>
                        {selectedResult.graderResults.map((g: Record<string, unknown>, idx: number) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'var(--surface-sunken)',
                              fontSize: '12px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                              <span>{String(g['grader_name'] ?? 'Grader')}</span>
                              <span style={{ color: g['passed'] ? 'var(--success)' : 'var(--danger)' }}>
                                {g['passed'] ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {String(g['rationale'] ?? '')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <StateView
              state="empty"
              title="No experiment selected"
              description="Create a new evaluation experiment to compare versions and enforce release gates."
            />
          )}
        </div>
      )}

      {/* New Dataset Modal */}
      {showNewDatasetModal && (
        <div
          role="dialog"
          aria-label="New Dataset Dialog"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <form
            onSubmit={handleCreateDataset}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              width: '420px',
              display: 'grid',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px' }}>Create Golden Dataset</h3>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Dataset Name</label>
              <input
                type="text"
                required
                value={newDsName}
                onChange={(e) => setNewDsName(e.target.value)}
                placeholder="e.g. Support Triage Regression Set"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Description</label>
              <input
                type="text"
                value={newDsDesc}
                onChange={(e) => setNewDsDesc(e.target.value)}
                placeholder="Purpose of this golden set"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Tags (comma-separated)</label>
              <input
                type="text"
                value={newDsTags}
                onChange={(e) => setNewDsTags(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowNewDatasetModal(false)}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'white' }}
              >
                Create Dataset
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Test Case Modal */}
      {showNewTestCaseModal && (
        <div
          role="dialog"
          aria-label="New Test Case Dialog"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <form
            onSubmit={handleCreateTestCase}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              width: '460px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px' }}>Add Test Case to Dataset</h3>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Test Case Name</label>
              <input
                type="text"
                required
                value={newTcName}
                onChange={(e) => setNewTcName(e.target.value)}
                placeholder="e.g. Standard refund within 14 days"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Difficulty</label>
              <select
                value={newTcDifficulty}
                onChange={(e) => setNewTcDifficulty(e.target.value as typeof newTcDifficulty)}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="adversarial">Adversarial</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Inputs (JSON)</label>
              <textarea
                rows={3}
                required
                value={newTcInputs}
                onChange={(e) => setNewTcInputs(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Expected Output (JSON)</label>
              <textarea
                rows={3}
                value={newTcExpected}
                onChange={(e) => setNewTcExpected(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowNewTestCaseModal(false)}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'white' }}
              >
                Add Test Case
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Grader Modal */}
      {showNewGraderModal && (
        <div
          role="dialog"
          aria-label="New Grader Dialog"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <form
            onSubmit={handleCreateGrader}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              width: '460px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px' }}>Register Pluggable Grader</h3>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Grader Name</label>
              <input
                type="text"
                required
                value={newGrdName}
                onChange={(e) => setNewGrdName(e.target.value)}
                placeholder="e.g. Strict JSON Validator"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Type</label>
              <select
                value={newGrdType}
                onChange={(e) => setNewGrdType(e.target.value as GraderDto['type'])}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              >
                <option value="exact_match">Exact Match</option>
                <option value="json_schema">JSON Schema</option>
                <option value="code_assertion">Code Assertion</option>
                <option value="llm_judge">LLM Judge (Rubric)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Config (JSON)</label>
              <textarea
                rows={4}
                required
                value={newGrdConfig}
                onChange={(e) => setNewGrdConfig(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowNewGraderModal(false)}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'white' }}
              >
                Register Grader
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Experiment Modal */}
      {showNewExpModal && (
        <div
          role="dialog"
          aria-label="New Experiment Dialog"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <form
            onSubmit={handleCreateExperiment}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              width: '460px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px' }}>Configure Evaluation Experiment</h3>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Experiment Name</label>
              <input
                type="text"
                required
                value={newExpName}
                onChange={(e) => setNewExpName(e.target.value)}
                placeholder="e.g. Candidate v1.0.1 Regression Check"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Candidate Version ID</label>
              <input
                type="text"
                value={newExpAgentVerId}
                onChange={(e) => setNewExpAgentVerId(e.target.value)}
                placeholder="agv_candidate_id (or leave blank for latest)"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Baseline Version ID (Optional)</label>
              <input
                type="text"
                value={newExpBaselineId}
                onChange={(e) => setNewExpBaselineId(e.target.value)}
                placeholder="agv_baseline_id (for side-by-side regression check)"
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Minimum Pass Rate (0.0 to 1.0)</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={newExpMinPassRate}
                onChange={(e) => setNewExpMinPassRate(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowNewExpModal(false)}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'white' }}
              >
                Create Experiment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
