import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()),
      request_id: z.string(),
      trace_id: z.string(),
      doc_url: z.string(),
    }),
  })
  .openapi('ErrorEnvelope');

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
  })
  .openapi('HealthResponse');

export const ReadyResponseSchema = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.record(z.string(), z.enum(['ok', 'error'])),
  })
  .openapi('ReadyResponse');

export const VersionResponseSchema = z
  .object({
    version: z.string(),
    edition: z.enum(['community', 'enterprise']),
  })
  .openapi('VersionResponse');

export const CapabilitiesResponseSchema = z
  .object({
    edition: z.enum(['community', 'enterprise']),
    feature_flags: z.array(z.string()),
    modules: z.array(z.string()),
  })
  .openapi('CapabilitiesResponse');

export const LoginRequestSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .openapi('LoginRequest');

export const PrincipalSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    type: z.enum(['user', 'group', 'service_account', 'agent']),
    email: z.string().nullable(),
    display_name: z.string(),
  })
  .openapi('Principal');

export const WorkspaceSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    slug: z.string(),
    name: z.string(),
    created_at: z.string(),
  })
  .openapi('Workspace');

export const CreateWorkspaceSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Slug must be kebab-case 3-64 chars'),
    name: z.string().min(1).max(120),
  })
  .openapi('CreateWorkspaceRequest');

export const UpdateWorkspaceSchema = z
  .object({
    name: z.string().min(1).max(120),
  })
  .openapi('UpdateWorkspaceRequest');

export const ProjectSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    max_autonomy_level: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']),
    created_at: z.string(),
  })
  .openapi('Project');

export const CreateProjectSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Slug must be kebab-case 3-64 chars'),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
  })
  .openapi('CreateProjectRequest');

export const EnvironmentSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    kind: z.enum(['dev', 'staging', 'prod']),
    name: z.string(),
  })
  .openapi('Environment');

export const RoleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_system: z.boolean(),
  })
  .openapi('Role');

export const RoleBindingSchema = z
  .object({
    id: z.string(),
    principal_id: z.string(),
    role_id: z.string(),
    role_name: z.string(),
    scope_type: z.enum(['org', 'workspace', 'project', 'resource']),
    scope_id: z.string(),
    created_at: z.string(),
  })
  .openapi('RoleBinding');

export const CreateRoleBindingSchema = z
  .object({
    principal_id: z.string().min(1),
    role_name: z.string().min(1),
    scope_type: z.enum(['org', 'workspace', 'project', 'resource']),
    scope_id: z.string().min(1),
  })
  .openapi('CreateRoleBindingRequest');

export const MeResponseSchema = z
  .object({
    principal: PrincipalSchema,
    org_id: z.string(),
    org_slug: z.string(),
    org_name: z.string(),
    bindings: z.array(RoleBindingSchema),
    workspaces: z.array(WorkspaceSchema),
  })
  .openapi('MeResponse');

export const LoginResponseSchema = z
  .object({
    csrf_token: z.string(),
    me: MeResponseSchema,
  })
  .openapi('LoginResponse');

export const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    key_prefix: z.string(),
    scopes: z.array(z.string()),
    workspace_id: z.string().nullable(),
    expires_at: z.string().nullable(),
    last_used_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('ApiKey');

export const CreateApiKeySchema = z
  .object({
    name: z.string().min(1).max(120),
    scopes: z.array(z.string()).default([]),
    workspace_id: z.string().optional(),
  })
  .openapi('CreateApiKeyRequest');

export const CreatedApiKeySchema = ApiKeySchema.extend({
  secret: z.string(),
}).openapi('CreatedApiKey');

export const AuditEventSchema = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    ts: z.string(),
    actor: z.record(z.string(), z.unknown()),
    action: z.string(),
    resource: z.record(z.string(), z.unknown()),
    decision: z.string().nullable(),
    hash: z.string(),
    prev_hash: z.string(),
  })
  .openapi('AuditEvent');

export const AuditEventPageSchema = z
  .object({
    data: z.array(AuditEventSchema),
    next_cursor: z.string().nullable(),
  })
  .openapi('AuditEventPage');

export const IdParamSchema = z.object({ id: z.string().min(1) });
export const EmptyOkSchema = z.object({ ok: z.literal(true) }).openapi('EmptyOk');

