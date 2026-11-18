# 0007 — OPA/Rego Compiled to WASM Policy Engine

- Status: Accepted
- Date: 2026-11-18
- Requirement / decision refs: D7, FR-GOV-4..9, NFR-2, NFR-10

## Context

Every sensitive runtime action must pass declarative policy evaluation (`FR-GOV-4`): tool calls, data access, memory reads and writes, model selection, outbound network egress, environment promotions, and publishing. Policy evaluation consumes structured runtime context (principal, agent, tool, classified arguments, environment, time, run taint flags such as `ingested_untrusted_content` and PII seen, cumulative spend, and risk score per `FR-GOV-5`) and must return one of `allow`, `deny`, `require_approval`, `allow_with_redaction`, or `allow_with_rate_limit` along with matching policy IDs and an explanation (`FR-GOV-6`).

Because policies are evaluated on the hot path of every tool call and memory/model operation, evaluation must fit within the platform's P95 < 500 ms per-step overhead budget (`NFR-2`), support Git-friendly policy-as-code (`FR-GOV-8`), and support offline/historical simulation in Phase 2 (`FR-GOV-7`). PRD Appendix L.1 (`D7`) locks OPA/Rego compiled to WASM and evaluated in-process.

## Decision

Adopt **OPA/Rego compiled to WebAssembly (WASM)**, evaluated **in-process in Node.js** inside `packages/policy-kit` (`PolicyEvaluator` interface), with versioned policy bundles (`L.1 D7`):

1. **In-process WASM runtime:**
   - Author declarative policies in Rego, compile bundles to OPA WASM tarballs on publish, and execute them in-process within `apps/api` and `apps/worker` via `packages/policy-kit`.
   - Zero per-decision network hops; built-in data/reference inputs are loaded into the bundle memory context.

2. **Bundle versioning and distribution (`A.6`):**
   - Store policy source and compiled bundle versions in `policies` and `policy_versions`.
   - Cache active WASM instances in-process and invalidate/reload across instances via Redis pub/sub upon policy publish.

3. **Decision logging and baseline rules (`FR-GOV-6`, `04-core-interfaces §8`):**
   - Every evaluation returns `{ effect, policy_ids, explanation, obligations }` and records an entry in `policy_decisions` (monthly partitioned) linked to the run/audit trail.
   - v1 ships a default bundle providing an allow baseline plus built-in rules covering autonomy levels (`L0–L3`, `DOC-Q-016`), side-effect class approval triggers (`destructive`, `external_comms`), untrusted-context denial for external communications (`ingested_untrusted_content`), and policy templates (`FR-GOV-9`).
   - Historical policy simulation (`FR-GOV-7`) is deferred to Phase 2 (`docs/06-open-questions.md §D`), enabled cleanly by deterministic WASM evaluation over recorded `run_steps` inputs.

## Consequences

- **Positive:**
  - Sub-millisecond, deterministic in-process evaluation with no external sidecar or RPC latency on tool and memory calls.
  - Mature policy-as-code ecosystem (`opa test`, Git diffs, static bundle verification) and broad enterprise familiarity.
  - Same compiled WASM bundle evaluates identically in `api` (promotion/publish checks), `worker` (tool/model/memory/egress checks), and future Phase 2 batch simulation.
- **Negative / Risks:**
  - Rego has a steeper authoring curve for non-engineers than simple key-value rules.
  - Requires a deterministic Rego-to-WASM compilation step (OPA CLI/toolchain or build service) when publishing custom policies, plus careful WASM instance memory management on hot bundle reloads.

## Alternatives considered

- **AWS Cedar:** Strong ergonomics and formal analysis for RBAC/ABAC authorization decisions, but less flexible for arbitrary JSON argument inspection, rich obligations (`allow_with_redaction`, `allow_with_rate_limit`), and historical simulation over heterogeneous tool payloads (`A.9`, `K`, `L.1 D7`).
- **External OPA HTTP sidecar / centralized policy service (`A.1`):** Adds network serialization overhead and an extra failure/availability domain on every step in `apps/worker`.

## Exit criteria to revisit

Revisit authoring ergonomics if non-engineers are blocked from creating or maintaining policies; in that event, retain the OPA/Rego WASM runtime and add a visual/structured policy builder in the console that compiles rules to Rego (`L.1 D7`).
