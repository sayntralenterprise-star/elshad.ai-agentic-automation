# 0101 — Monorepo, API Stack, Data Access, Auth, and CI Tooling (0101–0115)

- Status: Proposed
- Date: 2026-11-18
- Requirement / decision refs: D3, D12, D14, D21, D22, D23, L.3, L.4, U-1, U-2, U-6, DOC-Q-002, DOC-Q-017, DOC-Q-018, DOC-Q-022, DOC-Q-024, DOC-Q-026

## Context

PRD Appendix L.1 locks the core runtime languages (`D3`: TypeScript on Node 22 LTS; Python 3.12 only for sandbox runtime and eval graders), frontend stack (`D12`), auth model (`D14`), ID/time/money primitives (`D21`, `D22`), and REST + OpenAPI 3.1 + SSE API style (`D23`), while remaining silent on concrete Node/TypeScript libraries, monorepo orchestration, database query/migration tooling, session mechanics, and structural gap resolutions.

`docs/architecture/03-tech-stack-and-conventions.md §2` and `docs/adr/README.md` enumerate proposed fill-in decisions `0101` through `0115` to establish a consistent foundation in Slice `S0.1`. Stakeholder decision `U-1` (`docs/06-open-questions.md`) locks these defaults for S0.1, subject to package API verification during implementation.

## Decision

Consolidate and adopt the following S0.1 tooling and structural decisions (`0101`–`0115`):

| ID | Concern | Adopted Choice | Key Details / Rules |
|---|---|---|---|
| **0101** | Monorepo & workspaces | **pnpm workspaces + Turborepo** | Fast, strict dependency isolation (`node_modules`), cached build/test task graph. Cross-platform scripts (no bash-only `package.json` scripts on Windows hosts). Python services/SDK under `/python/` use **uv** + `ruff` + `black` + `pytest`. |
| **0102** | HTTP framework | **Fastify 5 + `fastify-type-provider-zod`** | Schema-first routing, plugin architecture for auth, Redis rate limiting, idempotency, and SSE streaming. Implements the `03-tech-stack §3` pipeline (`requestId → OTel span → authenticate → resolve tenant → rate limit → idempotency → zod validate → authorize → handler (withTenantTx) → audit + outbox → response`). |
| **0103** | Schema source of truth | **`zod` in `packages/domain`** | Single schema source for runtime validation, OpenAPI generation, and JSON Schema emission for agent/workflow definitions and node inspector forms (`WorkflowGraph`, `NodeHandler.configSchema`). |
| **0104** | Contract-first OpenAPI | **`@asteasolutions/zod-to-openapi` + `oasdiff`** | Route contracts declared in `packages/api-contract`; `docs/api/openapi.json` emitted at build and served at `/openapi.json`; `oasdiff` enforces breaking-change checks in CI. JSON fields are `snake_case` (`L.4`). |
| **0105** | SDK generation | **`openapi-typescript` + `openapi-fetch` (+ `openapi-react-query`); `openapi-python-client`** | Thin typed TS client in `packages/sdk-ts` (mapping to camelCase for TS consumers) and generated Python client in `python/sdk-py` (`DOC-Q-024`). |
| **0106** | Database access & tenancy | **Kysely over `pg` + `withTenantTx` + separate DB roles** | Explicit typed SQL fits partitions, `FOR UPDATE SKIP LOCKED`, and RLS cleanly. `withTenantTx` issues `SET LOCAL app.org_id` (and workspace/principal) inside transactions for PgBouncer transaction-pool safety (`DOC-Q-022`). Separate roles: `platform_owner` (migrations), `platform_app` (`NOBYPASSRLS`, non-owner), `platform_system` (`withSystemTx`, restricted to `apps/engine` jobs via `dependency-cruiser`). |
| **0107** | Database migrations | **`node-pg-migrate` (plain SQL)** | Forward-only SQL migrations (`L.3`) following expand-contract discipline (`C.4`, `NFR-16`) with full support for partitioned tables, extensions (`pgcrypto`, `vector`, `pg_trgm`, `citext`), and an automated RLS-`FORCE` helper. |
| **0108** | Structured logging | **`pino` JSON + redaction** | Configured in `packages/telemetry` with required `L.3` fields (`ts, level, msg, trace_id, span_id, org_id, workspace_id, run_id, step_id, principal_id`), redaction paths, no payload bodies above `DEBUG`, and zero secrets. |
| **0109** | Auth libraries | **`openid-client` + Argon2id (`@noble/hashes/argon2.js`)** | `openid-client` for OIDC (auth code + PKCE, available in all editions in v1 per `U-6`); pure-TS Argon2id via `@noble/hashes` for local credentials in Compose/eval mode (`D14`), avoiding native C++ build dependencies. |
| **0110** | Sessions & API auth | **HttpOnly `SameSite=Lax` cookie + CSRF (console); Bearer (API)** | Console stores an opaque server-side session ID (Postgres-backed, Redis-cached) in an `HttpOnly` cookie plus CSRF protection so tokens never sit in browser JS (`E.1`). API/CLI/SDK clients use `Authorization: Bearer <token>` (OIDC access token, peppered-hash API key, or service account). |
| **0111** | Testing stack | **Vitest, Testcontainers, Playwright + `@axe-core/playwright`, pytest** | Unit tests beside source with injected `Clock` and `IdGen` (`uuid` v7) and mock model server; Testcontainers (Postgres, Redis/Valkey, NATS, MinIO) for integration; Playwright + axe for E2E & WCAG 2.2 AA (`NFR-15`); pytest for `/python/`. ≥ 80% coverage on core packages (`NFR-17`). |
| **0112** | CI platform | **GitHub Actions** | Target repo `sayntralenterprise-star/elshad.ai-agentic-automation` (`U-2`). Gates: lint, typecheck, `dependency-cruiser`, unit + coverage, integration (service containers), Docker builds, `Trivy`, `gitleaks`, and `oasdiff`. |
| **0113** | Package additions beyond PRD A.2 | **Added `config`, `db`, `execution`, `platform-kit`, `authz`, `workflow-core`, `api-contract`; moved `sdk-py`** | Prevents cross-app imports (`apps/api`, `apps/engine`, `apps/worker` never import each other) and duplicated infra code (`DOC-Q-026`, `DOC-Q-024`, `02-repository-structure §1`). Enforced by `dependency-cruiser`. |
| **0114** | Transactional outbox | **`outbox` table + `OutboxRelay`** | Resolves `DOC-Q-002`: `outbox (id uuid pk, org_id, type, subject, payload jsonb, created_at, published_at null, attempts)` with partial index on unpublished rows, written in the same transaction as domain state changes and drained to NATS JetStream by `apps/engine`. |
| **0115** | Partitioned `seq` allocation | **Run row lock (`runs.last_event_seq`)** | Resolves `DOC-Q-017` / `DOC-Q-018`: allocates `run_events.seq` via `UPDATE runs SET last_event_seq = last_event_seq + 1 ... RETURNING` inside `commitTurn`, guaranteeing per-run gap-free ordering across monthly partitions; `run_steps` uniqueness guarded by lease ownership + the same run row lock. |

