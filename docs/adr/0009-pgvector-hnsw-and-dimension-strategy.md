# 0009 — pgvector HNSW Indexing and Variable Embedding Dimension Strategy

- Status: Accepted
- Date: 2026-11-18
- Requirement / decision refs: D9, FR-MEM-3, FR-MEM-7, DOC-Q-008, N.2.10

## Context

PRD §5.4 (`FR-MEM-3`, `FR-MEM-7`) and Appendix O.3 specify `pgvector` HNSW indexes on `memory_items` (`M.6`) and Knowledge Base chunks (`kb_chunks`), while allowing Knowledge Bases to configure embedding models with dimensions from `384` up to `3072`. However, `pgvector` HNSW indexes over standard `vector` columns enforce a hard ceiling of **2,000 dimensions** (`DOC-Q-008`), so fixing a single `vector(1536)` column rejects smaller or `3072`-dim models (`text-embedding-3-large`), whereas an untyped `vector` column cannot directly carry a plain HNSW index.

## Decision

Adopt the `DOC-Q-008` partial expression indexing strategy across `memory_items` and `kb_chunks`:

1. **Untyped vector column + explicit dimension tag:**
   - Store `embedding_dim int NOT NULL DEFAULT 1536` alongside `embedding vector` (untyped at the column level).
   - Store normalized float arrays for `1536` (default v1 dimension) and alternate dimensions (`64..3072`) in application/embedding services, rejecting mismatched dimensions within a single Knowledge Base at write time.

2. **Partial expression HNSW indexes (`<= 2,000` dims):**
   - Create per-dimension partial expression HNSW indexes using `USING hnsw ((embedding::vector(1536)) vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE embedding_dim = 1536 AND deleted_at IS NULL`.
   - Additional dimensions `<= 2000` (e.g. `384`, `768`, `1024`) can be added safely via non-blocking `CREATE INDEX CONCURRENTLY` partial expression indexes without altering table structure.

3. **`halfvec` expression index for `> 2,000` dims (`up to 3072`):**
   - For high-dimension models such as `3072`-dim embeddings, index via `pgvector`'s `halfvec` cast (`(embedding::halfvec(3072)) halfvec_cosine_ops WHERE embedding_dim = 3072 AND deleted_at IS NULL`), which supports up to 4,000 dimensions in HNSW while staying inside PostgreSQL.

4. **Pre-filter before ranking (`N.2.10`):**
   - All tenant (`org_id` RLS FORCE), workspace/scope/sensitivity, TTL, and `kb_id` filters constrain candidates *before* hybrid scoring (`0.55*cosine + 0.20*bm25_norm + 0.15*recency_decay + 0.10*importance`) and deduplication.

## Consequences

- **Positive:**
  - Single Postgres schema handles `1536`-dim defaults cleanly while supporting configurable Knowledge Base embedding dimensions without migrations per KB.
  - Partial predicates (`deleted_at IS NULL`) exclude soft-deleted and erased items from HNSW index scans immediately.
- **Negative / Risks:**
  - Queries must include `AND embedding_dim = $dim` (or cast matching the partial index expression) for PostgreSQL's planner to pick the HNSW index instead of sequential scan.

## Alternatives considered

- **Dedicated Qdrant/Pinecone vector DB in Compose (`A.9`):** Rejected per `D9` because operating a separate vector store duplicates tenancy/RLS isolation, backups, and transactional guarantees (e.g., atomic right-to-erasure).
- **Separate tables per dimension:** Unnecessary schema sprawl when partial expression indexes solve the exact index constraint inside `memory_items` and `kb_chunks`.

## Exit criteria to revisit

- Revisit only if vector cardinality exceeds single-node Postgres HNSW memory budgets in Phase 2 or if `pgvector` raises the native `vector` HNSW dimension ceiling past `3072`.
