import { loadConfig } from '@elshad/config';
import { createLogger } from '@elshad/telemetry';
import { buildApiServer } from './index.js';
import { createDbHealthChecker } from './store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: 'api', level: config.PLATFORM_LOG_LEVEL });
  const dbHealth = createDbHealthChecker(config.PLATFORM_DB_URL);

  const { app } = buildApiServer({
    config,
    logger,
    checkDependencies: async () => ({
      postgres: (await dbHealth.check()) ? 'ok' : 'error',
    }),
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, closing api server`);
    await app.close();
    await dbHealth.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PLATFORM_API_PORT, host: '0.0.0.0' });
  logger.info('api server listening', { port: config.PLATFORM_API_PORT });
}

void main();
