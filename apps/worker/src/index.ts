import type { PlatformConfig } from '@elshad/config';
import { createLogger, type PlatformLogger } from '@elshad/telemetry';

export interface WorkerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export function createWorkerRuntime(
  config: PlatformConfig,
  logger: PlatformLogger = createLogger({ service: 'worker', level: config.PLATFORM_LOG_LEVEL }),
): WorkerRuntime {
  let running = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  return {
    async start(): Promise<void> {
      if (running) return;
      running = true;
      logger.info('worker skeleton started', {
        queues: config.PLATFORM_WORKER_QUEUES,
        concurrency: config.PLATFORM_WORKER_CONCURRENCY,
      });
      heartbeatTimer = setInterval(() => {
        logger.debug('worker heartbeat');
      }, 30_000);
      heartbeatTimer.unref();
    },

    async stop(): Promise<void> {
      if (!running) return;
      running = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      logger.info('worker stopped cleanly');
    },

    isRunning(): boolean {
      return running;
    },
  };
}
