import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlatformError } from '@elshad/domain';
import type {
  ApprovalDto,
  NotificationDto,
  PlatformClient,
  PolicyDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  HelpCircle,
  Search,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { ApprovalPoliciesTab } from './approvals/ApprovalPoliciesTab.js';

export interface ApprovalsViewProps {
  client: PlatformClient;
  workspaceId?: string;
  currentPrincipalId?: string;
}

type ApprovalViewTab = 'my_queue' | 'all' | 'policies';

const RISK_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function formatSlaRemaining(expiresAt: string | null): { label: string; expired: boolean } {
  if (!expiresAt) return { label: 'Standard SLA', expired: false };
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms)) return { label: 'Standard SLA', expired: false };
  if (ms <= 0) return { label: 'SLA expired', expired: true };
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins >= 60) return { label: `${Math.round(mins / 60)}h remaining`, expired: false };
  return { label: `${mins}m remaining`, expired: false };
}

function sortBySlaUrgency(list: ApprovalDto[]): ApprovalDto[] {
  return [...list].sort((a, b) => {
    const aPending = a.status === 'pending' || a.status === 'info_requested' ? 0 : 1;
    const bPending = b.status === 'pending' || b.status === 'info_requested' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    if (a.expiresAt && b.expiresAt) {
      const diff = Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
      if (Number.isFinite(diff) && diff !== 0) return diff;
    } else if (a.expiresAt || b.expiresAt) {
      return a.expiresAt ? -1 : 1;
    }
    return (RISK_RANK[a.payload.risk] ?? 1) - (RISK_RANK[b.payload.risk] ?? 1);
  });
}

