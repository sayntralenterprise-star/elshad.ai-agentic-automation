import { describe, expect, it } from 'vitest';
import { createTestConfig } from '@elshad/config';
import { InMemoryExecutionEngine } from '@elshad/execution';
import { InMemoryEventBus } from '@elshad/platform-kit';
import type { Clock, OrgId, PrincipalId, TenantContext } from '@elshad/domain';
import { buildEngineServer, runEngineTick } from './index.js';

class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): Date {
    return new Date(this.currentMs);
  }
  advance(ms: number): void {
    this.currentMs += ms;
  }
}

const makeCtx = (): TenantContext => ({
  orgId: 'org_1' as OrgId,
  principal: { id: 'prn_1' as PrincipalId, type: 'user' },
  requestId: 'req_1',
  traceId: 'trace_1',
});

describe('@elshad/engine lifecycle and orchestrator ticks [E0.1-2, E0.2-2..3]', () => {
  it('responds healthy and reports dependency readiness', async () => {
    const app = buildEngineServer({ config: createTestConfig() });
    const h = await app.inject({ method: 'GET', url: '/health' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toEqual({ status: 'ok', service: 'engine' });

    const r = await app.inject({ method: 'GET', url: '/ready' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ready');

    await app.close();
  });

  it('sweeps expired leases, fires due timers, and drains outbox to EventBus', async () => {
    const clock = new FakeClock(1_760_000_000_000);
    const engine = new InMemoryExecutionEngine({ clock, leaseDurationMs: 10_000 });
    const bus = new InMemoryEventBus();
    const published: string[] = [];
    await bus.subscribe({ orgId: 'org_1' }, (e) => {
      published.push(e.type);
    });

    const run = await engine.createRun(makeCtx(), {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'agent_version',
      subjectVersionId: 'agv_1',
    });

    const [lease] = await engine.claim('w1', ['default'], 1);
    expect(lease?.runId).toBe(run.id);

    // Expire lease and run tick
    clock.advance(11_000);
    const tick1 = await runEngineTick(engine, bus, clock.now());
    expect(tick1.swept).toBe(1);
    expect(tick1.published).toBeGreaterThanOrEqual(2);
    expect(published).toContain('run.created');
    expect(published).toContain('run.started');

    // Re-claim, suspend on timer, advance, and verify timer tick fires
    const [lease2] = await engine.claim('w2', ['default'], 1);
    await engine.suspend(lease2!, {
      kind: 'timer',
      fireAt: new Date(clock.now().getTime() + 1_000).toISOString(),
    });
    clock.advance(1_000);
    const tick2 = await runEngineTick(engine, bus, clock.now());
    expect(tick2.fired).toBe(1);
    expect((await engine.getRun('org_1', run.id))?.status).toBe('queued');
  });
});
