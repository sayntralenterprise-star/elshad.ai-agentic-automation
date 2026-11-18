# 0010 — Postgres Partitioned Traces with Object Storage Payload Offload

- Status: Accepted
- Date: 2026-11-18
- Requirement / decision refs: D10, D25, FR-OBS-1..4, NFR-2, NFR-11, DOC-Q-017, DOC-Q-018

## Context

Every run must produce a complete, hierarchical, queryable trace (`runs`, `run_steps`, nested LLM/tool/retrieval/guardrail/approval spans, `run_events`, `usage_ledger`, `policy_decisions`) filterable by status, agent, version, user, trigger, cost range, duration, failure class, tool used, labels, and permitted free-text (`FR-OBS-1`, `FR-OBS-4`). Traces must also export via OpenTelemetry GenAI semantic conventions (`FR-OBS-2`), respect per-project payload capture controls (`full | redacted | metadata_only`, `FR-OBS-3`), achieve 100% completeness with < 5 s P95 ingest lag without blocking active runs (`NFR-11`), and honor default retention (`D25`: 30 days traces, 14 days payload bodies, 400 days run summaries, 7 years audit).

PRD Appendix K/A.9 deferred choosing between PostgreSQL partitions and ClickHouse for trace storage; PRD Appendix L.1 (`D10`) locks PostgreSQL partitions plus object storage for v1, with a ClickHouse adapter deferred to Phase 2.

## Decision

Store native trace records in **monthly range-partitioned PostgreSQL tables** paired with **S3-compatible object storage** (MinIO in Compose, S3 in Kubernetes) for large payload bodies (`L.1 D10`, `A.3`, `M.6`):

1. **Monthly range partitioning:**
   - Partition `runs`, `run_events`, `run_steps`, `usage_ledger`, and `policy_decisions` by month on `created_at` (and `audit_events` on `ts`).
   - `PartitionManager` (`A.8`) pre-creates the current month plus the next 3 months at migration time and via scheduled background job (`E0.2-1`), and drops expired partitions per `D25` retention (avoiding `DELETE`/vacuum bloat).

2. **Object storage offload and payload controls (`FR-OBS-3`, `NFR-2`):**
   - Payloads exceeding **64 KB** (`N.2.5`, `01-architecture §11`) are offloaded to object storage (`blob://<bucket>/<org>/<key>`) and referenced via `input_ref`, `output_ref`, and `state_ref`; PostgreSQL stores only structured summary metadata, token counts, micro-USD costs, timings, and `*_ref` pointers.
   - Apply project-level `payload_capture` (`redacted` default, `full`, or `metadata_only`) before persistence; warm/cold payload lifecycle jobs purge expired payload blobs at 14 days (`D25`) while retaining run summaries.

3. **Partitioned table constraints (`04-core-interfaces §11.3`, `DOC-Q-017`, `DOC-Q-018`):**
   - Composite primary keys include the partition key: `(id, created_at)` on `runs` and `run_steps`, `(run_id, seq, created_at)` on `run_events`.
   - Because PostgreSQL does not support single-column foreign keys targeting partitioned tables, referential integrity to `runs` is enforced in the application/repository layer (or via composite `(id, created_at)` FKs where needed), and `run_events.seq` is allocated under a `runs` row lock.
   - Indexing uses partition-aligned composite B-tree indexes (`(workspace_id, status, created_at DESC)`, `(subject_version_id, created_at DESC)`), GIN on `labels`, and `pg_trgm` where free-text filtering is enabled.

4. **Non-blocking OTel export and ingestion (`FR-OBS-2`, `NFR-11`):**
   - `packages/telemetry` emits OTel GenAI spans for external collectors (Prometheus/Grafana/Datadog/Honeycomb/OTLP).
   - Trace-ingest buffering in `apps/engine` ensures external OTel export failures never block or fail a running workflow or agent.

## Consequences

- **Positive:**
  - Single datastore for transactional state and native UI trace queries in v1 (`L.1 D10`), keeping Compose and self-hosted deployments simple.
  - Fast, O(1)-style partition drops for retention enforcement without autovacuum degradation.
  - Bounded Postgres row and table sizes by keeping large prompts/tool outputs in object storage.
- **Negative / Risks:**
  - Queries that omit `created_at` bounds cannot prune partitions and will scan all active partitions; repository APIs and console filters must default to bounded time windows.
  - Missing future partitions will cause hard `INSERT` errors if `PartitionManager` fails; monitoring and migration-time pre-creation (+3 months) are mandatory.
  - High-volume analytical aggregations across long time windows will eventually compete with OLTP run execution for PostgreSQL IOPS.

## Alternatives considered

- **ClickHouse from v1 (`A.9`, `C.3`, `L.1 D10`):** Excels at high-volume columnar trace ingestion and multi-month analytics, but adds a second heavy stateful database cluster to Compose and initial Helm installs. Deferred to a Phase 2 adapter (`06-open-questions §D`).
- **Unpartitioned PostgreSQL tables:** Causes severe table bloat, index degradation, and I/O spikes under time-based `DELETE` retention at reference scale (500k+ runs/day).
- **External OTel-only trace backend (e.g., Jaeger/Tempo):** Lacks native relational joins with approvals, RBAC, workspace budgets, and replay checkpoints required by the console and audit workflows.

## Exit criteria to revisit

Revisit and introduce a Phase 2 ClickHouse trace storage/query adapter when trace volume exceeds **2 million steps/day per node** (`L.1 D10`) or when trace/analytics queries measurably degrade OLTP run-step P95 overhead (< 500 ms target, `NFR-2`).
