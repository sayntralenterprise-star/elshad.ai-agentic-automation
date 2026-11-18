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

export interface RunsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  environment_id: string;
  root_run_id: string;
  parent_run_id: string | null;
  subject_type: string;
  subject_version_id: string;
  status: string;
  failure_class: string | null;
  termination_reason: string | null;
  initiator_id: string;
  on_behalf_of_id: string | null;
  trigger: Record<string, unknown>;
  input_ref: string | null;
  output_ref: string | null;
  limits: Record<string, unknown>;
  usage: Record<string, unknown>;
  cost_micro_usd: number;
  wait: Record<string, unknown> | null;
  flags: Record<string, unknown>;
  labels: Record<string, unknown>;
  last_event_seq: number;
  engine_version: string;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
}

export interface RunEventsTable {
  run_id: string;
  seq: number;
  org_id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: Date;
}

export interface RunStepsTable {
  id: string;
  run_id: string;
  org_id: string;
  seq: number;
  type: string;
  agent_id: string | null;
  status: string;
  attempt: number;
  idempotency_key: string;
  summary: Record<string, unknown>;
  input_ref: string | null;
  output_ref: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_micro_usd: number;
  latency_ms: number | null;
  policy: Record<string, unknown> | null;
  provenance: string | null;
  error: Record<string, unknown> | null;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

export interface CheckpointsTable {
  run_id: string;
  seq: number;
  org_id: string;
  state_ref: string;
  size_bytes: number;
  milestone: boolean;
  created_at: Date;
}

export interface WorkItemsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  queue: string;
  priority: number;
  run_id: string;
  kind: string;
  payload: Record<string, unknown>;
  serialize_key: string | null;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  attempts: number;
  max_attempts: number;
  status: 'ready' | 'leased' | 'done' | 'dead';
  last_error: Record<string, unknown> | null;
  created_at: Date;
}

export interface TimersTable {
  id: string;
  org_id: string;
  run_id: string;
  kind: string;
  fire_at: Date;
  payload: Record<string, unknown>;
  fired_at: Date | null;
}

export interface EffectLedgerTable {
  org_id: string;
  idempotency_key: string;
  run_id: string;
  step_seq: number;
  attempt_group: number;
  status: 'succeeded' | 'failed';
  result_ref: string | null;
  result_json: Record<string, unknown> | null;
  expires_at: Date;
  created_at: Date;
}

export interface AgentsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string | null;
  owner_id: string;
  status: 'draft' | 'active' | 'deprecated' | 'archived';
  risk_tier: string;
  identity_principal_id: string | null;
  current_version_id: string | null;
  labels: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AgentVersionsTable {
  id: string;
  org_id: string;
  agent_id: string;
  semver: string;
  state: 'draft' | 'published' | 'retired';
  definition: Record<string, unknown>;
  definition_hash: string;
  message: string | null;
  eval_status: string;
  created_by: string;
  created_at: Date;
}

export interface ToolsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  side_effect_class: 'read' | 'write' | 'destructive' | 'external_comms';
  is_builtin: boolean;
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ToolVersionsTable {
  id: string;
  org_id: string;
  tool_id: string;
  semver: string;
  state: 'draft' | 'published' | 'retired';
  contract: Record<string, unknown>;
  contract_hash: string;
  created_by: string | null;
  created_at: Date;
}

export interface ToolGrantsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  agent_id: string;
  tool_id: string;
  scope: Record<string, unknown>;
  approval: 'never' | 'auto' | 'always';
  created_by: string | null;
  created_at: Date;
}

export interface ModelProviderKeysTable {
  id: string;
  org_id: string;
  workspace_id: string;
  provider: string;
  label: string;
  secret_ref: string;
  base_url: string | null;
  status: 'active' | 'disabled';
  created_by: string | null;
  created_at: Date;
}

export interface WorkspaceModelMappingsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  tier: 'fast' | 'standard' | 'reasoning' | 'embedding';
  primary_provider: string;
  primary_model: string;
  fallback_chain: Array<Record<string, unknown>>;
  routing_rules: Array<Record<string, unknown>>;
  updated_at: Date;
}