// --- S0.2 Durable Run Core ---
export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'waiting_timer',
  'waiting_child',
  'succeeded',
  'failed',
  'timed_out',
  'budget_exceeded',
  'policy_blocked',
  'cancelled',
]);

export const RunLimitsSchema = z
  .object({
    max_steps: z.number().int().min(1).max(200),
    max_tokens: z.number().int().min(1).max(2_000_000),
    max_wall_time_ms: z.number().int().min(1000).max(86_400_000),
    max_cost_micro_usd: z.number().int().min(0).max(100_000_000),
  })
  .openapi('RunLimits');

export const RunUsageSchema = z
  .object({
    steps: z.number().int(),
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    tool_calls: z.number().int(),
  })
  .openapi('RunUsage');

export const SimulatedStepSchema = z.object({
  type: z
    .enum(['llm_call', 'tool_call', 'decision', 'handoff', 'approval', 'memory_op', 'node'])
    .optional(),
  summary: z.record(z.string(), z.unknown()).optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  tokens_in: z.number().int().min(0).optional(),
  tokens_out: z.number().int().min(0).optional(),
  cost_micro_usd: z.number().int().min(0).optional(),
  latency_ms: z.number().int().min(0).optional(),
  fail_code: z.enum(['TOOL_TIMEOUT', 'TOOL_UPSTREAM_REJECTED']).optional(),
});

export const CreateRunSchema = z
  .object({
    workspace_id: z.string().optional(),
    environment: z.enum(['dev', 'staging', 'prod']).optional(),
    subject_type: z.enum(['agent_version', 'workflow_version']).default('agent_version'),
    subject_version_id: z.string().min(1),
    input: z.unknown().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    limits: RunLimitsSchema.partial().optional(),
    queue: z.string().min(1).default('default'),
    priority: z.number().int().min(1).max(10).default(5),
    serialize_key: z.string().min(1).optional(),
    simulated_steps: z.array(SimulatedStepSchema).optional(),
    execute_inline: z.boolean().optional(),
  })
  .openapi('CreateRunRequest');

export const RunSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    environment_id: z.string(),
    root_run_id: z.string(),
    parent_run_id: z.string().nullable(),
    subject_type: z.string(),
    subject_version_id: z.string(),
    status: RunStatusSchema,
    failure_class: z.string().nullable(),
    termination_reason: z.string().nullable(),
    initiator_id: z.string(),
    input: z.unknown(),
    output: z.unknown(),
    limits: RunLimitsSchema,
    usage: RunUsageSchema,
    cost_micro_usd: z.number().int(),
    labels: z.record(z.string(), z.string()),
    last_event_seq: z.number().int(),
    created_at: z.string(),
    started_at: z.string().nullable(),
    ended_at: z.string().nullable(),
  })
  .openapi('Run');

export const RunStepSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    seq: z.number().int(),
    type: z.string(),
    status: z.string(),
    attempt: z.number().int(),
    idempotency_key: z.string(),
    summary: z.record(z.string(), z.unknown()),
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    cost_micro_usd: z.number().int(),
    latency_ms: z.number().int(),
    started_at: z.string(),
    ended_at: z.string(),
  })
  .openapi('RunStep');

export const RunEventSchema = z
  .object({
    run_id: z.string(),
    seq: z.number().int(),
    type: z.string(),
    data: z.record(z.string(), z.unknown()),
    created_at: z.string(),
  })
  .openapi('RunEvent');

export const CancelRunSchema = z
  .object({
    reason: z.string().min(1).max(300).default('Cancelled via API'),
  })
  .openapi('CancelRunRequest');

export const SignalRunSchema = z
  .object({
    kind: z.enum(['approval', 'input', 'timer', 'child']).default('input'),
    reason: z.string().min(1).max(300),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('SignalRunRequest');

export const DlqItemSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    workspace_id: z.string(),
    queue: z.string(),
    attempts: z.number().int(),
    max_attempts: z.number().int(),
    last_error: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.string(),
  })
  .openapi('DlqItem');

export const BulkRedriveSchema = z
  .object({
    run_ids: z.array(z.string().min(1)).min(1).max(100),
    input_patch: z.unknown().optional(),
  })
  .openapi('BulkRedriveRequest');

// ---------- Slice S0.3 Schemas ----------

export const AgentVersionParamSchema = z.object({
  id: z.string().min(1),
  vid: z.string().min(1),
});

