import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import type { ZodTypeAny } from 'zod';
import {
  S01_ROUTES,
  generateOpenApiDocument,
  type RouteContract,
} from '@elshad/api-contract';
import {
  authorize,
  requirePermission,
  type AuthzSubject,
  type Permission,
} from '@elshad/authz';
import type { PlatformConfig } from '@elshad/config';
import { canonicalJson } from '@elshad/db';
import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  toErrorEnvelope,
  type Clock,
  type EnvironmentKind,
  type IdGen,
} from '@elshad/domain';
import {
  InMemoryCache,
  SlidingWindowRateLimiter,
  type Cache,
} from '@elshad/platform-kit';
import {
  authEventsTotal,
  createLogger,
  defaultMetrics,
  formatTraceparent,
  getActiveTraceContext,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  runWithLogContext,
  withSpan,
  type PlatformLogger,
} from '@elshad/telemetry';
import {
  InMemoryIamAuditStore,
  type AuthPrincipalContext,
  type IamAuditStore,
} from './store.js';

export type OidcCallbackExchange = (input: {
  code: string;
  codeVerifier: string;
  expectedNonce: string;
  redirectUri: string;
}) => Promise<{ externalId: string; email: string; displayName: string }>;

export interface ApiServerOptions {
  config: PlatformConfig;
  store?: IamAuditStore;
  cache?: Cache;
  clock?: Clock;
  idGen?: IdGen;
  logger?: PlatformLogger;
  oidcExchange?: OidcCallbackExchange;
  rateLimits?: {
    public?: number;
    auth?: number;
    read?: number;
    write?: number;
  };
  checkDependencies?: () => Promise<Record<string, 'ok' | 'error'>>;
}

interface RequestState {
  requestId: string;
  traceId: string;
  auth?: {
    kind: 'session' | 'api_key';
    sessionId?: string;
    csrfToken?: string;
    subject: AuthzSubject;
    context: AuthPrincipalContext;
  };
  workspaceId?: string;
  environment?: EnvironmentKind;
}

declare module 'fastify' {
  interface FastifyRequest {
    platformState?: RequestState;
  }
}

