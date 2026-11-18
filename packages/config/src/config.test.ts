import { describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import { createTestConfig, loadConfig } from './index.js';

describe('@elshad/config [A.7, O.4]', () => {
  it('fails fast with clear message when required environment variables are missing', () => {
    expect(() => loadConfig({})).toThrowError(PlatformError);
    try {
      loadConfig({ PLATFORM_BASE_URL: 'not-a-url' });
    } catch (err) {
      const pe = err as PlatformError;
      expect(pe.code).toBe('VAL_SCHEMA_MISMATCH');
      expect(pe.message).toContain('PLATFORM_BASE_URL');
      expect(pe.message).toContain('PLATFORM_DB_URL');
      expect(pe.message).toContain('PLATFORM_MASTER_KEY');
    }
  });

  it('parses valid defaults and comma-separated worker queues / flags', () => {
    const cfg = createTestConfig({
      PLATFORM_WORKER_QUEUES: 'critical, default, low',
      PLATFORM_FEATURE_FLAGS: 'ff.eval.enabled, ff.workflow.beta',
      PLATFORM_TELEMETRY_OPTOUT: 'true',
    });
    expect(cfg.PLATFORM_DB_POOL_MAX).toBe(40);
    expect(cfg.PLATFORM_EDITION).toBe('community');
    expect(cfg.PLATFORM_WORKER_QUEUES).toEqual(['critical', 'default', 'low']);
    expect(cfg.PLATFORM_FEATURE_FLAGS).toEqual(['ff.eval.enabled', 'ff.workflow.beta']);
    expect(cfg.PLATFORM_TELEMETRY_OPTOUT).toBe(true);
  });

  it('requires license key when enterprise edition is enabled', () => {
    expect(() =>
      createTestConfig({
        PLATFORM_EDITION: 'enterprise',
        PLATFORM_LICENSE_KEY: '',
      }),
    ).toThrow(/PLATFORM_LICENSE_KEY/);
  });
});
