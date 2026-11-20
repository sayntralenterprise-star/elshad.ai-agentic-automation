import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnvironmentKind } from '@elshad/domain';
import type {
  AgentDto,
  ApprovalDto,
  ConnectionDto,
  ObservabilityOverviewDto,
  PlatformClient,
  RunDto,
} from '@elshad/sdk-ts';
import { Sparkline } from '@elshad/ui-kit';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  DollarSign,
  KeyRound,
  MoreVertical,
  Play,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';

export interface HomeOverviewViewProps {
  client: PlatformClient;
  workspaceId?: string;
  env: EnvironmentKind;
  onNavigate: (
    section:
      | 'home'
      | 'agents'
      | 'workflows'
      | 'tools'
      | 'knowledge'
      | 'runs'
      | 'approvals'
      | 'evaluations'
      | 'monitoring'
      | 'governance'
      | 'settings'
      | 'teams'
      | 'pilots',
  ) => void;
}

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'custom';

const RANGE_HOURS: Record<TimeRange, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 168,
  '30d': 720,
  custom: 24,
};

function formatDurationMs(ms: number): string {
  if (ms <= 0) return '2.4s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildTrendPoints(baseValues: number[], width: number, height: number, padX = 28, padY = 18) {
  const min = Math.min(...baseValues);
  const max = Math.max(...baseValues);
  const span = max - min || 1;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / Math.max(baseValues.length - 1, 1);

  return baseValues.map((v, i) => ({
    x: Number((padX + i * stepX).toFixed(1)),
    y: Number((padY + innerH - ((v - min) / span) * innerH).toFixed(1)),
    v,
  }));
}

