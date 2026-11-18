import { useCallback, useEffect, useState } from 'react';
import { PlatformError } from '@elshad/domain';
import type { ApprovalDto, NotificationDto, PlatformClient } from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import { Bell, CheckCircle2, Clock, HelpCircle, Send, ShieldAlert, XCircle } from 'lucide-react';

export interface ApprovalsViewProps {
  client: PlatformClient;
  workspaceId?: string;
}

export function ApprovalsView({ client, workspaceId }: ApprovalsViewProps) {
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      setApprovals(aprList);
      setNotifications(notifList);
      setSelectedId((prev) => prev ?? aprList[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox, workspaceId]);

  const selected = approvals.find((a) => a.id === selectedId) ?? approvals[0] ?? null;

  useEffect(() => {
    if (selected) {
      setEditJson(JSON.stringify(selected.payload.proposedAction.args, null, 2));
    }
  }, [selected]);

  async function handleDecide(decision: 'approve' | 'reject' | 'approve_with_edit') {
    if (!selected) return;
    setError(null);
    setNotice(null);
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
      setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
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
      setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
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
      setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
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
      setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setNotice(`Snoozed "${updated.payload.title}" for 1 hour.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ margin: 0, fontSize: '22px' }}>Approvals Inbox</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <StatusChip
            label={`${approvals.filter((a) => a.status === 'pending').length} Pending`}
            tone="warning"
          />
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

      {loading && (
        <StateView
          state="loading"
          title="Loading approval queue"
          description="Fetching pending human-in-the-loop decisions..."
        />
      )}

      {!loading && approvals.length === 0 && (
        <StateView
          state="empty"
          title="Approval inbox is clear"
          description="Human-in-the-loop pause requests from runs and policies will appear here."
        />
      )}

      {!loading && approvals.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '14px',
            alignItems: 'start',
          }}
        >
          {/* Left Queue */}
          <section
            aria-label="Approval Queue"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '10px',
              display: 'grid',
              gap: '8px',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '15px' }}>My Queue ({approvals.length})</h2>
            {approvals.map((apr) => {
              const isSelected = selected?.id === apr.id;
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
                    backgroundColor: isSelected ? 'var(--surface-raised)' : 'var(--surface)',
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
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Risk: {apr.payload.risk.toUpperCase()}
                    {apr.payload.amount
                      ? ` · ${apr.payload.amount.value} ${apr.payload.amount.currency}`
                      : ''}{' '}
                    · Run {apr.runId}
                  </div>
                </button>
              );
            })}
          </section>

          {/* Right Detail Card (P.3) */}
          {selected && (
            <section
              aria-label="Approval Detail"
              data-testid="approval-detail-card"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                display: 'grid',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '16px' }}>{selected.payload.title}</h2>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Type: {selected.type} · Run: <code>{selected.runId}</code> · Step:{' '}
                    <code>{selected.stepId}</code>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <StatusChip
                    label={`Risk: ${selected.payload.risk.toUpperCase()}`}
                    tone={selected.payload.risk === 'high' ? 'danger' : 'warning'}
                  />
                  {selected.payload.policyReason && (
                    <StatusChip label={selected.payload.policyReason} tone="info" />
                  )}
                </div>
              </div>

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
    </div>
  );
}
