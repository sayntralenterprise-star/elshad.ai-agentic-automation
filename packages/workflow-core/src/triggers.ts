import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  type Clock,
  type IdGen,
} from '@elshad/domain';
import type { WorkflowGraph } from './graph.js';

export type TriggerKind = 'webhook' | 'schedule' | 'manual';

export interface TriggerRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  environmentId: string;
  workflowId: string;
  workflowVersionId: string;
  nodeId: string;
  kind: TriggerKind;
  externalId: string;
  path: string | null;
  config: Record<string, unknown>;
  active: boolean;
  testMode: boolean;
  lastFiredAt: string | null;
  nextFireAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerEventRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  triggerId: string;
  runId: string | null;
  dedupKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  status: 'accepted' | 'replayed' | 'rejected' | 'captured_test';
  receivedAt: string;
}

const DEFAULT_MAX_BODY_BYTES = 5_242_880; // PRD B.5: 5 MB
const HMAC_MAX_SKEW_SECONDS = 300; // PRD B.4/B.5: 5 minutes

function normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
}

function safeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseHmacSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts = header.split(',').map((p) => p.trim());
  let t: number | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    if (part.startsWith('t=')) t = Number(part.slice(2));
    else if (part.startsWith('v1=')) v1 = part.slice(3);
  }
  if (t === undefined || !Number.isFinite(t) || !v1) return null;
  return { t, v1 };
}

