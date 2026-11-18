import { loadConfig } from '@elshad/config';
import { createLogger } from '@elshad/telemetry';
import { buildEngineServer } from './index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: 'engine', level: config.PLATFORM_LOG_LEVEL });
  const app = buildEngineServer({ config, logger });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, closing engine`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PLATFORM_ENGINE_PORT, host: '0.0.0.0' });
}

void main();
