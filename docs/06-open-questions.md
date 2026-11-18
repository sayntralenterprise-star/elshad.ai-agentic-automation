# 06 — Open Questions, Contradictions, and Resolutions (DOC-Q log)

Per PRD Appendix T, unanswered or contradictory points are logged as `DOC-Q-nnn`. Each has a **resolution the developer should apply now** unless marked **⚠ USER DECISION**. Resolutions here take precedence over the PRD (see [00-START-HERE.md §3](00-START-HERE.md)).

## A. Stakeholder Decisions (locked to defaults on 2026-11-18)

| ID | Decision | Locked value | Scope |
|---|---|---|---|
| U-1 | Tooling fill-ins in [03-tech-stack §2](architecture/03-tech-stack-and-conventions.md) (pnpm + Turborepo, Fastify, Kysely, node-pg-migrate, zod-to-openapi, openapi-fetch, pino, Vitest/Testcontainers/Playwright) | **Locked: Accepted** | S0.1 |
| U-2 | Git repository hosting and CI | **Locked:** GitHub (`sayntralenterprise-star/elshad.ai-agentic-automation`, `https://github.com/sayntralenterprise-star/elshad.ai-agentic-automation.git`) + GitHub Actions | S0.1 (E0.1-1) |
| U-3 | Initial two model providers (E0.3-1) | **Locked:** OpenAI-compatible (covers OpenAI, Ollama, vLLM) + Anthropic | S0.3 |
| U-4 | Development capacity vs PRD 16-week plan (D20) | **Locked:** Sequential slices, same order; schedule is indicative only | Planning |
| U-5 | Pilot helpdesk & ERP systems (S.1, S.2) | **Locked:** Zendesk (helpdesk); ERP mocked via HTTP connector until target ERP is specified | S1.6 / S1.9 |
| U-6 | Edition gating for OIDC login (D2) | **Locked:** OIDC available in all editions in v1 (internal platform, D1); `edition` flag + `/capabilities` built in S0.1 | S0.1 |

## B. Contradictions inside the PRD — resolved

| ID | Conflict | Resolution |
|---|---|---|
| DOC-Q-001 | `agents.project_id` exists but M.6 DDL has **no `projects` table** | Create `projects (id, org_id, workspace_id, slug, name, settings, max_autonomy_level, timestamps, deleted_at, UNIQUE(workspace_id, slug))` in S0.1 |
| DOC-Q-002 | A.4 mandates a **transactional outbox**, no table defined | Create `outbox (id uuid pk, org_id, type, subject, payload jsonb, created_at, published_at null, attempts)` + partial index on unpublished; relay in engine |
| DOC-Q-003 | `SYS_CONFLICT` (A.4, B.1) vs `RES_CONFLICT` (O.2) | Use **`RES_CONFLICT`** (O.2 is the complete catalogue). Do not emit `SYS_CONFLICT` |
| DOC-Q-004 | SSE event names in B.3 (`step.started`, `token.delta`) vs O.5 (`run.step.started`, `run.token.delta`) vs L.4 rule `domain.entity.verb` | Use **O.5 names exactly** for SSE, NATS, webhooks |
| DOC-Q-005 | Idempotency key: FR-RT-14 `(run_id, step_id, attempt)`; M.3 example `run:stp:1`; N.2.8 `sha256(run_id:step_seq:attempt_group)` where attempt_group changes **only** on intentional redo | Use **N.2.8**. Including the retry `attempt` would make retries re-execute effects and violate NFR-6 |
| DOC-Q-006 | Money: D22 integer micro-USD, but B.3 uses `max_cost_usd: 0.50`, `cost_usd: 0.031` | Platform cost/limit/budget fields are **`*_micro_usd` integers** in API, DB, events. UI formats as USD. Business amounts inside tool args/approval payloads (e.g. refund amount) remain domain data as given |
| DOC-Q-007 | Approval decisions: B.2 "approve, reject, edit, request_info" vs B.3/M.4 `approve_with_edit` | Use **M.4**: `approve`, `reject`, `approve_with_edit`, `request_info`; delegate is a separate endpoint |
| DOC-Q-009 | Expression syntax mixes `{{ trigger.body.customer_id }}`, `={{ $json.body }}`, and bare `$json.category = 'billing'` (M.2) | Lock: (a) fields typed *expression* (if/switch conditions, loop condition) are **bare JSONata**; (b) any other config string starting with `=` is a **whole-value JSONata expression** (`=$json.body`); (c) `{{ expr }}` inside a non-`=` string is **string interpolation** of JSONata. Write a parser + tests in S0.4 |
| DOC-Q-010 | Compose services: C.1 omits NATS; §3.4 says "embedded queue"; E0.1-2 and D5 include NATS | **Include NATS JetStream** in Compose |
| DOC-Q-011 | Permission `model:pin` used in P.2, missing from O.1 | Add `model:pin` → Org Owner, Workspace Admin, Builder |
| DOC-Q-012 | D21 prefixes omit org/workspace/project/env/principal/event/request though examples use `org_`, `ws_`, `prn_`, `evt_`, `req_` | Add: `org_`, `ws_`, `prj_`, `env_`, `prn_`, `evt_`, `req_`, `ses_`, `trg_`, `dep_`, `prm_` (promotion) |
| DOC-Q-013 | Section 0 says Mega Prompt is §15; it is §16 (PRD Part II already notes this) | Use §16 |
| DOC-Q-014 | Wall-time limit default 15 min vs approvals that wait days; ceiling says "24 h (with waits excluded)" | Wall time counts **only time in `running`** for all runs; waits are governed by approval expiry / timer limits |
| DOC-Q-015 | RLS keys only on `org_id`; workspace isolation not covered by DB | Accept: org isolation = RLS; workspace/project = service layer + RBAC. Add explicit cross-workspace authz tests |
| DOC-Q-016 | Autonomy L4 exists in FR-RT-7 but v1 delivers L0–L3 (S1.2, P.1 hides L4) | Model L4 in the enum, reject it in validation unless policy flag `allow_l4` (none in v1) |

