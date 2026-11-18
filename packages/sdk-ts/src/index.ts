import { PlatformError, type ErrorCode, type RunStatus } from '@elshad/domain';

export interface WorkspaceDto {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  orgId: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  maxAutonomyLevel: string;
  createdAt: string;
}

export interface EnvironmentDto {
  id: string;
  workspaceId: string;
  kind: 'dev' | 'staging' | 'prod';
  name: string;
}

export interface PrincipalDto {
  id: string;
  orgId: string;
  type: 'user' | 'group' | 'service_account' | 'agent';
  email: string | null;
  displayName: string;
}

export interface RoleBindingDto {
  id: string;
  principalId: string;
  roleId: string;
  roleName: string;
  scopeType: 'org' | 'workspace' | 'project' | 'resource';
  scopeId: string;
  createdAt: string;
}

export interface MeDto {
  principal: PrincipalDto;
  orgId: string;
  orgSlug: string;
  orgName: string;
  bindings: RoleBindingDto[];
  workspaces: WorkspaceDto[];
}

export interface CapabilitiesDto {
  edition: 'community' | 'enterprise';
  featureFlags: string[];
  modules: string[];
}

export interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  workspaceId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  secret: string;
}

export interface AuditEventDto {
  id: string;
  seq: number;
  ts: string;
  actor: Record<string, unknown>;
  action: string;
  resource: Record<string, unknown>;
  decision: string | null;
  hash: string;
  prevHash: string;
}

