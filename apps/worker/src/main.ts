import { loadConfig } from '@elshad/config';
import { createLogger } from '@elshad/telemetry';
import { createWorkerRuntime } from './index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: 'worker', level: config.PLATFORM_LOG_LEVEL });
  const worker = createWorkerRuntime(config, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, stopping worker`);
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await worker.start();
}

void main();
