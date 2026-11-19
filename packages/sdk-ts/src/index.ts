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
  onBehalfOf?: Record<string, unknown> | null;
  action: string;
  resource: Record<string, unknown>;
  decision: string | null;
  policyIds?: string[] | null;
  hash: string;
  prevHash: string;
}

export interface RoleDto {
  id: string;
  name: string;
  isSystem: boolean;
  permissions?: Record<string, 'all' | 'own'>;
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

export interface SecretMetadataDto {
  id: string;
  ref: string;
  orgId: string;
  provider: 'db' | 'vault';
  name: string;
  environmentId: string | null;
  keyVersion: number;
  kekVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetDto {
  id: string;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
  agentId: string | null;
  scopeType: 'org' | 'workspace' | 'project' | 'agent';
  scopeId: string;
  period: 'daily' | 'weekly' | 'monthly';
  softLimitMicroUsd: number | null;
  hardLimitMicroUsd: number | null;
  softLimitTokens: number | null;
  hardLimitTokens: number | null;
  spentMicroUsd: number;
  spentTokens: number;
  actionOnBreach: 'downgrade_model' | 'require_approval' | 'stop';
  alertEmittedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KillSwitchDto {
  id: string;
  orgId: string;
  workspaceId: string | null;
  scopeType: 'global' | 'workspace' | 'agent' | 'tool';
  scopeId: string;
  active: boolean;
  reason: string;
  activatedBy: string;
  activatedAt: string;
  deactivatedBy: string | null;
  deactivatedAt: string | null;
}

export interface AuditVerifyDto {
  valid: boolean;
  checkedCount: number;
  brokenAtSeq?: number;
  reason?: string;
}

export interface AgentIdentityDto {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  principalId: string;
  environmentId: string;
  displayName: string;
  allowedToolIds: string[];
  tokenTtlSeconds: number;
  status: 'active' | 'disabled';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentIdentityTokenDto {
  tokenId: string;
  agentIdentityId: string;
  agentPrincipalId: string;
  agentId: string;
  orgId: string;
  workspaceId: string;
  environmentId: string;
  onBehalfOfPrincipalId: string | null;
  allowedToolIds: string[];
  expiresAt: string;
}

export interface ToolGrantDto {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string;
  toolId: string;
  sideEffectClass: 'read' | 'write' | 'destructive' | 'external_comms';
  scope: {
    allowedDomains?: string[];
    allowedMethods?: string[];
    maxCallsPerRun?: number;
  };
  grantedBy: string;
  approvedBy: string | null;
  status: 'active' | 'revoked';
  createdAt: string;
}

export type PolicyPointDto =
  | 'tool_call'
  | 'data_access'
  | 'memory_read'
  | 'memory_write'
  | 'model_select'
  | 'egress'
  | 'promotion'
  | 'publish';

export interface PolicyConditionDto {
  points?: PolicyPointDto[];
  sideEffectClasses?: Array<'read' | 'write' | 'destructive' | 'external_comms'>;
  environments?: Array<'dev' | 'staging' | 'prod'>;
  toolNames?: string[];
  maxAutonomyLevel?: number;
  untrustedContentInContext?: boolean;
  dataClassifications?: string[];
  maxSpendMicroUsd?: number;
  riskTiers?: Array<'low' | 'medium' | 'high'>;
}

export interface PolicyDto {
  id: string;
  orgId: string;
  workspaceId: string | null;
  slug: string;
  name: string;
  description: string | null;
  point: PolicyPointDto;
  mode: 'audit_only' | 'enforce';
  version: number;
  effect: 'allow' | 'deny' | 'require_approval';
  condition: PolicyConditionDto;
  regoSource: string;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicySimulationReportDto {
  policyId: string;
  policySlug: string;
  totalRunsEvaluated: number;
  matchedCount: number;
  blockedCount: number;
  approvalRequiredCount: number;
  sampleAffectedRunIds: string[];
  durationMs: number;
}

export interface AuditExportDto {
  format: 'csv' | 'json';
  contentType: string;
  data: string;
  rowCount: number;
  chainValid: boolean;
}

export interface EvidencePackDto {
  packId: string;
  orgId: string;
  workspaceId: string | null;
  generatedAt: string;
  generatedBy: string;
  chainVerification: AuditVerifyDto;
  agents: Array<{ id: string; name: string; status: string; versionsCount: number }>;
  policies: PolicyDto[];
  toolGrants: ToolGrantDto[];
  agentIdentities: AgentIdentityDto[];
  auditSample: AuditEventDto[];
  digestSha256: string;
}

export interface ApprovalDecisionDto {
  id: string;
  approvalId: string;
  orgId: string;
  decidedBy: string;
  decision: 'approve' | 'reject' | 'approve_with_edit' | 'request_info' | 'provide_info' | 'delegate';
  reason: string | null;
  editedPayload: Record<string, unknown> | null;
  channel: 'console' | 'slack' | 'email' | 'api';
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  orgId: string;
  workspaceId: string;
  runId: string;
  stepId: string;
  type: 'tool_call' | 'promotion' | 'write_grant' | 'policy_enforce' | 'workflow_gate' | 'custom';
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'info_requested';
  payload: {
    title: string;
    summary: string;
    proposedAction: { tool?: string; args: Record<string, unknown> };
    diff?: { before: Record<string, unknown>; after: Record<string, unknown> };
    risk: 'low' | 'medium' | 'high';
    amount?: { value: number; currency: string };
    evidence: Array<{ type: string; stepId?: string; docId?: string; summary?: string }>;
    confidence?: number | null;
    policyReason?: string;
    editSchema?: Record<string, unknown>;
  };
  requestedFrom: Array<{ type: 'role' | 'user'; id: string }>;
  requiredDecisions: number;
  separationOfDuties: boolean;
  initiatedBy: string;
  delegatedTo: string | null;
  expiresAt: string | null;
  onTimeout: 'reject' | 'escalate' | 'approve';
  autoApproveOnTimeout: boolean;
  escalatedAt: string | null;
  snoozedUntil: string | null;
  infoRequestQuestion: string | null;
  infoRequestAnswer: string | null;
  allowedActions: Array<'approve' | 'reject' | 'approve_with_edit' | 'request_info'>;
  decisions: ApprovalDecisionDto[];
  createdAt: string;
  decidedAt: string | null;
}

export interface NotificationDto {
  id: string;
  orgId: string;
  workspaceId: string | null;
  approvalId: string | null;
  channel: 'slack' | 'email' | 'in_app' | 'webhook';
  recipient: string;
  subject: string;
  body: string;
  actionLinks: Record<string, unknown>;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
}

export interface DatasetDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseDto {
  id: string;
  orgId: string;
  workspaceId: string;
  datasetId: string;
  name: string;
  inputs: Record<string, unknown>;
  expectedOutput: Record<string, unknown> | null;
  rubric: Record<string, unknown>;
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard' | 'adversarial';
  weight: number;
  sourceRunId: string | null;
  sourceStepId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraderDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  type: 'exact_match' | 'json_schema' | 'code_assertion' | 'llm_judge';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  datasetId: string;
  agentVersionId: string;
  baselineVersionId: string | null;
  graderIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  releaseGateConfig: Record<string, unknown>;
  gateVerdict: 'passed' | 'failed' | 'warning' | null;
  metrics: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExperimentResultDto {
  id: string;
  orgId: string;
  experimentId: string;
  testCaseId: string;
  runId: string | null;
  actualOutput: Record<string, unknown> | null;
  graderResults: Record<string, unknown>[];
  passed: boolean;
  score: number;
  durationMs: number;
  costMicroUsd: number;
  isRegression: boolean;
  diff: Record<string, unknown> | null;
  createdAt: string;
}

export type TeamPatternDto =
  | 'supervisor_specialists'
  | 'sequential_pipeline'
  | 'parallel_fanout_aggregate'
  | 'critic_pair'
  | 'router';

export type TeamMemberRoleDto = 'supervisor' | 'specialist' | 'critic' | 'worker' | 'router';

export interface TeamMemberDto {
  id: string;
  teamId: string;
  agentId: string;
  role: TeamMemberRoleDto;
  readKeys: string[];
  writeKeys: string[];
  maxSteps: number;
  timeoutSeconds: number;
  maxSpendMicroUsd: number;
  createdAt: string;
}

export interface TeamHandoffDto {
  id: string;
  teamId: string;
  fromAgentId: string;
  toAgentId: string;
  name: string;
  description: string | null;
  handoffSchema: Record<string, unknown>;
  returnSchema: Record<string, unknown>;
  createdAt: string;
}

export interface TeamDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  pattern: TeamPatternDto;
  supervisorAgentId: string | null;
  members: TeamMemberDto[];
  handoffs: TeamHandoffDto[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BlackboardDto {
  id: string;
  orgId: string;
  workspaceId: string;
  runId: string;
  version: number;
  state: Record<string, unknown>;
  history: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageDto {
  id: string;
  orgId: string;
  workspaceId: string;
  runId: string;
  senderAgentId: string;
  receiverAgentId: string;
  purpose: 'delegation_request' | 'delegation_response' | 'blackboard_update' | 'critic_feedback' | 'error_rejection';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TeamSimulationDto {
  rootRunId: string;
  finalOutput: Record<string, unknown>;
  blackboard: BlackboardDto;
  messages: AgentMessageDto[];
  childRuns: Array<{
    childRunId: string;
    parentRunId: string;
    agentId: string;
    role: string;
    status: string;
    tokensIn: number;
    tokensOut: number;
    costMicroUsd: number;
    durationMs: number;
  }>;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostMicroUsd: number;
  durationMs: number;
}

export interface CustomToolDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  version: string;
  description: string;
  sideEffectClass: 'read' | 'write' | 'destructive' | 'external_comms';
  implementation: 'http' | 'sandbox_js' | 'sandbox_python' | 'mcp' | 'workflow' | 'builtin';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  config: Record<string, unknown>;
  tags: string[];
  owner: string | null;
  status: 'active' | 'deprecated' | 'disabled';
  untrustedSource: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OpenApiImportResultDto {
  specTitle: string;
  specVersion: string;
  baseUrl: string;
  importedTools: CustomToolDto[];
}

export interface TestToolResultDto {
  toolName: string;
  dryRun: boolean;
  validArgs: boolean;
  rawResult: unknown;
  sanitizedText: string;
  wrappedObservation: string;
  untrustedSource: boolean;
  injectionSuspected: boolean;
}

export interface McpServerDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  transport: 'sse' | 'stdio' | 'http';
  endpoint: string;
  status: 'connected' | 'disconnected' | 'error';
  metadata: Record<string, unknown>;
  lastHealthCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerToolDto {
  id: string;
  orgId: string;
  workspaceId: string;
  mcpServerId: string;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  sideEffectClass: 'read' | 'write' | 'destructive' | 'external_comms';
  approvalStatus: 'pending_approval' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorManifestDto {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  authTypes: Array<'api_key' | 'oauth2' | 'basic' | 'jwt' | 'mtls' | 'aws_sigv4' | 'custom'>;
  scopes: string[];
  egressDomains: string[];
  actions: Array<{
    name: string;
    description: string;
    sideEffectClass: 'read' | 'write' | 'destructive' | 'external_comms';
    idempotent: boolean;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    rateLimitPerMinute: number;
    pagination: 'none' | 'cursor' | 'offset' | 'page';
  }>;
  triggers: Array<{
    name: string;
    type: 'webhook' | 'polling';
    description: string;
    verifyHeader?: string;
  }>;
}

export interface ConnectorContractTestResultDto {
  connectorId: string;
  passed: boolean;
  totalFixtures: number;
  passedFixtures: number;
  details: Array<{
    fixtureName: string;
    action: string;
    passed: boolean;
    errors: string[];
  }>;
}

export interface ConnectionDto {
  id: string;
  orgId: string;
  workspaceId: string;
  connectorId: string;
  name: string;
  authType: 'api_key' | 'oauth2' | 'basic' | 'jwt' | 'mtls' | 'aws_sigv4' | 'custom';
  sharingMode: 'personal' | 'shared';
  ownerId: string;
  environmentMapping: Record<string, string>;
  secretVersion: number;
  secretMasked: string;
  scopes: string[];
  allowedAgents: string[];
  egressDomains: string[];
  status: 'healthy' | 'expiring' | 'failed' | 'pending_approval';
  lastTestedAt: string | null;
  lastError: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResponseDto {
  connection: ConnectionDto;
  healthy: boolean;
  scopesGranted: string[];
  latencyMs: number;
}

export interface DeploymentDto {
  id: string;
  orgId: string;
  workspaceId: string;
  environment: 'dev' | 'staging' | 'prod';
  subjectType: 'agent' | 'workflow';
  subjectId: string;
  versionId: string;
  previousVersionId: string | null;
  channel: string;
  trafficPct: number;
  status: 'active' | 'canary' | 'rolled_back';
  deployedBy: string;
  deployedAt: string;
}

export interface PromotionDto {
  id: string;
  orgId: string;
  workspaceId: string;
  subjectType: 'agent' | 'workflow';
  subjectId: string;
  versionId: string;
  fromEnv: 'dev' | 'staging' | 'prod';
  toEnv: 'dev' | 'staging' | 'prod';
  status: 'pending_approval' | 'approved' | 'rejected' | 'deployed' | 'rolled_back' | 'failed';
  evalGatePassed: boolean;
  evalScore: number | null;
  diffSummary: Record<string, unknown>;
  credentialMapping: Record<string, string>;
  canaryPct: number;
  initiatedBy: string;
  approvedBy: string | null;
  deploymentId: string | null;
  deployedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ObservabilityOverviewDto {
  windowHours: number;
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  successRate: number;
  failureRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalCostUsd: number;
  costPerRunUsd: number;
  costPerSuccessfulOutcomeUsd: number;
  tokensIn: number;
  tokensOut: number;
  queueDepth: number;
  approvalPendingCount: number;
  failureByClass: Array<{ failureClass: string; count: number }>;
  costByAgent: Array<{
    agentId: string;
    runs: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  costByModel: Array<{
    model: string;
    calls: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  dailySeries: Array<{
    bucket: string;
    runs: number;
    failed: number;
    costUsd: number;
  }>;
}

export interface FailureExplanationDto {
  runId: string;
  status: string;
  failureClass: string;
  rootCause: string;
  failingStepSeq: number | null;
  failingStepType: string | null;
  remediation: string[];
}

export interface AlertRuleDto {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  metric: 'failure_rate' | 'cost_spike' | 'latency_p95' | 'queue_depth';
  operator: 'gt' | 'gte';
  threshold: number;
  windowMinutes: number;
  channels: string[];
  enabled: boolean;
  lastFiredAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertIncidentDto {
  id: string;
  orgId: string;
  workspaceId: string;
  ruleId: string;
  metric: 'failure_rate' | 'cost_spike' | 'latency_p95' | 'queue_depth';
  observedValue: number;
  threshold: number;
  status: 'firing' | 'acknowledged' | 'resolved';
  summary: string;
  firedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
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
    onBehalfOf: (a.on_behalf_of as Record<string, unknown> | null | undefined) ?? null,
    action: String(a.action),
    resource: (a.resource as Record<string, unknown>) ?? {},
    decision: a.decision ? String(a.decision) : null,
    policyIds: Array.isArray(a.policy_ids) ? a.policy_ids.map(String) : null,
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
        permissions: r.permissions as Record<string, 'all' | 'own'> | undefined,
      }));
    },
    create: async (
      input: { name: string; permissions: Record<string, 'all' | 'own'> },
      idempotencyKey?: string,
    ): Promise<RoleDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/roles', {
        body: {
          name: input.name,
          permissions: input.permissions,
        },
        idempotencyKey,
      });
      return {
        id: String(res.id),
        name: String(res.name),
        isSystem: Boolean(res.is_system),
        permissions: res.permissions as Record<string, 'all' | 'own'> | undefined,
      };
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
    list: async (
      opts: {
        limit?: number;
        cursor?: string;
        action?: string;
        actorId?: string;
        resourceType?: string;
        decision?: string;
        fromTs?: string;
        toTs?: string;
      } = {},
    ): Promise<{
      data: AuditEventDto[];
      nextCursor: string | null;
    }> => {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      if (opts.action) params.set('action', opts.action);
      if (opts.actorId) params.set('actor_id', opts.actorId);
      if (opts.resourceType) params.set('resource_type', opts.resourceType);
      if (opts.decision) params.set('decision', opts.decision);
      if (opts.fromTs) params.set('from_ts', opts.fromTs);
      if (opts.toTs) params.set('to_ts', opts.toTs);
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
    verify: async (): Promise<AuditVerifyDto> => {
      const res = await this.request<Record<string, unknown>>('GET', '/api/v1/audit/verify');
      return mapAuditVerify(res);
    },
  };

  readonly audit = {
    verify: async (): Promise<AuditVerifyDto> => this.auditEvents.verify(),
    export: async (
      opts: {
        format?: 'csv' | 'json';
        action?: string;
        actorId?: string;
        resourceType?: string;
        decision?: string;
        fromTs?: string;
        toTs?: string;
      } = {},
    ): Promise<AuditExportDto> => {
      const params = new URLSearchParams();
      if (opts.format) params.set('format', opts.format);
      if (opts.action) params.set('action', opts.action);
      if (opts.actorId) params.set('actor_id', opts.actorId);
      if (opts.resourceType) params.set('resource_type', opts.resourceType);
      if (opts.decision) params.set('decision', opts.decision);
      if (opts.fromTs) params.set('from_ts', opts.fromTs);
      if (opts.toTs) params.set('to_ts', opts.toTs);
      const qs = params.toString();
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/audit/export${qs ? `?${qs}` : ''}`,
      );
      return {
        format: res.format as 'csv' | 'json',
        contentType: String(res.content_type),
        data: String(res.data),
        rowCount: Number(res.row_count ?? 0),
        chainValid: Boolean(res.chain_valid),
      };
    },
    generateEvidencePack: async (
      input: {
        workspaceId?: string;
        periodStart?: string;
        periodEnd?: string;
        sampleLimit?: number;
      } = {},
      idempotencyKey?: string,
    ): Promise<EvidencePackDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/audit/evidence-pack',
        {
          body: {
            workspace_id: input.workspaceId,
            period_start: input.periodStart,
            period_end: input.periodEnd,
            sample_limit: input.sampleLimit,
          },
          idempotencyKey,
        },
      );
      return mapEvidencePack(res);
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
    getBlackboard: async (id: string): Promise<BlackboardDto> => {
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/runs/${id}/blackboard`,
      );
      return mapBlackboard(res);
    },
    getAgentMessages: async (id: string): Promise<AgentMessageDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/runs/${id}/agent-messages`,
      );
      return res.items.map(mapAgentMessage);
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
    listCustom: async (): Promise<CustomToolDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>('GET', '/api/v1/tools/custom');
      return res.items.map(mapCustomTool);
    },
    createCustom: async (
      input: {
        name: string;
        version?: string;
        description: string;
        sideEffectClass?: CustomToolDto['sideEffectClass'];
        implementation?: CustomToolDto['implementation'];
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        config?: Record<string, unknown>;
        tags?: string[];
        untrustedSource?: boolean;
      },
      idempotencyKey?: string,
    ): Promise<CustomToolDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/tools/custom', {
        idempotencyKey: idempotencyKey ?? `tool-create-${Date.now()}`,
        body: {
          name: input.name,
          version: input.version,
          description: input.description,
          side_effect_class: input.sideEffectClass,
          implementation: input.implementation,
          input_schema: input.inputSchema,
          output_schema: input.outputSchema,
          config: input.config,
          tags: input.tags,
          untrusted_source: input.untrustedSource,
        },
      });
      return mapCustomTool(res);
    },
    importOpenApi: async (
      input: {
        spec: string | Record<string, unknown>;
        baseUrlOverride?: string;
        tags?: string[];
        register?: boolean;
      },
      idempotencyKey?: string,
    ): Promise<OpenApiImportResultDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/tools/import/openapi',
        {
          idempotencyKey: idempotencyKey ?? `openapi-import-${Date.now()}`,
          body: {
            spec: input.spec,
            base_url_override: input.baseUrlOverride,
            tags: input.tags,
            register: input.register ?? true,
          },
        },
      );
      const rawTools = Array.isArray(res.imported_tools) ? (res.imported_tools as Record<string, unknown>[]) : [];
      return {
        specTitle: String(res.spec_title),
        specVersion: String(res.spec_version),
        baseUrl: String(res.base_url),
        importedTools: rawTools.map(mapCustomTool),
      };
    },
    test: async (
      name: string,
      input: {
        args?: Record<string, unknown>;
        dryRun?: boolean;
        simulatedRawResult?: unknown;
      },
    ): Promise<TestToolResultDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/tools/${encodeURIComponent(name)}/test`,
        {
          idempotencyKey: `tool-test-${Date.now()}`,
          body: {
            args: input.args ?? {},
            dry_run: input.dryRun ?? true,
            simulated_raw_result: input.simulatedRawResult,
          },
        },
      );
      return mapTestToolResult(res);
    },
  };

  readonly mcp = {
    listServers: async (): Promise<McpServerDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>('GET', '/api/v1/mcp/servers');
      return res.items.map(mapMcpServer);
    },
    createServer: async (
      input: {
        name: string;
        transport: McpServerDto['transport'];
        endpoint: string;
        discoveredTools?: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
          sideEffectClass?: McpServerToolDto['sideEffectClass'];
        }>;
      },
      idempotencyKey?: string,
    ): Promise<{ server: McpServerDto; discoveredTools: McpServerToolDto[] }> => {
      const res = await this.request<{
        server: Record<string, unknown>;
        discovered_tools: Record<string, unknown>[];
      }>('POST', '/api/v1/mcp/servers', {
        idempotencyKey: idempotencyKey ?? `mcp-create-${Date.now()}`,
        body: {
          name: input.name,
          transport: input.transport,
          endpoint: input.endpoint,
          discovered_tools: input.discoveredTools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema ?? { type: 'object' },
            side_effect_class: t.sideEffectClass,
          })),
        },
      });
      return {
        server: mapMcpServer(res.server),
        discoveredTools: res.discovered_tools.map(mapMcpServerTool),
      };
    },
    listServerTools: async (serverId: string): Promise<McpServerToolDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/mcp/servers/${serverId}/tools`,
      );
      return res.items.map(mapMcpServerTool);
    },
    updateToolApproval: async (
      toolId: string,
      approvalStatus: McpServerToolDto['approvalStatus'],
    ): Promise<McpServerToolDto> => {
      const res = await this.request<Record<string, unknown>>(
        'PATCH',
        `/api/v1/mcp/tools/${toolId}/approval`,
        {
          body: { approval_status: approvalStatus },
        },
      );
      return mapMcpServerTool(res);
    },
    invokeTool: async (
      serverId: string,
      toolName: string,
      input: {
        args?: Record<string, unknown>;
        dryRun?: boolean;
        simulatedRawResult?: unknown;
      },
    ): Promise<TestToolResultDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}/invoke`,
        {
          idempotencyKey: `mcp-invoke-${Date.now()}`,
          body: {
            args: input.args ?? {},
            dry_run: input.dryRun ?? false,
            simulated_raw_result: input.simulatedRawResult,
          },
        },
      );
      return mapTestToolResult(res);
    },
  };

  readonly connectors = {
    list: async (): Promise<ConnectorManifestDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/connectors',
      );
      return res.items.map(mapConnectorManifest);
    },
    get: async (id: string): Promise<ConnectorManifestDto> => {
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/connectors/${encodeURIComponent(id)}`,
      );
      return mapConnectorManifest(res);
    },
    runContractTest: async (id: string): Promise<ConnectorContractTestResultDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/connectors/${encodeURIComponent(id)}/contract-test`,
        { idempotencyKey: `conn-contract-${id}-${Date.now()}`, body: {} },
      );
      return mapConnectorContractTestResult(res);
    },
  };

  readonly connections = {
    list: async (): Promise<ConnectionDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/connections',
      );
      return res.items.map(mapConnection);
    },
    create: async (
      input: {
        connectorId: string;
        name: string;
        authType: ConnectionDto['authType'];
        secretValue: string;
        sharingMode?: ConnectionDto['sharingMode'];
        environmentMapping?: Record<string, string>;
        scopes?: string[];
        allowedAgents?: string[];
        egressDomains?: string[];
      },
      idempotencyKey?: string,
    ): Promise<ConnectionDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/connections', {
        idempotencyKey: idempotencyKey ?? `conn-create-${Date.now()}`,
        body: {
          connector_id: input.connectorId,
          name: input.name,
          auth_type: input.authType,
          secret_value: input.secretValue,
          sharing_mode: input.sharingMode ?? 'shared',
          environment_mapping: input.environmentMapping,
          scopes: input.scopes,
          allowed_agents: input.allowedAgents,
          egress_domains: input.egressDomains,
        },
      });
      return mapConnection(res);
    },
    test: async (id: string): Promise<ConnectionTestResponseDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/connections/${id}/test`,
        { idempotencyKey: `conn-test-${id}-${Date.now()}`, body: {} },
      );
      return {
        connection: mapConnection(res.connection as Record<string, unknown>),
        healthy: Boolean(res.healthy),
        scopesGranted: Array.isArray(res.scopes_granted) ? (res.scopes_granted as string[]) : [],
        latencyMs: Number(res.latency_ms ?? 0),
      };
    },
    rotateSecret: async (id: string, secretValue: string): Promise<ConnectionDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/connections/${id}/rotate`,
        {
          idempotencyKey: `conn-rotate-${id}-${Date.now()}`,
          body: { secret_value: secretValue },
        },
      );
      return mapConnection(res);
    },
    executeAction: async (
      id: string,
      action: string,
      input: {
        args?: Record<string, unknown>;
        environment?: 'dev' | 'staging' | 'prod';
        agentId?: string;
        targetDomain?: string;
      },
    ): Promise<TestToolResultDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/connections/${id}/actions/${encodeURIComponent(action)}`,
        {
          idempotencyKey: `conn-act-${id}-${Date.now()}`,
          body: {
            args: input.args ?? {},
            environment: input.environment,
            agent_id: input.agentId,
            target_domain: input.targetDomain,
          },
        },
      );
      return mapTestToolResult(res);
    },
  };

  readonly deployments = {
    list: async (): Promise<DeploymentDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/deployments',
      );
      return res.items.map(mapDeployment);
    },
    rollback: async (id: string): Promise<DeploymentDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/deployments/${id}/rollback`,
        { idempotencyKey: `dep-rollback-${id}-${Date.now()}`, body: {} },
      );
      return mapDeployment(res);
    },
  };

  readonly promotions = {
    list: async (): Promise<PromotionDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/promotions',
      );
      return res.items.map(mapPromotion);
    },
    create: async (
      input: {
        subjectType: 'agent' | 'workflow';
        subjectId: string;
        versionId: string;
        versionPublished?: boolean;
        fromEnv: 'dev' | 'staging' | 'prod';
        toEnv: 'dev' | 'staging' | 'prod';
        requiredCredentials?: string[];
        credentialMapping?: Record<string, string>;
        evalGatePassed?: boolean;
        evalScore?: number | null;
        canaryPct?: number;
        diffFields?: string[];
      },
      idempotencyKey?: string,
    ): Promise<{ promotion: PromotionDto; deployment: DeploymentDto | null }> => {
      const res = await this.request<{
        promotion: Record<string, unknown>;
        deployment: Record<string, unknown> | null;
      }>('POST', '/api/v1/promotions', {
        idempotencyKey: idempotencyKey ?? `promo-create-${Date.now()}`,
        body: {
          subject_type: input.subjectType,
          subject_id: input.subjectId,
          version_id: input.versionId,
          version_published: input.versionPublished ?? true,
          from_env: input.fromEnv,
          to_env: input.toEnv,
          required_credentials: input.requiredCredentials ?? [],
          credential_mapping: input.credentialMapping ?? {},
          eval_gate_passed: input.evalGatePassed,
          eval_score: input.evalScore,
          canary_pct: input.canaryPct ?? 100,
          diff_fields: input.diffFields,
        },
      });
      return {
        promotion: mapPromotion(res.promotion),
        deployment: res.deployment ? mapDeployment(res.deployment) : null,
      };
    },
    approve: async (id: string): Promise<{ promotion: PromotionDto; deployment: DeploymentDto | null }> => {
      const res = await this.request<{
        promotion: Record<string, unknown>;
        deployment: Record<string, unknown> | null;
      }>('POST', `/api/v1/promotions/${id}/approve`, {
        idempotencyKey: `promo-approve-${id}-${Date.now()}`,
        body: {},
      });
      return {
        promotion: mapPromotion(res.promotion),
        deployment: res.deployment ? mapDeployment(res.deployment) : null,
      };
    },
    reject: async (id: string): Promise<PromotionDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/promotions/${id}/reject`,
        { idempotencyKey: `promo-reject-${id}-${Date.now()}`, body: {} },
      );
      return mapPromotion(res);
    },
  };

  readonly observability = {
    overview: async (windowHours = 24): Promise<ObservabilityOverviewDto> => {
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/observability/overview?window_hours=${windowHours}`,
      );
      return mapObservabilityOverview(res);
    },
    explainFailure: async (runId: string): Promise<FailureExplanationDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/runs/${runId}/explain-failure`,
        { idempotencyKey: `explain-${runId}`, body: {} },
      );
      return mapFailureExplanation(res);
    },
    exportOtel: async (runId: string): Promise<Record<string, unknown>> => {
      return this.request<Record<string, unknown>>('GET', `/api/v1/runs/${runId}/otel`);
    },
  };

  readonly alerts = {
    listRules: async (): Promise<AlertRuleDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/observability/alerts/rules',
      );
      return res.data.map(mapAlertRule);
    },
    createRule: async (
      input: {
        name: string;
        metric: AlertRuleDto['metric'];
        operator?: 'gt' | 'gte';
        threshold: number;
        windowMinutes?: number;
        channels?: string[];
        enabled?: boolean;
      },
      idempotencyKey?: string,
    ): Promise<AlertRuleDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/observability/alerts/rules',
        {
          idempotencyKey: idempotencyKey ?? `alert-rule-${Date.now()}`,
          body: {
            name: input.name,
            metric: input.metric,
            operator: input.operator ?? 'gt',
            threshold: input.threshold,
            window_minutes: input.windowMinutes ?? 5,
            channels: input.channels ?? ['in_app'],
            enabled: input.enabled ?? true,
          },
        },
      );
      return mapAlertRule(res);
    },
    deleteRule: async (id: string): Promise<void> => {
      await this.request('DELETE', `/api/v1/observability/alerts/rules/${id}`);
    },
    evaluate: async (): Promise<{ evaluatedCount: number; firedIncidents: AlertIncidentDto[] }> => {
      const res = await this.request<{
        evaluated_count: number;
        fired_incidents: Record<string, unknown>[];
      }>('POST', '/api/v1/observability/alerts/evaluate', {
        idempotencyKey: `alert-eval-${Date.now()}`,
        body: {},
      });
      return {
        evaluatedCount: Number(res.evaluated_count ?? 0),
        firedIncidents: (res.fired_incidents ?? []).map(mapAlertIncident),
      };
    },
    listIncidents: async (): Promise<AlertIncidentDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/observability/alerts/incidents',
      );
      return res.data.map(mapAlertIncident);
    },
    acknowledgeIncident: async (id: string): Promise<AlertIncidentDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/observability/alerts/incidents/${id}/acknowledge`,
        { idempotencyKey: `ack-inc-${id}`, body: {} },
      );
      return mapAlertIncident(res);
    },
    resolveIncident: async (id: string): Promise<AlertIncidentDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/observability/alerts/incidents/${id}/resolve`,
        { idempotencyKey: `resolve-inc-${id}`, body: {} },
      );
      return mapAlertIncident(res);
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

  readonly secrets = {
    list: async (): Promise<SecretMetadataDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/secrets',
      );
      return res.data.map(mapSecretMetadata);
    },
    put: async (
      input: { name: string; value: string; environmentId?: string },
      idempotencyKey = `sdk-secret-put-${Date.now()}`,
    ): Promise<SecretMetadataDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/secrets', {
        body: {
          name: input.name,
          value: input.value,
          environment_id: input.environmentId,
        },
        idempotencyKey,
      });
      return mapSecretMetadata(res);
    },
    rotate: async (
      id: string,
      value: string,
      idempotencyKey = `sdk-secret-rot-${Date.now()}`,
    ): Promise<SecretMetadataDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/secrets/${id}/rotate`,
        {
          body: { value },
          idempotencyKey,
        },
      );
      return mapSecretMetadata(res);
    },
    delete: async (id: string): Promise<void> => {
      await this.request<void>('DELETE', `/api/v1/secrets/${id}`);
    },
  };

  readonly budgets = {
    list: async (): Promise<BudgetDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/budgets',
      );
      return res.data.map(mapBudget);
    },
    upsert: async (
      input: {
        scopeType: 'org' | 'workspace' | 'project' | 'agent';
        scopeId: string;
        period?: 'daily' | 'weekly' | 'monthly';
        workspaceId?: string | null;
        projectId?: string | null;
        agentId?: string | null;
        softLimitMicroUsd?: number | null;
        hardLimitMicroUsd?: number | null;
        softLimitTokens?: number | null;
        hardLimitTokens?: number | null;
        actionOnBreach?: 'downgrade_model' | 'require_approval' | 'stop';
      },
      idempotencyKey = `sdk-budget-upsert-${Date.now()}`,
    ): Promise<BudgetDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/budgets', {
        body: {
          scope_type: input.scopeType,
          scope_id: input.scopeId,
          period: input.period ?? 'monthly',
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          agent_id: input.agentId,
          soft_limit_micro_usd: input.softLimitMicroUsd,
          hard_limit_micro_usd: input.hardLimitMicroUsd,
          soft_limit_tokens: input.softLimitTokens,
          hard_limit_tokens: input.hardLimitTokens,
          action_on_breach: input.actionOnBreach ?? 'stop',
        },
        idempotencyKey,
      });
      return mapBudget(res);
    },
  };

  readonly killswitches = {
    list: async (): Promise<KillSwitchDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/killswitches',
      );
      return res.data.map(mapKillSwitch);
    },
    activate: async (
      input: {
        scopeType: 'global' | 'workspace' | 'agent' | 'tool';
        scopeId?: string;
        workspaceId?: string | null;
        reason: string;
      },
      idempotencyKey = `sdk-ks-act-${Date.now()}`,
    ): Promise<KillSwitchDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/killswitches', {
        body: {
          scope_type: input.scopeType,
          scope_id: input.scopeId,
          workspace_id: input.workspaceId,
          reason: input.reason,
        },
        idempotencyKey,
      });
      return mapKillSwitch(res);
    },
    deactivate: async (
      id: string,
      idempotencyKey = `sdk-ks-deact-${Date.now()}`,
    ): Promise<KillSwitchDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/killswitches/${id}/deactivate`,
        {
          idempotencyKey,
        },
      );
      return mapKillSwitch(res);
    },
  };

  readonly agentIdentities = {
    list: async (): Promise<AgentIdentityDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/agent-identities',
      );
      return res.data.map(mapAgentIdentity);
    },
    create: async (
      input: {
        workspaceId?: string;
        agentId: string;
        environmentId?: string;
        environment?: 'dev' | 'staging' | 'prod';
        displayName: string;
        allowedToolIds?: string[];
        tokenTtlSeconds?: number;
      },
      idempotencyKey?: string,
    ): Promise<AgentIdentityDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/agent-identities', {
        body: {
          workspace_id: input.workspaceId,
          agent_id: input.agentId,
          environment_id: input.environmentId,
          environment: input.environment,
          display_name: input.displayName,
          allowed_tool_ids: input.allowedToolIds ?? [],
          token_ttl_seconds: input.tokenTtlSeconds,
        },
        idempotencyKey,
      });
      return mapAgentIdentity(res);
    },
    issueToken: async (
      id: string,
      input: {
        onBehalfOfPrincipalId?: string;
        environmentId?: string;
        ttlSeconds?: number;
      } = {},
      idempotencyKey?: string,
    ): Promise<AgentIdentityTokenDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/agent-identities/${id}/token`,
        {
          body: {
            on_behalf_of_principal_id: input.onBehalfOfPrincipalId,
            environment_id: input.environmentId,
            ttl_seconds: input.ttlSeconds,
          },
          idempotencyKey,
        },
      );
      return mapAgentIdentityToken(res);
    },
  };

  readonly toolGrants = {
    list: async (): Promise<ToolGrantDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/tool-grants',
      );
      return res.data.map(mapToolGrant);
    },
    create: async (
      input: {
        workspaceId?: string;
        agentId: string;
        toolId: string;
        sideEffectClass?: 'read' | 'write' | 'destructive' | 'external_comms';
        scope?: {
          allowedDomains?: string[];
          allowedMethods?: string[];
          maxCallsPerRun?: number;
        };
        approvedBy?: string;
      },
      idempotencyKey?: string,
    ): Promise<ToolGrantDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/tool-grants', {
        body: {
          workspace_id: input.workspaceId,
          agent_id: input.agentId,
          tool_id: input.toolId,
          side_effect_class: input.sideEffectClass ?? 'read',
          scope: input.scope
            ? {
                allowed_domains: input.scope.allowedDomains,
                allowed_methods: input.scope.allowedMethods,
                max_calls_per_run: input.scope.maxCallsPerRun,
              }
            : undefined,
          approved_by: input.approvedBy,
        },
        idempotencyKey,
      });
      return mapToolGrant(res);
    },
    revoke: async (id: string): Promise<void> => {
      await this.request<void>('DELETE', `/api/v1/tool-grants/${id}`);
    },
  };

  readonly policies = {
    list: async (): Promise<PolicyDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/policies');
      return res.data.map(mapPolicy);
    },
    create: async (
      input: {
        workspaceId?: string | null;
        slug: string;
        name: string;
        description?: string;
        point: PolicyPointDto;
        effect: 'allow' | 'deny' | 'require_approval';
        mode?: 'audit_only' | 'enforce';
        condition?: PolicyConditionDto;
        regoSource?: string;
        approvedBy?: string;
      },
      idempotencyKey?: string,
    ): Promise<PolicyDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/policies', {
        body: {
          workspace_id: input.workspaceId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          point: input.point,
          effect: input.effect,
          mode: input.mode ?? 'audit_only',
          condition: toWireCondition(input.condition),
          rego_source: input.regoSource,
          approved_by: input.approvedBy,
        },
        idempotencyKey,
      });
      return mapPolicy(res);
    },
    enforce: async (
      id: string,
      input: { secondApproverId?: string } = {},
      idempotencyKey?: string,
    ): Promise<PolicyDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/policies/${id}/enforce`,
        {
          body: {
            second_approver_id: input.secondApproverId,
          },
          idempotencyKey,
        },
      );
      return mapPolicy(res);
    },
    simulate: async (
      input: {
        policyId?: string;
        slug?: string;
        point?: PolicyPointDto;
        effect?: 'allow' | 'deny' | 'require_approval';
        condition?: PolicyConditionDto;
        runs?: Array<{
          runId: string;
          point?: PolicyPointDto;
          environment?: 'dev' | 'staging' | 'prod';
          autonomyLevel?: number;
          sideEffectClass?: 'read' | 'write' | 'destructive' | 'external_comms';
          toolName?: string;
          untrustedContentInContext?: boolean;
          dataClassifications?: string[];
          cumulativeSpendMicroUsd?: number;
          riskTier?: 'low' | 'medium' | 'high';
        }>;
      },
      idempotencyKey?: string,
    ): Promise<PolicySimulationReportDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/policies/simulate',
        {
          body: {
            policy_id: input.policyId,
            slug: input.slug,
            point: input.point,
            effect: input.effect,
            condition: toWireCondition(input.condition),
            runs: input.runs?.map((r) => ({
              run_id: r.runId,
              point: r.point,
              environment: r.environment,
              autonomy_level: r.autonomyLevel,
              side_effect_class: r.sideEffectClass,
              tool_name: r.toolName,
              untrusted_content_in_context: r.untrustedContentInContext,
              data_classifications: r.dataClassifications,
              cumulative_spend_micro_usd: r.cumulativeSpendMicroUsd,
              risk_tier: r.riskTier,
            })),
          },
          idempotencyKey,
        },
      );
      return mapPolicySimulationReport(res);
    },
  };

  readonly approvals = {
    list: async (status?: ApprovalDto['status']): Promise<ApprovalDto[]> => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/approvals${qs}`,
      );
      return res.data.map(mapApproval);
    },
    get: async (id: string): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>('GET', `/api/v1/approvals/${id}`);
      return mapApproval(res);
    },
    create: async (
      input: {
        workspaceId?: string;
        runId: string;
        stepId: string;
        type?: ApprovalDto['type'];
        payload: ApprovalDto['payload'];
        requestedFrom?: Array<{ type: 'role' | 'user'; id: string }>;
        requiredDecisions?: number;
        separationOfDuties?: boolean;
        ttlMs?: number;
        onTimeout?: ApprovalDto['onTimeout'];
      },
      idempotencyKey?: string,
    ): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/approvals', {
        body: {
          workspace_id: input.workspaceId,
          run_id: input.runId,
          step_id: input.stepId,
          type: input.type ?? 'tool_call',
          payload: {
            title: input.payload.title,
            summary: input.payload.summary,
            proposed_action: input.payload.proposedAction,
            diff: input.payload.diff,
            risk: input.payload.risk,
            amount: input.payload.amount,
            evidence: input.payload.evidence.map((e) => ({
              type: e.type,
              step_id: e.stepId,
              doc_id: e.docId,
              summary: e.summary,
            })),
            confidence: input.payload.confidence,
            policy_reason: input.payload.policyReason,
            edit_schema: input.payload.editSchema,
          },
          requested_from: input.requestedFrom,
          required_decisions: input.requiredDecisions,
          separation_of_duties: input.separationOfDuties,
          ttl_ms: input.ttlMs,
          on_timeout: input.onTimeout,
        },
        idempotencyKey,
      });
      return mapApproval(res);
    },
    decide: async (
      id: string,
      input: {
        decision: 'approve' | 'reject' | 'approve_with_edit';
        reason?: string;
        editedPayload?: Record<string, unknown>;
        channel?: 'console' | 'slack' | 'email' | 'api';
        confirmKeyword?: string;
      },
      idempotencyKey?: string,
    ): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/approvals/${id}/decide`,
        {
          body: {
            decision: input.decision,
            reason: input.reason,
            edited_payload: input.editedPayload,
            channel: input.channel ?? 'console',
            confirm_keyword: input.confirmKeyword,
          },
          idempotencyKey,
        },
      );
      return mapApproval(res);
    },
    requestInfo: async (
      id: string,
      question: string,
      idempotencyKey?: string,
    ): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/approvals/${id}/request-info`,
        { body: { question }, idempotencyKey },
      );
      return mapApproval(res);
    },
    provideInfo: async (
      id: string,
      answer: string,
      idempotencyKey?: string,
    ): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/approvals/${id}/provide-info`,
        { body: { answer }, idempotencyKey },
      );
      return mapApproval(res);
    },
    delegate: async (
      id: string,
      delegateToPrincipalId: string,
      idempotencyKey?: string,
    ): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/approvals/${id}/delegate`,
        { body: { delegate_to_principal_id: delegateToPrincipalId }, idempotencyKey },
      );
      return mapApproval(res);
    },
    snooze: async (
      id: string,
      snoozeUntilIso: string,
      idempotencyKey?: string,
    ): Promise<ApprovalDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/approvals/${id}/snooze`,
        { body: { snooze_until: snoozeUntilIso }, idempotencyKey },
      );
      return mapApproval(res);
    },
    processTimeouts: async (idempotencyKey?: string): Promise<ApprovalDto[]> => {
      const res = await this.request<{ processed: Record<string, unknown>[] }>(
        'POST',
        '/api/v1/approvals/process-timeouts',
        { body: {}, idempotencyKey },
      );
      return res.processed.map(mapApproval);
    },
  };

  readonly notifications = {
    list: async (): Promise<NotificationDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/notifications',
      );
      return res.data.map(mapNotification);
    },
  };

  readonly evaluations = {
    datasets: {
      list: async (): Promise<DatasetDto[]> => {
        const res = await this.request<{ items: Record<string, unknown>[] }>(
          'GET',
          '/api/v1/eval/datasets',
        );
        return res.items.map(mapDataset);
      },
      create: async (input: {
        name: string;
        description?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
      }): Promise<DatasetDto> => {
        const res = await this.request<Record<string, unknown>>(
          'POST',
          '/api/v1/eval/datasets',
          { body: input },
        );
        return mapDataset(res);
      },
      get: async (id: string): Promise<DatasetDto> => {
        const res = await this.request<Record<string, unknown>>(
          'GET',
          `/api/v1/eval/datasets/${id}`,
        );
        return mapDataset(res);
      },
      listTestCases: async (datasetId: string): Promise<TestCaseDto[]> => {
        const res = await this.request<{ items: Record<string, unknown>[] }>(
          'GET',
          `/api/v1/eval/datasets/${datasetId}/test-cases`,
        );
        return res.items.map(mapTestCase);
      },
      createTestCase: async (
        datasetId: string,
        input: {
          name: string;
          inputs: Record<string, unknown>;
          expectedOutput?: Record<string, unknown>;
          rubric?: Record<string, unknown>;
          tags?: string[];
          difficulty?: 'easy' | 'medium' | 'hard' | 'adversarial';
          weight?: number;
          sourceRunId?: string;
          sourceStepId?: string;
        },
      ): Promise<TestCaseDto> => {
        const res = await this.request<Record<string, unknown>>(
          'POST',
          `/api/v1/eval/datasets/${datasetId}/test-cases`,
          {
            body: {
              name: input.name,
              inputs: input.inputs,
              expected_output: input.expectedOutput,
              rubric: input.rubric,
              tags: input.tags,
              difficulty: input.difficulty,
              weight: input.weight,
              source_run_id: input.sourceRunId,
              source_step_id: input.sourceStepId,
            },
          },
        );
        return mapTestCase(res);
      },
    },
    graders: {
      list: async (): Promise<GraderDto[]> => {
        const res = await this.request<{ items: Record<string, unknown>[] }>(
          'GET',
          '/api/v1/eval/graders',
        );
        return res.items.map(mapGrader);
      },
      create: async (input: {
        name: string;
        description?: string;
        type: 'exact_match' | 'json_schema' | 'code_assertion' | 'llm_judge';
        config?: Record<string, unknown>;
      }): Promise<GraderDto> => {
        const res = await this.request<Record<string, unknown>>(
          'POST',
          '/api/v1/eval/graders',
          { body: input },
        );
        return mapGrader(res);
      },
    },
    experiments: {
      list: async (): Promise<ExperimentDto[]> => {
        const res = await this.request<{ items: Record<string, unknown>[] }>(
          'GET',
          '/api/v1/eval/experiments',
        );
        return res.items.map(mapExperiment);
      },
      create: async (input: {
        name: string;
        datasetId: string;
        agentVersionId: string;
        baselineVersionId?: string;
        graderIds?: string[];
        releaseGateConfig?: Record<string, unknown>;
      }): Promise<ExperimentDto> => {
        const res = await this.request<Record<string, unknown>>(
          'POST',
          '/api/v1/eval/experiments',
          {
            body: {
              name: input.name,
              dataset_id: input.datasetId,
              agent_version_id: input.agentVersionId,
              baseline_version_id: input.baselineVersionId,
              grader_ids: input.graderIds ?? [],
              release_gate_config: input.releaseGateConfig,
            },
          },
        );
        return mapExperiment(res);
      },
      get: async (id: string): Promise<ExperimentDto> => {
        const res = await this.request<Record<string, unknown>>(
          'GET',
          `/api/v1/eval/experiments/${id}`,
        );
        return mapExperiment(res);
      },
      results: async (id: string): Promise<ExperimentResultDto[]> => {
        const res = await this.request<{ items: Record<string, unknown>[] }>(
          'GET',
          `/api/v1/eval/experiments/${id}/results`,
        );
        return res.items.map(mapExperimentResult);
      },
      run: async (id: string): Promise<ExperimentDto> => {
        const res = await this.request<Record<string, unknown>>(
          'POST',
          `/api/v1/eval/experiments/${id}/run`,
          { body: {} },
        );
        return mapExperiment(res);
      },
    },
    saveRunAsTestCase: async (
      runId: string,
      input: {
        datasetId: string;
        name: string;
        stepId?: string;
        expectedOutput?: Record<string, unknown>;
        rubric?: Record<string, unknown>;
        tags?: string[];
        difficulty?: 'easy' | 'medium' | 'hard' | 'adversarial';
        weight?: number;
      },
    ): Promise<TestCaseDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/runs/${runId}/save-test-case`,
        {
          body: {
            dataset_id: input.datasetId,
            name: input.name,
            step_id: input.stepId,
            expected_output: input.expectedOutput,
            rubric: input.rubric,
            tags: input.tags,
            difficulty: input.difficulty,
            weight: input.weight,
          },
        },
      );
      return mapTestCase(res);
    },
  };

  readonly teams = {
    list: async (): Promise<TeamDto[]> => {
      const res = await this.request<{ items: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/teams',
      );
      return res.items.map(mapTeam);
    },
    create: async (input: {
      name: string;
      description?: string;
      pattern?: TeamPatternDto;
      supervisorAgentId?: string;
      members?: Array<{
        agentId: string;
        role: TeamMemberRoleDto;
        readKeys?: string[];
        writeKeys?: string[];
        maxSteps?: number;
        timeoutSeconds?: number;
        maxSpendMicroUsd?: number;
      }>;
      handoffs?: Array<{
        fromAgentId: string;
        toAgentId: string;
        name: string;
        description?: string;
        handoffSchema?: Record<string, unknown>;
        returnSchema?: Record<string, unknown>;
      }>;
      config?: Record<string, unknown>;
    }): Promise<TeamDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/teams',
        {
          body: {
            name: input.name,
            description: input.description,
            pattern: input.pattern,
            supervisor_agent_id: input.supervisorAgentId,
            members: input.members?.map((m) => ({
              agent_id: m.agentId,
              role: m.role,
              read_keys: m.readKeys,
              write_keys: m.writeKeys,
              max_steps: m.maxSteps,
              timeout_seconds: m.timeoutSeconds,
              max_spend_micro_usd: m.maxSpendMicroUsd,
            })),
            handoffs: input.handoffs?.map((h) => ({
              from_agent_id: h.fromAgentId,
              to_agent_id: h.toAgentId,
              name: h.name,
              description: h.description,
              handoff_schema: h.handoffSchema,
              return_schema: h.returnSchema,
            })),
            config: input.config,
          },
        },
      );
      return mapTeam(res);
    },
    get: async (id: string): Promise<TeamDto> => {
      const res = await this.request<Record<string, unknown>>(
        'GET',
        `/api/v1/teams/${id}`,
      );
      return mapTeam(res);
    },
    update: async (
      id: string,
      input: {
        name?: string;
        description?: string;
        pattern?: TeamPatternDto;
        supervisorAgentId?: string | null;
        members?: Array<{
          agentId: string;
          role: TeamMemberRoleDto;
          readKeys?: string[];
          writeKeys?: string[];
          maxSteps?: number;
          timeoutSeconds?: number;
          maxSpendMicroUsd?: number;
        }>;
        handoffs?: Array<{
          fromAgentId: string;
          toAgentId: string;
          name: string;
          description?: string;
          handoffSchema?: Record<string, unknown>;
          returnSchema?: Record<string, unknown>;
        }>;
        config?: Record<string, unknown>;
      },
    ): Promise<TeamDto> => {
      const res = await this.request<Record<string, unknown>>(
        'PATCH',
        `/api/v1/teams/${id}`,
        {
          body: {
            name: input.name,
            description: input.description,
            pattern: input.pattern,
            supervisor_agent_id: input.supervisorAgentId,
            members: input.members?.map((m) => ({
              agent_id: m.agentId,
              role: m.role,
              read_keys: m.readKeys,
              write_keys: m.writeKeys,
              max_steps: m.maxSteps,
              timeout_seconds: m.timeoutSeconds,
              max_spend_micro_usd: m.maxSpendMicroUsd,
            })),
            handoffs: input.handoffs?.map((h) => ({
              from_agent_id: h.fromAgentId,
              to_agent_id: h.toAgentId,
              name: h.name,
              description: h.description,
              handoff_schema: h.handoffSchema,
              return_schema: h.returnSchema,
            })),
            config: input.config,
          },
        },
      );
      return mapTeam(res);
    },
    simulate: async (
      id: string,
      input: {
        input: Record<string, unknown>;
        initialBlackboard?: Record<string, unknown>;
      },
    ): Promise<TeamSimulationDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/teams/${id}/simulate`,
        {
          body: {
            input: input.input,
            initial_blackboard: input.initialBlackboard ?? {},
          },
        },
      );
      return mapTeamSimulation(res);
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

function mapSecretMetadata(s: Record<string, unknown>): SecretMetadataDto {
  return {
    id: String(s.id),
    ref: String(s.ref),
    orgId: String(s.org_id),
    provider: s.provider as 'db' | 'vault',
    name: String(s.name),
    environmentId: s.environment_id ? String(s.environment_id) : null,
    keyVersion: Number(s.key_version ?? 1),
    kekVersion: s.kek_version !== undefined ? Number(s.kek_version) : undefined,
    createdAt: String(s.created_at),
    updatedAt: String(s.updated_at),
  };
}

function mapBudget(b: Record<string, unknown>): BudgetDto {
  return {
    id: String(b.id),
    orgId: String(b.org_id),
    workspaceId: b.workspace_id ? String(b.workspace_id) : null,
    projectId: b.project_id ? String(b.project_id) : null,
    agentId: b.agent_id ? String(b.agent_id) : null,
    scopeType: b.scope_type as BudgetDto['scopeType'],
    scopeId: String(b.scope_id),
    period: b.period as BudgetDto['period'],
    softLimitMicroUsd: b.soft_limit_micro_usd !== null && b.soft_limit_micro_usd !== undefined ? Number(b.soft_limit_micro_usd) : null,
    hardLimitMicroUsd: b.hard_limit_micro_usd !== null && b.hard_limit_micro_usd !== undefined ? Number(b.hard_limit_micro_usd) : null,
    softLimitTokens: b.soft_limit_tokens !== null && b.soft_limit_tokens !== undefined ? Number(b.soft_limit_tokens) : null,
    hardLimitTokens: b.hard_limit_tokens !== null && b.hard_limit_tokens !== undefined ? Number(b.hard_limit_tokens) : null,
    spentMicroUsd: Number(b.spent_micro_usd ?? 0),
    spentTokens: Number(b.spent_tokens ?? 0),
    actionOnBreach: b.action_on_breach as BudgetDto['actionOnBreach'],
    alertEmittedAt: b.alert_emitted_at ? String(b.alert_emitted_at) : null,
    createdBy: String(b.created_by),
    createdAt: String(b.created_at),
    updatedAt: String(b.updated_at),
  };
}

function mapKillSwitch(k: Record<string, unknown>): KillSwitchDto {
  return {
    id: String(k.id),
    orgId: String(k.org_id),
    workspaceId: k.workspace_id ? String(k.workspace_id) : null,
    scopeType: k.scope_type as KillSwitchDto['scopeType'],
    scopeId: String(k.scope_id),
    active: Boolean(k.active),
    reason: String(k.reason),
    activatedBy: String(k.activated_by),
    activatedAt: String(k.activated_at),
    deactivatedBy: k.deactivated_by ? String(k.deactivated_by) : null,
    deactivatedAt: k.deactivated_at ? String(k.deactivated_at) : null,
  };
}

function mapAuditVerify(v: Record<string, unknown>): AuditVerifyDto {
  return {
    valid: Boolean(v.valid),
    checkedCount: Number(v.checked_count ?? 0),
    brokenAtSeq: v.broken_at_seq !== undefined ? Number(v.broken_at_seq) : undefined,
    reason: v.reason ? String(v.reason) : undefined,
  };
}

function mapAgentIdentity(a: Record<string, unknown>): AgentIdentityDto {
  return {
    id: String(a.id),
    orgId: String(a.org_id),
    workspaceId: String(a.workspace_id),
    agentId: String(a.agent_id),
    principalId: String(a.principal_id),
    environmentId: String(a.environment_id),
    displayName: String(a.display_name),
    allowedToolIds: Array.isArray(a.allowed_tool_ids) ? a.allowed_tool_ids.map(String) : [],
    tokenTtlSeconds: Number(a.token_ttl_seconds ?? 900),
    status: a.status as 'active' | 'disabled',
    createdBy: String(a.created_by),
    createdAt: String(a.created_at),
    updatedAt: String(a.updated_at),
  };
}

function mapAgentIdentityToken(t: Record<string, unknown>): AgentIdentityTokenDto {
  return {
    tokenId: String(t.token_id),
    agentIdentityId: String(t.agent_identity_id),
    agentPrincipalId: String(t.agent_principal_id),
    agentId: String(t.agent_id),
    orgId: String(t.org_id),
    workspaceId: String(t.workspace_id),
    environmentId: String(t.environment_id),
    onBehalfOfPrincipalId: t.on_behalf_of_principal_id
      ? String(t.on_behalf_of_principal_id)
      : null,
    allowedToolIds: Array.isArray(t.allowed_tool_ids) ? t.allowed_tool_ids.map(String) : [],
    expiresAt: String(t.expires_at),
  };
}

function mapToolGrant(g: Record<string, unknown>): ToolGrantDto {
  const scope = (g.scope ?? {}) as Record<string, unknown>;
  return {
    id: String(g.id),
    orgId: String(g.org_id),
    workspaceId: String(g.workspace_id),
    agentId: String(g.agent_id),
    toolId: String(g.tool_id),
    sideEffectClass: g.side_effect_class as ToolGrantDto['sideEffectClass'],
    scope: {
      allowedDomains: Array.isArray(scope.allowed_domains)
        ? scope.allowed_domains.map(String)
        : undefined,
      allowedMethods: Array.isArray(scope.allowed_methods)
        ? scope.allowed_methods.map(String)
        : undefined,
      maxCallsPerRun:
        scope.max_calls_per_run !== undefined ? Number(scope.max_calls_per_run) : undefined,
    },
    grantedBy: String(g.granted_by),
    approvedBy: g.approved_by ? String(g.approved_by) : null,
    status: g.status as 'active' | 'revoked',
    createdAt: String(g.created_at),
  };
}

function toWireCondition(cond?: PolicyConditionDto): Record<string, unknown> {
  if (!cond) return {};
  return {
    points: cond.points,
    side_effect_classes: cond.sideEffectClasses,
    environments: cond.environments,
    tool_names: cond.toolNames,
    max_autonomy_level: cond.maxAutonomyLevel,
    untrusted_content_in_context: cond.untrustedContentInContext,
    data_classifications: cond.dataClassifications,
    max_spend_micro_usd: cond.maxSpendMicroUsd,
    risk_tiers: cond.riskTiers,
  };
}

function mapPolicy(p: Record<string, unknown>): PolicyDto {
  const cond = (p.condition ?? {}) as Record<string, unknown>;
  return {
    id: String(p.id),
    orgId: String(p.org_id),
    workspaceId: p.workspace_id ? String(p.workspace_id) : null,
    slug: String(p.slug),
    name: String(p.name),
    description: p.description ? String(p.description) : null,
    point: p.point as PolicyPointDto,
    mode: p.mode as 'audit_only' | 'enforce',
    version: Number(p.version ?? 1),
    effect: p.effect as PolicyDto['effect'],
    condition: {
      points: Array.isArray(cond.points) ? (cond.points as PolicyPointDto[]) : undefined,
      sideEffectClasses: Array.isArray(cond.side_effect_classes)
        ? (cond.side_effect_classes as PolicyConditionDto['sideEffectClasses'])
        : undefined,
      environments: Array.isArray(cond.environments)
        ? (cond.environments as PolicyConditionDto['environments'])
        : undefined,
      toolNames: Array.isArray(cond.tool_names) ? cond.tool_names.map(String) : undefined,
      maxAutonomyLevel:
        cond.max_autonomy_level !== undefined ? Number(cond.max_autonomy_level) : undefined,
      untrustedContentInContext:
        cond.untrusted_content_in_context !== undefined
          ? Boolean(cond.untrusted_content_in_context)
          : undefined,
      dataClassifications: Array.isArray(cond.data_classifications)
        ? cond.data_classifications.map(String)
        : undefined,
      maxSpendMicroUsd:
        cond.max_spend_micro_usd !== undefined ? Number(cond.max_spend_micro_usd) : undefined,
      riskTiers: Array.isArray(cond.risk_tiers)
        ? (cond.risk_tiers as PolicyConditionDto['riskTiers'])
        : undefined,
    },
    regoSource: String(p.rego_source ?? ''),
    createdBy: String(p.created_by),
    approvedBy: p.approved_by ? String(p.approved_by) : null,
    createdAt: String(p.created_at),
    updatedAt: String(p.updated_at),
  };
}

function mapPolicySimulationReport(r: Record<string, unknown>): PolicySimulationReportDto {
  return {
    policyId: String(r.policy_id),
    policySlug: String(r.policy_slug),
    totalRunsEvaluated: Number(r.total_runs_evaluated ?? 0),
    matchedCount: Number(r.matched_count ?? 0),
    blockedCount: Number(r.blocked_count ?? 0),
    approvalRequiredCount: Number(r.approval_required_count ?? 0),
    sampleAffectedRunIds: Array.isArray(r.sample_affected_run_ids)
      ? r.sample_affected_run_ids.map(String)
      : [],
    durationMs: Number(r.duration_ms ?? 0),
  };
}

function mapEvidencePack(e: Record<string, unknown>): EvidencePackDto {
  return {
    packId: String(e.pack_id),
    orgId: String(e.org_id),
    workspaceId: e.workspace_id ? String(e.workspace_id) : null,
    generatedAt: String(e.generated_at),
    generatedBy: String(e.generated_by),
    chainVerification: mapAuditVerify((e.chain_verification ?? {}) as Record<string, unknown>),
    agents: Array.isArray(e.agents)
      ? e.agents.map((a) => {
          const item = a as Record<string, unknown>;
          return {
            id: String(item.id),
            name: String(item.name),
            status: String(item.status),
            versionsCount: Number(item.versions_count ?? 0),
          };
        })
      : [],
    policies: Array.isArray(e.policies)
      ? e.policies.map((p) => mapPolicy(p as Record<string, unknown>))
      : [],
    toolGrants: Array.isArray(e.tool_grants)
      ? e.tool_grants.map((g) => mapToolGrant(g as Record<string, unknown>))
      : [],
    agentIdentities: Array.isArray(e.agent_identities)
      ? e.agent_identities.map((ai) => mapAgentIdentity(ai as Record<string, unknown>))
      : [],
    auditSample: Array.isArray(e.audit_sample)
      ? e.audit_sample.map((evt) => mapAudit(evt as Record<string, unknown>))
      : [],
    digestSha256: String(e.digest_sha256 ?? ''),
  };
}

function mapApproval(a: Record<string, unknown>): ApprovalDto {
  const payload = (a.payload ?? {}) as Record<string, unknown>;
  const proposed = (payload.proposed_action ?? {}) as Record<string, unknown>;
  const rawDiff = payload.diff as Record<string, unknown> | undefined;
  const rawAmt = payload.amount as Record<string, unknown> | undefined;

  return {
    id: String(a.id),
    orgId: String(a.org_id),
    workspaceId: String(a.workspace_id),
    runId: String(a.run_id),
    stepId: String(a.step_id),
    type: a.type as ApprovalDto['type'],
    status: a.status as ApprovalDto['status'],
    payload: {
      title: String(payload.title ?? ''),
      summary: String(payload.summary ?? ''),
      proposedAction: {
        tool: proposed.tool ? String(proposed.tool) : undefined,
        args: (proposed.args ?? {}) as Record<string, unknown>,
      },
      diff: rawDiff
        ? {
            before: (rawDiff.before ?? {}) as Record<string, unknown>,
            after: (rawDiff.after ?? {}) as Record<string, unknown>,
          }
        : undefined,
      risk: (payload.risk as 'low' | 'medium' | 'high') ?? 'medium',
      amount: rawAmt
        ? { value: Number(rawAmt.value ?? 0), currency: String(rawAmt.currency ?? 'USD') }
        : undefined,
      evidence: Array.isArray(payload.evidence)
        ? payload.evidence.map((ev) => {
            const item = ev as Record<string, unknown>;
            return {
              type: String(item.type ?? 'step'),
              stepId: item.step_id ? String(item.step_id) : undefined,
              docId: item.doc_id ? String(item.doc_id) : undefined,
              summary: item.summary ? String(item.summary) : undefined,
            };
          })
        : [],
      confidence:
        payload.confidence !== undefined && payload.confidence !== null
          ? Number(payload.confidence)
          : null,
      policyReason: payload.policy_reason ? String(payload.policy_reason) : undefined,
      editSchema: payload.edit_schema as Record<string, unknown> | undefined,
    },
    requestedFrom: Array.isArray(a.requested_from)
      ? (a.requested_from as ApprovalDto['requestedFrom'])
      : [],
    requiredDecisions: Number(a.required_decisions ?? 1),
    separationOfDuties: Boolean(a.separation_of_duties ?? true),
    initiatedBy: String(a.initiated_by),
    delegatedTo: a.delegated_to ? String(a.delegated_to) : null,
    expiresAt: a.expires_at ? String(a.expires_at) : null,
    onTimeout: (a.on_timeout as ApprovalDto['onTimeout']) ?? 'escalate',
    autoApproveOnTimeout: Boolean(a.auto_approve_on_timeout),
    escalatedAt: a.escalated_at ? String(a.escalated_at) : null,
    snoozedUntil: a.snoozed_until ? String(a.snoozed_until) : null,
    infoRequestQuestion: a.info_request_question ? String(a.info_request_question) : null,
    infoRequestAnswer: a.info_request_answer ? String(a.info_request_answer) : null,
    allowedActions: Array.isArray(a.allowed_actions)
      ? (a.allowed_actions as ApprovalDto['allowedActions'])
      : ['approve', 'reject'],
    decisions: Array.isArray(a.decisions)
      ? a.decisions.map((d) => {
          const item = d as Record<string, unknown>;
          return {
            id: String(item.id),
            approvalId: String(item.approval_id),
            orgId: String(item.org_id),
            decidedBy: String(item.decided_by),
            decision: item.decision as ApprovalDecisionDto['decision'],
            reason: item.reason ? String(item.reason) : null,
            editedPayload: (item.edited_payload as Record<string, unknown> | null) ?? null,
            channel: item.channel as ApprovalDecisionDto['channel'],
            createdAt: String(item.created_at),
          };
        })
      : [],
    createdAt: String(a.created_at),
    decidedAt: a.decided_at ? String(a.decided_at) : null,
  };
}

function mapNotification(n: Record<string, unknown>): NotificationDto {
  return {
    id: String(n.id),
    orgId: String(n.org_id),
    workspaceId: n.workspace_id ? String(n.workspace_id) : null,
    approvalId: n.approval_id ? String(n.approval_id) : null,
    channel: n.channel as NotificationDto['channel'],
    recipient: String(n.recipient),
    subject: String(n.subject),
    body: String(n.body),
    actionLinks: (n.action_links ?? {}) as Record<string, unknown>,
    status: (n.status as NotificationDto['status']) ?? 'sent',
    createdAt: String(n.created_at),
  };
}

function mapDataset(d: Record<string, unknown>): DatasetDto {
  return {
    id: String(d.id),
    orgId: String(d.org_id),
    workspaceId: String(d.workspace_id),
    name: String(d.name),
    description: d.description ? String(d.description) : null,
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    metadata: (d.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(d.created_at),
    updatedAt: String(d.updated_at),
  };
}

function mapTestCase(t: Record<string, unknown>): TestCaseDto {
  return {
    id: String(t.id),
    orgId: String(t.org_id),
    workspaceId: String(t.workspace_id),
    datasetId: String(t.dataset_id),
    name: String(t.name),
    inputs: (t.inputs ?? {}) as Record<string, unknown>,
    expectedOutput: (t.expected_output as Record<string, unknown> | null) ?? null,
    rubric: (t.rubric ?? {}) as Record<string, unknown>,
    tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
    difficulty: (t.difficulty as TestCaseDto['difficulty']) ?? 'medium',
    weight: Number(t.weight ?? 1.0),
    sourceRunId: t.source_run_id ? String(t.source_run_id) : null,
    sourceStepId: t.source_step_id ? String(t.source_step_id) : null,
    createdAt: String(t.created_at),
    updatedAt: String(t.updated_at),
  };
}


function mapGrader(g: Record<string, unknown>): GraderDto {
  return {
    id: String(g.id),
    orgId: String(g.org_id),
    workspaceId: String(g.workspace_id),
    name: String(g.name),
    description: g.description ? String(g.description) : null,
    type: g.type as GraderDto['type'],
    config: (g.config ?? {}) as Record<string, unknown>,
    createdAt: String(g.created_at),
    updatedAt: String(g.updated_at),
  };
}

function mapExperiment(e: Record<string, unknown>): ExperimentDto {
  return {
    id: String(e.id),
    orgId: String(e.org_id),
    workspaceId: String(e.workspace_id),
    name: String(e.name),
    datasetId: String(e.dataset_id),
    agentVersionId: String(e.agent_version_id),
    baselineVersionId: e.baseline_version_id ? String(e.baseline_version_id) : null,
    graderIds: Array.isArray(e.grader_ids) ? (e.grader_ids as string[]) : [],
    status: (e.status as ExperimentDto['status']) ?? 'pending',
    releaseGateConfig: (e.release_gate_config ?? {}) as Record<string, unknown>,
    gateVerdict: (e.gate_verdict as ExperimentDto['gateVerdict']) ?? null,
    metrics: (e.metrics ?? {}) as Record<string, unknown>,
    createdAt: String(e.created_at),
    startedAt: e.started_at ? String(e.started_at) : null,
    completedAt: e.completed_at ? String(e.completed_at) : null,
  };
}

function mapExperimentResult(r: Record<string, unknown>): ExperimentResultDto {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    experimentId: String(r.experiment_id),
    testCaseId: String(r.test_case_id),
    runId: r.run_id ? String(r.run_id) : null,
    actualOutput: (r.actual_output as Record<string, unknown> | null) ?? null,
    graderResults: Array.isArray(r.grader_results) ? (r.grader_results as Record<string, unknown>[]) : [],
    passed: Boolean(r.passed),
    score: Number(r.score ?? 0),
    durationMs: Number(r.duration_ms ?? 0),
    costMicroUsd: Number(r.cost_micro_usd ?? 0),
    isRegression: Boolean(r.is_regression),
    diff: (r.diff as Record<string, unknown> | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function mapTeamMember(m: Record<string, unknown>): TeamMemberDto {
  return {
    id: String(m.id),
    teamId: String(m.team_id),
    agentId: String(m.agent_id),
    role: m.role as TeamMemberRoleDto,
    readKeys: Array.isArray(m.read_keys) ? (m.read_keys as string[]) : [],
    writeKeys: Array.isArray(m.write_keys) ? (m.write_keys as string[]) : [],
    maxSteps: Number(m.max_steps ?? 10),
    timeoutSeconds: Number(m.timeout_seconds ?? 60),
    maxSpendMicroUsd: Number(m.max_spend_micro_usd ?? 5000000),
    createdAt: String(m.created_at),
  };
}

function mapTeamHandoff(h: Record<string, unknown>): TeamHandoffDto {
  return {
    id: String(h.id),
    teamId: String(h.team_id),
    fromAgentId: String(h.from_agent_id),
    toAgentId: String(h.to_agent_id),
    name: String(h.name),
    description: h.description ? String(h.description) : null,
    handoffSchema: (h.handoff_schema ?? {}) as Record<string, unknown>,
    returnSchema: (h.return_schema ?? {}) as Record<string, unknown>,
    createdAt: String(h.created_at),
  };
}

function mapTeam(t: Record<string, unknown>): TeamDto {
  const members = Array.isArray(t.members) ? t.members.map((m) => mapTeamMember(m as Record<string, unknown>)) : [];
  const handoffs = Array.isArray(t.handoffs) ? t.handoffs.map((h) => mapTeamHandoff(h as Record<string, unknown>)) : [];
  return {
    id: String(t.id),
    orgId: String(t.org_id),
    workspaceId: String(t.workspace_id),
    name: String(t.name),
    description: t.description ? String(t.description) : null,
    pattern: (t.pattern as TeamPatternDto) ?? 'supervisor_specialists',
    supervisorAgentId: t.supervisor_agent_id ? String(t.supervisor_agent_id) : null,
    members,
    handoffs,
    config: (t.config ?? {}) as Record<string, unknown>,
    createdAt: String(t.created_at),
    updatedAt: String(t.updated_at),
  };
}


function mapBlackboard(b: Record<string, unknown>): BlackboardDto {
  return {
    id: String(b.id),
    orgId: String(b.org_id),
    workspaceId: String(b.workspace_id),
    runId: String(b.run_id),
    version: Number(b.version ?? 1),
    state: (b.state ?? {}) as Record<string, unknown>,
    history: Array.isArray(b.history) ? (b.history as Record<string, unknown>[]) : [],
    createdAt: String(b.created_at),
    updatedAt: String(b.updated_at),
  };
}

function mapAgentMessage(m: Record<string, unknown>): AgentMessageDto {
  return {
    id: String(m.id),
    orgId: String(m.org_id),
    workspaceId: String(m.workspace_id),
    runId: String(m.run_id),
    senderAgentId: String(m.sender_agent_id),
    receiverAgentId: String(m.receiver_agent_id),
    purpose: m.purpose as AgentMessageDto['purpose'],
    payload: (m.payload ?? {}) as Record<string, unknown>,
    createdAt: String(m.created_at),
  };
}

function mapTeamSimulation(s: Record<string, unknown>): TeamSimulationDto {
  const childRuns = Array.isArray(s.child_runs)
    ? (s.child_runs as Record<string, unknown>[]).map((cr) => ({
        childRunId: String(cr.child_run_id),
        parentRunId: String(cr.parent_run_id),
        agentId: String(cr.agent_id),
        role: String(cr.role),
        status: String(cr.status),
        tokensIn: Number(cr.tokens_in ?? 0),
        tokensOut: Number(cr.tokens_out ?? 0),
        costMicroUsd: Number(cr.cost_micro_usd ?? 0),
        durationMs: Number(cr.duration_ms ?? 0),
      }))
    : [];

  const messages = Array.isArray(s.messages)
    ? (s.messages as Record<string, unknown>[]).map(mapAgentMessage)
    : [];

  return {
    rootRunId: String(s.root_run_id),
    finalOutput: (s.final_output ?? {}) as Record<string, unknown>,
    blackboard: mapBlackboard(s.blackboard as Record<string, unknown>),
    messages,
    childRuns,
    totalTokensIn: Number(s.total_tokens_in ?? 0),
    totalTokensOut: Number(s.total_tokens_out ?? 0),
    totalCostMicroUsd: Number(s.total_cost_micro_usd ?? 0),
    durationMs: Number(s.duration_ms ?? 0),
  };
}

function mapCustomTool(t: Record<string, unknown>): CustomToolDto {
  return {
    id: String(t.id),
    orgId: String(t.org_id),
    workspaceId: String(t.workspace_id),
    name: String(t.name),
    version: String(t.version ?? '1.0.0'),
    description: String(t.description ?? ''),
    sideEffectClass: (t.side_effect_class ?? 'read') as CustomToolDto['sideEffectClass'],
    implementation: (t.implementation ?? 'http') as CustomToolDto['implementation'],
    inputSchema: (t.input_schema ?? {}) as Record<string, unknown>,
    outputSchema: (t.output_schema ?? {}) as Record<string, unknown>,
    config: (t.config ?? {}) as Record<string, unknown>,
    tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
    owner: t.owner ? String(t.owner) : null,
    status: (t.status ?? 'active') as CustomToolDto['status'],
    untrustedSource: Boolean(t.untrusted_source),
    createdAt: String(t.created_at),
    updatedAt: String(t.updated_at),
  };
}


function mapTestToolResult(r: Record<string, unknown>): TestToolResultDto {
  return {
    toolName: String(r.tool_name),
    dryRun: Boolean(r.dry_run),
    validArgs: Boolean(r.valid_args),
    rawResult: r.raw_result,
    sanitizedText: String(r.sanitized_text ?? ''),
    wrappedObservation: String(r.wrapped_observation ?? ''),
    untrustedSource: Boolean(r.untrusted_source),
    injectionSuspected: Boolean(r.injection_suspected),
  };
}

function mapMcpServer(s: Record<string, unknown>): McpServerDto {
  return {
    id: String(s.id),
    orgId: String(s.org_id),
    workspaceId: String(s.workspace_id),
    name: String(s.name),
    transport: s.transport as McpServerDto['transport'],
    endpoint: String(s.endpoint),
    status: s.status as McpServerDto['status'],
    metadata: (s.metadata ?? {}) as Record<string, unknown>,
    lastHealthCheckAt: s.last_health_check_at ? String(s.last_health_check_at) : null,
    createdAt: String(s.created_at),
    updatedAt: String(s.updated_at),
  };
}

function mapMcpServerTool(t: Record<string, unknown>): McpServerToolDto {
  return {
    id: String(t.id),
    orgId: String(t.org_id),
    workspaceId: String(t.workspace_id),
    mcpServerId: String(t.mcp_server_id),
    name: String(t.name),
    description: t.description ? String(t.description) : null,
    inputSchema: (t.input_schema ?? {}) as Record<string, unknown>,
    sideEffectClass: (t.side_effect_class ?? 'read') as McpServerToolDto['sideEffectClass'],
    approvalStatus: t.approval_status as McpServerToolDto['approvalStatus'],
    approvedBy: t.approved_by ? String(t.approved_by) : null,
    approvedAt: t.approved_at ? String(t.approved_at) : null,
    createdAt: String(t.created_at),
    updatedAt: String(t.updated_at),
  };
}

function mapConnectorManifest(c: Record<string, unknown>): ConnectorManifestDto {
  const actions = Array.isArray(c.actions)
    ? (c.actions as Record<string, unknown>[]).map((a) => ({
        name: String(a.name),
        description: String(a.description ?? ''),
        sideEffectClass: (a.side_effect_class ?? 'read') as ConnectorManifestDto['actions'][number]['sideEffectClass'],
        idempotent: Boolean(a.idempotent),
        inputSchema: (a.input_schema ?? {}) as Record<string, unknown>,
        outputSchema: (a.output_schema ?? {}) as Record<string, unknown>,
        rateLimitPerMinute: Number(a.rate_limit_per_minute ?? 60),
        pagination: (a.pagination ?? 'none') as ConnectorManifestDto['actions'][number]['pagination'],
      }))
    : [];

  const triggers = Array.isArray(c.triggers)
    ? (c.triggers as Record<string, unknown>[]).map((t) => ({
        name: String(t.name),
        type: (t.type ?? 'webhook') as 'webhook' | 'polling',
        description: String(t.description ?? ''),
        verifyHeader: t.verify_header ? String(t.verify_header) : undefined,
      }))
    : [];

  return {
    id: String(c.id),
    name: String(c.name),
    version: String(c.version ?? '1.0.0'),
    category: String(c.category ?? 'http'),
    description: String(c.description ?? ''),
    authTypes: Array.isArray(c.auth_types)
      ? (c.auth_types as ConnectorManifestDto['authTypes'])
      : [],
    scopes: Array.isArray(c.scopes) ? (c.scopes as string[]) : [],
    egressDomains: Array.isArray(c.egress_domains) ? (c.egress_domains as string[]) : [],
    actions,
    triggers,
  };
}

function mapConnectorContractTestResult(r: Record<string, unknown>): ConnectorContractTestResultDto {
  return {
    connectorId: String(r.connector_id),
    passed: Boolean(r.passed),
    totalFixtures: Number(r.total_fixtures ?? 0),
    passedFixtures: Number(r.passed_fixtures ?? 0),
    details: Array.isArray(r.details)
      ? (r.details as Record<string, unknown>[]).map((d) => ({
          fixtureName: String(d.fixture_name),
          action: String(d.action),
          passed: Boolean(d.passed),
          errors: Array.isArray(d.errors) ? (d.errors as string[]) : [],
        }))
      : [],
  };
}

function mapConnection(c: Record<string, unknown>): ConnectionDto {
  return {
    id: String(c.id),
    orgId: String(c.org_id),
    workspaceId: String(c.workspace_id),
    connectorId: String(c.connector_id),
    name: String(c.name),
    authType: c.auth_type as ConnectionDto['authType'],
    sharingMode: (c.sharing_mode ?? 'shared') as ConnectionDto['sharingMode'],
    ownerId: String(c.owner_id),
    environmentMapping: (c.environment_mapping ?? {}) as Record<string, string>,
    secretVersion: Number(c.secret_version ?? 1),
    secretMasked: String(c.secret_masked ?? 'Stored (write-only)'),
    scopes: Array.isArray(c.scopes) ? (c.scopes as string[]) : [],
    allowedAgents: Array.isArray(c.allowed_agents) ? (c.allowed_agents as string[]) : ['*'],
    egressDomains: Array.isArray(c.egress_domains) ? (c.egress_domains as string[]) : [],
    status: (c.status ?? 'healthy') as ConnectionDto['status'],
    lastTestedAt: c.last_tested_at ? String(c.last_tested_at) : null,
    lastError: c.last_error ? String(c.last_error) : null,
    expiresAt: c.expires_at ? String(c.expires_at) : null,
    createdAt: String(c.created_at),
    updatedAt: String(c.updated_at),
  };
}

function mapDeployment(d: Record<string, unknown>): DeploymentDto {
  return {
    id: String(d.id),
    orgId: String(d.org_id),
    workspaceId: String(d.workspace_id),
    environment: d.environment as DeploymentDto['environment'],
    subjectType: d.subject_type as DeploymentDto['subjectType'],
    subjectId: String(d.subject_id),
    versionId: String(d.version_id),
    previousVersionId: d.previous_version_id ? String(d.previous_version_id) : null,
    channel: String(d.channel ?? 'stable'),
    trafficPct: Number(d.traffic_pct ?? 100),
    status: (d.status ?? 'active') as DeploymentDto['status'],
    deployedBy: String(d.deployed_by),
    deployedAt: String(d.deployed_at),
  };
}

function mapPromotion(p: Record<string, unknown>): PromotionDto {
  return {
    id: String(p.id),
    orgId: String(p.org_id),
    workspaceId: String(p.workspace_id),
    subjectType: p.subject_type as PromotionDto['subjectType'],
    subjectId: String(p.subject_id),
    versionId: String(p.version_id),
    fromEnv: p.from_env as PromotionDto['fromEnv'],
    toEnv: p.to_env as PromotionDto['toEnv'],
    status: p.status as PromotionDto['status'],
    evalGatePassed: Boolean(p.eval_gate_passed),
    evalScore: p.eval_score !== null && p.eval_score !== undefined ? Number(p.eval_score) : null,
    diffSummary: (p.diff_summary ?? {}) as Record<string, unknown>,
    credentialMapping: (p.credential_mapping ?? {}) as Record<string, string>,
    canaryPct: Number(p.canary_pct ?? 100),
    initiatedBy: String(p.initiated_by),
    approvedBy: p.approved_by ? String(p.approved_by) : null,
    deploymentId: p.deployment_id ? String(p.deployment_id) : null,
    deployedAt: p.deployed_at ? String(p.deployed_at) : null,
    rolledBackAt: p.rolled_back_at ? String(p.rolled_back_at) : null,
    createdAt: String(p.created_at),
    updatedAt: String(p.updated_at),
  };
}

function mapObservabilityOverview(o: Record<string, unknown>): ObservabilityOverviewDto {
  return {
    windowHours: Number(o.window_hours ?? 24),
    totalRuns: Number(o.total_runs ?? 0),
    succeededRuns: Number(o.succeeded_runs ?? 0),
    failedRuns: Number(o.failed_runs ?? 0),
    successRate: Number(o.success_rate ?? 1),
    failureRate: Number(o.failure_rate ?? 0),
    p50DurationMs: Number(o.p50_duration_ms ?? 0),
    p95DurationMs: Number(o.p95_duration_ms ?? 0),
    p99DurationMs: Number(o.p99_duration_ms ?? 0),
    totalCostUsd: Number(o.total_cost_usd ?? 0),
    costPerRunUsd: Number(o.cost_per_run_usd ?? 0),
    costPerSuccessfulOutcomeUsd: Number(o.cost_per_successful_outcome_usd ?? 0),
    tokensIn: Number(o.tokens_in ?? 0),
    tokensOut: Number(o.tokens_out ?? 0),
    queueDepth: Number(o.queue_depth ?? 0),
    approvalPendingCount: Number(o.approval_pending_count ?? 0),
    failureByClass: Array.isArray(o.failure_by_class)
      ? o.failure_by_class.map((x: Record<string, unknown>) => ({
          failureClass: String(x.failure_class ?? 'unknown'),
          count: Number(x.count ?? 0),
        }))
      : [],
    costByAgent: Array.isArray(o.cost_by_agent)
      ? o.cost_by_agent.map((x: Record<string, unknown>) => ({
          agentId: String(x.agent_id ?? ''),
          runs: Number(x.runs ?? 0),
          costUsd: Number(x.cost_usd ?? 0),
          tokensIn: Number(x.tokens_in ?? 0),
          tokensOut: Number(x.tokens_out ?? 0),
        }))
      : [],
    costByModel: Array.isArray(o.cost_by_model)
      ? o.cost_by_model.map((x: Record<string, unknown>) => ({
          model: String(x.model ?? ''),
          calls: Number(x.calls ?? 0),
          costUsd: Number(x.cost_usd ?? 0),
          tokensIn: Number(x.tokens_in ?? 0),
          tokensOut: Number(x.tokens_out ?? 0),
        }))
      : [],
    dailySeries: Array.isArray(o.daily_series)
      ? o.daily_series.map((x: Record<string, unknown>) => ({
          bucket: String(x.bucket ?? ''),
          runs: Number(x.runs ?? 0),
          failed: Number(x.failed ?? 0),
          costUsd: Number(x.cost_usd ?? 0),
        }))
      : [],
  };
}

function mapFailureExplanation(f: Record<string, unknown>): FailureExplanationDto {
  return {
    runId: String(f.run_id),
    status: String(f.status),
    failureClass: String(f.failure_class ?? 'unknown'),
    rootCause: String(f.root_cause ?? ''),
    failingStepSeq:
      f.failing_step_seq !== null && f.failing_step_seq !== undefined
        ? Number(f.failing_step_seq)
        : null,
    failingStepType: f.failing_step_type ? String(f.failing_step_type) : null,
    remediation: Array.isArray(f.remediation) ? f.remediation.map(String) : [],
  };
}

function mapAlertRule(r: Record<string, unknown>): AlertRuleDto {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    metric: r.metric as AlertRuleDto['metric'],
    operator: (r.operator ?? 'gt') as AlertRuleDto['operator'],
    threshold: Number(r.threshold ?? 0),
    windowMinutes: Number(r.window_minutes ?? 5),
    channels: Array.isArray(r.channels) ? r.channels.map(String) : ['in_app'],
    enabled: Boolean(r.enabled ?? true),
    lastFiredAt: r.last_fired_at ? String(r.last_fired_at) : null,
    createdBy: r.created_by ? String(r.created_by) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapAlertIncident(i: Record<string, unknown>): AlertIncidentDto {
  return {
    id: String(i.id),
    orgId: String(i.org_id),
    workspaceId: String(i.workspace_id),
    ruleId: String(i.rule_id),
    metric: i.metric as AlertIncidentDto['metric'],
    observedValue: Number(i.observed_value ?? 0),
    threshold: Number(i.threshold ?? 0),
    status: i.status as AlertIncidentDto['status'],
    summary: String(i.summary),
    firedAt: String(i.fired_at),
    acknowledgedAt: i.acknowledged_at ? String(i.acknowledged_at) : null,
    resolvedAt: i.resolved_at ? String(i.resolved_at) : null,
  };
}
