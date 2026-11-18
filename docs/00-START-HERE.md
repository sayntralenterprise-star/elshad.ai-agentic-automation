# START HERE — Development Handoff

> Audience: the engineering/AI agent that will build the platform.
> Repository: `https://github.com/sayntralenterprise-star/elshad.ai-agentic-automation.git` (`sayntralenterprise-star/elshad.ai-agentic-automation`, default branch `main`).
> Source spec: [`AI Agent & Automation Platform Deep PRD and Mega Prompt (v2.0).md`](../AI%20Agent%20&%20Automation%20Platform%20Deep%20PRD%20and%20Mega%20Prompt%20(v2.0).md) (≈243 KB, 2,966 lines). Referred to below as **the PRD**.
> Prepared: 2026-11-18.

## 1. What we are building (one paragraph)

A **self-hostable platform** where teams design, run, govern, and improve **deterministic workflows** and **autonomous AI agents** in **one runtime**. Every action is **traced, bounded (limits/budgets), permissioned (RBAC + policy), and audited (hash-chained log)**. v1 = self-hosted (Docker Compose + Helm), BYOK model providers, TypeScript core, Postgres-native durable execution.

The three differentiators that must never be compromised:
1. **Unified runtime** — workflows contain agents, agents call workflows as tools; one trace, one permission model, one budget model.
2. **Governance as the data model** — identity, policy check, budget check, and audit event on *every* action.
3. **Evaluation-first** — no promotion without a passing gate.

## 2. Reading order (do not read the PRD front-to-back first)

| # | Read | Why |
|---|---|---|
| 1 | This file | Rules of engagement |
| 2 | [architecture/01-architecture-overview.md](architecture/01-architecture-overview.md) | The system, deployables, flows |
| 3 | [architecture/02-repository-structure.md](architecture/02-repository-structure.md) | Where code goes; module boundaries |
| 4 | [architecture/03-tech-stack-and-conventions.md](architecture/03-tech-stack-and-conventions.md) | Locked + proposed tech choices, conventions |
| 5 | [architecture/04-core-interfaces-and-data.md](architecture/04-core-interfaces-and-data.md) | Contracts to write first; schema completion list |
| 6 | [06-open-questions.md](06-open-questions.md) | Contradictions in the PRD and how they are resolved |
| 7 | [plan/05-delivery-plan.md](plan/05-delivery-plan.md) | Slice order and what PRD sections feed each slice |
| 8 | [plan/S0.1-skeleton.md](plan/S0.1-skeleton.md) | **Your first task**, fully specified |
| 9 | PRD sections listed in the current slice brief | Detail on demand |

## 3. Source-of-truth precedence (when the PRD contradicts itself)

The PRD was written in three layers and later layers override earlier ones:

1. **[06-open-questions.md](06-open-questions.md)** resolutions (this handoff) — highest.
2. **PRD Part III** (Appendices L–T): locked decisions, exact schemas, DDL, algorithms, catalogues, backlog.
3. **PRD Part II** (Appendices A–K): deep dives.
4. **PRD Part I** (Sections 1–17): vision, requirements (FR/NFR IDs), UI spec.

Examples: Section 3.3 says "Temporal *or* Postgres executor" → Appendix L D4 locks **Postgres-native executor**. Section 3.3 says "NATS *or* Redis Streams" → D5 locks **NATS JetStream**. Error code `SYS_CONFLICT` (A.4/B.1) → `RES_CONFLICT` (O.2, the "complete" catalogue).

If something is answered nowhere: log it as `DOC-Q-nnn` in [06-open-questions.md](06-open-questions.md), pick the most conservative option, record an ADR, continue (PRD Appendix T protocol).

## 4. Non-negotiable rules (from PRD §16 + Appendix L.3)

1. **Vertical slices only.** Never scaffold the whole platform. Finish a slice to its Definition of Done (PRD §14) before starting the next.
2. **Multi-tenant from the first migration**: every tenant table has `org_id` (+ `workspace_id` where applicable) and Postgres **RLS with FORCE**.
3. **Every new action** emits a trace span, metrics, and an audit event; passes a policy check (default-allow is fine early, but the call must exist).
4. **Interfaces and contract tests first** for pluggable parts (model providers, memory backends, secrets, object store, event bus, execution engine, policy evaluator).
5. **Never invent library APIs.** If unsure, say so and add a verification step/spike.
6. **No secrets** in code, logs, prompts, traces, or API responses. Secrets are write-only.
7. **Money is integer micro-USD**; timestamps UTC ISO-8601 with ms; durations ms; IDs UUIDv7 internally with prefixed external IDs (D21/D22).
8. **Requirement IDs** (`FR-RT-14`, `NFR-6`, `E0.2-2`…) appear in PR descriptions, commit bodies, and test names.
9. **Do not mark work complete** if tests fail or requirements are partial — report status honestly.

## 5. Per-slice working method (PRD §16)

For each slice respond/work in this order:
1. Restate scope and requirement IDs.
2. List assumptions and at most 3 blocking questions.
3. Propose folder changes and interfaces.
4. Implement with tests (unit, integration, failure-injection where relevant).
5. Run instructions + 3-minute demo script.
6. Self-check against Definition of Done (PRD §14) and run the **review prompt** (PRD §16.2); list gaps.

## 6. Environment notes for this machine

- Host OS is **Windows**. Use **Docker Desktop with WSL2**; run Node/pnpm inside WSL2 or natively — scripts must be cross-platform (no bash-only `package.json` scripts; use Node scripts or `cross-env`).
- gVisor is Linux-only; in Compose mode the sandbox runs in "docker / dev-only" mode (D11). Not needed until S0.3.
- No model provider key is required until S0.3; use the **mock model server** (E0.3-2) in CI always.

## 7. First task

Execute [plan/S0.1-skeleton.md](plan/S0.1-skeleton.md). Do not start S0.2 until S0.1 meets its exit criteria.
