import { z } from 'zod';
import { PlatformError } from '@elshad/domain';

const optionalNonEmpty = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

export const PlatformConfigSchema = z.object({
  PLATFORM_BASE_URL: z.string().url('PLATFORM_BASE_URL must be a valid URL'),
  PLATFORM_DB_URL: z.string().min(1, 'PLATFORM_DB_URL is required'),
  PLATFORM_DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(40),
  PLATFORM_REDIS_URL: z.string().min(1, 'PLATFORM_REDIS_URL is required'),
  PLATFORM_NATS_URL: z.string().min(1, 'PLATFORM_NATS_URL is required'),
  PLATFORM_OBJECT_STORE_URL: z.string().url('PLATFORM_OBJECT_STORE_URL must be a valid URL'),
  PLATFORM_OBJECT_STORE_BUCKET: z.string().min(1, 'PLATFORM_OBJECT_STORE_BUCKET is required'),
  PLATFORM_OBJECT_STORE_ACCESS_KEY: z.string().min(1).optional(),
  PLATFORM_OBJECT_STORE_SECRET_KEY: z.string().min(1).optional(),
  PLATFORM_OBJECT_STORE_REGION: z.string().min(1).default('us-east-1'),
  PLATFORM_MASTER_KEY: z
    .string()
    .min(32, 'PLATFORM_MASTER_KEY must be at least 32 characters (hex or base64 key material)'),
  PLATFORM_SECRETS_PROVIDER: z.enum(['db', 'vault', 'aws', 'gcp', 'azure']).default('db'),
  PLATFORM_OIDC_ISSUER: optionalNonEmpty,
  PLATFORM_OIDC_CLIENT_ID: optionalNonEmpty,
  PLATFORM_OIDC_CLIENT_SECRET: optionalNonEmpty,
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).optional(),
  PLATFORM_EDITION: z.enum(['community', 'enterprise']).default('community'),
  PLATFORM_LICENSE_KEY: optionalNonEmpty,
  PLATFORM_OTLP_ENDPOINT: optionalNonEmpty,
  PLATFORM_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PLATFORM_SANDBOX_MODE: z.enum(['gvisor', 'docker', 'disabled']).default('docker'),
  PLATFORM_EGRESS_PROXY_URL: optionalNonEmpty,
  PLATFORM_SMTP_URL: optionalNonEmpty,
  PLATFORM_WORKER_QUEUES: z
    .string()
    .default('default')
    .transform((s) =>
      s
        .split(',')
        .map((q) => q.trim())
        .filter(Boolean),
    ),
  PLATFORM_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(128).default(8),
  PLATFORM_FEATURE_FLAGS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  PLATFORM_TELEMETRY_OPTOUT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PLATFORM_API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PLATFORM_ENGINE_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  PLATFORM_API_KEY_PEPPER: z.string().min(16).default('dev-local-pepper-change-in-prod'),
  PLATFORM_CORS_ORIGIN: z.string().default('http://localhost:3000'),
  PLATFORM_LOCAL_AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): PlatformConfig {
  const parsed = PlatformConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new PlatformError('VAL_SCHEMA_MISMATCH', `Invalid platform configuration: ${issues}`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if (parsed.data.PLATFORM_EDITION === 'enterprise' && !parsed.data.PLATFORM_LICENSE_KEY) {
    throw new PlatformError(
      'VAL_SCHEMA_MISMATCH',
      'PLATFORM_LICENSE_KEY is required when PLATFORM_EDITION=enterprise',
      { path: 'PLATFORM_LICENSE_KEY' },
    );
  }

  return parsed.data;
}

export function createTestConfig(
  overrides: Record<string, string | undefined> = {},
): PlatformConfig {
  return loadConfig({
    PLATFORM_BASE_URL: 'http://localhost:3000',
    PLATFORM_DB_URL: 'postgres://platform_app:platform@localhost:5432/platform',
    PLATFORM_REDIS_URL: 'redis://localhost:6379',
    PLATFORM_NATS_URL: 'nats://localhost:4222',
    PLATFORM_OBJECT_STORE_URL: 'http://localhost:9000',
    PLATFORM_OBJECT_STORE_BUCKET: 'platform-artifacts',
    PLATFORM_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    PLATFORM_ADMIN_EMAIL: 'admin@elshad.local',
    PLATFORM_ADMIN_PASSWORD: 'ChangeMe123!',
    ...overrides,
  });
}
