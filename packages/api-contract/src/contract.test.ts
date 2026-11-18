import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ROLES,
  DEFAULT_ROLE_MATRIX,
  PERMISSIONS,
  authorize,
  type AuthzSubject,
} from '@elshad/authz';
import { ALL_ROUTES, S12_ROUTES, generateOpenApiDocument } from './index.js';

describe('@elshad/api-contract [E0.1-5, E0.1-6, E0.2-4, E1.2]', () => {
  it('ensures every route explicitly declares access and valid permissions [NFR-10]', () => {
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(42);
    expect(S12_ROUTES.length).toBe(13);
    for (const route of ALL_ROUTES) {
      expect(['public', 'authenticated', 'permission']).toContain(route.access.kind);
      if (route.access.kind === 'permission') {
        expect(PERMISSIONS).toContain(route.access.permission);
      }
      if (route.method === 'post' && route.scope !== 'none' && !route.path.includes('/auth/')) {
        expect(route.idempotent).toBe(true);
      }
    }
  });

  it('validates every permission-gated route in ALL_ROUTES against the O.1 role matrix [E1.2, F.2]', () => {
    for (const role of BUILTIN_ROLES) {
      const subject: AuthzSubject = {
        principalId: 'prn_contract_actor',
        orgId: 'org_contract_1',
        bindings: [{ role, scopeType: 'workspace', scopeId: 'ws_contract_1' }],
      };

      for (const route of ALL_ROUTES) {
        if (route.access.kind !== 'permission') continue;
        const expectedMode = DEFAULT_ROLE_MATRIX[role][route.access.permission];

        const decision = authorize(
          subject,
          route.access.permission,
          { orgId: 'org_contract_1', workspaceId: 'ws_contract_1' },
          { ownerId: 'prn_other_user' },
        );
        expect(decision.allowed).toBe(expectedMode === 'all');

        const ownDecision = authorize(
          subject,
          route.access.permission,
          { orgId: 'org_contract_1', workspaceId: 'ws_contract_1' },
          { ownerId: 'prn_contract_actor' },
        );
        expect(ownDecision.allowed).toBe(expectedMode === 'all' || expectedMode === 'own');
      }
    }
  });

  it('generates a valid OpenAPI 3.1 document containing all routes', () => {
    const doc = generateOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.components?.schemas?.ErrorEnvelope).toBeDefined();
    for (const route of ALL_ROUTES) {
      const pathEntry = doc.paths?.[route.path] as Record<string, unknown> | undefined;
      expect(pathEntry).toBeDefined();
      expect(pathEntry?.[route.method]).toBeDefined();
    }
  });
});
