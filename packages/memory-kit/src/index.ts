import { createHash } from 'node:crypto';
import { canonicalJson } from '@elshad/db';
import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  type Clock,
  type IdGen,
  type TenantContext,
} from '@elshad/domain';
import { estimateTokenCount } from '@elshad/model-kit';
import { withSpan } from '@elshad/telemetry';
import { assertSafeOutboundUrl, type ToolContract, type CustomToolExecutor } from '@elshad/tool-kit';
import { z } from 'zod';

export type MemoryScope = 'run' | 'session' | 'user' | 'agent' | 'project' | 'org';
export type MemoryKind = 'episodic' | 'semantic' | 'procedural';
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted' | 'pii';

export const SENSITIVITY_RANK: Record<SensitivityLevel, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  pii: 4,
};

export interface MemoryProvenance {
  readonly sourceRunId?: string;
  readonly sourceStepId?: string;
  readonly sourceDocId?: string;
  readonly sourcePrincipalId?: string;
  readonly confidence?: number;
  readonly createdVia?: 'auto_extract' | 'explicit_tool' | 'human' | 'system';
}

export interface MemoryItem {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly scope: MemoryScope;
  readonly scopeId: string | null;
  readonly subjectId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly contentHash: string;
  readonly embeddingDim: number;
  readonly embedding: readonly number[];
  readonly metadata: Record<string, unknown>;
  readonly sensitivity: SensitivityLevel;
  readonly provenance: MemoryProvenance;
  readonly importance: number;
  readonly contradictsId: string | null;
  readonly ttlAt: string | null;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewMemoryItem {
  readonly id?: string;
  readonly projectId?: string | null;
  readonly scope: MemoryScope;
  readonly scopeId?: string | null;
  readonly subjectId?: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly sensitivity?: SensitivityLevel;
  readonly provenance?: MemoryProvenance;
  readonly importance?: number;
  readonly ttlAt?: string | null;
  readonly pinned?: boolean;
}

export interface MemoryScopeRule {
  readonly scope: MemoryScope;
  readonly scopeId?: string;
}

export interface MemoryQuery {
  readonly query: string;
  readonly topK?: number;
  readonly minScore?: number;
  readonly scope?: MemoryScope;
  readonly scopeId?: string;
  readonly allowedScopes?: readonly MemoryScopeRule[];
  readonly kind?: MemoryKind;
  readonly subjectId?: string;
  readonly maxSensitivity?: SensitivityLevel;
  readonly allowedSensitivities?: readonly SensitivityLevel[];
  readonly metadataFilter?: Record<string, unknown>;
  readonly nowMs?: number;
}

export interface MemoryScoreBreakdown {
  readonly cosine: number;
  readonly bm25Norm: number;
  readonly recencyDecay: number;
  readonly importance: number;
}

export interface ScoredMemoryItem {
  readonly item: MemoryItem;
  readonly score: number;
  readonly breakdown: MemoryScoreBreakdown;
}

export interface MemoryFilter {
  readonly scope?: MemoryScope;
  readonly scopeId?: string;
  readonly kind?: MemoryKind;
  readonly subjectId?: string;
  readonly sensitivity?: SensitivityLevel;
  readonly maxSensitivity?: SensitivityLevel;
  readonly q?: string;
}

export interface MemoryPage {
  readonly items: MemoryItem[];
  readonly nextCursor: string | null;
}

export interface ErasureReport {
  readonly orgId: string;
  readonly subjectId: string;
  readonly deletedMemoryItems: number;
  readonly deletedSessions: number;
  readonly erasedAt: string;
}

/**
 * Abstract backend contract per architecture doc §9 (FR-MEM-8).
 */
export interface MemoryBackend {
  put(ctx: TenantContext, item: NewMemoryItem): Promise<MemoryItem>;
  get(ctx: TenantContext, id: string): Promise<MemoryItem | null>;
  update(
    ctx: TenantContext,
    id: string,
    patch: { content?: string; pinned?: boolean; importance?: number; metadata?: Record<string, unknown> },
  ): Promise<MemoryItem>;
  search(ctx: TenantContext, q: MemoryQuery): Promise<ScoredMemoryItem[]>;
  delete(ctx: TenantContext, id: string, opts: { hard: boolean }): Promise<void>;
  list(ctx: TenantContext, filter: MemoryFilter, cursor?: string, limit?: number): Promise<MemoryPage>;
  export(ctx: TenantContext, filter: MemoryFilter): AsyncIterable<MemoryItem>;
  eraseSubject(ctx: TenantContext, subjectId: string): Promise<ErasureReport>;
}

// ---------- Deterministic Embedding & Hybrid Scoring Helpers (N.2.10) ----------

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function tokenizeNormalized(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return raw.map((tok) => {
    if (tok.length > 5 && tok.endsWith('ing')) return tok.slice(0, -3);
    if (tok.length > 4 && tok.endsWith('ed')) return tok.slice(0, -2);
    if (tok.length > 4 && tok.endsWith('es')) return tok.slice(0, -2);
    if (tok.length > 3 && tok.endsWith('s')) return tok.slice(0, -1);
    return tok;
  });
}

function fnv1a32(input: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom <= 1e-12 ? 0 : Math.max(-1, Math.min(1, dot / denom));
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
}

/**
 * Deterministic hashed TF + character n-gram L2-normalized embedder for Compose/CI offline execution.
 */
export class DeterministicEmbeddingGenerator implements EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  embedCallCount = 0;

  constructor(opts: { model?: string; dimension?: number } = {}) {
    this.model = opts.model ?? 'mock/text-embedding-3-small';
    const dim = opts.dimension ?? 1536;
    if (dim < 64 || dim > 3072) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', `Embedding dimension ${dim} must be 64..3072.`);
    }
    this.dimension = dim;
  }

  async embed(text: string): Promise<number[]> {
    this.embedCallCount += 1;
    const vec = new Float64Array(this.dimension);
    const tokens = tokenizeNormalized(text);
    const rawTokens = text.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];

    for (const tok of tokens) {
      const idx = fnv1a32(tok, 2166136261) % this.dimension;
      vec[idx] = (vec[idx] ?? 0) + 1.8;
      if (tok.length >= 4) {
        for (let i = 0; i <= tok.length - 3; i += 1) {
          const tri = tok.slice(i, i + 3);
          const triIdx = fnv1a32(tri, 314159265) % this.dimension;
          vec[triIdx] = (vec[triIdx] ?? 0) + 0.35;
        }
      }
    }

    for (const raw of rawTokens) {
      if (raw.includes('-') || raw.includes('_') || /\d/.test(raw)) {
        const idIdx = fnv1a32(raw, 982451653) % this.dimension;
        vec[idIdx] = (vec[idIdx] ?? 0) + 2.4;
      }
    }

    for (let i = 0; i < tokens.length - 1; i += 1) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      const bIdx = fnv1a32(bigram, 161803398) % this.dimension;
      vec[bIdx] = (vec[bIdx] ?? 0) + 1.1;
    }

    let normSq = 0;
    for (let i = 0; i < vec.length; i += 1) {
      normSq += vec[i]! * vec[i]!;
    }
    const norm = Math.sqrt(normSq);
    if (norm <= 1e-12) {
      return new Array<number>(this.dimension).fill(0);
    }
    const out = new Array<number>(this.dimension);
    for (let i = 0; i < vec.length; i += 1) {
      out[i] = Number((vec[i]! / norm).toFixed(6));
    }
    return out;
  }
}

