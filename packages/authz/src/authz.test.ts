import { describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import {
  DEFAULT_ROLE_MATRIX,
  PERMISSIONS,
  assertSeparationOfDuties,
  authorize,
  requirePermission,
  type BuiltInRole,
} from './index.js';

describe('@elshad/authz [O.1, DOC-Q-011, DOC-Q-025]', () => {
  it('defines all permissions including model:pin and project:create/delete', () => {
    expect(PERMISSIONS).toContain('model:pin');
    expect(PERMISSIONS).toContain('project:create');
    expect(PERMISSIONS).toContain('project:delete');
    expect(Object.keys(DEFAULT_ROLE_MATRIX.org_owner).length).toBe(PERMISSIONS.length);
  });

  it('enforces own-resource grants for builder on api_key:manage and tool:grant', () => {
    const subject = {
      principalId: 'prn_builder',
      orgId: 'org_1',
      bindings: [{ role: 'builder' as BuiltInRole, scopeType: 'workspace' as const, scopeId: 'ws_1' }],
    };

    expect(
      authorize(subject, 'api_key:manage', { orgId: 'org_1', workspaceId: 'ws_1' }, { ownerId: 'prn_builder' })
        .allowed,
    ).toBe(true);

    expect(
      authorize(subject, 'api_key:manage', { orgId: 'org_1', workspaceId: 'ws_1' }, { ownerId: 'prn_other' })
        .allowed,
    ).toBe(false);

    expect(() =>
      requirePermission(subject, 'audit:read', { orgId: 'org_1', workspaceId: 'ws_1' }),
    ).toThrowError(PlatformError);
  });

  it('allows auditor run:read metadata but denies run:read_payload per O.1', () => {
    const auditor = {
      principalId: 'prn_auditor',
      orgId: 'org_1',
      bindings: [{ role: 'auditor' as BuiltInRole, scopeType: 'org' as const, scopeId: 'org_1' }],
    };

    expect(authorize(auditor, 'run:read', { orgId: 'org_1', workspaceId: 'ws_1' }).allowed).toBe(true);
    expect(
      authorize(auditor, 'run:read_payload', { orgId: 'org_1', workspaceId: 'ws_1' }).allowed,
    ).toBe(false);
    expect(authorize(auditor, 'audit:export', { orgId: 'org_1' }).allowed).toBe(true);
  });

  it('restricts API key permissions to apiKeyScopes when present', () => {
    const ownerWithScopedKey = {
      principalId: 'prn_owner',
      orgId: 'org_1',
      bindings: [{ role: 'org_owner' as BuiltInRole, scopeType: 'org' as const, scopeId: 'org_1' }],
      apiKeyScopes: ['agent:read' as const],
    };

    expect(authorize(ownerWithScopedKey, 'agent:read', { orgId: 'org_1' }).allowed).toBe(true);
    expect(authorize(ownerWithScopedKey, 'org:manage', { orgId: 'org_1' }).allowed).toBe(false);
  });

  it('enforces Separation of Duties rules [O.1]', () => {
    expect(() =>
      assertSeparationOfDuties({
        action: 'promote_prod',
        actorId: 'prn_1',
        authorId: 'prn_1',
      }),
    ).toThrowError(PlatformError);

    expect(() =>
      assertSeparationOfDuties({
        action: 'promote_prod',
        actorId: 'prn_2',
        authorId: 'prn_1',
      }),
    ).not.toThrow();

    expect(() =>
      assertSeparationOfDuties({
        action: 'policy_enforce',
        actorId: 'prn_1',
        authorId: 'prn_1',
        secondApproverId: 'prn_1',
      }),
    ).toThrowError(PlatformError);
  });
});