export const ModelCapabilitySchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    display_name: z.string(),
    tier: z.enum(['fast', 'standard', 'reasoning', 'embedding']),
    context_window_tokens: z.number().int(),
    max_output_tokens: z.number().int(),
    supports_tools: z.boolean(),
    supports_structured_output: z.boolean(),
    supports_vision: z.boolean(),
    supports_streaming: z.boolean(),
    pricing_per_million: z.object({
      input_micro_usd: z.number().int(),
      output_micro_usd: z.number().int(),
      cached_input_micro_usd: z.number().int(),
    }),
    status: z.enum(['active', 'deprecated']),
  })
  .openapi('ModelCapability');

export const ToolContractWireSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().min(1).max(1000),
    input_schema: z.record(z.string(), z.unknown()),
    output_schema: z.record(z.string(), z.unknown()),
    side_effect_class: z.enum(['read', 'write', 'destructive', 'external_comms']),
    idempotent: z.boolean().default(true),
    required_permissions: z.array(z.string()).default([]),
    data_classification_touched: z
      .array(z.enum(['public', 'internal', 'confidential', 'restricted', 'pii']))
      .default(['internal']),
    timeout_ms: z.number().int().min(100).max(300_000).default(15_000),
    cost_model: z
      .object({ per_call_micro_usd: z.number().int().min(0).default(0) })
      .default({ per_call_micro_usd: 0 }),
    implementation: z.enum(['builtin', 'sandbox_js', 'sandbox_python', 'http']).default('builtin'),
    untrusted_source: z.boolean().optional(),
  })
  .openapi('ToolContract');

export const CreateToolRequestSchema = ToolContractWireSchema.extend({
  workspace_id: z.string().optional(),
}).openapi('CreateToolRequest');

export const LethalTrifectaReportSchema = z
  .object({
    detected: z.boolean(),
    has_private_data: z.boolean(),
    has_untrusted_input: z.boolean(),
    has_external_comms: z.boolean(),
    reasons: z.array(z.string()),
  })
  .openapi('LethalTrifectaReport');

export const AgentToolBindingWireSchema = z.object({
  tool: z.string().min(2).max(64),
  version: z.string().optional(),
  approval: z.enum(['never', 'auto', 'always']).default('auto'),
  scope: z
    .object({
      allowed_domains: z.array(z.string()).optional(),
      allowed_methods: z.array(z.string()).optional(),
      max_calls_per_run: z.number().int().min(1).max(500).optional(),
    })
    .default({}),
});

export const AgentDefinitionWireSchema = z
  .object({
    kind: z.literal('AgentVersion').default('AgentVersion'),
    apiVersion: z.literal('elshad.ai/v1').default('elshad.ai/v1'),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().max(2000).optional(),
    autonomy_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    model: z.object({
      tier: z.enum(['fast', 'standard', 'reasoning', 'embedding']).default('standard'),
      provider: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).default(0.2),
      max_output_tokens: z.number().int().min(64).max(128_000).optional(),
      routing_strategy: z.enum(['latency', 'cost', 'quality', 'capability']).default('quality'),
      fallback: z.array(z.object({ provider: z.string(), model: z.string() })).default([]),
    }),
    prompt: z.object({
      system: z.string().min(1).max(32_000),
      instructions: z.string().max(16_000).optional(),
      output_schema: z.record(z.string(), z.unknown()).optional(),
    }),
    tools: z.array(AgentToolBindingWireSchema).default([]),
    limits: z
      .object({
        max_steps: z.number().int().min(1).default(25),
        max_tokens: z.number().int().min(256).default(200_000),
        max_wall_time_ms: z.number().int().min(500).default(900_000),
        max_cost_micro_usd: z.number().int().min(0).default(2_000_000),
        max_tool_calls: z.number().int().min(0).default(40),
      })
      .default({
        max_steps: 25,
        max_tokens: 200_000,
        max_wall_time_ms: 900_000,
        max_cost_micro_usd: 2_000_000,
        max_tool_calls: 40,
      }),
    reasoning: z
      .object({
        strategy: z.enum(['react', 'plan_execute', 'single_shot']).default('react'),
        allow_parallel_tool_calls: z.boolean().default(false),
      })
      .default({ strategy: 'react', allow_parallel_tool_calls: false }),
  })
  .openapi('AgentDefinition');

export const CreateAgentRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    project_id: z.string().optional(),
    definition: AgentDefinitionWireSchema,
  })
  .openapi('CreateAgentRequest');