export interface RoleDto {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface RunDto {
  id: string;
  orgId: string;
  workspaceId: string;
  environmentId: string;
  rootRunId: string;
  parentRunId: string | null;
  subjectType: string;
  subjectVersionId: string;
  status: RunStatus;
  failureClass: string | null;
  terminationReason: string | null;
  initiatorId: string;
  input: unknown;
  output: unknown;
  usage: {
    steps: number;
    tokensIn: number;
    tokensOut: number;
    toolCalls: number;
  };
  costMicroUsd: number;
  labels: Record<string, string>;
  lastEventSeq: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface RunStepDto {
  id: string;
  runId: string;
  seq: number;
  type: string;
  status: string;
  attempt: number;
  idempotencyKey: string;
  summary: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  costMicroUsd: number;
  latencyMs: number;
  startedAt: string;
  endedAt: string;
}

export interface RunEventDto {
  runId: string;
  seq: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface DlqItemDto {
  id: string;
  runId: string;
  workspaceId: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
  lastError: Record<string, unknown> | null;
  createdAt: string;
}

export interface ModelCapabilityDto {
  id: string;
  provider: string;
  displayName: string;
  tier: 'fast' | 'standard' | 'reasoning' | 'embedding';
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  pricingPerMillion: {
    inputMicroUsd: number;
    outputMicroUsd: number;
    cachedInputMicroUsd: number;
  };
  status: 'active' | 'deprecated';
}

export interface ToolContractDto {
  name: string;
  version: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sideEffectClass: 'read' | 'write' | 'destructive' | 'external_comms';
  idempotent: boolean;
  requiredPermissions: string[];
  dataClassificationTouched: string[];
  timeoutMs: number;
  implementation: 'builtin' | 'sandbox_js' | 'sandbox_python' | 'http';
}

export interface LethalTrifectaReportDto {
  detected: boolean;
  hasPrivateData: boolean;
  hasUntrustedInput: boolean;
  hasExternalComms: boolean;
  reasons: string[];
}

export interface AgentVersionDto {
  id: string;
  agentId: string;
  semver: string;
  state: 'draft' | 'published' | 'retired';
  definition: Record<string, unknown>;
  definitionHash: string;
  message: string | null;
  lethalTrifecta: LethalTrifectaReportDto;
  createdBy: string;
  createdAt: string;
}

export interface AgentDto {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'deprecated' | 'archived';
  currentVersionId: string | null;
  draftVersion: AgentVersionDto | null;
  publishedVersion: AgentVersionDto | null;
  versions: AgentVersionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentDiffDto {
  fromVersion: string;
  toVersion: string;
  breaking: boolean;
  changes: Array<{
    path: string;
    kind: 'added' | 'removed' | 'changed';
    before?: unknown;
    after?: unknown;
  }>;
}

export interface UsageLedgerEntryDto {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  environmentId: string;
  runId: string;
  stepSeq: number;
  principalId: string;
  category: 'llm_tokens' | 'tool_call' | 'sandbox_ms' | 'storage';
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  quantity: number;
  unit: string;
  costMicroUsd: number;
  ts: string;
}

export interface WorkflowNodeDto {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  onError?: {
    mode: 'fail' | 'continue' | 'retry' | 'route';
    retry?: { max: number; backoff_ms: number };
  };
}

export interface WorkflowEdgeDto {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface WorkflowGraphDto {
  schema_version: 1;
  settings: {
    max_concurrency: number;
    queue: string;
    timeout_ms: number;
    error_workflow?: string;
    serialize_by?: string;
  };
  nodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
  pinned_data: Record<string, unknown[]>;
  notes: Array<{ id: string; text: string; position?: { x: number; y: number } }>;
}

export interface WorkflowValidationIssueDto {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidationDto {
  valid: boolean;
  errors: WorkflowValidationIssueDto[];
  warnings: WorkflowValidationIssueDto[];
}

export interface WorkflowVersionDto {
  id: string;
  workflowId: string;
  semver: string;
  state: 'draft' | 'published' | 'retired';
  schemaVersion: number;
  graph: WorkflowGraphDto;
  graphHash: string;
  yamlSource: string;
  message: string | null;
  createdBy: string;
  createdAt: string;
}

export interface WorkflowDto {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  currentVersionId: string | null;
  draftVersion: WorkflowVersionDto | null;
  publishedVersion: WorkflowVersionDto | null;
  versions: WorkflowVersionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TriggerDto {
  id: string;
  orgId: string;
  workspaceId: string;
  environmentId: string;
  workflowId: string;
  workflowVersionId: string;
  nodeId: string;
  kind: 'webhook' | 'schedule' | 'manual';
  externalId: string;
  path: string | null;
  active: boolean;
  testMode: boolean;
  lastFiredAt: string | null;
  nextFireAt: string | null;
}

export interface WorkflowNodeDescriptorDto {
  type: string;
  category: string;
  label: string;
  inputs: string[];
  outputs: string[];
}

export type MemoryScopeDto = 'run' | 'session' | 'user' | 'agent' | 'project' | 'org';
export type MemoryKindDto = 'episodic' | 'semantic' | 'procedural';
export type SensitivityLevelDto = 'public' | 'internal' | 'confidential' | 'restricted' | 'pii';

export interface MemoryProvenanceDto {
  sourceRunId?: string;
  sourceStepId?: string;
  sourceDocId?: string;
  sourcePrincipalId?: string;
  confidence?: number;
  createdVia?: 'auto_extract' | 'explicit_tool' | 'human' | 'system';
}

export interface MemoryItemDto {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string | null;
  scope: MemoryScopeDto;
  scopeId: string | null;
  subjectId: string | null;
  kind: MemoryKindDto;
  content: string;
  contentHash: string;
  embeddingDim: number;
  metadata: Record<string, unknown>;
  sensitivity: SensitivityLevelDto;
  provenance: MemoryProvenanceDto;
  importance: number;
  contradictsId: string | null;
  ttlAt: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScoredMemoryItemDto {
  item: MemoryItemDto;
  score: number;
  breakdown: {
    cosine: number;
    bm25Norm: number;
    recencyDecay: number;
    importance: number;
  };
}

export interface ErasureReportDto {
  orgId: string;
  subjectId: string;
  deletedMemoryItems: number;
  deletedSessions: number;
  erasedAt: string;
}

export interface ConversationSessionDto {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string | null;
  agentId: string | null;
  subjectId: string | null;
  title: string | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    ts: string;
  }>;
  rollingSummary: string;
  preservedIdentifiers: string[];
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseDto {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  embeddingDim: number;
  chunkTargetTokens: number;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  sensitivity: SensitivityLevelDto;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbSourceDto {
  id: string;
  orgId: string;
  workspaceId: string;
  kbId: string;
  name: string;
  kind: 'file' | 'url' | 'manual';
  uri: string | null;
  mimeType: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  accessPrincipals: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KbDocumentDto {
  id: string;
  orgId: string;
  workspaceId: string;
  kbId: string;
  sourceId: string;
  externalKey: string;
  title: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  chunkCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KbChunkDto {
  id: string;
  orgId: string;
  workspaceId: string;
  kbId: string;
  sourceId: string;
  docId: string;
  chunkIndex: number;
  sectionPath: string[];
  page: number | null;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  content: string;
  contentHash: string;
  embeddingDim: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeBaseDetailDto extends KnowledgeBaseDto {
  sources: KbSourceDto[];
  documents: KbDocumentDto[];
  chunks: KbChunkDto[];
}

export interface KbSyncReportDto {
  kbId: string;
  sourceId: string;
  docId: string;
  addedChunks: number;
  unchangedChunks: number;
  deletedChunks: number;
  reEmbeddedChunks: number;
  syncedAt: string;
}

export interface CitationChipDto {
  citationId: string;
  chunkId: string;
  docId: string;
  docTitle: string;
  sectionPath: string[];
  charRange: { start: number; end: number };
  score: number;
  snippet: string;
  content: string;
}

export interface KbQueryResponseDto {
  kbId: string;
  query: string;
  answer: string;
  citations: CitationChipDto[];
  results: Array<{
    chunk: KbChunkDto;
    docTitle: string;
    score: number;
    breakdown: {
      cosine: number;
      bm25Norm: number;
      recencyDecay: number;
      importance: number;
    };
  }>;
}

export interface PlatformClientOptions {
  baseUrl: string;
  token?: string;
  workspaceId?: string;
  environment?: 'dev' | 'staging' | 'prod';
  csrfToken?: string;
  fetchImpl?: typeof fetch;
}

interface WireErrorEnvelope {
  error?: {
    code?: ErrorCode;
    message?: string;
    details?: Record<string, unknown>;
  };
}

function mapWorkspace(w: Record<string, unknown>): WorkspaceDto {
  return {
    id: String(w.id),
    orgId: String(w.org_id),
    slug: String(w.slug),
    name: String(w.name),
    createdAt: String(w.created_at),
  };
}

function mapProject(p: Record<string, unknown>): ProjectDto {
  return {
    id: String(p.id),
    orgId: String(p.org_id),
    workspaceId: String(p.workspace_id),
    slug: String(p.slug),
    name: String(p.name),
    description: p.description ? String(p.description) : null,
    maxAutonomyLevel: String(p.max_autonomy_level),
    createdAt: String(p.created_at),
  };
}

function mapApiKey(k: Record<string, unknown>): ApiKeyDto {
  return {
    id: String(k.id),
    name: String(k.name),
    keyPrefix: String(k.key_prefix),
    scopes: Array.isArray(k.scopes) ? k.scopes.map(String) : [],
    workspaceId: k.workspace_id ? String(k.workspace_id) : null,
    expiresAt: k.expires_at ? String(k.expires_at) : null,
    lastUsedAt: k.last_used_at ? String(k.last_used_at) : null,
    revokedAt: k.revoked_at ? String(k.revoked_at) : null,
    createdAt: String(k.created_at),
  };
}

function mapAudit(a: Record<string, unknown>): AuditEventDto {
  return {
    id: String(a.id),
    seq: Number(a.seq),
    ts: String(a.ts),
    actor: (a.actor as Record<string, unknown>) ?? {},
    action: String(a.action),
    resource: (a.resource as Record<string, unknown>) ?? {},
    decision: a.decision ? String(a.decision) : null,
    hash: String(a.hash),
    prevHash: String(a.prev_hash),
  };
}

function mapRun(r: Record<string, unknown>): RunDto {
  const usage = (r.usage as Record<string, unknown>) ?? {};
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    workspaceId: String(r.workspace_id),
    environmentId: String(r.environment_id),
    rootRunId: String(r.root_run_id),
    parentRunId: r.parent_run_id ? String(r.parent_run_id) : null,
    subjectType: String(r.subject_type),
    subjectVersionId: String(r.subject_version_id),
    status: r.status as RunStatus,
    failureClass: r.failure_class ? String(r.failure_class) : null,
    terminationReason: r.termination_reason ? String(r.termination_reason) : null,
    initiatorId: String(r.initiator_id),
    input: r.input,
    output: r.output,
    usage: {
      steps: Number(usage.steps ?? 0),
      tokensIn: Number(usage.tokens_in ?? 0),
      tokensOut: Number(usage.tokens_out ?? 0),
      toolCalls: Number(usage.tool_calls ?? 0),
    },
    costMicroUsd: Number(r.cost_micro_usd ?? 0),
    labels: (r.labels as Record<string, string>) ?? {},
    lastEventSeq: Number(r.last_event_seq ?? 0),
    createdAt: String(r.created_at),
    startedAt: r.started_at ? String(r.started_at) : null,
    endedAt: r.ended_at ? String(r.ended_at) : null,
  };
}

function mapRunStep(s: Record<string, unknown>): RunStepDto {
  return {
    id: String(s.id),
    runId: String(s.run_id),
    seq: Number(s.seq),
    type: String(s.type),
    status: String(s.status),
    attempt: Number(s.attempt),
    idempotencyKey: String(s.idempotency_key),
    summary: (s.summary as Record<string, unknown>) ?? {},
    tokensIn: Number(s.tokens_in ?? 0),
    tokensOut: Number(s.tokens_out ?? 0),
    costMicroUsd: Number(s.cost_micro_usd ?? 0),
    latencyMs: Number(s.latency_ms ?? 0),
    startedAt: String(s.started_at),
    endedAt: String(s.ended_at),
  };
}

function mapRunEvent(e: Record<string, unknown>): RunEventDto {
  return {
    runId: String(e.run_id),
    seq: Number(e.seq),
    type: String(e.type),
    data: (e.data as Record<string, unknown>) ?? {},
    createdAt: String(e.created_at),
  };
}

function mapDlqItem(d: Record<string, unknown>): DlqItemDto {
  return {
    id: String(d.id),
    runId: String(d.run_id),
    workspaceId: String(d.workspace_id),
    queue: String(d.queue),
    attempts: Number(d.attempts),
    maxAttempts: Number(d.max_attempts),
    lastError: (d.last_error as Record<string, unknown>) ?? null,
    createdAt: String(d.created_at),
  };
}

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token?: string;
  private workspaceId?: string;
  private environment?: 'dev' | 'staging' | 'prod';
  private csrfToken?: string;

  constructor(opts: PlatformClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.token = opts.token;
    this.workspaceId = opts.workspaceId;
    this.environment = opts.environment;
    this.csrfToken = opts.csrfToken;
  }

  setScope(scope: { workspaceId?: string; environment?: 'dev' | 'staging' | 'prod' }): void {
    this.workspaceId = scope.workspaceId;
    this.environment = scope.environment;
  }

  setAuth(auth: { token?: string; csrfToken?: string }): void {
    this.token = auth.token;
    this.csrfToken = auth.csrfToken;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.workspaceId) {
      headers['X-Workspace-Id'] = this.workspaceId;
    }
    if (this.environment) {
      headers['X-Environment'] = this.environment;
    }
    if (this.csrfToken && method !== 'GET') {
      headers['x-csrf-token'] = this.csrfToken;
    }
    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};

    if (!res.ok) {
      const errEnv = json as WireErrorEnvelope;
      const code = errEnv.error?.code ?? 'SYS_INTERNAL';
      const msg = errEnv.error?.message ?? `HTTP ${res.status}`;
      throw new PlatformError(code, msg, errEnv.error?.details ?? {}, res.status);
    }

    return json as T;
  }

  async health(): Promise<{ status: string }> {
    return this.request('GET', '/health');
  }

  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    return this.request('GET', '/ready');
  }

