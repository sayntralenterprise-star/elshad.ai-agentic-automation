import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  GENESIS_AUDIT_HASH,
  buildMonthlyPartitionSql,
  canonicalJson,
  computeAuditHash,
  computeContextHash,
  planUpcomingPartitions,
  verifyAuditEventsChain,
  withTenantPgClient,
  type VerifiableAuditEvent,
} from './index.js';

describe('@elshad/db migrations, RLS, and audit hash chain [E0.1-3, M.6]', () => {
  it('enables and forces RLS on every tenant table containing org_id in S0.1 migrations', () => {
    const migrationsDir = join(__dirname, '..', 'migrations');
    const sql01 = readFileSync(join(migrationsDir, '0001_extensions_and_roles.sql'), 'utf8');
    const sql02 = readFileSync(join(migrationsDir, '0002_s01_core_schema.sql'), 'utf8');

    expect(sql01).toContain('CREATE EXTENSION IF NOT EXISTS citext');
    expect(sql01).toContain('CREATE ROLE platform_app');
    expect(sql01).toContain('NOBYPASSRLS');
    expect(sql01).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql01).toContain('FORCE ROW LEVEL SECURITY');

    // Parse all CREATE TABLE statements in 0002 and ensure every table with org_id enables RLS
    const tableBlocks = [...sql02.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\)\s*(?:PARTITION|;)/g)];
    const tenantTables = tableBlocks
      .filter(([, name, body]) => name !== 'organizations' && /\borg_id\b/.test(body!))
      .map(([, name]) => name!);

    expect(tenantTables).toContain('workspaces');
    expect(tenantTables).toContain('projects');
    expect(tenantTables).toContain('outbox');
    expect(tenantTables).toContain('audit_events');
    expect(tenantTables).toContain('api_keys');

    for (const tbl of tenantTables) {
      if (tbl === 'roles') {
        expect(sql02).toContain(`ALTER TABLE roles ENABLE ROW LEVEL SECURITY`);
        expect(sql02).toContain(`ALTER TABLE roles FORCE ROW LEVEL SECURITY`);
      } else {
        expect(sql02).toContain(`enable_tenant_rls('${tbl}')`);
      }
    }

    expect(sql02).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC');
    expect(sql02).toContain('audit_events_2026_11');

    const sql03 = readFileSync(join(migrationsDir, '0003_s02_run_core.sql'), 'utf8');
    const s02Tables = [
      'runs',
      'run_events',
      'run_steps',
      'checkpoints',
      'work_items',
      'timers',
      'effect_ledger',
    ];
    for (const tbl of s02Tables) {
      expect(sql03).toContain(`CREATE TABLE ${tbl}`);
      expect(sql03).toContain(`enable_tenant_rls('${tbl}')`);
    }
    expect(sql03).toContain('runs_2026_11');
    expect(sql03).toContain('runs_2027_02');
    expect(sql03).toContain('run_events_2026_11');
    expect(sql03).toContain('run_steps_2026_11');
    expect(sql03).toContain('work_items_serialize_uidx');
    expect(sql03).toContain('last_event_seq');

    const sql04 = readFileSync(join(migrationsDir, '0004_s03_first_agent.sql'), 'utf8');
    const s03Tables = [
      'tools',
      'tool_versions',
      'tool_grants',
      'model_provider_keys',
      'workspace_model_mappings',
      'usage_ledger',
    ];
    for (const tbl of s03Tables) {
      expect(sql04).toContain(`CREATE TABLE ${tbl}`);
      expect(sql04).toContain(`enable_tenant_rls('${tbl}')`);
    }
    expect(sql04).toContain('usage_ledger_2026_11');
    expect(sql04).toContain('usage_ledger_2027_02');
    expect(sql04).toContain('TO platform_app');

    const sql05 = readFileSync(join(migrationsDir, '0005_s04_workflows.sql'), 'utf8');
    const s04Tables = ['workflows', 'workflow_versions', 'triggers', 'trigger_events'];
    for (const tbl of s04Tables) {
      expect(sql05).toContain(`CREATE TABLE ${tbl}`);
      expect(sql05).toContain(`enable_tenant_rls('${tbl}')`);
    }
    expect(sql05).toContain('triggers_env_path_uidx');
    expect(sql05).toContain('TO platform_app');

    const sql06 = readFileSync(join(migrationsDir, '0006_s05_memory_and_kb.sql'), 'utf8');
    const s05Tables = [
      'memory_items',
      'sessions_conversation',
      'knowledge_bases',
      'kb_sources',
      'kb_documents',
      'kb_chunks',
    ];
    for (const tbl of s05Tables) {
      expect(sql06).toContain(`CREATE TABLE ${tbl}`);
      expect(sql06).toContain(`enable_tenant_rls('${tbl}')`);
    }
    expect(sql06).toContain('memory_embedding_1536_hnsw');
    expect(sql06).toContain('kb_chunks_embedding_1536_hnsw');
    expect(sql06).toContain('(embedding::vector(1536)) vector_cosine_ops');
    expect(sql06).toContain('TO platform_app');

    const sql07 = readFileSync(join(migrationsDir, '0007_s06_hardening.sql'), 'utf8');
    const s06Tables = ['secrets', 'budgets', 'killswitches'];
    for (const tbl of s06Tables) {
      expect(sql07).toContain(`CREATE TABLE ${tbl}`);
      expect(sql07).toContain(`enable_tenant_rls('${tbl}')`);
    }
    expect(sql07).toContain('TO platform_app');
  });

  it('plans monthly partitions for current + 3 months ahead [E0.2-1]', () => {
    const dec = buildMonthlyPartitionSql('runs', 2026, 12);
    expect(dec.partitionName).toBe('runs_2026_12');
    expect(dec.sql).toContain("FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z')");

    const planned = planUpcomingPartitions(
      ['runs', 'run_events', 'usage_ledger'],
      new Date('2026-11-18T00:00:00Z'),
      3,
    );
    expect(planned).toHaveLength(12);
    expect(planned.map((p) => p.partitionName)).toEqual([
      'runs_2026_11',
      'run_events_2026_11',
      'usage_ledger_2026_11',
      'runs_2026_12',
      'run_events_2026_12',
      'usage_ledger_2026_12',
      'runs_2027_01',
      'run_events_2027_01',
      'usage_ledger_2027_01',
      'runs_2027_02',
      'run_events_2027_02',
      'usage_ledger_2027_02',
    ]);
  });

  it('produces deterministic canonical JSON and detects audit tampering', () => {
    expect(canonicalJson({ b: 2, a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1},"b":2}');

    const events: VerifiableAuditEvent[] = [];
    let prev = GENESIS_AUDIT_HASH;
    for (let seq = 1; seq <= 3; seq++) {
      const ctxHash = computeContextHash({ ip: '127.0.0.1', seq });
      const base = {
        actor: { id: 'prn_1', type: 'user' },
        on_behalf_of: null,
        action: 'api_key.create',
        resource: { type: 'api_key', id: `key_${seq}` },
        decision: 'allow',
        policy_ids: null,
        context_hash: ctxHash,
        ts: `2026-11-18T12:00:0${seq}.000Z`,
        seq,
      };
      const hash = computeAuditHash(prev, base);
      events.push({ id: `aud_${seq}`, prev_hash: prev, hash, ...base });
      prev = hash;
    }

    expect(verifyAuditEventsChain(events)).toEqual({ valid: true, checkedCount: 3 });

    const tampered = structuredClone(events);
    tampered[1]!.action = 'org.delete';
    const result = verifyAuditEventsChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it('issues BEGIN, SET LOCAL app.org_id, and COMMIT/ROLLBACK in withTenantPgClient', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const mockClient = {
      query: vi.fn(async (sqlText: string, params?: unknown[]) => {
        queries.push({ sql: sqlText, params });
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn(async () => mockClient),
    } as unknown as Pool;

    await withTenantPgClient(mockPool, 'org_uuid_1', async () => 'ok');
    expect(queries.map((q) => q.sql)).toEqual([
      'BEGIN',
      "SELECT set_config('app.org_id', $1, true)",
      'COMMIT',
    ]);
    expect(queries[1]!.params).toEqual(['org_uuid_1']);

    queries.length = 0;
    await expect(
      withTenantPgClient(mockPool, 'org_uuid_2', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(queries.map((q) => q.sql)).toEqual([
      'BEGIN',
      "SELECT set_config('app.org_id', $1, true)",
      'ROLLBACK',
    ]);
  });

  it('executes backup/restore DR drill verifying SHA-256 manifest and audit chain [E0.6-4]', () => {
    const scriptPath = join(__dirname, '..', '..', '..', 'deploy', 'scripts', 'backup-restore.mjs');
    const stdout = execFileSync('node', [scriptPath, '--drill'], { encoding: 'utf8' });
    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      sha256: string;
      auditCheckedCount: number;
      counts: Record<string, number>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.sha256).toHaveLength(64);
    expect(parsed.auditCheckedCount).toBe(1);
    expect(parsed.counts['secrets']).toBe(1);
  });
});
