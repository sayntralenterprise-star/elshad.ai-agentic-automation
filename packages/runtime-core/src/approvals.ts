import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  type Clock,
  type IdGen,
  type TenantContext,
} from '@elshad/domain';
import type { ExecutionEngine } from '@elshad/execution';

export type ApprovalType =
  | 'tool_call'
  | 'promotion'
  | 'write_grant'
  | 'policy_enforce'
  | 'workflow_gate'
  | 'custom';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'info_requested';

export type ApprovalTimeoutAction = 'reject' | 'escalate' | 'approve';
export type ApprovalChannel = 'console' | 'slack' | 'email' | 'api';
export type ApprovalDecisionKind =
  | 'approve'
  | 'reject'
  | 'approve_with_edit'
  | 'request_info'
  | 'provide_info'
  | 'delegate';

export interface ApprovalTarget {
  readonly type: 'role' | 'user';
  readonly id: string;
}

export interface ApprovalEscalationStep {
  readonly afterMs: number;
  readonly to: ApprovalTarget;
}

export interface ApprovalPayload {
  readonly title: string;
  readonly summary: string;
  readonly proposedAction: {
    readonly tool?: string;
    readonly args: Record<string, unknown>;
  };
  readonly diff?: {
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  };
  readonly risk: 'low' | 'medium' | 'high';
  readonly amount?: {
    readonly value: number;
    readonly currency: string;
  };
  readonly evidence: readonly {
    readonly type: string;
    readonly stepId?: string;
    readonly docId?: string;
    readonly summary?: string;
  }[];
  readonly confidence?: number | null;
  readonly policyReason?: string;
  readonly editSchema?: Record<string, unknown>;
}

export interface ApprovalDecisionRecord {
  readonly id: string;
  readonly approvalId: string;
  readonly orgId: string;
  readonly decidedBy: string;
  readonly decision: ApprovalDecisionKind;
  readonly reason: string | null;
  readonly editedPayload: Record<string, unknown> | null;
  readonly channel: ApprovalChannel;
  readonly createdAt: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly type: ApprovalType;
  status: ApprovalStatus;
  payload: ApprovalPayload;
  requestedFrom: ApprovalTarget[];
  readonly requiredDecisions: number;
  readonly separationOfDuties: boolean;
  readonly initiatedBy: string;
  delegatedTo: string | null;
  expiresAt: string | null;
  readonly onTimeout: ApprovalTimeoutAction;
  readonly autoApproveOnTimeout: boolean;
  readonly escalation: ApprovalEscalationStep[];
  escalatedAt: string | null;
  snoozedUntil: string | null;
  infoRequestQuestion: string | null;
  infoRequestAnswer: string | null;
  readonly allowedActions: readonly ('approve' | 'reject' | 'approve_with_edit' | 'request_info')[];
  readonly decisions: ApprovalDecisionRecord[];
  readonly createdAt: string;
  decidedAt: string | null;
}

export interface NotificationRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string | null;
  readonly approvalId: string | null;
  readonly channel: 'slack' | 'email' | 'in_app' | 'webhook';
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  readonly actionLinks: {
    readonly consoleUrl: string;
    readonly slackApproveToken?: string;
    readonly slackRejectToken?: string;
    readonly emailApproveToken?: string;
    readonly emailRejectToken?: string;
    readonly slackBlocks?: readonly Record<string, unknown>[];
  };
  readonly status: 'pending' | 'sent' | 'failed';
  readonly createdAt: string;
}

export interface SignedApprovalActionClaims {
  readonly jti: string;
  readonly approvalId: string;
  readonly orgId: string;
  readonly action: 'approve' | 'reject';
  readonly expMs: number;
}

export function signApprovalActionToken(
  claims: SignedApprovalActionClaims,
  signingSecret: string,
): string {
  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sigHex = createHmac('sha256', signingSecret).update(payloadB64, 'utf8').digest('hex');
  return `${payloadB64}.${sigHex}`;
}