  async version(): Promise<{ version: string; edition: string }> {
    return this.request('GET', '/version');
  }

  async capabilities(): Promise<CapabilitiesDto> {
    const res = await this.request<{
      edition: 'community' | 'enterprise';
      feature_flags: string[];
      modules: string[];
    }>('GET', '/api/v1/capabilities');
    return {
      edition: res.edition,
      featureFlags: res.feature_flags,
      modules: res.modules,
    };
  }

  readonly auth = {
    login: async (email: string, password: string): Promise<{ csrfToken: string; me: MeDto }> => {
      const res = await this.request<{ csrf_token: string; me: Record<string, unknown> }>(
        'POST',
        '/api/v1/auth/login',
        { body: { email, password } },
      );
      this.csrfToken = res.csrf_token;
      return {
        csrfToken: res.csrf_token,
        me: await this.auth.me(),
      };
    },
    logout: async (): Promise<void> => {
      await this.request('POST', '/api/v1/auth/logout');
      this.csrfToken = undefined;
    },
    me: async (): Promise<MeDto> => {
      const res = await this.request<Record<string, unknown>>('GET', '/api/v1/me');
      const p = res.principal as Record<string, unknown>;
      return {
        principal: {
          id: String(p.id),
          orgId: String(p.org_id),
          type: p.type as PrincipalDto['type'],
          email: p.email ? String(p.email) : null,
          displayName: String(p.display_name),
        },
        orgId: String(res.org_id),
        orgSlug: String(res.org_slug),
        orgName: String(res.org_name),
        bindings: ((res.bindings as Record<string, unknown>[]) ?? []).map((b) => ({
          id: String(b.id),
          principalId: String(b.principal_id),
          roleId: String(b.role_id),
          roleName: String(b.role_name),
          scopeType: b.scope_type as RoleBindingDto['scopeType'],
          scopeId: String(b.scope_id),
          createdAt: String(b.created_at),
        })),
        workspaces: ((res.workspaces as Record<string, unknown>[]) ?? []).map(mapWorkspace),
      };
    },
  };

  readonly workspaces = {
    list: async (): Promise<WorkspaceDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/workspaces',
      );
      return res.data.map(mapWorkspace);
    },
    create: async (
      input: { slug: string; name: string },
      idempotencyKey: string,
    ): Promise<WorkspaceDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/workspaces', {
        body: input,
        idempotencyKey,
      });
      return mapWorkspace(res);
    },
    get: async (id: string): Promise<WorkspaceDto> => {
      const res = await this.request<Record<string, unknown>>('GET', `/api/v1/workspaces/${id}`);
      return mapWorkspace(res);
    },
    update: async (id: string, input: { name: string }): Promise<WorkspaceDto> => {
      const res = await this.request<Record<string, unknown>>('PATCH', `/api/v1/workspaces/${id}`, {
        body: input,
      });
      return mapWorkspace(res);
    },
  };

  readonly projects = {
    list: async (workspaceId: string): Promise<ProjectDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/workspaces/${workspaceId}/projects`,
      );
      return res.data.map(mapProject);
    },
    create: async (
      workspaceId: string,
      input: { slug: string; name: string; description?: string },
      idempotencyKey: string,
    ): Promise<ProjectDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/workspaces/${workspaceId}/projects`,
        { body: input, idempotencyKey },
      );
      return mapProject(res);
    },
  };

