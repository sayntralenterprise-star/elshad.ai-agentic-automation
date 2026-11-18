import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2id } from '@noble/hashes/argon2.js';
import {
  DEFAULT_ROLE_MATRIX,
  type BuiltInRole,
  type Permission,
  type RoleBinding,
} from '@elshad/authz';
import {
  GENESIS_AUDIT_HASH,
  computeAuditHash,
  computeContextHash,
  createKysely,
  createPgPool,
  withTenantTx,
  type VerifiableAuditEvent,
} from '@elshad/db';
import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  type Clock,
  type EnvironmentKind,
  type IdGen,
} from '@elshad/domain';

export interface OrgRecord {
  id: string;
  slug: string;
  name: string;
}

export interface WorkspaceRecord {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface ProjectRecord {
  id: string;
  org_id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string | null;
  max_autonomy_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  created_at: string;
}

export interface EnvironmentRecord {
  id: string;
  org_id: string;
  workspace_id: string;
  kind: EnvironmentKind;
  name: string;
}

export interface PrincipalRecord {
  id: string;
  org_id: string;
  type: 'user' | 'group' | 'service_account' | 'agent';
  external_id: string | null;
  email: string | null;
  display_name: string;
  disabled_at: string | null;
}

export interface RoleRecord {
  id: string;
  org_id: string | null;
  name: string;
  is_system: boolean;
}

export interface RoleBindingRecord {
  id: string;
  org_id: string;
  principal_id: string;
  role_id: string;
  role_name: string;
  scope_type: 'org' | 'workspace' | 'project' | 'resource';
  scope_id: string;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  org_id: string;
  principal_id: string;
  refresh_token_hash: string;
  csrf_token: string;
  expires_at: string;
  idle_expires_at: string;
  revoked_at: string | null;
}

export interface ApiKeyRecord {
  id: string;
  org_id: string;
  workspace_id: string | null;
  principal_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: Permission[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AuditEventRecord extends VerifiableAuditEvent {
  org_id: string;
  context: Record<string, unknown>;
}

export interface IdempotencyRecord {
  org_id: string;
  principal_id: string;
  key: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  expires_at: string;
}

export interface AuthPrincipalContext {
  principal: PrincipalRecord;
  org: OrgRecord;
  bindings: RoleBinding[];
  rawBindings: RoleBindingRecord[];
  workspaces: WorkspaceRecord[];
}

export interface IamAuditStore {
  checkHealth(): Promise<boolean>;
  authenticateLocal(email: string, password: string): Promise<{ principal: PrincipalRecord }>;
  authenticateOidcSubject(opts: {
    externalId: string;
    email: string;
    displayName: string;
  }): Promise<{ principal: PrincipalRecord }>;
  createSession(principal: PrincipalRecord): Promise<{ session: SessionRecord; refreshToken: string }>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  refreshSession(sessionId: string): Promise<{ session: SessionRecord; refreshToken: string }>;
  revokeSession(sessionId: string, orgId: string): Promise<void>;
  resolveApiKey(rawKey: string): Promise<{
    apiKey: ApiKeyRecord;
    principal: PrincipalRecord;
  } | null>;
  getPrincipalContext(orgId: string, principalId: string): Promise<AuthPrincipalContext>;
  listWorkspaces(orgId: string): Promise<WorkspaceRecord[]>;
  getWorkspace(orgId: string, id: string): Promise<WorkspaceRecord | null>;
  createWorkspace(orgId: string, input: { slug: string; name: string }): Promise<WorkspaceRecord>;
  updateWorkspace(orgId: string, id: string, input: { name: string }): Promise<WorkspaceRecord>;
  listProjects(orgId: string, workspaceId: string): Promise<ProjectRecord[]>;
  createProject(
    orgId: string,
    workspaceId: string,
    input: { slug: string; name: string; description?: string },
  ): Promise<ProjectRecord>;
  listEnvironments(orgId: string, workspaceId: string): Promise<EnvironmentRecord[]>;
  listRoles(orgId: string): Promise<RoleRecord[]>;
  listRoleBindings(orgId: string): Promise<RoleBindingRecord[]>;
  createRoleBinding(
    orgId: string,
    input: {
      principal_id: string;
      role_name: string;
      scope_type: 'org' | 'workspace' | 'project' | 'resource';
      scope_id: string;
    },
  ): Promise<RoleBindingRecord>;
  deleteRoleBinding(orgId: string, id: string): Promise<boolean>;
  listApiKeys(orgId: string, filterPrincipalId?: string): Promise<ApiKeyRecord[]>;
  getApiKey(orgId: string, id: string): Promise<ApiKeyRecord | null>;
  createApiKey(
    orgId: string,
    input: {
      principal_id: string;
      name: string;
      scopes: Permission[];
      workspace_id?: string;
    },
  ): Promise<{ record: ApiKeyRecord; secret: string }>;
  revokeApiKey(orgId: string, id: string): Promise<boolean>;
  appendAudit(
    orgId: string,
    input: {
      actor: Record<string, unknown>;
      on_behalf_of?: Record<string, unknown> | null;
      action: string;
      resource: Record<string, unknown>;
      decision?: string | null;
      policy_ids?: string[] | null;
      context?: Record<string, unknown>;
    },
  ): Promise<AuditEventRecord>;
  listAuditEvents(
    orgId: string,
    opts: { limit?: number; cursor?: string; action?: string },
  ): Promise<{ data: AuditEventRecord[]; next_cursor: string | null }>;
  getIdempotency(
    orgId: string,
    principalId: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  saveIdempotency(rec: IdempotencyRecord): Promise<void>;
}

const ARGON_OPTS = { t: 1, m: 64, p: 1, dkLen: 32 } as const;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 60_000;
const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000; // O.3: 8h
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000; // O.3: 30m

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = argon2id(password, salt, ARGON_OPTS);
  return `$argon2id$v=19$m=${ARGON_OPTS.m},t=${ARGON_OPTS.t},p=${ARGON_OPTS.p}$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id') return false;
  const paramMap = new Map<string, number>();
  for (const item of parts[3]!.split(',')) {
    const [k, v] = item.split('=');
    if (k && v) paramMap.set(k, Number(v));
  }
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const derived = Buffer.from(
    argon2id(password, salt, {
      m: paramMap.get('m') ?? ARGON_OPTS.m,
      t: paramMap.get('t') ?? ARGON_OPTS.t,
      p: paramMap.get('p') ?? ARGON_OPTS.p,
      dkLen: expected.length,
    }),
  );
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function hashApiKeySecret(secret: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${secret}`, 'utf8').digest('hex');
}

export interface BootstrapSeedOptions {
  adminEmail: string;
  adminPassword: string;
  apiKeyPepper: string;
  clock?: Clock;
  idGen?: IdGen;
}

export class InMemoryIamAuditStore implements IamAuditStore {
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  private readonly pepper: string;

