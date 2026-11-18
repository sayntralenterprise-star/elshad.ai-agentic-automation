import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@elshad/domain': resolve(root, 'packages/domain/src/index.ts'),
      '@elshad/config': resolve(root, 'packages/config/src/index.ts'),
      '@elshad/telemetry': resolve(root, 'packages/telemetry/src/index.ts'),
      '@elshad/authz': resolve(root, 'packages/authz/src/index.ts'),
      '@elshad/platform-kit': resolve(root, 'packages/platform-kit/src/index.ts'),
      '@elshad/db': resolve(root, 'packages/db/src/index.ts'),
      '@elshad/execution': resolve(root, 'packages/execution/src/index.ts'),
      '@elshad/policy-kit': resolve(root, 'packages/policy-kit/src/index.ts'),
      '@elshad/model-kit': resolve(root, 'packages/model-kit/src/index.ts'),
      '@elshad/tool-kit': resolve(root, 'packages/tool-kit/src/index.ts'),
      '@elshad/runtime-core': resolve(root, 'packages/runtime-core/src/index.ts'),
      '@elshad/workflow-core': resolve(root, 'packages/workflow-core/src/index.ts'),
      '@elshad/api-contract': resolve(root, 'packages/api-contract/src/index.ts'),
      '@elshad/sdk-ts': resolve(root, 'packages/sdk-ts/src/index.ts'),
      '@elshad/ui-kit': resolve(root, 'packages/ui-kit/src/index.tsx'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'packages/domain/src/**/*.ts',
        'packages/config/src/**/*.ts',
        'packages/telemetry/src/**/*.ts',
        'packages/authz/src/**/*.ts',
        'packages/platform-kit/src/**/*.ts',
        'packages/db/src/**/*.ts',
        'packages/execution/src/**/*.ts',
        'packages/policy-kit/src/**/*.ts',
        'packages/model-kit/src/**/*.ts',
        'packages/tool-kit/src/**/*.ts',
        'packages/runtime-core/src/**/*.ts',
        'packages/workflow-core/src/**/*.ts',
        'packages/api-contract/src/**/*.ts',
        'packages/sdk-ts/src/**/*.ts',
        'apps/api/src/**/*.ts',
        'apps/engine/src/**/*.ts',
        'apps/worker/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/dist/**'],
    },
  },
});
