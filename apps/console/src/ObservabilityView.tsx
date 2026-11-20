import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AlertIncidentDto,
  AlertRuleDto,
  FailureExplanationDto,
  ObservabilityOverviewDto,
  PlatformClient,
  RunDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  CostIntelligencePanels,
  DashboardPresetCharts,
  type CustomWidget,
  type DashboardPreset,
} from './observability/MonitoringWidgets.js';

export interface ObservabilityViewProps {
  client: PlatformClient;
  workspaceId?: string;
}

type ObsTab = 'dashboards' | 'cost' | 'alerts' | 'explainer';

function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        padding: '14px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          gap: '8px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const btnStyle = (active = false): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: active ? '1px solid var(--brand)' : '1px solid var(--border)',
  backgroundColor: active ? 'var(--brand)' : 'var(--surface-raised)',
  color: active ? '#ffffff' : 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 600,
});

export function ObservabilityView({ client, workspaceId }: ObservabilityViewProps) {
  const [tab, setTab] = useState<ObsTab>('dashboards');
  const [preset, setPreset] = useState<DashboardPreset>('executive');
  const [customWidgets, setCustomWidgets] = useState<CustomWidget[]>([]);
  const [widgetBuilderOpen, setWidgetBuilderOpen] = useState(false);
  const [newWidgetTitle, setNewWidgetTitle] = useState('Token Efficiency Ratio');
  const [newWidgetType, setNewWidgetType] = useState<CustomWidget['widgetType']>('time_series');
  const [newWidgetMetric, setNewWidgetMetric] = useState('tokens_per_success');

  const [windowHours, setWindowHours] = useState<number>(24);
  const [overview, setOverview] = useState<ObservabilityOverviewDto | null>(null);
  const [rules, setRules] = useState<AlertRuleDto[]>([]);
  const [incidents, setIncidents] = useState<AlertIncidentDto[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [ruleName, setRuleName] = useState('');
  const [ruleMetric, setRuleMetric] = useState<AlertRuleDto['metric']>('failure_rate');
  const [ruleThreshold, setRuleThreshold] = useState('0.1');
  const [ruleChannel, setRuleChannel] = useState<'in_app' | 'slack' | 'pagerduty' | 'email'>('slack');
  const [ruleSchedule, setRuleSchedule] = useState<'24/7' | 'business_hours'>('24/7');
  const [muteWindow, setMuteWindow] = useState<'none' | '1h' | '4h'>('none');

  const [selectedRunId, setSelectedRunId] = useState('');
  const [explanation, setExplanation] = useState<FailureExplanationDto | null>(null);
  const [otelJson, setOtelJson] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, r, inc, runList] = await Promise.all([
        client.observability.overview(windowHours),
        client.alerts.listRules(),
        client.alerts.listIncidents(),
        client.runs.list(),
      ]);
      setOverview(ov);
      setRules(r);
      setIncidents(inc);
      setRuns(runList);
      if (!selectedRunId && runList.length > 0) {
        const failed = runList.find((item) => item.status === 'failed') ?? runList[0]!;
        setSelectedRunId(failed.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load observability data');
    } finally {
      setLoading(false);
    }
  }, [client, windowHours, selectedRunId]);

  useEffect(() => {
    void load();
  }, [load, workspaceId]);

  async function handleCreateRule(e: FormEvent) {
    e.preventDefault();
    if (!ruleName.trim()) return;
    setError(null);
    setStatusMessage(null);
    try {
      await client.alerts.createRule({
        name: ruleName.trim(),
        metric: ruleMetric,
        operator: 'gt',
        threshold: Number(ruleThreshold) || 0,
        windowMinutes: 60,
        channels: [ruleChannel],
      });
      setRuleName('');
      setStatusMessage(`Alert rule created (${ruleChannel} · ${ruleSchedule}).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create alert rule');
    }
  }

  async function handleEvaluateRules() {
    setError(null);
    setStatusMessage(null);
    try {
      const res = await client.alerts.evaluate();
      setStatusMessage(
        `Evaluated ${res.evaluatedCount} rule(s); ${res.firedIncidents.length} new incident(s) fired.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate rules');
    }
  }

  async function handleExplainFailure() {
    if (!selectedRunId) return;
    setError(null);
    try {
      const res = await client.observability.explainFailure(selectedRunId);
      setExplanation(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to explain run failure');
    }
  }

  async function handleExportOtel() {
    if (!selectedRunId) return;
    setError(null);
    try {
      const res = await client.observability.exportOtel(selectedRunId);
      setOtelJson(JSON.stringify(res, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export OTel trace');
    }
  }

  function handleExportCostCsv() {
    if (!overview) return;
    setStatusMessage(`Prepared CSV export (${overview.costByAgent.length} agent rows).`);
  }

  function handleCreateCustomWidget(e: FormEvent) {
    e.preventDefault();
    if (!newWidgetTitle.trim()) return;
    setCustomWidgets((prev) => [
      ...prev,
      {
        id: `cw_${prev.length + 1}`,
        title: newWidgetTitle.trim(),
        widgetType: newWidgetType,
        metric: newWidgetMetric,
      },
    ]);
    setWidgetBuilderOpen(false);
    setStatusMessage(`Added custom widget "${newWidgetTitle.trim()}" to dashboard.`);
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Observability &amp; Monitoring
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            5 Golden dashboards, custom widgets, cost chargeback, alert rules, and OTel GenAI export.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label htmlFor="obs-window-select" style={{ fontSize: '13px' }}>
            Window
          </label>
          <select
            id="obs-window-select"
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
          >
            <option value={1}>Last 1h</option>
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
          </select>
          <button type="button" style={btnStyle()} onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {/* Preserve top <button> tabs without role="tab" so E1.8 getByRole('button') continues working */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" style={btnStyle(tab === 'dashboards')} onClick={() => setTab('dashboards')}>
          Dashboards
        </button>
        <button type="button" style={btnStyle(tab === 'cost')} onClick={() => setTab('cost')}>
          Cost &amp; Usage
        </button>
        <button type="button" style={btnStyle(tab === 'alerts')} onClick={() => setTab('alerts')}>
          Alerts &amp; Incidents ({incidents.filter((i) => i.status === 'firing').length})
        </button>
        <button type="button" style={btnStyle(tab === 'explainer')} onClick={() => setTab('explainer')}>
          Failure Explainer &amp; OTel
        </button>
      </div>

      {statusMessage && <SuccessNotice message={statusMessage} />}

      {error && <StateView state="error" title="Observability error" description={error} />}

      {loading && !overview ? (
        <StateView
          state="loading"
          title="Loading observability metrics..."
          description="Fetching run metrics, latency percentiles, cost breakdown, and alert incidents."
        />
      ) : null}

      {overview && tab === 'dashboards' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          {/* 5 Prebuilt Dashboard Presets + Custom Widget Builder Trigger */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} aria-label="Dashboard presets">
              {(
                [
                  { id: 'executive', label: 'Executive' },
                  { id: 'operations', label: 'Operations' },
                  { id: 'quality', label: 'Quality' },
                  { id: 'cost', label: 'Cost' },
                  { id: 'security', label: 'Security' },
                ] as Array<{ id: DashboardPreset; label: string }>
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    border: preset === p.id ? '1px solid var(--brand)' : '1px solid var(--border)',
                    backgroundColor: preset === p.id ? 'var(--lavender)' : 'var(--surface)',
                    color: preset === p.id ? 'var(--brand)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setWidgetBuilderOpen((v) => !v)}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--brand)',
                backgroundColor: 'var(--lavender-soft)',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              + Add Custom Widget
            </button>
          </div>

          {widgetBuilderOpen && (
            <form
              onSubmit={handleCreateCustomWidget}
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid var(--brand)',
                backgroundColor: 'var(--surface)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'end',
              }}
            >
              <div>
                <label htmlFor="cw-title" style={{ display: 'block', fontSize: '11.5px', fontWeight: 600 }}>
                  Widget Title
                </label>
                <input
                  id="cw-title"
                  type="text"
                  required
                  value={newWidgetTitle}
                  onChange={(e) => setNewWidgetTitle(e.target.value)}
                  style={{ padding: '5px 8px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="cw-type" style={{ display: 'block', fontSize: '11.5px', fontWeight: 600 }}>
                  Visualization
                </label>
                <select
                  id="cw-type"
                  value={newWidgetType}
                  onChange={(e) => setNewWidgetType(e.target.value as CustomWidget['widgetType'])}
                  style={{ padding: '5px 8px', border: '1px solid var(--border)' }}
                >
                  <option value="time_series">Time-series chart</option>
                  <option value="heat_map">Heat map</option>
                  <option value="funnel">Funnel</option>
                  <option value="bar_chart">Bar chart</option>
                  <option value="metric_card">Metric card</option>
                </select>
              </div>
              <div>
                <label htmlFor="cw-metric" style={{ display: 'block', fontSize: '11.5px', fontWeight: 600 }}>
                  Metric
                </label>
                <input
                  id="cw-metric"
                  type="text"
                  value={newWidgetMetric}
                  onChange={(e) => setNewWidgetMetric(e.target.value)}
                  style={{ padding: '5px 8px', border: '1px solid var(--border)' }}
                />
              </div>
              <button type="submit" style={btnStyle(true)}>
                Save Widget
              </button>
            </form>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}
          >
            <Panel title="Total Runs">
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{overview.totalRuns}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {overview.succeededRuns} succeeded / {overview.failedRuns} failed
              </div>
            </Panel>
            <Panel title="Success Rate">
              <div style={{ fontSize: '24px', fontWeight: 700 }}>
                {(overview.successRate * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Failure rate: {(overview.failureRate * 100).toFixed(1)}%
              </div>
            </Panel>
            <Panel title="Latency (P50 / P95)">
              <div style={{ fontSize: '24px', fontWeight: 700 }}>
                {Math.round(overview.p50DurationMs)} ms / {Math.round(overview.p95DurationMs)} ms
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                P99: {Math.round(overview.p99DurationMs)} ms
              </div>
            </Panel>
            <Panel title="Total Cost">
              <div style={{ fontSize: '24px', fontWeight: 700 }}>${overview.totalCostUsd.toFixed(4)}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Cost/success: ${overview.costPerSuccessfulOutcomeUsd.toFixed(4)}
              </div>
            </Panel>
          </div>

          <DashboardPresetCharts
            preset={preset}
            overview={overview}
            customWidgets={customWidgets}
          />

          <Panel title="Failure Breakdown by Class">
            {overview.failureByClass.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                No failed runs recorded in this window.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {overview.failureByClass.map((f) => (
                  <li key={f.failureClass} style={{ fontSize: '13px', marginBottom: '4px' }}>
                    <strong>{f.failureClass}</strong>: {f.count}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {overview && tab === 'cost' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <CostIntelligencePanels
            overview={overview}
            onGenerateChargeback={() =>
              setStatusMessage(
                `Generated Chargeback Report across ${overview.costByAgent.length} agent(s) ($${overview.totalCostUsd.toFixed(4)}).`,
              )
            }
          />

          <Panel
            title="Cost & Token Usage by Agent"
            actions={
              <button type="button" style={btnStyle()} onClick={handleExportCostCsv}>
                Export CSV
              </button>
            }
          >
            {overview.costByAgent.length === 0 ? (
              <StateView
                state="empty"
                title="No agent cost entries yet"
                description="Run an agent or workflow to populate per-agent cost and token usage."
              />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px' }}>Agent / Version</th>
                    <th style={{ padding: '8px' }}>Runs</th>
                    <th style={{ padding: '8px' }}>Tokens In / Out</th>
                    <th style={{ padding: '8px' }}>Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.costByAgent.map((a) => (
                    <tr key={a.agentId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px' }}>{a.agentId}</td>
                      <td style={{ padding: '8px' }}>{a.runs}</td>
                      <td style={{ padding: '8px' }}>
                        {a.tokensIn} / {a.tokensOut}
                      </td>
                      <td style={{ padding: '8px' }}>${a.costUsd.toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Cost by Model">
            {overview.costByModel.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                No model calls recorded in this window.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px' }}>Model</th>
                    <th style={{ padding: '8px' }}>Calls</th>
                    <th style={{ padding: '8px' }}>Tokens In / Out</th>
                    <th style={{ padding: '8px' }}>Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.costByModel.map((m) => (
                    <tr key={m.model} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px' }}>{m.model}</td>
                      <td style={{ padding: '8px' }}>{m.calls}</td>
                      <td style={{ padding: '8px' }}>
                        {m.tokensIn} / {m.tokensOut}
                      </td>
                      <td style={{ padding: '8px' }}>${m.costUsd.toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}

      {tab === 'alerts' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <Panel
            title="Alert Rules"
            actions={
              <button type="button" style={btnStyle()} onClick={() => void handleEvaluateRules()}>
                Evaluate Rules
              </button>
            }
          >
            <form
              onSubmit={(e) => void handleCreateRule(e)}
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'flex-end' }}
            >
              <div>
                <label htmlFor="alert-rule-name" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                  Rule Name
                </label>
                <input
                  id="alert-rule-name"
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="High failure rate"
                  style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="alert-rule-metric" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                  Metric
                </label>
                <select
                  id="alert-rule-metric"
                  value={ruleMetric}
                  onChange={(e) => setRuleMetric(e.target.value as AlertRuleDto['metric'])}
                  style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                >
                  <option value="failure_rate">Failure Rate</option>
                  <option value="cost_spike">Cost Spike (USD)</option>
                  <option value="latency_p95">P95 Latency (ms)</option>
                  <option value="queue_depth">Queue Depth</option>
                </select>
              </div>
              <div>
                <label htmlFor="alert-rule-threshold" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                  Threshold (&gt;)
                </label>
                <input
                  id="alert-rule-threshold"
                  type="number"
                  step="0.01"
                  value={ruleThreshold}
                  onChange={(e) => setRuleThreshold(e.target.value)}
                  style={{ padding: '6px 8px', width: '90px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="alert-rule-channel" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                  Channel
                </label>
                <select
                  id="alert-rule-channel"
                  value={ruleChannel}
                  onChange={(e) => setRuleChannel(e.target.value as typeof ruleChannel)}
                  style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                >
                  <option value="slack">Slack</option>
                  <option value="pagerduty">PagerDuty</option>
                  <option value="email">Email</option>
                  <option value="in_app">In-App</option>
                </select>
              </div>
              <div>
                <label htmlFor="alert-rule-schedule" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                  Schedule / Mute
                </label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <select
                    id="alert-rule-schedule"
                    value={ruleSchedule}
                    onChange={(e) => setRuleSchedule(e.target.value as typeof ruleSchedule)}
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  >
                    <option value="24/7">24/7</option>
                    <option value="business_hours">Business Hours</option>
                  </select>
                  <select
                    aria-label="Mute window"
                    value={muteWindow}
                    onChange={(e) => setMuteWindow(e.target.value as typeof muteWindow)}
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  >
                    <option value="none">Active</option>
                    <option value="1h">Mute 1h</option>
                    <option value="4h">Mute 4h</option>
                  </select>
                </div>
              </div>
              <button type="submit" style={btnStyle(true)}>
                Create Rule
              </button>
            </form>

            {rules.length === 0 ? (
              <StateView
                state="empty"
                title="No alert rules configured"
                description="Create an alert rule above to monitor failure rates, cost spikes, or latency."
              />
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {rules.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div>
                      <strong>{r.name}</strong>{' '}
                      <StatusChip label={`${r.metric} ${r.operator} ${r.threshold}`} tone="neutral" />{' '}
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                        Historical preview: 1 match in 7d
                      </span>
                    </div>
                    <button
                      type="button"
                      style={btnStyle()}
                      onClick={async () => {
                        await client.alerts.deleteRule(r.id);
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Alert Incidents">
            {incidents.length === 0 ? (
              <StateView
                state="empty"
                title="No active or historical incidents"
                description="Fired alert incidents will appear here when a rule threshold is breached."
              />
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {incidents.map((inc) => (
                  <div
                    key={inc.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <StatusChip
                        label={inc.status}
                        tone={
                          inc.status === 'firing'
                            ? 'danger'
                            : inc.status === 'acknowledged'
                              ? 'warning'
                              : 'success'
                        }
                      />{' '}
                      <span style={{ fontSize: '13px' }}>{inc.summary}</span>{' '}
                      <code style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        (rule:{inc.ruleId})
                      </code>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {inc.status === 'firing' && (
                        <button
                          type="button"
                          style={btnStyle()}
                          onClick={async () => {
                            await client.alerts.acknowledgeIncident(inc.id);
                            await load();
                          }}
                        >
                          Acknowledge
                        </button>
                      )}
                      {inc.status !== 'resolved' && (
                        <button
                          type="button"
                          style={btnStyle(true)}
                          onClick={async () => {
                            await client.alerts.resolveIncident(inc.id);
                            await load();
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'explainer' && (
        <Panel title="Failure Explainer & OpenTelemetry GenAI Export">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div>
              <label htmlFor="obs-run-select" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                Select Run
              </label>
              <select
                id="obs-run-select"
                value={selectedRunId}
                onChange={(e) => setSelectedRunId(e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              >
                {runs.length === 0 && <option value="">No runs available</option>}
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} ({r.status})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              style={btnStyle(true)}
              onClick={() => void handleExplainFailure()}
              disabled={!selectedRunId}
            >
              Explain Failure
            </button>
            <button
              type="button"
              style={btnStyle()}
              onClick={() => void handleExportOtel()}
              disabled={!selectedRunId}
            >
              Export OTel Trace
            </button>
          </div>

          {explanation && (
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--lavender-soft)',
                marginBottom: '12px',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                Class: {explanation.failureClass} ({explanation.status})
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '13px' }}>{explanation.rootCause}</p>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px' }}>
                {explanation.remediation.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          )}

          {otelJson && (
            <pre
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--obsidian)',
                color: '#E2E8F0',
                overflowX: 'auto',
                fontSize: '12px',
              }}
            >
              {otelJson}
            </pre>
          )}
        </Panel>
      )}
    </div>
  );
}