  readonly environments = {
    list: async (workspaceId: string): Promise<EnvironmentDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/workspaces/${workspaceId}/environments`,
      );
      return res.data.map((e) => ({
        id: String(e.id),
        workspaceId: String(e.workspace_id),
        kind: e.kind as EnvironmentDto['kind'],
        name: String(e.name),
      }));
    },
  };

  readonly roles = {
    list: async (): Promise<RoleDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/roles');
      return res.data.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        isSystem: Boolean(r.is_system),
      }));
    },
  };

  readonly roleBindings = {
    list: async (): Promise<RoleBindingDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/role-bindings',
      );
      return res.data.map((b) => ({
        id: String(b.id),
        principalId: String(b.principal_id),
        roleId: String(b.role_id),
        roleName: String(b.role_name),
        scopeType: b.scope_type as RoleBindingDto['scopeType'],
        scopeId: String(b.scope_id),
        createdAt: String(b.created_at),
      }));
    },
    create: async (
      input: {
        principalId: string;
        roleName: string;
        scopeType: 'org' | 'workspace' | 'project' | 'resource';
        scopeId: string;
      },
      idempotencyKey: string,
    ): Promise<RoleBindingDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/role-bindings', {
        body: {
          principal_id: input.principalId,
          role_name: input.roleName,
          scope_type: input.scopeType,
          scope_id: input.scopeId,
        },
        idempotencyKey,
      });
      return {
        id: String(res.id),
        principalId: String(res.principal_id),
        roleId: String(res.role_id),
        roleName: String(res.role_name),
        scopeType: res.scope_type as RoleBindingDto['scopeType'],
        scopeId: String(res.scope_id),
        createdAt: String(res.created_at),
      };
    },
    delete: async (id: string): Promise<void> => {
      await this.request('DELETE', `/api/v1/role-bindings/${id}`);
    },
  };

  readonly apiKeys = {
    list: async (): Promise<ApiKeyDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/api-keys',
      );
      return res.data.map(mapApiKey);
    },
    create: async (
      input: { name: string; scopes?: string[]; workspaceId?: string },
      idempotencyKey: string,
    ): Promise<CreatedApiKeyDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/api-keys', {
        body: {
          name: input.name,
          scopes: input.scopes ?? [],
          workspace_id: input.workspaceId,
        },
        idempotencyKey,
      });
      return {
        ...mapApiKey(res),
        secret: String(res.secret),
      };
    },
    revoke: async (id: string): Promise<void> => {
      await this.request('DELETE', `/api/v1/api-keys/${id}`);
    },
  };

  readonly auditEvents = {
    list: async (opts: { limit?: number; cursor?: string } = {}): Promise<{
      data: AuditEventDto[];
      nextCursor: string | null;
    }> => {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      const qs = params.toString();
      const res = await this.request<{ data: Record<string, unknown>[]; next_cursor: string | null }>(
        'GET',
        `/api/v1/audit-events${qs ? `?${qs}` : ''}`,
      );
      return {
        data: res.data.map(mapAudit),
        nextCursor: res.next_cursor ?? null,
      };
    },
  };

  readonly runs = {
    create: async (
      input: {
        workspaceId?: string;
        environment?: 'dev' | 'staging' | 'prod';
        subjectType?: 'agent_version' | 'workflow_version';
        subjectVersionId: string;
        input?: unknown;
        labels?: Record<string, string>;
        queue?: string;
        priority?: number;
        serializeKey?: string;
        simulatedSteps?: Array<Record<string, unknown>>;
        executeInline?: boolean;
      },
      idempotencyKey: string,
    ): Promise<RunDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/runs', {
        body: {
          workspace_id: input.workspaceId,
          environment: input.environment,
          subject_type: input.subjectType ?? 'agent_version',
          subject_version_id: input.subjectVersionId,
          input: input.input,
          labels: input.labels,
          queue: input.queue ?? 'default',
          priority: input.priority ?? 5,
          serialize_key: input.serializeKey,
          simulated_steps: input.simulatedSteps,
          execute_inline: input.executeInline,
        },
        idempotencyKey,
      });
      return mapRun(res);
    },
    list: async (filter: { status?: RunStatus; workspaceId?: string } = {}): Promise<RunDto[]> => {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.workspaceId) params.set('workspace_id', filter.workspaceId);
      const qs = params.toString();
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/runs${qs ? `?${qs}` : ''}`,
      );
      return res.data.map(mapRun);
    },
    get: async (id: string): Promise<RunDto> => {
      const res = await this.request<Record<string, unknown>>('GET', `/api/v1/runs/${id}`);
      return mapRun(res);
    },
    listSteps: async (id: string): Promise<RunStepDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/runs/${id}/steps`,
      );
      return res.data.map(mapRunStep);
    },
    listEvents: async (id: string, afterSeq?: number): Promise<RunEventDto[]> => {
      const qs = afterSeq !== undefined ? `?after_seq=${afterSeq}` : '';
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/runs/${id}/events${qs}`,
      );
      return res.data.map(mapRunEvent);
    },
    cancel: async (id: string, reason: string, idempotencyKey: string): Promise<RunDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/runs/${id}/cancel`,
        { body: { reason }, idempotencyKey },
      );
      return mapRun(res);
    },
    signal: async (
      id: string,
      input: { kind?: 'approval' | 'input' | 'timer' | 'child'; reason: string; payload?: Record<string, unknown> },
      idempotencyKey: string,
    ): Promise<RunDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/runs/${id}/signal`,
        { body: { kind: input.kind ?? 'input', reason: input.reason, payload: input.payload }, idempotencyKey },
      );
      return mapRun(res);
    },
    listDlq: async (): Promise<DlqItemDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/dlq');
      return res.data.map(mapDlqItem);
    },
    bulkRedrive: async (
      runIds: string[],
      idempotencyKey: string,
      inputPatch?: unknown,
    ): Promise<RunDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'POST',
        '/api/v1/runs:bulk-redrive',
        { body: { run_ids: runIds, input_patch: inputPatch }, idempotencyKey },
      );
      return res.data.map(mapRun);
    },
    listUsageLedger: async (
      runId: string,
    ): Promise<{ data: UsageLedgerEntryDto[]; totalCostMicroUsd: number }> => {
      const res = await this.request<{
        data: Record<string, unknown>[];
        total_cost_micro_usd: number;
      }>('GET', `/api/v1/runs/${runId}/usage-ledger`);
      return {
        data: res.data.map(mapUsageLedgerEntry),
        totalCostMicroUsd: Number(res.total_cost_micro_usd ?? 0),
      };
    },
  };

  readonly models = {
    list: async (): Promise<ModelCapabilityDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/models');
      return res.data.map(mapModelCapability);
    },
  };

  readonly tools = {
    list: async (): Promise<ToolContractDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/tools');
      return res.data.map(mapToolContract);
    },
    create: async (
      contract: Record<string, unknown>,
      idempotencyKey: string,
    ): Promise<ToolContractDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/tools', {
        body: contract,
        idempotencyKey,
      });
      return mapToolContract(res);
    },
  };

  readonly agents = {
    list: async (): Promise<AgentDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/agents');
      return res.data.map(mapAgent);
    },
    create: async (
      input: { workspaceId?: string; projectId?: string; definition: Record<string, unknown> },
      idempotencyKey: string,
    ): Promise<AgentDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/agents', {
        body: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          definition: input.definition,
        },
        idempotencyKey,
      });
      return mapAgent(res);
    },
    get: async (id: string): Promise<AgentDto> => {
      const res = await this.request<Record<string, unknown>>('GET', `/api/v1/agents/${id}`);
      return mapAgent(res);
    },
    updateDraft: async (
      id: string,
      input: { definition: Record<string, unknown>; message?: string },
    ): Promise<AgentDto> => {
      const res = await this.request<Record<string, unknown>>('PATCH', `/api/v1/agents/${id}`, {
        body: input,
      });
      return mapAgent(res);
    },
    publishVersion: async (
      id: string,
      versionId: string,
      idempotencyKey: string,
      opts: { message?: string; allowL4Autonomy?: boolean } = {},
    ): Promise<AgentDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/agents/${id}/versions/${versionId}/publish`,
        {
          body: { message: opts.message, allow_l4_autonomy: opts.allowL4Autonomy },
          idempotencyKey,
        },
      );
      return mapAgent(res);
    },
    diff: async (id: string, fromVersionId: string, toVersionId: string): Promise<AgentDiffDto> => {
      const params = new URLSearchParams({ from: fromVersionId, to: toVersionId });
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/agents/${id}/diff?${params.toString()}`,
      );
      return {
        fromVersion: String(res.from_version),
        toVersion: String(res.to_version),
        breaking: Boolean(res.breaking),
        changes: (res.changes as AgentDiffDto['changes']) ?? [],
      };
    },
    run: async (
      id: string,
      input: {
        environment?: 'dev' | 'staging' | 'prod';
        versionId?: string;
        input: string | Record<string, unknown>;
        dryRun?: boolean;
        mockTurns?: Array<Record<string, unknown>>;
      },
      idempotencyKey: string,
    ): Promise<RunDto> => {
      const res = await this.request<Record<string, unknown>>('POST', `/api/v1/agents/${id}/runs`, {
        body: {
          environment: input.environment,
          version_id: input.versionId,
          input: input.input,
          dry_run: input.dryRun ?? false,
          mock_turns: input.mockTurns,
        },
        idempotencyKey,
      });
      return mapRun(res);
    },
  };

  readonly workflows = {
    listNodes: async (): Promise<WorkflowNodeDescriptorDto[]> => {
      const res = await this.request<{ data: WorkflowNodeDescriptorDto[] }>(
        'GET',
        '/api/v1/workflows/nodes',
      );
      return res.data;
    },
    validate: async (
      input: {
        workspaceId?: string;
        environment?: 'dev' | 'staging' | 'prod';
        graph?: WorkflowGraphDto;
        yamlSource?: string;
      },
      idempotencyKey: string,
    ): Promise<WorkflowValidationDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/workflows:validate',
        {
          body: {
            workspace_id: input.workspaceId,
            environment: input.environment,
            graph: input.graph,
            yaml_source: input.yamlSource,
          },
          idempotencyKey,
        },
      );
      return {
        valid: Boolean(res.valid),
        errors: mapValidationIssues(res.errors),
        warnings: mapValidationIssues(res.warnings),
      };
    },
    list: async (): Promise<WorkflowDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/workflows',
      );
      return res.data.map(mapWorkflow);
    },
    create: async (
      input: {
        workspaceId?: string;
        projectId?: string;
        name: string;
        description?: string;
        semver?: string;
        graph?: WorkflowGraphDto;
        yamlSource?: string;
      },
      idempotencyKey: string,
    ): Promise<WorkflowDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/workflows', {
        body: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          name: input.name,
          description: input.description,
          semver: input.semver ?? '1.0.0',
          graph: input.graph,
          yaml_source: input.yamlSource,
        },
        idempotencyKey,
      });
      return mapWorkflow(res);
    },
    get: async (id: string): Promise<WorkflowDto> => {
      const res = await this.request<Record<string, unknown>>('GET', `/api/v1/workflows/${id}`);
      return mapWorkflow(res);
    },
    updateDraft: async (
      id: string,
      input: {
        semver?: string;
        description?: string;
        graph?: WorkflowGraphDto;
        yamlSource?: string;
        message?: string;
      },
    ): Promise<WorkflowDto> => {
      const res = await this.request<Record<string, unknown>>('PATCH', `/api/v1/workflows/${id}`, {
        body: {
          semver: input.semver ?? '1.0.0',
          description: input.description,
          graph: input.graph,
          yaml_source: input.yamlSource,
          message: input.message,
        },
      });
      return mapWorkflow(res);
    },
    publishVersion: async (
      id: string,
      versionId: string,
      idempotencyKey: string,
      opts: { environment?: 'dev' | 'staging' | 'prod'; message?: string; activateTriggers?: boolean } = {},
    ): Promise<WorkflowDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/workflows/${id}/versions/${versionId}/publish`,
        {
          body: {
            environment: opts.environment,
            message: opts.message,
            activate_triggers: opts.activateTriggers ?? true,
          },
          idempotencyKey,
        },
      );
      return mapWorkflow(res);
    },
    run: async (
      id: string,
      input: {
        environment?: 'dev' | 'staging' | 'prod';
        versionId?: string;
        triggerPayload?: Record<string, unknown>;
        pinnedData?: Record<string, unknown[]>;
        startFromNodeId?: string;
      },
      idempotencyKey: string,
    ): Promise<RunDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/workflows/${id}/runs`,
        {
          body: {
            environment: input.environment,
            version_id: input.versionId,
            trigger_payload: input.triggerPayload ?? {},
            pinned_data: input.pinnedData,
            start_from_node_id: input.startFromNodeId,
          },
          idempotencyKey,
        },
      );
      return mapRun(res);
    },
  };

  readonly triggers = {
    list: async (): Promise<TriggerDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/triggers',
      );
      return res.data.map(mapTrigger);
    },
  };

  readonly memory = {
    put: async (
      input: {
        workspaceId?: string;
        projectId?: string;
        scope: MemoryScopeDto;
        scopeId?: string | null;
        subjectId?: string | null;
        kind?: MemoryKindDto;
        content: string;
        metadata?: Record<string, unknown>;
        sensitivity?: SensitivityLevelDto;
        importance?: number;
        ttlAt?: string | null;
        pinned?: boolean;
      },
      idempotencyKey: string,
    ): Promise<MemoryItemDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/memory/items', {
        body: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          scope: input.scope,
          scope_id: input.scopeId,
          subject_id: input.subjectId,
          kind: input.kind ?? 'semantic',
          content: input.content,
          metadata: input.metadata,
          sensitivity: input.sensitivity ?? 'internal',
          importance: input.importance ?? 0.5,
          ttl_at: input.ttlAt,
          pinned: input.pinned ?? false,
        },
        idempotencyKey,
      });
      return mapMemoryItem(res);
    },
    list: async (
      filter: {
        scope?: MemoryScopeDto;
        scopeId?: string;
        kind?: MemoryKindDto;
        subjectId?: string;
        sensitivity?: SensitivityLevelDto;
        maxSensitivity?: SensitivityLevelDto;
        q?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ): Promise<{ items: MemoryItemDto[]; nextCursor: string | null }> => {
      const params = new URLSearchParams();
      if (filter.scope) params.set('scope', filter.scope);
      if (filter.scopeId) params.set('scope_id', filter.scopeId);
      if (filter.kind) params.set('kind', filter.kind);
      if (filter.subjectId) params.set('subject_id', filter.subjectId);
      if (filter.sensitivity) params.set('sensitivity', filter.sensitivity);
      if (filter.maxSensitivity) params.set('max_sensitivity', filter.maxSensitivity);
      if (filter.q) params.set('q', filter.q);
      if (filter.cursor) params.set('cursor', filter.cursor);
      if (filter.limit !== undefined) params.set('limit', String(filter.limit));
      const qs = params.toString();
      const res = await this.request<{
        items: Record<string, unknown>[];
        next_cursor: string | null;
      }>('GET', `/api/v1/memory/items${qs ? `?${qs}` : ''}`);
      return {
        items: res.items.map(mapMemoryItem),
        nextCursor: res.next_cursor ?? null,
      };
    },
    update: async (
      id: string,
      patch: {
        content?: string;
        pinned?: boolean;
        importance?: number;
        metadata?: Record<string, unknown>;
      },
    ): Promise<MemoryItemDto> => {
      const res = await this.request<Record<string, unknown>>(
        'PATCH',
        `/api/v1/memory/items/${id}`,
        { body: patch },
      );
      return mapMemoryItem(res);
    },
    delete: async (id: string): Promise<void> => {
      await this.request<void>('DELETE', `/api/v1/memory/items/${id}`);
    },
    search: async (
      input: {
        workspaceId?: string;
        query: string;
        topK?: number;
        minScore?: number;
        scope?: MemoryScopeDto;
        scopeId?: string;
        allowedScopes?: Array<{ scope: MemoryScopeDto; scopeId?: string }>;
        kind?: MemoryKindDto;
        subjectId?: string;
        maxSensitivity?: SensitivityLevelDto;
        metadataFilter?: Record<string, unknown>;
      },
      idempotencyKey = `sdk-mem-search-${Date.now()}`,
    ): Promise<ScoredMemoryItemDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'POST',
        '/api/v1/memory/search',
        {
          body: {
            workspace_id: input.workspaceId,
            query: input.query,
            top_k: input.topK ?? 5,
            min_score: input.minScore ?? 0,
            scope: input.scope,
            scope_id: input.scopeId,
            allowed_scopes: input.allowedScopes?.map((s) => ({
              scope: s.scope,
              scope_id: s.scopeId,
            })),
            kind: input.kind,
            subject_id: input.subjectId,
            max_sensitivity: input.maxSensitivity,
            metadata_filter: input.metadataFilter,
          },
          idempotencyKey,
        },
      );
      return res.data.map(mapScoredMemoryItem);
    },
    eraseSubject: async (
      subjectId: string,
      idempotencyKey: string,
    ): Promise<ErasureReportDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/memory/erase', {
        body: { subject_id: subjectId },
        idempotencyKey,
      });
      return {
        orgId: String(res.org_id),
        subjectId: String(res.subject_id),
        deletedMemoryItems: Number(res.deleted_memory_items ?? 0),
        deletedSessions: Number(res.deleted_sessions ?? 0),
        erasedAt: String(res.erased_at),
      };
    },
    appendSession: async (
      input: {
        workspaceId?: string;
        sessionId?: string;
        agentId?: string | null;
        subjectId?: string | null;
        title?: string | null;
        messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
        compactThresholdTokens?: number;
        keepRecentMessages?: number;
      },
      idempotencyKey: string,
    ): Promise<ConversationSessionDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/memory/sessions', {
        body: {
          workspace_id: input.workspaceId,
          session_id: input.sessionId,
          agent_id: input.agentId,
          subject_id: input.subjectId,
          title: input.title,
          messages: input.messages,
          compact_threshold_tokens: input.compactThresholdTokens,
          keep_recent_messages: input.keepRecentMessages,
        },
        idempotencyKey,
      });
      return mapConversationSession(res);
    },
    getSession: async (id: string): Promise<ConversationSessionDto> => {
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/memory/sessions/${id}`,
      );
      return mapConversationSession(res);
    },
  };

  readonly knowledgeBases = {
    list: async (): Promise<KnowledgeBaseDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/knowledge-bases',
      );
      return res.data.map(mapKnowledgeBase);
    },
    create: async (
      input: {
        workspaceId?: string;
        projectId?: string;
        name: string;
        description?: string;
        embeddingModel?: string;
        embeddingDim?: number;
        chunkTargetTokens?: number;
        chunkMaxTokens?: number;
        chunkOverlapTokens?: number;
        sensitivity?: SensitivityLevelDto;
      },
      idempotencyKey: string,
    ): Promise<KnowledgeBaseDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/knowledge-bases',
        {
          body: {
            workspace_id: input.workspaceId,
            project_id: input.projectId,
            name: input.name,
            description: input.description,
            embedding_model: input.embeddingModel,
            embedding_dim: input.embeddingDim,
            chunk_target_tokens: input.chunkTargetTokens,
            chunk_max_tokens: input.chunkMaxTokens,
            chunk_overlap_tokens: input.chunkOverlapTokens,
            sensitivity: input.sensitivity,
          },
          idempotencyKey,
        },
      );
      return mapKnowledgeBase(res);
    },
    get: async (id: string): Promise<KnowledgeBaseDetailDto> => {
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/knowledge-bases/${id}`,
      );
      return {
        ...mapKnowledgeBase(res),
        sources: Array.isArray(res.sources)
          ? res.sources.map((s) => mapKbSource(s as Record<string, unknown>))
          : [],
        documents: Array.isArray(res.documents)
          ? res.documents.map((d) => mapKbDocument(d as Record<string, unknown>))
          : [],
        chunks: Array.isArray(res.chunks)
          ? res.chunks.map((c) => mapKbChunk(c as Record<string, unknown>))
          : [],
      };
    },
    ingestDocument: async (
      kbId: string,
      input: {
        sourceName?: string;
        kind?: 'file' | 'url' | 'manual';
        uri?: string;
        externalKey?: string;
        title: string;
        mimeType?: string;
        content?: string;
        accessPrincipals?: string[];
        metadata?: Record<string, unknown>;
      },
      idempotencyKey: string,
    ): Promise<{ source: KbSourceDto; document: KbDocumentDto; syncReport: KbSyncReportDto }> => {
      const res = await this.request<{
        source: Record<string, unknown>;
        document: Record<string, unknown>;
        sync_report: Record<string, unknown>;
      }>('POST', `/api/v1/knowledge-bases/${kbId}/documents`, {
        body: {
          source_name: input.sourceName,
          kind: input.kind ?? 'file',
          uri: input.uri,
          external_key: input.externalKey,
          title: input.title,
          mime_type: input.mimeType ?? 'text/markdown',
          content: input.content,
          access_principals: input.accessPrincipals,
          metadata: input.metadata,
        },
        idempotencyKey,
      });
      return {
        source: mapKbSource(res.source),
        document: mapKbDocument(res.document),
        syncReport: mapKbSyncReport(res.sync_report),
      };
    },
    syncDocument: async (
      kbId: string,
      input: { docId: string; content: string; title?: string },
      idempotencyKey: string,
    ): Promise<KbSyncReportDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/knowledge-bases/${kbId}/sync`,
        {
          body: {
            doc_id: input.docId,
            content: input.content,
            title: input.title,
          },
          idempotencyKey,
        },
      );
      return mapKbSyncReport(res);
    },
    query: async (
      kbId: string,
      input: { query: string; topK?: number; minScore?: number },
      idempotencyKey = `sdk-kb-query-${Date.now()}`,
    ): Promise<KbQueryResponseDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/knowledge-bases/${kbId}/query`,
        {
          body: {
            query: input.query,
            top_k: input.topK ?? 5,
            min_score: input.minScore ?? 0,
          },
          idempotencyKey,
        },
      );
      return {
        kbId: String(res.kb_id),
        query: String(res.query),
        answer: String(res.answer),
        citations: Array.isArray(res.citations)
          ? res.citations.map((c) => mapCitationChip(c as Record<string, unknown>))
          : [],
        results: Array.isArray(res.results)
          ? res.results.map((r) => {
              const row = r as Record<string, unknown>;
              const bd = (row.breakdown ?? {}) as Record<string, unknown>;
              return {
                chunk: mapKbChunk(row.chunk as Record<string, unknown>),
                docTitle: String(row.doc_title),
                score: Number(row.score ?? 0),
                breakdown: {
                  cosine: Number(bd.cosine ?? 0),
                  bm25Norm: Number(bd.bm25_norm ?? 0),
                  recencyDecay: Number(bd.recency_decay ?? 1),
                  importance: Number(bd.importance ?? 0.7),
                },
              };
            })
          : [],
      };
    },
  };
}