export interface HybridCandidate {
  readonly id: string;
  readonly content: string;
  readonly contentHash: string;
  readonly embedding: readonly number[];
  readonly kind: MemoryKind | 'kb_chunk';
  readonly createdAtMs: number;
  readonly importance: number;
}

/**
 * Ranks filtered candidates using PRD N.2.10 formula:
 * score = 0.55*cosine + 0.20*bm25_norm + 0.15*recency_decay + 0.10*importance
 * then takes top 4*k, applies exact-phrase rerank, and deduplicates by hash & cosine > 0.95.
 */
export function rankHybridCandidates<T extends HybridCandidate>(
  candidates: readonly T[],
  query: string,
  queryEmbedding: readonly number[],
  opts: {
    topK?: number;
    minScore?: number;
    nowMs?: number;
  } = {},
): Array<{ candidate: T; score: number; breakdown: MemoryScoreBreakdown }> {
  if (candidates.length === 0) return [];
  const k = Math.max(1, Math.min(100, opts.topK ?? 5));
  const minScore = opts.minScore ?? 0;
  const nowMs = opts.nowMs ?? Date.now();

  const qTokens = tokenizeNormalized(query);
  const qTermSet = new Set(qTokens);
  const rawQueryLower = query.trim().toLowerCase();

  // Compute Okapi BM25 across pre-filtered candidates
  const docTokensList = candidates.map((c) => tokenizeNormalized(c.content));
  const avgDocLen =
    docTokensList.reduce((sum, t) => sum + t.length, 0) / Math.max(1, candidates.length);
  const docFreq = new Map<string, number>();
  for (const docTokens of docTokensList) {
    const seen = new Set(docTokens);
    for (const tok of seen) {
      docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
    }
  }

  const rawBm25Scores = candidates.map((_, idx) => {
    const tokens = docTokensList[idx]!;
    if (tokens.length === 0 || qTermSet.size === 0) return 0;
    const tf = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    const k1 = 1.2;
    const b = 0.75;
    let sum = 0;
    const N = candidates.length;
    for (const term of qTermSet) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const denom = freq + k1 * (1 - b + (b * tokens.length) / Math.max(1, avgDocLen));
      sum += idf * ((freq * (k1 + 1)) / denom);
    }
    return sum;
  });

  const maxBm25 = rawBm25Scores.reduce((m, s) => Math.max(m, s), 0);

  const scored = candidates.map((cand, idx) => {
    const cosine = Math.max(0, cosineSimilarity(queryEmbedding, cand.embedding));
    const bm25Norm = maxBm25 > 1e-9 ? rawBm25Scores[idx]! / maxBm25 : 0;

    let recencyDecay = 1;
    if (cand.kind === 'episodic') {
      const ageDays = Math.max(0, (nowMs - cand.createdAtMs) / 86_400_000);
      recencyDecay = Math.exp((-Math.LN2 * ageDays) / 30);
    }

    const importance = Math.max(0, Math.min(1, cand.importance));
    const baseScore =
      0.55 * cosine + 0.2 * bm25Norm + 0.15 * recencyDecay + 0.1 * importance;

    return {
      candidate: cand,
      baseScore,
      breakdown: {
        cosine: Number(cosine.toFixed(4)),
        bm25Norm: Number(bm25Norm.toFixed(4)),
        recencyDecay: Number(recencyDecay.toFixed(4)),
        importance: Number(importance.toFixed(4)),
      },
    };
  });

  scored.sort((a, b) => b.baseScore - a.baseScore);
  const pool = scored.slice(0, k * 4);

  // Rerank top 4*k with exact-phrase / exact-identifier boost
  const reranked = pool
    .map((entry) => {
      const contentLower = entry.candidate.content.toLowerCase();
      const phraseMatch = rawQueryLower.length >= 4 && contentLower.includes(rawQueryLower) ? 1 : 0;
      const score = Math.min(1, Number((entry.baseScore + phraseMatch * 0.08).toFixed(4)));
      return {
        candidate: entry.candidate,
        score,
        breakdown: entry.breakdown,
      };
    })
    .filter((e) => e.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // Deduplicate by contentHash and near-duplicate cosine > 0.95 (N.2.10)
  const selected: Array<{ candidate: T; score: number; breakdown: MemoryScoreBreakdown }> = [];
  const seenHashes = new Set<string>();
  for (const entry of reranked) {
    if (seenHashes.has(entry.candidate.contentHash)) continue;
    const isNearDup = selected.some(
      (prev) => cosineSimilarity(prev.candidate.embedding, entry.candidate.embedding) > 0.95,
    );
    if (isNearDup) continue;
    seenHashes.add(entry.candidate.contentHash);
    selected.push(entry);
    if (selected.length >= k) break;
  }

  return selected;
}

// ---------- In-Memory Memory Backend (FR-MEM-1..6, 8) ----------

export interface StoredMemoryRecord extends MemoryItem {
  deletedAt: string | null;
}

export class InMemoryMemoryBackend implements MemoryBackend {
  private readonly items = new Map<string, StoredMemoryRecord>();
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  readonly embedder: EmbeddingProvider;
  private onSubjectEraseSessionHook?: (orgId: string, subjectId: string) => number;

