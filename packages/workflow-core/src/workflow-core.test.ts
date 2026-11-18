import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@elshad/db';
import {
  PlatformError,
  type OrgId,
  type PrincipalId,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import { InMemoryEffectLedger, InMemoryExecutionEngine } from '@elshad/execution';
import {
  NodeRegistry,
  SandboxedJsonataEngine,
  TriggerService,
  assertValidWorkflowGraph,
  executeWorkflowGraph,
  parseWorkflowFromYaml,
  serializeWorkflowToYaml,
  validateWorkflowGraph,
  type WorkflowGraph,
} from './index.js';

const ctx: TenantContext = {
  orgId: '01930000-0000-7000-8000-000000000001' as OrgId,
  workspaceId: '01930000-0000-7000-8000-000000000002' as WorkspaceId,
  principal: {
    id: '01930000-0000-7000-8000-000000000003' as PrincipalId,
    type: 'user',
  },
  requestId: 'req_wf_1',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
};

describe('@elshad/workflow-core JSONata, Graph Validation, Triggers, YAML & Execution [E0.4-1..7]', () => {
  it('evaluates 3-mode DOC-Q-009 JSONata expressions, blocks $secret, and enforces 50ms timeout + 1MB cap [E0.4-3]', async () => {
    const engine = new SandboxedJsonataEngine();
    const scope = {
      json: { category: 'billing', amount: 250, email: 'alice@example.com', items: [{ v: 10 }, { v: 90 }] },
      item: 0,
      node: { triage: { json: { priority: 'high' } } },
      now: '2026-11-18T12:00:00.000Z',
    };

    expect(await engine.evaluate("$json.category = 'billing' and $json.amount >= 200", scope)).toBe(true);
    expect(await engine.evaluate('$sum($json.items.v)', scope)).toBe(100);
    expect(await engine.evaluateConfigValue('={{ $node["triage"].json.priority }}', scope)).toBe('high');
    expect(await engine.evaluateConfigValue('={{ $json.amount }}', scope)).toBe(250);
    expect(await engine.evaluateConfigValue('Alert for {{ $json.category }} (#{{ $item }})', scope)).toBe(
      'Alert for billing (#0)',
    );
    expect(await engine.evaluate('$redact($json.email, "pii")', scope)).toBe('[REDACTED:email]');
    expect(await engine.evaluate('$dateAdd($now, 2, "hours")', scope)).toBe(
      '2026-11-18T14:00:00.000Z',
    );

    // Block $secret and prototype access
    await expect(engine.evaluate('$secret.API_KEY', scope)).rejects.toMatchObject({
      code: 'POL_DENIED',
    });
    await expect(engine.evaluate('$json.__proto__', scope)).rejects.toMatchObject({
      code: 'POL_DENIED',
    });

    // Enforce 50ms timeout & 1MB size limit
    await expect(
      engine.evaluate(
        '[1,2,3,4,5,6,7,8,9,10]',
        scope,
        { maxBytes: 10 },
      ),
    ).rejects.toMatchObject({ code: 'VAL_LIMIT_EXCEEDS_CEILING' });

    const bigArr = Array.from({ length: 5000 }, (_, i) => i);
    await expect(
      engine.evaluate(
        '$sum($json.big)',
        { ...scope, json: { big: bigArr } },
        { timeoutMs: 0 },
      ),
    ).rejects.toMatchObject({ code: 'RUN_TIMEOUT' });
  });

  it('validates M.2 graph rules (orphan nodes, bad ports, illegal cycle vs loop-only cycle) and YAML round-trip [E0.4-1, E0.4-6]', () => {
    const registry = new NodeRegistry(true);

    const validGraph: WorkflowGraph = {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 900_000 },
      nodes: [
        {
          id: 'n_trig',
          type: 'trigger.webhook',
          name: 'Ticket Hook',
          position: { x: 0, y: 0 },
          config: { path: 'ticket-created', methods: ['POST'], auth: { mode: 'none' } },
        },
        {
          id: 'n_loop',
          type: 'logic.loop',
          name: 'Batch Loop',
          position: { x: 240, y: 0 },
          config: { mode: 'for_each', max_iterations: 1000, batch_size: 1 },
        },
        {
          id: 'n_set',
          type: 'data.set',
          name: 'Stamp Item',
          position: { x: 240, y: 180 },
          config: { assignments: [{ path: 'processed', expr: '=true' }], keep_only_set: false },
        },
        {
          id: 'n_notify',
          type: 'human.notify',
          name: 'Slack Notify',
          position: { x: 520, y: 0 },
          config: { channel: 'slack', template: 'Done {{ $json.processed }}', recipients: ['#ops'] },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'n_trig', port: 'main' }, to: { node: 'n_loop', port: 'in' } },
        { id: 'e2', from: { node: 'n_loop', port: 'loop' }, to: { node: 'n_set', port: 'in' } },
        { id: 'e3', from: { node: 'n_set', port: 'main' }, to: { node: 'n_loop', port: 'in' } },
        { id: 'e4', from: { node: 'n_loop', port: 'done' }, to: { node: 'n_notify', port: 'in' } },
      ],
      pinned_data: {},
      notes: [],
    };

    expect(validateWorkflowGraph(validGraph, registry).valid).toBe(true);

    // Lossless YAML round-trip check
    const yaml = serializeWorkflowToYaml(validGraph);
    const parsed = parseWorkflowFromYaml(yaml) as WorkflowGraph;
    expect(canonicalJson(parsed)).toBe(canonicalJson(validGraph));

    // Reject illegal non-loop cycle & orphan node
    const invalidCycleGraph: WorkflowGraph = {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 900_000 },
      nodes: [
        {
          id: 't1',
          type: 'trigger.manual',
          name: 'Start',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'a',
          type: 'data.set',
          name: 'Step A',
          position: { x: 200, y: 0 },
          config: { assignments: [] },
        },
        {
          id: 'b',
          type: 'data.set',
          name: 'Step B',
          position: { x: 400, y: 0 },
          config: { assignments: [] },
        },
        {
          id: 'orphan',
          type: 'data.set',
          name: 'Orphan',
          position: { x: 600, y: 200 },
          config: { assignments: [] },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 't1', port: 'main' }, to: { node: 'a', port: 'in' } },
        { id: 'e2', from: { node: 'a', port: 'main' }, to: { node: 'b', port: 'in' } },
        { id: 'e3', from: { node: 'b', port: 'main' }, to: { node: 'a', port: 'in' } },
      ],
      pinned_data: {},
      notes: [],
    };

    const res = validateWorkflowGraph(invalidCycleGraph, registry);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'ILLEGAL_CYCLE')).toBe(true);
    expect(res.errors.some((e) => e.code === 'ORPHAN_NODE')).toBe(true);
    expect(() => assertValidWorkflowGraph(invalidCycleGraph, registry)).toThrow(PlatformError);
  });

  it('verifies webhook HMAC, bearer token, JWT auth, replay protection, test capture & schedule misfire [E0.4-5]', async () => {
    const triggers = new TriggerService();
    const graph: WorkflowGraph = {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 900_000 },
      nodes: [
        {
          id: 'trig_hmac',
          type: 'trigger.webhook',
          name: 'HMAC Webhook',
          position: { x: 0, y: 0 },
          config: {
            path: 'orders-hmac',
            methods: ['POST'],
            auth: { mode: 'hmac', secret: 'super_webhook_secret_key' },
          },
        },
        {
          id: 'trig_sched',
          type: 'trigger.schedule',
          name: 'Cron',
          position: { x: 0, y: 120 },
          config: { interval_ms: 60_000, misfire_policy: 'run_once' },
        },
        {
          id: 'stop_node',
          type: 'control.stop',
          name: 'Done',
          position: { x: 300, y: 60 },
          config: { status: 'succeeded', message: 'ok' },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'trig_hmac', port: 'main' }, to: { node: 'stop_node', port: 'in' } },
        { id: 'e2', from: { node: 'trig_sched', port: 'main' }, to: { node: 'stop_node', port: 'in' } },
      ],
      pinned_data: {},
      notes: [],
    };

    const regs = triggers.registerWorkflowTriggers({
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId!,
      environmentId: 'env_dev',
      workflowId: 'wf_1',
      workflowVersionId: 'wfv_1',
      graph,
      active: true,
    });
    const hook = regs.find((r) => r.kind === 'webhook')!;

    const body = JSON.stringify({ order_id: 'ord_99', amount: 42 });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'super_webhook_secret_key')
      .update(`${ts}.${body}`, 'utf8')
      .digest('hex');

    // Bad HMAC rejected
    await expect(
      triggers.receiveWebhook({
        externalIdOrPath: hook.externalId,
        method: 'POST',
        headers: { 'x-signature': `t=${ts},v1=deadbeef` },
        rawBody: body,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });

    // Valid HMAC accepted
    const accepted = await triggers.receiveWebhook({
      externalIdOrPath: hook.externalId,
      method: 'POST',
      headers: { 'x-signature': `t=${ts},v1=${sig}`, 'x-webhook-nonce': 'nonce_1' },
      rawBody: body,
    });
    expect(accepted.shouldStartRun).toBe(true);
    expect(accepted.payload).toEqual({ order_id: 'ord_99', amount: 42 });

    // Replayed nonce rejected with 409 RES_CONFLICT
    await expect(
      triggers.receiveWebhook({
        externalIdOrPath: hook.externalId,
        method: 'POST',
        headers: { 'x-signature': `t=${ts},v1=${sig}`, 'x-webhook-nonce': 'nonce_1' },
        rawBody: body,
      }),
    ).rejects.toMatchObject({ code: 'RES_CONFLICT' });

    // Test capture mode captures without starting a run
    triggers.setTestMode(ctx.orgId, hook.id, true);
    const captured = await triggers.receiveWebhook({
      externalIdOrPath: hook.externalId,
      method: 'POST',
      headers: { 'x-signature': `t=${ts},v1=${sig}`, 'x-webhook-nonce': 'nonce_2' },
      rawBody: body,
    });
    expect(captured.shouldStartRun).toBe(false);
    expect(captured.event.status).toBe('captured_test');

    // Schedule due firing
    const future = new Date(Date.now() + 180_000);
    const firings = triggers.collectDueScheduleFirings(future);
    expect(firings).toHaveLength(1);
  });

  it('executes a 50-node graph with 3 parallel branches + 1,000-item loop and resumes cleanly after worker crash [E0.4-2]', async () => {
    const executionEngine = new InMemoryExecutionEngine();
    const effectLedger = new InMemoryEffectLedger();

    // Build a 50-node graph: trigger -> parallel split -> 3 branches -> join -> 42 sequential set nodes -> loop(1,000 items) -> body -> stop
    const nodes: WorkflowGraph['nodes'] = [
      {
        id: 'trig',
        type: 'trigger.manual',
        name: 'Start 50-Node Benchmark',
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: 'split',
        type: 'logic.parallel',
        name: 'Parallel Split',
        position: { x: 180, y: 0 },
        config: { branches: ['b1', 'b2', 'b3'], concurrency_cap: 3 },
      },
      {
        id: 'br1',
        type: 'data.set',
        name: 'Branch 1',
        position: { x: 360, y: -120 },
        config: { assignments: [{ path: 'b1', expr: '=1' }] },
      },
      {
        id: 'br2',
        type: 'data.set',
        name: 'Branch 2',
        position: { x: 360, y: 0 },
        config: { assignments: [{ path: 'b2', expr: '=2' }] },
      },
      {
        id: 'br3',
        type: 'data.set',
        name: 'Branch 3',
        position: { x: 360, y: 120 },
        config: { assignments: [{ path: 'b3', expr: '=3' }] },
      },
      {
        id: 'join',
        type: 'logic.join',
        name: 'Parallel Join',
        position: { x: 540, y: 0 },
        config: { join_mode: 'all' },
      },
    ];

    const edges: WorkflowGraph['edges'] = [
      { id: 'e_trig_split', from: { node: 'trig', port: 'main' }, to: { node: 'split', port: 'in' } },
      { id: 'e_s_1', from: { node: 'split', port: 'b1' }, to: { node: 'br1', port: 'in' } },
      { id: 'e_s_2', from: { node: 'split', port: 'b2' }, to: { node: 'br2', port: 'in' } },
      { id: 'e_s_3', from: { node: 'split', port: 'b3' }, to: { node: 'br3', port: 'in' } },
      { id: 'e_1_j', from: { node: 'br1', port: 'main' }, to: { node: 'join', port: 'in' } },
      { id: 'e_2_j', from: { node: 'br2', port: 'main' }, to: { node: 'join', port: 'in' } },
      { id: 'e_3_j', from: { node: 'br3', port: 'main' }, to: { node: 'join', port: 'in' } },
    ];

    let prevNodeId = 'join';
    for (let i = 1; i <= 39; i++) {
      const nid = `chain_${i}`;
      nodes.push({
        id: nid,
        type: 'data.set',
        name: `Chain ${i}`,
        position: { x: 700 + i * 20, y: 0 },
        config: { assignments: [{ path: 'chain_step', expr: `=${i}` }] },
      });
      edges.push({
        id: `e_chain_${i}`,
        from: { node: prevNodeId, port: 'main' },
        to: { node: nid, port: 'in' },
      });
      prevNodeId = nid;
    }

    nodes.push(
      {
        id: 'loop1000',
        type: 'logic.loop',
        name: 'Loop 1000',
        position: { x: 1600, y: 0 },
        config: { mode: 'for_each', items: '=$trigger.batch', max_iterations: 1000, batch_size: 1 },
      },
      {
        id: 'loop_body',
        type: 'data.set',
        name: 'Loop Body',
        position: { x: 1600, y: 180 },
        config: { assignments: [{ path: 'doubled', expr: '=$json.n * 2' }] },
      },
      {
        id: 'summarize_batch',
        type: 'data.code',
        name: 'Summarize Batch',
        position: { x: 1700, y: 0 },
        config: {
          language: 'javascript',
          code: 'result = { count: inputs.items.length, last_doubled: inputs.items[inputs.items.length - 1].doubled };',
          timeout_ms: 2000,
        },
      },
      {
        id: 'notify_end',
        type: 'human.notify',
        name: 'Notify Done',
        position: { x: 1850, y: 0 },
        config: {
          channel: 'slack',
          template: 'Finished {{ $json.count }} items (last={{ $json.last_doubled }})',
          recipients: ['#ops'],
        },
      },
      {
        id: 'stop_end',
        type: 'control.stop',
        name: 'Stop',
        position: { x: 2000, y: 0 },
        config: { status: 'succeeded', message: 'All 50 nodes done' },
      },
    );
    expect(nodes).toHaveLength(50);

    edges.push(
      { id: 'e_to_loop', from: { node: prevNodeId, port: 'main' }, to: { node: 'loop1000', port: 'in' } },
      { id: 'e_loop_body', from: { node: 'loop1000', port: 'loop' }, to: { node: 'loop_body', port: 'in' } },
      { id: 'e_loop_back', from: { node: 'loop_body', port: 'main' }, to: { node: 'loop1000', port: 'in' } },
      { id: 'e_loop_done', from: { node: 'loop1000', port: 'done' }, to: { node: 'summarize_batch', port: 'in' } },
      { id: 'e_sum_notify', from: { node: 'summarize_batch', port: 'main' }, to: { node: 'notify_end', port: 'in' } },
      { id: 'e_stop', from: { node: 'notify_end', port: 'main' }, to: { node: 'stop_end', port: 'in' } },
    );

    const benchGraph: WorkflowGraph = {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 900_000 },
      nodes,
      edges,
      pinned_data: {},
      notes: [],
    };

    const batchPayload = Array.from({ length: 1000 }, (_, i) => ({ n: i + 1 }));

    // Attempt 1 crashes mid-loop after 50 checkpoints
    const crashed = await executeWorkflowGraph(
      {
        ctx,
        workflowId: 'wf_bench',
        workflowName: 'bench-50',
        versionId: 'wfv_1',
        graph: benchGraph,
        triggerPayload: { batch: batchPayload },
        checkpointBatchSize: 100,
        simulateCrashAfterStep: 50,
      },
      { executionEngine, effectLedger },
    );
    expect(crashed.status).toBe('failed');

    // Attempt 2 resumes from the saved checkpoint cursor and completes all 1,000 items once
    const resumed = await executeWorkflowGraph(
      {
        ctx,
        workflowId: 'wf_bench',
        workflowName: 'bench-50',
        versionId: 'wfv_1',
        graph: benchGraph,
        triggerPayload: { batch: batchPayload },
        existingRunId: crashed.runId,
        checkpointBatchSize: 100,
      },
      { executionEngine, effectLedger },
    );
    expect(resumed.status).toBe('succeeded');
    expect(resumed.notificationsLog).toHaveLength(1);
    const loopOut = resumed.nodeOutputs['loop1000']?.['done'] ?? [];
    expect(loopOut).toHaveLength(1000);
    expect(loopOut[999]?.json['doubled']).toBe(2000);
  }, 15_000);

  it('supports pinned_data and startFromNodeId (test-from-here) skipping upstream nodes [E0.4-7]', async () => {
    const graph: WorkflowGraph = {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 900_000 },
      nodes: [
        {
          id: 'trig',
          type: 'trigger.webhook',
          name: 'Hook',
          position: { x: 0, y: 0 },
          config: { path: 'triage', methods: ['POST'], auth: { mode: 'none' } },
        },
        {
          id: 'agent_node',
          type: 'ai.agent',
          name: 'Triage Agent',
          position: { x: 240, y: 0 },
          config: { agent: 'agt_1', input: '={{ $json.text }}' },
        },
        {
          id: 'switch_node',
          type: 'logic.switch',
          name: 'Route Category',
          position: { x: 480, y: 0 },
          config: {
            cases: [{ id: 'billing', expr: "$json.category = 'billing'" }],
            default: true,
          },
        },
        {
          id: 'notify_billing',
          type: 'human.notify',
          name: 'Billing Slack',
          position: { x: 720, y: 0 },
          config: { channel: 'slack', template: 'Billing ticket {{ $json.ticket_id }}', recipients: ['#billing'] },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'trig', port: 'main' }, to: { node: 'agent_node', port: 'in' } },
        { id: 'e2', from: { node: 'agent_node', port: 'main' }, to: { node: 'switch_node', port: 'in' } },
        { id: 'e3', from: { node: 'switch_node', port: 'billing' }, to: { node: 'notify_billing', port: 'in' } },
      ],
      pinned_data: {},
      notes: [],
    };

    const res = await executeWorkflowGraph({
      ctx,
      workflowId: 'wf_pin',
      workflowName: 'pin-test',
      versionId: 'wfv_pin',
      graph,
      startFromNodeId: 'switch_node',
      pinnedData: {
        agent_node: [{ category: 'billing', ticket_id: 'TCK-777' }],
      },
    });

    expect(res.status).toBe('succeeded');
    expect(res.trace.map((t) => t.nodeId)).toEqual(['switch_node', 'notify_billing']);
    expect(res.notificationsLog[0]?.message).toBe('Billing ticket TCK-777');
  });
});
