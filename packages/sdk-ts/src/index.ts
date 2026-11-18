import { PlatformError, type ErrorCode } from '@elshad/domain';

export interface WorkspaceDto {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  orgId: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  maxAutonomyLevel: string;
  createdAt: string;
}

export interface EnvironmentDto {
  id: string;
  workspaceId: string;
  kind: 'dev' | 'staging' | 'prod';
  name: string;
}

export interface PrincipalDto {
  id: string;
  orgId: string;
  type: 'user' | 'group' | 'service_account' | 'agent';
  email: string | null;
  displayName: string;
}

export interface RoleBindingDto {
  id: string;
  principalId: string;
  roleId: string;
  roleName: string;
  scopeType: 'org' | 'workspace' | 'project' | 'resource';
  scopeId: string;
  createdAt: string;
}

export interface MeDto {
  principal: PrincipalDto;
  orgId: string;
  orgSlug: string;
  orgName: string;
  bindings: RoleBindingDto[];
  workspaces: WorkspaceDto[];
}

export interface CapabilitiesDto {
  edition: 'community' | 'enterprise';
  featureFlags: string[];
  modules: string[];
}

export interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  workspaceId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  secret: string;
}

export interface AuditEventDto {
  id: string;
  seq: number;
  ts: string;
  actor: Record<string, unknown>;
  action: string;
  resource: Record<string, unknown>;
  decision: string | null;
  hash: string;
  prevHash: string;
}

export interface RoleDto {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface PlatformClientOptions {
  baseUrl: string;
  token?: string;
  workspaceId?: string;
  environment?: 'dev' | 'staging' | 'prod';
  csrfToken?: string;
  fetchImpl?: typeof fetch;
}

interface WireErrorEnvelope {
  error?: {
    code?: ErrorCode;
    message?: string;
    details?: Record<string, unknown>;
  };
}

function mapWorkspace(w: Record<string, unknown>): WorkspaceDto {
  return {
    id: String(w.id),
    orgId: String(w.org_id),
    slug: String(w.slug),
    name: String(w.name),
    createdAt: String(w.created_at),
  };
}

function mapProject(p: Record<string, unknown>): ProjectDto {
  return {
    id: String(p.id),
    orgId: String(p.org_id),
    workspaceId: String(p.workspace_id),
    slug: String(p.slug),
    name: String(p.name),
    description: p.description ? String(p.description) : null,
    maxAutonomyLevel: String(p.max_autonomy_level),
    createdAt: String(p.created_at),
  };
}

function mapApiKey(k: Record<string, unknown>): ApiKeyDto {
  return {
    id: String(k.id),
    name: String(k.name),
    keyPrefix: String(k.key_prefix),
    scopes: Array.isArray(k.scopes) ? k.scopes.map(String) : [],
    workspaceId: k.workspace_id ? String(k.workspace_id) : null,
    expiresAt: k.expires_at ? String(k.expires_at) : null,
    lastUsedAt: k.last_used_at ? String(k.last_used_at) : null,
    revokedAt: k.revoked_at ? String(k.revoked_at) : null,
    createdAt: String(k.created_at),
  };
}

function mapAudit(a: Record<string, unknown>): AuditEventDto {
  return {
    id: String(a.id),
    seq: Number(a.seq),
    ts: String(a.ts),
    actor: (a.actor as Record<string, unknown>) ?? {},
    action: String(a.action),
    resource: (a.resource as Record<string, unknown>) ?? {},
    decision: a.decision ? String(a.decision) : null,
    hash: String(a.hash),
    prevHash: String(a.prev_hash),
  };
}

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token?: string;
  private workspaceId?: string;
  private environment?: 'dev' | 'staging' | 'prod';
  private csrfToken?: string;

  constructor(opts: PlatformClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.token = opts.token;
    this.workspaceId = opts.workspaceId;
    this.environment = opts.environment;
    this.csrfToken = opts.csrfToken;
  }