  readonly orgs = new Map<string, OrgRecord>();
  readonly workspaces = new Map<string, WorkspaceRecord>();
  readonly projects = new Map<string, ProjectRecord>();
  readonly environments = new Map<string, EnvironmentRecord>();
  readonly principals = new Map<string, PrincipalRecord>();
  readonly credentials = new Map<
    string,
    { principalId: string; orgId: string; passwordHash: string; failedAttempts: number; lockedUntilMs: number | null }
  >();
  readonly roles = new Map<string, RoleRecord>();
  readonly roleBindings = new Map<string, RoleBindingRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly apiKeys = new Map<string, ApiKeyRecord>();
  readonly auditEvents = new Map<string, AuditEventRecord[]>();
  readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor(opts: BootstrapSeedOptions) {
    this.clock = opts.clock ?? new SystemClock();
    this.idGen = opts.idGen ?? new SystemIdGen();
    this.pepper = opts.apiKeyPepper;
    this.seedDefaults(opts.adminEmail, opts.adminPassword);
  }

  private seedDefaults(adminEmail: string, adminPassword: string): void {
    const now = this.clock.now().toISOString();

    for (const roleName of Object.keys(DEFAULT_ROLE_MATRIX) as BuiltInRole[]) {
      const roleId = this.idGen.uuidv7();
      this.roles.set(roleId, {
        id: roleId,
        org_id: null,
        name: roleName,
        is_system: true,
      });
    }

    const orgId = this.idGen.uuidv7();
    this.orgs.set(orgId, { id: orgId, slug: 'default-org', name: 'Default Organization' });

    const wsId = this.idGen.uuidv7();
    this.workspaces.set(wsId, {
      id: wsId,
      org_id: orgId,
      slug: 'default',
      name: 'Default Workspace',
      created_at: now,
    });

    for (const kind of ['dev', 'staging', 'prod'] as const) {
      const envId = this.idGen.uuidv7();
      this.environments.set(envId, {
        id: envId,
        org_id: orgId,
        workspace_id: wsId,
        kind,
        name: kind.toUpperCase(),
      });
    }

    const prjId = this.idGen.uuidv7();
    this.projects.set(prjId, {
      id: prjId,
      org_id: orgId,
      workspace_id: wsId,
      slug: 'default-project',
      name: 'Default Project',
      description: 'Bootstrap project created by S0.1 seed',
      max_autonomy_level: 'L3',
      created_at: now,
    });

    const adminId = this.idGen.uuidv7();
    this.principals.set(adminId, {
      id: adminId,
      org_id: orgId,
      type: 'user',
      external_id: null,
      email: adminEmail.toLowerCase(),
      display_name: 'Platform Admin',
      disabled_at: null,
    });
    this.credentials.set(adminId, {
      principalId: adminId,
      orgId,
      passwordHash: hashPassword(adminPassword),
      failedAttempts: 0,
      lockedUntilMs: null,
    });

    const ownerRole = [...this.roles.values()].find((r) => r.name === 'org_owner')!;
    const bindingId = this.idGen.uuidv7();
    this.roleBindings.set(bindingId, {
      id: bindingId,
      org_id: orgId,
      principal_id: adminId,
      role_id: ownerRole.id,
      role_name: ownerRole.name,
      scope_type: 'org',
      scope_id: orgId,
      created_at: now,
    });
  }

