import Fastify, { type FastifyInstance } from 'fastify';
import type { PlatformConfig } from '@elshad/config';
import type { ExecutionEngine } from '@elshad/execution';
import type { EventBus } from '@elshad/platform-kit';
import { createLogger, type PlatformLogger } from '@elshad/telemetry';

export interface EngineTickResult {
  swept: number;
  fired: number;
  published: number;
}

export async function runEngineTick(
  engine: ExecutionEngine,
  eventBus?: EventBus,
  now: Date = new Date(),
): Promise<EngineTickResult> {
  const swept = await engine.requeueExpiredLeases(now);
  const fired = await engine.fireDueTimers(now, 100);
  const published = eventBus ? await engine.drainOutbox(100, eventBus) : 0;
  return { swept, fired, published };
}

export interface EngineAppOptions {
  config: PlatformConfig;
  logger?: PlatformLogger;
  engine?: ExecutionEngine;
  eventBus?: EventBus;
  tickIntervalMs?: number;
  checkDependencies?: () => Promise<Record<string, 'ok' | 'error'>>;
}

export function buildEngineServer(opts: EngineAppOptions): FastifyInstance {
  const logger =
    opts.logger ?? createLogger({ service: 'engine', level: opts.config.PLATFORM_LOG_LEVEL });
  const app = Fastify({ logger: false });
  let tickTimer: NodeJS.Timeout | null = null;

  app.get('/health', async () => {
    return { status: 'ok', service: 'engine' };
  });

  app.get('/ready', async (_req, reply) => {
    const checks = opts.checkDependencies
      ? await opts.checkDependencies()
      : { postgres: 'ok', nats: 'ok' };
    const allOk = Object.values(checks).every((v) => v === 'ok');
    if (!allOk) {
      return reply.status(503).send({ status: 'degraded', checks });
    }
    return { status: 'ready', checks };
  });

  app.addHook('onReady', async () => {
    logger.info('engine server ready', { port: opts.config.PLATFORM_ENGINE_PORT });
    if (opts.engine && opts.tickIntervalMs !== 0) {
      const interval = opts.tickIntervalMs ?? 500;
      tickTimer = setInterval(() => {
        void runEngineTick(opts.engine!, opts.eventBus).catch((err) => {
          logger.error('engine tick failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, interval);
      tickTimer.unref();
    }
  });

  app.addHook('onClose', async () => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    logger.info('engine server shutting down');
  });

  return app;
}
