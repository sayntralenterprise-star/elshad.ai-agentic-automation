# 03 — Tech Stack and Conventions

## 1. Locked by the PRD (Appendix L.1) — do not change without an RFC/ADR

| ID | Concern | Locked value |
|---|---|---|
| D3 | Languages | **TypeScript on Node 22 LTS** (services, console); **Python 3.12** only for sandbox runtime and eval graders |
| D4 | Durable execution | **Postgres-native executor**: event-sourced `run_events` + `work_items` with `FOR UPDATE SKIP LOCKED` leases, behind an `ExecutionEngine` interface (Temporal adapter possible later) |
| D5 | Event bus | **NATS JetStream** (Postgres stays source of truth for work) |
| D6 | Cache / rate limit | **Redis / Valkey 7+** |
| D7 | Policy | **OPA/Rego compiled to WASM**, evaluated in-process in Node, bundle versioning |
| D8 | Expressions | **JSONata** for workflow expressions; JS only inside sandboxed Code nodes |
| D9 | Vector | **pgvector (HNSW)** |
| D10 | Traces | **Postgres partitions** + object storage for large payloads |
| D11 | Sandbox | **gVisor** on K8s; Docker+seccomp in Compose (dev only) |
| D12 | Frontend | **React 18, Vite, TanStack Query + Router, React Flow, Monaco, Tailwind + Radix** |
| D13 | Secrets | Provider interface; default envelope-encrypted DB columns with master key (env/KMS); Vault/cloud SM in prod |
| D14 | Auth | **OIDC (auth code + PKCE)**; **local accounts with Argon2id** only for Compose/eval mode; SAML via Keycloak proxy in v1 |
| D15 | Models | **BYOK only**; adapters: OpenAI, Anthropic, Google, Azure OpenAI, Bedrock, Mistral, OpenAI-compatible |
| D21 | IDs | UUIDv7 internally, prefixed external IDs |
| D22 | Time/money | UTC ISO-8601 ms; durations ms; **integer micro-USD** |
| D23 | API | REST + OpenAPI 3.1; SSE for streams |
| D24 | Model refs in templates | **Capability tiers** `fast` / `balanced` / `reasoning`, mapped per workspace |
| D25 | Retention | Traces 30 d, payloads 14 d, audit 7 y, run summaries 400 d, checkpoints last 5 + milestones |
| L.3 | Migrations | Forward-only SQL (node-pg-migrate or Atlas), expand-contract |
| L.3 | Style | ESLint + Prettier, TS `strict`, ruff + black, Conventional Commits, trunk-based |

## 2. Proposed fill-ins (the PRD is silent) — confirm or override in S0.1 ADRs

> [!IMPORTANT]
> These are recommendations, not PRD mandates. The development agent should record each as an ADR (status *Proposed* → *Accepted*) during S0.1. Verify current package names/APIs before use — do not assume.

