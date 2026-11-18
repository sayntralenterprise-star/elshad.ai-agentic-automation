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
      binding.customPermissions ??
      (binding.role in DEFAULT_ROLE_MATRIX
        ? DEFAULT_ROLE_MATRIX[binding.role as BuiltInRole]
        : undefined);

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
