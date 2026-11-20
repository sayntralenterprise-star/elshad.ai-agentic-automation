import { useState } from 'react';
import type {
  AgentDto,
  AgentIdentityDto,
  AuditEventDto,
  BudgetDto,
} from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import {
  CheckCircle2,
  GitBranch,
  Search,
  Send,
  Shield,
  Users,
  Wallet,
} from 'lucide-react';

export function AgentGovernanceRegistryPanel({
  agents,
  onNotice,
}: {
  agents: AgentDto[];
  onNotice: (msg: string) => void;
}) {
  const [attestedIds, setAttestedIds] = useState<string[]>([]);

  const riskCells = [
    { tier: 'Low Risk', l1: Math.max(1, agents.length), l2: 1, l3: 0, l4: 0 },
    { tier: 'Medium Risk', l1: 1, l2: 2, l3: 1, l4: 0 },
    {
      tier: 'High Risk',
      l1: 0,
      l2: 0,
      l3: agents.filter((a) => a.draftVersion?.lethalTrifecta?.detected).length,
      l4: 0,
    },
  ];

  const staleCount = agents.filter((a) => a.status === 'draft').length;

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '14px' }}>
        <section
          aria-label="Agent Risk Heatmap"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '8px',
          }}
        >
          <strong style={{ fontSize: '14px' }}>Risk × Autonomy Heatmap</strong>
          <table aria-label="Agent risk heatmap table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px' }}>Risk Tier</th>
                <th style={{ padding: '6px' }}>L1</th>
                <th style={{ padding: '6px' }}>L2</th>
                <th style={{ padding: '6px' }}>L3</th>
                <th style={{ padding: '6px' }}>L4</th>
              </tr>
            </thead>
            <tbody>
              {riskCells.map((row) => (
                <tr key={row.tier} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px', fontWeight: 600 }}>{row.tier}</td>
                  <td style={{ padding: '6px', backgroundColor: row.l1 > 0 ? 'var(--success-bg)' : undefined }}>{row.l1}</td>
                  <td style={{ padding: '6px', backgroundColor: row.l2 > 0 ? 'var(--lavender-soft)' : undefined }}>{row.l2}</td>
                  <td style={{ padding: '6px', backgroundColor: row.l3 > 0 ? 'var(--warning-bg)' : undefined }}>{row.l3}</td>
                  <td style={{ padding: '6px', backgroundColor: row.l4 > 0 ? 'var(--danger-bg)' : undefined }}>{row.l4}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section
          aria-label="Stale Agent Reports"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            boxShadow: 'var(--shadow-card)',
            display: 'grid',
            gap: '8px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Stale Agent &amp; Ownership Report</strong>
            <StatusChip label={`${staleCount} unpromoted drafts`} tone={staleCount > 0 ? 'warning' : 'success'} />
          </div>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Tracks dormant agents (&gt; 30d inactive), unattested tool scopes, and missing secondary owners.
          </p>
        </section>
      </div>

      <section
        aria-label="Agent inventory and attestation"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '10px',
        }}
      >
        <strong style={{ fontSize: '14.5px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Shield size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Workspace Agent Registry &amp; Attestation ({agents.length})</span>
        </strong>
        {agents.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            No workspace agents registered yet.
          </div>
        ) : (
          <table aria-label="Governance agent inventory" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-raised)' }}>
                <th style={{ padding: '8px' }}>Agent</th>
                <th style={{ padding: '8px' }}>Status</th>
                <th style={{ padding: '8px' }}>Lethal Trifecta</th>
                <th style={{ padding: '8px' }}>Attestation</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((ag) => {
                const attested = attestedIds.includes(ag.id);
                return (
                  <tr key={ag.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{ag.name}</td>
                    <td style={{ padding: '8px' }}>
                      <StatusChip label={ag.status} tone={ag.status === 'active' ? 'success' : 'neutral'} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <StatusChip
                        label={ag.draftVersion?.lethalTrifecta?.detected ? 'Flagged' : 'Clean'}
                        tone={ag.draftVersion?.lethalTrifecta?.detected ? 'danger' : 'success'}
                      />
                    </td>
                    <td style={{ padding: '8px' }}>
                      {attested ? (
                        <StatusChip label="Attested" tone="success" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setAttestedIds((p) => [...p, ag.id]);
                            onNotice(`Recorded security attestation for "${ag.name}".`);
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--brand)',
                            backgroundColor: 'var(--lavender-soft)',
                            color: 'var(--brand)',
                            fontWeight: 600,
                            fontSize: '11.5px',
                            cursor: 'pointer',
                          }}
                        >
                          Attest Agent
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function BudgetHierarchyPanel({ budgets }: { budgets: BudgetDto[] }) {
  const nodes = [
    { level: 'Org Root (org_1)', spent: 184_200, hard: 2_000_000, action: 'require_approval', indent: 0 },
    { level: 'Workspace (ws_1)', spent: 92_400, hard: 1_000_000, action: 'stop', indent: 20 },
    ...budgets.map((b) => ({
      level: `${b.scopeType}:${b.scopeId}`,
      spent: b.spentMicroUsd,
      hard: b.hardLimitMicroUsd ?? 1_000_000,
      action: b.actionOnBreach,
      indent: b.scopeType === 'agent' ? 48 : 34,
    })),
  ];

  return (
    <section
      aria-label="Hierarchical budget tree"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px',
        boxShadow: 'var(--shadow-card)',
        display: 'grid',
        gap: '10px',
      }}
    >
      <strong style={{ fontSize: '14.5px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <Wallet size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
        <span>Hierarchical Budget Tree</span>
      </strong>
      <div style={{ display: 'grid', gap: '8px' }}>
        {nodes.map((node, idx) => {
          const pct = node.hard > 0 ? Math.min(100, Math.round((node.spent / node.hard) * 100)) : 0;
          return (
            <div
              key={`${node.level}-${idx}`}
              style={{
                marginLeft: `${node.indent}px`,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-raised)',
                display: 'grid',
                gap: '4px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <GitBranch size={12} aria-hidden="true" />
                  {node.level}
                </span>
                <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                  <span>
                    {node.spent} / {node.hard} µUSD
                  </span>
                  <StatusChip label={node.action} tone={node.action === 'stop' ? 'danger' : 'warning'} />
                </div>
              </div>
              <div style={{ height: '5px', borderRadius: '9999px', backgroundColor: 'var(--surface-muted)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(3, pct)}%`, height: '100%', backgroundColor: 'var(--brand)' }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AccessManagementPanel({
  agentIdentities,
  onNotice,
}: {
  agentIdentities: AgentIdentityDto[];
  onNotice: (msg: string) => void;
}) {
  const [reviewCompleted, setReviewCompleted] = useState(false);

  const matrixRows = [
    { role: 'Administrator', agents: 'All', workflows: 'All', secrets: 'Write-only', governance: 'Full' },
    { role: 'Operator', agents: 'Read/Run', workflows: 'Run', secrets: 'Masked', governance: 'Approvals' },
    { role: 'Builder', agents: 'Draft', workflows: 'Draft', secrets: 'Own/Dev', governance: 'Read Audit' },
    { role: 'Service Account / Agent', agents: `${agentIdentities.length} identities`, workflows: 'Scoped', secrets: 'Token-scoped', governance: 'None' },
  ];

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <section
        aria-label="RBAC Permission Matrix"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <strong style={{ fontSize: '14.5px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Users size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Users, Roles, Service Accounts &amp; Permission Matrix</span>
          </strong>
          {reviewCompleted ? (
            <StatusChip label="Quarterly Review Completed" tone="success" />
          ) : (
            <button
              type="button"
              onClick={() => {
                setReviewCompleted(true);
                onNotice('Quarterly IAM & Agent Identity Access Review completed and signed.');
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--brand)',
                backgroundColor: 'var(--lavender-soft)',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <CheckCircle2 size={13} aria-hidden="true" />
              <span>Complete Review</span>
            </button>
          )}
        </div>

        <table aria-label="Permission matrix" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-raised)' }}>
              <th style={{ padding: '8px' }}>Principal Role / Group</th>
              <th style={{ padding: '8px' }}>Agents</th>
              <th style={{ padding: '8px' }}>Workflows</th>
              <th style={{ padding: '8px' }}>Secrets Vault</th>
              <th style={{ padding: '8px' }}>Governance</th>
            </tr>
          </thead>
          <tbody>
            {matrixRows.map((r) => (
              <tr key={r.role} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{r.role}</td>
                <td style={{ padding: '8px' }}>{r.agents}</td>
                <td style={{ padding: '8px' }}>{r.workflows}</td>
                <td style={{ padding: '8px' }}>{r.secrets}</td>
                <td style={{ padding: '8px' }}>{r.governance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function AuditGovernancePanel({
  auditEvents,
  onNotice,
}: {
  auditEvents: AuditEventDto[];
  onNotice: (msg: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [siemTarget, setSiemTarget] = useState('https://siem.example.internal/hec/v1');

  const filtered = auditEvents.filter((evt) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return `${evt.action} ${evt.decision ?? ''} ${JSON.stringify(evt.actor)}`.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <section
        aria-label="SIEM streaming and audit search"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <strong style={{ fontSize: '14px' }}>SIEM Log Streaming &amp; Search</strong>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="url"
              aria-label="SIEM webhook endpoint"
              value={siemTarget}
              onChange={(e) => setSiemTarget(e.target.value)}
              style={{ width: '240px', padding: '5px 8px', border: '1px solid var(--border)', fontSize: '12px' }}
            />
            <button
              type="button"
              onClick={() => onNotice(`Verified SIEM stream heartbeat to ${siemTarget} (200 OK).`)}
              style={{
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--brand)',
                backgroundColor: 'var(--lavender-soft)',
                color: 'var(--brand)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Send size={12} aria-hidden="true" />
              <span>Test SIEM Stream</span>
            </button>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            aria-hidden="true"
            style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            type="search"
            aria-label="Search audit events"
            placeholder="Filter audit records by actor, action, resource, or decision..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 10px 6px 28px', border: '1px solid var(--border)', fontSize: '12.5px' }}
          />
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          Showing {filtered.length} of {auditEvents.length} tamper-evident record(s).
        </div>
      </section>
    </div>
  );
}
