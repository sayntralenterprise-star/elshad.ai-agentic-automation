import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  PlatformError,
  SystemClock,
  generateUuidv7,
  type Clock,
  type TenantContext,
} from '@elshad/domain';

export interface CloudEvent<T = Record<string, unknown>> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  subject: string;
  time: string;
  datacontenttype: 'application/json';
  orgid: string;
  workspaceid?: string;
  traceparent?: string;
  schema: number;
  data: T;
}

export type Unsubscribe = () => void;

export interface EventBus {
  publish(evt: CloudEvent): Promise<void>;
  subscribe(
    filter: { orgId: string; types?: string[]; subject?: string },
    handler: (evt: CloudEvent) => Promise<void> | void,
  ): Promise<Unsubscribe>;
}

export class InMemoryEventBus implements EventBus {
  private readonly subscribers = new Set<{
    filter: { orgId: string; types?: string[]; subject?: string };
    handler: (evt: CloudEvent) => Promise<void> | void;
  }>();
  readonly published: CloudEvent[] = [];

  async publish(evt: CloudEvent): Promise<void> {
    this.published.push(evt);
    for (const sub of this.subscribers) {
      if (sub.filter.orgId !== evt.orgid) continue;
      if (sub.filter.types && !sub.filter.types.includes(evt.type)) continue;
      if (sub.filter.subject && sub.filter.subject !== evt.subject) continue;
      await sub.handler(evt);
    }
  }

  async subscribe(
    filter: { orgId: string; types?: string[]; subject?: string },
    handler: (evt: CloudEvent) => Promise<void> | void,
  ): Promise<Unsubscribe> {
    const entry = { filter, handler };
    this.subscribers.add(entry);
    return () => {
      this.subscribers.delete(entry);
    };
  }
}

export type BlobRef = `blob://${string}`;

export interface ObjectStore {
  put(
    ctx: TenantContext,
    key: string,
    body: Uint8Array | Readable,
    meta?: Record<string, string>,
  ): Promise<BlobRef>;
  get(
    ctx: TenantContext,
    ref: BlobRef,
    range?: { start: number; end: number },
  ): Promise<Uint8Array>;
  delete(ctx: TenantContext, ref: BlobRef): Promise<void>;
  presignPut(ctx: TenantContext, key: string, ttlMs: number): Promise<string>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly blobs = new Map<
    string,
    { orgId: string; bytes: Uint8Array; meta?: Record<string, string> }
  >();

  constructor(private readonly bucket = 'platform-artifacts') {}

  async put(
    ctx: TenantContext,
    key: string,
    body: Uint8Array | Readable,
    meta?: Record<string, string>,
  ): Promise<BlobRef> {
    let bytes: Uint8Array;
    if (body instanceof Uint8Array) {
      bytes = new Uint8Array(body);
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      bytes = new Uint8Array(Buffer.concat(chunks));
    }
    const cleanKey = key.replace(/^\/+/, '');
    const ref: BlobRef = `blob://${this.bucket}/${ctx.orgId}/${cleanKey}`;
    this.blobs.set(ref, { orgId: ctx.orgId, bytes, meta });
    return ref;
  }