export function ApprovalsView({
  client,
  workspaceId,
  currentPrincipalId = 'prn_1',
}: ApprovalsViewProps) {
  const [viewTab, setViewTab] = useState<ApprovalViewTab>('my_queue');
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [policies, setPolicies] = useState<PolicyDto[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [editJson, setEditJson] = useState('');
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const [infoQuestion, setInfoQuestion] = useState('');
  const [delegateId, setDelegateId] = useState('prn_reviewer_2');

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aprList, notifList] = await Promise.all([
        client.approvals.list(),
        client.notifications.list().catch(() => [] as NotificationDto[]),
      ]);
      const sorted = sortBySlaUrgency(aprList);
      setApprovals(sorted);
      setNotifications(notifList);
      setSelectedId((prev) => prev ?? sorted[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    try {
      const rows = await client.policies.list();
      setPolicies(rows);
    } catch {
      setPolicies([]);
    } finally {
      setPoliciesLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox, workspaceId]);

  useEffect(() => {
    if (viewTab === 'policies') {
      void loadPolicies();
    }
  }, [viewTab, loadPolicies]);

  const queueItems = useMemo(() => {
    const base =
      viewTab === 'my_queue'
        ? approvals.filter(
            (a) =>
              !a.delegatedTo ||
              a.delegatedTo === currentPrincipalId ||
              a.id === selectedId,
          )
        : approvals.filter((a) => {
            if (statusFilter !== 'all' && a.status !== statusFilter) return false;
            if (riskFilter !== 'all' && a.payload.risk !== riskFilter) return false;
            if (searchQuery.trim()) {
              const q = searchQuery.trim().toLowerCase();
              const hay = `${a.payload.title} ${a.payload.summary} ${a.runId} ${a.initiatedBy}`.toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          });
    return sortBySlaUrgency(base);
  }, [approvals, viewTab, currentPrincipalId, selectedId, statusFilter, riskFilter, searchQuery]);

  const selected = queueItems.find((a) => a.id === selectedId) ?? queueItems[0] ?? approvals[0] ?? null;

  useEffect(() => {
    if (selected) {
      setEditJson(JSON.stringify(selected.payload.proposedAction.args, null, 2));
    }
  }, [selected]);

  const metrics = useMemo(() => {
    const pending = approvals.filter(
      (a) => a.status === 'pending' || a.status === 'info_requested',
    ).length;
    const highRisk = approvals.filter((a) => a.payload.risk === 'high').length;
    const expiring = approvals.filter(
      (a) => a.expiresAt !== null && (a.status === 'pending' || a.status === 'info_requested'),
    ).length;
    const decided = approvals.filter(
      (a) => a.status === 'approved' || a.status === 'rejected',
    ).length;
    return { pending, highRisk, expiring, decided };
  }, [approvals]);

  async function handleDecide(decision: 'approve' | 'reject' | 'approve_with_edit') {
    if (!selected) return;
    setError(null);
    setNotice(null);
    if (decision === 'reject' && reason.trim().length < 5) {
      setError('Rejection requires a decision reason of at least 5 characters.');
      return;
    }
    try {
      let parsedEdit: Record<string, unknown> | undefined;
      if (decision === 'approve_with_edit') {
        parsedEdit = JSON.parse(editJson || '{}') as Record<string, unknown>;
      }
      const updated = await client.approvals.decide(selected.id, {
        decision,
        reason: reason.trim() || undefined,
        editedPayload: parsedEdit,
        channel: 'console',
        confirmKeyword: confirmKeyword.trim() || undefined,
      });
      setApprovals((prev) => sortBySlaUrgency(prev.map((a) => (a.id === updated.id ? updated : a))));
      setReason('');
      setConfirmKeyword('');
      setNotice(`Approval "${updated.payload.title}" updated to status: ${updated.status}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleRequestInfo() {
    if (!selected || !infoQuestion.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.approvals.requestInfo(selected.id, infoQuestion.trim());
      setApprovals((prev) => sortBySlaUrgency(prev.map((a) => (a.id === updated.id ? updated : a))));
      setInfoQuestion('');
      setNotice(`Requested more info on "${updated.payload.title}".`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleDelegate() {
    if (!selected || !delegateId.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.approvals.delegate(selected.id, delegateId.trim());
      setApprovals((prev) => sortBySlaUrgency(prev.map((a) => (a.id === updated.id ? updated : a))));
      setNotice(`Delegated "${updated.payload.title}" to ${delegateId.trim()}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleSnooze() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    try {
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const updated = await client.approvals.snooze(selected.id, until);
      setApprovals((prev) => sortBySlaUrgency(prev.map((a) => (a.id === updated.id ? updated : a))));
      setNotice(`Snoozed "${updated.payload.title}" for 1 hour.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  const slaInfo = selected ? formatSlaRemaining(selected.expiresAt) : null;

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {/* Header + 3-View Switcher */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Approvals Inbox
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            Authorize sensitive agent actions, inspect proposed diffs, and manage escalation SLAs.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            role="tablist"
            aria-label="Approval views"
            style={{
              display: 'inline-flex',
              gap: '4px',
              padding: '3px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
            }}
          >
            {(
              [
                { key: 'my_queue', label: 'My Queue' },
                { key: 'all', label: 'All Approvals' },
                { key: 'policies', label: 'Approval Policies' },
              ] as Array<{ key: ApprovalViewTab; label: string }>
            ).map((item) => {
              const active = viewTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setViewTab(item.key)}
                  style={{
                    minHeight: '30px',
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: active ? 'var(--brand)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <StatusChip label={`${metrics.pending} Pending`} tone="warning" />
          <button
            type="button"
            onClick={() => void loadInbox()}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Refresh Queue
          </button>
        </div>
      </div>

      {/* 4 Compact Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: '12px',
        }}
      >
        {[
          { label: 'Pending Review', value: metrics.pending, icon: <Clock size={16} aria-hidden="true" />, color: 'var(--warning)' },
          { label: 'High Risk', value: metrics.highRisk, icon: <AlertTriangle size={16} aria-hidden="true" />, color: 'var(--danger)' },
          { label: 'With SLA Timer', value: metrics.expiring, icon: <ShieldAlert size={16} aria-hidden="true" />, color: 'var(--brand)' },
          { label: 'Decided', value: metrics.decided, icon: <CheckCircle2 size={16} aria-hidden="true" />, color: 'var(--success)' },
        ].map((card) => (
          <section
            key={card.label}
            aria-label={card.label}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700 }}>{card.value}</div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{card.label}</div>
            </div>
            <span style={{ color: card.color }}>{card.icon}</span>
          </section>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {notice && <SuccessNotice message={notice} />}

      {viewTab === 'policies' ? (
        <ApprovalPoliciesTab
          policies={policies}
          loading={policiesLoading}
          onRefresh={() => void loadPolicies()}
        />
      ) : (
        <>
          {viewTab === 'all' && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ position: 'relative', flex: '1 1 200px' }}>
                <Search
                  size={14}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '9px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="search"
                  aria-label="Search approvals"
                  placeholder="Search approvals by title, run, or initiator..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '32px',
                    padding: '4px 8px 4px 28px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12.5px',
                  }}
                />
              </div>

              <select
                aria-label="Filter approvals by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ minHeight: '32px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
              >
                <option value="all">All statuses</option>
                <option value="pending">pending</option>
                <option value="info_requested">info_requested</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
                <option value="expired">expired</option>
              </select>

              <select
                aria-label="Filter approvals by risk"
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                style={{ minHeight: '32px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
              >
                <option value="all">All risk levels</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </div>
          )}

          {loading && (
            <StateView
              state="loading"
              title="Loading approval queue"
              description="Fetching pending human-in-the-loop decisions..."
            />
          )}

          {!loading && queueItems.length === 0 && (
            <StateView
              state="empty"
              title="Approval inbox is clear"
              description="Human-in-the-loop pause requests from runs and policies will appear here."
            />
          )}

          {!loading && queueItems.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '14px',
                alignItems: 'start',
              }}
            >
              {/* Left Queue sorted by SLA urgency */}
              <section
                aria-label="Approval Queue"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  boxShadow: 'var(--shadow-card)',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '15px' }}>
                  {viewTab === 'my_queue' ? 'My Queue' : 'All Approvals'} ({queueItems.length})
                </h2>
                {queueItems.map((apr) => {
                  const isSelected = selected?.id === apr.id;
                  const sla = formatSlaRemaining(apr.expiresAt);
                  return (
                    <button
                      key={apr.id}
                      type="button"
                      onClick={() => setSelectedId(apr.id)}
                      style={{
                        textAlign: 'left',
                        padding: '10px',
                        borderRadius: 'var(--radius-sm)',
                        border: isSelected ? '2px solid var(--brand)' : '1px solid var(--border)',
                        backgroundColor: isSelected ? 'var(--lavender-soft)' : 'var(--surface)',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', alignItems: 'center' }}>
                        <strong>{apr.payload.title}</strong>
                        <StatusChip
                          label={apr.status}
                          tone={
                            apr.status === 'approved'
                              ? 'success'
                              : apr.status === 'rejected' || apr.status === 'expired'
                                ? 'danger'
                                : 'warning'
                          }
                        />
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        <span>Risk: {apr.payload.risk.toUpperCase()}</span>
                        {apr.payload.amount && (
                          <span>
                            · {apr.payload.amount.value} {apr.payload.amount.currency}
                          </span>
                        )}
                        <span>· {sla.label}</span>
                      </div>
                      {(apr.delegatedTo || apr.snoozedUntil) && (
                        <div style={{ fontSize: '11px', color: 'var(--brand)' }}>
                          {apr.delegatedTo ? `Delegated to ${apr.delegatedTo} ` : ''}
                          {apr.snoozedUntil ? '· Deferred 1h' : ''}
                        </div>
                      )}
                    </button>
                  );
                })}
              </section>

              {/* Right Detail Card */}
              {selected && (
                <section
                  aria-label="Approval Detail"
                  data-testid="approval-detail-card"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px',
                    boxShadow: 'var(--shadow-card)',
                    display: 'grid',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '16px' }}>{selected.payload.title}</h2>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Requester: <code>{selected.initiatedBy}</code> · Type: {selected.type} · Run:{' '}
                        <code>{selected.runId}</code> · Step: <code>{selected.stepId}</code>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <StatusChip
                        label={`Risk: ${selected.payload.risk.toUpperCase()}`}
                        tone={selected.payload.risk === 'high' ? 'danger' : 'warning'}
                      />
                      {slaInfo && (
                        <StatusChip
                          label={slaInfo.label}
                          tone={slaInfo.expired ? 'danger' : 'info'}
                        />
                      )}
                      {selected.payload.policyReason && (
                        <StatusChip label={selected.payload.policyReason} tone="info" />
                      )}
                    </div>
                  </div>

                  {/* Amount & Confidence Strip */}
                  {(selected.payload.amount || typeof selected.payload.confidence === 'number') && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '14px',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--lavender-soft)',
                        border: '1px solid var(--lavender-border)',
                        fontSize: '12px',
                      }}
                    >
                      {selected.payload.amount && (
                        <div>
                          <strong>Amount:</strong>{' '}
                          <span style={{ fontWeight: 700, color: 'var(--brand)' }}>
                            {selected.payload.amount.value} {selected.payload.amount.currency}
                          </span>
                        </div>
                      )}
                      {typeof selected.payload.confidence === 'number' && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <strong>Agent Confidence:</strong>
                          <span>{Math.round(selected.payload.confidence * 100)}%</span>
                        </div>
                      )}
                      {selected.payload.proposedAction.tool && (
                        <div>
                          <strong>Proposed Tool:</strong>{' '}
                          <code>{selected.payload.proposedAction.tool}</code>
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    style={{
                      padding: '10px',
                      backgroundColor: 'var(--surface-raised)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                    }}
                  >
                    <strong>AI Summary:</strong> {selected.payload.summary}
                  </div>

                  {selected.payload.diff && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                      <div style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                        <strong>Before</strong>
                        <pre style={{ margin: '4px 0 0', overflowX: 'auto' }}>
                          {JSON.stringify(selected.payload.diff.before, null, 2)}
                        </pre>
                      </div>
                      <div style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                        <strong>After (Proposed)</strong>
                        <pre style={{ margin: '4px 0 0', overflowX: 'auto' }}>
                          {JSON.stringify(selected.payload.diff.after, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {selected.payload.evidence.length > 0 && (
                    <div style={{ fontSize: '12px' }}>
                      <strong>Evidence:</strong>
                      <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                        {selected.payload.evidence.map((ev, idx) => (
                          <li key={idx}>
                            [{ev.type}] {ev.summary ?? ev.stepId ?? ev.docId ?? 'supporting item'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <label htmlFor="approval-edit-args" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                      Proposed Payload Args (Editable for Edit &amp; Approve)
                    </label>
                    <textarea
                      id="approval-edit-args"
                      rows={3}
                      value={editJson}
                      onChange={(e) => setEditJson(e.target.value)}
                      style={{ width: '100%', padding: '6px', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                    />
                  </div>

                  <div>
                    <label htmlFor="approval-reason-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                      Decision Reason (required, min 5 chars on Reject)
                    </label>
                    <input
                      id="approval-reason-input"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Rationale for audit trail..."
                      style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                    />
                  </div>

                  {selected.payload.risk === 'high' && (
                    <div>
                      <label htmlFor="approval-confirm-keyword" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--danger)' }}>
                        <ShieldAlert size={14} aria-hidden="true" />
                        <span>High-Risk Confirmation (type APPROVE)</span>
                      </label>
                      <input
                        id="approval-confirm-keyword"
                        type="text"
                        value={confirmKeyword}
                        onChange={(e) => setConfirmKeyword(e.target.value)}
                        placeholder="APPROVE"
                        style={{ width: '100%', padding: '6px', border: '1px solid var(--danger)' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => void handleDecide('approve')}
                      style={{
                        padding: '7px 14px',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--brand)',
                        color: '#fff',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <CheckCircle2 size={14} aria-hidden="true" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecide('approve_with_edit')}
                      style={{
                        padding: '7px 12px',
                        border: '1px solid var(--brand)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Edit &amp; Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecide('reject')}
                      style={{
                        padding: '7px 12px',
                        border: '1px solid var(--danger)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--danger-bg)',
                        color: 'var(--danger)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <XCircle size={14} aria-hidden="true" />
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSnooze()}
                      style={{
                        padding: '7px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Clock size={14} aria-hidden="true" />
                      <span>Snooze +1h</span>
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px', alignItems: 'end' }}>
                    <div>
                      <label htmlFor="approval-info-question" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                        Request Additional Info
                      </label>
                      <input
                        id="approval-info-question"
                        type="text"
                        value={infoQuestion}
                        onChange={(e) => setInfoQuestion(e.target.value)}
                        placeholder="Ask requester for context..."
                        style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRequestInfo()}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <HelpCircle size={13} aria-hidden="true" />
                      <span>Request Info</span>
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px', alignItems: 'end' }}>
                    <div>
                      <label htmlFor="approval-delegate-id" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                        Delegate to Principal ID
                      </label>
                      <input
                        id="approval-delegate-id"
                        type="text"
                        value={delegateId}
                        onChange={(e) => setDelegateId(e.target.value)}
                        style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelegate()}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Send size={13} aria-hidden="true" />
                      <span>Delegate</span>
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}

          {notifications.length > 0 && (
            <section
              aria-label="Approval Notifications"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px',
                display: 'grid',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Bell size={15} aria-hidden="true" />
                <h2 style={{ margin: 0, fontSize: '15px' }}>Dispatched Slack &amp; Email Notifications</h2>
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', display: 'grid', gap: '4px' }}>
                {notifications.map((n) => (
                  <li key={n.id}>
                    <strong>[{n.channel.toUpperCase()}]</strong> {n.subject} → {n.recipient} ({n.status})
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
