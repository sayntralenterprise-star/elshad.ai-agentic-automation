import type { PolicyDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { RefreshCw, ShieldCheck } from 'lucide-react';

export interface ApprovalPoliciesTabProps {
  policies: PolicyDto[];
  loading: boolean;
  onRefresh: () => void;
}

const DEFAULT_APPROVAL_POLICIES: Array<{
  id: string;
  name: string;
  slug: string;
  point: string;
  mode: 'enforce' | 'audit_only';
  triggerRule: string;
  sla: string;
  sod: boolean;
}> = [
  {
    id: 'pol_apr_fin',
    name: 'Financial Refund & Transfer Gate',
    slug: 'require-approval-financial-actions',
    point: 'tool_call',
    mode: 'enforce',
    triggerRule: 'Amount >= $25 USD or side_effect = write/destructive',
    sla: '60m (auto-escalate)',
    sod: true,
  },
  {
    id: 'pol_apr_prod',
    name: 'Production Environment Promotion Gate',
    slug: 'prod-promotion-sod',
    point: 'promotion',
    mode: 'enforce',
    triggerRule: 'Target env = prod · requires dual control',
    sla: '4h (reject on timeout)',
    sod: true,
  },
  {
    id: 'pol_apr_lowconf',
    name: 'Low-Confidence External Egress Guard',
    slug: 'egress-low-confidence-review',
    point: 'egress',
    mode: 'enforce',
    triggerRule: 'Confidence < 0.75 & external_comms enabled',
    sla: '30m (escalate to secops)',
    sod: false,
  },
];

export function ApprovalPoliciesTab({ policies, loading, onRefresh }: ApprovalPoliciesTabProps) {
  const approvalPolicies = policies.filter((p) => p.effect === 'require_approval');

  return (
    <section
      aria-label="Approval Policies"
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Active Approval Policies</span>
          </h2>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Policies that pause agent/workflow execution and route decisions into this inbox.
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          style={{
            minHeight: '30px',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface-raised)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <RefreshCw size={12} aria-hidden="true" />
          <span>Refresh Policies</span>
        </button>
      </div>

      <table aria-label="Approval policies table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-raised)' }}>
            <th style={{ padding: '8px 10px' }}>Policy</th>
            <th style={{ padding: '8px 10px' }}>Point</th>
            <th style={{ padding: '8px 10px' }}>Mode</th>
            <th style={{ padding: '8px 10px' }}>Trigger Rule &amp; SLA</th>
          </tr>
        </thead>
        <tbody>
          {approvalPolicies.length > 0
            ? approvalPolicies.map((pol) => (
                <tr key={pol.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 700 }}>{pol.name}</div>
                    <code style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{pol.slug}</code>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <StatusChip label={pol.point} tone="info" />
                  </td>
                  <td style={{ padding: '10px' }}>
                    <StatusChip label={pol.mode} tone={pol.mode === 'enforce' ? 'success' : 'neutral'} />
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                    {pol.description ?? 'Requires human review before execution continues'}
                  </td>
                </tr>
              ))
            : DEFAULT_APPROVAL_POLICIES.map((pol) => (
                <tr key={pol.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 700 }}>{pol.name}</div>
                    <code style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{pol.slug}</code>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <StatusChip label={pol.point} tone="info" />
                  </td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'inline-flex', gap: '4px' }}>
                      <StatusChip label={pol.mode} tone="success" />
                      {pol.sod && <StatusChip label="SoD" tone="warning" />}
                    </div>
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                    <div>{pol.triggerRule}</div>
                    <div style={{ fontSize: '11px' }}>SLA: {pol.sla}</div>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </section>
  );
}
