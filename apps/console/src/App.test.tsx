// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import {
  PlatformClient,
  type AgentDto,
  type AgentIdentityDto,
  type ApiKeyDto,
  type ApprovalDto,
  type BudgetDto,
  type CitationChipDto,
  type ConnectionDto,
  type ConnectorManifestDto,
  type ConversationSessionDto,
  type CustomToolDto,
  type DatasetDto,
  type DeploymentDto,
  type DlqItemDto,
  type ExperimentDto,
  type ExperimentResultDto,
  type GraderDto,
  type KbChunkDto,
  type KbDocumentDto,
  type KbSourceDto,
  type KillSwitchDto,
  type KnowledgeBaseDetailDto,
  type KnowledgeBaseDto,
  type McpServerDto,
  type McpServerToolDto,
  type MeDto,
  type MemoryItemDto,
  type ModelCapabilityDto,
  type NotificationDto,
  type PolicyDto,
  type PromotionDto,
  type RunDto,
  type RunStepDto,
  type SecretMetadataDto,
  type TestCaseDto,
  type TeamDto,
  type TeamSimulationDto,
  type ToolContractDto,
  type ToolGrantDto,
  type TriggerDto,
  type WorkflowDto,
  type WorkflowGraphDto,
  type WorkflowNodeDescriptorDto,
} from '@elshad/sdk-ts';
import { ConsoleApp } from './App.js';

afterEach(() => {
  cleanup();
});