export const UpdateAgentDraftRequestSchema = z
  .object({
    definition: AgentDefinitionWireSchema,
    message: z.string().max(500).optional(),
  })
  .openapi('UpdateAgentDraftRequest');

export const AgentVersionWireSchema = z
  .object({
    id: z.string(),
    agent_id: z.string(),
    semver: z.string(),
    state: z.enum(['draft', 'published', 'retired']),
    definition: AgentDefinitionWireSchema,
    definition_hash: z.string(),
    message: z.string().nullable(),
    lethal_trifecta: LethalTrifectaReportSchema,
    created_by: z.string(),
    created_at: z.string(),
  })
  .openapi('AgentVersion');

export const AgentWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    project_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(['draft', 'active', 'deprecated', 'archived']),
    current_version_id: z.string().nullable(),
    draft_version: AgentVersionWireSchema.nullable(),
    published_version: AgentVersionWireSchema.nullable(),
    versions: z.array(AgentVersionWireSchema),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Agent');

export const PublishAgentVersionRequestSchema = z
  .object({
    message: z.string().max(500).optional(),
    allow_l4_autonomy: z.boolean().optional(),
  })
  .openapi('PublishAgentVersionRequest');

export const AgentDiffQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const AgentDiffResponseSchema = z
  .object({
    from_version: z.string(),
    to_version: z.string(),
    breaking: z.boolean(),
    changes: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(['added', 'removed', 'changed']),
        before: z.unknown().optional(),
        after: z.unknown().optional(),
      }),
    ),
  })
  .openapi('AgentDiffResponse');

export const RunAgentRequestSchema = z
  .object({
    environment: z.enum(['dev', 'staging', 'prod']).optional(),
    version_id: z.string().optional(),
    input: z.union([z.string(), z.record(z.string(), z.unknown())]),
    dry_run: z.boolean().default(false),
    mock_turns: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .openapi('RunAgentRequest');

export const UsageLedgerEntryWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    project_id: z.string(),
    environment_id: z.string(),
    run_id: z.string(),
    step_seq: z.number().int(),
    principal_id: z.string(),
    category: z.enum(['llm_tokens', 'tool_call', 'sandbox_ms', 'storage']),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    cached_tokens: z.number().int(),
    quantity: z.number().int(),
    unit: z.string(),
    cost_micro_usd: z.number().int(),
    ts: z.string(),
  })
  .openapi('UsageLedgerEntry');

// ---------- Slice S0.4 Workflow Schemas ----------

export const WorkflowNodeWireSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.string().min(3).max(64),
    name: z.string().min(1).max(128),
    position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
    config: z.record(z.string(), z.unknown()).default({}),
    on_error: z
      .object({
        mode: z.enum(['fail', 'continue', 'retry', 'route']).default('fail'),
        retry: z
          .object({
            max: z.number().int().min(1).max(10).default(2),
            backoff_ms: z.number().int().min(0).max(60_000).default(250),
          })
          .optional(),
      })
      .optional(),
  })
  .openapi('WorkflowNode');

export const WorkflowEdgeWireSchema = z
  .object({
    id: z.string().min(1).max(64),
    from: z.object({ node: z.string().min(1), port: z.string().min(1).default('main') }),
    to: z.object({ node: z.string().min(1), port: z.string().min(1).default('in') }),
  })
  .openapi('WorkflowEdge');

export const WorkflowSettingsWireSchema = z
  .object({
    max_concurrency: z.number().int().min(1).max(100).default(10),
    queue: z.string().default('default'),
    timeout_ms: z.number().int().min(1000).max(86_400_000).default(900_000),
    error_workflow: z.string().optional(),
    serialize_by: z.string().optional(),
  })
  .default({ max_concurrency: 10, queue: 'default', timeout_ms: 900_000 });

export const WorkflowGraphWireSchema = z
  .object({
    schema_version: z.literal(1).default(1),
    settings: WorkflowSettingsWireSchema,
    nodes: z.array(WorkflowNodeWireSchema).min(1),
    edges: z.array(WorkflowEdgeWireSchema).default([]),
    pinned_data: z.record(z.string(), z.array(z.unknown())).default({}),
    notes: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          position: z.object({ x: z.number(), y: z.number() }).optional(),
        }),
      )
      .default([]),
  })
  .openapi('WorkflowGraph');

