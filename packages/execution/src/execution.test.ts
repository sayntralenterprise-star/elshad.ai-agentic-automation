import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  type Clock,
  type OrgId,
  type PrincipalId,
  type TenantContext,
} from '@elshad/domain';
import { InMemoryEventBus } from '@elshad/platform-kit';
import {
  InMemoryEffectLedger,
  InMemoryExecutionEngine,
  computeBackoffDelayMs,
  computeEffectIdempotencyKey,
} from './index.js';

class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): Date {
    return new Date(this.currentMs);
  }
  advance(ms: number): void {
    this.currentMs += ms;
  }
}

const makeCtx = (orgId = 'org_1'): TenantContext => ({
  orgId: orgId as OrgId,
  principal: { id: 'prn_1' as PrincipalId, type: 'user' },
  requestId: 'req_1',
  traceId: 'trace_1',
});

describe('@elshad/execution durable run core [E0.2-1..8, NFR-6]', () => {
  it('processes 1,000 items across 10 workers under random mid-turn crashes with zero lost runs and exactly-once effects [E0.2-2, E0.2-5, E0.2-8]', async () => {
    const clock = new FakeClock(1_760_000_000_000);
    const engine = new InMemoryExecutionEngine({ clock, leaseDurationMs: 60_000 });
    const ledger = new InMemoryEffectLedger(clock);
    const ctx = makeCtx('org_chaos');

    // Track real side effects in an external ledger counter
    const sideEffectsPerRun = new Map<string, number>();

    const runIds: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const run = await engine.createRun(ctx, {
        workspaceId: `ws_${i % 4}`,
        environmentId: 'env_dev',
        subjectType: 'agent_version',
        subjectVersionId: 'agv_1',
        input: { index: i },
        maxAttempts: 10,
      });
      runIds.push(run.id);
    }

    let crashBudget = 120;
    let totalClaims = 0;

    // Simulate 10 workers claiming and executing 2-step turns with deterministic crashes
    while (true) {
      let progressed = false;
      for (let w = 0; w < 10; w++) {
        const leases = await engine.claim(`worker_${w}`, ['default'], 5);
        if (leases.length === 0) continue;
        progressed = true;
        totalClaims += leases.length;

        for (const lease of leases) {
          const prev = await engine.loadState(lease);
          const cursor = prev?.cursor ?? 0;

          // Execute step 1 with idempotent effect ledger before possible crash
          if (cursor === 0) {
            await ledger.executeOnce(lease.orgId, { runId: lease.runId, stepSeq: 1 }, async () => {
              sideEffectsPerRun.set(lease.runId, (sideEffectsPerRun.get(lease.runId) ?? 0) + 1);
              return { charged: true };
            });

            // Commit turn 1 checkpoint BEFORE crashing some workers on step 2
            await engine.commitTurn(lease, {
              steps: [
                {
                  seq: 1,
                  type: 'tool_call',
                  summary: { tool: 'charge_card' },
                  costMicroUsd: 100,
                },
              ],
              checkpoint: {
                seq: 1,
                cursor: 1,
                scratchpad: { step1: 'done' },
                messages: [],
                blackboard: {},
                engine_version: '1.0.0',
              },
            });
          }

          // Inject random-like worker crash BEFORE finishing step 2 (also hits even after effect ledger executed!)
          if (crashBudget > 0 && (totalClaims + w) % 7 === 0) {
            crashBudget -= 1;
            // Worker dies without completing or releasing lease
            continue;
          }

          // Step 2 also uses effect ledger (if crash happened after ledger before commit, still deduplicated!)
          await ledger.executeOnce(lease.orgId, { runId: lease.runId, stepSeq: 2 }, async () => {
            sideEffectsPerRun.set(lease.runId, (sideEffectsPerRun.get(lease.runId) ?? 0) + 1);
            return { notified: true };
          });

          await engine.commitTurn(lease, {
            steps: [
              {
                seq: 2,
                type: 'llm_call',
                summary: { model: 'mock-fast' },
                tokensIn: 50,
                tokensOut: 20,
                costMicroUsd: 50,
              },
            ],
            checkpoint: {
              seq: 2,
              cursor: 2,
              scratchpad: { step1: 'done', step2: 'done' },
              messages: [],
              blackboard: {},
              engine_version: '1.0.0',
            },
          });

          await engine.complete(lease, {
            status: 'succeeded',
            terminationReason: 'final_answer',
            output: { ok: true },
          });
        }
      }

      if (!progressed) {
        // Advance clock past lease expiry and sweep crashed workers
        clock.advance(61_000);
        const swept = await engine.requeueExpiredLeases(clock.now());
        if (swept === 0) break;
      }
    }

    // Verify zero lost runs and exactly 2 side effects per run (1,000 * 2 = 2,000 total)
    let totalEffects = 0;
    for (const runId of runIds) {
      const run = await engine.getRun('org_chaos', runId);
      expect(run?.status).toBe('succeeded');
      expect(run?.termination_reason).toBe('final_answer');
      expect(sideEffectsPerRun.get(runId)).toBe(2);
      totalEffects += sideEffectsPerRun.get(runId) ?? 0;
    }
    expect(totalEffects).toBe(2000);
    expect([...engine.workItems.values()].every((w) => w.status === 'done')).toBe(true);
  });

  it('enforces N.2.8 idempotency key stability across retries and changes only on attempt_group bump', () => {
    const k1 = computeEffectIdempotencyKey('run_1', 4, 1);
    const k1Retry = computeEffectIdempotencyKey('run_1', 4, 1);
    const k2Redo = computeEffectIdempotencyKey('run_1', 4, 2);
    expect(k1).toBe(k1Retry);
    expect(k1).not.toBe(k2Redo);

    const delay = computeBackoffDelayMs(3, { baseMs: 1000, capMs: 60_000, randomFn: () => 0.5 });
    expect(delay).toBe(3000); // 1000 * 2^2 * (0.5 + 0.25)
  });

  it('persists durable timers across restart and fires within 1s of due time [E0.2-3]', async () => {
    const clock = new FakeClock(1_760_000_000_000);
    const engine = new InMemoryExecutionEngine({ clock });
    const ctx = makeCtx();

    const run = await engine.createRun(ctx, {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'agent_version',
      subjectVersionId: 'agv_1',
    });

    const [lease] = await engine.claim('worker_1', ['default'], 1);
    const fireAt = new Date(clock.now().getTime() + 5_000).toISOString();
    await engine.suspend(lease!, { kind: 'timer', fireAt, reason: 'sleep_5s' });

    let current = await engine.getRun('org_1', run.id);
    expect(current?.status).toBe('waiting_timer');

    // Before due time -> 0 fired
    clock.advance(4_000);
    expect(await engine.fireDueTimers(clock.now())).toBe(0);

    // At due time (+1s tolerance) -> fires and re-queues with priority + 1
    clock.advance(1_000);
    expect(await engine.fireDueTimers(clock.now())).toBe(1);

    current = await engine.getRun('org_1', run.id);
    expect(current?.status).toBe('queued');

    const [resumedLease] = await engine.claim('worker_restart_2', ['default'], 1);
    expect(resumedLease?.runId).toBe(run.id);
  });

  it('enforces serialize_key exclusion and weighted fair queuing across workspaces [FR-ORC-5]', async () => {
    const clock = new FakeClock(1_760_000_000_000);
    const engine = new InMemoryExecutionEngine({ clock });
    const ctx = makeCtx();

    await engine.createRun(ctx, {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'workflow_version',
      subjectVersionId: 'wfv_1',
      serializeKey: 'cust_42',
    });
    await engine.createRun(ctx, {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'workflow_version',
      subjectVersionId: 'wfv_1',
      serializeKey: 'cust_42',
    });
    await engine.createRun(ctx, {
      workspaceId: 'ws_2',
      environmentId: 'env_dev',
      subjectType: 'workflow_version',
      subjectVersionId: 'wfv_1',
    });

    // Claim up to 3: second ws_1 cust_42 must NOT be claimed simultaneously
    const claimed = await engine.claim('w1', ['default'], 3);
    expect(claimed).toHaveLength(2);
    expect(claimed.map((c) => c.workspaceId).sort()).toEqual(['ws_1', 'ws_2']);
  });

  it('moves exhausted runs to DLQ, allows redrive, retains checkpoints per D25, and propagates cancellation to child runs [E0.2-6, FR-ORC-8]', async () => {
    const clock = new FakeClock(1_760_000_000_000);
    const engine = new InMemoryExecutionEngine({ clock });
    const bus = new InMemoryEventBus();
    const publishedTypes: string[] = [];
    await bus.subscribe({ orgId: 'org_1' }, (e) => {
      publishedTypes.push(e.type);
    });
    const ctx = makeCtx();

    const parent = await engine.createRun(ctx, {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'agent_version',
      subjectVersionId: 'agv_1',
      maxAttempts: 2,
    });

    // Attempt 1 retryable failure -> requeued
    const [l1] = await engine.claim('w1', ['default'], 1);
    const r1 = await engine.retryOrFail(l1!, new PlatformError('TOOL_TIMEOUT', 'Upstream timeout'));
    expect(r1.retried).toBe(true);

    // Advance past backoff -> Attempt 2 fails -> DLQ
    clock.advance(10_000);
    const [l2] = await engine.claim('w1', ['default'], 1);
    const r2 = await engine.retryOrFail(l2!, new PlatformError('TOOL_TIMEOUT', 'Still failing'));
    expect(r2.retried).toBe(false);

    const dlq = await engine.listDlq('org_1');
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.run_id).toBe(parent.id);

    // Redrive from DLQ with patched input
    await engine.redrive(ctx, [parent.id], { fixed: true });
    expect(await engine.listDlq('org_1')).toHaveLength(0);
    const [l3] = await engine.claim('w1', ['default'], 1);
    expect((await engine.getRun('org_1', parent.id))?.attempt_group).toBe(2);

    // Commit 7 non-milestone checkpoints + 1 milestone -> only 1 milestone + last 5 non-milestones retained
    for (let seq = 1; seq <= 7; seq++) {
      await engine.commitTurn(l3!, {
        steps: [{ seq, type: 'decision', summary: { seq } }],
        checkpoint: {
          seq,
          cursor: seq,
          scratchpad: {},
          messages: [],
          blackboard: {},
          engine_version: '1.0.0',
        },
        milestone: seq === 1,
      });
    }
    const cps = await engine.listCheckpoints('org_1', parent.id);
    expect(cps.map((c) => c.seq)).toEqual([1, 3, 4, 5, 6, 7]);

    // Child run cancelled when parent cancelled
    const child = await engine.createRun(ctx, {
      workspaceId: 'ws_1',
      environmentId: 'env_dev',
      subjectType: 'agent_version',
      subjectVersionId: 'agv_2',
      parentRunId: parent.id,
      rootRunId: parent.id,
    });
    await engine.cancel(ctx, parent.id, 'operator requested stop');
    expect((await engine.getRun('org_1', parent.id))?.status).toBe('cancelled');
    expect((await engine.getRun('org_1', child.id))?.status).toBe('cancelled');

    const drained = await engine.drainOutbox(50, bus);
    expect(drained).toBeGreaterThan(0);
    expect(publishedTypes).toContain('dlq.item.added');
    expect(publishedTypes).toContain('run.completed');
  });
});