function verifyHs256Jwt(
  token: string,
  secret: string,
  nowEpochSec: number,
  expectedIssuer?: string,
): void {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid webhook JWT format.');
  }
  const [headerB64, payloadB64, sigB64] = segments;
  const expectedSig = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`, 'utf8')
    .digest('base64url');
  if (!safeStringEqual(sigB64!, expectedSig)) {
    throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid webhook JWT signature.');
  }
  const claims = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8')) as {
    exp?: number;
    iss?: string;
  };
  if (claims.exp !== undefined && nowEpochSec > claims.exp) {
    throw new PlatformError('AUTH_TOKEN_EXPIRED', 'Webhook JWT has expired.');
  }
  if (expectedIssuer && claims.iss !== expectedIssuer) {
    throw new PlatformError('AUTH_FORBIDDEN', 'Webhook JWT issuer mismatch.');
  }
}

export class TriggerService {
  private readonly triggers = new Map<string, TriggerRecord>();
  private readonly events: TriggerEventRecord[] = [];
  private readonly dedupSeen = new Set<string>();
  private readonly clock: Clock;
  private readonly idGen: IdGen;

  constructor(opts?: { clock?: Clock; idGen?: IdGen }) {
    this.clock = opts?.clock ?? new SystemClock();
    this.idGen = opts?.idGen ?? new SystemIdGen();
  }

  registerWorkflowTriggers(params: {
    orgId: string;
    workspaceId: string;
    environmentId: string;
    workflowId: string;
    workflowVersionId: string;
    graph: WorkflowGraph;
    active: boolean;
  }): TriggerRecord[] {
    const registered: TriggerRecord[] = [];
    const nowIso = this.clock.now().toISOString();

    for (const node of params.graph.nodes) {
      if (!node.type.startsWith('trigger.')) continue;
      const kind: TriggerKind =
        node.type === 'trigger.webhook'
          ? 'webhook'
          : node.type === 'trigger.schedule'
            ? 'schedule'
            : 'manual';
      const path = kind === 'webhook' && typeof node.config['path'] === 'string'
        ? node.config['path']
        : null;

      if (params.active && path) {
        const conflict = [...this.triggers.values()].find(
          (t) =>
            t.orgId === params.orgId &&
            t.environmentId === params.environmentId &&
            t.active &&
            t.path === path &&
            t.workflowId !== params.workflowId,
        );
        if (conflict) {
          throw new PlatformError(
            'RES_CONFLICT',
            `Active webhook path "${path}" already exists in environment.`,
          );
        }
      }

      // Reuse existing trigger externalId for same (workflowId, environmentId, nodeId)
      const existing = [...this.triggers.values()].find(
        (t) =>
          t.orgId === params.orgId &&
          t.workflowId === params.workflowId &&
          t.environmentId === params.environmentId &&
          t.nodeId === node.id,
      );

      const id = existing?.id ?? this.idGen.uuidv7();
      const externalId = existing?.externalId ?? `trg_${id.replace(/-/g, '').slice(0, 16)}`;
      const intervalMs =
        kind === 'schedule' && typeof node.config['interval_ms'] === 'number'
          ? node.config['interval_ms']
          : undefined;
      const nextFireAt =
        params.active && kind === 'schedule' && intervalMs
          ? new Date(this.clock.now().getTime() + intervalMs).toISOString()
          : null;

      const rec: TriggerRecord = {
        id,
        orgId: params.orgId,
        workspaceId: params.workspaceId,
        environmentId: params.environmentId,
        workflowId: params.workflowId,
        workflowVersionId: params.workflowVersionId,
        nodeId: node.id,
        kind,
        externalId,
        path,
        config: { ...node.config },
        active: params.active,
        testMode: existing?.testMode ?? false,
        lastFiredAt: existing?.lastFiredAt ?? null,
        nextFireAt: nextFireAt ?? existing?.nextFireAt ?? null,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      this.triggers.set(id, rec);
      registered.push(rec);
    }

    return registered;
  }

  listByOrg(orgId: string, workspaceId?: string): TriggerRecord[] {
    return [...this.triggers.values()].filter(
      (t) => t.orgId === orgId && (!workspaceId || t.workspaceId === workspaceId),
    );
  }

  findByExternalIdOrPath(key: string): TriggerRecord | undefined {
    for (const t of this.triggers.values()) {
      if (t.id === key || t.externalId === key || (t.path === key && t.active)) {
        return t;
      }
    }
    return undefined;
  }

  setTestMode(orgId: string, triggerId: string, enabled: boolean): TriggerRecord {
    const t = this.triggers.get(triggerId);
    if (!t || t.orgId !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Trigger ${triggerId} not found.`);
    }
    t.testMode = enabled;
    t.updatedAt = this.clock.now().toISOString();
    return t;
  }

  async receiveWebhook(params: {
    externalIdOrPath: string;
    method: string;
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<{
    trigger: TriggerRecord;
    event: TriggerEventRecord;
    payload: Record<string, unknown>;
    shouldStartRun: boolean;
  }> {
    const trigger = this.findByExternalIdOrPath(params.externalIdOrPath);
    if (!trigger) {
      throw new PlatformError('RES_NOT_FOUND', `Trigger "${params.externalIdOrPath}" not found.`);
    }
    if (!trigger.active && !trigger.testMode) {
      throw new PlatformError('RES_CONFLICT', 'Webhook trigger is inactive.');
    }

    const normHeaders = normalizeHeaders(params.headers);
    const maxBytes =
      typeof trigger.config['max_body_bytes'] === 'number'
        ? trigger.config['max_body_bytes']
        : DEFAULT_MAX_BODY_BYTES;
    if (Buffer.byteLength(params.rawBody, 'utf8') > maxBytes) {
      throw new PlatformError(
        'VAL_LIMIT_EXCEEDS_CEILING',
        `Webhook payload exceeds max_body_bytes (${maxBytes}).`,
      );
    }

    const allowedMethods = Array.isArray(trigger.config['methods'])
      ? (trigger.config['methods'] as string[]).map((m) => m.toUpperCase())
      : ['POST'];
    if (!allowedMethods.includes(params.method.toUpperCase())) {
      throw new PlatformError('AUTH_FORBIDDEN', `Method ${params.method} not permitted on trigger.`);
    }

    const auth = (trigger.config['auth'] ?? { mode: 'none' }) as {
      mode?: 'none' | 'token' | 'hmac' | 'jwt';
      secret?: string;
      jwt_issuer?: string;
    };
    const secret = auth.secret ?? '';
    let sigTimestamp = '';

    if (auth.mode === 'token') {
      const bearer = normHeaders['authorization']?.replace(/^Bearer\s+/i, '').trim() ?? '';
      const headerTok = normHeaders['x-webhook-token']?.trim() ?? '';
      const candidate = bearer || headerTok;
      if (!secret || !safeStringEqual(candidate, secret)) {
        throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid webhook bearer/header token.');
      }
    } else if (auth.mode === 'hmac') {
      const parsed = normHeaders['x-signature']
        ? parseHmacSignatureHeader(normHeaders['x-signature'])
        : null;
      if (!parsed || !secret) {
        throw new PlatformError('AUTH_UNAUTHENTICATED', 'Missing or malformed X-Signature header.');
      }
      const nowSec = Math.floor(this.clock.now().getTime() / 1000);
      if (Math.abs(nowSec - parsed.t) > HMAC_MAX_SKEW_SECONDS) {
        throw new PlatformError(
          'AUTH_TOKEN_EXPIRED',
          'Webhook HMAC timestamp exceeds 5-minute skew window.',
        );
      }
      const expectedHex = createHmac('sha256', secret)
        .update(`${parsed.t}.${params.rawBody}`, 'utf8')
        .digest('hex');
      if (!safeStringEqual(parsed.v1, expectedHex)) {
        throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid webhook HMAC signature.');
      }
      sigTimestamp = String(parsed.t);
    } else if (auth.mode === 'jwt') {
      const bearer = normHeaders['authorization']?.replace(/^Bearer\s+/i, '').trim() ?? '';
      if (!bearer || !secret) {
        throw new PlatformError('AUTH_UNAUTHENTICATED', 'Missing webhook JWT Bearer token.');
      }
      verifyHs256Jwt(
        bearer,
        secret,
        Math.floor(this.clock.now().getTime() / 1000),
        auth.jwt_issuer,
      );
    }

    let payload: Record<string, unknown> = {};
    if (params.rawBody.trim()) {
      try {
        const parsedJson = JSON.parse(params.rawBody) as unknown;
        payload =
          parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)
            ? (parsedJson as Record<string, unknown>)
            : { value: parsedJson };
      } catch {
        payload = { raw: params.rawBody };
      }
    }

    const bodyHash = createHash('sha256').update(params.rawBody, 'utf8').digest('hex');
    const explicitKey = normHeaders['idempotency-key'] ?? normHeaders['x-webhook-nonce'];
    const dedupKey = explicitKey
      ? `${trigger.id}::${explicitKey}`
      : `${trigger.id}::${sigTimestamp || 'nosig'}::${bodyHash}`;

    const nowIso = this.clock.now().toISOString();
    if (this.dedupSeen.has(dedupKey)) {
      this.events.push({
        id: this.idGen.uuidv7(),
        orgId: trigger.orgId,
        workspaceId: trigger.workspaceId,
        triggerId: trigger.id,
        runId: null,
        dedupKey,
        payload,
        headers: normHeaders,
        status: 'rejected',
        receivedAt: nowIso,
      });
      throw new PlatformError('RES_CONFLICT', 'Duplicate/replayed webhook delivery rejected.');
    }

    this.dedupSeen.add(dedupKey);
    const captured = trigger.testMode;
    if (captured) {
      trigger.testMode = false;
    }

    const event: TriggerEventRecord = {
      id: this.idGen.uuidv7(),
      orgId: trigger.orgId,
      workspaceId: trigger.workspaceId,
      triggerId: trigger.id,
      runId: null,
      dedupKey,
      payload,
      headers: normHeaders,
      status: captured ? 'captured_test' : 'accepted',
      receivedAt: nowIso,
    };
    this.events.push(event);
    trigger.lastFiredAt = nowIso;
    trigger.updatedAt = nowIso;

    return {
      trigger,
      event,
      payload,
      shouldStartRun: !captured,
    };
  }

  getEvent(orgId: string, eventId: string): TriggerEventRecord | undefined {
    const evt = this.events.find((e) => e.id === eventId && e.orgId === orgId);
    return evt;
  }

  listEvents(orgId: string, triggerId: string): TriggerEventRecord[] {
    return this.events.filter((e) => e.orgId === orgId && e.triggerId === triggerId);
  }

  /**
   * Evaluates schedule triggers against current time applying misfire_policy (E0.4-5).
   */
  collectDueScheduleFirings(now: Date = this.clock.now()): Array<{
    trigger: TriggerRecord;
    scheduledFor: string;
  }> {
    const firings: Array<{ trigger: TriggerRecord; scheduledFor: string }> = [];
    const nowMs = now.getTime();

    for (const trig of this.triggers.values()) {
      if (!trig.active || trig.kind !== 'schedule' || !trig.nextFireAt) continue;
      const intervalMs =
        typeof trig.config['interval_ms'] === 'number' ? trig.config['interval_ms'] : 60_000;
      const misfirePolicy = String(trig.config['misfire_policy'] ?? 'run_once') as
        | 'skip'
        | 'run_once'
        | 'run_all';
      const dueAtMs = Date.parse(trig.nextFireAt);
      if (nowMs < dueAtMs) continue;

      const missedCount = Math.floor((nowMs - dueAtMs) / intervalMs) + 1;
      if (misfirePolicy === 'skip') {
        if (missedCount <= 1) {
          firings.push({ trigger: trig, scheduledFor: trig.nextFireAt });
        }
      } else if (misfirePolicy === 'run_once') {
        firings.push({ trigger: trig, scheduledFor: trig.nextFireAt });
      } else {
        const capped = Math.min(missedCount, 10);
        for (let k = 0; k < capped; k++) {
          firings.push({
            trigger: trig,
            scheduledFor: new Date(dueAtMs + k * intervalMs).toISOString(),
          });
        }
      }

      const nextSlotMs = dueAtMs + missedCount * intervalMs;
      trig.lastFiredAt = now.toISOString();
      trig.nextFireAt = new Date(nextSlotMs).toISOString();
      trig.updatedAt = now.toISOString();
    }

    return firings;
  }
}