  constructor(
    opts: {
      clock?: Clock;
      idGen?: IdGen;
      embedder?: EmbeddingProvider;
    } = {},
  ) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
    this.embedder = opts.embedder ?? new DeterministicEmbeddingGenerator();
  }

  attachSessionEraseHook(fn: (orgId: string, subjectId: string) => number): void {
    this.onSubjectEraseSessionHook = fn;
  }

  private assertScopeAllowed(item: StoredMemoryRecord, q: MemoryQuery): boolean {
    if (q.scope && item.scope !== q.scope) return false;
    if (q.scopeId !== undefined && item.scopeId !== q.scopeId) return false;

    if (q.allowedScopes && q.allowedScopes.length > 0) {
      const matched = q.allowedScopes.some((rule) => {
        if (rule.scope !== item.scope) return false;
        if (
          (item.scope === 'user' ||
            item.scope === 'session' ||
            item.scope === 'run' ||
            item.scope === 'agent') &&
          rule.scopeId === undefined
        ) {
          return false;
        }
        return rule.scopeId === undefined || rule.scopeId === item.scopeId;
      });
      if (!matched) return false;
    }
    return true;
  }

  private assertSensitivityAllowed(
    sensitivity: SensitivityLevel,
    opts: { maxSensitivity?: SensitivityLevel; allowedSensitivities?: readonly SensitivityLevel[] },
  ): boolean {
    if (opts.allowedSensitivities && !opts.allowedSensitivities.includes(sensitivity)) {
      return false;
    }
    if (
      opts.maxSensitivity &&
      SENSITIVITY_RANK[sensitivity] > SENSITIVITY_RANK[opts.maxSensitivity]
    ) {
      return false;
    }
    return true;
  }

  private findContradiction(
    orgId: string,
    workspaceId: string,
    scope: MemoryScope,
    scopeId: string | null,
    contentHash: string,
    metadata: Record<string, unknown>,
  ): string | null {
    const entity = metadata['entity'];
    const attribute = metadata['attribute'];
    if (typeof entity !== 'string' || typeof attribute !== 'string') return null;

    for (const existing of this.items.values()) {
      if (existing.deletedAt !== null) continue;
      if (existing.orgId !== orgId || existing.workspaceId !== workspaceId) continue;
      if (existing.scope !== scope || existing.scopeId !== scopeId) continue;
      if (
        existing.metadata['entity'] === entity &&
        existing.metadata['attribute'] === attribute &&
        existing.contentHash !== contentHash
      ) {
        return existing.id;
      }
    }
    return null;
  }

  async put(ctx: TenantContext, input: NewMemoryItem): Promise<MemoryItem> {
    return withSpan('memory.put', { org_id: ctx.orgId, scope: input.scope }, async () => {
      const workspaceId = ctx.workspaceId;
      if (!workspaceId) {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Tenant context requires workspaceId.');
      }
      const trimmed = input.content.trim();
      if (!trimmed) {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Memory content cannot be empty.');
      }
      const nowIso = this.clock.now().toISOString();
      const id = input.id ?? `mem_${this.idGen.uuidv7(this.clock.now().getTime())}`;
      const scopeId = input.scopeId ?? null;
      const contentHash = sha256Hex(trimmed);
      const embedding = await this.embedder.embed(trimmed);
      const metadata = input.metadata ?? {};
      const contradictsId = this.findContradiction(
        ctx.orgId,
        workspaceId,
        input.scope,
        scopeId,
        contentHash,
        metadata,
      );

      const record: StoredMemoryRecord = {
        id,
        orgId: ctx.orgId,
        workspaceId,
        projectId: input.projectId ?? ctx.projectId ?? null,
        scope: input.scope,
        scopeId,
        subjectId:
          input.subjectId ?? (input.scope === 'user' ? scopeId : null),
        kind: input.kind,
        content: trimmed,
        contentHash,
        embeddingDim: this.embedder.dimension,
        embedding,
        metadata: structuredClone(metadata),
        sensitivity: input.sensitivity ?? 'internal',
        provenance: {
          sourcePrincipalId: ctx.principal.id,
          createdVia: 'system',
          ...input.provenance,
        },
        importance: Math.max(0, Math.min(1, input.importance ?? 0.5)),
        contradictsId,
        ttlAt: input.ttlAt ?? null,
        pinned: Boolean(input.pinned),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      this.items.set(record.id, record);
      return structuredClone(record);
    });
  }

  async get(ctx: TenantContext, id: string): Promise<MemoryItem | null> {
    const rec = this.items.get(id);
    if (!rec || rec.deletedAt !== null || rec.orgId !== ctx.orgId) return null;
    if (ctx.workspaceId && rec.workspaceId !== ctx.workspaceId) return null;
    return structuredClone(rec);
  }

  async update(
    ctx: TenantContext,
    id: string,
    patch: {
      content?: string;
      pinned?: boolean;
      importance?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryItem> {
    const rec = this.items.get(id);
    if (!rec || rec.deletedAt !== null || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Memory item ${id} not found.`);
    }
    const nextContent = patch.content !== undefined ? patch.content.trim() : rec.content;
    if (!nextContent) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Memory content cannot be empty.');
    }
    const reEmbed = patch.content !== undefined && nextContent !== rec.content;
    const nextEmbedding = reEmbed ? await this.embedder.embed(nextContent) : rec.embedding;
    const nextHash = reEmbed ? sha256Hex(nextContent) : rec.contentHash;
    const updated: StoredMemoryRecord = {
      ...rec,
      content: nextContent,
      contentHash: nextHash,
      embedding: nextEmbedding,
      pinned: patch.pinned ?? rec.pinned,
      importance:
        patch.importance !== undefined ? Math.max(0, Math.min(1, patch.importance)) : rec.importance,
      metadata: patch.metadata ? structuredClone(patch.metadata) : rec.metadata,
      updatedAt: this.clock.now().toISOString(),
    };
    this.items.set(id, updated);
    return structuredClone(updated);
  }

  async search(ctx: TenantContext, q: MemoryQuery): Promise<ScoredMemoryItem[]> {
    return withSpan('memory.search', { org_id: ctx.orgId, scope: q.scope }, async () => {
      const nowMs = q.nowMs ?? this.clock.now().getTime();
      const queryEmbedding = await this.embedder.embed(q.query);

      const candidates: Array<HybridCandidate & { record: StoredMemoryRecord }> = [];
      for (const rec of this.items.values()) {
        if (rec.deletedAt !== null) continue;
        if (rec.orgId !== ctx.orgId) continue;
        if (ctx.workspaceId && rec.workspaceId !== ctx.workspaceId) continue;
        if (rec.ttlAt && Date.parse(rec.ttlAt) <= nowMs) continue;
        if (!this.assertScopeAllowed(rec, q)) continue;
        if (!this.assertSensitivityAllowed(rec.sensitivity, q)) continue;
        if (q.kind && rec.kind !== q.kind) continue;
        if (q.subjectId && rec.subjectId !== q.subjectId) continue;
        if (q.metadataFilter) {
          let metaOk = true;
          for (const [k, v] of Object.entries(q.metadataFilter)) {
            if (rec.metadata[k] !== v) {
              metaOk = false;
              break;
            }
          }
          if (!metaOk) continue;
        }
        candidates.push({
          id: rec.id,
          content: rec.content,
          contentHash: rec.contentHash,
          embedding: rec.embedding,
          kind: rec.kind,
          createdAtMs: Date.parse(rec.createdAt),
          importance: rec.importance,
          record: rec,
        });
      }

      const ranked = rankHybridCandidates(candidates, q.query, queryEmbedding, {
        topK: q.topK ?? 5,
        minScore: q.minScore ?? 0,
        nowMs,
      });

      return ranked.map((r) => ({
        item: structuredClone(r.candidate.record),
        score: r.score,
        breakdown: r.breakdown,
      }));
    });
  }

  async delete(ctx: TenantContext, id: string, opts: { hard: boolean }): Promise<void> {
    const rec = this.items.get(id);
    if (!rec || rec.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Memory item ${id} not found.`);
    }
    if (opts.hard) {
      this.items.delete(id);
      return;
    }
    this.items.set(id, {
      ...rec,
      deletedAt: this.clock.now().toISOString(),
      updatedAt: this.clock.now().toISOString(),
    });
  }

  async list(
    ctx: TenantContext,
    filter: MemoryFilter,
    cursor?: string,
    limit = 50,
  ): Promise<MemoryPage> {
    const nowMs = this.clock.now().getTime();
    const qLower = filter.q?.trim().toLowerCase() ?? '';
    const filtered: MemoryItem[] = [];

    for (const rec of this.items.values()) {
      if (rec.deletedAt !== null) continue;
      if (rec.orgId !== ctx.orgId) continue;
      if (ctx.workspaceId && rec.workspaceId !== ctx.workspaceId) continue;
      if (rec.ttlAt && Date.parse(rec.ttlAt) <= nowMs) continue;
      if (filter.scope && rec.scope !== filter.scope) continue;
      if (filter.scopeId !== undefined && rec.scopeId !== filter.scopeId) continue;
      if (filter.kind && rec.kind !== filter.kind) continue;
      if (filter.subjectId && rec.subjectId !== filter.subjectId) continue;
      if (filter.sensitivity && rec.sensitivity !== filter.sensitivity) continue;
      if (!this.assertSensitivityAllowed(rec.sensitivity, { maxSensitivity: filter.maxSensitivity })) {
        continue;
      }
      if (qLower && !rec.content.toLowerCase().includes(qLower)) continue;
      filtered.push(structuredClone(rec));
    }

    filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const offset = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const slice = filtered.slice(offset, offset + limit);
    const nextCursor = offset + limit < filtered.length ? String(offset + limit) : null;
    return { items: slice, nextCursor };
  }

  async *export(ctx: TenantContext, filter: MemoryFilter): AsyncIterable<MemoryItem> {
    const page = await this.list(ctx, filter, undefined, 10_000);
    for (const item of page.items) {
      yield item;
    }
  }

  async eraseSubject(ctx: TenantContext, subjectId: string): Promise<ErasureReport> {
    return withSpan('memory.erase_subject', { org_id: ctx.orgId, subject_id: subjectId }, async () => {
      if (!subjectId.trim()) {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', 'subjectId is required for erasure.');
      }
      let deletedMemoryItems = 0;
      for (const [id, rec] of this.items.entries()) {
        if (rec.orgId !== ctx.orgId) continue;
        if (
          rec.subjectId === subjectId ||
          (rec.scope === 'user' && rec.scopeId === subjectId)
        ) {
          this.items.delete(id);
          deletedMemoryItems += 1;
        }
      }
      const deletedSessions = this.onSubjectEraseSessionHook
        ? this.onSubjectEraseSessionHook(ctx.orgId, subjectId)
        : 0;
      return {
        orgId: ctx.orgId,
        subjectId,
        deletedMemoryItems,
        deletedSessions,
        erasedAt: this.clock.now().toISOString(),
      };
    });
  }
}

// ---------- Session Memory with Identifier-Preserving Rolling Summary (E0.5-1) ----------

export interface ConversationMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly ts: string;
}