  async get(
    ctx: TenantContext,
    ref: BlobRef,
    range?: { start: number; end: number },
  ): Promise<Uint8Array> {
    const entry = this.blobs.get(ref);
    if (!entry || entry.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Blob not found: ${ref}`);
    }
    if (range) {
      return entry.bytes.subarray(range.start, range.end + 1);
    }
    return new Uint8Array(entry.bytes);
  }

  async delete(ctx: TenantContext, ref: BlobRef): Promise<void> {
    const entry = this.blobs.get(ref);
    if (entry && entry.orgId === ctx.orgId) {
      this.blobs.delete(ref);
    }
  }

  async presignPut(ctx: TenantContext, key: string, ttlMs: number): Promise<string> {
    const cleanKey = key.replace(/^\/+/, '');
    return `https://storage.local/${this.bucket}/${ctx.orgId}/${cleanKey}?expires_ms=${ttlMs}`;
  }
}

export type SecretRef = `secret://db/${string}` | `secret://vault/${string}`;

export interface SecretMeta {
  name: string;
  environmentId?: string;
}

export type SecretPurpose = 'tool_call' | 'provider_call' | 'webhook_sign';

export interface SecretRecordMetadata {
  id: string;
  ref: SecretRef;
  orgId: string;
  provider: 'db' | 'vault';
  name: string;
  environmentId?: string | null;
  keyVersion: number;
  kekVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecretsProvider {
  put(ctx: TenantContext, value: Uint8Array, meta: SecretMeta): Promise<SecretRef>;
  resolve(ctx: TenantContext, ref: SecretRef, purpose: SecretPurpose): Promise<Uint8Array>;
  rotate(ctx: TenantContext, ref: SecretRef, value: Uint8Array): Promise<SecretRef>;
  delete(ctx: TenantContext, ref: SecretRef): Promise<void>;
  getMetadata(ctx: TenantContext, ref: SecretRef): Promise<SecretRecordMetadata | null>;
  listMetadata?(ctx: TenantContext): Promise<SecretRecordMetadata[]>;
}

interface StoredEnvelope {
  id: string;
  orgId: string;
  environmentId: string | null;
  name: string;
  keyVersion: number;
  kekVersion: number;
  wrappedDek: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  ciphertext: Buffer;
  dataIv: Buffer;
  dataTag: Buffer;
  createdAt: string;
  updatedAt: string;
}

function deriveKekFromMaterial(masterKeyMaterial: string): Buffer {
  if (masterKeyMaterial.length < 32) {
    throw new PlatformError('SYS_INTERNAL', 'Master key material must be at least 32 chars');
  }
  return createHash('sha256').update(masterKeyMaterial, 'utf8').digest();
}

/**
 * Envelope encryption secrets provider using AES-256-GCM with versioned KEK rotation (PRD D13, F.3).
 */
export class EnvelopeSecretsProvider implements SecretsProvider {
  private readonly keks = new Map<number, Buffer>();
  private currentKekVersion = 1;
  private readonly records = new Map<SecretRef, StoredEnvelope>();

  constructor(
    masterKeyMaterial: string,
    private readonly clock: Clock = new SystemClock(),
  ) {
    this.keks.set(1, deriveKekFromMaterial(masterKeyMaterial));
  }

  /**
   * Rotates the Key Encryption Key while retaining prior KEK versions so existing secrets keep decrypting.
   */
  rotateMasterKey(newKeyMaterial: string): number {
    const nextVersion = this.currentKekVersion + 1;
    this.keks.set(nextVersion, deriveKekFromMaterial(newKeyMaterial));
    this.currentKekVersion = nextVersion;
    return nextVersion;
  }

  private encryptEnvelope(
    id: string,
    orgId: string,
    environmentId: string | null,
    name: string,
    plaintext: Uint8Array,
    keyVersion: number,
    createdAt: string,
    updatedAt: string,
  ): StoredEnvelope {
    const kekVersion = this.currentKekVersion;
    const kek = this.keks.get(kekVersion);
    if (!kek) {
      throw new PlatformError('SYS_INTERNAL', `Missing KEK version ${kekVersion}`);
    }

    const dek = randomBytes(32);
    const dataIv = randomBytes(12);
    const dataCipher = createCipheriv('aes-256-gcm', dek, dataIv);
    dataCipher.setAAD(Buffer.from(orgId, 'utf8'));
    const ciphertext = Buffer.concat([dataCipher.update(plaintext), dataCipher.final()]);
    const dataTag = dataCipher.getAuthTag();

    const dekIv = randomBytes(12);
    const dekCipher = createCipheriv('aes-256-gcm', kek, dekIv);
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
    const dekTag = dekCipher.getAuthTag();

    dek.fill(0);

    return {
      id,
      orgId,
      environmentId,
      name,
      keyVersion,
      kekVersion,
      wrappedDek,
      dekIv,
      dekTag,
      ciphertext,
      dataIv,
      dataTag,
      createdAt,
      updatedAt,
    };
  }

