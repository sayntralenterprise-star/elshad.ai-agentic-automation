# Elshad Agentic Automation Platform — Quickstart & Concepts (`E0.6-6`)

## 1. Quickstart (Local Workspace)

### Prerequisites
- Node.js 22+ and `pnpm` (`12.14.0+`)
- Optional for containerized stack: Docker + Docker Compose v2

### Install, Build & Verify

```bash
pnpm install
pnpm openapi:generate
pnpm build
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm test
```

### Validate Compose Topology

```bash
docker compose -f deploy/docker-compose/compose.yaml --profile observability --profile local-models config --quiet
```

## 2. Core Platform Concepts

- **Tenancy & Environments (`O.1`, `DOC-Q-015`):** Organizations (`org_...`) isolate tenant data via PostgreSQL `FORCE ROW LEVEL SECURITY` (`enable_tenant_rls`), subdivided into Workspaces, Projects, and explicit Environments (`dev` | `staging` | `prod`).
- **Durable Execution (`@elshad/execution`):** Every agent and workflow run persists immutable `run_events`, `run_steps`, `checkpoints`, `work_items`, `timers`, and a 7-day `effect_ledger` keyed by `sha256(run_id:step_seq:attempt_group)`.
- **Agents & Model Gateway (`@elshad/runtime-core`, `@elshad/model-kit`, `@elshad/tool-kit`):** ReAct loop with autonomy levels `L0–L3`, Lethal Trifecta warnings, SSRF-guarded outbound HTTP, isolated Python sandbox, structured JSON repair, and micro-USD cost reconciliation (`SUM(usage_ledger) === run.cost_micro_usd`).
- **Workflow Engine (`@elshad/workflow-core`):** 17 node handlers, strict DAG + loop-only cycle validator, sandboxed 3-mode JSONata evaluator (`50 ms` / `1 MB` cap, `$secret` blocked), HMAC/token/JWT webhook triggers with 5-minute skew + replay protection, and lossless YAML round-trip.
- **Memory & Knowledge/RAG (`@elshad/memory-kit`):** Scoped `memory_items` (`run`..`org`) with `pgvector` HNSW partial expression indexes ([ADR-0009](../adr/0009-pgvector-hnsw-and-dimension-strategy.md)), identifier-preserving session rolling summaries, `N.2.11` structural chunking with incremental hash-diff re-sync, `N.2.10` hybrid retrieval, right-to-erasure, and cited answers (`[cit:<chunk_id>]`).
- **Hardening Controls (`S0.6`):** Envelope-encrypted secrets (`secret://db/...` / `secret://vault/...`), hierarchical budgets (`agent -> project -> workspace -> org`), emergency kill switches, hash-chained audit verification (`GET /api/v1/audit/verify`), and DR backup/restore scripts.

## 3. Key Reference Docs

- [Delivery Plan](../plan/05-delivery-plan.md)
- [OpenAPI 3.1 Specification](../api/openapi.json)
- [Backup & DR Drill Runbook](../runbooks/backup-and-dr-drill.md)
- [Day-2 Operations Runbook](../runbooks/day2-operations.md)