export interface ConversationSession {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly agentId: string | null;
  readonly subjectId: string | null;
  readonly title: string | null;
  readonly messages: ConversationMessage[];
  readonly rollingSummary: string;
  readonly preservedIdentifiers: string[];
  readonly tokenCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\b[A-Z]{1,8}-\d{2,12}\b/g,
  /\b(?:org|ws|prj|env|prn|agt|wf|run|stp|apr|mem|kb|doc|chk)_[A-Za-z0-9_-]{3,40}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\$[0-9,]+(?:\.[0-9]{1,2})?\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
];

export function extractPreservedIdentifiers(text: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const regex of IDENTIFIER_PATTERNS) {
    const matches = text.match(regex) ?? [];
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m);
        ordered.push(m);
      }
    }
  }
  return ordered;
}

export class ConversationSessionStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  private readonly defaultCompactThresholdTokens: number;
  private readonly defaultKeepRecentMessages: number;

  constructor(
    opts: {
      clock?: Clock;
      idGen?: IdGen;
      compactThresholdTokens?: number;
      keepRecentMessages?: number;
    } = {},
  ) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
    this.defaultCompactThresholdTokens = opts.compactThresholdTokens ?? 1200;
    this.defaultKeepRecentMessages = opts.keepRecentMessages ?? 4;
  }

  appendMessages(
    ctx: TenantContext,
    input: {
      sessionId?: string;
      agentId?: string | null;
      subjectId?: string | null;
      title?: string | null;
      messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
      compactThresholdTokens?: number;
      keepRecentMessages?: number;
    },
  ): ConversationSession {
    const workspaceId = ctx.workspaceId;
    if (!workspaceId) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Tenant context requires workspaceId.');
    }
    const nowIso = this.clock.now().toISOString();
    const id = input.sessionId ?? `ses_${this.idGen.uuidv7(this.clock.now().getTime())}`;
    const existing = this.sessions.get(id);
    if (existing && existing.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Session ${id} not found.`);
    }

    const appended: ConversationMessage[] = input.messages.map((m, i) => ({
      id: `msg_${this.idGen.uuidv7(this.clock.now().getTime() + i)}`,
      role: m.role,
      content: m.content,
      ts: nowIso,
    }));

    let messages = existing ? [...existing.messages, ...appended] : appended;
    let rollingSummary = existing?.rollingSummary ?? '';
    const identifierSet = new Set<string>(existing?.preservedIdentifiers ?? []);

    for (const msg of appended) {
      for (const ident of extractPreservedIdentifiers(msg.content)) {
        identifierSet.add(ident);
      }
    }

    const threshold = input.compactThresholdTokens ?? this.defaultCompactThresholdTokens;
    const keepRecent = Math.max(1, input.keepRecentMessages ?? this.defaultKeepRecentMessages);
    let totalTokens =
      estimateTokenCount(rollingSummary) +
      messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);

    if (totalTokens > threshold && messages.length > keepRecent) {
      const splitIndex = messages.length - keepRecent;
      const toCompact = messages.slice(0, splitIndex);
      messages = messages.slice(splitIndex);

      const turnSnippets = toCompact.map((m) => {
        const cleaned = m.content.replace(/\s+/g, ' ').trim();
        const clipped = cleaned.length > 160 ? `${cleaned.slice(0, 160)}...` : cleaned;
        return `- ${m.role}: ${clipped}`;
      });
      const preservedList = [...identifierSet];
      const baseSummaryLines = rollingSummary
        ? rollingSummary.replace(/\n?\[Preserved IDs:[^\]]*\]/g, '').trim()
        : '';
      const mergedBody = [baseSummaryLines, ...turnSnippets].filter(Boolean).join('\n');
      const cappedBody = mergedBody.length > 1800 ? mergedBody.slice(-1800) : mergedBody;
      rollingSummary =
        preservedList.length > 0
          ? `${cappedBody}\n[Preserved IDs: ${preservedList.join(', ')}]`
          : cappedBody;

      totalTokens =
        estimateTokenCount(rollingSummary) +
        messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
    }

    const session: ConversationSession = {
      id,
      orgId: ctx.orgId,
      workspaceId,
      projectId: existing?.projectId ?? ctx.projectId ?? null,
      agentId: input.agentId ?? existing?.agentId ?? null,
      subjectId: input.subjectId ?? existing?.subjectId ?? null,
      title: input.title ?? existing?.title ?? null,
      messages,
      rollingSummary,
      preservedIdentifiers: [...identifierSet],
      tokenCount: totalTokens,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    this.sessions.set(id, session);
    return structuredClone(session);
  }

  get(ctx: TenantContext, sessionId: string): ConversationSession | null {
    const ses = this.sessions.get(sessionId);
    if (!ses || ses.orgId !== ctx.orgId) return null;
    if (ctx.workspaceId && ses.workspaceId !== ctx.workspaceId) return null;
    return structuredClone(ses);
  }

  eraseBySubject(orgId: string, subjectId: string): number {
    let count = 0;
    for (const [id, ses] of this.sessions.entries()) {
      if (ses.orgId === orgId && ses.subjectId === subjectId) {
        this.sessions.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

// ---------- Structural Document Chunker N.2.11 (E0.5-3) ----------

export interface ChunkingOptions {
  readonly targetTokens?: number;
  readonly maxTokens?: number;
  readonly overlapTokens?: number;
}

export interface StructuralChunkDraft {
  readonly chunkIndex: number;
  readonly sectionPath: string[];
  readonly page: number | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly tokenCount: number;
  readonly content: string;
  readonly contentHash: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Converts HTML, DOCX XML, or raw PDF streams into clean structured Markdown/text
 * preserving headings, tables, and fenced code blocks prior to chunking.
 */
export function normalizeDocumentToStructuredText(
  rawContent: string,
  mimeType = 'text/markdown',
): string {
  if (mimeType === 'text/html') {
    let text = rawContent
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
      return `\n\n${'#'.repeat(Number(lvl))} ${decodeHtmlEntities(inner.replace(/<[^>]+>/g, '').trim())}\n\n`;
    });

    text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
      const code = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '').trim());
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
    });

    text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableHtml: string) => {
      const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      const mdRows: string[] = [];
      rows.forEach((rowMatch, rIdx) => {
        const cells = [...rowMatch[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
          decodeHtmlEntities(c[1]!.replace(/<[^>]+>/g, '').trim()),
        );
        if (cells.length === 0) return;
        mdRows.push(`| ${cells.join(' | ')} |`);
        if (rIdx === 0) {
          mdRows.push(`| ${cells.map(() => '---').join(' | ')} |`);
        }
      });
      return mdRows.length > 0 ? `\n\n${mdRows.join('\n')}\n\n` : '';
    });

    text = text
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/?(?:p|div|section|article|br|ul|ol)[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(text).replace(/\n{3,}/g, '\n\n').trim();
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const wTexts = [...rawContent.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) =>
      decodeHtmlEntities(m[1]!),
    );
    if (wTexts.length > 0) {
      return wTexts.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  return rawContent.replace(/\r\n/g, '\n').trim();
}

function summarizeMarkdownTable(tableText: string): string {
  const lines = tableText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  if (lines.length < 2) return '';
  const parseCells = (row: string) =>
    row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const headers = parseCells(lines[0]!);
  const dataLines = lines.slice(1).filter((l) => !/^\|[\s:|-]+\|$/.test(l));
  const rowSummaries = dataLines.slice(0, 12).map((row) => {
    const vals = parseCells(row);
    return headers.map((h, i) => `${h}=${vals[i] ?? ''}`).join(', ');
  });
  return `Table summary (${headers.join(' | ')}): ${rowSummaries.join('; ')}`;
}

interface AtomicBlock {
  readonly kind: 'heading' | 'code' | 'table' | 'paragraph';
  readonly headingLevel?: number;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
}

function splitIntoStructuralBlocks(text: string): AtomicBlock[] {
  const blocks: AtomicBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      offset += line.length + 1;
      i += 1;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const start = offset;
      const end = offset + line.length;
      blocks.push({
        kind: 'heading',
        headingLevel: headingMatch[1]!.length,
        text: headingMatch[2]!.trim(),
        charStart: start,
        charEnd: end,
      });
      offset += line.length + 1;
      i += 1;
      continue;
    }

    // Fenced code block kept whole (N.2.11)
    if (trimmed.startsWith('```')) {
      const start = offset;
      const collected: string[] = [line];
      offset += line.length + 1;
      i += 1;
      while (i < lines.length) {
        const codeLine = lines[i]!;
        collected.push(codeLine);
        offset += codeLine.length + 1;
        i += 1;
        if (codeLine.trim().startsWith('```')) break;
      }
      blocks.push({
        kind: 'code',
        text: collected.join('\n'),
        charStart: start,
        charEnd: Math.max(start, offset - 1),
      });
      continue;
    }

    // Markdown pipe table kept whole + flattened summary (N.2.11)
    if (trimmed.startsWith('|')) {
      const start = offset;
      const collected: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        collected.push(lines[i]!);
        offset += lines[i]!.length + 1;
        i += 1;
      }
      const rawTable = collected.join('\n');
      const summary = summarizeMarkdownTable(rawTable);
      blocks.push({
        kind: 'table',
        text: summary ? `${rawTable}\n\n${summary}` : rawTable,
        charStart: start,
        charEnd: Math.max(start, offset - 1),
      });
      continue;
    }

    // Paragraph block until blank line or next structural element
    const start = offset;
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pLine = lines[i]!;
      const pTrim = pLine.trim();
      if (!pTrim || /^(#{1,6})\s+/.test(pTrim) || pTrim.startsWith('```') || pTrim.startsWith('|')) {
        break;
      }
      paraLines.push(pLine);
      offset += pLine.length + 1;
      i += 1;
    }
    blocks.push({
      kind: 'paragraph',
      text: paraLines.join('\n'),
      charStart: start,
      charEnd: Math.max(start, offset - 1),
    });
  }

  return blocks;
}

