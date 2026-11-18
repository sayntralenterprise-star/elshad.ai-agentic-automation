import { PlatformError } from '@elshad/domain';

/**
 * Complete Permission Catalogue from PRD Appendix O.1 + DOC-Q-011 + DOC-Q-025.
 */
export const PERMISSIONS = [
  'org:manage',
  'sso:configure',
  'billing:manage',
  'workspace:create',
  'workspace:delete',
  'environment:configure',
  'project:create',
  'project:delete',
  'member:invite',
  'role:assign',
  'service_account:manage',
  'agent:read',
  'workflow:read',
  'tool:read',
  'kb:read',
  'agent:create',
  'agent:edit_draft',
  'workflow:create',
  'workflow:edit_draft',
  'agent:publish',
  'workflow:publish',
  'agent:promote_prod',
  'workflow:promote_prod',
  'tool:create',
  'tool:edit',
  'connector:build',
  'tool:grant',
  'tool:grant_write',
  'connection:create',
  'connection:create_write_prod',
  'connection:use',
  'secret:write',
  'run:start',
  'run:cancel',
  'run:read',
  'run:read_payload',
  'run:replay',
  'run:fork',
  'run:redrive',
  'approval:decide',
  'approval:read_all',
  'memory:read',
  'memory:edit',
  'memory:erase',
  'dataset:manage',
  'experiment:run',
  'eval:review',
  'policy:read',
  'policy:edit',
  'policy:enforce',
  'budget:read',
  'budget:edit',
  'audit:read',
  'audit:export',
  'evidence_pack:generate',
  'killswitch:use',
  'webhook:manage',
  'api_key:manage',
  'settings:edit',
  'model:pin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type BuiltInRole =
  | 'org_owner'
  | 'workspace_admin'
  | 'builder'
  | 'operator'
  | 'reviewer'
  | 'auditor'
  | 'viewer';

export type GrantMode = 'all' | 'own';

export type RolePermissionMap = Partial<Record<Permission, GrantMode>>;

function grantAll(perms: readonly Permission[]): RolePermissionMap {
  const map: RolePermissionMap = {};
  for (const p of perms) {
    map[p] = 'all';
  }
  return map;
}

const ORG_OWNER_MAP: RolePermissionMap = grantAll(PERMISSIONS);

const WORKSPACE_ADMIN_MAP: RolePermissionMap = grantAll([
  'workspace:create',
  'workspace:delete',
  'environment:configure',
  'project:create',
  'project:delete',
  'member:invite',
  'role:assign',
  'service_account:manage',
  'agent:read',
  'workflow:read',
  'tool:read',
  'kb:read',
  'agent:create',
  'agent:edit_draft',
  'workflow:create',
  'workflow:edit_draft',
  'agent:publish',
  'workflow:publish',
  'agent:promote_prod',
  'workflow:promote_prod',
  'tool:create',
  'tool:edit',
  'connector:build',
  'tool:grant',
  'tool:grant_write',
  'connection:create',
  'connection:create_write_prod',
  'connection:use',
  'secret:write',
  'run:start',
  'run:cancel',
  'run:read',
  'run:read_payload',
  'run:replay',
  'run:fork',
  'run:redrive',
  'approval:decide',
  'approval:read_all',
  'memory:read',
  'memory:edit',
  'memory:erase',
  'dataset:manage',
  'experiment:run',
  'eval:review',
  'policy:read',
  'policy:edit',
  'policy:enforce',
  'budget:read',
  'budget:edit',
  'audit:read',
  'audit:export',
  'evidence_pack:generate',
  'killswitch:use',
  'webhook:manage',
  'api_key:manage',
  'settings:edit',
  'model:pin',
]);

const BUILDER_MAP: RolePermissionMap = {
  'agent:read': 'all',
  'workflow:read': 'all',
  'tool:read': 'all',
  'kb:read': 'all',
  'agent:create': 'all',
  'agent:edit_draft': 'all',
  'workflow:create': 'all',
  'workflow:edit_draft': 'all',
  'agent:publish': 'all',
  'workflow:publish': 'all',
  'tool:create': 'all',
  'tool:edit': 'all',
  'connector:build': 'all',
  'tool:grant': 'own',
  'connection:create': 'all',
  'connection:use': 'all',
  'secret:write': 'own',
  'run:start': 'all',
  'run:cancel': 'all',
  'run:read': 'all',
  'run:read_payload': 'all',
  'run:replay': 'all',
  'run:fork': 'all',
  'run:redrive': 'all',
  'memory:read': 'own',
  'memory:edit': 'own',
  'dataset:manage': 'all',
  'experiment:run': 'all',
  'eval:review': 'all',
  'policy:read': 'all',
  'budget:read': 'all',
  'webhook:manage': 'own',
  'api_key:manage': 'own',
  'model:pin': 'all',
};

const OPERATOR_MAP: RolePermissionMap = {
  'agent:read': 'all',
  'workflow:read': 'all',
  'tool:read': 'all',
  'kb:read': 'all',
  'connection:use': 'all',
  'run:start': 'all',
  'run:cancel': 'all',
  'run:read': 'all',
  'run:read_payload': 'all',
  'run:replay': 'all',
  'run:fork': 'all',
  'run:redrive': 'all',
  'approval:read_all': 'all',
  'policy:read': 'all',
  'budget:read': 'all',
  'killswitch:use': 'all',
};

const REVIEWER_MAP: RolePermissionMap = {
  'agent:read': 'all',
  'workflow:read': 'all',
  'tool:read': 'all',
  'kb:read': 'all',
  'agent:promote_prod': 'all',
  'workflow:promote_prod': 'all',
  'tool:grant_write': 'all',
  'run:read': 'own',
  'run:read_payload': 'own',
  'approval:decide': 'all',
  'approval:read_all': 'all',
  'dataset:manage': 'all',
  'experiment:run': 'all',
  'eval:review': 'all',
  'policy:read': 'all',
};

const AUDITOR_MAP: RolePermissionMap = {
  'agent:read': 'all',
  'workflow:read': 'all',
  'tool:read': 'all',
  'kb:read': 'all',
  'run:read': 'all',
  'approval:read_all': 'all',
  'memory:read': 'all',
  'policy:read': 'all',
  'budget:read': 'all',
  'audit:read': 'all',
  'audit:export': 'all',
  'evidence_pack:generate': 'all',
};

const VIEWER_MAP: RolePermissionMap = {
  'agent:read': 'all',
  'workflow:read': 'all',
  'tool:read': 'all',
  'kb:read': 'all',
  'run:read': 'own',
  'budget:read': 'all',
};

export const DEFAULT_ROLE_MATRIX: Record<BuiltInRole, RolePermissionMap> = {
  org_owner: ORG_OWNER_MAP,
  workspace_admin: WORKSPACE_ADMIN_MAP,
  builder: BUILDER_MAP,
  operator: OPERATOR_MAP,
  reviewer: REVIEWER_MAP,
  auditor: AUDITOR_MAP,
  viewer: VIEWER_MAP,
};

export const BUILTIN_ROLES: readonly BuiltInRole[] = [
  'org_owner',
  'workspace_admin',
  'builder',
  'operator',
  'reviewer',
  'auditor',
  'viewer',
] as const;

export interface CustomRoleSpec {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: RolePermissionMap;
}

export function resolveRolePermissionMap(
  roleName: string,
  customRoles?: readonly CustomRoleSpec[],
): RolePermissionMap | undefined {
  if (roleName in DEFAULT_ROLE_MATRIX) {
    return DEFAULT_ROLE_MATRIX[roleName as BuiltInRole];
  }
  return customRoles?.find((r) => r.name === roleName || r.id === roleName)?.permissions;
}

export type ScopeType = 'org' | 'workspace' | 'project' | 'resource';

export interface RoleBinding {
  role: BuiltInRole | string;
  scopeType: ScopeType;
  scopeId: string;
  customPermissions?: RolePermissionMap;
}

export interface AuthzSubject {
  principalId: string;
  orgId: string;
  bindings: readonly RoleBinding[];
  /** Optional org custom role definitions (FR-GOV-2). */
  customRoles?: readonly CustomRoleSpec[];
  /** Optional API key scope restriction (if present, permission must be in keyScopes). */
  apiKeyScopes?: readonly Permission[];
}

export interface TargetScope {
  orgId: string;
  workspaceId?: string;
  projectId?: string;
  resourceId?: string;
}

export interface ResourceOwnership {
  ownerId?: string;
}

export interface AuthzDecision {
  allowed: boolean;
  grantMode?: GrantMode;
  matchedRole?: string;
  reason: string;
}

function scopeMatchesBinding(binding: RoleBinding, target: TargetScope): boolean {
  if (binding.scopeType === 'org') {
    return binding.scopeId === target.orgId;
  }
  if (binding.scopeType === 'workspace') {
    return target.workspaceId !== undefined && binding.scopeId === target.workspaceId;
  }
  if (binding.scopeType === 'project') {
    return target.projectId !== undefined && binding.scopeId === target.projectId;
  }
  if (binding.scopeType === 'resource') {
    return target.resourceId !== undefined && binding.scopeId === target.resourceId;
  }
  return false;
}

export function authorize(
  subject: AuthzSubject,
  permission: Permission,
  target: TargetScope,
  resource?: ResourceOwnership,
): AuthzDecision {
  if (subject.apiKeyScopes && subject.apiKeyScopes.length > 0) {
    if (!subject.apiKeyScopes.includes(permission)) {
      return {
        allowed: false,
        reason: `API key scope does not include '${permission}'`,
      };
    }
  }

  let matchedOwnReason: string | null = null;

  for (const binding of subject.bindings) {
    if (!scopeMatchesBinding(binding, target)) {
      continue;
    }

    const permMap: RolePermissionMap | undefined =
      binding.customPermissions ?? resolveRolePermissionMap(binding.role, subject.customRoles);

    if (!permMap) continue;
    const mode = permMap[permission];
    if (!mode) continue;

    if (mode === 'all') {
      return {
        allowed: true,
        grantMode: 'all',
        matchedRole: binding.role,
        reason: `Granted '${permission}' (all) via role '${binding.role}'`,
      };
    }

    if (mode === 'own') {
      if (resource?.ownerId === subject.principalId) {
        return {
          allowed: true,
          grantMode: 'own',
          matchedRole: binding.role,
          reason: `Granted '${permission}' (own) via role '${binding.role}'`,
        };
      }
      matchedOwnReason = `Role '${binding.role}' only allows '${permission}' on own resources`;
    }
  }

  return {
    allowed: false,
    reason: matchedOwnReason ?? `Principal lacks '${permission}' in target scope`,
  };
}

export function requirePermission(
  subject: AuthzSubject,
  permission: Permission,
  target: TargetScope,
  resource?: ResourceOwnership,
): AuthzDecision {
  const decision = authorize(subject, permission, target, resource);
  if (!decision.allowed) {
    throw new PlatformError('AUTH_FORBIDDEN', decision.reason, {
      permission,
      scope: target,
    });
  }
  return decision;
}

export type SodAction =
  | 'promote_prod'
  | 'tool_grant_write'
  | 'approval_decide'
  | 'policy_enforce';

export interface SodCheckInput {
  action: SodAction;
  actorId: string;
  authorId?: string;
  initiatorId?: string;
  secondApproverId?: string;
}

/**
 * Enforces Separation of Duties rules from PRD Appendix O.1 footer (cannot be turned off in prod).
 */
export function assertSeparationOfDuties(input: SodCheckInput): void {
  if (input.action === 'promote_prod' || input.action === 'tool_grant_write') {
    if (input.authorId && input.actorId === input.authorId) {
      throw new PlatformError(
        'POL_DENIED',
        `Separation of duties violation: principal cannot approve their own ${input.action}`,
        { action: input.action, actor_id: input.actorId },
      );
    }
  }

  if (input.action === 'approval_decide') {
    if (input.initiatorId && input.actorId === input.initiatorId) {
      throw new PlatformError(
        'POL_DENIED',
        'Separation of duties violation: initiator cannot decide their own approval request',
        { action: input.action, actor_id: input.actorId },
      );
    }
  }

  if (input.action === 'policy_enforce') {
    if (!input.secondApproverId || input.secondApproverId === input.authorId) {
      throw new PlatformError(
        'POL_DENIED',
        'Separation of duties violation: policy enforcement requires a distinct second policy:edit approver',
        { action: input.action, actor_id: input.actorId },
      );
    }
  }
}

export interface O1MatrixCell {
  readonly role: BuiltInRole;
  readonly permission: Permission;
  readonly expectedMode: GrantMode | 'deny';
}

export interface O1MatrixVerificationReport {
  readonly totalChecked: number;
  readonly passed: number;
  readonly failures: string[];
  readonly cells: readonly O1MatrixCell[];
}

/**
 * Exhaustively verifies every (role x permission x ownership x scope) combination against
 * the PRD Appendix O.1 permission matrix (E1.2 / F.2 CI authorization test).
 */
export function verifyO1RolePermissionMatrix(): O1MatrixVerificationReport {
  const failures: string[] = [];
  const cells: O1MatrixCell[] = [];
  let totalChecked = 0;
  let passed = 0;

  for (const role of BUILTIN_ROLES) {
    const roleMap = DEFAULT_ROLE_MATRIX[role];
    const wsSubject: AuthzSubject = {
      principalId: 'prn_matrix_actor',
      orgId: 'org_matrix_1',
      bindings: [{ role, scopeType: 'workspace', scopeId: 'ws_matrix_1' }],
    };

    for (const permission of PERMISSIONS) {
      const mode = roleMap[permission];
      const expectedMode: GrantMode | 'deny' = mode ?? 'deny';
      cells.push({ role, permission, expectedMode });

      // 1. Same workspace, own resource
      const ownDecision = authorize(
        wsSubject,
        permission,
        { orgId: 'org_matrix_1', workspaceId: 'ws_matrix_1' },
        { ownerId: 'prn_matrix_actor' },
      );
      const expectOwn = expectedMode === 'all' || expectedMode === 'own';
      totalChecked += 1;
      if (ownDecision.allowed === expectOwn) {
        passed += 1;
      } else {
        failures.push(
          `${role}/${permission} (own): expected ${expectOwn}, got ${ownDecision.allowed}`,
        );
      }

      // 2. Same workspace, other owner's resource
      const otherDecision = authorize(
        wsSubject,
        permission,
        { orgId: 'org_matrix_1', workspaceId: 'ws_matrix_1' },
        { ownerId: 'prn_other_actor' },
      );
      const expectOther = expectedMode === 'all';
      totalChecked += 1;
      if (otherDecision.allowed === expectOther) {
        passed += 1;
      } else {
        failures.push(
          `${role}/${permission} (other): expected ${expectOther}, got ${otherDecision.allowed}`,
        );
      }

      // 3. Cross-workspace boundary (must always deny)
      const crossWsDecision = authorize(
        wsSubject,
        permission,
        { orgId: 'org_matrix_1', workspaceId: 'ws_matrix_2' },
        { ownerId: 'prn_matrix_actor' },
      );
      totalChecked += 1;
      if (!crossWsDecision.allowed) {
        passed += 1;
      } else {
        failures.push(`${role}/${permission} (cross-workspace): expected deny, got allow`);
      }

      // 4. Cross-org boundary even with org binding on org_matrix_1 (must always deny)
      const orgSubject: AuthzSubject = {
        principalId: 'prn_matrix_actor',
        orgId: 'org_matrix_1',
        bindings: [{ role, scopeType: 'org', scopeId: 'org_matrix_1' }],
      };
      const crossOrgDecision = authorize(
        orgSubject,
        permission,
        { orgId: 'org_matrix_2', workspaceId: 'ws_matrix_1' },
        { ownerId: 'prn_matrix_actor' },
      );
      totalChecked += 1;
      if (!crossOrgDecision.allowed) {
        passed += 1;
      } else {
        failures.push(`${role}/${permission} (cross-org): expected deny, got allow`);
      }
    }
  }

  return { totalChecked, passed, failures, cells };
}

export interface AgentIdentityGrant {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly principalId: string;
  readonly environmentId: string;
  readonly allowedToolIds: readonly string[];
  readonly status: 'active' | 'disabled';
}

export interface AgentIdentityRuntimeToken {
  readonly tokenId: string;
  readonly agentIdentityId: string;
  readonly agentPrincipalId: string;
  readonly agentId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly environmentId: string;
  readonly onBehalfOfPrincipalId: string | null;
  readonly allowedToolIds: readonly string[];
  readonly expiresAt: string;
}

/**
 * Evaluates whether an agent's short-lived runtime identity token authorizes a tool call
 * inside a specific environment without leakage across tools, environments, or expiry (FR-GOV-1, F.1).
 */
export function authorizeAgentIdentityToolCall(
  token: AgentIdentityRuntimeToken,
  toolId: string,
  environmentId: string,
  nowIso: string = new Date().toISOString(),
): AuthzDecision {
  const expiresMs = Date.parse(token.expiresAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(expiresMs) || !Number.isFinite(nowMs) || nowMs > expiresMs) {
    return {
      allowed: false,
      reason: `Agent identity runtime token ${token.tokenId} has expired`,
    };
  }
  if (token.environmentId !== environmentId) {
    return {
      allowed: false,
      reason: `Agent identity token ${token.tokenId} is scoped to environment ${token.environmentId}, not ${environmentId}`,
    };
  }
  if (!token.allowedToolIds.includes(toolId) && !token.allowedToolIds.includes('*')) {
    return {
      allowed: false,
      reason: `Agent identity ${token.agentIdentityId} is not granted tool "${toolId}"`,
    };
  }
  return {
    allowed: true,
    grantMode: 'all',
    matchedRole: 'agent_identity',
    reason: `Agent ${token.agentId} authorized tool "${toolId}" on behalf of ${token.onBehalfOfPrincipalId ?? 'autonomous'}`,
  };
}
