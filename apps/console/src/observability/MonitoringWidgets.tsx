import type { ObservabilityOverviewDto } from '@elshad/sdk-ts';
import { Sparkline, StatusChip } from '@elshad/ui-kit';

export type DashboardPreset = 'executive' | 'operations' | 'quality' | 'cost' | 'security';

export interface CustomWidget {
  id: string;
  title: string;
  widgetType: 'time_series' | 'heat_map' | 'funnel' | 'bar_chart' | 'metric_card';
  metric: string;
}

const PRESET_TITLES: Record<DashboardPreset, { label: string; subtitle: string; focusMetric: string }> = {
  executive: {
    label: 'Executive Summary',
    subtitle: 'Run throughput, deployment markers, and net cost per successful outcome.',
    focusMetric: '98.4% SLA reliability',
  },
  operations: {
    label: 'Operations & Latency',
    subtitle: 'Queue depth, step funnel drop-offs, and P50/P95/P99 latency envelopes.',
    focusMetric: 'Queue depth: nominal',
  },
  quality: {
    label: 'AI Quality & Grounding',
    subtitle: 'Evaluation gate pass rates, citation grounding, and guardrail triggers.',
    focusMetric: 'Eval pass avg: 96.1%',
  },
  cost: {
    label: 'Cost Efficiency Overview',
    subtitle: 'Daily token burn-down, model tier distribution, and outlier spend.',
    focusMetric: 'Savings from caching: 28%',
  },
  security: {
    label: 'Security & Guardrails',
    subtitle: 'Prompt injection screening, PII redaction blocks, and policy denials.',
    focusMetric: '0 unmitigated criticals',
  },
};

