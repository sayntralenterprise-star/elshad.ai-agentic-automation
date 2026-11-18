import { describe, expect, it } from 'vitest';
import { createTestConfig } from '@elshad/config';
import { createWorkerRuntime } from './index.js';

describe('@elshad/worker lifecycle [E0.1-2]', () => {
  it('starts and stops cleanly', async () => {
    const worker = createWorkerRuntime(createTestConfig());
    expect(worker.isRunning()).toBe(false);
    await worker.start();
    expect(worker.isRunning()).toBe(true);
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });
});