Additional baseline conventions (`03-tech-stack §2–3`):
- **Frontend styling (`D12`):** Tailwind CSS with CSS-variable design tokens in `packages/ui-kit` and Radix primitives.
- **UUIDv7 (`D21`):** `uuid` (v7) wrapped by an injectable `IdGen` interface in `packages/domain`.
- **Licenses (`L.3`):** Core allowlist is MIT, Apache-2.0, BSD, ISC, and MPL-2.0 (`AGPL`/`GPL` blocked in linked core code). MinIO is AGPL-licensed and is used strictly as an external Compose object-storage service over S3 HTTP API (never linked as a dependency).

## Consequences

- **Positive:**
  - Establishes a single, end-to-end typed contract chain (`zod` → Fastify → OpenAPI 3.1 → TS/Python SDKs + `oasdiff`) with zero manual schema duplication.
  - Preserves strict module boundaries via `dependency-cruiser` while giving `db`, `execution`, `authz`, and `workflow-core` shared homes (`0113`).
  - Eliminates PgBouncer and RLS pitfalls upfront via `SET LOCAL`, dedicated DB roles (`0106`), transactional outbox (`0114`), and row-locked event sequencing (`0115`).
- **Negative / Risks:**
  - `zod-to-openapi` and `fastify-type-provider-zod` require verifying exact v5/zod compatibility during S0.1 bootstrap (`03-tech-stack §2` warning: verify current package names/APIs before use).
  - Plain SQL migrations (`node-pg-migrate`) and Kysely require manual type/migration synchronization (mitigated by integration tests against Testcontainers Postgres on every PR).

## Alternatives considered

- **npm/Yarn + Nx:** Rejected in favor of pnpm strictness and Turborepo's minimal configuration overhead.
- **Prisma / Drizzle ORM:** Rejected because active-record/abstracted ORMs complicate `FOR UPDATE SKIP LOCKED`, Postgres range partitioning, `SET LOCAL` transaction wrappers, and `FORCE ROW LEVEL SECURITY` patterns (`03-tech-stack §2`).
- **Express or NestJS:** Express lacks native schema-typed routing and performance; NestJS introduces heavy decorator/DI coupling across packages where explicit module `index.ts` boundaries are preferred.
- **JWTs stored in `localStorage` for Console:** Rejected due to XSS token-exfiltration risk (`E.1`); `HttpOnly` server-side sessions + CSRF protect console users.

## Exit criteria to revisit

- Verify exact package versions and API compatibility (`Fastify 5`, `fastify-type-provider-zod`, `@asteasolutions/zod-to-openapi`, `Kysely`, `node-pg-migrate`, `openid-client`, `@node-rs/argon2`, `openapi-python-client`) during **S0.1** before moving these decisions from `Proposed` to `Accepted`.
- Revisit individual tooling items via a dedicated superseding ADR (`01xx`) if an upstream package exhibits blocking incompatibilities with Node 22 LTS or OpenAPI 3.1 generation.