## C. Technical gaps the PRD missed — resolved

| ID | Gap | Resolution |
|---|---|---|
| DOC-Q-008 | `memory_items.embedding vector(1536)` fixed, while KBs allow configurable dims up to 3072 (O.3). pgvector HNSW indexes on `vector` support ≤ 2,000 dims | S0.5 ADR: store `embedding_dim`; untyped `vector` column with per-dimension **expression partial HNSW indexes** (`(embedding::vector(1536)) WHERE embedding_dim = 1536`); use `halfvec` expression index for dims > 2,000. Default 1536 only in v1. Verify against current pgvector docs before implementing |
| DOC-Q-017 | `run_events` PK `(run_id, seq, created_at)` — on a partitioned table, `seq` uniqueness per run is not truly enforced across partitions | Allocate `seq` under a row lock on the run (`runs.last_event_seq` column, `UPDATE ... RETURNING`) inside `commitTurn`; add a test for concurrent writers |
| DOC-Q-018 | Same issue for `run_steps (run_id, seq, attempt, created_at)` | Enforced by lease ownership + the same run row lock |
| DOC-Q-019 | `principals.email citext` without `CREATE EXTENSION citext` | Add `citext` to the extension migration |
| DOC-Q-020 | Inbound webhook URL shape: B.5 `/hooks/{workflow_slug}/{secret_or_id}` vs node `path` unique per environment (M.2) | URL = `/hooks/{trigger_external_id}` (opaque, unguessable) **plus** optional alias `/hooks/w/{workspace_slug}/{env_kind}/{path}`. Decide finally in S0.4 |
| DOC-Q-021 | Compose sandbox (D11 "Docker + seccomp, dev only") would require mounting the Docker socket into the worker — a host-escape risk | S0.3 ADR: separate `sandbox-runtime` service container (no network, read-only FS, seccomp, pids/mem/cpu limits) receiving code over internal RPC; never mount the Docker socket into worker |
| DOC-Q-022 | App DB role vs RLS: superusers and table owners bypass RLS without FORCE; PgBouncer transaction pooling breaks session `SET` | Separate roles: `platform_owner` (migrations), `platform_app` (NOBYPASSRLS, no ownership), `platform_system` (jobs). Always `SET LOCAL` inside transactions |
| DOC-Q-023 | No outbound-event ordering guarantee is specified | Per-run ordering by `run_events.seq`; consumers must tolerate reordering across runs; SSE resumes via `Last-Event-ID = seq` |
| DOC-Q-024 | Python SDK placed under `/packages` (A.2) | Move to `/python/sdk-py` so Python tooling (uv, ruff) lives in one tree |
| DOC-Q-025 | O.1 has no `project:create/delete` permission | Add `project:create`, `project:delete` → Org Owner, Workspace Admin |
| DOC-Q-026 | A.2/A.1 have no shared home for the execution engine, DB layer, workflow executor, authz catalogue | Added packages `db`, `execution`, `workflow-core`, `authz`, `config`, `platform-kit`, `api-contract` (see [02-repository-structure](architecture/02-repository-structure.md)) |

## D. Things deliberately out of scope for v1 (do not build)

From PRD §13.1 "Won't": marketplace, process mining, RPA bridge, knowledge-graph memory, real-time co-editing, air-gapped install. Also deferred to Phase 2: policy simulation, ClickHouse traces, native SAML, SCIM, hybrid workers, MCP **server** mode, online eval/drift, time-travel debugger, cloud multi-tenancy.