  async put(ctx: TenantContext, value: Uint8Array, meta: SecretMeta): Promise<SecretRef> {
    for (const [existingRef, env] of this.records.entries()) {
      if (
        env.orgId === ctx.orgId &&
        env.name === meta.name &&
        env.environmentId === (meta.environmentId ?? null)
      ) {
        await this.rotate(ctx, existingRef, value);
        return existingRef;
      }
    }
    const id = generateUuidv7(this.clock.now().getTime());
    const ref: SecretRef = `secret://db/${id}`;
    const nowIso = this.clock.now().toISOString();
    const env = this.encryptEnvelope(
      id,
      ctx.orgId,
      meta.environmentId ?? null,
      meta.name,
      value,
      1,
      nowIso,
      nowIso,
    );
    this.records.set(ref, env);
    return ref;
  }

  async resolve(ctx: TenantContext, ref: SecretRef, _purpose: SecretPurpose): Promise<Uint8Array> {
    const env = this.records.get(ref);
    if (!env || env.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Secret not found: ${ref}`);
    }

    const kek = this.keks.get(env.kekVersion);
    if (!kek) {
      throw new PlatformError('SYS_INTERNAL', `Missing KEK version ${env.kekVersion}`);
    }

    const dekDecipher = createDecipheriv('aes-256-gcm', kek, env.dekIv);
    dekDecipher.setAuthTag(env.dekTag);
    const dek = Buffer.concat([dekDecipher.update(env.wrappedDek), dekDecipher.final()]);

    try {
      const dataDecipher = createDecipheriv('aes-256-gcm', dek, env.dataIv);
      dataDecipher.setAAD(Buffer.from(ctx.orgId, 'utf8'));
      dataDecipher.setAuthTag(env.dataTag);
      const plain = Buffer.concat([dataDecipher.update(env.ciphertext), dataDecipher.final()]);
      return new Uint8Array(plain);
    } finally {
      dek.fill(0);
    }
  }

  async rotate(ctx: TenantContext, ref: SecretRef, value: Uint8Array): Promise<SecretRef> {
    const existing = this.records.get(ref);
    if (!existing || existing.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Secret not found: ${ref}`);
    }
    const nowIso = this.clock.now().toISOString();
    const updated = this.encryptEnvelope(
      existing.id,
      ctx.orgId,
      existing.environmentId,
      existing.name,
      value,
      existing.keyVersion + 1,
      existing.createdAt,
      nowIso,
    );
    this.records.set(ref, updated);
    return ref;
  }

  async delete(ctx: TenantContext, ref: SecretRef): Promise<void> {
    const existing = this.records.get(ref);
    if (existing && existing.orgId === ctx.orgId) {
      this.records.delete(ref);
    }
  }

  async getMetadata(ctx: TenantContext, ref: SecretRef): Promise<SecretRecordMetadata | null> {
    const existing = this.records.get(ref);
    if (!existing || existing.orgId !== ctx.orgId) {
      return null;
    }
    return {
      id: existing.id,
      ref,
      orgId: existing.orgId,
      provider: 'db',
      name: existing.name,
      environmentId: existing.environmentId,
      keyVersion: existing.keyVersion,
      kekVersion: existing.kekVersion,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  async listMetadata(ctx: TenantContext): Promise<SecretRecordMetadata[]> {
    const out: SecretRecordMetadata[] = [];
    for (const [ref, existing] of this.records.entries()) {
      if (existing.orgId !== ctx.orgId) continue;
      out.push({
        id: existing.id,
        ref,
        orgId: existing.orgId,
        provider: 'db',
        name: existing.name,
        environmentId: existing.environmentId,
        keyVersion: existing.keyVersion,
        kekVersion: existing.kekVersion,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      });
    }
    return out;
  }
}

export interface VaultTransport {
  request(opts: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    body?: Record<string, unknown>;
  }): Promise<{ status: number; data?: Record<string, unknown> }>;
}

/**
 * HashiCorp Vault KV v2 adapter implementing the SecretsProvider contract (D13, C.7, E0.6-1).
 */
export class VaultSecretsProvider implements SecretsProvider {
  private readonly address: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly clock: Clock;
  private readonly transport: VaultTransport;
  private readonly metaIndex = new Map<SecretRef, SecretRecordMetadata>();