  /**
   * Helper for tests / multi-org scenarios to seed an isolated organization & principal.
   */
  seedOrganization(input: {
    slug: string;
    name: string;
    adminEmail: string;
    adminPassword: string;
    role?: BuiltInRole;
  }): { org: OrgRecord; workspace: WorkspaceRecord; principal: PrincipalRecord } {
    const now = this.clock.now().toISOString();
    const orgId = this.idGen.uuidv7();
    const org: OrgRecord = { id: orgId, slug: input.slug, name: input.name };
    this.orgs.set(orgId, org);

    const wsId = this.idGen.uuidv7();
    const workspace: WorkspaceRecord = {
      id: wsId,
      org_id: orgId,
      slug: 'main',
      name: `${input.name} Workspace`,
      created_at: now,
    };
    this.workspaces.set(wsId, workspace);

    for (const kind of ['dev', 'staging', 'prod'] as const) {
      const envId = this.idGen.uuidv7();
      this.environments.set(envId, {
        id: envId,
        org_id: orgId,
        workspace_id: wsId,
        kind,
        name: kind.toUpperCase(),
      });
    }

    const principalId = this.idGen.uuidv7();
    const principal: PrincipalRecord = {
      id: principalId,
      org_id: orgId,
      type: 'user',
      external_id: null,
      email: input.adminEmail.toLowerCase(),
      display_name: input.adminEmail,
      disabled_at: null,
    };
    this.principals.set(principalId, principal);
    this.credentials.set(principalId, {
      principalId,
      orgId,
      passwordHash: hashPassword(input.adminPassword),
      failedAttempts: 0,
      lockedUntilMs: null,
    });

    const roleName = input.role ?? 'org_owner';
    const role = [...this.roles.values()].find((r) => r.name === roleName)!;
    const bindingId = this.idGen.uuidv7();
    this.roleBindings.set(bindingId, {
      id: bindingId,
      org_id: orgId,
      principal_id: principalId,
      role_id: role.id,
      role_name: role.name,
      scope_type: 'org',
      scope_id: orgId,
      created_at: now,
    });

    return { org, workspace, principal };
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }

