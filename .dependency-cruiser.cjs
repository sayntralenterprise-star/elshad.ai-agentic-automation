/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden across all modules.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'domain-imports-nothing-internal-or-io',
      severity: 'error',
      comment: 'packages/domain must remain pure: no internal package imports and no I/O.',
      from: {
        path: '^packages/domain/',
      },
      to: {
        path: [
          '^packages/(?!domain/)',
          '^apps/',
          'node_modules/(pg|kysely|ioredis|nats|fastify|@fastify|@aws-sdk)',
        ],
      },
    },
    {
      name: 'apps-never-import-apps',
      severity: 'error',
      comment: 'Apps must not import other apps.',
      from: {
        path: '^apps/([^/]+)/',
      },
      to: {
        path: '^apps/(?!$1/)',
      },
    },
    {
      name: 'console-only-frontend-packages',
      severity: 'error',
      comment: 'apps/console must never import backend-only packages.',
      from: {
        path: '^apps/console/',
      },
      to: {
        path: [
          '^packages/(db|execution|platform-kit|config|telemetry|authz|api-contract)/',
          'node_modules/(pg|kysely|ioredis|nats|fastify)',
        ],
      },
    },
    {
      name: 'no-cross-package-src-deep-imports',
      severity: 'error',
      comment: 'Import workspace packages via package entrypoints, never deep src paths.',
      from: {
        path: '^(apps|packages)/([^/]+)/',
      },
      to: {
        path: '^packages/(?!$2/)[^/]+/src/',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