  setScope(scope: { workspaceId?: string; environment?: 'dev' | 'staging' | 'prod' }): void {
    this.workspaceId = scope.workspaceId;
    this.environment = scope.environment;
  }

  setAuth(auth: { token?: string; csrfToken?: string }): void {
    this.token = auth.token;
    this.csrfToken = auth.csrfToken;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.workspaceId) {
      headers['X-Workspace-Id'] = this.workspaceId;
    }
    if (this.environment) {
      headers['X-Environment'] = this.environment;
    }
    if (this.csrfToken && method !== 'GET') {
      headers['x-csrf-token'] = this.csrfToken;
    }
    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};

    if (!res.ok) {
      const errEnv = json as WireErrorEnvelope;
      const code = errEnv.error?.code ?? 'SYS_INTERNAL';
      const msg = errEnv.error?.message ?? `HTTP ${res.status}`;
      throw new PlatformError(code, msg, errEnv.error?.details ?? {}, res.status);
    }

    return json as T;
  }

  async health(): Promise<{ status: string }> {
    return this.request('GET', '/health');
  }

  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    return this.request('GET', '/ready');
  }

  async version(): Promise<{ version: string; edition: string }> {
    return this.request('GET', '/version');
  }

  async capabilities(): Promise<CapabilitiesDto> {
    const res = await this.request<{
      edition: 'community' | 'enterprise';
      feature_flags: string[];
      modules: string[];
    }>('GET', '/api/v1/capabilities');
    return {
      edition: res.edition,
      featureFlags: res.feature_flags,
      modules: res.modules,
    };
  }

  readonly auth = {
    login: async (email: string, password: string): Promise<{ csrfToken: string; me: MeDto }> => {
      const res = await this.request<{ csrf_token: string; me: Record<string, unknown> }>(
        'POST',
        '/api/v1/auth/login',
        { body: { email, password } },
      );
      this.csrfToken = res.csrf_token;
      return {
        csrfToken: res.csrf_token,
        me: await this.auth.me(),
      };
    },
    logout: async (): Promise<void> => {
      await this.request('POST', '/api/v1/auth/logout');
      this.csrfToken = undefined;
    },
    me: async (): Promise<MeDto> => {
      const res = await this.request<Record<string, unknown>>('GET', '/api/v1/me');
      const p = res.principal as Record<string, unknown>;
      return {
        principal: {
          id: String(p.id),
          orgId: String(p.org_id),
          type: p.type as PrincipalDto['type'],
          email: p.email ? String(p.email) : null,
          displayName: String(p.display_name),
        },
        orgId: String(res.org_id),
        orgSlug: String(res.org_slug),
        orgName: String(res.org_name),
        bindings: ((res.bindings as Record<string, unknown>[]) ?? []).map((b) => ({
          id: String(b.id),
          principalId: String(b.principal_id),
          roleId: String(b.role_id),
          roleName: String(b.role_name),
          scopeType: b.scope_type as RoleBindingDto['scopeType'],
          scopeId: String(b.scope_id),
          createdAt: String(b.created_at),
        })),
        workspaces: ((res.workspaces as Record<string, unknown>[]) ?? []).map(mapWorkspace),
      };
    },
  };

  readonly workspaces = {
    list: async (): Promise<WorkspaceDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/workspaces',
      );
      return res.data.map(mapWorkspace);
    },
    create: async (
      input: { slug: string; name: string },
      idempotencyKey: string,
    ): Promise<WorkspaceDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/workspaces', {
        body: input,
        idempotencyKey,
      });
      return mapWorkspace(res);
    },
    get: async (id: string): Promise<WorkspaceDto> => {
      const res = await this.request<Record<string, unknown>>('GET', `/api/v1/workspaces/${id}`);
      return mapWorkspace(res);
    },
    update: async (id: string, input: { name: string }): Promise<WorkspaceDto> => {
      const res = await this.request<Record<string, unknown>>('PATCH', `/api/v1/workspaces/${id}`, {
        body: input,
      });
      return mapWorkspace(res);
    },
  };

  readonly projects = {
    list: async (workspaceId: string): Promise<ProjectDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/workspaces/${workspaceId}/projects`,
      );
      return res.data.map(mapProject);
    },
    create: async (
      workspaceId: string,
      input: { slug: string; name: string; description?: string },
      idempotencyKey: string,
    ): Promise<ProjectDto> => {
      const res = await this.request<Record<string, unknown>>(
        'POST',
        `/api/v1/workspaces/${workspaceId}/projects`,
        { body: input, idempotencyKey },
      );
      return mapProject(res);
    },
  };

  readonly environments = {
    list: async (workspaceId: string): Promise<EnvironmentDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/workspaces/${workspaceId}/environments`,
      );
      return res.data.map((e) => ({
        id: String(e.id),
        workspaceId: String(e.workspace_id),
        kind: e.kind as EnvironmentDto['kind'],
        name: String(e.name),
      }));
    },
  };

  readonly roles = {
    list: async (): Promise<RoleDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>('GET', '/api/v1/roles');
      return res.data.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        isSystem: Boolean(r.is_system),
      }));
    },
  };

  readonly roleBindings = {
    list: async (): Promise<RoleBindingDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/role-bindings',
      );
      return res.data.map((b) => ({
        id: String(b.id),
        principalId: String(b.principal_id),
        roleId: String(b.role_id),
        roleName: String(b.role_name),
        scopeType: b.scope_type as RoleBindingDto['scopeType'],
        scopeId: String(b.scope_id),
        createdAt: String(b.created_at),
      }));
    },
    create: async (
      input: {
        principalId: string;
        roleName: string;
        scopeType: 'org' | 'workspace' | 'project' | 'resource';
        scopeId: string;
      },
      idempotencyKey: string,
    ): Promise<RoleBindingDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/role-bindings', {
        body: {
          principal_id: input.principalId,
          role_name: input.roleName,
          scope_type: input.scopeType,
          scope_id: input.scopeId,
        },
        idempotencyKey,
      });
      return {
        id: String(res.id),
        principalId: String(res.principal_id),
        roleId: String(res.role_id),
        roleName: String(res.role_name),
        scopeType: res.scope_type as RoleBindingDto['scopeType'],
        scopeId: String(res.scope_id),
        createdAt: String(res.created_at),
      };
    },
    delete: async (id: string): Promise<void> => {
      await this.request('DELETE', `/api/v1/role-bindings/${id}`);
    },
  };

  readonly apiKeys = {
    list: async (): Promise<ApiKeyDto[]> => {
      const res = await this.request<{ data: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/api-keys',
      );
      return res.data.map(mapApiKey);
    },
    create: async (
      input: { name: string; scopes?: string[]; workspaceId?: string },
      idempotencyKey: string,
    ): Promise<CreatedApiKeyDto> => {
      const res = await this.request<Record<string, unknown>>('POST', '/api/v1/api-keys', {
        body: {
          name: input.name,
          scopes: input.scopes ?? [],
          workspace_id: input.workspaceId,
        },
        idempotencyKey,
      });
      return {
        ...mapApiKey(res),
        secret: String(res.secret),
      };
    },
    revoke: async (id: string): Promise<void> => {
      await this.request('DELETE', `/api/v1/api-keys/${id}`);
    },
  };

  readonly auditEvents = {
    list: async (opts: { limit?: number; cursor?: string } = {}): Promise<{
      data: AuditEventDto[];
      nextCursor: string | null;
    }> => {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      const qs = params.toString();
      const res = await this.request<{ data: Record<string, unknown>[]; next_cursor: string | null }>(
        'GET',
        `/api/v1/audit-events${qs ? `?${qs}` : ''}`,
      );
      return {
        data: res.data.map(mapAudit),
        nextCursor: res.next_cursor ?? null,
      };
    },
  };
}
