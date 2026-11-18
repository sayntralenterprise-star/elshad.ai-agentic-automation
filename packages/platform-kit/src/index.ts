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

export type SecretRef = `secret://db/${string}`;

export interface SecretMeta {
  name: string;
  environmentId?: string;
}

export type SecretPurpose = 'tool_call' | 'provider_call' | 'webhook_sign';

export interface SecretRecordMetadata {
  ref: SecretRef;
  orgId: string;
  name: string;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecretsProvider {
  put(ctx: TenantContext, value: Uint8Array, meta: SecretMeta): Promise<SecretRef>;
  resolve(ctx: TenantContext, ref: SecretRef, purpose: SecretPurpose): Promise<Uint8Array>;
  rotate(ctx: TenantContext, ref: SecretRef, value: Uint8Array): Promise<SecretRef>;
  delete(ctx: TenantContext, ref: SecretRef): Promise<void>;
  getMetadata(ctx: TenantContext, ref: SecretRef): Promise<SecretRecordMetadata | null>;
}

interface StoredEnvelope {
  orgId: string;
  name: string;
  keyVersion: number;
  wrappedDek: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  ciphertext: Buffer;
  dataIv: Buffer;
  dataTag: Buffer;
  createdAt: string;
  updatedAt: string;
}

/**
 * Envelope encryption secrets provider using AES-256-GCM (PRD D13, F.3).
 */
export class EnvelopeSecretsProvider implements SecretsProvider {
  private readonly kek: Buffer;
  private readonly records = new Map<SecretRef, StoredEnvelope>();

  constructor(
    masterKeyMaterial: string,
    private readonly clock: Clock = new SystemClock(),
  ) {
    if (masterKeyMaterial.length < 32) {
      throw new PlatformError('SYS_INTERNAL', 'Master key material must be at least 32 chars');
    }
    this.kek = createHash('sha256').update(masterKeyMaterial, 'utf8').digest();
  }

  private encryptEnvelope(
    orgId: string,
    name: string,
    plaintext: Uint8Array,
    keyVersion: number,
    createdAt: string,
    updatedAt: string,
  ): StoredEnvelope {
    const dek = randomBytes(32);
    const dataIv = randomBytes(12);
    const dataCipher = createCipheriv('aes-256-gcm', dek, dataIv);
    dataCipher.setAAD(Buffer.from(orgId, 'utf8'));
    const ciphertext = Buffer.concat([dataCipher.update(plaintext), dataCipher.final()]);
    const dataTag = dataCipher.getAuthTag();

    const dekIv = randomBytes(12);
    const dekCipher = createCipheriv('aes-256-gcm', this.kek, dekIv);
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
    const dekTag = dekCipher.getAuthTag();

    dek.fill(0);

    return {
      orgId,
      name,
      keyVersion,
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
    const id = generateUuidv7(this.clock.now().getTime());
    const ref: SecretRef = `secret://db/${id}`;
    const nowIso = this.clock.now().toISOString();
    const env = this.encryptEnvelope(ctx.orgId, meta.name, value, 1, nowIso, nowIso);
    this.records.set(ref, env);
    return ref;
  }

  async resolve(ctx: TenantContext, ref: SecretRef, _purpose: SecretPurpose): Promise<Uint8Array> {
    const env = this.records.get(ref);
    if (!env || env.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Secret not found: ${ref}`);
    }

    const dekDecipher = createDecipheriv('aes-256-gcm', this.kek, env.dekIv);
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
      ctx.orgId,
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
      ref,
      orgId: existing.orgId,
      name: existing.name,
      keyVersion: existing.keyVersion,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }
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