export const WorkflowValidationIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  node_id: z.string().optional(),
  edge_id: z.string().optional(),
});

export const WorkflowValidationResponseSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(WorkflowValidationIssueSchema),
    warnings: z.array(WorkflowValidationIssueSchema),
  })
  .openapi('WorkflowValidationResponse');

export const ValidateWorkflowRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    environment: z.enum(['dev', 'staging', 'prod']).optional(),
    graph: WorkflowGraphWireSchema.optional(),
    yaml_source: z.string().optional(),
  })
  .openapi('ValidateWorkflowRequest');

export const CreateWorkflowRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    project_id: z.string().optional(),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
    description: z.string().max(2000).optional(),
    semver: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
    graph: WorkflowGraphWireSchema.optional(),
    yaml_source: z.string().optional(),
  })
  .openapi('CreateWorkflowRequest');

export const UpdateWorkflowDraftRequestSchema = z
  .object({
    semver: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
    description: z.string().max(2000).optional(),
    graph: WorkflowGraphWireSchema.optional(),
    yaml_source: z.string().optional(),
    message: z.string().max(500).optional(),
  })
  .openapi('UpdateWorkflowDraftRequest');

export const WorkflowVersionWireSchema = z
  .object({
    id: z.string(),
    workflow_id: z.string(),
    semver: z.string(),
    state: z.enum(['draft', 'published', 'retired']),
    schema_version: z.number().int(),
    graph: WorkflowGraphWireSchema,
    graph_hash: z.string(),
    yaml_source: z.string(),
    message: z.string().nullable(),
    created_by: z.string(),
    created_at: z.string(),
  })
  .openapi('WorkflowVersion');

export const WorkflowWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    project_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(['draft', 'active', 'paused', 'archived']),
    current_version_id: z.string().nullable(),
    draft_version: WorkflowVersionWireSchema.nullable(),
    published_version: WorkflowVersionWireSchema.nullable(),
    versions: z.array(WorkflowVersionWireSchema),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Workflow');

export const PublishWorkflowVersionRequestSchema = z
  .object({
    environment: z.enum(['dev', 'staging', 'prod']).optional(),
    message: z.string().max(500).optional(),
    activate_triggers: z.boolean().default(true),
  })
  .openapi('PublishWorkflowVersionRequest');

export const RunWorkflowRequestSchema = z
  .object({
    environment: z.enum(['dev', 'staging', 'prod']).optional(),
    version_id: z.string().optional(),
    trigger_payload: z.record(z.string(), z.unknown()).default({}),
    pinned_data: z.record(z.string(), z.array(z.unknown())).optional(),
    start_from_node_id: z.string().optional(),
  })
  .openapi('RunWorkflowRequest');

export const TriggerWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    environment_id: z.string(),
    workflow_id: z.string(),
    workflow_version_id: z.string(),
    node_id: z.string(),
    kind: z.enum(['webhook', 'schedule', 'manual']),
    external_id: z.string(),
    path: z.string().nullable(),
    active: z.boolean(),
    test_mode: z.boolean(),
    last_fired_at: z.string().nullable(),
    next_fire_at: z.string().nullable(),
  })
  .openapi('Trigger');

export const WebhookAckResponseSchema = z
  .object({
    status: z.enum(['accepted', 'captured_test']),
    trigger_id: z.string(),
    event_id: z.string(),
    run_id: z.string().nullable(),
  })
  .openapi('WebhookAckResponse');

export const NodeDescriptorWireSchema = z
  .object({
    type: z.string(),
    category: z.string(),
    label: z.string(),
    inputs: z.array(z.string()),
    outputs: z.array(z.string()),
  })
  .openapi('WorkflowNodeDescriptor');

// ---------- S0.5 Memory & Knowledge Base Schemas ----------

export const MemoryScopeWireSchema = z.enum([
  'run',
  'session',
  'user',
  'agent',
  'project',
  'org',
]);

export const MemoryKindWireSchema = z.enum(['episodic', 'semantic', 'procedural']);

export const SensitivityLevelWireSchema = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
  'pii',
]);

export const MemoryProvenanceWireSchema = z.object({
  source_run_id: z.string().optional(),
  source_step_id: z.string().optional(),
  source_doc_id: z.string().optional(),
  source_principal_id: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  created_via: z.enum(['auto_extract', 'explicit_tool', 'human', 'system']).optional(),
});