function createMockClient(
  opts: {
    authenticatedInitially?: boolean;
    initialStepsByRun?: Record<string, RunStepDto[]>;
  } = {},
) {
  let authed = opts.authenticatedInitially ?? false;
  const keys: ApiKeyDto[] = [];
  const runs: RunDto[] = [];
  const stepsByRun = new Map<string, RunStepDto[]>(
    Object.entries(opts.initialStepsByRun ?? {}),
  );
  const dlqItems: DlqItemDto[] = [
    {
      id: 'wi_dlq_1',
      runId: 'run_failed_1',
      workspaceId: 'ws_1',
      queue: 'default',
      attempts: 5,
      maxAttempts: 5,
      lastError: { code: 'TOOL_TIMEOUT', message: 'Upstream timeout' },
      createdAt: '2026-11-18T12:00:00.000Z',
    },
  ];

  const me: MeDto = {
    principal: {
      id: 'prn_1',
      orgId: 'org_1',
      type: 'user',
      email: 'admin@elshad.local',
      displayName: 'Platform Admin',
    },
    orgId: 'org_1',
    orgSlug: 'default-org',
    orgName: 'Default Organization',
    bindings: [
      {
        id: 'rbi_1',
        principalId: 'prn_1',
        roleId: 'rol_1',
        roleName: 'org_owner',
        scopeType: 'org',
        scopeId: 'org_1',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
    ],
    workspaces: [
      {
        id: 'ws_1',
        orgId: 'org_1',
        slug: 'default',
        name: 'Default Workspace',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
      {
        id: 'ws_2',
        orgId: 'org_1',
        slug: 'finance',
        name: 'Finance Ops',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
    ],
  };

  const client = new PlatformClient({ baseUrl: 'http://localhost:8080' });

  client.auth.me = async () => {
    if (!authed) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Not signed in');
    }
    return me;
  };
  client.auth.login = async (_email, password) => {
    if (password !== 'ChangeMe123!') {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid email or password.');
    }
    authed = true;
    return { csrfToken: 'csrf_1', me };
  };
  client.auth.logout = async () => {
    authed = false;
  };
  client.projects.list = async () => [
    {
      id: 'prj_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      slug: 'default-project',
      name: 'Default Project',
      description: null,
      maxAutonomyLevel: 'L3',
      createdAt: '2026-11-18T12:00:00.000Z',
    },
  ];
  client.apiKeys.list = async () => [...keys];
  client.apiKeys.create = async (input) => {
    const item = {
      id: `key_${keys.length + 1}`,
      name: input.name,
      keyPrefix: 'key_abc12345',
      scopes: input.scopes ?? [],
      workspaceId: input.workspaceId ?? null,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-11-18T12:00:00.000Z',
      secret: 'key_abc12345_super_secret_once',
    };
    keys.push(item);
    return item;
  };
  client.apiKeys.revoke = async (id) => {
    const found = keys.find((k) => k.id === id);
    if (found) found.revokedAt = '2026-11-18T12:05:00.000Z';
  };
  client.auditEvents.list = async () => ({
    data: [
      {
        id: 'aud_1',
        seq: 1,
        ts: '2026-11-18T12:00:00.000Z',
        actor: { id: 'prn_1' },
        action: 'auth.login',
        resource: { type: 'session' },
        decision: 'allow',
        hash: 'a'.repeat(64),
        prevHash: '0'.repeat(64),
      },
    ],
    nextCursor: null,
  });

  client.runs.list = async () => [...runs];
  client.runs.get = async (id) => {
    const found = runs.find((r) => r.id === id);
    if (!found) throw new PlatformError('RES_NOT_FOUND', 'Run not found');
    return found;
  };
  client.runs.listSteps = async (id) => stepsByRun.get(id) ?? [];
  client.runs.listEvents = async (id) => [
    {
      runId: id,
      seq: 1,
      type: 'run.created',
      data: {},
      createdAt: '2026-11-18T12:00:00.000Z',
    },
  ];
  client.runs.create = async (input) => {
    const id = `run_${runs.length + 1}`;
    const run: RunDto = {
      id,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      environmentId: 'env_1',
      rootRunId: id,
      parentRunId: null,
      subjectType: input.subjectType ?? 'agent_version',
      subjectVersionId: input.subjectVersionId,
      status: 'succeeded',
      failureClass: null,
      terminationReason: 'final_answer',
      initiatorId: 'prn_1',
      input: {},
      output: { ok: true },
      usage: { steps: 2, tokensIn: 0, tokensOut: 0, toolCalls: 1 },
      costMicroUsd: 160,
      labels: {},
      lastEventSeq: 3,
      createdAt: '2026-11-18T12:00:00.000Z',
      startedAt: '2026-11-18T12:00:00.100Z',
      endedAt: '2026-11-18T12:00:00.500Z',
    };
    runs.push(run);
    stepsByRun.set(id, [
      {
        id: `${id}_s1`,
        runId: id,
        seq: 1,
        type: 'decision',
        status: 'succeeded',
        attempt: 1,
        idempotencyKey: 'idem_hash_1',
        summary: { note: 'Plan turn' },
        tokensIn: 0,
        tokensOut: 0,
        costMicroUsd: 120,
        latencyMs: 14,
        startedAt: '2026-11-18T12:00:00.100Z',
        endedAt: '2026-11-18T12:00:00.114Z',
      },
      {
        id: `${id}_s2`,
        runId: id,
        seq: 2,
        type: 'tool_call',
        status: 'succeeded',
        attempt: 1,
        idempotencyKey: 'idem_hash_2',
        summary: { tool: 'http_get' },
        tokensIn: 0,
        tokensOut: 0,
        costMicroUsd: 40,
        latencyMs: 35,
        startedAt: '2026-11-18T12:00:00.115Z',
        endedAt: '2026-11-18T12:00:00.150Z',
      },
    ]);
    return run;
  };
  client.runs.listDlq = async () => [...dlqItems];
  client.runs.bulkRedrive = async (runIds) => {
    for (const id of runIds) {
      const idx = dlqItems.findIndex((d) => d.runId === id);
      if (idx >= 0) dlqItems.splice(idx, 1);
    }
    return [];
  };

  // S0.3 Mocks
  const agents: AgentDto[] = [];
  const modelsCatalog: ModelCapabilityDto[] = [
    {
      id: 'mock/react-default',
      provider: 'mock',
      displayName: 'Mock ReAct Default',
      tier: 'standard',
      contextWindowTokens: 128_000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      supportsStreaming: true,
      pricingPerMillion: { inputMicroUsd: 500_000, outputMicroUsd: 1_500_000, cachedInputMicroUsd: 125_000 },
      status: 'active',
    },
  ];
  const toolsCatalog: ToolContractDto[] = [
    {
      name: 'current_time',
      version: '1.0.0',
      description: 'Return UTC timestamp',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      sideEffectClass: 'read',
      idempotent: true,
      requiredPermissions: ['tool:run'],
      dataClassificationTouched: ['public'],
      timeoutMs: 2000,
      implementation: 'builtin',
    },
    {
      name: 'web_fetch',
      version: '1.0.0',
      description: 'Fetch public web page',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      sideEffectClass: 'read',
      idempotent: true,
      requiredPermissions: ['tool:run'],
      dataClassificationTouched: ['public'],
      timeoutMs: 15_000,
      implementation: 'http',
    },
    {
      name: 'http_request',
      version: '1.0.0',
      description: 'Send external HTTP request',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      sideEffectClass: 'external_comms',
      idempotent: false,
      requiredPermissions: ['tool:run'],
      dataClassificationTouched: ['internal'],
      timeoutMs: 15_000,
      implementation: 'http',
    },
    {
      name: 'confidential_kb_read',
      version: '1.0.0',
      description: 'Read confidential records',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      sideEffectClass: 'read',
      idempotent: true,
      requiredPermissions: ['tool:run'],
      dataClassificationTouched: ['confidential', 'pii'],
      timeoutMs: 5_000,
      implementation: 'builtin',
    },
  ];

  client.models.list = async () => [...modelsCatalog];
  client.tools.list = async () => [...toolsCatalog];
  client.agents.list = async () => [...agents];
  client.agents.create = async (input) => {
    const def = input.definition as Record<string, unknown>;
    const agentId = `agt_${agents.length + 1}`;
    const verId = `agv_${agents.length + 1}_1`;
    const created: AgentDto = {
      id: agentId,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      projectId: input.projectId ?? 'prj_1',
      name: String(def.name ?? 'new-agent'),
      description: def.description ? String(def.description) : null,
      status: 'draft',
      currentVersionId: null,
      draftVersion: {
        id: verId,
        agentId,
        semver: String(def.version ?? '1.0.0'),
        state: 'draft',
        definition: def,
        definitionHash: 'hash_v1',
        message: 'Initial draft',
        lethalTrifecta: {
          detected: false,
          hasPrivateData: false,
          hasUntrustedInput: false,
          hasExternalComms: false,
          reasons: [],
        },
        createdBy: 'prn_1',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
      publishedVersion: null,
      versions: [],
      createdAt: '2026-11-18T12:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    };
    created.versions = [created.draftVersion!];
    agents.push(created);
    return structuredClone(created);
  };
  client.agents.publishVersion = async (id, verId) => {
    const found = agents.find((a) => a.id === id);
    if (!found) throw new PlatformError('RES_NOT_FOUND', 'Agent not found');
    found.status = 'active';
    found.currentVersionId = verId;
    if (found.draftVersion) {
      found.draftVersion.state = 'published';
      found.publishedVersion = found.draftVersion;
      found.draftVersion = null;
    }
    return structuredClone(found);
  };
  client.agents.run = async (id, input) => {
    const runId = `run_agent_${runs.length + 1}`;
    const run: RunDto = {
      id: runId,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      environmentId: 'env_1',
      rootRunId: runId,
      parentRunId: null,
      subjectType: 'agent_version',
      subjectVersionId: id,
      status: 'succeeded',
      failureClass: null,
      terminationReason: 'final_answer',
      initiatorId: 'prn_1',
      input: input.input,
      output: { answer: 'Current UTC time is 2026-11-18T12:00:00.000Z.' },
      usage: { steps: 2, tokensIn: 140, tokensOut: 40, toolCalls: 1 },
      costMicroUsd: 275,
      labels: {},
      lastEventSeq: 3,
      createdAt: '2026-11-18T12:00:00.000Z',
      startedAt: '2026-11-18T12:00:00.000Z',
      endedAt: '2026-11-18T12:00:00.200Z',
    };
    runs.push(run);
    stepsByRun.set(runId, [
      {
        id: `${runId}_s1`,
        runId,
        seq: 1,
        type: 'llm_call',
        status: 'succeeded',
        attempt: 1,
        idempotencyKey: 'idem_llm_1',
        summary: { model: 'mock/react-default' },
        tokensIn: 140,
        tokensOut: 40,
        costMicroUsd: 275,
        latencyMs: 12,
        startedAt: '2026-11-18T12:00:00.000Z',
        endedAt: '2026-11-18T12:00:00.012Z',
      },
      {
        id: `${runId}_s2`,
        runId,
        seq: 2,
        type: 'tool_call',
        status: 'succeeded',
        attempt: 1,
        idempotencyKey: 'idem_tool_2',
        summary: { toolName: 'current_time', dryRun: Boolean(input.dryRun) },
        tokensIn: 0,
        tokensOut: 0,
        costMicroUsd: 0,
        latencyMs: 3,
        startedAt: '2026-11-18T12:00:00.013Z',
        endedAt: '2026-11-18T12:00:00.016Z',
      },
    ]);
    return run;
  };
  client.runs.listUsageLedger = async (runId) => ({
    data: [
      {
        id: 'ul_1',
        orgId: 'org_1',
        workspaceId: 'ws_1',
        projectId: 'prj_1',
        environmentId: 'env_1',
        runId,
        stepSeq: 1,
        principalId: 'prn_1',
        category: 'llm_tokens',
        provider: 'mock',
        model: 'mock/react-default',
        tokensIn: 140,
        tokensOut: 40,
        cachedTokens: 0,
        quantity: 180,
        unit: 'tokens',
        costMicroUsd: 275,
        ts: '2026-11-18T12:00:00.012Z',
      },
    ],
    totalCostMicroUsd: 275,
  });

  // S0.4 Mocks
  const workflows: WorkflowDto[] = [];
  const triggers: TriggerDto[] = [];
  const nodeCatalog: WorkflowNodeDescriptorDto[] = [
    { type: 'trigger.webhook', category: 'trigger', label: 'Webhook Trigger', inputs: [], outputs: ['main'] },
    { type: 'trigger.schedule', category: 'trigger', label: 'Schedule Trigger', inputs: [], outputs: ['main'] },
    { type: 'trigger.manual', category: 'trigger', label: 'Manual Trigger', inputs: [], outputs: ['main'] },
    { type: 'ai.agent', category: 'ai', label: 'Agent Step', inputs: ['main'], outputs: ['main'] },
    { type: 'ai.llm', category: 'ai', label: 'LLM Prompt', inputs: ['main'], outputs: ['main'] },
    { type: 'logic.if', category: 'logic', label: 'IF Branch', inputs: ['main'], outputs: ['true', 'false'] },
    { type: 'logic.switch', category: 'logic', label: 'Switch Branch', inputs: ['main'], outputs: ['case_0', 'default'] },
    { type: 'logic.loop', category: 'logic', label: 'Loop Items', inputs: ['main'], outputs: ['item', 'done'] },
    { type: 'logic.parallel', category: 'logic', label: 'Parallel Fan-out', inputs: ['main'], outputs: ['branch_a', 'branch_b'] },
    { type: 'logic.join', category: 'logic', label: 'Join Branches', inputs: ['a', 'b'], outputs: ['main'] },
    { type: 'logic.wait', category: 'logic', label: 'Wait / Delay', inputs: ['main'], outputs: ['main'] },
    { type: 'data.set', category: 'data', label: 'Set Fields', inputs: ['main'], outputs: ['main'] },
    { type: 'data.code', category: 'data', label: 'JSONata Transform', inputs: ['main'], outputs: ['main'] },
    { type: 'integration.http', category: 'integration', label: 'HTTP Request', inputs: ['main'], outputs: ['main'] },
    { type: 'human.notify', category: 'human', label: 'Slack / Notify', inputs: ['main'], outputs: ['main'] },
    { type: 'control.subworkflow', category: 'control', label: 'Sub-workflow', inputs: ['main'], outputs: ['main'] },
    { type: 'control.stop', category: 'control', label: 'Stop Workflow', inputs: ['main'], outputs: [] },
  ];

  const makeYaml = (name: string, semver: string, graph: WorkflowGraphDto): string =>
    [
      'schema_version: 1',
      `name: ${name}`,
      `semver: ${semver}`,
      'nodes:',
      ...graph.nodes.map((n) => `  - id: ${n.id}\n    type: ${n.type}\n    name: ${n.name}`),
    ].join('\n');

  client.workflows.listNodes = async () => structuredClone(nodeCatalog);
  client.workflows.list = async () => structuredClone(workflows);
  client.workflows.validate = async (input) => ({
    valid: (input.graph?.nodes.length ?? 0) > 0,
    errors: [],
    warnings: [],
  });
  client.workflows.create = async (input) => {
    const id = `wf_${workflows.length + 1}`;
    const verId = `wfv_${workflows.length + 1}_1`;
    const graph: WorkflowGraphDto = input.graph ?? {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 120_000 },
      nodes: [{ id: 'n_1', type: 'trigger.manual', name: 'Start', position: { x: 40, y: 40 }, config: {} }],
      edges: [],
      pinned_data: {},
      notes: [],
    };
    const ver = {
      id: verId,
      workflowId: id,
      semver: input.semver ?? '1.0.0',
      state: 'draft' as const,
      schemaVersion: 1,
      graph: structuredClone(graph),
      graphHash: 'sha256-mock-s04',
      yamlSource: input.yamlSource ?? makeYaml(input.name, input.semver ?? '1.0.0', graph),
      message: null,
      createdBy: 'prn_1',
      createdAt: '2026-11-18T12:00:00Z',
    };
    const wf: WorkflowDto = {
      id,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      projectId: input.projectId ?? 'prj_1',
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      currentVersionId: verId,
      draftVersion: ver,
      publishedVersion: null,
      versions: [ver],
      createdAt: '2026-11-18T12:00:00Z',
      updatedAt: '2026-11-18T12:00:00Z',
    };
    workflows.push(wf);
    return structuredClone(wf);
  };
  client.workflows.get = async (id) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) throw new Error('not found');
    return structuredClone(wf);
  };
  client.workflows.updateDraft = async (id, input) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) throw new Error('not found');
    const base = wf.draftVersion ?? wf.publishedVersion!;
    const nextGraph = input.graph ? structuredClone(input.graph) : structuredClone(base.graph);
    const nextVer = {
      ...base,
      id: `${base.id}_d`,
      semver: input.semver ?? base.semver,
      graph: nextGraph,
      yamlSource: input.yamlSource ?? makeYaml(wf.name, input.semver ?? base.semver, nextGraph),
      message: input.message ?? null,
    };
    wf.draftVersion = nextVer;
    wf.versions = [nextVer];
    wf.updatedAt = '2026-11-18T12:01:00Z';
    return structuredClone(wf);
  };
  client.workflows.publishVersion = async (id, versionId) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) throw new Error('not found');
    const target = wf.versions.find((v) => v.id === versionId) ?? wf.draftVersion!;
    const pub = { ...target, state: 'published' as const };
    wf.status = 'active';
    wf.publishedVersion = pub;
    wf.draftVersion = null;
    wf.versions = [pub];
    const hasWebhook = pub.graph.nodes.find((n) => n.type === 'trigger.webhook');
    if (hasWebhook) {
      triggers.push({
        id: `trg_${triggers.length + 1}`,
        orgId: wf.orgId,
        workspaceId: wf.workspaceId,
        environmentId: 'env_1',
        workflowId: wf.id,
        workflowVersionId: pub.id,
        nodeId: hasWebhook.id,
        kind: 'webhook',
        externalId: 'hook-s04-triage',
        path: 'inbox-triage',
        active: true,
        testMode: false,
        lastFiredAt: null,
        nextFireAt: null,
      });
    }
    return structuredClone(wf);
  };
  client.workflows.run = async (id, input) => {
    const run: RunDto = {
      id: input.startFromNodeId ? 'run_wf_from_node' : 'run_wf_full',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      projectId: 'prj_1',
      environmentId: 'env_1',
      subjectType: 'workflow_version',
      subjectId: id,
      status: 'succeeded',
      triggerType: 'manual',
      costMicroUsd: 25,
      tokensIn: 10,
      tokensOut: 10,
      startedAt: '2026-11-18T12:02:00Z',
      endedAt: '2026-11-18T12:02:01Z',
      createdAt: '2026-11-18T12:02:00Z',
    };
    return structuredClone(run);
  };
  client.triggers.list = async () => structuredClone(triggers);

  // S0.5 Mocks
  const kbs: KnowledgeBaseDto[] = [];
  const kbSources = new Map<string, KbSourceDto[]>();
  const kbDocs = new Map<string, KbDocumentDto[]>();
  const kbChunks = new Map<string, KbChunkDto[]>();
  const memItems: MemoryItemDto[] = [];
  const sessions: ConversationSessionDto[] = [];

  client.knowledgeBases.list = async () => structuredClone(kbs);
  client.knowledgeBases.create = async (input) => {
    const kb: KnowledgeBaseDto = {
      id: `kb_${kbs.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      projectId: input.projectId ?? 'prj_1',
      name: input.name,
      description: input.description ?? null,
      embeddingModel: input.embeddingModel ?? 'mock/text-embedding-3-small',
      embeddingDim: input.embeddingDim ?? 1536,
      chunkTargetTokens: input.chunkTargetTokens ?? 400,
      chunkMaxTokens: input.chunkMaxTokens ?? 800,
      chunkOverlapTokens: input.chunkOverlapTokens ?? 60,
      sensitivity: input.sensitivity ?? 'internal',
      createdBy: 'prn_1',
      createdAt: '2026-11-18T12:00:00Z',
      updatedAt: '2026-11-18T12:00:00Z',
    };
    kbs.push(kb);
    kbSources.set(kb.id, []);
    kbDocs.set(kb.id, []);
    kbChunks.set(kb.id, []);
    return structuredClone(kb);
  };
  client.knowledgeBases.get = async (id) => {
    const kb = kbs.find((k) => k.id === id);
    if (!kb) throw new Error('KB not found');
    const detail: KnowledgeBaseDetailDto = {
      ...kb,
      sources: kbSources.get(id) ?? [],
      documents: kbDocs.get(id) ?? [],
      chunks: kbChunks.get(id) ?? [],
    };
    return structuredClone(detail);
  };
  client.knowledgeBases.ingestDocument = async (kbId, input) => {
    const src: KbSourceDto = {
      id: 'src_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      kbId,
      name: input.sourceName ?? input.title,
      kind: input.kind ?? 'file',
      uri: input.uri ?? null,
      mimeType: input.mimeType ?? 'text/markdown',
      syncStatus: 'synced',
      accessPrincipals: [],
      lastSyncedAt: '2026-11-18T12:01:00Z',
      lastError: null,
      createdAt: '2026-11-18T12:01:00Z',
      updatedAt: '2026-11-18T12:01:00Z',
    };
    const doc: KbDocumentDto = {
      id: 'doc_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      kbId,
      sourceId: src.id,
      externalKey: input.title,
      title: input.title,
      mimeType: input.mimeType ?? 'text/markdown',
      contentHash: 'abc123def456',
      byteSize: (input.content ?? '').length,
      chunkCount: 2,
      metadata: {},
      createdAt: '2026-11-18T12:01:00Z',
      updatedAt: '2026-11-18T12:01:00Z',
    };
    const c1: KbChunkDto = {
      id: 'chk_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      kbId,
      sourceId: src.id,
      docId: doc.id,
      chunkIndex: 0,
      sectionPath: ['Refund SLA'],
      page: null,
      charStart: 0,
      charEnd: 95,
      tokenCount: 16,
      content: '[Section: Refund SLA]\nStandard refunds complete within 5 business days with finance signoff.',
      contentHash: 'hash_c1',
      embeddingDim: 1536,
      metadata: {},
      createdAt: '2026-11-18T12:01:00Z',
    };
    kbSources.set(kbId, [src]);
    kbDocs.set(kbId, [doc]);
    kbChunks.set(kbId, [c1]);
    return {
      source: structuredClone(src),
      document: structuredClone(doc),
      syncReport: {
        kbId,
        sourceId: src.id,
        docId: doc.id,
        addedChunks: 2,
        unchangedChunks: 0,
        deletedChunks: 0,
        reEmbeddedChunks: 2,
        syncedAt: '2026-11-18T12:01:00Z',
      },
    };
  };
  client.knowledgeBases.syncDocument = async (kbId, input) => ({
    kbId,
    sourceId: 'src_1',
    docId: input.docId,
    addedChunks: 1,
    unchangedChunks: 1,
    deletedChunks: 0,
    reEmbeddedChunks: 1,
    syncedAt: '2026-11-18T12:02:00Z',
  });
  client.knowledgeBases.query = async (kbId, input) => {
    const chunks = kbChunks.get(kbId) ?? [];
    const docs = kbDocs.get(kbId) ?? [];
    const ch = chunks[0]!;
    const doc = docs[0]!;
    const cit: CitationChipDto = {
      citationId: 'cit_1',
      chunkId: ch.id,
      docId: doc.id,
      docTitle: doc.title,
      sectionPath: ch.sectionPath,
      charRange: { start: ch.charStart, end: ch.charEnd },
      score: 0.912,
      snippet: 'Standard refunds complete within 5 business days with finance signoff.',
      content: ch.content,
    };
    return {
      kbId,
      query: input.query,
      answer: `${cit.snippet} [cit:${ch.id}]`,
      citations: [cit],
      results: [
        {
          chunk: structuredClone(ch),
          docTitle: doc.title,
          score: 0.912,
          breakdown: { cosine: 0.9, bm25Norm: 1, recencyDecay: 1, importance: 0.7 },
        },
      ],
    };
  };

  client.memory.list = async () => ({
    items: structuredClone(memItems),
    nextCursor: null,
  });
  client.memory.put = async (input) => {
    const item: MemoryItemDto = {
      id: `mem_${memItems.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      projectId: input.projectId ?? 'prj_1',
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      subjectId: input.subjectId ?? null,
      kind: input.kind ?? 'semantic',
      content: input.content,
      contentHash: 'hash_m1',
      embeddingDim: 1536,
      metadata: input.metadata ?? {},
      sensitivity: input.sensitivity ?? 'internal',
      provenance: { createdVia: 'system' },
      importance: input.importance ?? 0.5,
      contradictsId: null,
      ttlAt: null,
      pinned: Boolean(input.pinned),
      createdAt: '2026-11-18T12:03:00Z',
      updatedAt: '2026-11-18T12:03:00Z',
    };
    memItems.push(item);
    return structuredClone(item);
  };
  client.memory.update = async (id, patch) => {
    const idx = memItems.findIndex((m) => m.id === id);
    if (idx < 0) throw new Error('not found');
    memItems[idx] = { ...memItems[idx]!, pinned: patch.pinned ?? memItems[idx]!.pinned };
    return structuredClone(memItems[idx]!);
  };
  client.memory.delete = async (id) => {
    const idx = memItems.findIndex((m) => m.id === id);
    if (idx >= 0) memItems.splice(idx, 1);
  };
  client.memory.search = async () =>
    memItems.map((m) => ({
      item: structuredClone(m),
      score: 0.88,
      breakdown: { cosine: 0.85, bm25Norm: 0.9, recencyDecay: 1, importance: 0.8 },
    }));
  client.memory.appendSession = async (input) => {
    const ses: ConversationSessionDto = {
      id: input.sessionId ?? `ses_${sessions.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      projectId: 'prj_1',
      agentId: null,
      subjectId: input.subjectId ?? null,
      title: input.title ?? null,
      messages: input.messages.map((m, i) => ({
        id: `msg_${i + 1}`,
        role: m.role,
        content: m.content,
        ts: '2026-11-18T12:04:00Z',
      })),
      rollingSummary: 'Compacted escalation context.\n[Preserved IDs: T-10492, INV-9981, $149.95]',
      preservedIdentifiers: ['T-10492', 'INV-9981', '$149.95'],
      tokenCount: 32,
      createdAt: '2026-11-18T12:04:00Z',
      updatedAt: '2026-11-18T12:04:00Z',
    };
    sessions.push(ses);
    return structuredClone(ses);
  };
  client.memory.eraseSubject = async (subjectId) => {
    let delMem = 0;
    for (let i = memItems.length - 1; i >= 0; i -= 1) {
      if (memItems[i]!.subjectId === subjectId || memItems[i]!.scopeId === subjectId) {
        memItems.splice(i, 1);
        delMem += 1;
      }
    }
    let delSes = 0;
    for (let i = sessions.length - 1; i >= 0; i -= 1) {
      if (sessions[i]!.subjectId === subjectId) {
        sessions.splice(i, 1);
        delSes += 1;
      }
    }
    return {
      orgId: 'org_1',
      subjectId,
      deletedMemoryItems: delMem,
      deletedSessions: delSes,
      erasedAt: '2026-11-18T12:05:00Z',
    };
  };

  const secretList: SecretMetadataDto[] = [];
  const budgetList: BudgetDto[] = [];
  const killSwitchList: KillSwitchDto[] = [];

  client.secrets.list = async () => structuredClone(secretList);
  client.secrets.put = async (input) => {
    void input.value;
    const now = '2026-11-18T12:10:00.000Z';
    const existingIdx = secretList.findIndex((s) => s.name === input.name);
    if (existingIdx >= 0) {
      const next: SecretMetadataDto = {
        ...secretList[existingIdx]!,
        keyVersion: secretList[existingIdx]!.keyVersion + 1,
        updatedAt: now,
      };
      secretList[existingIdx] = next;
      return structuredClone(next);
    }
    const created: SecretMetadataDto = {
      id: `sec_${secretList.length + 1}`,
      ref: `secret://db/ws_1/${input.name}`,
      orgId: 'org_1',
      provider: 'db',
      name: input.name,
      environmentId: input.environmentId ?? null,
      keyVersion: 1,
      kekVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    secretList.unshift(created);
    return structuredClone(created);
  };
  client.secrets.rotate = async (id, value) => {
    void value;
    const idx = secretList.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('secret not found');
    const updated: SecretMetadataDto = {
      ...secretList[idx]!,
      keyVersion: secretList[idx]!.keyVersion + 1,
      updatedAt: '2026-11-18T12:11:00.000Z',
    };
    secretList[idx] = updated;
    return structuredClone(updated);
  };
  client.secrets.delete = async (id) => {
    const idx = secretList.findIndex((s) => s.id === id);
    if (idx >= 0) secretList.splice(idx, 1);
  };

  client.budgets.list = async () => structuredClone(budgetList);
  client.budgets.upsert = async (input) => {
    const now = '2026-11-18T12:10:00.000Z';
    const idx = budgetList.findIndex(
      (b) => b.scopeType === input.scopeType && b.scopeId === input.scopeId,
    );
    const entry: BudgetDto = {
      id: idx >= 0 ? budgetList[idx]!.id : `bdg_${budgetList.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      projectId: input.projectId ?? null,
      agentId: input.agentId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      period: input.period ?? 'monthly',
      softLimitMicroUsd: input.softLimitMicroUsd ?? null,
      hardLimitMicroUsd: input.hardLimitMicroUsd ?? null,
      softLimitTokens: input.softLimitTokens ?? null,
      hardLimitTokens: input.hardLimitTokens ?? null,
      spentMicroUsd: idx >= 0 ? budgetList[idx]!.spentMicroUsd : 0,
      spentTokens: idx >= 0 ? budgetList[idx]!.spentTokens : 0,
      actionOnBreach: input.actionOnBreach ?? 'stop',
      alertEmittedAt: null,
      createdBy: 'prn_1',
      createdAt: idx >= 0 ? budgetList[idx]!.createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) {
      budgetList[idx] = entry;
    } else {
      budgetList.unshift(entry);
    }
    return structuredClone(entry);
  };

  client.killswitches.list = async () => structuredClone(killSwitchList);
  client.killswitches.activate = async (input) => {
    const entry: KillSwitchDto = {
      id: `ks_${killSwitchList.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? '*',
      active: true,
      reason: input.reason,
      activatedBy: 'prn_1',
      activatedAt: '2026-11-18T12:12:00.000Z',
      deactivatedBy: null,
      deactivatedAt: null,
    };
    killSwitchList.unshift(entry);
    return structuredClone(entry);
  };
  client.killswitches.deactivate = async (id) => {
    const idx = killSwitchList.findIndex((k) => k.id === id);
    if (idx < 0) throw new Error('kill switch not found');
    const updated: KillSwitchDto = {
      ...killSwitchList[idx]!,
      active: false,
      deactivatedBy: 'prn_1',
      deactivatedAt: '2026-11-18T12:13:00.000Z',
    };
    killSwitchList[idx] = updated;
    return structuredClone(updated);
  };

  client.audit.verify = async () => ({
    valid: true,
    checkedCount: 4,
  });

  const policyList: PolicyDto[] = [];
  const agentIdentityList: AgentIdentityDto[] = [];
  const toolGrantList: ToolGrantDto[] = [];

  client.policies.list = async () => structuredClone(policyList);
  client.policies.create = async (input) => {
    const now = '2026-11-18T12:15:00.000Z';
    const created: PolicyDto = {
      id: `pol_${policyList.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      point: input.point,
      mode: input.mode ?? 'audit_only',
      version: 1,
      effect: input.effect,
      condition: input.condition ?? {},
      regoSource:
        input.regoSource ??
        `package elshad.governance.${input.slug.replace(/-/g, '_')}\nimport rego.v1\ndefault effect := "allow"\neffect := "${input.effect}" if {\n  input.point == "${input.point}"\n}`,
      createdBy: 'prn_1',
      approvedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    policyList.unshift(created);
    return structuredClone(created);
  };
  client.policies.simulate = async (input) => {
    const matched = policyList.find((p) => p.id === input.policyId);
    return {
      policyId: input.policyId ?? 'pol_1',
      policySlug: matched?.slug ?? input.slug ?? 'sim-policy',
      totalRunsEvaluated: 120,
      matchedCount: 8,
      blockedCount: 8,
      approvalRequiredCount: 0,
      sampleAffectedRunIds: ['run_hist_1', 'run_hist_2'],
      durationMs: 4,
    };
  };
  client.policies.enforce = async (id, input) => {
    const idx = policyList.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error('policy not found');
    const updated: PolicyDto = {
      ...policyList[idx]!,
      mode: 'enforce',
      version: policyList[idx]!.version + 1,
      approvedBy: input.secondApproverId ?? 'prn_reviewer_2',
      updatedAt: '2026-11-18T12:16:00.000Z',
    };
    policyList[idx] = updated;
    return structuredClone(updated);
  };

  client.agentIdentities.list = async () => structuredClone(agentIdentityList);
  client.agentIdentities.create = async (input) => {
    const now = '2026-11-18T12:15:00.000Z';
    const created: AgentIdentityDto = {
      id: `aid_${agentIdentityList.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      agentId: input.agentId,
      principalId: `prn_agent_${agentIdentityList.length + 1}`,
      environmentId: 'env_dev',
      displayName: input.displayName,
      allowedToolIds: input.allowedToolIds ?? [],
      tokenTtlSeconds: input.tokenTtlSeconds ?? 900,
      status: 'active',
      createdBy: 'prn_1',
      createdAt: now,
      updatedAt: now,
    };
    agentIdentityList.unshift(created);
    return structuredClone(created);
  };
  client.agentIdentities.issueToken = async (id, input = {}) => ({
    tokenId: 'atok_mock_1',
    agentIdentityId: id,
    agentPrincipalId: 'prn_agent_1',
    agentId: 'agt_1',
    orgId: 'org_1',
    workspaceId: 'ws_1',
    environmentId: input.environmentId ?? 'env_dev',
    onBehalfOfPrincipalId: input.onBehalfOfPrincipalId ?? 'prn_1',
    allowedToolIds: ['current_time', 'http_request'],
    expiresAt: '2026-11-18T13:00:00.000Z',
  });

  client.toolGrants.list = async () => structuredClone(toolGrantList);
  client.toolGrants.create = async (input) => {
    const created: ToolGrantDto = {
      id: `tg_${toolGrantList.length + 1}`,
      orgId: 'org_1',
      workspaceId: input.workspaceId ?? 'ws_1',
      agentId: input.agentId,
      toolId: input.toolId,
      sideEffectClass: input.sideEffectClass ?? 'read',
      scope: input.scope ?? {},
      grantedBy: 'prn_1',
      approvedBy: input.approvedBy ?? null,
      status: 'active',
      createdAt: '2026-11-18T12:15:00.000Z',
    };
    toolGrantList.unshift(created);
    return structuredClone(created);
  };
  client.toolGrants.revoke = async (id) => {
    const idx = toolGrantList.findIndex((g) => g.id === id);
    if (idx >= 0) toolGrantList.splice(idx, 1);
  };

  client.audit.export = async (opts = {}) => ({
    format: opts.format ?? 'csv',
    contentType: opts.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
    data: 'seq,ts,id,action\r\n1,2026-11-18T12:00:00.000Z,aud_1,auth.login',
    rowCount: 4,
    chainValid: true,
  });

  client.audit.generateEvidencePack = async () => ({
    packId: 'evp_mock_1',
    orgId: 'org_1',
    workspaceId: 'ws_1',
    generatedAt: '2026-11-18T12:20:00.000Z',
    generatedBy: 'prn_1',
    chainVerification: { valid: true, checkedCount: 4 },
    agents: [{ id: 'agt_1', name: 'triage-agent', status: 'active', versionsCount: 1 }],
    policies: structuredClone(policyList),
    toolGrants: structuredClone(toolGrantList),
    agentIdentities: structuredClone(agentIdentityList),
    auditSample: [],
    digestSha256: 'a'.repeat(64),
  });

  const approvalList: ApprovalDto[] = [
    {
      id: 'apr_mock_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      runId: 'run_paused_1',
      stepId: 'stp_apr_1',
      type: 'tool_call',
      status: 'pending',
      payload: {
        title: 'Refund $45.00 USD to order O-9',
        summary: 'Agent proposes refunding duplicate payment on order O-9.',
        proposedAction: { tool: 'refund_order', args: { order_id: 'O-9', amount: 45 } },
        diff: { before: { refunded: 0 }, after: { refunded: 45 } },
        risk: 'high',
        amount: { value: 45, currency: 'USD' },
        evidence: [{ type: 'tool_result', stepId: 'stp_0', summary: 'Duplicate charge confirmed' }],
        confidence: 0.86,
        policyReason: 'pol-refund-threshold',
      },
      requestedFrom: [{ type: 'role', id: 'reviewer' }],
      requiredDecisions: 1,
      separationOfDuties: true,
      initiatedBy: 'prn_other_requester',
      delegatedTo: null,
      expiresAt: '2026-11-25T12:00:00.000Z',
      onTimeout: 'escalate',
      autoApproveOnTimeout: false,
      escalatedAt: null,
      snoozedUntil: null,
      infoRequestQuestion: null,
      infoRequestAnswer: null,
      allowedActions: ['approve', 'reject', 'approve_with_edit', 'request_info'],
      decisions: [],
      createdAt: '2026-11-18T12:00:00.000Z',
      decidedAt: null,
    },
  ];
  const notificationList: NotificationDto[] = [
    {
      id: 'ntf_mock_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      approvalId: 'apr_mock_1',
      channel: 'slack',
      recipient: 'role:reviewer',
      subject: '[Approval] Refund $45.00 USD to order O-9',
      body: 'Approve or reject in Slack.',
      actionLinks: { consoleUrl: 'http://localhost:5173/approvals/apr_mock_1' },
      status: 'sent',
      createdAt: '2026-11-18T12:00:01.000Z',
    },
  ];

  client.approvals.list = async (status) =>
    structuredClone(status ? approvalList.filter((a) => a.status === status) : approvalList);
  client.approvals.get = async (id) => {
    const found = approvalList.find((a) => a.id === id);
    if (!found) throw new Error('approval not found');
    return structuredClone(found);
  };
  client.approvals.decide = async (id, input) => {
    const idx = approvalList.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('approval not found');
    const rec = approvalList[idx]!;
    if (rec.payload.risk === 'high' && input.decision !== 'reject' && input.confirmKeyword !== 'APPROVE') {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'High-risk approval requires APPROVE.');
    }
    const nextStatus = input.decision === 'reject' ? 'rejected' : 'approved';
    const updated: ApprovalDto = {
      ...rec,
      status: nextStatus,
      decidedAt: '2026-11-18T12:10:00.000Z',
      payload:
        input.decision === 'approve_with_edit' && input.editedPayload
          ? {
            ...rec.payload,
            proposedAction: {
              ...rec.payload.proposedAction,
              args: { ...rec.payload.proposedAction.args, ...input.editedPayload },
            },
          }
          : rec.payload,
      decisions: [
        ...rec.decisions,
        {
          id: `dec_${rec.decisions.length + 1}`,
          approvalId: rec.id,
          orgId: rec.orgId,
          decidedBy: 'prn_1',
          decision: input.decision,
          reason: input.reason ?? null,
          editedPayload: input.editedPayload ?? null,
          channel: input.channel ?? 'console',
          createdAt: '2026-11-18T12:10:00.000Z',
        },
      ],
    };
    approvalList[idx] = updated;
    return structuredClone(updated);
  };
  client.approvals.requestInfo = async (id, question) => {
    const idx = approvalList.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('approval not found');
    const updated: ApprovalDto = {
      ...approvalList[idx]!,
      status: 'info_requested',
      infoRequestQuestion: question,
    };
    approvalList[idx] = updated;
    return structuredClone(updated);
  };
  client.approvals.delegate = async (id, delegateToPrincipalId) => {
    const idx = approvalList.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('approval not found');
    const updated: ApprovalDto = {
      ...approvalList[idx]!,
      delegatedTo: delegateToPrincipalId,
    };
    approvalList[idx] = updated;
    return structuredClone(updated);
  };
  client.approvals.snooze = async (id, snoozeUntilIso) => {
    const idx = approvalList.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('approval not found');
    const updated: ApprovalDto = {
      ...approvalList[idx]!,
      snoozedUntil: snoozeUntilIso,
    };
    approvalList[idx] = updated;
    return structuredClone(updated);
  };
  client.notifications.list = async () => structuredClone(notificationList);

  const datasetList: DatasetDto[] = [
    {
      id: 'ds_mock_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: 'Billing Regression Set',
      description: 'Refund & invoice test cases',
      tags: ['billing', 'regression'],
      metadata: {},
      createdAt: '2026-11-18T12:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    },
  ];
  const testCaseList: TestCaseDto[] = [
    {
      id: 'tc_mock_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      datasetId: 'ds_mock_1',
      name: 'Standard 14-day refund',
      inputs: { prompt: 'Request refund for order 123' },
      expectedOutput: { result: 'Refund approved' },
      rubric: { criteria: 'Accurate and safe response' },
      tags: ['billing'],
      difficulty: 'medium',
      weight: 1.0,
      sourceRunId: null,
      sourceStepId: null,
      createdAt: '2026-11-18T12:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    },
  ];
  const graderList: GraderDto[] = [
    {
      id: 'grd_mock_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: 'Exact Match Grader',
      description: 'Exact string match with trimming',
      type: 'exact_match',
      config: { trim: true },
      createdAt: '2026-11-18T12:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    },
  ];
  const expList: ExperimentDto[] = [
    {
      id: 'exp_mock_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: 'Candidate v1.0.1 Regression Check',
      datasetId: 'ds_mock_1',
      agentVersionId: 'agv_2',
      baselineVersionId: 'agv_1',
      graderIds: ['grd_mock_1'],
      status: 'completed',
      releaseGateConfig: { min_pass_rate: 0.95 },
      gateVerdict: 'passed',
      metrics: {
        total_cases: 1,
        passed_cases: 1,
        failed_cases: 0,
        pass_rate: 1.0,
        avg_score: 5.0,
        total_cost_micro_usd: 1200,
        avg_duration_ms: 35,
        regression_count: 0,
      },
      createdAt: '2026-11-18T12:00:00.000Z',
      startedAt: '2026-11-18T12:00:01.000Z',
      completedAt: '2026-11-18T12:00:02.000Z',
    },
  ];
  const expResults: ExperimentResultDto[] = [
    {
      id: 'res_mock_1',
      orgId: 'org_1',
      experimentId: 'exp_mock_1',
      testCaseId: 'tc_mock_1',
      runId: 'run_123',
      actualOutput: { result: 'Refund approved' },
      graderResults: [
        {
          grader_id: 'grd_mock_1',
          grader_name: 'Exact Match Grader',
          type: 'exact_match',
          passed: true,
          score: 1.0,
          rationale: 'Exact string match succeeded',
        },
      ],
      passed: true,
      score: 1.0,
      durationMs: 35,
      costMicroUsd: 1200,
      isRegression: false,
      diff: null,
      createdAt: '2026-11-18T12:00:02.000Z',
    },
  ];

  client.evaluations.datasets.list = async () => structuredClone(datasetList);
  client.evaluations.datasets.create = async (input) => {
    const ds: DatasetDto = {
      id: `ds_mock_${datasetList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    datasetList.push(ds);
    return structuredClone(ds);
  };
  client.evaluations.datasets.get = async (id) => {
    const found = datasetList.find((d) => d.id === id);
    if (!found) throw new Error('dataset not found');
    return structuredClone(found);
  };
  client.evaluations.datasets.listTestCases = async (dsId) =>
    structuredClone(testCaseList.filter((tc) => tc.datasetId === dsId));
  client.evaluations.datasets.createTestCase = async (dsId, input) => {
    const tc: TestCaseDto = {
      id: `tc_mock_${testCaseList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      datasetId: dsId,
      name: input.name,
      inputs: input.inputs,
      expectedOutput: input.expectedOutput ?? null,
      rubric: input.rubric ?? {},
      tags: input.tags ?? [],
      difficulty: input.difficulty ?? 'medium',
      weight: input.weight ?? 1.0,
      sourceRunId: input.sourceRunId ?? null,
      sourceStepId: input.sourceStepId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    testCaseList.push(tc);
    return structuredClone(tc);
  };

  client.evaluations.graders.list = async () => structuredClone(graderList);
  client.evaluations.graders.create = async (input) => {
    const grd: GraderDto = {
      id: `grd_mock_${graderList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      config: input.config ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    graderList.push(grd);
    return structuredClone(grd);
  };
  client.evaluations.experiments.list = async () => structuredClone(expList);
  client.evaluations.experiments.create = async (input) => {
    const exp: ExperimentDto = {
      id: `exp_mock_${expList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      datasetId: input.datasetId,
      agentVersionId: input.agentVersionId,
      baselineVersionId: input.baselineVersionId ?? null,
      graderIds: input.graderIds ?? [],
      status: 'pending',
      releaseGateConfig: input.releaseGateConfig ?? {},
      gateVerdict: null,
      metrics: {},
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    expList.push(exp);
    return structuredClone(exp);
  };
  client.evaluations.experiments.get = async (id) => {
    const found = expList.find((e) => e.id === id);
    if (!found) throw new Error('exp not found');
    return structuredClone(found);
  };
  client.evaluations.experiments.results = async (id) =>
    structuredClone(expResults.filter((r) => r.experimentId === id));
  client.evaluations.experiments.run = async (id) => {
    const idx = expList.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error('exp not found');
    const updated: ExperimentDto = {
      ...expList[idx]!,
      status: 'completed',
      gateVerdict: 'passed',
      metrics: {
        total_cases: 1,
        passed_cases: 1,
        failed_cases: 0,
        pass_rate: 1.0,
        avg_score: 5.0,
        total_cost_micro_usd: 1200,
        avg_duration_ms: 35,
        regression_count: 0,
      },
      completedAt: new Date().toISOString(),
    };
    expList[idx] = updated;
    return structuredClone(updated);
  };
  client.evaluations.saveRunAsTestCase = async (runId, input) => {
    const tc: TestCaseDto = {
      id: `tc_from_run_${runId}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      datasetId: input.datasetId,
      name: input.name,
      inputs: { prompt: 'Extracted run input' },
      expectedOutput: input.expectedOutput ?? null,
      rubric: input.rubric ?? {},
      tags: [...(input.tags ?? []), 'captured_from_run'],
      difficulty: input.difficulty ?? 'medium',
      weight: input.weight ?? 1.0,
      sourceRunId: runId,
      sourceStepId: input.stepId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    testCaseList.push(tc);
    return structuredClone(tc);
  };

  const initialTeamsList: TeamDto[] = [
    {
      id: 'team_benchmark_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: 'Customer Support Swarm',
      description: 'Supervisor orchestrating triage, identity verification, and billing specialists.',
      pattern: 'supervisor_specialists',
      supervisorAgentId: 'agent_supervisor',
      members: [
        {
          id: 'mem_sup_1',
          teamId: 'team_benchmark_1',
          agentId: 'agent_supervisor',
          role: 'supervisor',
          readKeys: ['*'],
          writeKeys: ['*'],
          maxSteps: 25,
          timeoutSeconds: 60,
          maxSpendMicroUsd: 1_000_000,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'mem_spec_1',
          teamId: 'team_benchmark_1',
          agentId: 'agent_triage',
          role: 'specialist',
          readKeys: ['ticket_id', 'customer_id'],
          writeKeys: ['triage_assessment', 'priority'],
          maxSteps: 10,
          timeoutSeconds: 30,
          maxSpendMicroUsd: 100_000,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'mem_spec_2',
          teamId: 'team_benchmark_1',
          agentId: 'agent_auth',
          role: 'specialist',
          readKeys: ['customer_id', 'triage_assessment'],
          writeKeys: ['auth_verified', 'risk_score'],
          maxSteps: 10,
          timeoutSeconds: 30,
          maxSpendMicroUsd: 100_000,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'mem_spec_3',
          teamId: 'team_benchmark_1',
          agentId: 'agent_billing',
          role: 'specialist',
          readKeys: ['customer_id', 'auth_verified', 'triage_assessment'],
          writeKeys: ['refund_issued_micro_usd', 'resolution_summary'],
          maxSteps: 10,
          timeoutSeconds: 30,
          maxSpendMicroUsd: 200_000,
          createdAt: new Date().toISOString(),
        },
      ],
      handoffs: [
        {
          id: 'hnd_1',
          teamId: 'team_benchmark_1',
          fromAgentId: 'agent_supervisor',
          toAgentId: 'agent_triage',
          name: 'Triage Handoff Contract',
          description: 'Severity analysis and customer categorization',
          handoffSchema: {
            goal: 'Analyze support ticket severity, categorize issue, and extract customer identity',
            context_summary: 'Customer submitted an enterprise billing dispute ticket',
            artifacts: ['raw_ticket_text'],
            constraints: ['response_must_be_structured_json', 'p0_triage_under_5_seconds'],
          },
          returnSchema: {
            type: 'object',
            required: ['triage_assessment', 'priority'],
            properties: {
              triage_assessment: { type: 'string' },
              priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
            },
          },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'hnd_2',
          teamId: 'team_benchmark_1',
          fromAgentId: 'agent_supervisor',
          toAgentId: 'agent_auth',
          name: 'Auth Handoff Contract',
          description: 'Account ownership and permission validation',
          handoffSchema: {
            goal: 'Verify account ownership and validate API key permissions',
            context_summary: 'Customer claims enterprise plan ownership',
            artifacts: ['customer_id', 'triage_assessment'],
            constraints: ['mfa_or_active_session_required'],
          },
          returnSchema: {
            type: 'object',
            required: ['auth_verified', 'risk_score'],
            properties: {
              auth_verified: { type: 'boolean' },
              risk_score: { type: 'number' },
            },
          },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'hnd_3',
          teamId: 'team_benchmark_1',
          fromAgentId: 'agent_supervisor',
          toAgentId: 'agent_billing',
          name: 'Billing Handoff Contract',
          description: 'Ledger inspection and refund adjustments',
          handoffSchema: {
            goal: 'Inspect billing ledgers, verify plan pricing, and compute refund adjustments',
            context_summary: 'Identity verified and issue classified as billing discrepancy',
            artifacts: ['customer_id', 'auth_verified'],
            constraints: ['max_instant_refund_usd_500'],
          },
          returnSchema: {
            type: 'object',
            required: ['refund_issued_micro_usd', 'resolution_summary'],
            properties: {
              refund_issued_micro_usd: { type: 'number' },
              resolution_summary: { type: 'string' },
            },
          },
          createdAt: new Date().toISOString(),
        },
      ],
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const teamsList: TeamDto[] = [...initialTeamsList];

  client.teams.list = async () => structuredClone(teamsList);
  client.teams.get = async (id: string) => {
    const t = teamsList.find((item) => item.id === id);
    if (!t) throw new PlatformError('RES_NOT_FOUND', `Team not found: ${id}`);
    return structuredClone(t);
  };
  client.teams.create = async (input) => {
    const newTeam: TeamDto = {
      id: `team_${Date.now()}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      description: input.description ?? null,
      pattern: input.pattern ?? 'supervisor_specialists',
      supervisorAgentId: input.supervisorAgentId ?? null,
      members:
        input.members?.map((m, idx) => ({
          id: `mem_${idx}`,
          teamId: `team_${Date.now()}`,
          agentId: m.agentId,
          role: m.role,
          readKeys: m.readKeys ?? [],
          writeKeys: m.writeKeys ?? [],
          maxSteps: m.maxSteps ?? 10,
          timeoutSeconds: m.timeoutSeconds ?? 60,
          maxSpendMicroUsd: m.maxSpendMicroUsd ?? 5_000_000,
          createdAt: new Date().toISOString(),
        })) ?? [],
      handoffs:
        input.handoffs?.map((h, idx) => ({
          id: `hnd_${idx}`,
          teamId: `team_${Date.now()}`,
          fromAgentId: h.fromAgentId,
          toAgentId: h.toAgentId,
          name: h.name,
          description: h.description ?? null,
          handoffSchema: h.handoffSchema ?? {},
          returnSchema: h.returnSchema ?? {},
          createdAt: new Date().toISOString(),
        })) ?? [],
      config: input.config ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    teamsList.unshift(newTeam);
    return structuredClone(newTeam);
  };
  client.teams.update = async (id, input) => {
    const idx = teamsList.findIndex((item) => item.id === id);
    if (idx === -1) throw new PlatformError('RES_NOT_FOUND', `Team not found: ${id}`);
    const existing = teamsList[idx]!;
    const updated: TeamDto = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      pattern: input.pattern ?? existing.pattern,
      updatedAt: new Date().toISOString(),
    };
    teamsList[idx] = updated;
    return structuredClone(updated);
  };
  client.teams.simulate = async (_id, _input) => {
    const sim: TeamSimulationDto = {
      rootRunId: 'run_sim_team_1',
      finalOutput: { status: 'refund_approved', amount_usd: 150 },
      blackboard: {
        id: 'bb_1',
        orgId: 'org_1',
        workspaceId: 'ws_1',
        runId: 'run_sim_team_1',
        version: 3,
        state: {
          ticket_id: 'tkt_882194',
          customer_id: 'cust_enterprise_4091',
          triage_assessment: 'Valid invoice overcharge',
          priority: 'P1',
          auth_verified: true,
          risk_score: 0.12,
          refund_issued_micro_usd: 150_000_000,
          resolution_summary: 'Approved and credited $150.00',
        },
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      messages: [
        {
          id: 'msg_1',
          orgId: 'org_1',
          workspaceId: 'ws_1',
          runId: 'run_sim_team_1',
          senderAgentId: 'agent_supervisor',
          receiverAgentId: 'agent_triage',
          purpose: 'delegation_request',
          payload: { goal: 'Analyze support ticket severity' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg_2',
          orgId: 'org_1',
          workspaceId: 'ws_1',
          runId: 'run_sim_team_1',
          senderAgentId: 'agent_triage',
          receiverAgentId: 'agent_supervisor',
          purpose: 'delegation_response',
          payload: { priority: 'P1' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg_3',
          orgId: 'org_1',
          workspaceId: 'ws_1',
          runId: 'run_sim_team_1',
          senderAgentId: 'agent_supervisor',
          receiverAgentId: 'agent_billing',
          purpose: 'delegation_request',
          payload: { goal: 'Process adjustment' },
          createdAt: new Date().toISOString(),
        },
      ],
      childRuns: [
        {
          childRunId: 'crun_triage_1',
          parentRunId: 'run_sim_team_1',
          agentId: 'agent_triage',
          role: 'specialist',
          status: 'succeeded',
          tokensIn: 320,
          tokensOut: 110,
          costMicroUsd: 430,
          durationMs: 45,
        },
        {
          childRunId: 'crun_auth_1',
          parentRunId: 'run_sim_team_1',
          agentId: 'agent_auth',
          role: 'specialist',
          status: 'succeeded',
          tokensIn: 280,
          tokensOut: 90,
          costMicroUsd: 370,
          durationMs: 38,
        },
        {
          childRunId: 'crun_billing_1',
          parentRunId: 'run_sim_team_1',
          agentId: 'agent_billing',
          role: 'specialist',
          status: 'succeeded',
          tokensIn: 410,
          tokensOut: 180,
          costMicroUsd: 590,
          durationMs: 62,
        },
      ],
      totalTokensIn: 1010,
      totalTokensOut: 380,
      totalCostMicroUsd: 1390,
      durationMs: 145,
    };
    return structuredClone(sim);
  };

  const customToolsList: CustomToolDto[] = [];
  const mcpServersList: McpServerDto[] = [];
  const mcpToolsList: McpServerToolDto[] = [];

  client.tools.listCustom = async () => structuredClone(customToolsList);
  client.tools.createCustom = async (input) => {
    const ct: CustomToolDto = {
      id: `tool_custom_${customToolsList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      version: input.version ?? '1.0.0',
      description: input.description,
      sideEffectClass: input.sideEffectClass ?? 'read',
      implementation: input.implementation ?? 'http',
      inputSchema: input.inputSchema ?? { type: 'object' },
      outputSchema: input.outputSchema ?? { type: 'object' },
      config: input.config ?? {},
      tags: input.tags ?? [],
      owner: 'prn_1',
      status: 'active',
      untrustedSource: input.untrustedSource ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    customToolsList.push(ct);
    return structuredClone(ct);
  };
  client.tools.importOpenApi = async () => {
    const imported: CustomToolDto = {
      id: `tool_openapi_${customToolsList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: 'get_invoice',
      version: '1.0.0',
      description: 'Retrieve an invoice by ID',
      sideEffectClass: 'read',
      implementation: 'http',
      inputSchema: { type: 'object', properties: { invoice_id: { type: 'string' } } },
      outputSchema: { type: 'object' },
      config: {},
      tags: ['openapi'],
      owner: 'prn_1',
      status: 'active',
      untrustedSource: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    customToolsList.push(imported);
    return {
      specTitle: 'Billing Service API',
      specVersion: '1.0.0',
      baseUrl: 'https://billing.example.com/v1',
      importedTools: [structuredClone(imported)],
    };
  };
  client.tools.test = async (name, input) => {
    const rawStr = typeof input.simulatedRawResult === 'string' ? input.simulatedRawResult : '';
    const inj = /ignore\s+(all\s+)?previous\s+instructions/i.test(rawStr);
    return {
      toolName: name,
      dryRun: input.dryRun ?? true,
      validArgs: true,
      rawResult: input.simulatedRawResult ?? { dry_run: true, tool: name },
      sanitizedText: rawStr || JSON.stringify({ dry_run: true }),
      wrappedObservation: `<tool_result id="test_1" tool="${name}" provenance="untrusted_external" injection_suspected="${String(inj)}">\n${inj ? '[SECURITY NOTICE: Untrusted content contains suspected prompt injection.]\n' : ''}${rawStr || 'dry_run ok'}\n</tool_result>`,
      untrustedSource: true,
      injectionSuspected: inj,
    };
  };

  client.mcp.listServers = async () => structuredClone(mcpServersList);
  client.mcp.createServer = async (input) => {
    const srv: McpServerDto = {
      id: `mcps_${mcpServersList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      transport: input.transport,
      endpoint: input.endpoint,
      status: 'connected',
      metadata: {},
      lastHealthCheckAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mcpServersList.push(srv);
    const tool: McpServerToolDto = {
      id: `mcpt_${mcpToolsList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      mcpServerId: srv.id,
      name: 'github_list_issues',
      description: 'List GitHub repository issues',
      inputSchema: { type: 'object' },
      sideEffectClass: 'read',
      approvalStatus: 'pending_approval',
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mcpToolsList.push(tool);
    return { server: structuredClone(srv), discoveredTools: [structuredClone(tool)] };
  };
  client.mcp.listServerTools = async (serverId) =>
    structuredClone(mcpToolsList.filter((t) => t.mcpServerId === serverId));
  client.mcp.updateToolApproval = async (toolId, status) => {
    const idx = mcpToolsList.findIndex((t) => t.id === toolId);
    if (idx < 0) throw new PlatformError('RES_NOT_FOUND', 'MCP tool not found');
    const updated: McpServerToolDto = {
      ...mcpToolsList[idx]!,
      approvalStatus: status,
      approvedBy: status === 'approved' ? 'prn_1' : null,
      approvedAt: status === 'approved' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    mcpToolsList[idx] = updated;
    return structuredClone(updated);
  };

  const connectorsCatalog: ConnectorManifestDto[] = [
    {
      id: 'slack',
      name: 'Slack',
      version: '1.0.0',
      category: 'communication',
      description: 'Post interactive approval messages and read channels.',
      authTypes: ['oauth2', 'api_key'],
      scopes: ['channels:read', 'chat:write'],
      egressDomains: ['api.slack.com'],
      actions: [
        {
          name: 'chat.postMessage',
          description: 'Post a message to Slack',
          sideEffectClass: 'write',
          idempotent: true,
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          rateLimitPerMinute: 60,
          pagination: 'none',
        },
      ],
      triggers: [
        {
          name: 'message.posted',
          type: 'webhook',
          description: 'Slack message event',
          verifyHeader: 'X-Slack-Signature',
        },
      ],
    },
    {
      id: 'stripe',
      name: 'Stripe',
      version: '1.0.0',
      category: 'payments',
      description: 'Inspect invoices and issue refunds via Stripe.',
      authTypes: ['api_key'],
      scopes: ['charges:read', 'refunds:write'],
      egressDomains: ['api.stripe.com'],
      actions: [
        {
          name: 'invoices.retrieve',
          description: 'Retrieve a Stripe invoice',
          sideEffectClass: 'read',
          idempotent: true,
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          rateLimitPerMinute: 120,
          pagination: 'cursor',
        },
      ],
      triggers: [],
    },
  ];
  const connectionsList: ConnectionDto[] = [];

  client.connectors.list = async () => structuredClone(connectorsCatalog);
  client.connectors.get = async (id) => structuredClone(connectorsCatalog.find((c) => c.id === id)!);
  client.connectors.runContractTest = async (id) => ({
    connectorId: id,
    passed: true,
    totalFixtures: 2,
    passedFixtures: 2,
    details: [
      { fixtureName: `${id}_read_fixture`, action: 'read', passed: true, errors: [] },
      { fixtureName: `${id}_write_fixture`, action: 'write', passed: true, errors: [] },
    ],
  });

  client.connections.list = async () => structuredClone(connectionsList);
  client.connections.create = async (input) => {
    const conn: ConnectionDto = {
      id: `conn_${connectionsList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      connectorId: input.connectorId,
      name: input.name,
      authType: input.authType,
      sharingMode: input.sharingMode ?? 'shared',
      ownerId: 'prn_1',
      environmentMapping: input.environmentMapping ?? { dev: 'conn_1' },
      secretVersion: 1,
      secretMasked: 'Stored (v1, updated by prn_1 on 2026-11-19)',
      scopes: input.scopes ?? ['chat:write'],
      allowedAgents: input.allowedAgents ?? ['*'],
      egressDomains: input.egressDomains ?? ['api.slack.com'],
      status: 'healthy',
      lastTestedAt: null,
      lastError: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    connectionsList.push(conn);
    return structuredClone(conn);
  };
  client.connections.test = async (id) => {
    const idx = connectionsList.findIndex((c) => c.id === id);
    const updated = { ...connectionsList[idx]!, lastTestedAt: new Date().toISOString() };
    connectionsList[idx] = updated;
    return {
      connection: structuredClone(updated),
      healthy: true,
      scopesGranted: updated.scopes,
      latencyMs: 14,
    };
  };
  client.connections.rotateSecret = async (id) => {
    const idx = connectionsList.findIndex((c) => c.id === id);
    const existing = connectionsList[idx]!;
    const updated = {
      ...existing,
      secretVersion: existing.secretVersion + 1,
      secretMasked: `Stored (v${existing.secretVersion + 1}, updated by prn_1 on 2026-11-19)`,
    };
    connectionsList[idx] = updated;
    return structuredClone(updated);
  };

  const deploymentsList: DeploymentDto[] = [
    {
      id: 'dep_prod_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      environment: 'prod',
      subjectType: 'agent',
      subjectId: 'agt_1',
      versionId: 'agv_1',
      previousVersionId: 'agv_0',
      channel: 'stable',
      trafficPct: 100,
      status: 'active',
      deployedBy: 'prn_1',
      deployedAt: new Date().toISOString(),
    },
  ];
  const promotionsList: PromotionDto[] = [];

  client.deployments.list = async () => structuredClone(deploymentsList);
  client.deployments.rollback = async (id) => {
    const idx = deploymentsList.findIndex((d) => d.id === id);
    const existing = deploymentsList[idx]!;
    const restored: DeploymentDto = {
      ...existing,
      versionId: existing.previousVersionId ?? 'agv_0',
      previousVersionId: existing.versionId,
      status: 'rolled_back',
      trafficPct: 100,
    };
    deploymentsList[idx] = restored;
    return structuredClone(restored);
  };

  client.promotions.list = async () => structuredClone(promotionsList);
  client.promotions.create = async (input) => {
    const missing = (input.requiredCredentials ?? []).filter(
      (k) => !input.credentialMapping?.[k],
    );
    if (missing.length > 0) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Unmapped credential(s) in target environment "${input.toEnv}": ${missing.join(', ')}`,
      );
    }
    const promo: PromotionDto = {
      id: `prm_${promotionsList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      versionId: input.versionId,
      fromEnv: input.fromEnv,
      toEnv: input.toEnv,
      status: input.toEnv === 'prod' ? 'pending_approval' : 'deployed',
      evalGatePassed: input.evalGatePassed ?? true,
      evalScore: input.evalScore ?? 0.95,
      diffSummary: { previous_version_id: 'agv_1', new_version_id: input.versionId },
      credentialMapping: input.credentialMapping ?? {},
      canaryPct: input.canaryPct ?? 100,
      initiatedBy: 'prn_1',
      approvedBy: null,
      deploymentId: null,
      deployedAt: null,
      rolledBackAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    promotionsList.unshift(promo);
    return { promotion: structuredClone(promo), deployment: null };
  };

  // --- S1.8 Observability v1 ---
  const alertRulesList: Array<{
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
  }> = [];
  const alertIncidentsList: Array<{
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
  }> = [];

  client.observability.overview = async (windowHours = 24) => ({
    windowHours,
    totalRuns: 10,
    succeededRuns: 8,
    failedRuns: 2,
    successRate: 0.8,
    failureRate: 0.2,
    p50DurationMs: 420,
    p95DurationMs: 1100,
    p99DurationMs: 1500,
    totalCostUsd: 0.042,
    costPerRunUsd: 0.0042,
    costPerSuccessfulOutcomeUsd: 0.00525,
    tokensIn: 4500,
    tokensOut: 1200,
    queueDepth: 1,
    approvalPendingCount: 0,
    failureByClass: [{ failureClass: 'tool_error', count: 2 }],
    costByAgent: [{ agentId: 'agent:agv_1', runs: 10, costUsd: 0.042, tokensIn: 4500, tokensOut: 1200 }],
    costByModel: [{ model: 'openai:gpt-4o-mini', calls: 10, costUsd: 0.042, tokensIn: 4500, tokensOut: 1200 }],
    dailySeries: [{ bucket: '2026-11-19', runs: 10, failed: 2, costUsd: 0.042 }],
  });
  client.observability.explainFailure = async (runId) => ({
    runId,
    status: 'failed',
    failureClass: 'tool_error',
    rootCause: 'Step #1 (tool_call) failed: upstream HTTP 502',
    failingStepSeq: 1,
    failingStepType: 'tool_call',
    remediation: ['Inspect step inputs/outputs in the run trace and verify downstream connector credentials.'],
  });
  client.observability.exportOtel = async () => ({
    resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [] }],
  });
  client.alerts.listRules = async () => structuredClone(alertRulesList);
  client.alerts.createRule = async (input) => {
    const r = {
      id: `ar_${alertRulesList.length + 1}`,
      orgId: 'org_1',
      workspaceId: 'ws_1',
      name: input.name,
      metric: input.metric,
      operator: input.operator ?? ('gt' as const),
      threshold: input.threshold,
      windowMinutes: input.windowMinutes ?? 60,
      channels: input.channels ?? ['in_app'],
      enabled: input.enabled ?? true,
      lastFiredAt: null,
      createdBy: 'prn_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    alertRulesList.unshift(r);
    return structuredClone(r);
  };
  client.alerts.deleteRule = async (id) => {
    const idx = alertRulesList.findIndex((r) => r.id === id);
    if (idx >= 0) alertRulesList.splice(idx, 1);
  };
  client.alerts.evaluate = async () => {
    const fired = alertRulesList.map((r) => {
      const inc = {
        id: `inc_${alertIncidentsList.length + 1}`,
        orgId: 'org_1',
        workspaceId: 'ws_1',
        ruleId: r.id,
        metric: r.metric,
        observedValue: 0.2,
        threshold: r.threshold,
        status: 'firing' as const,
        summary: `Alert "${r.name}" fired: ${r.metric}=0.200 ${r.operator} ${r.threshold}`,
        firedAt: new Date().toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      };
      alertIncidentsList.unshift(inc);
      return inc;
    });
    return { evaluatedCount: alertRulesList.length, firedIncidents: structuredClone(fired) };
  };
  client.alerts.listIncidents = async () => structuredClone(alertIncidentsList);
  client.alerts.acknowledgeIncident = async (id) => {
    const inc = alertIncidentsList.find((i) => i.id === id)!;
    inc.status = 'acknowledged';
    inc.acknowledgedAt = new Date().toISOString();
    return structuredClone(inc);
  };
  client.alerts.resolveIncident = async (id) => {
    const inc = alertIncidentsList.find((i) => i.id === id)!;
    inc.status = 'resolved';
    inc.resolvedAt = new Date().toISOString();
    return structuredClone(inc);
  };

  // --- S1.9 Pilot Agents ---
  const pilotsList = [
    {
      id: 'support_triage_v1' as const,
      name: 'Support Triage & Reply Drafter (L1)',
      autonomyLevel: 'L1' as const,
      trigger: 'Webhook from helpdesk',
      tools: [{ name: 'kb.search', mode: 'read' as const, approval: 'auto' as const }],
      limits: { maxSteps: 12, maxTokens: 60000, maxDurationSec: 90, maxCostUsd: 0.15 },
      targets: { category_accuracy: '>= 92%' },
      checklist: [{ id: 'signoff', label: 'Stakeholder sign-off recorded in audit log', done: false }],
      signedOffBy: null as string | null,
      signedOffAt: null as string | null,
      signOffNotes: null as string | null,
    },
    {
      id: 'invoice_exception_v1' as const,
      name: 'Invoice Exception Handler (L2)',
      autonomyLevel: 'L2' as const,
      trigger: 'Queue message when ERP three-way match fails',
      tools: [{ name: 'erp.get_invoice', mode: 'read' as const, approval: 'auto' as const }],
      limits: { maxSteps: 20, maxTokens: 120000, maxDurationSec: 300, maxCostUsd: 0.6 },
      targets: { resolution_accuracy: '>= 90%' },
      checklist: [{ id: 'signoff', label: 'Stakeholder sign-off recorded in audit log', done: false }],
      signedOffBy: null as string | null,
      signedOffAt: null as string | null,
      signOffNotes: null as string | null,
    },
  ];

  client.pilots.list = async () => structuredClone(pilotsList);
  client.pilots.runBenchmarks = async () => ({
    supportTriage: {
      totalCases: 5,
      categoryAccuracy: 1,
      draftAcceptanceRate: 0.85,
      escalationPrecision: 1,
      avgCostUsd: 0.018,
      injectionBlockRate: 1,
      passed: true,
    },
    invoiceException: {
      totalCases: 5,
      resolutionAccuracy: 1,
      falseAutoResolveRate: 0,
      avgCostUsd: 0.07,
      passed: true,
    },
    allPassed: true,
  });
  client.pilots.runSupportTriage = async (input) => ({
    ticketId: input.ticketId,
    category: 'billing',
    priority: 'medium',
    sentiment: 'neutral',
    summary: 'Classified ticket as billing.',
    draftReply: 'Reviewing your billing inquiry.',
    citations: ['kb://billing/invoice-and-refund-policy#sec-2'],
    confidence: 0.94,
    escalate: false,
    escalationReason: null,
    piiRedacted: true,
    injectionBlocked: false,
    costUsd: 0.018,
    latencyMs: 420,
  });
  client.pilots.runInvoiceException = async (input) => ({
    invoiceId: input.invoiceId,
    resolution: 'auto_resolve_tolerance',
    varianceUsd: 7,
    variancePct: 0.7,
    requiresApproval: false,
    dualApproval: false,
    sodBlocked: false,
    confidence: 0.96,
    rationale: 'Within L2 tolerance (<1% and <$50 USD).',
    costUsd: 0.04,
    latencyMs: 490,
  });
  client.pilots.signOff = async (id, notes) => {
    const p = pilotsList.find((x) => x.id === id)!;
    p.signedOffBy = 'prn_1';
    p.signedOffAt = new Date().toISOString();
    p.signOffNotes = notes ?? 'Approved';
    p.checklist[0]!.done = true;
    return structuredClone(p);
  };

  return client;
}

describe('@elshad/console shell, env safety, API keys, and accessibility [E0.1-7, NFR-15]', () => {
  it('logs in, switches workspace & environment in URL, activates PROD safety banner, and manages API keys', async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const { container } = render(<ConsoleApp client={client} initialPath="/" />);

    // Login screen loads
    const pwInput = await screen.findByLabelText('Password');
    await user.type(pwInput, 'ChangeMe123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Home dashboard appears (Screen 01: Workspace overview)
    expect(await screen.findByRole('heading', { name: 'Workspace overview' })).toBeTruthy();
    expect(screen.getByText('elshad.ai')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Runs Today' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Success Rate' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Escalation Rate' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Spend vs Budget' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'P95 Duration' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Run Volume Trend' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Recent Runs' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Top Agents by Volume' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Cost Trend' })).toBeTruthy();

    // Switch environment to PROD -> URL updates and safety banner renders
    const envSelect = screen.getByLabelText('Environment');
    await user.selectOptions(envSelect, 'prod');
    await waitFor(() => {
      expect(window.location.pathname).toBe('/w/default/e/prod/home');
    });
    expect(screen.getByRole('region', { name: 'Production safety notice' })).toBeTruthy();

    // Switch workspace -> URL updates
    const wsSelect = screen.getByLabelText('Workspace');
    await user.selectOptions(wsSelect, 'finance');
    await waitFor(() => {
      expect(window.location.pathname).toBe('/w/finance/e/prod/home');
    });

    // Open command palette with Ctrl+K and navigate to Settings
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go to Settings' }));

    expect(await screen.findByRole('heading', { name: 'API Keys' })).toBeTruthy();

    // Create API key and observe one-time secret
    const keyInput = screen.getByLabelText('API Key Name');
    await user.type(keyInput, 'Deploy Key');
    await user.click(screen.getByRole('button', { name: 'Create API Key' }));

    expect(await screen.findByText('key_abc12345_super_secret_once')).toBeTruthy();

    // Revoke key
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Revoked')).toBeTruthy();

    // Accessibility check in light theme
    const axeLight = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeLight.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 15_000);

  it('passes axe accessibility checks in dark theme on login and authenticated shell [NFR-15]', async () => {
    const clientUnauth = createMockClient({ authenticatedInitially: false });
    const { container: loginContainer } = render(
      <ConsoleApp client={clientUnauth} initialTheme="dark" />,
    );
    await screen.findByRole('heading', { name: 'Sign in to elshad.ai' });
    const axeLogin = await axe.run(loginContainer, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeLogin.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
    cleanup();

    const clientAuth = createMockClient({ authenticatedInitially: true });
    const { container: shellContainer } = render(
      <ConsoleApp client={clientAuth} initialTheme="dark" initialPath="/w/default/e/dev/governance" />,
    );
    await screen.findByRole('heading', { name: 'Immutable Audit Log' });
    const axeShell = await axe.run(shellContainer, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeShell.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 15_000);

  it('runs a durable run, inspects trace step in drawer, and re-drives a DLQ item [E0.2-7]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    render(<ConsoleApp client={client} initialPath="/w/default/e/dev/runs" />);

    expect(await screen.findByRole('heading', { name: 'Runs & Traces' })).toBeTruthy();

    // Start Durable Run
    await user.click(screen.getAllByRole('button', { name: 'Start Durable Run' })[0]!);
    expect(await screen.findByRole('heading', { name: /Run Trace: run_1/ })).toBeTruthy();

    // Click first trace step to inspect in Right Inspector Drawer
    const stepRow = await screen.findByRole('treeitem', { name: /#1 · decision/ });
    await user.click(stepRow);
    expect(await screen.findByText(/Idempotency: idem_hash_1/)).toBeTruthy();

    // Switch to DLQ tab and re-drive failed run
    await user.click(screen.getByRole('button', { name: /DLQ \(1\)/ }));
    expect(await screen.findByText('run_failed_1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Re-drive' }));
    expect(await screen.findByText('Dead-letter queue is empty')).toBeTruthy();
  }, 15_000);

  it('virtualizes a 5,000-span trace under 1 second and passes axe checks [E0.2-7]', async () => {
    const user = userEvent.setup();
    const fiveThousandSteps: RunStepDto[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `stp_${i + 1}`,
      runId: 'run_big',
      seq: i + 1,
      type: i % 2 === 0 ? 'decision' : 'tool_call',
      status: 'succeeded',
      attempt: 1,
      idempotencyKey: `idem_${i + 1}`,
      summary: { idx: i + 1 },
      tokensIn: 10,
      tokensOut: 5,
      costMicroUsd: 2,
      latencyMs: 3,
      startedAt: '2026-11-18T12:00:00.000Z',
      endedAt: '2026-11-18T12:00:00.003Z',
    }));

    const client = createMockClient({
      authenticatedInitially: true,
      initialStepsByRun: { run_big: fiveThousandSteps },
    });
    const bigRun: RunDto = {
      id: 'run_big',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      environmentId: 'env_1',
      rootRunId: 'run_big',
      parentRunId: null,
      subjectType: 'agent_version',
      subjectVersionId: 'agv_1',
      status: 'succeeded',
      failureClass: null,
      terminationReason: 'final_answer',
      initiatorId: 'prn_1',
      input: {},
      output: {},
      usage: { steps: 5000, tokensIn: 50_000, tokensOut: 25_000, toolCalls: 2500 },
      costMicroUsd: 10_000,
      labels: {},
      lastEventSeq: 10_002,
      createdAt: '2026-11-18T12:00:00.000Z',
      startedAt: '2026-11-18T12:00:00.000Z',
      endedAt: '2026-11-18T12:00:15.000Z',
    };
    client.runs.list = async () => [bigRun];
    client.runs.get = async () => bigRun;

    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/runs" />,
    );
    const inspectBtn = await screen.findByRole('button', { name: 'Inspect Trace' });

    const t0 = performance.now();
    await user.click(inspectBtn);
    await screen.findByText(/5000 total spans/);
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(1000);
    const renderedTreeItems = screen.getAllByRole('treeitem');
    expect(renderedTreeItems.length).toBeLessThan(50);

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 15_000);

  it('creates an agent in Studio, triggers Lethal Trifecta warning, runs Test Playground & passes axe [E0.3-8]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/agents" />,
    );

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Total Agents' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Active Agents' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Draft Agents' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All agents/i })).toBeTruthy();
    expect(screen.getByLabelText('Search agents')).toBeTruthy();

    // Open Create Agent dialog and submit
    const createBtns = screen.getAllByRole('button', { name: '+ Create agent' });
    await user.click(createBtns[0]!);

    const nameInput = await screen.findByLabelText('Agent Name (kebab-case)');
    await user.clear(nameInput);
    await user.type(nameInput, 'ops-triage-agent');
    await user.click(screen.getByRole('button', { name: 'Create Agent Draft' }));

    expect(await screen.findByRole('heading', { name: 'ops-triage-agent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agent Studio' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Safety Configuration' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Configure sections' })).toBeTruthy();
    expect(screen.getByText(/Live logs \/ Test output \/ Run console/i)).toBeTruthy();

    // Switch to Tools tab and enable confidential_kb_read + web_fetch + http_request
    await user.click(screen.getByRole('tab', { name: 'Tools' }));
    await user.click(screen.getByLabelText('Enable tool confidential_kb_read'));
    await user.click(screen.getByLabelText('Enable tool web_fetch'));
    await user.click(screen.getByLabelText('Enable tool http_request'));
    const alertBanner = await screen.findByRole('alert');
    expect(alertBanner.textContent).toContain('Lethal Trifecta Warning');

    // Publish version & run in Test Playground
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Published v1\.0\.0/)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Test' }));
    await user.click(screen.getByRole('button', { name: 'Run Test' }));

    const costMatches = await screen.findAllByText(/275 micro-USD/);
    expect(costMatches.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/Execution Trace \(2 steps · 1 ledger rows\)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save as test case' }));
    expect(await screen.findByText(/Saved eval test cases: 1/)).toBeTruthy();

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 15_000);

  it('builds workflow in Canvas, inspects lossless YAML, pins output for Test-from-Here, loads 300-node benchmark < 1s & passes axe [E0.4-6, E0.4-7]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/workflows" />,
    );

    expect(await screen.findByRole('heading', { name: 'Workflow Canvas' })).toBeTruthy();

    // Create starter workflow
    const newWorkflowButtons = screen.getAllByRole('button', { name: /\+ New Workflow/i });
    await user.click(newWorkflowButtons[0]!);
    await user.click(await screen.findByRole('button', { name: 'Create Workflow' }));
    expect(await screen.findByText(/Created starter workflow "inbound-triage-workflow"/)).toBeTruthy();

    // Starter nodes rendered on canvas
    const initialNodes = screen.getAllByTestId('canvas-node');
    expect(initialNodes.length).toBe(4);

    // Open View as YAML modal and verify lossless yaml_source
    await user.click(screen.getByRole('button', { name: 'View as YAML' }));
    const yamlArea = (await screen.findByLabelText('yaml_source')) as HTMLTextAreaElement;
    expect(yamlArea.value).toContain('schema_version: 1');
    expect(yamlArea.value).toContain('Inbound Webhook');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    // Select Agent Triage node, pin output, and Test from Selected Node
    await user.click(screen.getByRole('button', { name: /Agent Triage/i }));
    const pinCheckbox = screen.getByLabelText(/Pin Output Data/i) as HTMLInputElement;
    await user.click(pinCheckbox);
    expect(pinCheckbox.checked).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Test from Selected Node' }));
    expect(
      await screen.findByText(/Triggered test run run_wf_from_node from node "Agent Triage"/),
    ).toBeTruthy();

    // Publish & activate webhook trigger
    await user.click(screen.getByRole('button', { name: /Publish & Activate/i }));
    expect(await screen.findByText(/\/api\/v1\/hooks\/hook-s04-triage/)).toBeTruthy();

    // Load 300-node benchmark and assert < 1000ms render + viewport culling (< 60 nodes in DOM)
    const t0 = performance.now();
    await user.click(screen.getByRole('button', { name: 'Load 300-Node Benchmark' }));
    expect(await screen.findByText(/Loaded 300-node benchmark graph/)).toBeTruthy();
    const benchElapsed = performance.now() - t0;
    expect(benchElapsed).toBeLessThan(1000);

    const culledNodes = screen.getAllByTestId('canvas-node');
    expect(culledNodes.length).toBeGreaterThan(0);
    expect(culledNodes.length).toBeLessThan(60);

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('creates KB, ingests & re-syncs doc, renders clickable citation chips, explores memory & erases subject cleanly [E0.5-1..4]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/knowledge" />,
    );

    expect(await screen.findByRole('heading', { name: /Knowledge & Memory/i })).toBeTruthy();

    // Create Knowledge Base
    const createKbBtns = screen.getAllByRole('button', { name: /\+ New Knowledge Base/i });
    await user.click(createKbBtns[0]!);
    await user.click(await screen.findByRole('button', { name: 'Create Knowledge Base' }));
    expect(await screen.findByText(/Created Knowledge Base "Operations Runbook KB"/)).toBeTruthy();

    // Ingest Document & run Incremental Re-sync
    await user.click(screen.getByRole('button', { name: 'Ingest Document' }));
    expect(await screen.findByText(/Ingested "Support SLA Handbook" \(2 chunks embedded\)/)).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: 'Re-sync Document' }));
    expect(
      await screen.findByText(/Incremental re-sync: 1 re-embedded, 1 unchanged, 0 deleted/),
    ).toBeTruthy();

    // Ask this KB & inspect Citation Chip
    await user.click(screen.getByRole('button', { name: 'Ask KB' }));
    const answerEl = await screen.findByTestId('kb-query-answer');
    expect(answerEl.textContent).toContain('[cit:chk_1]');
    const chips = await screen.findAllByTestId('citation-chip');
    expect(chips.length).toBeGreaterThan(0);
    await user.click(chips[0]!);
    const passagePanel = await screen.findByTestId('cited-passage-panel');
    expect(passagePanel.textContent).toContain('Cited Passage: Support SLA Handbook');

    // Switch to Memory Explorer tab
    await user.click(screen.getByRole('tab', { name: /Memory Explorer/i }));
    await user.click(await screen.findByRole('button', { name: '+ Add Memory Item' }));
    expect(await screen.findByText(/Stored user memory item mem_1/)).toBeTruthy();

    // Session Rolling Summary with preserved IDs
    await user.click(screen.getByRole('button', { name: /Append & Compact Session/i }));
    expect((await screen.findAllByText(/T-10492, INV-9981/)).length).toBeGreaterThanOrEqual(1);

    // Right-to-Erasure removes memory item & session summary
    await user.click(screen.getByRole('button', { name: 'Erase Subject Memory' }));
    expect(
      await screen.findByText(
        /Right-to-erasure completed for "user_alice": 1 memory items and 1 session summaries purged/,
      ),
    ).toBeTruthy();

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('stores/rotates write-only secrets, saves budgets, toggles emergency kill switches, and verifies audit chain [E0.6-1..3]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/governance" />,
    );

    expect(await screen.findByRole('heading', { name: 'Immutable Audit Log' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /Secrets Vault \(Write-Only\)/i })).toBeTruthy();

    // 1. Write-only secret store & rotate (plaintext must never render back)
    await user.type(screen.getByLabelText('Secret Value (Write-Only)'), 'sk-ui-never-shown-999');
    await user.click(screen.getByRole('button', { name: 'Store Secret' }));
    expect(
      (await screen.findAllByText(/secret:\/\/db\/ws_1\/stripe_api_key/)).length,
    ).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/v1/)).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toContain('sk-ui-never-shown-999');

    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await user.type(
      await screen.findByLabelText('New Secret Value for Rotation'),
      'sk-ui-rotated-888',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm Rotate' }));
    expect(
      await screen.findByText(/Rotated "stripe_api_key" to key version v2\./),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('sk-ui-rotated-888');

    // 2. Hierarchical budget configuration (N.2.6)
    await user.click(screen.getByRole('button', { name: 'Save Budget' }));
    expect(
      await screen.findByText(/Saved workspace budget \(ws_1\): hard limit 1000000 micro-USD \(stop\)/),
    ).toBeTruthy();
    expect(await screen.findByText(/spent 0 \/ hard 1000000/)).toBeTruthy();

    // 3. Emergency kill switch activation banner + deactivation
    await user.click(screen.getByRole('button', { name: 'Activate Kill Switch' }));
    const banner = await screen.findByTestId('killswitch-banner');
    expect(banner.textContent).toContain('Emergency Kill Switch Active (1) in DEV');

    await user.click(screen.getByRole('button', { name: 'Deactivate Kill Switch' }));
    expect(await screen.findByText(/Deactivated kill switch \(global:\*\)/)).toBeTruthy();
    expect(screen.queryByTestId('killswitch-banner')).toBeNull();

    // 4. Audit hash-chain integrity check
    await user.click(screen.getByRole('button', { name: 'Verify Audit Chain' }));
    expect(await screen.findByText('Verified (4 events)')).toBeTruthy();

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('authors declarative policies with Rego preview/simulation/SoD enforce, provisions agent identities & scoped grants, and exports CSV/evidence packs [E1.2]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/governance" />,
    );

    expect(
      await screen.findByRole('heading', { name: /Declarative Policies & Simulation/i }),
    ).toBeTruthy();

    // 1. Create declarative policy -> preview Rego -> simulate -> promote via SoD
    await user.click(screen.getByRole('button', { name: 'Create Policy' }));
    expect(
      await screen.findByText(/Created policy "Block destructive tools in prod" \(audit_only\)/),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'View Rego' }));
    const regoPreview = await screen.findByTestId('policy-rego-preview');
    expect(regoPreview.textContent).toContain('package elshad.governance.deny_destructive_prod');

    await user.click(screen.getByRole('button', { name: 'Simulate Policy' }));
    const simReport = await screen.findByTestId('policy-sim-report');
    expect(simReport.textContent).toContain('8 blocked, 0 approvals across 120 runs');

    await user.click(screen.getByRole('button', { name: 'Enforce Policy (SoD)' }));
    expect(
      await screen.findByText(/promoted to enforce \(approved by prn_reviewer_2\)/),
    ).toBeTruthy();

    // 2. Provision agent identity & grant narrowed write tool scope
    await user.click(screen.getByRole('button', { name: 'Provision Agent Identity' }));
    expect(
      await screen.findByText(/Provisioned agent identity "Triage Agent Identity" \(prn_agent_1\)/),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Grant Scoped Tool' }));
    expect(await screen.findByText(/Granted write tool "http_request" to agt_1/)).toBeTruthy();

    // 3. Export Audit CSV & Generate Compliance Evidence Pack
    await user.click(screen.getByRole('button', { name: 'Export Audit CSV' }));
    const csvBanner = await screen.findByTestId('audit-csv-export');
    expect(csvBanner.textContent).toContain('4 rows');

    await user.click(screen.getByRole('button', { name: 'Generate Evidence Pack' }));
    const packBanner = await screen.findByTestId('evidence-pack-summary');
    expect(packBanner.textContent).toContain('Evidence Pack evp_mock_1');
    expect(packBanner.textContent).toContain('Policies: 1');
    expect(packBanner.textContent).toContain('Grants: 1');
    expect(packBanner.textContent).toContain('Agent Identities: 1');

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Approvals Inbox split queue, diff, evidence, high-risk APPROVE confirm, request info & edit-and-approve [E1.1]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/approvals" />,
    );

    expect(await screen.findByRole('heading', { name: 'Approvals Inbox' })).toBeTruthy();
    const detail = await screen.findByTestId('approval-detail-card');
    expect(detail.textContent).toContain('Refund $45.00 USD to order O-9');
    expect(detail.textContent).toContain('Duplicate charge confirmed');
    expect(await screen.findByText(/Dispatched Slack & Email Notifications/i)).toBeTruthy();

    // Request info & Snooze
    await user.type(screen.getByLabelText('Request Additional Info'), 'Confirm order ID');
    await user.click(screen.getByRole('button', { name: 'Request Info' }));
    expect(await screen.findByText(/Requested more info on/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Snooze +1h' }));
    expect(await screen.findByText(/Snoozed/)).toBeTruthy();

    // High-risk confirmation + Edit & Approve
    await user.type(screen.getByLabelText(/High-Risk Confirmation/i), 'APPROVE');
    await user.click(screen.getByRole('button', { name: 'Edit & Approve' }));
    expect(await screen.findByText(/updated to status: approved/i)).toBeTruthy();

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Evaluations view: datasets, graders, experiments matrix, diff inspector & passes axe [E1.3, FR-EV-1..4, §7.3.9]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/evaluations" />,
    );

    expect(await screen.findByRole('heading', { name: /Evaluations & Release Gates/i })).toBeTruthy();
    expect((await screen.findAllByText('Billing Regression Set')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Standard 14-day refund')).toBeTruthy();

    // 1. Create a new golden dataset via modal
    await user.click(screen.getByRole('button', { name: /New Set/i }));
    expect(await screen.findByRole('dialog', { name: 'New Dataset Dialog' })).toBeTruthy();
    const dsNameInput = screen.getByPlaceholderText(/e\.g\. Support Triage Regression Set/i);
    await user.type(dsNameInput, 'Customer Support Golden Set');
    await user.click(screen.getByRole('button', { name: 'Create Dataset' }));
    expect(await screen.findByText(/Created evaluation dataset "Customer Support Golden Set"/i)).toBeTruthy();

    // 2. Add test case to dataset
    await user.click(screen.getByRole('button', { name: /Add Test Case/i }));
    const tcDialog = await screen.findByRole('dialog', { name: 'New Test Case Dialog' });
    expect(tcDialog).toBeTruthy();
    const tcNameInput = screen.getByPlaceholderText(/e\.g\. Standard refund within 14 days/i);
    await user.type(tcNameInput, 'Overcharge refund case');
    await user.click(within(tcDialog).getByRole('button', { name: 'Add Test Case' }));
    expect(await screen.findByText(/Created test case "Overcharge refund case"/i)).toBeTruthy();

    // 3. Switch to Pluggable Graders tab
    await user.click(screen.getByRole('tab', { name: /Pluggable Graders/i }));
    expect(await screen.findByRole('heading', { name: /Pluggable Automated Graders/i })).toBeTruthy();
    expect(await screen.findByText('Exact Match Grader')).toBeTruthy();

    // 4. Switch to Experiments & Gates tab, run experiment and inspect results matrix & diff
    await user.click(screen.getByRole('tab', { name: /Experiments & Gates/i }));
    expect(await screen.findByRole('heading', { name: /Experiment Runs & Release Gates/i })).toBeTruthy();
    expect(await screen.findByText(/Candidate v1\.0\.1 Regression Check/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Run Evaluation Experiment/i }));
    expect(await screen.findByText(/Experiment run completed\. Verdict: PASSED/i)).toBeTruthy();
    expect(await screen.findByRole('table', { name: 'Experiment Results Matrix' })).toBeTruthy();

    // Open diff drawer
    await user.click(screen.getByRole('button', { name: /Diff/i }));
    expect(await screen.findByRole('heading', { name: 'Case Evaluation Inspector' })).toBeTruthy();
    expect(await screen.findByText(/Grader Breakdown:/i)).toBeTruthy();

    // Accessibility validation
    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Team Canvas: supervisor + specialists topology, typed handoffs, blackboard, simulation & passes axe [E1.4, FR-RT-20..24, §7.3.3]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/teams" />,
    );

    expect(await screen.findByRole('heading', { name: 'Team Canvas' })).toBeTruthy();
    expect(await screen.findByText('Customer Support Swarm')).toBeTruthy();
    expect(await screen.findByText('FR-RT-23 Max Depth: 3')).toBeTruthy();
    expect(await screen.findByText('FR-RT-24 Max Fan-out: 8')).toBeTruthy();
    expect(await screen.findByText('Typed Handoffs: Strict')).toBeTruthy();

    // Supervisor node visible
    expect(screen.getByLabelText(/Supervisor node: agent_supervisor/i)).toBeTruthy();

    // Specialist nodes visible
    expect(screen.getByLabelText(/Specialist node: agent_triage/i)).toBeTruthy();
    expect(screen.getByLabelText(/Specialist node: agent_auth/i)).toBeTruthy();
    expect(screen.getByLabelText(/Specialist node: agent_billing/i)).toBeTruthy();

    // Inspect typed handoff edge
    const triageEdge = screen.getByRole('button', { name: /Typed handoff edge to agent_triage/i });
    await user.click(triageEdge);
    expect(await screen.findByRole('heading', { name: 'Typed Handoff Contract' })).toBeTruthy();
    expect(await screen.findByText(/Free text handoffs forbidden/i)).toBeTruthy();

    // Inspect specialist member
    const billingNode = screen.getByLabelText(/Specialist node: agent_billing/i);
    await user.click(billingNode);
    expect(await screen.findByRole('heading', { name: 'Member Inspector' })).toBeTruthy();
    expect(await screen.findByText(/Blackboard Read Scopes/i)).toBeTruthy();

    // Run simulation
    const simButton = screen.getByRole('button', { name: /Run Simulation/i });
    await user.click(simButton);
    expect(await screen.findByRole('heading', { name: 'Simulation Results' })).toBeTruthy();
    expect(await screen.findByText(/Child Run Roll-up \(FR-RT-20\)/i)).toBeTruthy();
    expect(await screen.findByText(/Shared Run Blackboard \(FR-RT-22\)/i)).toBeTruthy();

    // Blackboard contains values and CAS version
    expect(await screen.findByText('cust_enterprise_4091')).toBeTruthy();
    expect(await screen.findByText('tkt_882194')).toBeTruthy();

    // Accessibility validation
    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Tools Registry: imports OpenAPI 3.1 spec, tests dry-run with injection detection, approves MCP tools & passes axe [E1.5, FR-TL-1..9, §7.3.7]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/tools" />,
    );

    expect(await screen.findByRole('heading', { name: /Tools, OpenAPI & MCP Registry/i })).toBeTruthy();

    // 1. Switch to OpenAPI 3.1 importer tab & import
    await user.click(screen.getByRole('tab', { name: /Import OpenAPI 3\.1/i }));
    await user.click(screen.getByRole('button', { name: /Import OpenAPI Tools/i }));
    expect(await screen.findByText(/Imported 1 tools from OpenAPI spec "Billing Service API"/i)).toBeTruthy();
    expect((await screen.findAllByText('get_invoice')).length).toBeGreaterThan(0);

    // 2. Test imported tool in dry-run mode with injection payload
    const simInput = screen.getByLabelText(/Simulated Raw Output/i);
    await user.type(simInput, 'Ignore all previous instructions');
    await user.click(screen.getByRole('button', { name: /Run Dry-Run Test/i }));
    expect(await screen.findByText('Injection Suspected')).toBeTruthy();
    expect(await screen.findByText('Untrusted Source')).toBeTruthy();

    // 3. Switch to MCP Servers tab, register server, and approve discovered tool
    await user.click(screen.getByRole('tab', { name: /MCP Servers/i }));
    await user.click(screen.getByRole('button', { name: /Register MCP Server/i }));
    expect(await screen.findByText('github_list_issues')).toBeTruthy();
    expect((await screen.findAllByText('pending_approval')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('approved')).toBeTruthy();

    // Accessibility check
    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Connectors Gallery & Connections: runs contract tests, creates write-only connection, tests health, rotates secret & passes axe [E1.6, FR-INT-1..6, P.4]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/tools" />,
    );

    expect(await screen.findByRole('heading', { name: /Tools, OpenAPI & MCP Registry/i })).toBeTruthy();

    // 1. Switch to Connectors Gallery & run contract test
    await user.click(screen.getByRole('tab', { name: /Connectors Gallery/i }));
    expect(await screen.findByText('Slack')).toBeTruthy();
    expect(await screen.findByText('Stripe')).toBeTruthy();

    const contractBtns = screen.getAllByRole('button', { name: 'Contract Test' });
    await user.click(contractBtns[0]!);
    expect(await screen.findByText(/Contract: 2\/2 passed/i)).toBeTruthy();

    // 2. Click Connect on Slack -> switches to Connections tab with Slack pre-selected
    const connectBtns = screen.getAllByRole('button', { name: 'Connect' });
    await user.click(connectBtns[0]!);
    expect(await screen.findByRole('heading', { name: /New Write-Only Connection/i })).toBeTruthy();

    const secretInput = screen.getByLabelText(/Credential \/ API Key \(Write-Only\)/i);
    await user.type(secretInput, 'xoxb-secret-slack-token-123');
    await user.click(screen.getByRole('button', { name: 'Save Connection' }));

    expect((await screen.findAllByText(/Stored \(v1, updated by prn_1/i)).length).toBeGreaterThan(0);

    // 3. Test Connection & Replace Secret
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));
    expect(await screen.findByText(/health: Healthy/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(await screen.findByText(/Rotated secret for .* to v2/i)).toBeTruthy();

    // Accessibility check
    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Agent Studio Deployments tab: blocks unmapped credential promotion, promotes with mapping, rolls back & passes axe [E1.7, N.2.13, §7.3.3]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/agents" />,
    );

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy();

    // First create an agent so Studio tabs appear
    const createBtns = screen.getAllByRole('button', { name: '+ Create agent' });
    await user.click(createBtns[0]!);
    await user.click(await screen.findByRole('button', { name: 'Create Agent Draft' }));

    // Switch to Deployments tab
    await user.click(await screen.findByRole('tab', { name: 'Deployments' }));
    expect(await screen.findByRole('heading', { name: /Environments, Promotions & Rollback/i })).toBeTruthy();

    // Verify live prod deployment & rollback button
    expect(await screen.findByText('Live: agv_1')).toBeTruthy();

    // 1. Clear credential mapping -> promotion blocked with clear error
    const mapInput = screen.getByLabelText(/Target Credential Mapping/i);
    await user.clear(mapInput);
    await user.click(screen.getByRole('button', { name: 'Promote Version' }));
    expect(await screen.findByText(/Unmapped credential\(s\) in target environment "prod": slack_bot_token/i)).toBeTruthy();

    // 2. Restore mapping -> creates pending_approval promotion
    await user.type(mapInput, 'slack_bot_token=conn_prod_slack');
    await user.click(screen.getByRole('button', { name: 'Promote Version' }));
    expect(await screen.findByText(/queued for Separation-of-Duties approval/i)).toBeTruthy();

    // 3. Rollback live prod deployment
    await user.click(screen.getByRole('button', { name: /Rollback to agv_0/i }));
    expect(await screen.findByText(/Rolled back prod deployment to version agv_0/i)).toBeTruthy();

    // Accessibility check
    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Observability & Monitoring dashboards, cost breakdown, alerts lifecycle, and failure explainer [E1.8]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/monitoring" />,
    );

    expect(await screen.findByRole('heading', { name: /Observability & Monitoring/i })).toBeTruthy();
    expect(await screen.findByText('80.0%')).toBeTruthy();

    // Cost & Usage tab
    await user.click(screen.getByRole('button', { name: 'Cost & Usage' }));
    expect(await screen.findByText('openai:gpt-4o-mini')).toBeTruthy();

    // Alerts & Incidents tab -> create rule -> evaluate -> acknowledge
    await user.click(screen.getByRole('button', { name: /Alerts & Incidents/i }));
    await user.type(screen.getByLabelText('Rule Name'), 'Failure spike');
    await user.click(screen.getByRole('button', { name: 'Create Rule' }));
    expect(await screen.findByText('Failure spike')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Evaluate Rules' }));
    expect(await screen.findByText(/Alert "Failure spike" fired/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText('acknowledged')).toBeTruthy();

    // Accessibility check
    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Pilot Agents & Go-Live Readiness: runs golden benchmarks, tests L1/L2 pilots, and records sign-off [E1.9]', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/pilots" />,
    );

    expect(await screen.findByRole('heading', { name: /Pilot Agents & Go-Live Readiness/i })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Run Golden Benchmarks' }));
    expect(await screen.findByText('ALL KPI TARGETS MET')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Test Support Triage (L1)' }));
    expect(await screen.findByText(/Reviewing your billing inquiry/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Test Invoice Exception (L2)' }));
    expect(await screen.findByText(/auto_resolve_tolerance/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Sign Off L1 Pilot' }));
    expect(await screen.findByText('Signed off by prn_1')).toBeTruthy();

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Agent Studio Screens 04-11: Tools 3-col, Memory Matrix, Guardrail Simulator, Evals, Versions Diff & Activity Timeline', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/agents" />,
    );

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy();
    const createBtns = screen.getAllByRole('button', { name: '+ Create agent' });
    await user.click(createBtns[0]!);
    await user.click(await screen.findByRole('button', { name: 'Create Agent Draft' }));

    // Screen 04: Tools 3-col + dry-run test
    await user.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(await screen.findByRole('region', { name: 'Tool catalogue' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Granted agent tools' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Tool permissions and testing' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Test Tool Execution' }));
    expect(await screen.findByText(/"status": "dry_run_ok"/)).toBeTruthy();

    // Screen 05: Memory & Knowledge
    await user.click(screen.getByRole('tab', { name: 'Memory' }));
    expect(await screen.findByRole('table', { name: 'Memory scope matrix' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Test Retrieval' }));
    expect(await screen.findByText(/Support SLA Handbook/i)).toBeTruthy();

    // Screen 06: Guardrails
    await user.click(screen.getByRole('tab', { name: 'Guardrails' }));
    expect(await screen.findByRole('heading', { name: 'Input Guards' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Test Guardrails' }));
    expect(await screen.findByText('BLOCKED')).toBeTruthy();

    // Screen 08: Evals
    await user.click(screen.getByRole('tab', { name: 'Evals' }));
    expect(await screen.findByText('GATE PASSED')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Evaluation case results' })).toBeTruthy();

    // Screen 09: Versions
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    expect(await screen.findByRole('region', { name: 'Version timeline' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Version inspector and comparison' })).toBeTruthy();

    // Screen 11: Activity + Comment
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByRole('complementary', { name: 'Activity Detail Drawer' })).toBeTruthy();
    await user.type(screen.getByLabelText('Activity comment'), 'Ready for staging rollout');
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    expect((await screen.findAllByText('Ready for staging rollout')).length).toBeGreaterThanOrEqual(1);

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Workflow Engine Screens 12-14: Registry & Templates, Builder Undo/Redo/Auto-Layout/Sticky Notes/6-Tab Inspector/JSON, and Executions Overlay', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });
    const { container } = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/workflows" />,
    );

    expect(await screen.findByRole('heading', { name: 'Workflow Canvas' })).toBeTruthy();

    // Screen 12: Switch to Workflows Registry & use a template
    await user.click(screen.getByRole('tab', { name: 'Registry' }));
    expect(await screen.findByRole('heading', { name: 'Workflows' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Total Workflows' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Active Workflows' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Draft Workflows' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Failed Workflows' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Workflow template gallery' })).toBeTruthy();

    const useTemplateBtns = screen.getAllByRole('button', { name: 'Use Template' });
    await user.click(useTemplateBtns[1]!);
    expect(
      await screen.findByText(/Created workflow "invoice-3way-match-1" from template "Invoice 3-Way Match"/),
    ).toBeTruthy();

    // Screen 13: Builder controls, Auto-Layout, Sticky Note, Undo/Redo, 6-Tab Inspector & JSON Modal
    await user.click(screen.getByRole('button', { name: 'Auto-Layout' }));
    expect(await screen.findByText(/Auto-arranged canvas nodes/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Sticky Note' }));
    expect(await screen.findByLabelText('Sticky note')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByLabelText('Sticky note')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(await screen.findByLabelText('Sticky note')).toBeTruthy();

    // Right Inspector: Expression preview + 6 tabs
    expect(screen.getByLabelText('Expression evaluation preview').textContent).toContain(
      'Urgent: Server latency alert!',
    );
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByText(/Outgoing Connections/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Input' }));
    expect(screen.getByText(/Upstream nodes/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByLabelText('Node Implementation Notes')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Parameters' }));

    // YAML & JSON lossless modal
    await user.click(screen.getByRole('button', { name: 'View as YAML' }));
    await user.click(screen.getByRole('tab', { name: 'JSON' }));
    const jsonArea = (await screen.findByLabelText('workflow_json')) as HTMLTextAreaElement;
    expect(jsonArea.value).toContain('"schema_version": 1');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    // Execute workflow and open Screen 14 Executions
    await user.click(screen.getByRole('button', { name: 'Test Workflow' }));
    expect(await screen.findByText(/Triggered workflow run run_wf_full/)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /Executions \(/ }));
    expect(await screen.findByRole('heading', { name: 'Workflow Executions' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Total Executions' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Successful' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Avg Duration' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Workflow executions' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByRole('region', { name: 'Execution timeline details' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/Exported 1 workflow execution row\(s\) to CSV/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Inspect on Canvas' }));
    expect(await screen.findByRole('region', { name: 'Execution overlay status' })).toBeTruthy();
    const overlaidNodes = screen.getAllByTestId('canvas-node');
    expect(overlaidNodes[0]?.getAttribute('data-overlay-status')).toBe('succeeded');

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRes.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);

  it('renders Execution Infrastructure Screens 15-17: Runs Filters/Bulk/Export, 8-Tab Run Detail & Failure Explainer, and Approvals 3-View SLA Inbox', async () => {
    const user = userEvent.setup();
    const client = createMockClient({ authenticatedInitially: true });

    // Part A: Screen 15 Runs List + Screen 16 8-Tab Run Detail & Failure Explainer
    const runsRender = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/runs" />,
    );
    expect(await screen.findByRole('heading', { name: 'Runs & Traces' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Total Runs' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Total Spend' })).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Start Durable Run' })[0]!);
    expect(await screen.findByRole('heading', { name: /Run Trace: run_1/ })).toBeTruthy();

    // Save Filter, Export CSV & Bulk select
    await user.click(screen.getByRole('button', { name: 'Save Filter' }));
    expect(await screen.findByText(/Saved filter preset/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/Exported 1 run\(s\) to CSV/)).toBeTruthy();

    await user.click(screen.getByLabelText('Select run run_1'));
    expect(await screen.findByRole('region', { name: 'Bulk run actions' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    // Switch through Run Detail 8 tabs
    await user.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByText(/Gantt span timeline/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Graph' }));
    expect(await screen.findByText(/Execution path/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(await screen.findByText(/Run Input:/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Cost' }));
    expect(await screen.findByRole('table', { name: 'Run cost breakdown' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Memory' }));
    expect(await screen.findByText(/Recent workspace memory reads\/writes/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    await user.click(screen.getByRole('tab', { name: 'Raw' }));
    expect(await screen.findByRole('button', { name: 'Copy JSON' })).toBeTruthy();

    // Open Failure Explainer
    await user.click(screen.getByRole('button', { name: 'Explain Failure' }));
    const explainer = await screen.findByRole('region', { name: 'Failure explainer' });
    expect(explainer.textContent).toContain('What failed:');
    expect(explainer.textContent).toContain('Where it failed:');
    expect(explainer.textContent).toContain('Why it likely failed:');
    expect(explainer.textContent).toContain('Suggested remediation:');

    const axeRuns = await axe.run(runsRender.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeRuns.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
    runsRender.unmount();

    // Part B: Screen 17 Approvals Inbox 3-View Switcher, SLA urgency & Reject reason validation
    const aprRender = render(
      <ConsoleApp client={client} initialPath="/w/default/e/dev/approvals" />,
    );
    expect(await screen.findByRole('heading', { name: 'Approvals Inbox' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'My Queue' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All Approvals' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Approval Policies' })).toBeTruthy();

    // Reject without min 5 chars triggers validation alert
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    // Switch to All Approvals filter view and Approval Policies view
    await user.click(screen.getByRole('tab', { name: 'All Approvals' }));
    expect(await screen.findByLabelText('Search approvals')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Approval Policies' }));
    expect(await screen.findByRole('table', { name: 'Approval policies table' })).toBeTruthy();

    const axeApr = await axe.run(aprRender.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeApr.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  }, 20_000);
});