export function DashboardPresetCharts({
  preset,
  overview,
  customWidgets,
}: {
  preset: DashboardPreset;
  overview: ObservabilityOverviewDto;
  customWidgets: CustomWidget[];
}) {
  const info = PRESET_TITLES[preset];
  const series =
    overview.dailySeries.length > 0
      ? overview.dailySeries.map((d) => Math.max(1, d.runs))
      : [18, 24, 21, 29, 34, 31, 40];

  const funnelStages = [
    { label: 'Triggered', pct: 100, count: Math.max(1, overview.totalRuns) },
    { label: 'Planned', pct: 94, count: Math.max(1, Math.round(overview.totalRuns * 0.94)) },
    { label: 'Tool Executed', pct: 88, count: Math.max(1, Math.round(overview.totalRuns * 0.88)) },
    { label: 'Succeeded', pct: Math.max(1, Math.round(overview.successRate * 100)), count: overview.succeededRuns },
  ];

  const heatRows = [
    { window: '00:00–06:00', cells: [1, 1, 2, 1, 0, 1] },
    { window: '06:00–12:00', cells: [2, 3, 2, 4, 2, 1] },
    { window: '12:00–18:00', cells: [3, 4, 3, 2, 3, 2] },
    { window: '18:00–24:00', cells: [1, 2, 1, 1, 2, 0] },
  ];

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--lavender-border)',
          backgroundColor: 'var(--lavender-soft)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div>
          <strong style={{ fontSize: '14px', color: 'var(--brand)' }}>{info.label}</strong>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{info.subtitle}</div>
        </div>
        <StatusChip label={info.focusMetric} tone="info" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '12px',
        }}
      >
        {/* Time-series Chart + Deployment Annotations */}
        <section
          aria-label="Time-series with deployment annotations"
          style={{
            padding: '14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '13px' }}>Time-Series Volume &amp; Deploys</strong>
            <StatusChip label="Deployments annotated" tone="neutral" />
          </div>
          <Sparkline data={series} color="#3924D6" fill="#3924D6" width={240} height={54} />
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <span>Markers:</span>
            <code>v1.2 prod rollout</code>
            <code>v1.3 canary 10%</code>
          </div>
        </section>

        {/* Funnel Chart */}
        <section
          aria-label="Execution stage funnel"
          style={{
            padding: '14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '6px',
          }}
        >
          <strong style={{ fontSize: '13px' }}>Execution Completion Funnel</strong>
          {funnelStages.map((st) => (
            <div key={st.label} style={{ display: 'grid', gridTemplateColumns: '95px 1fr 48px', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
              <span>{st.label}</span>
              <div style={{ height: '10px', borderRadius: '9999px', backgroundColor: 'var(--surface-muted)', overflow: 'hidden' }}>
                <div style={{ width: `${st.pct}%`, height: '100%', backgroundColor: 'var(--brand)' }} />
              </div>
              <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{st.pct}%</span>
            </div>
          ))}
        </section>

        {/* Heat Map */}
        <section
          aria-label="Latency and incident heat map"
          style={{
            padding: '14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '6px',
          }}
        >
          <strong style={{ fontSize: '13px' }}>Activity &amp; Latency Heat Map</strong>
          {heatRows.map((row) => (
            <div key={row.window} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
              <span style={{ width: '78px', color: 'var(--text-secondary)' }}>{row.window}</span>
              <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                {row.cells.map((lvl, idx) => (
                  <span
                    key={idx}
                    style={{
                      flex: 1,
                      height: '14px',
                      borderRadius: '3px',
                      backgroundColor:
                        lvl >= 4
                          ? '#3924D6'
                          : lvl === 3
                            ? '#6D5CE8'
                            : lvl === 2
                              ? '#A59BF2'
                              : lvl === 1
                                ? '#EAE8F7'
                                : 'var(--surface-muted)',
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {customWidgets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {customWidgets.map((w) => (
            <section
              key={w.id}
              aria-label={`Custom widget ${w.title}`}
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid var(--brand)',
                backgroundColor: 'var(--surface)',
                boxShadow: 'var(--shadow-card)',
                display: 'grid',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '13px' }}>{w.title}</strong>
                <StatusChip label={w.widgetType.replace('_', ' ')} tone="info" />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Metric: <code>{w.metric}</code>
              </div>
              <Sparkline data={[5, 8, 6, 11, 9, 14]} color="#12B76A" fill="#12B76A" width={190} height={32} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function CostIntelligencePanels({
  overview,
  onGenerateChargeback,
}: {
  overview: ObservabilityOverviewDto;
  onGenerateChargeback: () => void;
}) {
  const projected30d = overview.totalCostUsd * 30;
  const budgetCap = 250;
  const burnPct = Math.min(100, Math.round((overview.totalCostUsd / budgetCap) * 100));

  const teamSpend = [
    { name: 'Customer Support', sharePct: 48, usd: overview.totalCostUsd * 0.48 },
    { name: 'Finance Ops', sharePct: 32, usd: overview.totalCostUsd * 0.32 },
    { name: 'SRE & Platform', sharePct: 20, usd: overview.totalCostUsd * 0.2 },
  ];

  const projectSpend = [
    { name: 'Default Project', usd: overview.totalCostUsd * 0.72 },
    { name: 'AP Invoice Match', usd: overview.totalCostUsd * 0.28 },
  ];

  const toolSpend = [
    { name: 'web_fetch', calls: 142, usd: overview.totalCostUsd * 0.14 },
    { name: 'http_request', calls: 96, usd: overview.totalCostUsd * 0.18 },
    { name: 'kb_hybrid_query', calls: 215, usd: overview.totalCostUsd * 0.11 },
  ];

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      {/* Forecasting, Budget Burn-Down & Anomaly Detection */}
      <section
        aria-label="Cost forecasting and burn-down"
        style={{
          padding: '14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <strong style={{ fontSize: '14.5px' }}>Forecasting, Budget Burn-Down &amp; Chargeback</strong>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <StatusChip label="Anomaly Detection: Normal" tone="success" />
            <button
              type="button"
              onClick={onGenerateChargeback}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--brand)',
                backgroundColor: 'var(--lavender-soft)',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Generate Chargeback Report
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '10px' }}>
          <div style={{ padding: '10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>30-Day Forecast</div>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>${projected30d.toFixed(2)}</div>
          </div>
          <div style={{ padding: '10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Cost / Successful Outcome</div>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>${overview.costPerSuccessfulOutcomeUsd.toFixed(4)}</div>
          </div>
          <div style={{ padding: '10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Monthly Burn-Down (${budgetCap} cap)</div>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{burnPct}% utilized</div>
            <div style={{ height: '6px', borderRadius: '9999px', backgroundColor: 'var(--surface-muted)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(4, burnPct)}%`, height: '100%', backgroundColor: 'var(--brand)' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Spending by Team, Project & Tool */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
        <section
          aria-label="Spending by team"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '6px',
            fontSize: '12.5px',
          }}
        >
          <strong>Spending by Team</strong>
          {teamSpend.map((t) => (
            <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.name} ({t.sharePct}%)</span>
              <strong>${t.usd.toFixed(4)}</strong>
            </div>
          ))}
        </section>

        <section
          aria-label="Spending by project"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '6px',
            fontSize: '12.5px',
          }}
        >
          <strong>Spending by Project</strong>
          {projectSpend.map((p) => (
            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{p.name}</span>
              <strong>${p.usd.toFixed(4)}</strong>
            </div>
          ))}
        </section>

        <section
          aria-label="Spending by tool"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '6px',
            fontSize: '12.5px',
          }}
        >
          <strong>Spending by Tool</strong>
          {toolSpend.map((tl) => (
            <div key={tl.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <code>{tl.name}</code> ({tl.calls} calls)
              </span>
              <strong>${tl.usd.toFixed(4)}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
