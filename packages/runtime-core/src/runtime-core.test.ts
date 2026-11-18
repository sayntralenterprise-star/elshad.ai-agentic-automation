import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  microUsd,
  type OrgId,
  type PrincipalId,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import { MockModelProvider, ModelGateway } from '@elshad/model-kit';
import { InMemoryToolRegistry, ToolGateway } from '@elshad/tool-kit';
import {
  BudgetManager,
  InMemoryUsageLedger,
  KillSwitchService,
  buildAgentContext,
  detectAgentLoop,
  diffAgentDefinitions,
  executeReActAgentRun,
  loadSystemScaffold,
  validateAgentDefinition,
  type AgentDefinition,
} from './index.js';

const ctx: TenantContext = {
  orgId: '01930000-0000-7000-8000-000000000001' as OrgId,
  workspaceId: '01930000-0000-7000-8000-000000000002' as WorkspaceId,
  principal: {
    id: '01930000-0000-7000-8000-000000000003' as PrincipalId,
    type: 'user',
  },
  requestId: 'req_test_1',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
};

function makeBaseDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    kind: 'AgentVersion',
    apiVersion: 'elshad.ai/v1',
    name: 'research-assistant',
    version: '1.0.0',
    description: 'Answers concise questions',
    autonomy_level: 2,
    model: {
      tier: 'standard',
      provider: 'mock',
      model: 'mock/react-default',
      temperature: 0.2,
      routing_strategy: 'quality',
      fallback: [],
    },
    prompt: {
      system: 'You are a precise research assistant.',
    },
    tools: [{ tool: 'current_time', approval: 'auto', scope: {} }],
    limits: {
      max_steps: 10,
      max_tokens: 100_000,
      max_wall_time_ms: 60_000,
      max_cost_micro_usd: 1_000_000,
      max_tool_calls: 20,
    },
    reasoning: {
      strategy: 'react',
      allow_parallel_tool_calls: false,
    },
    ...overrides,
  };
}

