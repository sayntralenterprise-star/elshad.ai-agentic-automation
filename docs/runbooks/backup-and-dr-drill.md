# Backup & Disaster Recovery Runbook (`C.5`, `E0.6-4`)

## Scope & Recovery Objectives (`C.5`)

- **RPO target:** 5 minutes (continuous Postgres WAL archiving + transaction outbox).
- **RTO target:** 30 minutes (clean restore from latest base backup + WAL replay).
- **Automated script:** [backup-restore.mjs](../../deploy/scripts/backup-restore.mjs).

## 1. Create Verified Backup Bundle (PostgreSQL)

```bash
node deploy/scripts/backup-restore.mjs backup "$PLATFORM_DATABASE_URL" backups/elshad-$(date -u +%Y%m%dT%H%M%SZ).pgdump
```

1. Generates a custom-format `pg_dump` binary archive without owner/ACL drift.
2. Computes and writes a SHA-256 checksum sidecar (`*.pgdump.sha256`).
3. Ensure `PLATFORM_MASTER_KEY` (KEK keyring material from [ADR-0013](../adr/0013-secrets-provider-and-envelope-encryption.md)) is backed up separately in your KMS / offline sealed vault so `secrets` table envelopes remain decryptable after restore.

## 2. Restore on Clean Environment & Verify Audit Integrity

```bash
node deploy/scripts/backup-restore.mjs restore "$TARGET_DATABASE_URL" backups/elshad-<timestamp>.pgdump
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API_BASE_URL/api/v1/audit/verify"
```

1. Verifies the SHA-256 checksum sidecar before executing `pg_restore --clean --if-exists`.
2. Calls `GET /api/v1/audit/verify` to confirm hash-chained `audit_events` integrity (`valid: true`).

## 3. Offline / CI DR Drill

Run the deterministic DR verification drill executed in [db.test.ts](../../packages/db/src/db.test.ts):

```bash
node deploy/scripts/backup-restore.mjs --drill
```

Exports a seeded tenant bundle (`organizations`, `workspaces`, `secrets`, `budgets`, `killswitches`, `audit_events`), computes the canonical JSON SHA-256 manifest, restores into a fresh object, and validates both digest and audit hash chain.