/**
 * Chunks text structurally per PRD N.2.11 (target 400 tokens, max 800, overlap 60).
 */
export function chunkDocumentN211(
  rawContent: string,
  mimeType = 'text/markdown',
  opts: ChunkingOptions = {},
): StructuralChunkDraft[] {
  const targetTokens = Math.max(30, opts.targetTokens ?? 400);
  const maxTokens = Math.max(targetTokens, opts.maxTokens ?? 800);
  const overlapTokens = Math.max(0, opts.overlapTokens ?? 60);

  const normalized = normalizeDocumentToStructuredText(rawContent, mimeType);
  if (!normalized) return [];

  const blocks = splitIntoStructuralBlocks(normalized);
  const sectionStack: string[] = [];
  const drafts: StructuralChunkDraft[] = [];

  let currentPieces: string[] = [];
  let currentTokens = 0;
  let currentStart = 0;
  let currentEnd = 0;
  let currentSectionPath: string[] = [];

  const flushChunk = () => {
    if (currentPieces.length === 0) return;
    const prefix = currentSectionPath.length > 0 ? `[Section: ${currentSectionPath.join(' > ')}]\n` : '';
    const body = currentPieces.join('\n\n').trim();
    if (!body) return;
    const fullContent = `${prefix}${body}`;
    drafts.push({
      chunkIndex: drafts.length,
      sectionPath: [...currentSectionPath],
      page: null,
      charStart: currentStart,
      charEnd: currentEnd,
      tokenCount: estimateTokenCount(fullContent),
      content: fullContent,
      contentHash: sha256Hex(fullContent),
    });

    if (overlapTokens > 0) {
      const approxChars = overlapTokens * 4;
      const tail = body.slice(-approxChars).trim();
      if (tail && tail.length < body.length) {
        currentPieces = [tail];
        currentTokens = estimateTokenCount(tail);
        currentStart = Math.max(currentStart, currentEnd - tail.length);
        return;
      }
    }
    currentPieces = [];
    currentTokens = 0;
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      flushChunk();
      currentPieces = [];
      currentTokens = 0;
      const lvl = block.headingLevel ?? 1;
      sectionStack.length = Math.max(0, lvl - 1);
      sectionStack[lvl - 1] = block.text;
      currentSectionPath = sectionStack.filter(Boolean);
      currentStart = block.charStart;
      currentEnd = block.charEnd;
      continue;
    }

    const blockTokens = estimateTokenCount(block.text);
    const shouldSplitBefore =
      currentPieces.length > 0 &&
      (currentTokens >= targetTokens || currentTokens + blockTokens > maxTokens);
    if (shouldSplitBefore) {
      flushChunk();
      if (currentPieces.length === 0) {
        currentStart = block.charStart;
      }
    }

    if (currentPieces.length === 0) {
      currentStart = block.charStart;
      currentSectionPath = sectionStack.filter(Boolean);
    }

    currentPieces.push(block.text);
    currentTokens += blockTokens;
    currentEnd = block.charEnd;

    if (currentTokens >= maxTokens) {
      flushChunk();
      currentPieces = [];
      currentTokens = 0;
    }
  }

  flushChunk();
  return drafts;
}