describe('@elshad/runtime-core ReAct loop, context budget, loops & usage ledger [E0.3-3..9]', () => {
  it('loads system scaffold, validates M.1 rules, and computes diffs', () => {
    expect(loadSystemScaffold()).toContain('untrusted_external');
    const toolRegistry = new InMemoryToolRegistry(true);

    const v1 = makeBaseDefinition();
    const res = validateAgentDefinition(v1, { toolRegistry });
    expect(res.definitionHash).toHaveLength(64);

    // Reject L4 unless explicitly permitted [DOC-Q-016]
    expect(() =>
      validateAgentDefinition(makeBaseDefinition({ autonomy_level: 4 }), { toolRegistry }),
    ).toThrow(PlatformError);

    // Reject approval: 'never' for external_comms under L2 [M.1]
    expect(() =>
      validateAgentDefinition(
        makeBaseDefinition({
          autonomy_level: 2,
          tools: [{ tool: 'http_request', approval: 'never', scope: {} }],
        }),
        { toolRegistry },
      ),
    ).toThrow(PlatformError);

    // Diff detects added tool and schema changes
    const v2 = makeBaseDefinition({
      version: '1.1.0',
      tools: [
        { tool: 'current_time', approval: 'auto', scope: {} },
        { tool: 'code_interpreter', approval: 'auto', scope: {} },
      ],
    });
    const diff = diffAgentDefinitions(v1, v2);
    expect(diff.changes.some((c) => c.path === 'tools.code_interpreter' && c.kind === 'added')).toBe(
      true,
    );
  });

  it('truncates oldest observations first when context exceeds window [N.2.3]', () => {
    const def = makeBaseDefinition();
    const assembled = buildAgentContext({
      definition: def,
      historyMessages: [
        { role: 'tool', toolCallId: 'c1', toolName: 'web_fetch', content: 'X'.repeat(5000) },
        { role: 'assistant', content: 'Analyzed data.' },
      ],
      latestUserInput: 'Summarize briefly.',
      contextWindowTokens: 2800,
      reserveOutputTokens: 2000,
    });
    expect(assembled.diagnostics.truncatedObservationsCount).toBe(1);
    expect(assembled.messages.some((m) => m.content.includes('observation truncated'))).toBe(true);
  });

  it('detects repeated tool calls, identical observations, and 4 stalled turns [N.2.4]', () => {
    const repeated = detectAgentLoop({
      recentToolHashes: ['h1', 'h2', 'h1', 'h3', 'h1'],
      recentObservations: [],
      consecutiveEmptyOrNoToolTurns: 0,
    });
    expect(repeated.loopDetected).toBe(true);
    expect(repeated.reason).toBe('repeated_tool_call');

    const identicalObs = detectAgentLoop({
      recentToolHashes: [],
      recentObservations: Array(6).fill('exact same error observation from endpoint'),
      consecutiveEmptyOrNoToolTurns: 0,
    });
    expect(identicalObs.loopDetected).toBe(true);
    expect(identicalObs.reason).toBe('repetitive_observations');

    const stalled = detectAgentLoop({
      recentToolHashes: [],
      recentObservations: [],
      consecutiveEmptyOrNoToolTurns: 4,
    });
    expect(stalled.loopDetected).toBe(true);
    expect(stalled.reason).toBe('stalled_no_progress');
  });

  it('executes ReAct tool + answer turn and reconciles usage ledger === run.costMicroUsd [E0.3-3, E0.3-9]', async () => {
    const mock = new MockModelProvider();
    mock.enqueue(
      {
        kind: 'tool_calls',
        thought: 'Need the current time first.',
        calls: [{ id: 'call_time', name: 'current_time', arguments: {} }],
        tokensIn: 200,
        tokensOut: 50,
      },
      {
        kind: 'answer',
        content: 'The UTC time was checked successfully.',
        tokensIn: 300,
        tokensOut: 40,
      },
    );

    const modelGateway = new ModelGateway();
    modelGateway.registerProvider(mock);
    const toolGateway = new ToolGateway();
    const usageLedger = new InMemoryUsageLedger();

    const result = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_1',
        definition: makeBaseDefinition(),
        userInput: 'What time is it?',
      },
      { modelGateway, toolGateway, usageLedger },
    );

    expect(result.status).toBe('succeeded');
    expect(result.terminationReason).toBe('final_answer');
    expect(result.usage.toolCalls).toBe(1);
    expect(result.steps.map((s) => s.type)).toEqual(['llm_call', 'tool_call', 'llm_call']);

    const sumFromLedger = await usageLedger.sumRunCostMicroUsd(ctx.orgId, result.runId);
    expect(sumFromLedger).toBe(result.costMicroUsd);
    expect(result.costMicroUsd).toBeGreaterThan(microUsd(0));
  });

  it('performs 1 auto-repair retry on invalid structured JSON output and fails cleanly if second fails [FR-RT-9]', async () => {
    const mock = new MockModelProvider();
    mock.enqueue(
      { kind: 'answer', content: 'not valid json at all' },
      { kind: 'answer', content: '{"status":"ok","score":98}' },
    );

    const modelGateway = new ModelGateway();
    modelGateway.registerProvider(mock);
    const usageLedger = new InMemoryUsageLedger();

    const structuredDef = makeBaseDefinition({
      prompt: {
        system: 'Output structured JSON.',
        output_schema: {
          type: 'object',
          required: ['status', 'score'],
          properties: {
            status: { type: 'string' },
            score: { type: 'integer' },
          },
        },
      },
    });

    const okResult = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_1',
        definition: structuredDef,
        userInput: 'Score this.',
      },
      { modelGateway, toolGateway: new ToolGateway(), usageLedger },
    );
    expect(okResult.status).toBe('succeeded');
    expect(okResult.output).toEqual({ status: 'ok', score: 98 });

    // Second failure exhausts the 1-retry repair budget
    mock.enqueue(
      { kind: 'answer', content: '{"status":123}' },
      { kind: 'answer', content: '{"status":123}' },
    );
    const failedResult = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_1',
        definition: structuredDef,
        userInput: 'Score again.',
      },
      { modelGateway, toolGateway: new ToolGateway(), usageLedger },
    );
    expect(failedResult.status).toBe('failed');
    expect(failedResult.failureClass).toBe('tool_contract_violation');
    expect(failedResult.error?.code).toBe('MODEL_OUTPUT_INVALID');
  });

  it('halts runaway agent via loop detector inside live ReAct execution [FR-RT-11]', async () => {
    const mock = new MockModelProvider();
    mock.setHandler(() => ({
      kind: 'tool_calls',
      calls: [{ id: 'tc_repeat', name: 'current_time', arguments: {} }],
    }));

    const modelGateway = new ModelGateway();
    modelGateway.registerProvider(mock);
    const usageLedger = new InMemoryUsageLedger();

    const result = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_1',
        definition: makeBaseDefinition(),
        userInput: 'Keep polling time forever.',
      },
      { modelGateway, toolGateway: new ToolGateway(), usageLedger },
    );
    expect(result.status).toBe('failed');
    expect(result.terminationReason).toBe('limit_reached');
    expect(result.error?.code).toBe('RUN_LOOP_DETECTED');
  });

  it('stops runaway agent within 1 step on hard budget, supports model downgrade & enforces kill switches <= 5s [E0.6-2, E0.6-3]', async () => {
    const mock = new MockModelProvider();
    mock.setHandler(() => ({
      kind: 'tool_calls',
      calls: [{ id: 'tc_1', name: 'current_time', arguments: {} }],
      tokensIn: 500,
      tokensOut: 200,
    }));

    const modelGateway = new ModelGateway();
    modelGateway.registerProvider(mock);
    const toolGateway = new ToolGateway();
    const usageLedger = new InMemoryUsageLedger();
    const budgetManager = new BudgetManager();
    const killSwitchService = new KillSwitchService();

    // Hard budget of 100 micro-USD stops after single LLM call (>100 micro-USD) before tool call
    budgetManager.upsertBudget(ctx, {
      scopeType: 'agent',
      scopeId: 'agt_runaway',
      softLimitMicroUsd: 50,
      hardLimitMicroUsd: 100,
      actionOnBreach: 'stop',
    });

    const events: string[] = [];
    const stoppedRun = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_runaway',
        definition: makeBaseDefinition(),
        userInput: 'Run runaway loop.',
        onEvent: (e) => events.push(e.type),
      },
      { modelGateway, toolGateway, usageLedger, budgetManager, killSwitchService },
    );

    expect(stoppedRun.status).toBe('budget_exceeded');
    expect(stoppedRun.terminationReason).toBe('limit_reached');
    expect(stoppedRun.error?.code).toBe('BUD_HARD_LIMIT');
    expect(stoppedRun.steps).toHaveLength(1);
    expect(stoppedRun.usage.toolCalls).toBe(0);
    expect(events).toContain('budget.soft_limit');
    expect(JSON.stringify(stoppedRun.steps)).not.toMatch(/\bsk-|AKIA|ghp_/);

    // Downgrade model action switches tier to fast when already at limit
    mock.setHandler(() => ({
      kind: 'answer',
      content: 'Downgraded answer.',
      tokensIn: 40,
      tokensOut: 10,
    }));
    budgetManager.upsertBudget(ctx, {
      scopeType: 'agent',
      scopeId: 'agt_downgrade',
      hardLimitTokens: 0,
      actionOnBreach: 'downgrade_model',
    });
    const downgradedRun = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_downgrade',
        definition: makeBaseDefinition(),
        userInput: 'Answer with downgrade.',
      },
      { modelGateway, toolGateway, usageLedger, budgetManager, killSwitchService },
    );
    expect(downgradedRun.status).toBe('succeeded');
    expect(downgradedRun.steps[0]?.summary['model']).toBe('mock/react-fast');

    // Emergency per-agent kill switch halts run immediately (< 5s target)
    const ksStart = performance.now();
    const ks = killSwitchService.activate(ctx, {
      scopeType: 'agent',
      scopeId: 'agt_killed',
      reason: 'Runaway production incident',
    });
    const killedRun = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_killed',
        definition: makeBaseDefinition(),
        userInput: 'Should abort immediately.',
      },
      { modelGateway, toolGateway, usageLedger, budgetManager, killSwitchService },
    );
    expect(performance.now() - ksStart).toBeLessThan(5000);
    expect(killedRun.status).toBe('cancelled');
    expect(killedRun.error?.code).toBe('POL_DENIED');
    expect(killedRun.steps).toHaveLength(0);

    // Deactivate kill switch restores execution
    killSwitchService.deactivate(ctx, ks.id);
    mock.setHandler(() => ({ kind: 'answer', content: 'Recovered.', tokensIn: 20, tokensOut: 10 }));
    const recoveredRun = await executeReActAgentRun(
      {
        ctx,
        projectId: 'prj_1',
        environmentId: 'env_1',
        agentId: 'agt_killed',
        definition: makeBaseDefinition(),
        userInput: 'Run normally now.',
      },
      { modelGateway, toolGateway, usageLedger, budgetManager, killSwitchService },
    );
    expect(recoveredRun.status).toBe('succeeded');
  });
});
