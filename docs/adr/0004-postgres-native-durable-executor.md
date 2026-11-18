# 0004 — Postgres-Native Durable Executor behind `ExecutionEngine`

- Status: Accepted
- Date: 2026-11-18
- Requirement / decision refs: D4, FR-ORC-1..11, NFR-6, NFR-16, DOC-Q-002, DOC-Q-005, DOC-Q-014, DOC-Q-017, DOC-Q-018

## Context

The platform executes both autonomous agent turns and deterministic workflow graphs that can run for seconds or pause for days awaiting human approvals, external events, timers, or child runs (`FR-ORC-1..11`). Runs must survive worker crashes, node replacements, and platform upgrades with zero lost runs and zero duplicate external side effects (`NFR-6`, `NFR-16`).

PRD Part I §3.3 left open choosing between Temporal and a Postgres-native executor. PRD Appendix L.1 (`D4`) locks a Postgres-native executor behind an `ExecutionEngine` interface for v1 so single-node Docker Compose and self-hosted Kubernetes deployments operate with minimal stateful infrastructure.

## Decision

Implement a Postgres-native, event-sourced durable execution core in `packages/execution` behind the `ExecutionEngine` interface (`docs/architecture/04-core-interfaces-and-data.md §4`), shared by `apps/engine` and `apps/worker`:

1. **Event-sourced state and checkpoints (`FR-ORC-1`, `FR-ORC-2`):**
   - Persist run lifecycle and history across `runs`, `run_events` (append-only, monthly partitioned), `run_steps` (monthly partitioned), `checkpoints`, `work_items`, `timers`, and `outbox`.
   - Workers are stateless. After each turn/step, `commitTurn` atomically writes `run_steps`, `checkpoints`, `run_events`, `usage_ledger`, and `outbox` rows in a single PostgreSQL transaction.
   - Checkpoints keep the latest 5 snapshots plus milestones; payloads and state blobs larger than 64 KB are written to S3/MinIO object storage and referenced by `*_ref` columns.

2. **Lease-based claiming and fair scheduling (`FR-ORC-3`, `FR-ORC-5`, `FR-ORC-6`):**
   - Workers claim `work_items` via `SELECT ... FOR UPDATE SKIP LOCKED` with `serialize_key` mutual exclusion (`work_items_serialize_uidx`), weighted-fair queuing across workspaces (periodic materialized virtual-time pick-list refreshed every 500 ms per PRD `N.2.1`), priority ordering, and `Retry-After` backoff (`N.2.7`).
   - Default lease duration is 60 s with a 15 s heartbeat; if lease extension fails, the worker aborts execution immediately.
   - `LeaseSweeper` in `apps/engine` requeues expired leases so another worker resumes from the last checkpoint.

3. **Partitioned sequence allocation (`DOC-Q-017`, `DOC-Q-018`):**
   - Because `run_events` (`(run_id, seq, created_at)`) and `run_steps` (`(run_id, seq, attempt, created_at)`) are range-partitioned by `created_at`, PostgreSQL cannot enforce per-run `seq` uniqueness across partitions via a single global index.
   - Allocate `run_events.seq` under a row lock on the parent `runs` row (`runs.last_event_seq`, `UPDATE ... RETURNING`) inside `commitTurn`; `run_steps` uniqueness is guarded by lease ownership and the same run row lock.

4. **Durable waits, timers, DLQ, and upgrades (`FR-ORC-4`, `FR-ORC-7..10`, `DOC-Q-014`):**
   - `suspend` transitions runs to `waiting_approval | waiting_input | waiting_timer | waiting_child` and releases the lease; wall-time limits count only time spent in `running`.
   - `TimerService` (leader-elected via PostgreSQL advisory lock in `apps/engine`) fires due rows in `timers`.
   - Runs exhausting retries transition to DLQ (`work_items` `dead` status) with failure class, inputs, and last state for inspection and redrive (`FR-ORC-7`).
   - `runs.engine_version` tracks the starting engine schema version; workers support `N-1` checkpoint formats for zero-downtime upgrades (`NFR-16`).

5. **Idempotency and transactional outbox (`FR-ORC-11`, `DOC-Q-002`, `DOC-Q-005`):**
   - Exactly-once *effect* semantics are achieved via at-least-once execution paired with the 7-day `effect_ledger` in `packages/tool-kit`, keyed by `sha256(run_id + ":" + step_seq + ":" + attempt_group)` where `attempt_group` increments only on intentional redo.
   - `OutboxRelay` in `apps/engine` publishes committed `outbox` rows as CloudEvents 1.0 to NATS JetStream (`D5`), while PostgreSQL remains the authoritative work store.

## Consequences

- **Positive:**
  - Eliminates external workflow-engine cluster operations in Compose and self-hosted Kubernetes.
  - Allows atomic single-transaction commits across run state, billing (`usage_ledger`), audit/outbox events, and checkpoints.
  - Gives full control over weighted-fair workspace queuing, per-key serialization, and deterministic replay (`mode=recorded | live`, `N.2.9`).
- **Negative / Risks:**
  - PostgreSQL write throughput and row/index contention on `work_items`, `run_events`, and `run_steps` must be actively managed via batching, partial indexes, and partition maintenance.
  - Requires rigorous contract and chaos testing (`E0.2-2`, `E0.2-3`: 1,000 items × 10 workers with random kills; timer firing across restarts) to validate zero lost runs and zero duplicate effects.

## Alternatives considered

- **Temporal:** Provides battle-tested durable execution, timers, and replay, but introduces heavy operational dependencies (Temporal server + persistence/visibility stores) for self-hosted v1 and separates queue/history state from PostgreSQL ACID transactions with `usage_ledger`, `outbox`, and RLS. Remains viable later via a Temporal implementation of `ExecutionEngine`.
- **NATS JetStream or Redis Streams as primary work queue:** Risk of queue loss or state divergence from PostgreSQL commits; rejected in favor of PostgreSQL `work_items` as source of truth with NATS limited to post-commit event fan-out (`D5`, `C.5`).

## Exit criteria to revisit

Revisit this decision and evaluate implementing a Temporal adapter behind `ExecutionEngine` if:
- Lease or `work_items` contention exceeds **20% CPU** on the reference database node (8 vCPU, 32 GB RAM, NVMe SSD) under reference workload, **or**
- Multi-region active-active run execution becomes a requirement (`L.1 D4`).