// ---------- Knowledge Base Service & Retrieval Tool (E0.5-3, E0.5-4) ----------

export interface KnowledgeBase {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly embeddingModel: string;
  readonly embeddingDim: number;
  readonly chunkTargetTokens: number;
  readonly chunkMaxTokens: number;
  readonly chunkOverlapTokens: number;
  readonly sensitivity: SensitivityLevel;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KbSource {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly kbId: string;
  readonly name: string;
  readonly kind: 'file' | 'url' | 'manual';
  readonly uri: string | null;
  readonly mimeType: string;
  readonly syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  readonly accessPrincipals: string[];
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KbDocument {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly kbId: string;
  readonly sourceId: string;
  readonly externalKey: string;
  readonly title: string;
  readonly mimeType: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly chunkCount: number;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KbChunk {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly kbId: string;
  readonly sourceId: string;
  readonly docId: string;
  readonly chunkIndex: number;
  readonly sectionPath: string[];
  readonly page: number | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly tokenCount: number;
  readonly content: string;
  readonly contentHash: string;
  readonly embeddingDim: number;
  readonly embedding: readonly number[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  deletedAt: string | null;
}

export interface KbSyncReport {
  readonly kbId: string;
  readonly sourceId: string;
  readonly docId: string;
  readonly addedChunks: number;
  readonly unchangedChunks: number;
  readonly deletedChunks: number;
  readonly reEmbeddedChunks: number;
  readonly syncedAt: string;
}

export interface CitationChip {
  readonly citationId: string;
  readonly chunkId: string;
  readonly docId: string;
  readonly docTitle: string;
  readonly sectionPath: string[];
  readonly charRange: { readonly start: number; readonly end: number };
  readonly score: number;
  readonly snippet: string;
  readonly content: string;
}

export interface KbQueryResponse {
  readonly kbId: string;
  readonly query: string;
  readonly answer: string;
  readonly citations: CitationChip[];
  readonly results: Array<{
    readonly chunk: KbChunk;
    readonly docTitle: string;
    readonly score: number;
    readonly breakdown: MemoryScoreBreakdown;
  }>;
}

export type KbUrlFetcher = (
  url: string,
) => Promise<{ content: string; title?: string; mimeType?: string }>;

export type KbHostResolver = (hostname: string) => Promise<string[]>;

export const KB_SEARCH_TOOL_INPUT_SCHEMA = z.object({
  kb_id: z.string().min(1),
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(20).optional(),
});

export class KnowledgeBaseService {
  private readonly kbs = new Map<string, KnowledgeBase>();
  private readonly sources = new Map<string, KbSource>();
  private readonly docs = new Map<string, KbDocument>();
  private readonly chunks = new Map<string, KbChunk>();
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  readonly embedder: DeterministicEmbeddingGenerator;
  private readonly resolveHostFn?: KbHostResolver;
  private readonly fetchUrlFn?: KbUrlFetcher;

  constructor(
    opts: {
      clock?: Clock;
      idGen?: IdGen;
      embedder?: DeterministicEmbeddingGenerator;
      resolveHostFn?: KbHostResolver;
      fetchUrlFn?: KbUrlFetcher;
    } = {},
  ) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
    this.embedder = opts.embedder ?? new DeterministicEmbeddingGenerator();
    this.resolveHostFn = opts.resolveHostFn;
    this.fetchUrlFn = opts.fetchUrlFn;
  }

  createKnowledgeBase(
    ctx: TenantContext,
    input: {
      projectId?: string;
      name: string;
      description?: string;
      embeddingModel?: string;
      embeddingDim?: number;
      chunkTargetTokens?: number;
      chunkMaxTokens?: number;
      chunkOverlapTokens?: number;
      sensitivity?: SensitivityLevel;
    },
  ): KnowledgeBase {
    const workspaceId = ctx.workspaceId;
    if (!workspaceId) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Tenant context requires workspaceId.');
    }
    const projectId = input.projectId ?? ctx.projectId ?? 'prj_default';
    const dim = input.embeddingDim ?? this.embedder.dimension;
    if (dim < 64 || dim > 3072) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'embedding_dim must be between 64 and 3072.');
    }
    for (const existing of this.kbs.values()) {
      if (existing.orgId === ctx.orgId && existing.projectId === projectId && existing.name === input.name) {
        throw new PlatformError(
          'RES_CONFLICT',
          `Knowledge base "${input.name}" already exists in project.`,
        );
      }
    }
    const nowIso = this.clock.now().toISOString();
    const kb: KnowledgeBase = {
      id: `kb_${this.idGen.uuidv7(this.clock.now().getTime())}`,
      orgId: ctx.orgId,
      workspaceId,
      projectId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      embeddingModel: input.embeddingModel ?? this.embedder.model,
      embeddingDim: dim,
      chunkTargetTokens: input.chunkTargetTokens ?? 400,
      chunkMaxTokens: input.chunkMaxTokens ?? 800,
      chunkOverlapTokens: input.chunkOverlapTokens ?? 60,
      sensitivity: input.sensitivity ?? 'internal',
      createdBy: ctx.principal.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.kbs.set(kb.id, kb);
    return structuredClone(kb);
  }

  listKnowledgeBases(ctx: TenantContext): KnowledgeBase[] {
    const out: KnowledgeBase[] = [];
    for (const kb of this.kbs.values()) {
      if (kb.orgId !== ctx.orgId) continue;
      if (ctx.workspaceId && kb.workspaceId !== ctx.workspaceId) continue;
      out.push(structuredClone(kb));
    }
    return out;
  }

  getKnowledgeBaseDetails(
    ctx: TenantContext,
    kbId: string,
  ): {
    kb: KnowledgeBase;
    sources: KbSource[];
    documents: KbDocument[];
    chunks: KbChunk[];
  } {
    const kb = this.kbs.get(kbId);
    if (!kb || kb.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Knowledge base ${kbId} not found.`);
    }
    if (ctx.workspaceId && kb.workspaceId !== ctx.workspaceId) {
      throw new PlatformError('RES_NOT_FOUND', `Knowledge base ${kbId} not found.`);
    }
    const sources = [...this.sources.values()]
      .filter((s) => s.kbId === kbId && s.orgId === ctx.orgId)
      .map((s) => structuredClone(s));
    const documents = [...this.docs.values()]
      .filter((d) => d.kbId === kbId && d.orgId === ctx.orgId)
      .map((d) => structuredClone(d));
    const chunks = [...this.chunks.values()]
      .filter((c) => c.kbId === kbId && c.orgId === ctx.orgId && c.deletedAt === null)
      .map((c) => structuredClone(c));
    return { kb: structuredClone(kb), sources, documents, chunks };
  }

  /**
   * Ingests a document or SSRF-checked URL into the Knowledge Base, reusing embeddings for unchanged chunks (E0.5-3).
   */
  async ingestDocument(
    ctx: TenantContext,
    kbId: string,
    input: {
      sourceName?: string;
      kind?: 'file' | 'url' | 'manual';
      uri?: string;
      externalKey?: string;
      title: string;
      mimeType?: string;
      content?: string;
      accessPrincipals?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ source: KbSource; document: KbDocument; syncReport: KbSyncReport }> {
    return withSpan('kb.ingest_document', { org_id: ctx.orgId, kb_id: kbId }, async () => {
      const kb = this.kbs.get(kbId);
      if (!kb || kb.orgId !== ctx.orgId) {
        throw new PlatformError('RES_NOT_FOUND', `Knowledge base ${kbId} not found.`);
      }
      if (ctx.workspaceId && kb.workspaceId !== ctx.workspaceId) {
        throw new PlatformError('RES_NOT_FOUND', `Knowledge base ${kbId} not found.`);
      }

      let rawContent = input.content ?? '';
      let mimeType = input.mimeType ?? 'text/markdown';
      let title = input.title;

      if (input.kind === 'url' || input.uri) {
        const uri = input.uri;
        if (!uri) {
          throw new PlatformError('VAL_SCHEMA_MISMATCH', 'URL source requires uri.');
        }
        await assertSafeOutboundUrl(uri, this.resolveHostFn);
        if (!rawContent) {
          if (this.fetchUrlFn) {
            const fetched = await this.fetchUrlFn(uri);
            rawContent = fetched.content;
            title = fetched.title ?? title;
            mimeType = fetched.mimeType ?? mimeType;
          } else {
            const res = await fetch(uri, { redirect: 'manual' });
            rawContent = await res.text();
            mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'text/html';
          }
        }
      }

      if (!rawContent.trim()) {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Document content cannot be empty.');
      }

      const nowIso = this.clock.now().toISOString();
      const sourceName = input.sourceName ?? input.title;
      const kind = input.kind ?? (input.uri ? 'url' : 'file');

      let source = [...this.sources.values()].find(
        (s) => s.kbId === kbId && s.orgId === ctx.orgId && s.name === sourceName,
      );
      if (!source) {
        source = {
          id: `src_${this.idGen.uuidv7(this.clock.now().getTime())}`,
          orgId: ctx.orgId,
          workspaceId: kb.workspaceId,
          kbId,
          name: sourceName,
          kind,
          uri: input.uri ?? null,
          mimeType,
          syncStatus: 'syncing',
          accessPrincipals: input.accessPrincipals ?? [],
          lastSyncedAt: null,
          lastError: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      } else if (input.accessPrincipals) {
        source = {
          ...source,
          accessPrincipals: [...input.accessPrincipals],
          syncStatus: 'syncing',
          updatedAt: nowIso,
        };
      }
      this.sources.set(source.id, source);

      const externalKey = input.externalKey ?? `${source.name}:${title}`;
      const existingDoc = [...this.docs.values()].find(
        (d) => d.sourceId === source.id && d.externalKey === externalKey,
      );

      const drafts = chunkDocumentN211(rawContent, mimeType, {
        targetTokens: kb.chunkTargetTokens,
        maxTokens: kb.chunkMaxTokens,
        overlapTokens: kb.chunkOverlapTokens,
      });

      const docId =
        existingDoc?.id ?? `doc_${this.idGen.uuidv7(this.clock.now().getTime())}`;
      const existingActiveChunks = existingDoc
        ? [...this.chunks.values()].filter((c) => c.docId === docId && c.deletedAt === null)
        : [];
      const existingByHash = new Map<string, KbChunk>();
      for (const ch of existingActiveChunks) {
        if (!existingByHash.has(ch.contentHash)) {
          existingByHash.set(ch.contentHash, ch);
        }
      }

      const nextChunkIds = new Set<string>();
      const newHashSet = new Set(drafts.map((d) => d.contentHash));
      let addedChunks = 0;
      let unchangedChunks = 0;
      let reEmbeddedChunks = 0;

      for (const draft of drafts) {
        const reusable = existingByHash.get(draft.contentHash);
        if (reusable) {
          unchangedChunks += 1;
          nextChunkIds.add(reusable.id);
          const refreshed: KbChunk = {
            ...reusable,
            chunkIndex: draft.chunkIndex,
            sectionPath: draft.sectionPath,
            charStart: draft.charStart,
            charEnd: draft.charEnd,
            tokenCount: draft.tokenCount,
            metadata: structuredClone(input.metadata ?? {}),
          };
          this.chunks.set(refreshed.id, refreshed);
        } else {
          addedChunks += 1;
          reEmbeddedChunks += 1;
          const embedding = await this.embedder.embed(draft.content);
          const chunkId = `chk_${this.idGen.uuidv7(this.clock.now().getTime() + draft.chunkIndex)}`;
          const chunk: KbChunk = {
            id: chunkId,
            orgId: ctx.orgId,
            workspaceId: kb.workspaceId,
            kbId,
            sourceId: source.id,
            docId,
            chunkIndex: draft.chunkIndex,
            sectionPath: draft.sectionPath,
            page: draft.page,
            charStart: draft.charStart,
            charEnd: draft.charEnd,
            tokenCount: draft.tokenCount,
            content: draft.content,
            contentHash: draft.contentHash,
            embeddingDim: this.embedder.dimension,
            embedding,
            metadata: structuredClone(input.metadata ?? {}),
            createdAt: nowIso,
            deletedAt: null,
          };
          this.chunks.set(chunk.id, chunk);
          nextChunkIds.add(chunk.id);
        }
      }

      let deletedChunks = 0;
      for (const oldChunk of existingActiveChunks) {
        if (!nextChunkIds.has(oldChunk.id) && !newHashSet.has(oldChunk.contentHash)) {
          deletedChunks += 1;
          this.chunks.set(oldChunk.id, { ...oldChunk, deletedAt: nowIso });
        } else if (!nextChunkIds.has(oldChunk.id)) {
          this.chunks.set(oldChunk.id, { ...oldChunk, deletedAt: nowIso });
        }
      }

      const docHash = sha256Hex(
        canonicalJson({ title, mimeType, rawContent }),
      );
      const doc: KbDocument = {
        id: docId,
        orgId: ctx.orgId,
        workspaceId: kb.workspaceId,
        kbId,
        sourceId: source.id,
        externalKey,
        title,
        mimeType,
        contentHash: docHash,
        byteSize: Buffer.byteLength(rawContent, 'utf8'),
        chunkCount: drafts.length,
        metadata: structuredClone(input.metadata ?? {}),
        createdAt: existingDoc?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      this.docs.set(doc.id, doc);

      const finalizedSource: KbSource = {
        ...source,
        syncStatus: 'synced',
        lastSyncedAt: nowIso,
        lastError: null,
        updatedAt: nowIso,
      };
      this.sources.set(finalizedSource.id, finalizedSource);

      return {
        source: structuredClone(finalizedSource),
        document: structuredClone(doc),
        syncReport: {
          kbId,
          sourceId: finalizedSource.id,
          docId: doc.id,
          addedChunks,
          unchangedChunks,
          deletedChunks,
          reEmbeddedChunks,
          syncedAt: nowIso,
        },
      };
    });
  }

  async syncDocumentContent(
    ctx: TenantContext,
    kbId: string,
    docId: string,
    nextContent: string,
    nextTitle?: string,
  ): Promise<KbSyncReport> {
    const doc = this.docs.get(docId);
    if (!doc || doc.kbId !== kbId || doc.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Document ${docId} not found in KB ${kbId}.`);
    }
    const source = this.sources.get(doc.sourceId);
    const res = await this.ingestDocument(ctx, kbId, {
      sourceName: source?.name ?? doc.title,
      kind: source?.kind ?? 'manual',
      uri: source?.uri ?? undefined,
      externalKey: doc.externalKey,
      title: nextTitle ?? doc.title,
      mimeType: doc.mimeType,
      content: nextContent,
      accessPrincipals: source?.accessPrincipals,
      metadata: doc.metadata,
    });
    return res.syncReport;
  }