  async authenticateLocal(
    email: string,
    password: string,
  ): Promise<{ principal: PrincipalRecord }> {
    const normalized = email.trim().toLowerCase();
    const principal = [...this.principals.values()].find(
      (p) => p.email?.toLowerCase() === normalized && !p.disabled_at,
    );
    if (!principal) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid email or password.');
    }

    const cred = this.credentials.get(principal.id);
    if (!cred) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid email or password.');
    }

    const nowMs = this.clock.now().getTime();
    if (cred.lockedUntilMs !== null && nowMs < cred.lockedUntilMs) {
      const retryAfter = Math.max(1, Math.ceil((cred.lockedUntilMs - nowMs) / 1000));
      throw new PlatformError(
        'BUD_RATE_LIMITED',
        'Too many failed login attempts. Try again later.',
        { retry_after_seconds: retryAfter },
      );
    }

    if (!verifyPassword(password, cred.passwordHash)) {
      cred.failedAttempts += 1;
      if (cred.failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        cred.lockedUntilMs = nowMs + LOGIN_LOCKOUT_MS;
        cred.failedAttempts = 0;
        await this.appendAudit(principal.org_id, {
          actor: { id: principal.id, type: principal.type, email: principal.email },
          action: 'auth.login_throttled',
          resource: { type: 'principal', id: principal.id },
          decision: 'deny',
        });
        throw new PlatformError(
          'BUD_RATE_LIMITED',
          'Too many failed login attempts. Try again later.',
          { retry_after_seconds: Math.ceil(LOGIN_LOCKOUT_MS / 1000) },
        );
      }

      await this.appendAudit(principal.org_id, {
        actor: { id: principal.id, type: principal.type, email: principal.email },
        action: 'auth.login_failed',
        resource: { type: 'principal', id: principal.id },
        decision: 'deny',
      });
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid email or password.');
    }

    cred.failedAttempts = 0;
    cred.lockedUntilMs = null;
    return { principal };
  }

  async authenticateOidcSubject(opts: {
    externalId: string;
    email: string;
    displayName: string;
  }): Promise<{ principal: PrincipalRecord }> {
    const normalizedEmail = opts.email.trim().toLowerCase();
    const existing = [...this.principals.values()].find(
      (p) => p.external_id === opts.externalId || p.email?.toLowerCase() === normalizedEmail,
    );
    if (existing) {
      if (existing.disabled_at) {
        throw new PlatformError('AUTH_FORBIDDEN', 'Principal is disabled.');
      }
      return { principal: existing };
    }

    const defaultOrg = [...this.orgs.values()][0];
    if (!defaultOrg) {
      throw new PlatformError('SYS_INTERNAL', 'No default organization configured.');
    }
    const id = this.idGen.uuidv7();
    const principal: PrincipalRecord = {
      id,
      org_id: defaultOrg.id,
      type: 'user',
      external_id: opts.externalId,
      email: normalizedEmail,
      display_name: opts.displayName,
      disabled_at: null,
    };
    this.principals.set(id, principal);

    const viewerRole = [...this.roles.values()].find((r) => r.name === 'viewer')!;
    const bindingId = this.idGen.uuidv7();
    this.roleBindings.set(bindingId, {
      id: bindingId,
      org_id: defaultOrg.id,
      principal_id: id,
      role_id: viewerRole.id,
      role_name: viewerRole.name,
      scope_type: 'org',
      scope_id: defaultOrg.id,
      created_at: this.clock.now().toISOString(),
    });
    return { principal };
  }

