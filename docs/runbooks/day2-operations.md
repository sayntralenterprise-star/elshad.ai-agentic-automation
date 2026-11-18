# Day-2 Operations Runbook (`C.8`)

This runbook covers the Phase 0 baseline operational procedures from PRD Appendix C.8.

## 1. Emergency Kill Switch (`E0.6-3`)

Use when an agent, tool, workspace, or the global platform exhibits runaway spend, infinite tool retries, or a suspected prompt-injection incident:

1. **Console:** Navigate to `Governance` (`/w/<workspace>/e/<env>/governance`), choose scope (`global` | `workspace` | `agent` | `tool`), enter reason, and click **Activate Kill Switch**.
2. **API:**
   ```bash
   curl -X POST "$API_BASE_URL/api/v1/killswitches" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Idempotency-Key: ks-$(date +%s)" \
     -H "Content-Type: application/json" \
     -d '{"scope_type":"global","reason":"Incident containment"}'
   ```
3. All new agent/workflow runs matching the scope are blocked (`403 POL_DENIED`) and in-flight ReAct loops halt at the next step or tool boundary within <= 5 s. Every activation and deactivation is written to hash-chained `audit_events`.

## 2. Budget Hard Stops & Triage (`E0.6-2`, `N.2.6`)

- Inspect active budgets and spend via `GET /api/v1/budgets` or `Governance -> Budgets & Hard Stops`.
- Supported breach policies: `downgrade_model` (automatically switches to `fast` tier), `require_approval`, or `stop` (`BUD_HARD_LIMIT` within 1 step).

## 3. Secret Rotation & Key Compromise Response (`E0.6-1`)

1. Rotate compromised credential values via `POST /api/v1/secrets/{id}/rotate` (increments `key_version` without breaking opaque `secret://db/{id}` references).
2. During master KEK rotation, call `EnvelopeSecretsProvider.rotateMasterKey(...)` so prior `kek_version` envelopes remain readable until re-wrapped.
3. Verify zero plaintext leakage across traces/logs with `scanForSecretLeaks` and `GET /api/v1/audit/verify`.

## 4. Suspected Prompt-Injection Incident Response

1. Activate agent/tool kill switch (`scope_type: "tool"` or `"agent"`).
2. Inspect flagged run steps (`untrusted_source: true`, `injection_suspected: true`) and export/verify audit logs (`GET /api/v1/audit-events`, `GET /api/v1/audit/verify`).
3. Rotate any credentials reachable by that workspace and tighten `allowed_domains` / `approval: "always"` on external tools.

## 5. Stuck Runs, DLQ Re-Drive & DR

- Inspect dead-letter items under `Runs` (`GET /api/v1/dlq`) and re-drive selectively (`POST /api/v1/runs:bulk-redrive`).
- Execute backup/restore recovery per [backup-and-dr-drill.md](backup-and-dr-drill.md).