function mapModelCapability(m: Record<string, unknown>): ModelCapabilityDto {
  const pricing = (m.pricing_per_million ?? {}) as Record<string, unknown>;
  return {
    id: String(m.id),
    provider: String(m.provider),
    displayName: String(m.display_name),
    tier: m.tier as ModelCapabilityDto['tier'],
    contextWindowTokens: Number(m.context_window_tokens ?? 0),
    maxOutputTokens: Number(m.max_output_tokens ?? 0),
    supportsTools: Boolean(m.supports_tools),
    supportsStructuredOutput: Boolean(m.supports_structured_output),
    supportsVision: Boolean(m.supports_vision),
    supportsStreaming: Boolean(m.supports_streaming),
    pricingPerMillion: {
      inputMicroUsd: Number(pricing.input_micro_usd ?? 0),
      outputMicroUsd: Number(pricing.output_micro_usd ?? 0),
      cachedInputMicroUsd: Number(pricing.cached_input_micro_usd ?? 0),
    },
    status: m.status as ModelCapabilityDto['status'],
  };
}

function mapToolContract(t: Record<string, unknown>): ToolContractDto {
  return {
    name: String(t.name),
    version: String(t.version),
    description: String(t.description),
    inputSchema: (t.input_schema as Record<string, unknown>) ?? {},
    outputSchema: (t.output_schema as Record<string, unknown>) ?? {},
    sideEffectClass: t.side_effect_class as ToolContractDto['sideEffectClass'],
    idempotent: Boolean(t.idempotent),
    requiredPermissions: (t.required_permissions as string[]) ?? [],
    dataClassificationTouched: (t.data_classification_touched as string[]) ?? [],
    timeoutMs: Number(t.timeout_ms ?? 15_000),
    implementation: (t.implementation as ToolContractDto['implementation']) ?? 'builtin',
  };
}

