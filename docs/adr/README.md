# Architecture Decision Records

Template: PRD L.3 — **Context, Decision, Consequences, Alternatives, Status**. File name `NNNN-kebab-title.md`. Status values: Proposed → Accepted → Superseded.

## Index (to be written by the development agent)

### Locked by PRD (record as Accepted; context = PRD Appendix L.1)

| ADR | Decision | PRD | Required by |
|---|---|---|---|
| 0001 | Internal platform first, product-grade boundaries | D1 | — |
| 0002 | Single codebase with edition flags (community / enterprise) | D2 | — |
| 0003 | TypeScript Node 22 core; Python 3.12 for sandbox + graders | D3 | S0.1 |
| 0004 | **Postgres-native durable executor behind `ExecutionEngine`** | D4 | **Phase 0 exit** |
| 0005 | NATS JetStream event bus; Postgres source of truth | D5 | S0.2 |
| 0007 | **OPA/Rego compiled to WASM, in-process** | D7 | **Phase 0 exit** |
| 0008 | **JSONata expressions** (+ syntax rules from DOC-Q-009) | D8 | **Phase 0 exit** |
| 0009 | pgvector HNSW (+ dimension strategy DOC-Q-008) | D9 | S0.5 |
| 0010 | **Postgres partitions for traces; ClickHouse adapter later** | D10 | **Phase 0 exit** |
| 0011 | gVisor sandbox; Compose sandbox container design (DOC-Q-021) | D11 | S0.3 |
| 0013 | Secrets provider interface + envelope encryption | D13 | S0.6 |
| 0014 | OIDC + local Argon2id; SAML via Keycloak in v1 | D14 | S0.1 |
| 0022 | IDs (UUIDv7 + prefixes), money (micro-USD), time | D21, D22 | S0.1 |

### Proposed fill-ins (record as Proposed; see [03-tech-stack §2](../architecture/03-tech-stack-and-conventions.md))

| ADR | Decision |
|---|---|
| 0101 | pnpm workspaces + Turborepo |
| 0102 | Fastify 5 + zod type provider |
| 0103 | zod as single schema source; JSON Schema emitted |
| 0104 | Contract-first OpenAPI via zod-to-openapi; oasdiff in CI |
| 0105 | SDK generation (openapi-typescript/openapi-fetch; openapi-python-client) |
| 0106 | Kysely + `withTenantTx` (`SET LOCAL`), DB roles (DOC-Q-022) |
| 0107 | node-pg-migrate, SQL-only, expand-contract |
| 0108 | pino logging + redaction |
| 0109 | openid-client + Argon2id library |
| 0110 | Console sessions: HttpOnly cookie + CSRF; Bearer for API clients |
| 0111 | Testing stack (Vitest, Testcontainers, Playwright, axe) |
| 0112 | CI on GitHub Actions |
| 0113 | Package additions beyond PRD A.2 (DOC-Q-026) |
| 0114 | Transactional outbox table + relay (DOC-Q-002) |
| 0115 | Event seq allocation under run row lock (DOC-Q-017) |

## Template

```markdown
# NNNN — Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Requirement / decision refs: D4, FR-ORC-1, ...

## Context
## Decision
## Consequences
## Alternatives considered
## Exit criteria to revisit
```