export function verifyApprovalActionToken(
  token: string,
  signingSecret: string,
  nowMs: number = Date.now(),
): SignedApprovalActionClaims {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) {
    throw new PlatformError('AUTH_UNAUTHENTICATED', 'Malformed approval action token.');
  }
  const payloadB64 = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);
  const expectedHex = createHmac('sha256', signingSecret).update(payloadB64, 'utf8').digest('hex');

  const actualBuf = Buffer.from(sigHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new PlatformError('AUTH_FORBIDDEN', 'Invalid approval action token signature.');
  }

  let claims: SignedApprovalActionClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as SignedApprovalActionClaims;
  } catch {
    throw new PlatformError('AUTH_UNAUTHENTICATED', 'Corrupt approval action token payload.');
  }

  if (!claims.jti || !claims.approvalId || !claims.orgId || !Number.isFinite(claims.expMs)) {
    throw new PlatformError('AUTH_UNAUTHENTICATED', 'Incomplete approval action token claims.');
  }
  if (nowMs > claims.expMs) {
    throw new PlatformError('AUTH_TOKEN_EXPIRED', 'Approval action token has expired.');
  }
  return claims;
}

export class NotificationDispatcher {
  private readonly records: NotificationRecord[] = [];
  private readonly clock: Clock;
  private readonly idGen: IdGen;

  constructor(opts: { clock?: Clock; idGen?: IdGen } = {}) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
  }

  dispatchApprovalNotifications(
    approval: ApprovalRecord,
    opts: {
      consoleUrl: string;
      slackApproveToken: string;
      slackRejectToken: string;
      emailApproveToken: string;
      emailRejectToken: string;
    },
  ): NotificationRecord[] {
    const now = this.clock.now().toISOString();
    const recipients =
      approval.requestedFrom.length > 0
        ? approval.requestedFrom.map((r) => `${r.type}:${r.id}`)
        : ['role:reviewer'];

    const slackBlocks: Record<string, unknown>[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Approval Required (${approval.payload.risk.toUpperCase()})*: ${approval.payload.title}\n${approval.payload.summary}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'approval_approve',
            value: opts.slackApproveToken,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: 'approval_reject',
            value: opts.slackRejectToken,
          },
        ],
      },
    ];

    const created: NotificationRecord[] = [];
    for (const recipient of recipients) {
      const slackRec: NotificationRecord = {
        id: this.idGen.uuidv7(),
        orgId: approval.orgId,
        workspaceId: approval.workspaceId,
        approvalId: approval.id,
        channel: 'slack',
        recipient,
        subject: `[Approval] ${approval.payload.title}`,
        body: `${approval.payload.summary} (Run: ${approval.runId})`,
        actionLinks: {
          consoleUrl: opts.consoleUrl,
          slackApproveToken: opts.slackApproveToken,
          slackRejectToken: opts.slackRejectToken,
          slackBlocks,
        },
        status: 'sent',
        createdAt: now,
      };
      const emailRec: NotificationRecord = {
        id: this.idGen.uuidv7(),
        orgId: approval.orgId,
        workspaceId: approval.workspaceId,
        approvalId: approval.id,
        channel: 'email',
        recipient,
        subject: `[Action Required] ${approval.payload.title}`,
        body: `Review in Console: ${opts.consoleUrl}\nApprove token: ${opts.emailApproveToken}\nReject token: ${opts.emailRejectToken}`,
        actionLinks: {
          consoleUrl: opts.consoleUrl,
          emailApproveToken: opts.emailApproveToken,
          emailRejectToken: opts.emailRejectToken,
        },
        status: 'sent',
        createdAt: now,
      };
      this.records.push(slackRec, emailRec);
      created.push(slackRec, emailRec);
    }
    return created;
  }

  listByOrg(orgId: string): NotificationRecord[] {
    return this.records
      .filter((n) => n.orgId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => structuredClone(n));
  }
}

export interface ApprovalServiceSnapshot {
  readonly approvals: ApprovalRecord[];
  readonly consumedTokens: string[];
}

