export type Brand<T, B extends string> = T & { readonly __brand: B };

export type OrgId = Brand<string, 'OrgId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type EnvironmentId = Brand<string, 'EnvironmentId'>;
export type PrincipalId = Brand<string, 'PrincipalId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type AgentVersionId = Brand<string, 'AgentVersionId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type WorkflowVersionId = Brand<string, 'WorkflowVersionId'>;
export type RunId = Brand<string, 'RunId'>;
export type StepId = Brand<string, 'StepId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ToolVersionId = Brand<string, 'ToolVersionId'>;
export type ConnectionId = Brand<string, 'ConnectionId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type KbId = Brand<string, 'KbId'>;
export type PolicyId = Brand<string, 'PolicyId'>;
export type BudgetId = Brand<string, 'BudgetId'>;
export type DatasetId = Brand<string, 'DatasetId'>;
export type TestCaseId = Brand<string, 'TestCaseId'>;
export type GraderId = Brand<string, 'GraderId'>;
export type ExperimentId = Brand<string, 'ExperimentId'>;
export type AuditId = Brand<string, 'AuditId'>;
export type WebhookId = Brand<string, 'WebhookId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
export type EventId = Brand<string, 'EventId'>;
export type RequestId = Brand<string, 'RequestId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type TriggerId = Brand<string, 'TriggerId'>;
export type DeploymentId = Brand<string, 'DeploymentId'>;
export type PromotionId = Brand<string, 'PromotionId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type RoleBindingId = Brand<string, 'RoleBindingId'>;

export const ExternalPrefix = {
  org: 'org_',
  workspace: 'ws_',
  project: 'prj_',
  environment: 'env_',
  principal: 'prn_',
  agent: 'agt_',
  agentVersion: 'agv_',
  workflow: 'wf_',
  workflowVersion: 'wfv_',
  run: 'run_',
  step: 'stp_',
  approval: 'apr_',
  tool: 'tool_',
  toolVersion: 'tlv_',
  connection: 'conn_',
  memory: 'mem_',
  kb: 'kb_',
  policy: 'pol_',
  budget: 'bud_',
  dataset: 'ds_',
  testCase: 'tc_',
  grader: 'grd_',
  experiment: 'exp_',
  audit: 'aud_',
  webhook: 'whk_',
  apiKey: 'key_',
  event: 'evt_',
  request: 'req_',
  session: 'ses_',
  trigger: 'trg_',
  deployment: 'dep_',
  promotion: 'prm_',
  role: 'rol_',
  roleBinding: 'rbi_',
} as const;

export type EntityKind = keyof typeof ExternalPrefix;
export type ExternalIdPrefix = (typeof ExternalPrefix)[EntityKind];

export interface IdGen {
  uuidv7(nowMs?: number): string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const CROCKFORD_MAP = new Map<string, number>(
  CROCKFORD.split('').map((ch, idx) => [ch, idx]),
);

/**
 * Generates an RFC 9562 UUIDv7 string using millisecond timestamp + CSPRNG bytes.
 */
export function generateUuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const ts = BigInt(Math.max(0, Math.floor(nowMs)));

  // 48-bit big-endian unix timestamp in milliseconds
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // Version 7 (0111)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // Variant RFC 4122/9562 (10xx)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class SystemIdGen implements IdGen {
  uuidv7(nowMs?: number): string {
    return generateUuidv7(nowMs);
  }
}

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Converts an internal UUIDv7 to a compact, URL-safe, lexicographically sortable prefixed ID (D21).
 */
export function toExternalId(kind: EntityKind, uuid: string): string {
  if (!isValidUuid(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  const hex = uuid.replace(/-/g, '').toLowerCase();
  const value = BigInt(`0x${hex}`);
  // Encode 128-bit integer into 26 Crockford base32 characters (26 * 5 = 130 bits)
  const chars = new Array<string>(26);
  let remaining = value;
  for (let i = 25; i >= 0; i--) {
    chars[i] = CROCKFORD[Number(remaining & 31n)]!;
    remaining >>= 5n;
  }
  return `${ExternalPrefix[kind]}${chars.join('')}`;
}

/**
 * Decodes a prefixed external ID back to canonical lowercase UUID.
 */
export function fromExternalId(kind: EntityKind, externalId: string): string {
  const prefix = ExternalPrefix[kind];
  if (!externalId.startsWith(prefix)) {
    throw new Error(`Expected prefix ${prefix} on external ID ${externalId}`);
  }
  const encoded = externalId.slice(prefix.length).toLowerCase();
  if (encoded.length !== 26) {
    throw new Error(`Invalid external ID length for ${externalId}`);
  }
  let value = 0n;
  for (const ch of encoded) {
    const normalized = ch === 'i' || ch === 'l' ? '1' : ch === 'o' ? '0' : ch;
    const digit = CROCKFORD_MAP.get(normalized);
    if (digit === undefined) {
      throw new Error(`Invalid character '${ch}' in external ID ${externalId}`);
    }
    value = (value << 5n) | BigInt(digit);
  }
  if (value >> 128n !== 0n) {
    throw new Error(`External ID overflow: ${externalId}`);
  }
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Accepts either a raw UUID or a prefixed external ID of the expected entity kind, returning the UUID.
 */
export function resolveEntityUuid(kind: EntityKind, idOrExternal: string): string {
  if (isValidUuid(idOrExternal)) {
    return idOrExternal.toLowerCase();
  }
  return fromExternalId(kind, idOrExternal);
}
