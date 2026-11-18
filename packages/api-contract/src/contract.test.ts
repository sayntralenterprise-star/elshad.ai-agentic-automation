import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@elshad/authz';
import { S01_ROUTES, generateOpenApiDocument } from './index.js';

describe('@elshad/api-contract [E0.1-5, E0.1-6]', () => {
  it('ensures every route explicitly declares access and valid permissions [NFR-10]', () => {
    expect(S01_ROUTES.length).toBeGreaterThanOrEqual(20);
    for (const route of S01_ROUTES) {
      expect(['public', 'authenticated', 'permission']).toContain(route.access.kind);
      if (route.access.kind === 'permission') {
        expect(PERMISSIONS).toContain(route.access.permission);
      }
      if (route.method === 'post' && route.scope !== 'none' && !route.path.includes('/auth/')) {
        expect(route.idempotent).toBe(true);
      }
    }
  });

  it('generates a valid OpenAPI 3.1 document containing all S0.1 paths', () => {
    const doc = generateOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.components?.schemas?.ErrorEnvelope).toBeDefined();
    for (const route of S01_ROUTES) {
      const pathEntry = doc.paths?.[route.path] as Record<string, unknown> | undefined;
      expect(pathEntry).toBeDefined();
      expect(pathEntry?.[route.method]).toBeDefined();
    }
  });
});