  async queryKnowledgeBase(
    ctx: TenantContext,
    input: {
      kbId: string;
      query: string;
      topK?: number;
      minScore?: number;
      principalAccessIds?: string[];
    },
  ): Promise<KbQueryResponse> {
    return withSpan('kb.query', { org_id: ctx.orgId, kb_id: input.kbId }, async () => {
      const kb = this.kbs.get(input.kbId);
      if (!kb || kb.orgId !== ctx.orgId) {
        throw new PlatformError('RES_NOT_FOUND', `Knowledge base ${input.kbId} not found.`);
      }
      if (ctx.workspaceId && kb.workspaceId !== ctx.workspaceId) {
        throw new PlatformError('RES_NOT_FOUND', `Knowledge base ${input.kbId} not found.`);
      }

      const queryVec = await this.embedder.embed(input.query);
      const principalIds = new Set([ctx.principal.id, ...(input.principalAccessIds ?? [])]);
      const candidates: Array<HybridCandidate & { chunk: KbChunk; docTitle: string }> = [];

      for (const ch of this.chunks.values()) {
        if (ch.deletedAt !== null) continue;
        if (ch.kbId !== input.kbId || ch.orgId !== ctx.orgId) continue;
        const src = this.sources.get(ch.sourceId);
        if (src && src.accessPrincipals.length > 0) {
          const allowed = src.accessPrincipals.some((p) => principalIds.has(p));
          if (!allowed) continue;
        }
        const doc = this.docs.get(ch.docId);
        candidates.push({
          id: ch.id,
          content: ch.content,
          contentHash: ch.contentHash,
          embedding: ch.embedding,
          kind: 'kb_chunk',
          createdAtMs: Date.parse(ch.createdAt),
          importance: 0.7,
          chunk: ch,
          docTitle: doc?.title ?? 'Untitled',
        });
      }

      const ranked = rankHybridCandidates(candidates, input.query, queryVec, {
        topK: input.topK ?? 5,
        minScore: input.minScore ?? 0,
        nowMs: this.clock.now().getTime(),
      });

      const citations: CitationChip[] = ranked.map((r, idx) => {
        const ch = r.candidate.chunk;
        const cleanBody = ch.content.replace(/^\[Section:[^\]]+\]\n?/, '').trim();
        const snippet =
          cleanBody.length > 180 ? `${cleanBody.slice(0, 180)}...` : cleanBody;
        return {
          citationId: `cit_${idx + 1}`,
          chunkId: ch.id,
          docId: ch.docId,
          docTitle: r.candidate.docTitle,
          sectionPath: [...ch.sectionPath],
          charRange: { start: ch.charStart, end: ch.charEnd },
          score: r.score,
          snippet,
          content: ch.content,
        };
      });

      const answer =
        citations.length === 0
          ? `No matching passages were found in "${kb.name}" for query "${input.query}".`
          : citations
              .map(
                (cit) =>
                  `${cit.snippet} [cit:${cit.chunkId}]`,
              )
              .join(' ');

      return {
        kbId: kb.id,
        query: input.query,
        answer,
        citations,
        results: ranked.map((r) => ({
          chunk: structuredClone(r.candidate.chunk),
          docTitle: r.candidate.docTitle,
          score: r.score,
          breakdown: r.breakdown,
        })),
      };
    });
  }
}