  async createSession(
    principal: PrincipalRecord,
  ): Promise<{ session: SessionRecord; refreshToken: string }> {
    const nowMs = this.clock.now().getTime();
    const id = this.idGen.uuidv7(nowMs);
    const refreshToken = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(24).toString('hex');
    const session: SessionRecord = {
      id,
      org_id: principal.org_id,
      principal_id: principal.id,
      refresh_token_hash: hashApiKeySecret(refreshToken, this.pepper),
      csrf_token: csrfToken,
      expires_at: new Date(nowMs + SESSION_ABSOLUTE_TTL_MS).toISOString(),
      idle_expires_at: new Date(nowMs + SESSION_IDLE_TTL_MS).toISOString(),
      revoked_at: null,
    };
    this.sessions.set(id, session);
    return { session, refreshToken };
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked_at) return null;
    const nowMs = this.clock.now().getTime();
    if (
      nowMs >= Date.parse(session.expires_at) ||
      nowMs >= Date.parse(session.idle_expires_at)
    ) {
      return null;
    }
    session.idle_expires_at = new Date(nowMs + SESSION_IDLE_TTL_MS).toISOString();
    return session;
  }

  async refreshSession(
    sessionId: string,
  ): Promise<{ session: SessionRecord; refreshToken: string }> {
    const existing = await this.getSession(sessionId);
    if (!existing) {
      throw new PlatformError('AUTH_TOKEN_EXPIRED', 'Session expired or revoked.');
    }
    const nowMs = this.clock.now().getTime();
    const refreshToken = randomBytes(32).toString('hex');
    existing.refresh_token_hash = hashApiKeySecret(refreshToken, this.pepper);
    existing.csrf_token = randomBytes(24).toString('hex');
    existing.idle_expires_at = new Date(nowMs + SESSION_IDLE_TTL_MS).toISOString();
    return { session: existing, refreshToken };
  }

  async revokeSession(sessionId: string, orgId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing && existing.org_id === orgId) {
      existing.revoked_at = this.clock.now().toISOString();
    }
  }

  async resolveApiKey(
    rawKey: string,
  ): Promise<{ apiKey: ApiKeyRecord; principal: PrincipalRecord } | null> {
    const hash = hashApiKeySecret(rawKey, this.pepper);
    const key = [...this.apiKeys.values()].find((k) => k.key_hash === hash);
    if (!key || key.revoked_at) return null;
    const now = this.clock.now();
    if (key.expires_at && now.getTime() >= Date.parse(key.expires_at)) return null;
    const principal = this.principals.get(key.principal_id);
    if (!principal || principal.disabled_at) return null;
    key.last_used_at = now.toISOString();
    return { apiKey: key, principal };
  }

  async getPrincipalContext(orgId: string, principalId: string): Promise<AuthPrincipalContext> {
    const org = this.orgs.get(orgId);
    const principal = this.principals.get(principalId);
    if (!org || !principal || principal.org_id !== orgId) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Principal context not found.');
    }
    const rawBindings = [...this.roleBindings.values()].filter(
      (b) => b.org_id === orgId && b.principal_id === principalId,
    );
    const bindings: RoleBinding[] = rawBindings.map((b) => ({
      role: b.role_name,
      scopeType: b.scope_type,
      scopeId: b.scope_id,
    }));
    const workspaces = await this.listWorkspaces(orgId);
    return { principal, org, bindings, rawBindings, workspaces };
  }

  async listWorkspaces(orgId: string): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()].filter((w) => w.org_id === orgId);
  }

  async getWorkspace(orgId: string, id: string): Promise<WorkspaceRecord | null> {
    const ws = this.workspaces.get(id);
    if (!ws || ws.org_id !== orgId) return null;
    return ws;
  }

  async createWorkspace(
    orgId: string,
    input: { slug: string; name: string },
  ): Promise<WorkspaceRecord> {
    const dup = [...this.workspaces.values()].find(
      (w) => w.org_id === orgId && w.slug === input.slug,
    );
    if (dup) {
      throw new PlatformError('RES_CONFLICT', `Workspace slug '${input.slug}' already exists.`);
    }
    const now = this.clock.now().toISOString();
    const id = this.idGen.uuidv7();
    const ws: WorkspaceRecord = {
      id,
      org_id: orgId,
      slug: input.slug,
      name: input.name,
      created_at: now,
    };
    this.workspaces.set(id, ws);

    for (const kind of ['dev', 'staging', 'prod'] as const) {
      const envId = this.idGen.uuidv7();
      this.environments.set(envId, {
        id: envId,
        org_id: orgId,
        workspace_id: id,
        kind,
        name: kind.toUpperCase(),
      });
    }
    return ws;
  }

  async updateWorkspace(
    orgId: string,
    id: string,
    input: { name: string },
  ): Promise<WorkspaceRecord> {
    const ws = await this.getWorkspace(orgId, id);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${id} not found.`);
    }
    ws.name = input.name;
    return ws;
  }

  async listProjects(orgId: string, workspaceId: string): Promise<ProjectRecord[]> {
    const ws = await this.getWorkspace(orgId, workspaceId);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${workspaceId} not found.`);
    }
    return [...this.projects.values()].filter(
      (p) => p.org_id === orgId && p.workspace_id === workspaceId,
    );
  }

  async createProject(
    orgId: string,
    workspaceId: string,
    input: { slug: string; name: string; description?: string },
  ): Promise<ProjectRecord> {
    const ws = await this.getWorkspace(orgId, workspaceId);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${workspaceId} not found.`);
    }
    const dup = [...this.projects.values()].find(
      (p) => p.workspace_id === workspaceId && p.slug === input.slug,
    );
    if (dup) {
      throw new PlatformError('RES_CONFLICT', `Project slug '${input.slug}' already exists.`);
    }
    const id = this.idGen.uuidv7();
    const project: ProjectRecord = {
      id,
      org_id: orgId,
      workspace_id: workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      max_autonomy_level: 'L3',
      created_at: this.clock.now().toISOString(),
    };
    this.projects.set(id, project);
    return project;
  }

  async listEnvironments(orgId: string, workspaceId: string): Promise<EnvironmentRecord[]> {
    const ws = await this.getWorkspace(orgId, workspaceId);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${workspaceId} not found.`);
    }
    return [...this.environments.values()].filter(
      (e) => e.org_id === orgId && e.workspace_id === workspaceId,
    );
  }

  async listRoles(orgId: string): Promise<RoleRecord[]> {
    return [...this.roles.values()].filter((r) => r.org_id === null || r.org_id === orgId);
  }

  async listRoleBindings(orgId: string): Promise<RoleBindingRecord[]> {
    return [...this.roleBindings.values()].filter((b) => b.org_id === orgId);
  }

  async createRoleBinding(
    orgId: string,
    input: {
      principal_id: string;
      role_name: string;
      scope_type: 'org' | 'workspace' | 'project' | 'resource';
      scope_id: string;
    },
  ): Promise<RoleBindingRecord> {
    const principal = this.principals.get(input.principal_id);
    if (!principal || principal.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', 'Principal not found in organization.');
    }
    const role = [...this.roles.values()].find(
      (r) => (r.org_id === null || r.org_id === orgId) && r.name === input.role_name,
    );
    if (!role) {
      throw new PlatformError('RES_NOT_FOUND', `Role '${input.role_name}' not found.`);
    }
    const id = this.idGen.uuidv7();
    const binding: RoleBindingRecord = {
      id,
      org_id: orgId,
      principal_id: principal.id,
      role_id: role.id,
      role_name: role.name,
      scope_type: input.scope_type,
      scope_id: input.scope_id,
      created_at: this.clock.now().toISOString(),
    };
    this.roleBindings.set(id, binding);
    return binding;
  }

  async deleteRoleBinding(orgId: string, id: string): Promise<boolean> {
    const existing = this.roleBindings.get(id);
    if (!existing || existing.org_id !== orgId) return false;
    this.roleBindings.delete(id);
    return true;
  }

  async listApiKeys(orgId: string, filterPrincipalId?: string): Promise<ApiKeyRecord[]> {
    return [...this.apiKeys.values()].filter(
      (k) => k.org_id === orgId && (!filterPrincipalId || k.principal_id === filterPrincipalId),
    );
  }

  async getApiKey(orgId: string, id: string): Promise<ApiKeyRecord | null> {
    const key = this.apiKeys.get(id);
    if (!key || key.org_id !== orgId) return null;
    return key;
  }

  async createApiKey(
    orgId: string,
    input: {
      principal_id: string;
      name: string;
      scopes: Permission[];
      workspace_id?: string;
    },
  ): Promise<{ record: ApiKeyRecord; secret: string }> {
    const id = this.idGen.uuidv7();
    const rawRandom = randomBytes(24).toString('base64url');
    const secret = `key_${rawRandom}`;
    const keyPrefix = secret.slice(0, 12);
    const record: ApiKeyRecord = {
      id,
      org_id: orgId,
      workspace_id: input.workspace_id ?? null,
      principal_id: input.principal_id,
      name: input.name,
      key_prefix: keyPrefix,
      key_hash: hashApiKeySecret(secret, this.pepper),
      scopes: input.scopes,
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      created_at: this.clock.now().toISOString(),
    };
    this.apiKeys.set(id, record);
    return { record, secret };
  }

  async revokeApiKey(orgId: string, id: string): Promise<boolean> {
    const key = this.apiKeys.get(id);
    if (!key || key.org_id !== orgId) return false;
    key.revoked_at = this.clock.now().toISOString();
    return true;
  }

  async appendAudit(
    orgId: string,
    input: {
      actor: Record<string, unknown>;
      on_behalf_of?: Record<string, unknown> | null;
      action: string;
      resource: Record<string, unknown>;
      decision?: string | null;
      policy_ids?: string[] | null;
      context?: Record<string, unknown>;
    },
  ): Promise<AuditEventRecord> {
    const list = this.auditEvents.get(orgId) ?? [];
    const last = list[list.length - 1];
    const seq = last ? last.seq + 1 : 1;
    const prevHash = last ? last.hash : GENESIS_AUDIT_HASH;
    const ts = this.clock.now().toISOString();
    const context = input.context ?? {};
    const contextHash = computeContextHash(context);
    const hashInput = {
      actor: input.actor,
      on_behalf_of: input.on_behalf_of ?? null,
      action: input.action,
      resource: input.resource,
      decision: input.decision ?? null,
      policy_ids: input.policy_ids ?? null,
      context_hash: contextHash,
      ts,
      seq,
    };
    const hash = computeAuditHash(prevHash, hashInput);
    const record: AuditEventRecord = {
      id: this.idGen.uuidv7(),
      org_id: orgId,
      prev_hash: prevHash,
      hash,
      context,
      ...hashInput,
    };
    list.push(record);
    this.auditEvents.set(orgId, list);
    return record;
  }

  async listAuditEvents(
    orgId: string,
    opts: { limit?: number; cursor?: string; action?: string },
  ): Promise<{ data: AuditEventRecord[]; next_cursor: string | null }> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    let events = [...(this.auditEvents.get(orgId) ?? [])].sort((a, b) => b.seq - a.seq);
    if (opts.action) {
      events = events.filter((e) => e.action === opts.action);
    }
    if (opts.cursor) {
      const cursorSeq = Number(opts.cursor);
      events = events.filter((e) => e.seq < cursorSeq);
    }
    const page = events.slice(0, limit);
    const nextCursor =
      events.length > limit && page.length > 0 ? String(page[page.length - 1]!.seq) : null;
    return { data: page, next_cursor: nextCursor };
  }

  async getIdempotency(
    orgId: string,
    principalId: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const rec = this.idempotency.get(`${orgId}:${principalId}:${key}`);
    if (!rec) return null;
    if (this.clock.now().getTime() >= Date.parse(rec.expires_at)) {
      this.idempotency.delete(`${orgId}:${principalId}:${key}`);
      return null;
    }
    return rec;
  }

  async saveIdempotency(rec: IdempotencyRecord): Promise<void> {
    this.idempotency.set(`${rec.org_id}:${rec.principal_id}:${rec.key}`, rec);
  }
}

/**
 * PostgreSQL / Kysely connection wrapper for production Compose/Kubernetes execution.
 * Uses `@elshad/db`'s `withTenantTx` so every query runs behind `SET LOCAL app.org_id`.
 */
export function createDbHealthChecker(connectionString: string): {
  check(): Promise<boolean>;
  close(): Promise<void>;
} {
  const pool = createPgPool(connectionString, 5);
  const db = createKysely(pool);
  return {
    async check(): Promise<boolean> {
      try {
        await withTenantTx(
          db,
          {
            orgId: '00000000-0000-0000-0000-000000000000' as never,
            principal: { id: '00000000-0000-0000-0000-000000000000' as never, type: 'service_account' },
          },
          async (tx) => {
            await tx.selectFrom('organizations').select('id').limit(1).execute();
          },
        );
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
