import type { ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  ShieldAlert,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import type { EnvironmentKind } from '@elshad/domain';

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'human';

const TONE_STYLES: Record<BadgeTone, { color: string; backgroundColor: string }> = {
  success: { color: 'var(--success)', backgroundColor: 'var(--success-bg)' },
  danger: { color: 'var(--danger)', backgroundColor: 'var(--danger-bg)' },
  warning: { color: 'var(--warning)', backgroundColor: 'var(--warning-bg)' },
  info: { color: 'var(--info)', backgroundColor: 'var(--info-bg)' },
  neutral: { color: 'var(--text-secondary)', backgroundColor: 'var(--surface-raised)' },
  human: { color: 'var(--human)', backgroundColor: 'var(--human-bg)' },
};

export interface StatusChipProps {
  label: string;
  tone?: BadgeTone;
  icon?: ReactNode;
}

export function StatusChip({ label, tone = 'neutral', icon }: StatusChipProps) {
  const style = TONE_STYLES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        border: '1px solid var(--border)',
        ...style,
      }}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

export function EnvBadge({ env }: { env: EnvironmentKind }) {
  const toneMap: Record<EnvironmentKind, BadgeTone> = {
    dev: 'info',
    staging: 'warning',
    prod: 'danger',
  };
  return (
    <StatusChip
      label={env.toUpperCase()}
      tone={toneMap[env]}
      icon={env === 'prod' ? <ShieldAlert size={12} aria-hidden="true" /> : undefined}
    />
  );
}

export function RiskBadge({ tier }: { tier: 'low' | 'medium' | 'high' }) {
  const toneMap: Record<'low' | 'medium' | 'high', BadgeTone> = {
    low: 'neutral',
    medium: 'warning',
    high: 'danger',
  };
  return <StatusChip label={`Risk: ${tier}`} tone={toneMap[tier]} />;
}

export function AutonomyBadge({ level }: { level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' }) {
  return (
    <StatusChip
      label={level}
      tone={level === 'L0' || level === 'L1' ? 'human' : level === 'L2' ? 'warning' : 'danger'}
    />
  );
}

export type UiStateKind =
  | 'loading'
  | 'empty'
  | 'partial'
  | 'error'
  | 'forbidden'
  | 'offline'
  | 'stale'
  | 'prod_safety';

export interface StateViewProps {
  state: UiStateKind;
  title: string;
  description: string;
  errorCode?: string;
  requestId?: string;
  requiredPermission?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

const STATE_ICONS: Record<UiStateKind, ReactNode> = {
  loading: <Clock size={22} aria-hidden="true" />,
  empty: <Sparkles size={22} aria-hidden="true" />,
  partial: <AlertTriangle size={22} aria-hidden="true" />,
  error: <AlertCircle size={22} aria-hidden="true" />,
  forbidden: <Lock size={22} aria-hidden="true" />,
  offline: <WifiOff size={22} aria-hidden="true" />,
  stale: <Clock size={22} aria-hidden="true" />,
  prod_safety: <ShieldAlert size={22} aria-hidden="true" />,
};

/**
 * Shared state renderer covering all 8 required UI states from PRD Appendix P.8.
 */
export function StateView({
  state,
  title,
  description,
  errorCode,
  requestId,
  requiredPermission,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
}: StateViewProps) {
  const isAlert = state === 'error' || state === 'forbidden' || state === 'prod_safety';

  if (state === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={title}
        style={{
          padding: '24px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: '12px' }}>{title}</div>
        <div
          style={{
            height: '14px',
            width: '60%',
            backgroundColor: 'var(--surface-raised)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '8px',
          }}
        />
        <div
          style={{
            height: '14px',
            width: '40%',
            backgroundColor: 'var(--surface-raised)',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      </div>
    );
  }

  return (
    <section
      role={isAlert ? 'alert' : 'region'}
      aria-label={title}
      style={{
        padding: '24px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${isAlert ? 'var(--danger)' : 'var(--border)'}`,
        backgroundColor: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
        {STATE_ICONS[state]}
        <span>{title}</span>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{description}</p>

      {errorCode && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          Code: <strong>{errorCode}</strong>
          {requestId ? ` · Request ID: ${requestId}` : ''}
        </div>
      )}

      {requiredPermission && (
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Missing permission: <code>{requiredPermission}</code>. Contact a Workspace Admin or Org
          Owner to grant access.
        </div>
      )}

      {(actionLabel || secondaryLabel) && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              style={{
                minHeight: '32px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--brand)',
                backgroundColor: 'var(--brand)',
                color: 'var(--brand-contrast)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              style={{
                minHeight: '32px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function SuccessNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--success-bg)',
        color: 'var(--success)',
        fontWeight: 600,
      }}
    >
      <CheckCircle2 size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export interface ElshadLogoProps {
  collapsed?: boolean;
  size?: number;
}

/**
 * Brand orbital ring mark and wordmark for elshad.ai.
 */
export function ElshadLogo({ collapsed = false, size = 28 }: ElshadLogoProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        userSelect: 'none',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="16" cy="16" r="11" stroke="var(--brand)" strokeWidth="4.2" />
        <ellipse
          cx="16"
          cy="16"
          rx="13.5"
          ry="5.4"
          transform="rotate(-24 16 16)"
          stroke="var(--brand)"
          strokeWidth="2.4"
          strokeOpacity="0.45"
        />
        <circle cx="24" cy="9" r="2.4" fill="var(--brand)" />
      </svg>
      {!collapsed && (
        <span
          style={{
            fontSize: '18px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}
        >
          elshad.ai
        </span>
      )}
    </div>
  );
}

export interface SparklineProps {
  data: number[];
  color: string;
  fill?: string;
  width?: number;
  height?: number;
  bars?: boolean;
}

/**
 * Compact inline SVG sparkline / optional mini bar backdrop for KPI cards.
 */
export function Sparkline({
  data,
  color,
  fill,
  width = 84,
  height = 36,
  bars = false,
}: SparklineProps) {
  const safe = data.length >= 2 ? data : [0, ...data, 1];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = max - min || 1;
  const padY = 4;
  const innerH = height - padY * 2;
  const stepX = width / Math.max(safe.length - 1, 1);

  const pts = safe.map((v, i) => {
    const x = Number((i * stepX).toFixed(1));
    const y = Number((padY + innerH - ((v - min) / span) * innerH).toFixed(1));
    return { x, y };
  });

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1]!.x} ${height} L ${pts[0]!.x} ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, overflow: 'visible' }}
    >
      {bars &&
        pts.map((p, i) => {
          const barW = Math.max(3, Math.floor(width / safe.length) - 3);
          const barH = Math.max(4, height - p.y);
          return (
            <rect
              key={i}
              x={Math.max(0, p.x - barW / 2)}
              y={height - barH}
              width={barW}
              height={barH}
              rx={1.5}
              fill={color}
              fillOpacity={0.22}
            />
          );
        })}
      {fill && !bars && <path d={areaPath} fill={fill} fillOpacity={0.18} />}
      <path d={linePath} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