| Concern | Proposal | Rationale | ADR |
|---|---|---|---|
| Package manager / monorepo | **pnpm workspaces + Turborepo** | Fast, strict deps, cached task graph | 0101 |
| HTTP framework | **Fastify 5** + `fastify-type-provider-zod` | Fast, schema-first, good plugin model for auth/rate-limit/SSE | 0102 |
| Schemas | **zod** in `packages/domain` as single source; JSON Schema emitted for agent/workflow definitions & node configs | One schema → validation, OpenAPI, UI forms | 0103 |
| OpenAPI | Route contracts declared in `packages/api-contract` with `@asteasolutions/zod-to-openapi`; spec generated at build into `docs/api/openapi.json`; breaking-change check with **oasdiff** in CI | Section 8 requires OpenAPI as source of truth; generation avoids drift | 0104 |
| SDK generation | TS: **openapi-typescript + openapi-fetch** (+ `openapi-react-query` for console hooks). Python: **openapi-python-client** | Thin, typed, no runtime magic | 0105 |
| DB access | **Kysely** (typed query builder) over `pg`; `withTenantTx(ctx, fn)` helper issues `SET LOCAL app.org_id` | Explicit SQL fits partitions/SKIP LOCKED/RLS; ORMs fight these | 0106 |
| Migrations | **node-pg-migrate** with plain SQL files | Named in PRD L.3; simple; works with partitions and RLS | 0107 |
| Logging | **pino** JSON with required fields (L.3) and redaction paths | Fast, structured | 0108 |
| OIDC | **openid-client**; local auth hashing with an Argon2id library (e.g. `@node-rs/argon2`) | Certified OIDC RP library | 0109 |
| Sessions | Console: HttpOnly SameSite=Lax cookie holding opaque session id (server-side session in Postgres, cache in Redis) + CSRF token; API clients: Bearer (access token or API key) | E.1 security requirements; avoids tokens in JS | 0110 |
| UUIDv7 | `uuid` package (v7) via injectable `IdGen` | Deterministic in tests (L.3) | — |
| Testing | **Vitest** (unit), **Testcontainers** (Postgres/Redis/NATS/MinIO integration), **Playwright** + `@axe-core/playwright` (e2e/a11y), pytest | Matches Appendix G | 0111 |
| Python tooling | **uv** for envs/locks, ruff + black, pytest | Fast, reproducible | — |
| Console styling | Tailwind (current stable) with CSS-variable tokens from `ui-kit`; Radix primitives | D12 | — |
| CI | **GitHub Actions** (lint, typecheck, unit, depcruise, integration w/ services, build images, Trivy, gitleaks, oasdiff) | Target repo: `https://github.com/sayntralenterprise-star/elshad.ai-agentic-automation.git` | 0112 |

## 3. Cross-cutting conventions (summary for daily use)

### Errors
- Single `PlatformError` class in `packages/domain` with `code` (from PRD **O.2**), `httpStatus`, `retryable`, `failureClass`, `details`. Never throw strings; never swallow.
- Error envelope (B.1): `{ error: { code, message, details, request_id, trace_id, doc_url } }`.
- Failure class mapping per O.2 footer.

### Request pipeline (api)
`requestId → OTel span → authenticate → resolve tenant (token + X-Workspace-Id/X-Environment) → rate limit → idempotency (POST effects) → zod validate → authorize(permission, scope) → handler (withTenantTx) → audit + outbox in same tx → response`.

### Idempotency
- API: `Idempotency-Key` required on create/run endpoints; stored 24 h in `idempotency_keys` keyed `(principal_id, key)` with `request_hash`; mismatched body with same key → 422 `VAL_SCHEMA_MISMATCH` (document).
- Tool effects: N.2.8 formula (see DOC-Q-005), 7-day ledger.

### Pagination / filtering / concurrency (B.1)
Cursor (`limit`, `cursor` → `{data, next_cursor}`); `filter[field]=`, `sort=-created_at`, `q=`; `ETag`/`If-Match` → 409 `RES_CONFLICT`.

### Logging fields (L.3)
`ts, level, msg, trace_id, span_id, org_id, workspace_id, run_id, step_id, principal_id`. No payload bodies above DEBUG. Never secrets.

### Telemetry
Every handler/worker job wrapped in a span helper; GenAI semantic conventions for LLM spans; metrics `platform_<area>_<name>_<unit>`.

### Testing
- Test file beside source; behaviour-named tests including requirement IDs, e.g. `it('[FR-RT-1] records termination reason limit_reached when max_steps hit')`.
- No network in unit tests; inject `Clock` and `IdGen`.
- Coverage ≥ 80% on core packages (`domain`, `execution`, `runtime-core`, `tool-kit`, `policy-kit`, `workflow-core`, `authz`).

### Git
Trunk-based; PRs < 400 lines where possible; Conventional Commits with requirement IDs in body; feature flags (`ff.*`) for incomplete work.

### Licenses
Allowlist MIT, Apache-2.0, BSD, ISC, MPL-2.0. **AGPL/GPL blocked in core** — note: MinIO server is AGPL; it is used only as an external Compose service (not linked), which is acceptable, but record it in the ADR.