export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly consumedTokens = new Set<string>();
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  private readonly executionEngine?: ExecutionEngine;
  readonly notifications: NotificationDispatcher;
  private readonly signingSecret: string;
  private readonly baseConsoleUrl: string;

  constructor(
    opts: {
      clock?: Clock;
      idGen?: IdGen;
      executionEngine?: ExecutionEngine;
      notificationDispatcher?: NotificationDispatcher;
      signingSecret?: string;
      baseConsoleUrl?: string;
    } = {},
  ) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
    this.executionEngine = opts.executionEngine;
    this.notifications =
      opts.notificationDispatcher ?? new NotificationDispatcher({ clock: this.clock, idGen: this.idGen });
    this.signingSecret = opts.signingSecret ?? 'dev-approval-signing-secret';
    this.baseConsoleUrl = opts.baseConsoleUrl ?? 'http://localhost:5173';
  }

  exportState(): ApprovalServiceSnapshot {
    return {
      approvals: [...this.approvals.values()].map((a) => structuredClone(a)),
      consumedTokens: [...this.consumedTokens],
    };
  }

  importState(snapshot: ApprovalServiceSnapshot): void {
    this.approvals.clear();
    for (const a of snapshot.approvals) {
      this.approvals.set(a.id, structuredClone(a));
    }
    this.consumedTokens.clear();
    for (const jti of snapshot.consumedTokens) {
      this.consumedTokens.add(jti);
    }
  }

  createApproval(
    ctx: TenantContext,
    input: {
      workspaceId?: string;
      runId: string;
      stepId: string;
      type?: ApprovalType;
      payload: ApprovalPayload;
      requestedFrom?: ApprovalTarget[];
      requiredDecisions?: number;
      separationOfDuties?: boolean;
      expiresAt?: string | null;
      ttlMs?: number;
      onTimeout?: ApprovalTimeoutAction;
      autoApproveOnTimeout?: boolean;
      escalation?: ApprovalEscalationStep[];
    },
  ): { approval: ApprovalRecord; notifications: NotificationRecord[]; slackApproveToken: string; slackRejectToken: string } {
    const nowMs = this.clock.now().getTime();
    const nowIso = new Date(nowMs).toISOString();
    const id = this.idGen.uuidv7();
    const defaultTtlMs = 7 * 24 * 60 * 60 * 1000; // 7-day durable approval SLA (E1.1)
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
        : new Date(nowMs + (input.ttlMs ?? defaultTtlMs)).toISOString();

    const approval: ApprovalRecord = {
      id,
      orgId: ctx.orgId,
      workspaceId: input.workspaceId ?? ctx.workspaceId ?? 'ws_default',
      runId: input.runId,
      stepId: input.stepId,
      type: input.type ?? 'tool_call',
      status: 'pending',
      payload: structuredClone(input.payload),
      requestedFrom: structuredClone(input.requestedFrom ?? [{ type: 'role', id: 'reviewer' }]),
      requiredDecisions: Math.max(1, input.requiredDecisions ?? 1),
      separationOfDuties: input.separationOfDuties ?? true,
      initiatedBy: ctx.principal.id,
      delegatedTo: null,
      expiresAt,
      onTimeout: input.onTimeout ?? 'escalate',
      autoApproveOnTimeout: input.autoApproveOnTimeout ?? false,
      escalation: structuredClone(input.escalation ?? []),
      escalatedAt: null,
      snoozedUntil: null,
      infoRequestQuestion: null,
      infoRequestAnswer: null,
      allowedActions: ['approve', 'reject', 'approve_with_edit', 'request_info'],
      decisions: [],
      createdAt: nowIso,
      decidedAt: null,
    };

    this.approvals.set(id, approval);

    const tokenExpMs = expiresAt ? Date.parse(expiresAt) : nowMs + defaultTtlMs;
    const slackApproveToken = signApprovalActionToken(
      { jti: this.idGen.uuidv7(), approvalId: id, orgId: ctx.orgId, action: 'approve', expMs: tokenExpMs },
      this.signingSecret,
    );
    const slackRejectToken = signApprovalActionToken(
      { jti: this.idGen.uuidv7(), approvalId: id, orgId: ctx.orgId, action: 'reject', expMs: tokenExpMs },
      this.signingSecret,
    );
    const emailApproveToken = signApprovalActionToken(
      { jti: this.idGen.uuidv7(), approvalId: id, orgId: ctx.orgId, action: 'approve', expMs: tokenExpMs },
      this.signingSecret,
    );
    const emailRejectToken = signApprovalActionToken(
      { jti: this.idGen.uuidv7(), approvalId: id, orgId: ctx.orgId, action: 'reject', expMs: tokenExpMs },
      this.signingSecret,
    );

    const sent = this.notifications.dispatchApprovalNotifications(approval, {
      consoleUrl: `${this.baseConsoleUrl}/approvals/${id}`,
      slackApproveToken,
      slackRejectToken,
      emailApproveToken,
      emailRejectToken,
    });

    return {
      approval: structuredClone(approval),
      notifications: sent,
      slackApproveToken,
      slackRejectToken,
    };
  }

  getApproval(orgId: string, id: string): ApprovalRecord | null {
    const rec = this.approvals.get(id);
    if (!rec || rec.orgId !== orgId) return null;
    return structuredClone(rec);
  }

  listApprovals(
    orgId: string,
    opts: { workspaceId?: string; status?: ApprovalStatus } = {},
  ): ApprovalRecord[] {
    return [...this.approvals.values()]
      .filter(
        (a) =>
          a.orgId === orgId &&
          (!opts.workspaceId || a.workspaceId === opts.workspaceId) &&
          (!opts.status || a.status === opts.status),
      )
      .sort((a, b) => {
        if (a.expiresAt && b.expiresAt) return a.expiresAt.localeCompare(b.expiresAt);
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map((a) => structuredClone(a));
  }

  async decideApproval(
    ctx: TenantContext,
    id: string,
    input: {
      decision: 'approve' | 'reject' | 'approve_with_edit';
      reason?: string;
      editedPayload?: Record<string, unknown>;
      channel?: ApprovalChannel;
      confirmKeyword?: string;
    },
  ): Promise<ApprovalRecord> {
    const rec = this.approvals.get(id);
    if (!rec || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Approval ${id} not found.`);
    }
    if (rec.status !== 'pending' && rec.status !== 'info_requested') {
      throw new PlatformError('RES_CONFLICT', `Approval ${id} is already ${rec.status}.`);
    }

    if (rec.separationOfDuties && ctx.principal.id === rec.initiatedBy) {
      throw new PlatformError(
        'POL_DENIED',
        'Separation of duties violation: initiator cannot decide their own approval request.',
        { approval_id: id, actor_id: ctx.principal.id },
      );
    }

    const alreadyVoted = rec.decisions.some(
      (d) =>
        d.decidedBy === ctx.principal.id &&
        (d.decision === 'approve' || d.decision === 'approve_with_edit' || d.decision === 'reject'),
    );
    if (alreadyVoted) {
      throw new PlatformError(
        'RES_CONFLICT',
        'Principal has already recorded a decision on this approval.',
      );
    }

    if (input.decision === 'reject') {
      if (!input.reason || input.reason.trim().length < 5) {
        throw new PlatformError(
          'VAL_SCHEMA_MISMATCH',
          'A rejection reason of at least 5 characters is required (P.3).',
        );
      }
    }

    if (
      (input.decision === 'approve' || input.decision === 'approve_with_edit') &&
      rec.payload.risk === 'high' &&
      input.confirmKeyword !== undefined &&
      input.confirmKeyword !== 'APPROVE'
    ) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        'High-risk approvals require typed confirmation keyword "APPROVE".',
      );
    }

    const nowIso = this.clock.now().toISOString();
    const decisionRec: ApprovalDecisionRecord = {
      id: this.idGen.uuidv7(),
      approvalId: rec.id,
      orgId: rec.orgId,
      decidedBy: ctx.principal.id,
      decision: input.decision,
      reason: input.reason ?? null,
      editedPayload: input.editedPayload ? structuredClone(input.editedPayload) : null,
      channel: input.channel ?? 'console',
      createdAt: nowIso,
    };
    rec.decisions.push(decisionRec);

    if (input.decision === 'approve_with_edit' && input.editedPayload) {
      rec.payload = {
        ...rec.payload,
        proposedAction: {
          ...rec.payload.proposedAction,
          args: {
            ...rec.payload.proposedAction.args,
            ...input.editedPayload,
          },
        },
      };
    }

    if (input.decision === 'reject') {
      rec.status = 'rejected';
      rec.decidedAt = nowIso;
      await this.signalRunIfPossible(ctx, rec, 'approval_rejected', {
        approval_id: rec.id,
        decision: 'reject',
        reason: input.reason ?? null,
        decided_by: ctx.principal.id,
      });
    } else {
      const approvalsCount = rec.decisions.filter(
        (d) => d.decision === 'approve' || d.decision === 'approve_with_edit',
      ).length;
      if (approvalsCount >= rec.requiredDecisions) {
        rec.status = 'approved';
        rec.decidedAt = nowIso;
        await this.signalRunIfPossible(ctx, rec, 'approval_granted', {
          approval_id: rec.id,
          decision: input.decision,
          edited_payload: input.editedPayload ?? null,
          decided_by: ctx.principal.id,
        });
      }
    }

    return structuredClone(rec);
  }

  async decideWithSignedToken(input: {
    token: string;
    actorId: string;
    channel: 'slack' | 'email';
    reason?: string;
    confirmKeyword?: string;
  }): Promise<ApprovalRecord> {
    const claims = verifyApprovalActionToken(
      input.token,
      this.signingSecret,
      this.clock.now().getTime(),
    );
    if (this.consumedTokens.has(claims.jti)) {
      throw new PlatformError(
        'RES_CONFLICT',
        'Approval action token has already been used (single-use link).',
      );
    }
    this.consumedTokens.add(claims.jti);

    const ctx: TenantContext = {
      orgId: claims.orgId as TenantContext['orgId'],
      principal: {
        id: input.actorId as TenantContext['principal']['id'],
        type: 'user',
      },
      requestId: `req_act_${claims.jti}`,
      traceId: '0'.repeat(32),
    };

    return this.decideApproval(ctx, claims.approvalId, {
      decision: claims.action,
      reason: input.reason ?? (claims.action === 'reject' ? `Rejected via ${input.channel}` : undefined),
      channel: input.channel,
      confirmKeyword: input.confirmKeyword,
    });
  }

  requestInfo(ctx: TenantContext, id: string, question: string): ApprovalRecord {
    const rec = this.approvals.get(id);
    if (!rec || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Approval ${id} not found.`);
    }
    if (rec.status !== 'pending') {
      throw new PlatformError('RES_CONFLICT', `Cannot request info when status is ${rec.status}.`);
    }
    rec.status = 'info_requested';
    rec.infoRequestQuestion = question;
    rec.decisions.push({
      id: this.idGen.uuidv7(),
      approvalId: rec.id,
      orgId: rec.orgId,
      decidedBy: ctx.principal.id,
      decision: 'request_info',
      reason: question,
      editedPayload: null,
      channel: 'console',
      createdAt: this.clock.now().toISOString(),
    });
    return structuredClone(rec);
  }

  provideInfo(ctx: TenantContext, id: string, answer: string): ApprovalRecord {
    const rec = this.approvals.get(id);
    if (!rec || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Approval ${id} not found.`);
    }
    if (rec.status !== 'info_requested') {
      throw new PlatformError('RES_CONFLICT', `Approval ${id} is not awaiting info.`);
    }
    rec.status = 'pending';
    rec.infoRequestAnswer = answer;
    rec.decisions.push({
      id: this.idGen.uuidv7(),
      approvalId: rec.id,
      orgId: rec.orgId,
      decidedBy: ctx.principal.id,
      decision: 'provide_info',
      reason: answer,
      editedPayload: null,
      channel: 'api',
      createdAt: this.clock.now().toISOString(),
    });
    return structuredClone(rec);
  }

  delegateApproval(ctx: TenantContext, id: string, delegateToPrincipalId: string): ApprovalRecord {
    const rec = this.approvals.get(id);
    if (!rec || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Approval ${id} not found.`);
    }
    if (rec.status !== 'pending' && rec.status !== 'info_requested') {
      throw new PlatformError('RES_CONFLICT', `Approval ${id} is already ${rec.status}.`);
    }
    if (delegateToPrincipalId === rec.initiatedBy && rec.separationOfDuties) {
      throw new PlatformError(
        'POL_DENIED',
        'Cannot delegate approval back to the initiator (Separation of Duties).',
      );
    }
    rec.delegatedTo = delegateToPrincipalId;
    rec.requestedFrom.push({ type: 'user', id: delegateToPrincipalId });
    rec.decisions.push({
      id: this.idGen.uuidv7(),
      approvalId: rec.id,
      orgId: rec.orgId,
      decidedBy: ctx.principal.id,
      decision: 'delegate',
      reason: `Delegated to ${delegateToPrincipalId}`,
      editedPayload: null,
      channel: 'console',
      createdAt: this.clock.now().toISOString(),
    });
    return structuredClone(rec);
  }

  snoozeApproval(ctx: TenantContext, id: string, snoozeUntilIso: string): ApprovalRecord {
    const rec = this.approvals.get(id);
    if (!rec || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Approval ${id} not found.`);
    }
    if (rec.status !== 'pending' && rec.status !== 'info_requested') {
      throw new PlatformError('RES_CONFLICT', `Approval ${id} is already ${rec.status}.`);
    }
    rec.snoozedUntil = snoozeUntilIso;
    if (!rec.expiresAt || Date.parse(snoozeUntilIso) > Date.parse(rec.expiresAt)) {
      rec.expiresAt = snoozeUntilIso;
    }
    return structuredClone(rec);
  }

  async processExpiredApprovals(now: Date = this.clock.now()): Promise<ApprovalRecord[]> {
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const processed: ApprovalRecord[] = [];

    for (const rec of this.approvals.values()) {
      if (rec.status !== 'pending' && rec.status !== 'info_requested') continue;
      if (!rec.expiresAt || Date.parse(rec.expiresAt) > nowMs) continue;

      const sysCtx: TenantContext = {
        orgId: rec.orgId as TenantContext['orgId'],
        workspaceId: rec.workspaceId as TenantContext['workspaceId'],
        principal: { id: rec.initiatedBy as TenantContext['principal']['id'], type: 'service_account' },
        requestId: `req_exp_${rec.id}`,
        traceId: '0'.repeat(32),
      };

      if (rec.onTimeout === 'approve' && rec.autoApproveOnTimeout) {
        rec.status = 'approved';
        rec.decidedAt = nowIso;
        await this.signalRunIfPossible(sysCtx, rec, 'approval_auto_approved_on_timeout', {
          approval_id: rec.id,
          decision: 'approve',
        });
      } else if (rec.onTimeout === 'escalate' && !rec.escalatedAt && rec.escalation.length > 0) {
        rec.escalatedAt = nowIso;
        for (const step of rec.escalation) {
          rec.requestedFrom.push(step.to);
        }
        rec.expiresAt = new Date(nowMs + 3_600_000).toISOString();
      } else {
        rec.status = 'expired';
        rec.decidedAt = nowIso;
        await this.signalRunIfPossible(sysCtx, rec, 'approval_expired', {
          approval_id: rec.id,
          decision: 'expired',
        });
      }
      processed.push(structuredClone(rec));
    }

    return processed;
  }

  private async signalRunIfPossible(
    ctx: TenantContext,
    rec: ApprovalRecord,
    reason: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.executionEngine) return;
    const run = await this.executionEngine.getRun(rec.orgId, rec.runId);
    if (run && run.status === 'waiting_approval') {
      await this.executionEngine.signal(ctx, rec.runId, {
        kind: 'approval',
        reason,
        payload,
      });
    }
  }
}