  constructor(opts: {
    address: string;
    token?: string;
    mount?: string;
    clock?: Clock;
    transport?: VaultTransport;
  }) {
    this.address = opts.address.replace(/\/+$/, '');
    this.token = opts.token ?? '';
    this.mount = opts.mount ?? 'secret';
    this.clock = opts.clock ?? new SystemClock();
    this.transport = opts.transport ?? {
      request: async ({ method, path, body }) => {
        const res = await fetch(`${this.address}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(this.token ? { 'X-Vault-Token': this.token } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = res.status === 204 ? undefined : ((await res.json()) as Record<string, unknown>);
        return { status: res.status, data };
      },
    };
  }

  private kvPath(orgId: string, id: string): string {
    return `/v1/${this.mount}/data/${orgId}/${id}`;
  }

  async put(ctx: TenantContext, value: Uint8Array, meta: SecretMeta): Promise<SecretRef> {
    const id = generateUuidv7(this.clock.now().getTime());
    const ref: SecretRef = `secret://vault/${id}`;
    const b64 = Buffer.from(value).toString('base64');
    const res = await this.transport.request({
      method: 'POST',
      path: this.kvPath(ctx.orgId, id),
      body: { data: { value_b64: b64, name: meta.name } },
    });
    if (res.status >= 400) {
      throw new PlatformError('SYS_INTERNAL', `Vault write failed (${res.status}).`);
    }
    const nowIso = this.clock.now().toISOString();
    this.metaIndex.set(ref, {
      id,
      ref,
      orgId: ctx.orgId,
      provider: 'vault',
      name: meta.name,
      environmentId: meta.environmentId ?? null,
      keyVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return ref;
  }

  async resolve(ctx: TenantContext, ref: SecretRef, _purpose: SecretPurpose): Promise<Uint8Array> {
    const meta = this.metaIndex.get(ref);
    if (!meta || meta.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Secret not found: ${ref}`);
    }
    const id = ref.replace('secret://vault/', '');
    const res = await this.transport.request({
      method: 'GET',
      path: this.kvPath(ctx.orgId, id),
    });
    if (res.status === 404 || !res.data) {
      throw new PlatformError('RES_NOT_FOUND', `Secret not found in Vault: ${ref}`);
    }
    const payload = (res.data['data'] as Record<string, unknown> | undefined)?.['data'] as
      | Record<string, unknown>
      | undefined;
    const b64 = payload?.['value_b64'] ?? (res.data['data'] as Record<string, unknown> | undefined)?.['value_b64'];
    if (typeof b64 !== 'string') {
      throw new PlatformError('SYS_INTERNAL', `Vault payload missing secret bytes for ${ref}`);
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  async rotate(ctx: TenantContext, ref: SecretRef, value: Uint8Array): Promise<SecretRef> {
    const existing = this.metaIndex.get(ref);
    if (!existing || existing.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Secret not found: ${ref}`);
    }
    const id = ref.replace('secret://vault/', '');
    const b64 = Buffer.from(value).toString('base64');
    const res = await this.transport.request({
      method: 'POST',
      path: this.kvPath(ctx.orgId, id),
      body: { data: { value_b64: b64, name: existing.name } },
    });
    if (res.status >= 400) {
      throw new PlatformError('SYS_INTERNAL', `Vault rotate failed (${res.status}).`);
    }
    this.metaIndex.set(ref, {
      ...existing,
      keyVersion: existing.keyVersion + 1,
      updatedAt: this.clock.now().toISOString(),
    });
    return ref;
  }

  async delete(ctx: TenantContext, ref: SecretRef): Promise<void> {
    const existing = this.metaIndex.get(ref);
    if (!existing || existing.orgId !== ctx.orgId) return;
    const id = ref.replace('secret://vault/', '');
    await this.transport.request({
      method: 'DELETE',
      path: this.kvPath(ctx.orgId, id),
    });
    this.metaIndex.delete(ref);
  }

  async getMetadata(ctx: TenantContext, ref: SecretRef): Promise<SecretRecordMetadata | null> {
    const existing = this.metaIndex.get(ref);
    if (!existing || existing.orgId !== ctx.orgId) return null;
    return { ...existing };
  }

  async listMetadata(ctx: TenantContext): Promise<SecretRecordMetadata[]> {
    return [...this.metaIndex.values()]
      .filter((m) => m.orgId === ctx.orgId)
      .map((m) => ({ ...m }));
  }
}

export interface SecretScanFinding {
  readonly path: string;
  readonly reason: 'known_secret_leak' | 'pattern_secret_leak';
}

export interface SecretScanReport {
  readonly clean: boolean;
  readonly scannedValues: number;
  readonly findings: SecretScanFinding[];
}

const LEAK_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Recursively scans logs, trace spans, run steps, prompts, and UI payloads for plaintext secret leakage (E0.6-1, S.3).
 */
export function scanForSecretLeaks(
  payloads: readonly unknown[],
  knownSecrets: readonly string[] = [],
): SecretScanReport {
  const activeSecrets = knownSecrets.filter((s) => s.length >= 6);
  const findings: SecretScanFinding[] = [];
  let scannedValues = 0;

  const visit = (val: unknown, path: string): void => {
    if (typeof val === 'string') {
      scannedValues += 1;
      if (
        val.startsWith('secret://db/') ||
        val.startsWith('secret://vault/') ||
        val.includes('[REDACTED:')
      ) {
        return;
      }
      for (const sec of activeSecrets) {
        if (val.includes(sec)) {
          findings.push({ path, reason: 'known_secret_leak' });
          return;
        }
      }
      for (const rx of LEAK_PATTERNS) {
        if (rx.test(val)) {
          findings.push({ path, reason: 'pattern_secret_leak' });
          return;
        }
      }
      return;
    }

    if (Array.isArray(val)) {
      val.forEach((entry, i) => visit(entry, `${path}[${i}]`));
      return;
    }

    if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        visit(v, `${path}.${k}`);
      }
    }
  };

  payloads.forEach((p, idx) => visit(p, `$[${idx}]`));
  return {
    clean: findings.length === 0,
    scannedValues,
    findings,
  };
}

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  incrWindow(key: string, windowMs: number): Promise<{ count: number; resetAtMs: number }>;
}

export class InMemoryCache implements Cache {
  private readonly store = new Map<string, { value: string; expiresAtMs?: number }>();
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly clock: Clock = new SystemClock()) {}

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== undefined && this.clock.now().getTime() >= entry.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const expiresAtMs = ttlMs !== undefined ? this.clock.now().getTime() + ttlMs : undefined;
    this.store.set(key, { value, expiresAtMs });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    this.windows.delete(key);
  }

  async incrWindow(key: string, windowMs: number): Promise<{ count: number; resetAtMs: number }> {
    const now = this.clock.now().getTime();
    const cutoff = now - windowMs;
    const timestamps = (this.windows.get(key) ?? []).filter((ts) => ts > cutoff);
    timestamps.push(now);
    this.windows.set(key, timestamps);
    const oldest = timestamps[0] ?? now;
    return {
      count: timestamps.length,
      resetAtMs: oldest + windowMs,
    };
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  constructor(
    private readonly cache: Cache,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const { count, resetAtMs } = await this.cache.incrWindow(key, windowMs);
    const nowMs = this.clock.now().getTime();
    const remaining = Math.max(0, limit - count);
    const resetEpochSeconds = Math.ceil(resetAtMs / 1000);
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
    return {
      allowed: count <= limit,
      limit,
      remaining,
      resetEpochSeconds,
      retryAfterSeconds,
    };
  }
}