export interface UsageLedgerTable {
  id: string;
  org_id: string;
  workspace_id: string;
  project_id: string;
  environment_id: string;
  run_id: string;
  step_seq: number | null;
  principal_id: string | null;
  category: 'llm_tokens' | 'tool_call' | 'sandbox_ms' | 'storage';
  provider: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  quantity: number;
  unit: string;
  cost_micro_usd: number;
  ts: Date;
}

export interface WorkflowsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string | null;
  owner_id: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  current_version_id: string | null;
  labels: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface WorkflowVersionsTable {
  id: string;
  org_id: string;
  workflow_id: string;
  semver: string;
  state: 'draft' | 'published' | 'retired';
  schema_version: number;
  graph: Record<string, unknown>;
  graph_hash: string;
  yaml_source: string | null;
  message: string | null;
  created_by: string;
  created_at: Date;
}

export interface TriggersTable {
  id: string;
  org_id: string;
  workspace_id: string;
  environment_id: string;
  workflow_id: string;
  workflow_version_id: string;
  node_id: string;
  kind: 'webhook' | 'schedule' | 'manual';
  external_id: string;
  path: string | null;
  config: Record<string, unknown>;
  active: boolean;
  test_mode: boolean;
  last_fired_at: Date | null;
  next_fire_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TriggerEventsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  trigger_id: string;
  run_id: string | null;
  dedup_key: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  status: 'accepted' | 'replayed' | 'rejected' | 'captured_test';
  received_at: Date;
}

