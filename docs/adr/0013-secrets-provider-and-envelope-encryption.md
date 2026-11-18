# 0013 — SecretsProvider Interface, Envelope Encryption, and Vault Adapter

- Status: Accepted
- Date: 2026-11-18
- Requirement / decision refs: D13, FR-INT-3, F.3, E0.6-1

## Context

Credentials for model providers, webhook HMAC secrets, database passwords, and external connectors must never appear in agent definitions, prompt contexts, logs, run traces, or HTTP/UI responses (`FR-INT-3`, PRD §6.1, S.3). Single-node Compose deployments require a self-contained PostgreSQL-backed secrets store without requiring HashiCorp Vault (`A.9`), while cluster/enterprise deployments integrate with HashiCorp Vault or cloud KMS (`C.7`).

## Decision

Standardize all credential storage behind `SecretsProvider` in `packages/platform-kit`:

1. **Write-only reference model (`secret://<provider>/<id>`):**
   - API callers pass secret material only on creation or rotation (`POST /api/v1/secrets`, `POST /api/v1/secrets/{id}/rotate`).
   - Subsequent read/list operations (`GET /api/v1/secrets`) return `SecretRecordMetadata` only (`ref`, `name`, `keyVersion`, timestamps) — plaintext is returned exclusively to trusted backend executors calling `resolve(ctx, ref, purpose)`.

2. **Database envelope encryption (`EnvelopeSecretsProvider`, `F.3`):**
   - Each secret generates a fresh random 256-bit Data Encryption Key (`dek`) encrypted via AES-256-GCM with `org_id` bound as Additional Authenticated Data (`AAD`) to prevent cross-tenant ciphertext swapping.
   - The DEK is wrapped via AES-256-GCM using a versioned Key Encryption Key (`KEK`) derived from the keyring (`rotateMasterKey` increments `keyVersion`), enabling non-destructive KEK rotation while preserving decryptability for older `keyVersion` entries until rotated.

3. **HashiCorp Vault KV v2 adapter (`VaultSecretsProvider`):**
   - Implements the identical `SecretsProvider` contract (`secret://vault/<id>`) over Vault HTTP endpoints (with injectable transport for deterministic CI tests).

4. **Automated leakage verification (`scanForSecretLeaks`):**
   - Recursive scanner inspects arbitrary log, trace span, run step, prompt, response, and UI payloads against both known plaintext values and token signatures (`sk-`, `AKIA`, `ghp_`, PEM private keys).

## Consequences

- **Positive:** Compose/dev deployments enjoy real cryptographic envelope isolation with zero external Vault dependency, while enterprise Vault cutover requires zero runtime or API contract changes.
- **Negative / Risks:** Master KEK material (`PLATFORM_MASTER_KEY` / keyring) must be backed up securely outside the database so restored database dumps remain decryptable (`deploy/scripts/backup-restore.mjs`).

## Alternatives considered

- **Storing plaintext credentials in Postgres encrypted only by disk encryption:** Fails defense-in-depth and violates tenant cryptographic separation (`F.3`).
- **Mandating Vault in single-node Compose:** Adds operational weight prohibited by `A.9` (Docker Compose simplicity).

## Exit criteria to revisit

- Revisit when adding Phase 2 customer-managed BYOK/HYOK cloud KMS wrapping (`AWS KMS`, `GCP KMS`, `Azure Key Vault`).
