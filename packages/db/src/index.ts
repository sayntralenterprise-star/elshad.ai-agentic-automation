import { createHash } from 'node:crypto';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool, type PoolClient } from 'pg';
import type { TenantContext } from '@elshad/domain';

export interface OrganizationsTable {
  id: string;
  slug: string;
  name: string;
  region: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface WorkspacesTable {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ProjectsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string | null;
  max_autonomy_level: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface EnvironmentsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  kind: 'dev' | 'staging' | 'prod';
  name: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface PrincipalsTable {
  id: string;
  org_id: string;
  type: 'user' | 'group' | 'service_account' | 'agent';
  external_id: string | null;
  email: string | null;
  display_name: string;
  attrs: Record<string, unknown>;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RolesTable {
  id: string;
  org_id: string | null;
  name: string;
  is_system: boolean;
  permissions: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface RoleBindingsTable {
  id: string;
  org_id: string;
  principal_id: string;
  role_id: string;
  scope_type: 'org' | 'workspace' | 'project' | 'resource';
  scope_id: string;
  created_by: string | null;
  created_at: Date;
}

export interface LocalCredentialsTable {
  principal_id: string;
  org_id: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  updated_at: Date;
}

export interface SessionsTable {
  id: string;
  org_id: string;
  principal_id: string;
  refresh_token_hash: string;
  csrf_token: string;
  expires_at: Date;
  idle_expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  last_active_at: Date;
}

export interface ApiKeysTable {
  id: string;
  org_id: string;
  workspace_id: string | null;
  principal_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface IdempotencyKeysTable {
  org_id: string;
  principal_id: string;
  key: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  response_ref: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface OutboxTable {
  id: string;
  org_id: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  traceparent: string | null;
  created_at: Date;
  published_at: Date | null;
  attempts: number;
}

export interface AuditEventsTable {
  id: string;
  org_id: string;
  seq: number;
  ts: Date;
  actor: Record<string, unknown>;
  on_behalf_of: Record<string, unknown> | null;
  action: string;
  resource: Record<string, unknown>;
  decision: string | null;
  policy_ids: string[] | null;
  context: Record<string, unknown>;
  context_hash: string;
  prev_hash: string;
  hash: string;
}

export interface Database {
  organizations: OrganizationsTable;
  workspaces: WorkspacesTable;
  projects: ProjectsTable;
  environments: EnvironmentsTable;
  principals: PrincipalsTable;
  roles: RolesTable;
  role_bindings: RoleBindingsTable;
  local_credentials: LocalCredentialsTable;
  sessions: SessionsTable;
  api_keys: ApiKeysTable;
  idempotency_keys: IdempotencyKeysTable;
  outbox: OutboxTable;
  audit_events: AuditEventsTable;
}

export function createPgPool(connectionString: string, max = 40): Pool {
  return new Pool({ connectionString, max });
}

export function createKysely(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

/**
 * Runs a function inside a Postgres transaction with transaction-local RLS context (SET LOCAL),
 * making it safe behind PgBouncer transaction pooling (DOC-Q-022).
 */
export async function withTenantTx<T>(
  db: Kysely<Database>,
  ctx: Pick<TenantContext, 'orgId' | 'workspaceId' | 'principal'>,
  fn: (tx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT set_config('app.org_id', ${ctx.orgId}, true)`.execute(tx);
    await sql`SELECT set_config('app.workspace_id', ${ctx.workspaceId ?? ''}, true)`.execute(tx);
    await sql`SELECT set_config('app.principal_id', ${ctx.principal.id}, true)`.execute(tx);
    return fn(tx);
  });
}

/**
 * Low-level Pool variant of withTenantTx for migration/health tooling.
 */
export async function withTenantPgClient<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function withSystemTx<T>(
  db: Kysely<Database>,
  _reason: string,
  fn: (tx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(fn);
}

export const GENESIS_AUDIT_HASH = '0'.repeat(64);

function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v !== undefined) {
      sorted[key] = sortKeysDeep(v);
    }
  }
  return sorted;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export interface AuditHashInput {
  actor: Record<string, unknown>;
  on_behalf_of: Record<string, unknown> | null;
  action: string;
  resource: Record<string, unknown>;
  decision: string | null;
  policy_ids: string[] | null;
  context_hash: string;
  ts: string;
  seq: number;
}

export function computeContextHash(context: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(context)).digest('hex');
}

/**
 * Hash formula per PRD Appendix M.6:
 * hash = SHA256(prev_hash || canonical_json(actor, on_behalf_of, action, resource, decision, policy_ids, context_hash, ts, seq))
 */
export function computeAuditHash(prevHash: string, input: AuditHashInput): string {
  const payload = canonicalJson({
    actor: input.actor,
    on_behalf_of: input.on_behalf_of,
    action: input.action,
    resource: input.resource,
    decision: input.decision,
    policy_ids: input.policy_ids,
    context_hash: input.context_hash,
    ts: input.ts,
    seq: input.seq,
  });
  return createHash('sha256')
    .update(prevHash + payload, 'utf8')
    .digest('hex');
}

export interface VerifiableAuditEvent extends AuditHashInput {
  id: string;
  prev_hash: string;
  hash: string;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  checkedCount: number;
  brokenAtSeq?: number;
  reason?: string;
}

export function verifyAuditEventsChain(
  events: readonly VerifiableAuditEvent[],
): AuditChainVerificationResult {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let expectedPrev = GENESIS_AUDIT_HASH;
  let expectedSeq = 1;

  for (const evt of sorted) {
    if (evt.seq !== expectedSeq) {
      return {
        valid: false,
        checkedCount: sorted.length,
        brokenAtSeq: evt.seq,
        reason: `Expected seq ${expectedSeq} but found ${evt.seq}`,
      };
    }
    if (evt.prev_hash !== expectedPrev) {
      return {
        valid: false,
        checkedCount: sorted.length,
        brokenAtSeq: evt.seq,
        reason: `prev_hash mismatch at seq ${evt.seq}`,
      };
    }
    const recomputed = computeAuditHash(evt.prev_hash, evt);
    if (recomputed !== evt.hash) {
      return {
        valid: false,
        checkedCount: sorted.length,
        brokenAtSeq: evt.seq,
        reason: `hash mismatch at seq ${evt.seq}`,
      };
    }
    expectedPrev = evt.hash;
    expectedSeq += 1;
  }

  return { valid: true, checkedCount: sorted.length };
}