function mapAgentVersion(v: Record<string, unknown>): AgentVersionDto {
  const tri = (v.lethal_trifecta ?? {}) as Record<string, unknown>;
  return {
    id: String(v.id),
    agentId: String(v.agent_id),
    semver: String(v.semver),
    state: v.state as AgentVersionDto['state'],
    definition: (v.definition as Record<string, unknown>) ?? {},
    definitionHash: String(v.definition_hash),
    message: v.message ? String(v.message) : null,
    lethalTrifecta: {
      detected: Boolean(tri.detected),
      hasPrivateData: Boolean(tri.has_private_data),
      hasUntrustedInput: Boolean(tri.has_untrusted_input),
      hasExternalComms: Boolean(tri.has_external_comms),
      reasons: (tri.reasons as string[]) ?? [],
    },
    createdBy: String(v.created_by),
    createdAt: String(v.created_at),
  };
}

function mapAgent(a: Record<string, unknown>): AgentDto {
  return {
    id: String(a.id),
    orgId: String(a.org_id),
    workspaceId: String(a.workspace_id),
    projectId: String(a.project_id),
    name: String(a.name),
    description: a.description ? String(a.description) : null,
    status: a.status as AgentDto['status'],
    currentVersionId: a.current_version_id ? String(a.current_version_id) : null,
    draftVersion: a.draft_version
      ? mapAgentVersion(a.draft_version as Record<string, unknown>)
      : null,
    publishedVersion: a.published_version
      ? mapAgentVersion(a.published_version as Record<string, unknown>)
      : null,
    versions: Array.isArray(a.versions)
      ? a.versions.map((v) => mapAgentVersion(v as Record<string, unknown>))
      : [],
    createdAt: String(a.created_at),
    updatedAt: String(a.updated_at),
  };
}

