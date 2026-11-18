// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import {
  PlatformClient,
  type AgentDto,
  type ApiKeyDto,
  type DlqItemDto,
  type MeDto,
  type ModelCapabilityDto,
  type RunDto,
  type RunStepDto,
  type ToolContractDto,
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
});