const SESSION_COOKIE_NAME = 'platform_session';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function buildApiServer(opts: ApiServerOptions): {
  app: FastifyInstance;
  store: IamAuditStore;
} {
  const clock = opts.clock ?? new SystemClock();
  const idGen = opts.idGen ?? new SystemIdGen();
  const logger =
    opts.logger ?? createLogger({ service: 'api', level: opts.config.PLATFORM_LOG_LEVEL });
  const cache = opts.cache ?? new InMemoryCache(clock);
  const limiter = new SlidingWindowRateLimiter(cache, clock);

  const store: IamAuditStore =
    opts.store ??
    new InMemoryIamAuditStore({
      adminEmail: opts.config.PLATFORM_ADMIN_EMAIL ?? 'admin@elshad.local',
      adminPassword: opts.config.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe123!',
      apiKeyPepper: opts.config.PLATFORM_API_KEY_PEPPER,
      clock,
      idGen,
    });

  const rateLimitCfg = {
    public: opts.rateLimits?.public ?? 1200,
    auth: opts.rateLimits?.auth ?? 120,
    read: opts.rateLimits?.read ?? 600,
    write: opts.rateLimits?.write ?? 300,
  };

  const pendingOidc = new Map<
    string,
    { codeVerifier: string; nonce: string; createdAtMs: number }
  >();

  const app = Fastify({ logger: false });

  void app.register(cookie);
  void app.register(cors, {
    origin: opts.config.PLATFORM_CORS_ORIGIN,
    credentials: true,
  });

  const routeMap = new Map<string, RouteContract>();
  for (const r of S01_ROUTES) {
    routeMap.set(`${r.method.toUpperCase()} ${r.path}`, r);
  }

  function findContract(method: string, routePath: string): RouteContract | undefined {
    const normalized = routePath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    return routeMap.get(`${method.toUpperCase()} ${normalized}`);
  }

  function validateWithSchema<T>(schema: ZodTypeAny | undefined, value: unknown): T {
    if (!schema) return value as T;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const details = {
        issues: parsed.error.issues.map((i) => ({
          pointer: `/${i.path.join('/')}`,
          message: i.message,
        })),
      };
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        details,
      );
    }
    return parsed.data as T;
  }

  async function authenticate(req: FastifyRequest): Promise<NonNullable<RequestState['auth']>> {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice('Bearer '.length).trim();
      const resolved = await store.resolveApiKey(rawToken);
      if (!resolved) {
        authEventsTotal.inc({ outcome: 'invalid_api_key' });
        throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid or revoked API key.');
      }
      const context = await store.getPrincipalContext(
        resolved.principal.org_id,
        resolved.principal.id,
      );
      return {
        kind: 'api_key',
        subject: {
          principalId: context.principal.id,
          orgId: context.org.id,
          bindings: context.bindings,
          apiKeyScopes:
            resolved.apiKey.scopes.length > 0 ? resolved.apiKey.scopes : undefined,
        },
        context,
      };
    }

    const sessionId = req.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Authentication required.');
    }
    const session = await store.getSession(sessionId);
    if (!session) {
      throw new PlatformError('AUTH_TOKEN_EXPIRED', 'Session expired or invalid.');
    }

    const method = req.method.toUpperCase();
    if (
      method !== 'GET' &&
      method !== 'HEAD' &&
      method !== 'OPTIONS' &&
      !req.url.startsWith('/api/v1/auth/login')
    ) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (typeof csrfHeader !== 'string' || csrfHeader !== session.csrf_token) {
        throw new PlatformError('AUTH_FORBIDDEN', 'Invalid or missing CSRF token.');
      }
    }

    const context = await store.getPrincipalContext(session.org_id, session.principal_id);
    return {
      kind: 'session',
      sessionId: session.id,
      csrfToken: session.csrf_token,
      subject: {
        principalId: context.principal.id,
        orgId: context.org.id,
        bindings: context.bindings,
      },
      context,
    };
  }

  function applyRateLimitHeaders(
    reply: FastifyReply,
    res: { limit: number; remaining: number; resetEpochSeconds: number },
  ): void {
    reply.header('X-RateLimit-Limit', String(res.limit));
    reply.header('X-RateLimit-Remaining', String(res.remaining));
    reply.header('X-RateLimit-Reset', String(res.resetEpochSeconds));
  }

  app.addHook('onRequest', async (req, reply) => {
    const requestId = `req_${idGen.uuidv7()}`;
    const incomingTp =
      typeof req.headers.traceparent === 'string' ? req.headers.traceparent : undefined;

    await withSpan(
      `http.${req.method.toLowerCase()}`,
      { method: req.method, path: req.url },
      async (traceCtx) => {
        req.platformState = {
          requestId,
          traceId: traceCtx.traceId,
        };
        reply.header('x-request-id', requestId);
        reply.header('x-trace-id', traceCtx.traceId);
        reply.header('traceparent', formatTraceparent(traceCtx));
      },
      incomingTp,
    );
  });

  app.addHook('preHandler', async (req, reply) => {
    const state = req.platformState!;
    const routePath = req.routeOptions?.url ?? req.url.split('?')[0] ?? '/';
    const contract = findContract(req.method, routePath);

    // Non-contract utility endpoints (/openapi.json, /metrics)
    if (!contract) {
      return;
    }

    const rlLimit = rateLimitCfg[contract.rateLimitClass];
    const clientIp = req.ip || 'local';
    const rlKey = `rl:${contract.rateLimitClass}:${clientIp}`;
    const rl = await limiter.consume(rlKey, rlLimit, 60_000);
    applyRateLimitHeaders(reply, rl);
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      throw new PlatformError('BUD_RATE_LIMITED', 'Rate limit exceeded.', {
        limit: rl.limit,
        retry_after_seconds: rl.retryAfterSeconds,
      });
    }

    if (contract.access.kind !== 'public') {
      const auth = await authenticate(req);
      state.auth = auth;

      // Resolve optional tenancy scope headers
      const wsHeader = req.headers['x-workspace-id'];
      if (typeof wsHeader === 'string' && wsHeader.length > 0) {
        const ws = await store.getWorkspace(auth.context.org.id, wsHeader);
        if (!ws) {
          throw new PlatformError('RES_NOT_FOUND', `Workspace ${wsHeader} not found.`);
        }
        state.workspaceId = ws.id;
      } else if (auth.context.workspaces[0]) {
        state.workspaceId = auth.context.workspaces[0].id;
      }

      const envHeader = req.headers['x-environment'];
      if (
        envHeader === 'dev' ||
        envHeader === 'staging' ||
        envHeader === 'prod'
      ) {
        state.environment = envHeader;
      }

      // Permission check
      if (contract.access.kind === 'permission') {
        const targetScope = {
          orgId: auth.context.org.id,
          workspaceId:
            (req.params as Record<string, string> | undefined)?.id &&
            contract.scope === 'workspace'
              ? (req.params as Record<string, string>).id
              : state.workspaceId,
        };

        if (contract.access.ownAllowed) {
          // For ownAllowed routes (e.g. api_key:manage), allow if either all-grant OR own-grant
          const allDecision = authorize(auth.subject, contract.access.permission, targetScope);
          const ownDecision = authorize(auth.subject, contract.access.permission, targetScope, {
            ownerId: auth.subject.principalId,
          });
          if (!allDecision.allowed && !ownDecision.allowed) {
            throw new PlatformError('AUTH_FORBIDDEN', ownDecision.reason, {
              permission: contract.access.permission,
            });
          }
        } else {
          requirePermission(auth.subject, contract.access.permission, targetScope);
        }
      }

      // Idempotency enforcement on idempotent POST routes
      if (contract.idempotent && req.method.toUpperCase() === 'POST') {
        const idemKey = req.headers['idempotency-key'];
        if (typeof idemKey !== 'string' || idemKey.trim().length === 0) {
          throw new PlatformError(
            'VAL_SCHEMA_MISMATCH',
            'Idempotency-Key header is required on this endpoint.',
            { header: 'Idempotency-Key' },
          );
        }
        const reqHash = createHash('sha256')
          .update(`${req.method}:${routePath}:${canonicalJson(req.body ?? {})}`)
          .digest('hex');

        const existing = await store.getIdempotency(
          auth.context.org.id,
          auth.subject.principalId,
          idemKey,
        );
        if (existing) {
          if (existing.request_hash !== reqHash) {
            throw new PlatformError(
              'VAL_SCHEMA_MISMATCH',
              'Idempotency-Key reused with a different request payload.',
              { idempotency_key: idemKey },
            );
          }
          reply.header('X-Idempotency-Replayed', 'true');
          return reply.status(existing.response_status).send(existing.response_body);
        }
      }
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    httpRequestsTotal.inc({ method: req.method, route, status: reply.statusCode });
    httpRequestDurationSeconds.observe(reply.elapsedTime / 1000, {
      method: req.method,
      route,
    });
    const state = req.platformState;
    runWithLogContext(
      {
        trace_id: state?.traceId ?? getActiveTraceContext()?.traceId,
        org_id: state?.auth?.context.org.id ?? null,
        workspace_id: state?.workspaceId ?? null,
        principal_id: state?.auth?.subject.principalId ?? null,
      },
      () => {
        logger.info('http request completed', {
          method: req.method,
          route,
          status: reply.statusCode,
          request_id: state?.requestId,
        });
      },
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const state = req.platformState;
    const requestId = state?.requestId ?? `req_${idGen.uuidv7()}`;
    const traceId = state?.traceId ?? '0'.repeat(32);

    if (err instanceof PlatformError && err.code === 'BUD_RATE_LIMITED') {
      const retry = err.details.retry_after_seconds;
      if (typeof retry === 'number') {
        reply.header('Retry-After', String(retry));
      }
    }

    const mapped = toErrorEnvelope(err, requestId, traceId);
    if (mapped.status >= 500) {
      logger.error('unhandled api error', {
        err_message: err instanceof Error ? err.message : String(err),
        request_id: requestId,
        trace_id: traceId,
      });
    }
    return reply.status(mapped.status).send(mapped.body);
  });

  async function persistIdempotencyIfNeeded(
    req: FastifyRequest,
    routePath: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    const idemKey = req.headers['idempotency-key'];
    const auth = req.platformState?.auth;
    if (typeof idemKey !== 'string' || !auth) return;

    const reqHash = createHash('sha256')
      .update(`${req.method}:${routePath}:${canonicalJson(req.body ?? {})}`)
      .digest('hex');

    await store.saveIdempotency({
      org_id: auth.context.org.id,
      principal_id: auth.subject.principalId,
      key: idemKey,
      request_hash: reqHash,
      response_status: status,
      response_body: body,
      expires_at: new Date(clock.now().getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    });
  }

  function formatMe(ctx: AuthPrincipalContext) {
    return {
      principal: {
        id: ctx.principal.id,
        org_id: ctx.principal.org_id,
        type: ctx.principal.type,
        email: ctx.principal.email,
        display_name: ctx.principal.display_name,
      },
      org_id: ctx.org.id,
      org_slug: ctx.org.slug,
      org_name: ctx.org.name,
      bindings: ctx.rawBindings.map((b) => ({
        id: b.id,
        principal_id: b.principal_id,
        role_id: b.role_id,
        role_name: b.role_name,
        scope_type: b.scope_type,
        scope_id: b.scope_id,
        created_at: b.created_at,
      })),
      workspaces: ctx.workspaces,
    };
  }

  // --- Meta & OpenAPI ---
  app.get('/health', async () => ({ status: 'ok', service: 'api' }));

  app.get('/ready', async (_req, reply) => {
    const checks = opts.checkDependencies
      ? await opts.checkDependencies()
      : { postgres: (await store.checkHealth()) ? ('ok' as const) : ('error' as const) };
    const allOk = Object.values(checks).every((v) => v === 'ok');
    if (!allOk) {
      return reply.status(503).send({ status: 'degraded', checks });
    }
    return { status: 'ready', checks };
  });

  app.get('/version', async () => ({
    version: '0.1.0',
    edition: opts.config.PLATFORM_EDITION,
  }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return defaultMetrics.renderPrometheus();
  });

  const cachedOpenApi = generateOpenApiDocument();
  app.get('/openapi.json', async () => cachedOpenApi);

  app.get('/api/v1/capabilities', async () => ({
    edition: opts.config.PLATFORM_EDITION,
    feature_flags: opts.config.PLATFORM_FEATURE_FLAGS,
    modules: ['auth', 'tenancy', 'iam', 'audit'],
  }));

  // --- Auth ---
  app.post('/api/v1/auth/login', async (req, reply) => {
    if (!opts.config.PLATFORM_LOCAL_AUTH_ENABLED) {
      throw new PlatformError('AUTH_FORBIDDEN', 'Local password login is disabled.');
    }
    const contract = findContract('POST', '/api/v1/auth/login')!;
    const body = validateWithSchema<{ email: string; password: string }>(
      contract.bodySchema,
      req.body,
    );

    const { principal } = await store.authenticateLocal(body.email, body.password);
    const { session } = await store.createSession(principal);
    const ctx = await store.getPrincipalContext(principal.org_id, principal.id);

    await store.appendAudit(principal.org_id, {
      actor: { id: principal.id, type: principal.type, email: principal.email },
      action: 'auth.login',
      resource: { type: 'session', id: session.id },
      decision: 'allow',
    });
    authEventsTotal.inc({ outcome: 'login_success' });

    reply.setCookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    });

    return {
      csrf_token: session.csrf_token,
      me: formatMe(ctx),
    };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const auth = req.platformState!.auth!;
    if (auth.sessionId) {
      await store.revokeSession(auth.sessionId, auth.context.org.id);
    }
    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'auth.logout',
      resource: { type: 'session', id: auth.sessionId ?? 'api_key' },
      decision: 'allow',
    });
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.post('/api/v1/auth/refresh', async (req) => {
    const auth = req.platformState!.auth!;
    if (!auth.sessionId) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'No active session to refresh.');
    }
    const { session } = await store.refreshSession(auth.sessionId);
    return { csrf_token: session.csrf_token };
  });

  app.get('/api/v1/auth/oidc/authorize', async () => {
    const issuer = opts.config.PLATFORM_OIDC_ISSUER ?? 'https://oidc.example.local';
    const clientId = opts.config.PLATFORM_OIDC_CLIENT_ID ?? 'elshad-console';
    const redirectUri = `${opts.config.PLATFORM_BASE_URL.replace(/\/+$/, '')}/api/v1/auth/oidc/callback`;
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    pendingOidc.set(state, {
      codeVerifier,
      nonce,
      createdAtMs: clock.now().getTime(),
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      authorize_url: `${issuer.replace(/\/+$/, '')}/authorize?${params.toString()}`,
      state,
    };
  });

  app.get('/api/v1/auth/oidc/callback', async (req, reply) => {
    const contract = findContract('GET', '/api/v1/auth/oidc/callback')!;
    const query = validateWithSchema<{ code: string; state: string }>(
      contract.querySchema,
      req.query,
    );

    const tx = pendingOidc.get(query.state);
    if (!tx) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid or expired OIDC state.');
    }
    pendingOidc.delete(query.state);

    if (clock.now().getTime() - tx.createdAtMs > 10 * 60 * 1000) {
      throw new PlatformError('AUTH_TOKEN_EXPIRED', 'OIDC authorization transaction expired.');
    }

    const redirectUri = `${opts.config.PLATFORM_BASE_URL.replace(/\/+$/, '')}/api/v1/auth/oidc/callback`;
    if (!opts.oidcExchange) {
      throw new PlatformError(
        'SYS_UNAVAILABLE',
        'OIDC provider is not configured for runtime exchange in this environment.',
      );
    }

    const identity = await opts.oidcExchange({
      code: query.code,
      codeVerifier: tx.codeVerifier,
      expectedNonce: tx.nonce,
      redirectUri,
    });

    const { principal } = await store.authenticateOidcSubject(identity);
    const { session } = await store.createSession(principal);
    const ctx = await store.getPrincipalContext(principal.org_id, principal.id);

    await store.appendAudit(principal.org_id, {
      actor: { id: principal.id, type: principal.type, email: principal.email },
      action: 'auth.oidc_login',
      resource: { type: 'session', id: session.id },
      decision: 'allow',
    });

    reply.setCookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    });

    return {
      csrf_token: session.csrf_token,
      me: formatMe(ctx),
    };
  });

  app.get('/api/v1/me', async (req) => {
    return formatMe(req.platformState!.auth!.context);
  });

  // --- Tenancy ---
  app.get('/api/v1/workspaces', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const data = await store.listWorkspaces(orgId);
    return { data };
  });

  app.post('/api/v1/workspaces', async (req, reply) => {
    const routePath = '/api/v1/workspaces';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{ slug: string; name: string }>(
      contract.bodySchema,
      req.body,
    );
    const auth = req.platformState!.auth!;
    const ws = await store.createWorkspace(auth.context.org.id, body);

    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'workspace.create',
      resource: { type: 'workspace', id: ws.id, slug: ws.slug },
      decision: 'allow',
    });

    await persistIdempotencyIfNeeded(req, routePath, 201, ws);
    return reply.status(201).send(ws);
  });

  app.get('/api/v1/workspaces/:id', async (req) => {
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const ws = await store.getWorkspace(auth.context.org.id, id);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${id} not found.`);
    }
    return ws;
  });

  app.patch('/api/v1/workspaces/:id', async (req) => {
    const contract = findContract('PATCH', '/api/v1/workspaces/{id}')!;
    const body = validateWithSchema<{ name: string }>(contract.bodySchema, req.body);
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const ws = await store.updateWorkspace(auth.context.org.id, id, body);

    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'workspace.update',
      resource: { type: 'workspace', id: ws.id },
      decision: 'allow',
    });
    return ws;
  });

  app.get('/api/v1/workspaces/:id/projects', async (req) => {
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const data = await store.listProjects(auth.context.org.id, id);
    return { data };
  });

  app.post('/api/v1/workspaces/:id/projects', async (req, reply) => {
    const routePath = '/api/v1/workspaces/{id}/projects';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{ slug: string; name: string; description?: string }>(
      contract.bodySchema,
      req.body,
    );
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const project = await store.createProject(auth.context.org.id, id, body);

    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'project.create',
      resource: { type: 'project', id: project.id, workspace_id: id },
      decision: 'allow',
    });

    await persistIdempotencyIfNeeded(req, routePath, 201, project);
    return reply.status(201).send(project);
  });

  app.get('/api/v1/workspaces/:id/environments', async (req) => {
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const data = await store.listEnvironments(auth.context.org.id, id);
    return { data };
  });

  // --- IAM ---
  app.get('/api/v1/roles', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const data = await store.listRoles(orgId);
    return { data };
  });

  app.get('/api/v1/role-bindings', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const data = await store.listRoleBindings(orgId);
    return { data };
  });

  app.post('/api/v1/role-bindings', async (req, reply) => {
    const routePath = '/api/v1/role-bindings';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      principal_id: string;
      role_name: string;
      scope_type: 'org' | 'workspace' | 'project' | 'resource';
      scope_id: string;
    }>(contract.bodySchema, req.body);
    const auth = req.platformState!.auth!;
    const binding = await store.createRoleBinding(auth.context.org.id, body);

    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'role_binding.create',
      resource: { type: 'role_binding', id: binding.id, role: binding.role_name },
      decision: 'allow',
    });

    await persistIdempotencyIfNeeded(req, routePath, 201, binding);
    return reply.status(201).send(binding);
  });

  app.delete('/api/v1/role-bindings/:id', async (req, reply) => {
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const deleted = await store.deleteRoleBinding(auth.context.org.id, id);
    if (!deleted) {
      throw new PlatformError('RES_NOT_FOUND', `Role binding ${id} not found.`);
    }
    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'role_binding.delete',
      resource: { type: 'role_binding', id },
      decision: 'allow',
    });
    return reply.status(204).send();
  });

  app.get('/api/v1/api-keys', async (req) => {
    const auth = req.platformState!.auth!;
    const hasAll = authorize(auth.subject, 'api_key:manage', {
      orgId: auth.context.org.id,
      workspaceId: req.platformState!.workspaceId,
    }).allowed;

    const rows = await store.listApiKeys(
      auth.context.org.id,
      hasAll ? undefined : auth.subject.principalId,
    );
    return {
      data: rows.map(({ key_hash: _hash, ...safe }) => safe),
    };
  });

  app.post('/api/v1/api-keys', async (req, reply) => {
    const routePath = '/api/v1/api-keys';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      name: string;
      scopes: string[];
      workspace_id?: string;
    }>(contract.bodySchema, req.body);
    const auth = req.platformState!.auth!;

    const { record, secret } = await store.createApiKey(auth.context.org.id, {
      principal_id: auth.subject.principalId,
      name: body.name,
      scopes: body.scopes as Permission[],
      workspace_id: body.workspace_id,
    });

    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'api_key.create',
      resource: { type: 'api_key', id: record.id, key_prefix: record.key_prefix },
      decision: 'allow',
    });

    const { key_hash: _hash, ...safeRecord } = record;
    const responseBody = { ...safeRecord, secret };
    await persistIdempotencyIfNeeded(req, routePath, 201, responseBody);
    return reply.status(201).send(responseBody);
  });

  app.delete('/api/v1/api-keys/:id', async (req, reply) => {
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };
    const existing = await store.getApiKey(auth.context.org.id, id);
    if (!existing) {
      throw new PlatformError('RES_NOT_FOUND', `API key ${id} not found.`);
    }

    requirePermission(
      auth.subject,
      'api_key:manage',
      { orgId: auth.context.org.id, workspaceId: req.platformState!.workspaceId },
      { ownerId: existing.principal_id },
    );

    await store.revokeApiKey(auth.context.org.id, id);
    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'api_key.revoke',
      resource: { type: 'api_key', id },
      decision: 'allow',
    });
    return reply.status(204).send();
  });

  // --- Audit ---
  app.get('/api/v1/audit-events', async (req) => {
    const contract = findContract('GET', '/api/v1/audit-events')!;
    const query = validateWithSchema<{ limit?: number; cursor?: string; action?: string }>(
      contract.querySchema,
      req.query,
    );
    const auth = req.platformState!.auth!;
    return store.listAuditEvents(auth.context.org.id, query);
  });

  return { app, store };
}
