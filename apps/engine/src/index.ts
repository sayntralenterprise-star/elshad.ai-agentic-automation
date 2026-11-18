import Fastify, { type FastifyInstance } from 'fastify';
import type { PlatformConfig } from '@elshad/config';
import { createLogger, type PlatformLogger } from '@elshad/telemetry';

export interface EngineAppOptions {
  config: PlatformConfig;
  logger?: PlatformLogger;
  checkDependencies?: () => Promise<Record<string, 'ok' | 'error'>>;
}

export function buildEngineServer(opts: EngineAppOptions): FastifyInstance {
  const logger =
    opts.logger ?? createLogger({ service: 'engine', level: opts.config.PLATFORM_LOG_LEVEL });
  const app = Fastify({ logger: false });

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
  });

  app.addHook('onClose', async () => {
    logger.info('engine server shutting down');
  });

  return app;
}