export interface MemoryItemsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  project_id: string | null;
  scope: 'run' | 'session' | 'user' | 'agent' | 'project' | 'org';
  scope_id: string | null;
  subject_id: string | null;
  kind: 'episodic' | 'semantic' | 'procedural';
  content: string;
  content_hash: string;
  embedding_dim: number;
  embedding: string | null;
  metadata: Record<string, unknown>;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted' | 'pii';
  provenance: Record<string, unknown>;
  importance: number;
  contradicts_id: string | null;
  ttl_at: Date | null;
  pinned: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface SessionsConversationTable {
  id: string;
  org_id: string;
  workspace_id: string;
  project_id: string | null;
  agent_id: string | null;
  subject_id: string | null;
  title: string | null;
  messages: unknown[];
  rolling_summary: string;
  preserved_identifiers: string[];
  token_count: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface KnowledgeBasesTable {
  id: string;
  org_id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string | null;
  embedding_model: string;
  embedding_dim: number;
  chunk_target_tokens: number;
  chunk_max_tokens: number;
  chunk_overlap_tokens: number;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted' | 'pii';
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface KbSourcesTable {
  id: string;
  org_id: string;
  workspace_id: string;
  kb_id: string;
  name: string;
  kind: 'file' | 'url' | 'manual';
  uri: string | null;
  mime_type: string;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  access_principals: string[];
  last_synced_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface KbDocumentsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  kb_id: string;
  source_id: string;
  external_key: string;
  title: string;
  mime_type: string;
  content_hash: string;
  byte_size: number;
  chunk_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface KbChunksTable {
  id: string;
  org_id: string;
  workspace_id: string;
  kb_id: string;
  source_id: string;
  doc_id: string;
  chunk_index: number;
  section_path: string[];
  page: number | null;
  char_start: number;
  char_end: number;
  token_count: number;
  content: string;
  content_hash: string;
  embedding_dim: number;
  embedding: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  deleted_at: Date | null;
}

export interface SecretsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  environment_id: string | null;
  name: string;
  secret_ref: string;
  provider: 'db' | 'vault' | 'env';
  key_version: number;
  wrapped_dek: Uint8Array;
  dek_iv: Uint8Array;
  dek_tag: Uint8Array;
  ciphertext: Uint8Array;
  data_iv: Uint8Array;
  data_tag: Uint8Array;
  purpose_allowlist: string[];
  last_rotated_at: Date | null;
  expires_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface BudgetsTable {
  id: string;
  org_id: string;
  workspace_id: string | null;
  project_id: string | null;
  agent_id: string | null;
  scope_type: 'org' | 'workspace' | 'project' | 'agent';
  scope_id: string;
  period: 'daily' | 'weekly' | 'monthly';
  soft_limit_micro_usd: number | null;
  hard_limit_micro_usd: number | null;
  soft_limit_tokens: number | null;
  hard_limit_tokens: number | null;
  spent_micro_usd: number;
  spent_tokens: number;
  action_on_breach: 'downgrade_model' | 'require_approval' | 'stop';
  alert_emitted_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface KillswitchesTable {
  id: string;
  org_id: string;
  workspace_id: string | null;
  scope_type: 'global' | 'workspace' | 'agent' | 'tool';
  scope_id: string;
  active: boolean;
  reason: string;
  activated_by: string;
  activated_at: Date;
  deactivated_by: string | null;
  deactivated_at: Date | null;
}

export interface AgentIdentitiesTable {
  id: string;
  org_id: string;
  workspace_id: string;
  agent_id: string;
  principal_id: string;
  environment_id: string;
  display_name: string;
  allowed_tool_ids: string[];
  token_ttl_seconds: number;
  status: 'active' | 'disabled';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface PoliciesTable {
  id: string;
  org_id: string;
  workspace_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  point:
    | 'tool_call'
    | 'data_access'
    | 'memory_read'
    | 'memory_write'
    | 'model_select'
    | 'egress'
    | 'promotion'
    | 'publish';
  mode: 'audit_only' | 'enforce';
  active_version_id: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface PolicyVersionsTable {
  id: string;
  org_id: string;
  policy_id: string;
  version: number;
  effect: 'allow' | 'deny' | 'require_approval';
  rules_json: Record<string, unknown>;
  rego_source: string;
  created_by: string;
  created_at: Date;
}

export interface PolicyDecisionsTable {
  id: string;
  org_id: string;
  workspace_id: string | null;
  run_id: string | null;
  policy_id: string | null;
  point: string;
  effect: string;
  matched_policy_ids: string[];
  reason: string;
  input_summary: Record<string, unknown>;
  created_at: Date;
}

export interface ApprovalsTable {
  id: string;
  org_id: string;
  workspace_id: string;
  run_id: string;
  step_id: string;
  type: 'tool_call' | 'promotion' | 'write_grant' | 'policy_enforce' | 'workflow_gate' | 'custom';
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'info_requested';
  payload: Record<string, unknown>;
  requested_from: unknown[];
  required_decisions: number;
  separation_of_duties: boolean;
  initiated_by: string;
  delegated_to: string | null;
  expires_at: Date | null;
  on_timeout: 'reject' | 'escalate' | 'approve';
  auto_approve_on_timeout: boolean;
  escalation: unknown[];
  escalated_at: Date | null;
  snoozed_until: Date | null;
  info_request_question: string | null;
  info_request_answer: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface ApprovalDecisionsTable {
  id: string;
  org_id: string;
  approval_id: string;
  decided_by: string;
  decision:
    | 'approve'
    | 'reject'
    | 'approve_with_edit'
    | 'request_info'
    | 'provide_info'
    | 'delegate';
  reason: string | null;
  edited_payload: Record<string, unknown> | null;
  channel: 'console' | 'slack' | 'email' | 'api';
  created_at: Date;
}

export interface NotificationsTable {
  id: string;
  org_id: string;
  workspace_id: string | null;
  approval_id: string | null;
  channel: 'slack' | 'email' | 'in_app' | 'webhook';
  recipient: string;
  subject: string;
  body: string;
  action_links: Record<string, unknown>;
  status: 'pending' | 'sent' | 'failed';
  created_at: Date;
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
  agents: AgentsTable;
  agent_versions: AgentVersionsTable;
  runs: RunsTable;
  run_events: RunEventsTable;
  run_steps: RunStepsTable;
  checkpoints: CheckpointsTable;
  work_items: WorkItemsTable;
  timers: TimersTable;
  effect_ledger: EffectLedgerTable;
  tools: ToolsTable;
  tool_versions: ToolVersionsTable;
  tool_grants: ToolGrantsTable;
  model_provider_keys: ModelProviderKeysTable;
  workspace_model_mappings: WorkspaceModelMappingsTable;
  usage_ledger: UsageLedgerTable;
  workflows: WorkflowsTable;
  workflow_versions: WorkflowVersionsTable;
  triggers: TriggersTable;
  trigger_events: TriggerEventsTable;
  memory_items: MemoryItemsTable;
  sessions_conversation: SessionsConversationTable;
  knowledge_bases: KnowledgeBasesTable;
  kb_sources: KbSourcesTable;
  kb_documents: KbDocumentsTable;
  kb_chunks: KbChunksTable;
  secrets: SecretsTable;
  budgets: BudgetsTable;
  killswitches: KillswitchesTable;
  agent_identities: AgentIdentitiesTable;
  policies: PoliciesTable;
  policy_versions: PolicyVersionsTable;
  policy_decisions: PolicyDecisionsTable;
  approvals: ApprovalsTable;
  approval_decisions: ApprovalDecisionsTable;
  notifications: NotificationsTable;
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

export type PartitionedTable =
  | 'audit_events'
  | 'runs'
  | 'run_events'
  | 'run_steps'
  | 'usage_ledger'
  | 'policy_decisions';

export const DEFAULT_PARTITIONED_TABLES: readonly PartitionedTable[] = [
  'audit_events',
  'runs',
  'run_events',
  'run_steps',
  'usage_ledger',
  'policy_decisions',
];

const SAFE_TABLE_IDENT = /^[a-z_][a-z0-9_]*$/;

export function buildMonthlyPartitionSql(
  table: string,
  year: number,
  month1Based: number,
): { partitionName: string; sql: string } {
  if (!SAFE_TABLE_IDENT.test(table)) {
    throw new Error(`Invalid partitioned table name: ${table}`);
  }
  if (!Number.isInteger(month1Based) || month1Based < 1 || month1Based > 12) {
    throw new Error(`Month must be 1..12, got ${month1Based}`);
  }
  const mm = String(month1Based).padStart(2, '0');
  const start = `${year}-${mm}-01 00:00:00Z`;
  const nextYear = month1Based === 12 ? year + 1 : year;
  const nextMonth = month1Based === 12 ? 1 : month1Based + 1;
  const nextMm = String(nextMonth).padStart(2, '0');
  const end = `${nextYear}-${nextMm}-01 00:00:00Z`;
  const partitionName = `${table}_${year}_${mm}`;
  const statement = `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF ${table} FOR VALUES FROM ('${start}') TO ('${end}');`;
  return { partitionName, sql: statement };
}

/**
 * Generates DDL statements for the current month + `monthsAhead` months (default 3 per E0.2-1).
 */
export function planUpcomingPartitions(
  tables: readonly string[] = DEFAULT_PARTITIONED_TABLES,
  fromDate: Date = new Date(),
  monthsAhead = 3,
): Array<{ table: string; partitionName: string; sql: string }> {
  const results: Array<{ table: string; partitionName: string; sql: string }> = [];
  const startYear = fromDate.getUTCFullYear();
  const startMonth = fromDate.getUTCMonth(); // 0-based

  for (let offset = 0; offset <= monthsAhead; offset++) {
    const d = new Date(Date.UTC(startYear, startMonth + offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    for (const table of tables) {
      const built = buildMonthlyPartitionSql(table, y, m);
      results.push({ table, ...built });
    }
  }
  return results;
}

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvCell(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const safe = CSV_FORMULA_PREFIX.test(str) ? `'${str}` : str;
  if (safe.includes('"') || safe.includes(',') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

/**
 * Formats verifiable audit events into RFC 4180 CSV with spreadsheet formula-injection neutralization (FR-GOV-18).
 */
export function formatAuditEventsCsv(events: readonly VerifiableAuditEvent[]): string {
  const header = [
    'seq',
    'ts',
    'id',
    'action',
    'decision',
    'actor_id',
    'actor_type',
    'on_behalf_of_id',
    'resource_type',
    'resource_id',
    'policy_ids',
    'context_hash',
    'prev_hash',
    'hash',
  ].join(',');

  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const rows = sorted.map((evt) => {
    const cells = [
      evt.seq,
      evt.ts,
      evt.id,
      evt.action,
      evt.decision ?? '',
      evt.actor['id'] ?? '',
      evt.actor['type'] ?? '',
      evt.on_behalf_of?.['id'] ?? '',
      evt.resource['type'] ?? '',
      evt.resource['id'] ?? '',
      evt.policy_ids ? evt.policy_ids.join(';') : '',
      evt.context_hash,
      evt.prev_hash,
      evt.hash,
    ];
    return cells.map(escapeCsvCell).join(',');
  });

  return [header, ...rows].join('\r\n');
}