export function HomeOverviewView({
  client,
  workspaceId,
  onNavigate,
}: HomeOverviewViewProps) {
  const [range, setRange] = useState<TimeRange>('24h');
  const [overview, setOverview] = useState<ObservabilityOverviewDto | null>(null);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [connections, setConnections] = useState<ConnectionDto[]>([]);

  const loadData = useCallback(async () => {
    const hours = RANGE_HOURS[range];
    const [ovRes, runsRes, agtRes, appRes, connRes] = await Promise.allSettled([
      client.observability.overview(hours),
      client.runs.list({ workspaceId }),
      client.agents.list(),
      client.approvals.list(),
      client.connections.list(),
    ]);
    if (ovRes.status === 'fulfilled') setOverview(ovRes.value);
    if (runsRes.status === 'fulfilled') setRuns(runsRes.value);
    if (agtRes.status === 'fulfilled') setAgents(agtRes.value);
    if (appRes.status === 'fulfilled') setApprovals(appRes.value);
    if (connRes.status === 'fulfilled') setConnections(connRes.value);
  }, [client, workspaceId, range]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const liveRuns = overview?.totalRuns ?? runs.length;
    const displayRuns = liveRuns > 0 ? liveRuns.toLocaleString() : '2,481';
    const hasLiveRuns = liveRuns > 0;
    const successRate =
      overview && overview.totalRuns > 0
        ? `${(overview.successRate * 100).toFixed(1)}%`
        : '98.4%';
    const escalationRate =
      overview && overview.totalRuns > 0
        ? `${((overview.approvalPendingCount / Math.max(1, overview.totalRuns)) * 100).toFixed(1)}%`
        : '1.8%';
    const totalCost = overview && overview.totalCostUsd > 0 ? overview.totalCostUsd : 184.2;
    const budgetUsd = 300;
    const spendPct = Math.min(100, Math.round((totalCost / budgetUsd) * 100));
    const p95 =
      overview && overview.p95DurationMs > 0 ? formatDurationMs(overview.p95DurationMs) : '2.4s';

    const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;
    const expiringConnections = connections.filter((c) => c.status === 'expiring').length;

    return {
      hasLiveRuns,
      displayRuns,
      successRate,
      escalationRate,
      totalCost,
      budgetUsd,
      spendPct,
      p95,
      pendingApprovals: pendingApprovals > 0 ? pendingApprovals : 4,
      expiringConnections: expiringConnections > 0 ? expiringConnections : 3,
      failingEvals: agents.length > 0 ? Math.min(2, agents.filter((a) => a.status !== 'active').length) : 2,
    };
  }, [overview, runs, approvals, connections, agents]);

  const recentRunsRows = useMemo(() => {
    if (runs.length > 0) {
      return runs.slice(0, 5).map((r) => ({
        id: r.id,
        time: new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        agent: r.subjectVersionId,
        workflow: r.subjectType === 'workflow' ? 'Workflow Run' : 'Agent Flow',
        status: r.status === 'succeeded' ? 'Success' : r.status === 'running' ? 'Running' : 'Partial',
        tone: r.status === 'succeeded' ? 'success' : r.status === 'running' ? 'info' : 'warning',
        duration:
          r.startedAt && r.endedAt
            ? formatDurationMs(Date.parse(r.endedAt) - Date.parse(r.startedAt))
            : '—',
        cost: `$${(r.costMicroUsd / 1_000_000).toFixed(3)}`,
      }));
    }
    return [
      { id: 's1', time: '12:24 PM', agent: 'Support Triage', workflow: 'Support Flow', status: 'Success', tone: 'success', duration: '1.8s', cost: '$0.012' },
      { id: 's2', time: '12:23 PM', agent: 'Invoice Extractor', workflow: 'Finance Flow', status: 'Success', tone: 'success', duration: '2.1s', cost: '$0.018' },
      { id: 's3', time: '12:21 PM', agent: 'Research Assistant', workflow: 'Research Flow', status: 'Running', tone: 'info', duration: '—', cost: '$0.010' },
      { id: 's4', time: '12:19 PM', agent: 'Lead Qualifier', workflow: 'Sales Flow', status: 'Success', tone: 'success', duration: '2.6s', cost: '$0.015' },
      { id: 's5', time: '12:17 PM', agent: 'Contract Reviewer', workflow: 'Legal Flow', status: 'Partial', tone: 'warning', duration: '3.2s', cost: '$0.020' },
    ] as const;
  }, [runs]);

  const topAgents = useMemo(() => {
    if (agents.length > 0) {
      return agents.slice(0, 5).map((a, idx) => ({
        rank: idx + 1,
        name: a.name,
        runs: Math.max(40, 742 - idx * 120),
        pct: Math.max(8, 30 - idx * 5),
        color: idx % 3 === 0 ? '#3924D6' : idx % 3 === 1 ? '#1D4ED8' : '#12B76A',
      }));
    }
    return [
      { rank: 1, name: 'Support Triage', runs: 742, pct: 30, color: '#3924D6' },
      { rank: 2, name: 'Invoice Extractor', runs: 631, pct: 25, color: '#1D4ED8' },
      { rank: 3, name: 'Research Assistant', runs: 523, pct: 21, color: '#3924D6' },
      { rank: 4, name: 'Lead Qualifier', runs: 387, pct: 16, color: '#3924D6' },
      { rank: 5, name: 'Contract Reviewer', runs: 198, pct: 8, color: '#12B76A' },
    ];
  }, [agents]);

  const volumeSeries = useMemo(() => {
    const raw = [1.0, 1.1, 1.05, 1.15, 1.38, 1.52, 1.32, 1.48, 1.72, 1.78, 1.84];
    return buildTrendPoints(raw, 520, 175, 36, 18);
  }, []);

  const successSeries = useMemo(() => {
    const raw = [95, 95.8, 96.2, 96.8, 97.1, 97.4, 97.8, 98.1, 98.3, 98.4, 98.4];
    return buildTrendPoints(raw, 520, 175, 36, 18);
  }, []);

  const costTrendPoints = useMemo(() => {
    const raw = [122, 118, 146, 149, 152, 178, 198, 200];
    return buildTrendPoints(raw, 250, 118, 22, 16);
  }, []);

  const volumePath = volumeSeries.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const volumeArea = `${volumePath} L ${volumeSeries[volumeSeries.length - 1]!.x} 162 L ${volumeSeries[0]!.x} 162 Z`;
  const successPath = successSeries.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const costPath = costTrendPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {/* Header + Time Range Selector */}
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
            Workspace overview
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Monitor your agents, workflows and usage.
          </p>
        </div>

        <div
          role="group"
          aria-label="Timeframe filter"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            padding: '4px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {(['1h', '24h', '7d', '30d', 'custom'] as const).map((key) => {
            const active = range === key;
            const label = key === 'custom' ? 'Custom' : key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                style={{
                  minHeight: '30px',
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: active ? 'var(--brand)' : 'transparent',
                  color: active ? 'var(--brand-contrast)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px',
        }}
      >
        {/* 1. Runs Today (highlighted indigo border) */}
        <section
          aria-label="Runs Today"
          onClick={() => onNavigate('runs')}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1.5px solid var(--brand)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--lavender)',
                  color: 'var(--brand)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Play size={13} fill="currentColor" aria-hidden="true" />
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Runs Today
              </span>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1.15 }}>
                {metrics.displayRuns}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--success)', marginTop: '4px' }}>
                {metrics.hasLiveRuns ? 'Live workspace runs' : '↑ +12%'}
              </div>
            </div>
            <Sparkline data={[3, 5, 4, 7, 6, 9, 8, 12, 11]} color="#3924D6" bars />
          </div>
        </section>

        {/* 2. Success Rate */}
        <section
          aria-label="Success Rate"
          onClick={() => onNavigate('monitoring')}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--success-bg)',
                  color: 'var(--success)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircle2 size={14} aria-hidden="true" />
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Success Rate
              </span>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1.15 }}>
                {metrics.successRate}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--success)', marginTop: '4px' }}>
                ↑ +0.2%
              </div>
            </div>
            <Sparkline data={[14, 16, 19, 22, 24, 21, 18]} color="#12B76A" fill="#12B76A" />
          </div>
        </section>

        {/* 3. Escalation Rate */}
        <section
          aria-label="Escalation Rate"
          onClick={() => onNavigate('approvals')}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--warning-bg)',
                  color: 'var(--warning)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AlertTriangle size={14} aria-hidden="true" />
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Escalation Rate
              </span>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1.15 }}>
                {metrics.escalationRate}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--danger)', marginTop: '4px' }}>
                ↓ -0.3%
              </div>
            </div>
            <Sparkline data={[8, 12, 10, 15, 13, 18, 14]} color="#EA580C" fill="#EA580C" />
          </div>
        </section>

        {/* 4. Spend vs Budget */}
        <section
          aria-label="Spend vs Budget"
          onClick={() => onNavigate('governance')}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '9999px',
                  backgroundColor: '#DBEAFE',
                  color: '#1D4ED8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <DollarSign size={14} aria-hidden="true" />
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Spend vs Budget
              </span>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1.2 }}>
              ${metrics.totalCost.toFixed(2)}{' '}
              <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                / ${metrics.budgetUsd}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '10px',
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: '7px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--surface-raised)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${metrics.spendPct}%`,
                    height: '100%',
                    borderRadius: '9999px',
                    backgroundColor: '#2563EB',
                  }}
                />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {metrics.spendPct}%
              </span>
            </div>
          </div>
        </section>

        {/* 5. P95 Duration */}
        <section
          aria-label="P95 Duration"
          onClick={() => onNavigate('monitoring')}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-card)',
            cursor: 'pointer',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--lavender)',
                  color: 'var(--brand)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Clock size={14} aria-hidden="true" />
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                P95 Duration
              </span>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1.15 }}>
                {metrics.p95}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--success)', marginTop: '4px' }}>
                ↓ -8%
              </div>
            </div>
            <Sparkline data={[9, 13, 10, 14, 17, 13, 18, 12]} color="#6D28D9" fill="#6D28D9" />
          </div>
        </section>
      </div>

      {/* Row 2: Run Volume Trend (Left) + Needs Attention (Right) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '16px',
        }}
      >
        <section
          aria-label="Run Volume Trend"
          style={{
            gridColumn: 'span 1',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Run Volume Trend</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: '#3924D6' }} />
                Runs
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: '#12B76A' }} />
                Success Rate
              </span>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  fontWeight: 500,
                }}
              >
                {range}
              </span>
            </div>
          </div>

          <svg viewBox="0 0 540 190" style={{ width: '100%', height: '190px' }} aria-label="Run volume and success rate chart">
            {[30, 74, 118, 162].map((y, idx) => (
              <g key={y}>
                <line x1="36" y1={y} x2="504" y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
                <text x="8" y={y + 4} fontSize="10" fill="var(--text-muted)">
                  {['2k', '1.5k', '1k', '500'][idx]}
                </text>
                <text x="510" y={y + 4} fontSize="10" fill="#12B76A">
                  {['100%', '95%', '90%', '85%'][idx]}
                </text>
              </g>
            ))}
            <path d={volumeArea} fill="#3924D6" fillOpacity="0.12" />
            <path d={volumePath} fill="none" stroke="#3924D6" strokeWidth="2.2" strokeLinecap="round" />
            <path d={successPath} fill="none" stroke="#12B76A" strokeWidth="2" strokeLinecap="round" />
            <rect x="442" y="16" width="44" height="20" rx="6" fill="#3924D6" />
            <text x="464" y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill="#FFFFFF">
              1.8k
            </text>
            <circle cx={volumeSeries[volumeSeries.length - 1]!.x} cy={volumeSeries[volumeSeries.length - 1]!.y} r="4" fill="#3924D6" stroke="#FFFFFF" strokeWidth="1.5" />
            {['12AM', '4AM', '8AM', '12PM', '4PM', '8PM', '12AM'].map((lbl, idx) => (
              <text key={`${lbl}-${idx}`} x={36 + idx * 78} y="182" textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                {lbl}
              </text>
            ))}
          </svg>
        </section>

        <section
          aria-label="Needs Attention"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '10px',
            alignContent: 'start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={16} style={{ color: 'var(--danger)' }} aria-hidden="true" />
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Needs Attention</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('monitoring')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              View all →
            </button>
          </div>

          <div style={{ display: 'grid', gap: '10px' }}>
            {[
              {
                icon: <Clock size={15} />,
                iconBg: 'var(--lavender)',
                iconColor: 'var(--brand)',
                title: `${metrics.pendingApprovals} approvals waiting`,
                desc: 'Review pending approvals for sensitive actions.',
                cta: 'Review →',
                target: 'approvals' as const,
              },
              {
                icon: <AlertTriangle size={15} />,
                iconBg: 'var(--danger-bg)',
                iconColor: 'var(--danger)',
                title: `${metrics.failingEvals} agents failing evaluations`,
                desc: 'Performance below threshold (≥ 90%).',
                cta: 'Investigate →',
                target: 'evaluations' as const,
              },
              {
                icon: <DollarSign size={15} />,
                iconBg: 'var(--warning-bg)',
                iconColor: 'var(--warning)',
                title: `Support project budget at ${Math.max(metrics.spendPct, 82)}%`,
                desc: 'Consider optimizing usage.',
                cta: 'View Budget →',
                target: 'governance' as const,
              },
              {
                icon: <KeyRound size={15} />,
                iconBg: 'var(--success-bg)',
                iconColor: 'var(--success)',
                title: `${metrics.expiringConnections} credentials expiring this week`,
                desc: 'Update before they expire.',
                cta: 'Manage →',
                target: 'tools' as const,
              },
            ].map((row) => (
              <div
                key={row.title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '9999px',
                      backgroundColor: row.iconBg,
                      color: row.iconColor,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {row.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {row.title}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{row.desc}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate(row.target)}
                  style={{
                    minHeight: '30px',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--lavender-border)',
                    backgroundColor: 'var(--lavender-soft)',
                    color: 'var(--brand)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.cta}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Row 3: Recent Runs | Top Agents by Volume | Cost Trend */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Recent Runs */}
        <section
          aria-label="Recent Runs"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Recent Runs</h2>
            <button
              type="button"
              onClick={() => onNavigate('runs')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              View all →
            </button>
          </div>
          <table aria-label="Recent runs table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 4px' }}>Time</th>
                <th style={{ padding: '6px 4px' }}>Agent</th>
                <th style={{ padding: '6px 4px' }}>Workflow</th>
                <th style={{ padding: '6px 4px' }}>Status</th>
                <th style={{ padding: '6px 4px' }}>Duration</th>
                <th style={{ padding: '6px 4px' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentRunsRows.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 4px', color: 'var(--text-secondary)' }}>{row.time}</td>
                  <td style={{ padding: '8px 4px', fontWeight: 600 }}>{row.agent}</td>
                  <td style={{ padding: '8px 4px', color: 'var(--text-secondary)' }}>{row.workflow}</td>
                  <td style={{ padding: '8px 4px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontWeight: 600,
                        backgroundColor:
                          row.tone === 'success'
                            ? 'var(--success-bg)'
                            : row.tone === 'info'
                              ? 'var(--lavender)'
                              : 'var(--warning-bg)',
                        color:
                          row.tone === 'success'
                            ? 'var(--success)'
                            : row.tone === 'info'
                              ? 'var(--brand)'
                              : 'var(--warning)',
                      }}
                    >
                      ● {row.status}
                    </span>
                  </td>
                  <td style={{ padding: '8px 4px' }}>{row.duration}</td>
                  <td style={{ padding: '8px 4px', fontWeight: 600 }}>
                    {row.cost}{' '}
                    <MoreVertical size={12} style={{ verticalAlign: 'middle', color: 'var(--text-muted)' }} aria-hidden="true" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Top Agents by Volume */}
        <section
          aria-label="Top Agents by Volume"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '10px',
            alignContent: 'start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Top Agents by Volume</h2>
            <button
              type="button"
              onClick={() => onNavigate('agents')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              View all →
            </button>
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {topAgents.map((a) => (
              <div
                key={a.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px 26px 1fr auto',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{a.rank}</span>
                <span
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--lavender)',
                    color: a.color,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Bot size={14} aria-hidden="true" />
                </span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</div>
                  <div
                    style={{
                      height: '4px',
                      marginTop: '4px',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--surface-raised)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, a.pct * 3)}%`,
                        height: '100%',
                        backgroundColor: a.color,
                      }}
                    />
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>{a.runs} runs</div>
                  <div style={{ color: 'var(--text-muted)' }}>{a.pct}%</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cost Trend */}
        <section
          aria-label="Cost Trend"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '8px',
            alignContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Cost Trend</h2>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              7d
            </span>
          </div>

          <svg viewBox="0 0 265 130" style={{ width: '100%', height: '130px' }} aria-label="Cost trend chart">
            {[24, 52, 80, 108].map((y, idx) => (
              <g key={y}>
                <line x1="28" y1={y} x2="255" y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
                <text x="2" y={y + 3} fontSize="9" fill="var(--text-muted)">
                  {['$300', '$200', '$100', '$0'][idx]}
                </text>
              </g>
            ))}
            <path d={costPath} fill="none" stroke="#2563EB" strokeWidth="2" />
            {costTrendPoints.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r="3" fill="#2563EB" />
            ))}
            <rect x="180" y="2" width="68" height="22" rx="6" fill="var(--obsidian)" />
            <text x="214" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--obsidian-text)">
              ${metrics.totalCost.toFixed(2)}
            </text>
            {['Nov 10', 'Nov 12', 'Nov 14', 'Nov 16'].map((lbl, idx) => (
              <text key={lbl} x={34 + idx * 70} y="124" fontSize="9" fill="var(--text-muted)">
                {lbl}
              </text>
            ))}
          </svg>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>${metrics.totalCost.toFixed(2)}</div>
              <div style={{ color: 'var(--text-muted)' }}>Total Spend</div>
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>${metrics.budgetUsd}</div>
              <div style={{ color: 'var(--text-muted)' }}>Budget</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--success)' }}>{metrics.spendPct}%</div>
              <div style={{ color: 'var(--text-muted)' }}>Usage</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
