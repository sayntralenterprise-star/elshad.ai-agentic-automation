# 0008 — JSONata Expression Language for Workflows

- Status: Proposed
- Date: 2026-11-18
- Requirement / decision refs: D8, DOC-Q-009, N.3, FR-WF-1..5

## Context

Deterministic workflows (`packages/workflow-core`) need an inline expression language for data mapping between item arrays, conditional branching (`logic.if`, `logic.switch`), loop termination conditions, and model routing rules (`M.2`, `N.5`, `P.1`). Expressions execute on user-authored workflow definitions and untrusted external payloads, so they must be pure (no network/filesystem I/O), strictly bounded in runtime and memory/output size, and prevented from reading or exfiltrating platform secrets (`N.3`, `E0.4-3`).

Additionally, PRD parts mixed bare expressions (`$json.category = 'billing'`), `=`-prefixed expressions (`={{ $json.body }}`), and mustache interpolation (`{{ trigger.body.customer_id }}`), requiring a single unambiguous syntax specification (`DOC-Q-009`). PRD Appendix L.1 (`D8`) locks JSONata for workflow expressions.

## Decision

Adopt **JSONata** as the exclusive workflow expression language behind `ExpressionEngine` in `packages/workflow-core` (`docs/architecture/04-core-interfaces-and-data.md §10`), reserving JavaScript execution exclusively for isolated `Code` nodes inside the sandbox runtime (`D8`, `D11`):

1. **Locked expression syntax rules (`DOC-Q-009`):**
   - Fields typed explicitly as *expression* (e.g., `logic.if` / `logic.switch` conditions, loop conditions) are parsed and evaluated as **bare JSONata**.
   - Any other string configuration field starting with `=` (e.g., `=$json.body`) is evaluated as a **whole-value JSONata expression** (preserving non-string return types such as objects, arrays, numbers, or booleans).
   - `{{ expr }}` inside a non-`=` string performs **string interpolation** of JSONata expressions.

2. **Execution scope and helper functions (`N.3`):**
   - Expose read-only context variables: `$json` (current item), `$item` (index), `$node["Name"].json` (prior node output), `$trigger`, `$run` (`id`, `started`, `labels`), `$env` (non-secret environment variables only), `$now`, and `$workflow`.
   - `$secret` references are **never** resolved inside `ExpressionEngine`; they are usable only in designated credential fields and resolved exclusively at the tool gateway (`N.3`).
   - Provide pure built-in helpers: `$uuid()`, `$hash(x)`, `$jsonParse(s)`, `$dateAdd(d, n, unit)`, `$lookup(table, key)`, `$redact(x, classes)`.

3. **Sandbox limits (`N.3`, `E0.4-3`):**
   - Pure evaluation only (no custom I/O functions, no prototype/global object access).
   - Enforce a **50 ms** evaluation timeout and a **1 MB** (`1_048_576` bytes) serialized output cap per expression evaluation.

## Consequences

- **Positive:**
  - Safe, declarative querying and reshaping of JSON item arrays without exposing a general-purpose JS runtime inside `apps/worker` or `apps/api`.
  - Unambiguous separation of bare expressions, `=` whole-value expressions, and `{{ ... }}` string interpolation (`DOC-Q-009`).
  - Clear security boundary: heavy imperative logic belongs in `Code` nodes executed in the network-disabled `sandbox-runtime` (`D11`).
- **Negative / Risks:**
  - JSONata syntax (e.g., single `=` for equality, 1-based positional quirks, object transformation syntax) requires clear editor hints/preview and documentation for builders.
  - Because standard Node JSONata evaluation is synchronous, the 50 ms timeout and recursion/output bounds must be enforced explicitly (e.g., AST/depth/iteration checks or worker/isolate boundary) and verified against adversarial expressions in S0.4 (`E0.4-3`).

## Alternatives considered

- **Sandboxed JavaScript subset (`isolated-vm`, QuickJS, Node `vm`):** More familiar syntax for developers, but `vm` is not a security boundary, native isolate bindings add build/ABI complexity on Node 22, and supporting arbitrary JS increases escape and DoS surface for simple mapping expressions (`A.9`, `L.1 D8`).
- **JMESPath or CEL:** JMESPath lacks date/string helpers and rich object-restructuring ergonomics; CEL is primarily designed for boolean/typed predicates rather than general workflow JSON transformations.

## Exit criteria to revisit

None planned (`L.1 D8`). Revisit the host evaluation wrapper (not the language choice) only if S0.4 load/security benchmarks show synchronous timeout enforcement cannot reliably bound adversarial expressions within 50 ms under 1,000-item workflow loops.