function mapUsageLedgerEntry(u: Record<string, unknown>): UsageLedgerEntryDto {
  return {
    id: String(u.id),
    orgId: String(u.org_id),
    workspaceId: String(u.workspace_id),
    projectId: String(u.project_id),
    environmentId: String(u.environment_id),
    runId: String(u.run_id),
    stepSeq: Number(u.step_seq ?? 0),
    principalId: String(u.principal_id),
    category: u.category as UsageLedgerEntryDto['category'],
    provider: u.provider ? String(u.provider) : null,
    model: u.model ? String(u.model) : null,
    tokensIn: Number(u.tokens_in ?? 0),
    tokensOut: Number(u.tokens_out ?? 0),
    cachedTokens: Number(u.cached_tokens ?? 0),
    quantity: Number(u.quantity ?? 0),
    unit: String(u.unit ?? 'tokens'),
    costMicroUsd: Number(u.cost_micro_usd ?? 0),
    ts: String(u.ts),
  };
}

function mapValidationIssues(raw: unknown): WorkflowValidationIssueDto[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const i = item as Record<string, unknown>;
    return {
      severity: i.severity as 'error' | 'warning',
      code: String(i.code),
      message: String(i.message),
      nodeId: i.node_id ? String(i.node_id) : undefined,
      edgeId: i.edge_id ? String(i.edge_id) : undefined,
    };
  });
}

function mapWorkflowVersion(v: Record<string, unknown>): WorkflowVersionDto {
  return {
    id: String(v.id),
    workflowId: String(v.workflow_id),
    semver: String(v.semver),
    state: v.state as WorkflowVersionDto['state'],
    schemaVersion: Number(v.schema_version ?? 1),
    graph: v.graph as WorkflowGraphDto,
    graphHash: String(v.graph_hash),
    yamlSource: String(v.yaml_source ?? ''),
    message: v.message ? String(v.message) : null,
    createdBy: String(v.created_by),
    createdAt: String(v.created_at),
  };
}

function mapWorkflow(w: Record<string, unknown>): WorkflowDto {
  return {
    id: String(w.id),
    orgId: String(w.org_id),
    workspaceId: String(w.workspace_id),
    projectId: String(w.project_id),
    name: String(w.name),
    description: w.description ? String(w.description) : null,
    status: w.status as WorkflowDto['status'],
    currentVersionId: w.current_version_id ? String(w.current_version_id) : null,
    draftVersion: w.draft_version
      ? mapWorkflowVersion(w.draft_version as Record<string, unknown>)
      : null,
    publishedVersion: w.published_version
      ? mapWorkflowVersion(w.published_version as Record<string, unknown>)
      : null,
    versions: Array.isArray(w.versions)
      ? w.versions.map((v) => mapWorkflowVersion(v as Record<string, unknown>))
      : [],
    createdAt: String(w.created_at),
    updatedAt: String(w.updated_at),
  };
}

function mapTrigger(t: Record<string, unknown>): TriggerDto {
  return {
    id: String(t.id),
    orgId: String(t.org_id),
    workspaceId: String(t.workspace_id),
    environmentId: String(t.environment_id),
    workflowId: String(t.workflow_id),
    workflowVersionId: String(t.workflow_version_id),
    nodeId: String(t.node_id),
    kind: t.kind as TriggerDto['kind'],
    externalId: String(t.external_id),
    path: t.path ? String(t.path) : null,
    active: Boolean(t.active),
    testMode: Boolean(t.test_mode),
    lastFiredAt: t.last_fired_at ? String(t.last_fired_at) : null,
    nextFireAt: t.next_fire_at ? String(t.next_fire_at) : null,
  };
}

