import { describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import {
  BUILTIN_ROLES,
  DEFAULT_ROLE_MATRIX,
  PERMISSIONS,
  assertSeparationOfDuties,
  authorize,
  authorizeAgentIdentityToolCall,
  requirePermission,
  verifyO1RolePermissionMatrix,
  type AgentIdentityRuntimeToken,
  type BuiltInRole,
  type CustomRoleSpec,
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

  it('enforces Separation of Duties rules across all actions [O.1, E1.2]', () => {
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
        action: 'tool_grant_write',
        actorId: 'prn_1',
        authorId: 'prn_1',
      }),
    ).toThrowError(PlatformError);

    expect(() =>
      assertSeparationOfDuties({
        action: 'approval_decide',
        actorId: 'prn_1',
        initiatorId: 'prn_1',
      }),
    ).toThrowError(PlatformError);

    expect(() =>
      assertSeparationOfDuties({
        action: 'policy_enforce',
        actorId: 'prn_1',
        authorId: 'prn_1',
        secondApproverId: 'prn_1',
      }),
    ).toThrowError(PlatformError);

    expect(() =>
      assertSeparationOfDuties({
        action: 'policy_enforce',
        actorId: 'prn_2',
        authorId: 'prn_1',
        secondApproverId: 'prn_2',
      }),
    ).not.toThrow();
  });

  it('passes exhaustive O.1 matrix across all built-in roles x permissions x ownership x scope boundaries [E1.2, F.2]', () => {
    const report = verifyO1RolePermissionMatrix();
    expect(report.failures).toEqual([]);
    expect(report.cells).toHaveLength(BUILTIN_ROLES.length * PERMISSIONS.length);
    expect(report.totalChecked).toBe(BUILTIN_ROLES.length * PERMISSIONS.length * 4);
    expect(report.passed).toBe(report.totalChecked);
  });

  it('supports org custom roles and scopes agent identity runtime tokens with onBehalfOf [FR-GOV-1, FR-GOV-2]', () => {
    const customRoles: CustomRoleSpec[] = [
      {
        id: 'rol_custom_1',
        orgId: 'org_1',
        name: 'compliance_exporter',
        permissions: {
          'audit:read': 'all',
          'audit:export': 'all',
          'run:read': 'own',
        },
      },
    ];

    const subject = {
      principalId: 'prn_u1',
      orgId: 'org_1',
      bindings: [{ role: 'compliance_exporter', scopeType: 'workspace' as const, scopeId: 'ws_1' }],
      customRoles,
    };

    expect(authorize(subject, 'audit:export', { orgId: 'org_1', workspaceId: 'ws_1' }).allowed).toBe(
      true,
    );
    expect(
      authorize(
        subject,
        'run:read',
        { orgId: 'org_1', workspaceId: 'ws_1' },
        { ownerId: 'prn_other' },
      ).allowed,
    ).toBe(false);
    expect(
      authorize(subject, 'policy:enforce', { orgId: 'org_1', workspaceId: 'ws_1' }).allowed,
    ).toBe(false);

    const agentToken: AgentIdentityRuntimeToken = {
      tokenId: 'atok_1',
      agentIdentityId: 'aid_1',
      agentPrincipalId: 'prn_agent_1',
      agentId: 'agt_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      environmentId: 'env_staging',
      onBehalfOfPrincipalId: 'prn_human_9',
      allowedToolIds: ['http.get', 'crm.search'],
      expiresAt: '2026-11-18T13:00:00.000Z',
    };

    const allowed = authorizeAgentIdentityToolCall(
      agentToken,
      'http.get',
      'env_staging',
      '2026-11-18T12:15:00.000Z',
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.reason).toContain('prn_human_9');

    expect(
      authorizeAgentIdentityToolCall(agentToken, 'http.get', 'env_prod', '2026-11-18T12:15:00.000Z')
        .allowed,
    ).toBe(false);
    expect(
      authorizeAgentIdentityToolCall(agentToken, 'db.drop', 'env_staging', '2026-11-18T12:15:00.000Z')
        .allowed,
    ).toBe(false);
    expect(
      authorizeAgentIdentityToolCall(
        agentToken,
        'http.get',
        'env_staging',
        '2026-11-18T13:05:00.000Z',
      ).allowed,
    ).toBe(false);
  });
});
