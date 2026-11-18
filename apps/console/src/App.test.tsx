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
  type ConversationSessionDto,
  type DatasetDto,
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
  type MeDto,
  type MemoryItemDto,
  type ModelCapabilityDto,
  type NotificationDto,
  type PolicyDto,
  type RunDto,
  type RunStepDto,
  type SecretMetadataDto,
  type TestCaseDto,
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

    // Home dashboard appears
    expect(await screen.findByRole('heading', { name: 'Platform Overview' })).toBeTruthy();

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
    await screen.findByRole('heading', { name: 'Sign in to Elshad Platform' });
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

    expect(await screen.findByRole('heading', { name: 'Agents Studio' })).toBeTruthy();

    // Open Create Agent dialog and submit
    const createBtns = screen.getAllByRole('button', { name: '+ Create Agent' });
    await user.click(createBtns[0]!);

    const nameInput = await screen.findByLabelText('Agent Name (kebab-case)');
    await user.clear(nameInput);
    await user.type(nameInput, 'ops-triage-agent');
    await user.click(screen.getByRole('button', { name: 'Create Agent Draft' }));

    expect(await screen.findByRole('heading', { name: 'ops-triage-agent' })).toBeTruthy();

    // Switch to Tools tab and enable confidential_kb_read + web_fetch + http_request
    await user.click(screen.getByRole('tab', { name: 'Tools' }));
    await user.click(screen.getByLabelText('Enable tool confidential_kb_read'));
    await user.click(screen.getByLabelText('Enable tool web_fetch'));
    await user.click(screen.getByLabelText('Enable tool http_request'));
    const alertBanner = await screen.findByRole('alert');
    expect(alertBanner.textContent).toContain('Lethal Trifecta Warning');

    // Publish version & run in Test Playground
    await user.click(screen.getByRole('button', { name: 'Publish Version' }));
    expect(await screen.findByText(/Published v1\.0\.0/)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Test Playground' }));
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
});
