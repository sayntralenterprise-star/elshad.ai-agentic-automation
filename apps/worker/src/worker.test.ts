import { describe, expect, it } from 'vitest';
import { createTestConfig } from '@elshad/config';
import type { OrgId, PrincipalId, TenantContext } from '@elshad/domain';
import { InMemoryEffectLedger, InMemoryExecutionEngine } from '@elshad/execution';
import { createLogger } from '@elshad/telemetry';
import { createWorkerRuntime } from './index.js';

const makeCtx = (): TenantContext => ({
  orgId: 'org_1' as OrgId,
  principal: { id: 'prn_1' as PrincipalId, type: 'user' },
  requestId: 'req_1',
  traceId: 'trace_1',
});

describe('@elshad/worker lifecycle and durable execution [E0.1-2, E0.2-2]', () => {
  it('starts and stops cleanly', async () => {
    const worker = createWorkerRuntime(createTestConfig());
    expect(worker.isRunning()).toBe(false);
    await worker.start();
    expect(worker.isRunning()).toBe(true);
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it('claims queued runs, commits steps/checkpoints, and completes runs', async () => {
    const config = createTestConfig();
    const engine = new InMemoryExecutionEngine();
    const ledger = new InMemoryEffectLedger();
    const worker = createWorkerRuntime(
      config,
      createLogger({ service: 'worker', level: 'error' }),
      { engine, ledger, workerId: 'worker_test' },
    );

    const run = await engine.createRun(makeCtx(), {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'agent_version',
      subjectVersionId: 'agv_1',
      payload: {
        simulated_steps: [
          { type: 'decision', summary: { note: 'step 1' }, cost_micro_usd: 150 },
          { type: 'tool_call', summary: { tool: 'echo' }, cost_micro_usd: 250 },
        ],
      },
    });

    const processed = await worker.pollOnce();
    expect(processed).toBe(1);

    const updated = await engine.getRun('org_1', run.id);
    expect(updated?.status).toBe('succeeded');
    expect(updated?.cost_micro_usd).toBe(400);
    const steps = await engine.listSteps('org_1', run.id);
    expect(steps).toHaveLength(2);
  });
});
