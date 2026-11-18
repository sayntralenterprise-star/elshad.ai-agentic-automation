import type { PlatformConfig } from '@elshad/config';
import { PlatformError } from '@elshad/domain';
import type {
  CheckpointState,
  EffectLedger,
  ExecutionEngine,
  Lease,
  TurnStepInput,
} from '@elshad/execution';
import { createLogger, type PlatformLogger } from '@elshad/telemetry';

export interface WorkerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  pollOnce(): Promise<number>;
}

export interface SimulatedStepSpec {
  type?: TurnStepInput['type'];
  summary?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  tokens_in?: number;
  tokens_out?: number;
  cost_micro_usd?: number;
  latency_ms?: number;
  fail_code?: 'TOOL_TIMEOUT' | 'TOOL_UPSTREAM_REJECTED';
}

export interface CreateWorkerRuntimeOptions {
  engine?: ExecutionEngine;
  ledger?: EffectLedger;
  workerId?: string;
  pollIntervalMs?: number;
  turnHandler?: (lease: Lease, state: CheckpointState | null) => Promise<void>;
}

async function executeDefaultTurn(
  engine: ExecutionEngine,
  lease: Lease,
  state: CheckpointState | null,
  ledger?: EffectLedger,
): Promise<void> {
  const specsRaw = lease.payload.simulated_steps;
  const specs: SimulatedStepSpec[] = Array.isArray(specsRaw)
    ? (specsRaw as SimulatedStepSpec[])
    : [{ type: 'decision', summary: { message: 'Durable baseline turn completed' } }];

  const startCursor = state?.cursor ?? 0;

  for (let i = startCursor; i < specs.length; i++) {
    const alive = await engine.heartbeat(lease);
    if (!alive) return;

    const spec = specs[i]!;
    const stepSeq = i + 1;

    if (spec.fail_code) {
      throw new PlatformError(
        spec.fail_code,
        `Simulated failure ${spec.fail_code} at step ${stepSeq}`,
      );
    }

    const executeStep = async () => ({
      output: spec.output ?? { step: stepSeq, ok: true },
    });

    const stepResult = ledger
      ? (await ledger.executeOnce(lease.orgId, { runId: lease.runId, stepSeq }, executeStep)).result
      : await executeStep();

    await engine.commitTurn(lease, {
      steps: [
        {
          seq: stepSeq,
          type: spec.type ?? 'decision',
          summary: spec.summary ?? { step: stepSeq },
          input: spec.input,
          output: stepResult.output,
          tokensIn: spec.tokens_in ?? 0,
          tokensOut: spec.tokens_out ?? 0,
          costMicroUsd: spec.cost_micro_usd ?? 0,
          latencyMs: spec.latency_ms ?? 5,
        },
      ],
      checkpoint: {
        seq: stepSeq,
        cursor: i + 1,
        scratchpad: { ...(state?.scratchpad ?? {}), [`step_${stepSeq}`]: 'done' },
        messages: state?.messages ?? [],
        blackboard: state?.blackboard ?? {},
        engine_version: '1.0.0',
      },
      milestone: i === specs.length - 1,
    });
  }

  await engine.complete(lease, {
    status: 'succeeded',
    terminationReason: 'final_answer',
    output: { completed_steps: specs.length },
  });
}

export function createWorkerRuntime(
  config: PlatformConfig,
  logger: PlatformLogger = createLogger({ service: 'worker', level: config.PLATFORM_LOG_LEVEL }),
  opts: CreateWorkerRuntimeOptions = {},
): WorkerRuntime {
  let running = false;
  let pollTimer: NodeJS.Timeout | null = null;
  const workerId = opts.workerId ?? `worker_${process.pid}`;

  async function pollOnce(): Promise<number> {
    if (!opts.engine) return 0;
    const leases = await opts.engine.claim(
      workerId,
      config.PLATFORM_WORKER_QUEUES,
      config.PLATFORM_WORKER_CONCURRENCY,
    );

    for (const lease of leases) {
      try {
        const state = await opts.engine.loadState(lease);
        if (opts.turnHandler) {
          await opts.turnHandler(lease, state);
        } else {
          await executeDefaultTurn(opts.engine, lease, state, opts.ledger);
        }
      } catch (err) {
        const pe =
          err instanceof PlatformError
            ? err
            : new PlatformError('SYS_INTERNAL', err instanceof Error ? err.message : String(err));
        await opts.engine.retryOrFail(lease, pe);
      }
    }

    return leases.length;
  }

  return {
    async start(): Promise<void> {
      if (running) return;
      running = true;
      logger.info('worker started', {
        worker_id: workerId,
        queues: config.PLATFORM_WORKER_QUEUES,
        concurrency: config.PLATFORM_WORKER_CONCURRENCY,
      });
      const interval = opts.pollIntervalMs ?? 250;
      pollTimer = setInterval(() => {
        void pollOnce().catch((err) => {
          logger.error('worker poll failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, interval);
      pollTimer.unref();
    },

    async stop(): Promise<void> {
      if (!running) return;
      running = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      logger.info('worker stopped cleanly');
    },

    isRunning(): boolean {
      return running;
    },

    pollOnce,
  };
}