function mapMemoryItem(m: Record<string, unknown>): MemoryItemDto {
  const prov = (m.provenance ?? {}) as Record<string, unknown>;
  return {
    id: String(m.id),
    orgId: String(m.org_id),
    workspaceId: String(m.workspace_id),
    projectId: m.project_id ? String(m.project_id) : null,
    scope: m.scope as MemoryScopeDto,
    scopeId: m.scope_id ? String(m.scope_id) : null,
    subjectId: m.subject_id ? String(m.subject_id) : null,
    kind: m.kind as MemoryKindDto,
    content: String(m.content),
    contentHash: String(m.content_hash),
    embeddingDim: Number(m.embedding_dim ?? 1536),
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
    sensitivity: m.sensitivity as SensitivityLevelDto,
    provenance: {
      sourceRunId: prov.source_run_id ? String(prov.source_run_id) : undefined,
      sourceStepId: prov.source_step_id ? String(prov.source_step_id) : undefined,
      sourceDocId: prov.source_doc_id ? String(prov.source_doc_id) : undefined,
      sourcePrincipalId: prov.source_principal_id ? String(prov.source_principal_id) : undefined,
      confidence: prov.confidence !== undefined ? Number(prov.confidence) : undefined,
      createdVia: prov.created_via as MemoryProvenanceDto['createdVia'],
    },
    importance: Number(m.importance ?? 0.5),
    contradictsId: m.contradicts_id ? String(m.contradicts_id) : null,
    ttlAt: m.ttl_at ? String(m.ttl_at) : null,
    pinned: Boolean(m.pinned),
    createdAt: String(m.created_at),
    updatedAt: String(m.updated_at),
  };
}

function mapScoredMemoryItem(s: Record<string, unknown>): ScoredMemoryItemDto {
  const bd = (s.breakdown ?? {}) as Record<string, unknown>;
  return {
    item: mapMemoryItem(s.item as Record<string, unknown>),
    score: Number(s.score ?? 0),
    breakdown: {
      cosine: Number(bd.cosine ?? 0),
      bm25Norm: Number(bd.bm25_norm ?? 0),
      recencyDecay: Number(bd.recency_decay ?? 1),
      importance: Number(bd.importance ?? 0.5),
    },
  };
}

function mapConversationSession(s: Record<string, unknown>): ConversationSessionDto {
  return {
    id: String(s.id),
    orgId: String(s.org_id),
    workspaceId: String(s.workspace_id),
    projectId: s.project_id ? String(s.project_id) : null,
    agentId: s.agent_id ? String(s.agent_id) : null,
    subjectId: s.subject_id ? String(s.subject_id) : null,
    title: s.title ? String(s.title) : null,
    messages: Array.isArray(s.messages)
      ? (s.messages as ConversationSessionDto['messages'])
      : [],
    rollingSummary: String(s.rolling_summary ?? ''),
    preservedIdentifiers: Array.isArray(s.preserved_identifiers)
      ? s.preserved_identifiers.map(String)
      : [],
    tokenCount: Number(s.token_count ?? 0),
    createdAt: String(s.created_at),
    updatedAt: String(s.updated_at),
  };
}

function mapKnowledgeBase(kb: Record<string, unknown>): KnowledgeBaseDto {
  return {
    id: String(kb.id),
    orgId: String(kb.org_id),
    workspaceId: String(kb.workspace_id),
    projectId: String(kb.project_id),
    name: String(kb.name),
    description: kb.description ? String(kb.description) : null,
    embeddingModel: String(kb.embedding_model),
    embeddingDim: Number(kb.embedding_dim ?? 1536),
    chunkTargetTokens: Number(kb.chunk_target_tokens ?? 400),
    chunkMaxTokens: Number(kb.chunk_max_tokens ?? 800),
    chunkOverlapTokens: Number(kb.chunk_overlap_tokens ?? 60),
    sensitivity: kb.sensitivity as SensitivityLevelDto,
    createdBy: String(kb.created_by),
    createdAt: String(kb.created_at),
    updatedAt: String(kb.updated_at),
  };
}

function mapKbSource(src: Record<string, unknown>): KbSourceDto {
  return {
    id: String(src.id),
    orgId: String(src.org_id),
    workspaceId: String(src.workspace_id),
    kbId: String(src.kb_id),
    name: String(src.name),
    kind: src.kind as KbSourceDto['kind'],
    uri: src.uri ? String(src.uri) : null,
    mimeType: String(src.mime_type),
    syncStatus: src.sync_status as KbSourceDto['syncStatus'],
    accessPrincipals: Array.isArray(src.access_principals) ? src.access_principals.map(String) : [],
    lastSyncedAt: src.last_synced_at ? String(src.last_synced_at) : null,
    lastError: src.last_error ? String(src.last_error) : null,
    createdAt: String(src.created_at),
    updatedAt: String(src.updated_at),
  };
}

function mapKbDocument(doc: Record<string, unknown>): KbDocumentDto {
  return {
    id: String(doc.id),
    orgId: String(doc.org_id),
    workspaceId: String(doc.workspace_id),
    kbId: String(doc.kb_id),
    sourceId: String(doc.source_id),
    externalKey: String(doc.external_key),
    title: String(doc.title),
    mimeType: String(doc.mime_type),
    contentHash: String(doc.content_hash),
    byteSize: Number(doc.byte_size ?? 0),
    chunkCount: Number(doc.chunk_count ?? 0),
    metadata: (doc.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(doc.created_at),
    updatedAt: String(doc.updated_at),
  };
}

function mapKbChunk(ch: Record<string, unknown>): KbChunkDto {
  return {
    id: String(ch.id),
    orgId: String(ch.org_id),
    workspaceId: String(ch.workspace_id),
    kbId: String(ch.kb_id),
    sourceId: String(ch.source_id),
    docId: String(ch.doc_id),
    chunkIndex: Number(ch.chunk_index ?? 0),
    sectionPath: Array.isArray(ch.section_path) ? ch.section_path.map(String) : [],
    page: ch.page !== null && ch.page !== undefined ? Number(ch.page) : null,
    charStart: Number(ch.char_start ?? 0),
    charEnd: Number(ch.char_end ?? 0),
    tokenCount: Number(ch.token_count ?? 0),
    content: String(ch.content),
    contentHash: String(ch.content_hash),
    embeddingDim: Number(ch.embedding_dim ?? 1536),
    metadata: (ch.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(ch.created_at),
  };
}

function mapKbSyncReport(r: Record<string, unknown>): KbSyncReportDto {
  return {
    kbId: String(r.kb_id),
    sourceId: String(r.source_id),
    docId: String(r.doc_id),
    addedChunks: Number(r.added_chunks ?? 0),
    unchangedChunks: Number(r.unchanged_chunks ?? 0),
    deletedChunks: Number(r.deleted_chunks ?? 0),
    reEmbeddedChunks: Number(r.re_embedded_chunks ?? 0),
    syncedAt: String(r.synced_at),
  };
}

function mapCitationChip(c: Record<string, unknown>): CitationChipDto {
  const cr = (c.char_range ?? {}) as Record<string, unknown>;
  return {
    citationId: String(c.citation_id),
    chunkId: String(c.chunk_id),
    docId: String(c.doc_id),
    docTitle: String(c.doc_title),
    sectionPath: Array.isArray(c.section_path) ? c.section_path.map(String) : [],
    charRange: {
      start: Number(cr.start ?? 0),
      end: Number(cr.end ?? 0),
    },
    score: Number(c.score ?? 0),
    snippet: String(c.snippet),
    content: String(c.content),
  };
}
