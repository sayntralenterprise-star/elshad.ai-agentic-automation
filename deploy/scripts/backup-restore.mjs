import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GENESIS_AUDIT_HASH = '0'.repeat(64);

/**
 * Deterministic canonical JSON serializer matching @elshad/db for backup manifests and audit verification.
 */
export function canonicalBackupJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalBackupJson(v)).join(',')}]`;
  }
  const obj = value;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalBackupJson(obj[k])}`).join(',')}}`;
}

function verifyAuditChainStandalone(events) {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let expectedPrev = GENESIS_AUDIT_HASH;
  let expectedSeq = 1;
  for (const evt of sorted) {
    if (evt.seq !== expectedSeq || evt.prev_hash !== expectedPrev) {
      return { valid: false, checkedCount: sorted.length, brokenAtSeq: evt.seq };
    }
    expectedPrev = evt.hash;
    expectedSeq += 1;
  }
  return { valid: true, checkedCount: sorted.length };
}

/**
 * Exports a versioned backup bundle with SHA-256 content digest across tables and audit events (E0.6-4).
 */
export function createBackupBundle(snapshot, opts = {}) {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const payload = {
    schema_version: 7,
    created_at: createdAt,
    organizations: snapshot.organizations ?? [],
    workspaces: snapshot.workspaces ?? [],
    secrets: snapshot.secrets ?? [],
    budgets: snapshot.budgets ?? [],
    killswitches: snapshot.killswitches ?? [],
    audit_events: snapshot.audit_events ?? [],
  };
  const digest = createHash('sha256').update(canonicalBackupJson(payload), 'utf8').digest('hex');
  return {
    manifest: {
      format: 'elshad-backup-v1',
      created_at: createdAt,
      sha256: digest,
      counts: {
        organizations: payload.organizations.length,
        workspaces: payload.workspaces.length,
        secrets: payload.secrets.length,
        budgets: payload.budgets.length,
        killswitches: payload.killswitches.length,
        audit_events: payload.audit_events.length,
      },
    },
    payload,
  };
}

/**
 * Verifies backup SHA-256 integrity, checks audit hash-chain continuity, and restores into a clean target store (E0.6-4).
 */
export function restoreAndVerifyBackupBundle(bundle) {
  if (!bundle || !bundle.manifest || !bundle.payload) {
    throw new Error('Malformed backup bundle.');
  }
  const recomputed = createHash('sha256')
    .update(canonicalBackupJson(bundle.payload), 'utf8')
    .digest('hex');
  if (recomputed !== bundle.manifest.sha256) {
    throw new Error(
      `Backup digest mismatch: expected ${bundle.manifest.sha256}, got ${recomputed}`,
    );
  }

  const auditResult = verifyAuditChainStandalone(bundle.payload.audit_events ?? []);
  if (!auditResult.valid) {
    throw new Error(`Audit hash chain failed during DR verify at seq ${auditResult.brokenAtSeq}`);
  }

  const restored = structuredClone(bundle.payload);
  return {
    restored,
    verifiedDigest: recomputed,
    auditCheckedCount: auditResult.checkedCount,
  };
}

export function runPgBackup(pgUrl, outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${outFile}`, pgUrl], {
    stdio: 'inherit',
  });
  const bytes = readFileSync(outFile);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(`${outFile}.sha256`, `${sha256}  ${outFile}\n`, 'utf8');
  return { outFile, sha256, bytes: bytes.length };
}

export function runPgRestore(pgUrl, inFile) {
  const expectedLine = readFileSync(`${inFile}.sha256`, 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(inFile)).digest('hex');
  if (expectedLine && expectedLine !== actual) {
    throw new Error(`SHA-256 verification failed for ${inFile}`);
  }
  execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', pgUrl, inFile], {
    stdio: 'inherit',
  });
  return { inFile, sha256: actual, restored: true };
}

export function runDrDrill() {
  const drillDir = mkdtempSync(join(tmpdir(), 'elshad-dr-drill-'));
  const bundlePath = join(drillDir, 'snapshot.json');
  try {
    const sample = {
      organizations: [{ id: 'org_drill_1', slug: 'drill-org' }],
      workspaces: [{ id: 'ws_drill_1', org_id: 'org_drill_1', slug: 'default' }],
      secrets: [
        {
          id: 'sec_drill_1',
          org_id: 'org_drill_1',
          name: 'drill_api_key',
          key_version: 1,
          ciphertext_b64: 'ZW5jcnlwdGVk',
        },
      ],
      budgets: [{ id: 'bud_drill_1', org_id: 'org_drill_1', hard_limit_micro_usd: 500000 }],
      killswitches: [{ id: 'ksw_drill_1', org_id: 'org_drill_1', active: false }],
      audit_events: [
        {
          id: 'aud_1',
          seq: 1,
          prev_hash: GENESIS_AUDIT_HASH,
          hash: 'a'.repeat(64),
          action: 'secret.put',
        },
      ],
    };
    const bundle = createBackupBundle(sample);
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
    const loaded = JSON.parse(readFileSync(bundlePath, 'utf8'));
    const verified = restoreAndVerifyBackupBundle(loaded);
    return {
      ok: true,
      sha256: verified.verifiedDigest,
      auditCheckedCount: verified.auditCheckedCount,
      counts: loaded.manifest.counts,
    };
  } finally {
    rmSync(drillDir, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--drill')) {
    const res = runDrDrill();
    console.log(JSON.stringify(res));
  } else if (args[0] === 'backup' && args[1] && args[2]) {
    console.log(JSON.stringify(runPgBackup(args[1], args[2])));
  } else if (args[0] === 'restore' && args[1] && args[2]) {
    console.log(JSON.stringify(runPgRestore(args[1], args[2])));
  } else {
    console.error('Usage: backup-restore.mjs [--drill | backup <pgUrl> <outFile> | restore <pgUrl> <inFile>]');
    process.exit(1);
  }
}
