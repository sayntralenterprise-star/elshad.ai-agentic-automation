import { describe, expect, it } from 'vitest';
import { createTestConfig } from '@elshad/config';
import { buildEngineServer } from './index.js';

describe('@elshad/engine lifecycle [E0.1-2]', () => {
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
});