export function createKbSearchTool(kbService: KnowledgeBaseService): {
  contract: ToolContract;
  executor: CustomToolExecutor;
} {
  const contract: ToolContract = {
    name: 'kb_search',
    version: '1.0.0',
    description:
      'Retrieve cited Knowledge Base passages using N.2.10 hybrid vector + BM25 search.',
    input_schema: {
      type: 'object',
      required: ['kb_id', 'query'],
      properties: {
        kb_id: { type: 'string' },
        query: { type: 'string' },
        top_k: { type: 'integer' },
      },
    },
    output_schema: {
      type: 'object',
      properties: {
        kb_id: { type: 'string' },
        answer: { type: 'string' },
        citations: { type: 'array' },
      },
    },
    side_effect_class: 'read',
    idempotent: true,
    required_permissions: ['kb:read'],
    data_classification_touched: ['internal'],
    timeout_ms: 10_000,
    retry_policy: { max_attempts: 2, backoff_ms: 250 },
    cost_model: { per_call_micro_usd: 0 },
    examples: [
      {
        input: { kb_id: 'kb_demo', query: 'What is the refund SLA?', top_k: 5 },
        output: { kb_id: 'kb_demo', answer: 'Refunds complete within 5 business days [cit:chk_1]', citations: [] },
      },
    ],
    implementation: 'builtin',
  };

  const executor: CustomToolExecutor = async (args, ctx) => {
    const parsed = KB_SEARCH_TOOL_INPUT_SCHEMA.safeParse(args);
    if (!parsed.success) {
      throw new PlatformError('TOOL_ARGS_INVALID', 'Invalid kb_search arguments', {
        issues: parsed.error.issues,
      });
    }
    const res = await kbService.queryKnowledgeBase(ctx, {
      kbId: parsed.data.kb_id,
      query: parsed.data.query,
      topK: parsed.data.top_k,
    });
    return {
      kb_id: res.kbId,
      answer: res.answer,
      citations: res.citations,
    };
  };

  return { contract, executor };
}