export const MemoryItemWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    project_id: z.string().nullable(),
    scope: MemoryScopeWireSchema,
    scope_id: z.string().nullable(),
    subject_id: z.string().nullable(),
    kind: MemoryKindWireSchema,
    content: z.string(),
    content_hash: z.string(),
    embedding_dim: z.number().int(),
    metadata: z.record(z.string(), z.unknown()),
    sensitivity: SensitivityLevelWireSchema,
    provenance: MemoryProvenanceWireSchema,
    importance: z.number(),
    contradicts_id: z.string().nullable(),
    ttl_at: z.string().nullable(),
    pinned: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('MemoryItem');

export const PutMemoryItemRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    project_id: z.string().optional(),
    scope: MemoryScopeWireSchema,
    scope_id: z.string().nullable().optional(),
    subject_id: z.string().nullable().optional(),
    kind: MemoryKindWireSchema.default('semantic'),
    content: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sensitivity: SensitivityLevelWireSchema.default('internal'),
    provenance: MemoryProvenanceWireSchema.optional(),
    importance: z.number().min(0).max(1).default(0.5),
    ttl_at: z.string().nullable().optional(),
    pinned: z.boolean().default(false),
  })
  .openapi('PutMemoryItemRequest');

export const UpdateMemoryItemRequestSchema = z
  .object({
    content: z.string().min(1).optional(),
    pinned: z.boolean().optional(),
    importance: z.number().min(0).max(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('UpdateMemoryItemRequest');

export const SearchMemoryRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    query: z.string().min(1),
    top_k: z.number().int().min(1).max(50).default(5),
    min_score: z.number().min(0).max(1).default(0),
    scope: MemoryScopeWireSchema.optional(),
    scope_id: z.string().optional(),
    allowed_scopes: z
      .array(
        z.object({
          scope: MemoryScopeWireSchema,
          scope_id: z.string().optional(),
        }),
      )
      .optional(),
    kind: MemoryKindWireSchema.optional(),
    subject_id: z.string().optional(),
    max_sensitivity: SensitivityLevelWireSchema.optional(),
    metadata_filter: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('SearchMemoryRequest');

export const ScoredMemoryItemWireSchema = z
  .object({
    item: MemoryItemWireSchema,
    score: z.number(),
    breakdown: z.object({
      cosine: z.number(),
      bm25_norm: z.number(),
      recency_decay: z.number(),
      importance: z.number(),
    }),
  })
  .openapi('ScoredMemoryItem');

export const EraseSubjectRequestSchema = z
  .object({
    subject_id: z.string().min(1),
  })
  .openapi('EraseSubjectRequest');

export const ErasureReportWireSchema = z
  .object({
    org_id: z.string(),
    subject_id: z.string(),
    deleted_memory_items: z.number().int(),
    deleted_sessions: z.number().int(),
    erased_at: z.string(),
  })
  .openapi('ErasureReport');

export const AppendConversationSessionRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    session_id: z.string().optional(),
    agent_id: z.string().nullable().optional(),
    subject_id: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant', 'system', 'tool']),
          content: z.string().min(1),
        }),
      )
      .min(1),
    compact_threshold_tokens: z.number().int().min(20).max(200_000).optional(),
    keep_recent_messages: z.number().int().min(1).max(100).optional(),
  })
  .openapi('AppendConversationSessionRequest');

export const ConversationSessionWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    project_id: z.string().nullable(),
    agent_id: z.string().nullable(),
    subject_id: z.string().nullable(),
    title: z.string().nullable(),
    messages: z.array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.string(),
        ts: z.string(),
      }),
    ),
    rolling_summary: z.string(),
    preserved_identifiers: z.array(z.string()),
    token_count: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('ConversationSession');

export const CreateKnowledgeBaseRequestSchema = z
  .object({
    workspace_id: z.string().optional(),
    project_id: z.string().optional(),
    name: z.string().min(1).max(128),
    description: z.string().max(1000).optional(),
    embedding_model: z.string().default('mock/text-embedding-3-small'),
    embedding_dim: z.number().int().min(64).max(3072).default(1536),
    chunk_target_tokens: z.number().int().min(30).max(2000).default(400),
    chunk_max_tokens: z.number().int().min(60).max(4000).default(800),
    chunk_overlap_tokens: z.number().int().min(0).max(400).default(60),
    sensitivity: SensitivityLevelWireSchema.default('internal'),
  })
  .openapi('CreateKnowledgeBaseRequest');

export const KnowledgeBaseWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    project_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    embedding_model: z.string(),
    embedding_dim: z.number().int(),
    chunk_target_tokens: z.number().int(),
    chunk_max_tokens: z.number().int(),
    chunk_overlap_tokens: z.number().int(),
    sensitivity: SensitivityLevelWireSchema,
    created_by: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('KnowledgeBase');

export const KbSourceWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    kb_id: z.string(),
    name: z.string(),
    kind: z.enum(['file', 'url', 'manual']),
    uri: z.string().nullable(),
    mime_type: z.string(),
    sync_status: z.enum(['pending', 'syncing', 'synced', 'failed']),
    access_principals: z.array(z.string()),
    last_synced_at: z.string().nullable(),
    last_error: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('KbSource');

export const KbDocumentWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    kb_id: z.string(),
    source_id: z.string(),
    external_key: z.string(),
    title: z.string(),
    mime_type: z.string(),
    content_hash: z.string(),
    byte_size: z.number().int(),
    chunk_count: z.number().int(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('KbDocument');

export const KbChunkWireSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    kb_id: z.string(),
    source_id: z.string(),
    doc_id: z.string(),
    chunk_index: z.number().int(),
    section_path: z.array(z.string()),
    page: z.number().int().nullable(),
    char_start: z.number().int(),
    char_end: z.number().int(),
    token_count: z.number().int(),
    content: z.string(),
    content_hash: z.string(),
    embedding_dim: z.number().int(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.string(),
  })
  .openapi('KbChunk');

export const KnowledgeBaseDetailWireSchema = KnowledgeBaseWireSchema.extend({
  sources: z.array(KbSourceWireSchema),
  documents: z.array(KbDocumentWireSchema),
  chunks: z.array(KbChunkWireSchema),
}).openapi('KnowledgeBaseDetail');

export const KbSyncReportWireSchema = z
  .object({
    kb_id: z.string(),
    source_id: z.string(),
    doc_id: z.string(),
    added_chunks: z.number().int(),
    unchanged_chunks: z.number().int(),
    deleted_chunks: z.number().int(),
    re_embedded_chunks: z.number().int(),
    synced_at: z.string(),
  })
  .openapi('KbSyncReport');

export const IngestKbDocumentRequestSchema = z
  .object({
    source_name: z.string().optional(),
    kind: z.enum(['file', 'url', 'manual']).default('file'),
    uri: z.string().optional(),
    external_key: z.string().optional(),
    title: z.string().min(1),
    mime_type: z.string().default('text/markdown'),
    content: z.string().optional(),
    access_principals: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('IngestKbDocumentRequest');

export const KbIngestResponseWireSchema = z
  .object({
    source: KbSourceWireSchema,
    document: KbDocumentWireSchema,
    sync_report: KbSyncReportWireSchema,
  })
  .openapi('KbIngestResponse');

export const KbSyncRequestSchema = z
  .object({
    doc_id: z.string(),
    content: z.string().min(1),
    title: z.string().optional(),
  })
  .openapi('KbSyncRequest');

export const KbQueryRequestSchema = z
  .object({
    query: z.string().min(1),
    top_k: z.number().int().min(1).max(20).default(5),
    min_score: z.number().min(0).max(1).default(0),
  })
  .openapi('KbQueryRequest');

export const CitationChipWireSchema = z
  .object({
    citation_id: z.string(),
    chunk_id: z.string(),
    doc_id: z.string(),
    doc_title: z.string(),
    section_path: z.array(z.string()),
    char_range: z.object({
      start: z.number().int(),
      end: z.number().int(),
    }),
    score: z.number(),
    snippet: z.string(),
    content: z.string(),
  })
  .openapi('CitationChip');

export const KbQueryResponseWireSchema = z
  .object({
    kb_id: z.string(),
    query: z.string(),
    answer: z.string(),
    citations: z.array(CitationChipWireSchema),
    results: z.array(
      z.object({
        chunk: KbChunkWireSchema,
        doc_title: z.string(),
        score: z.number(),
        breakdown: z.object({
          cosine: z.number(),
          bm25_norm: z.number(),
          recency_decay: z.number(),
          importance: z.number(),
        }),
      }),
    ),
  })
  .openapi('KbQueryResponse');
