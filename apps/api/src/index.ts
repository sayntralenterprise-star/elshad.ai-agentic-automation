import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import type { ZodTypeAny } from 'zod';
import {
  ALL_ROUTES,
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
  type EnvironmentId,
  type EnvironmentKind,
  type IdGen,
  type OrgId,
  type PrincipalId,
  type RunStatus,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import {
  InMemoryEffectLedger,
  InMemoryExecutionEngine,
  type EffectLedger,
  type ExecutionEngine,
  type RunLimits,
  type TurnStepInput,
} from '@elshad/execution';
import {
  MockModelProvider,
  ModelGateway,
  type MockTurnBehavior,
  type ModelCapability,
} from '@elshad/model-kit';
import {
  InMemoryCache,
  SlidingWindowRateLimiter,
  type Cache,
} from '@elshad/platform-kit';
import type { AutonomyLevel } from '@elshad/policy-kit';
import {
  InMemoryUsageLedger,
  diffAgentDefinitions,
  executeReActAgentRun,
  validateAgentDefinition,
  type AgentDefinition,
  type UsageLedger,
  type UsageLedgerEntry,
} from '@elshad/runtime-core';
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
  InMemoryToolRegistry,
  ToolContractSchema,
  ToolGateway,
  type LethalTrifectaReport,
  type ToolContract,
} from '@elshad/tool-kit';
import {
  NodeRegistry,
  TriggerService,
  WorkflowGraphSchema,
  computeWorkflowHash,
  executeWorkflowGraph,
  parseWorkflowFromYaml,
  serializeWorkflowToYaml,
  validateWorkflowGraph,
  type TriggerRecord,
  type WorkflowGraph,
} from '@elshad/workflow-core';
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
  executionEngine?: ExecutionEngine;
  effectLedger?: EffectLedger;
  modelGateway?: ModelGateway;
  toolGateway?: ToolGateway;
  usageLedger?: UsageLedger;
  nodeRegistry?: NodeRegistry;
  triggerService?: TriggerService;
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
  executionEngine: ExecutionEngine;
  modelGateway: ModelGateway;
  toolGateway: ToolGateway;
  usageLedger: UsageLedger;
  triggerService: TriggerService;
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
  const executionEngine: ExecutionEngine =
    opts.executionEngine ?? new InMemoryExecutionEngine({ clock, idGen });
  const effectLedger: EffectLedger = opts.effectLedger ?? new InMemoryEffectLedger(clock);
  const toolRegistry = new InMemoryToolRegistry(true);
  const toolGateway = opts.toolGateway ?? new ToolGateway({ registry: toolRegistry, clock });
  const modelGateway =
    opts.modelGateway ??
    (() => {
      const gw = new ModelGateway({ clock });
      gw.registerProvider(new MockModelProvider());
      return gw;
    })();
  const usageLedger: UsageLedger = opts.usageLedger ?? new InMemoryUsageLedger();

  interface StoredAgentVersion {
    id: string;
    agent_id: string;
    semver: string;
    state: 'draft' | 'published' | 'retired';
    definition: AgentDefinition;
    definition_hash: string;
    message: string | null;
    lethal_trifecta: LethalTrifectaReport;
    created_by: string;
    created_at: string;
  }

  interface StoredAgent {
    id: string;
    org_id: string;
    workspace_id: string;
    project_id: string;
    name: string;
    description: string | null;
    status: 'draft' | 'active' | 'deprecated' | 'archived';
    current_version_id: string | null;
    versions: StoredAgentVersion[];
    created_at: string;
    updated_at: string;
  }

  const agentsById = new Map<string, StoredAgent>();
  const workspaceCustomTools = new Map<string, ToolContract[]>();

  const nodeRegistry = opts.nodeRegistry ?? new NodeRegistry(true);
  const triggerService = opts.triggerService ?? new TriggerService({ clock, idGen });

  interface StoredWorkflowVersion {
    id: string;
    workflow_id: string;
    semver: string;
    state: 'draft' | 'published' | 'retired';
    schema_version: number;
    graph: WorkflowGraph;
    graph_hash: string;
    yaml_source: string;
    message: string | null;
    created_by: string;
    created_at: string;
  }

  interface StoredWorkflow {
    id: string;
    org_id: string;
    workspace_id: string;
    project_id: string;
    owner_id: string;
    name: string;
    description: string | null;
    status: 'draft' | 'active' | 'paused' | 'archived';
    current_version_id: string | null;
    versions: StoredWorkflowVersion[];
    created_at: string;
    updated_at: string;
  }

  const workflowsById = new Map<string, StoredWorkflow>();

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

  // Preserve raw JSON body string so public webhook HMAC signature verification hashes exact wire bytes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    (req as FastifyRequest & { rawBodyText?: string }).rawBodyText = text;
    if (!text.trim()) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error);
    }
  });

  void app.register(cookie);
  void app.register(cors, {
    origin: opts.config.PLATFORM_CORS_ORIGIN,
    credentials: true,
  });

  const routeMap = new Map<string, RouteContract>();
  for (const r of ALL_ROUTES) {
    routeMap.set(`${r.method.toUpperCase()} ${r.path}`, r);
  }

  function findContract(method: string, routePath: string): RouteContract | undefined {
    const normalized = routePath.replace(/\/:([a-zA-Z0-9_]+)/g, '/{$1}');
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

  // --- Durable Run Core (S0.2) ---
  function buildTenantContext(req: FastifyRequest, workspaceId?: string, envId?: string): TenantContext {
    const state = req.platformState!;
    const auth = state.auth!;
    return {
      orgId: auth.context.org.id as OrgId,
      workspaceId: (workspaceId ?? state.workspaceId) as WorkspaceId | undefined,
      environmentId: envId as EnvironmentId | undefined,
      environmentKind: state.environment,
      principal: {
        id: auth.subject.principalId as PrincipalId,
        type: auth.context.principal.type,
        displayName: auth.context.principal.display_name,
        email: auth.context.principal.email ?? undefined,
      },
      requestId: state.requestId,
      traceId: state.traceId,
    };
  }

  app.post('/api/v1/runs', async (req, reply) => {
    const routePath = '/api/v1/runs';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      workspace_id?: string;
      environment?: EnvironmentKind;
      subject_type: 'agent_version' | 'workflow_version';
      subject_version_id: string;
      input?: unknown;
      labels?: Record<string, string>;
      limits?: Partial<RunLimits>;
      queue: string;
      priority: number;
      serialize_key?: string;
      simulated_steps?: Array<{
        type?: TurnStepInput['type'];
        summary?: Record<string, unknown>;
        input?: unknown;
        output?: unknown;
        tokens_in?: number;
        tokens_out?: number;
        cost_micro_usd?: number;
        latency_ms?: number;
        fail_code?: 'TOOL_TIMEOUT' | 'TOOL_UPSTREAM_REJECTED';
      }>;
      execute_inline?: boolean;
    }>(contract.bodySchema, req.body);

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const workspaceId = body.workspace_id ?? state.workspaceId ?? auth.context.workspaces[0]?.id;
    if (!workspaceId) {
      throw new PlatformError('RES_NOT_FOUND', 'No accessible workspace found.');
    }
    const ws = await store.getWorkspace(orgId, workspaceId);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${workspaceId} not found.`);
    }

    const envs = await store.listEnvironments(orgId, workspaceId);
    const targetEnvKind = body.environment ?? state.environment ?? 'dev';
    const env = envs.find((e) => e.kind === targetEnvKind) ?? envs[0];
    if (!env) {
      throw new PlatformError('RES_NOT_FOUND', `Environment ${targetEnvKind} not found.`);
    }

    const created = await executionEngine.createRun(buildTenantContext(req, workspaceId, env.id), {
      workspaceId,
      environmentId: env.id,
      subjectType: body.subject_type,
      subjectVersionId: body.subject_version_id,
      input: body.input,
      limits: body.limits,
      labels: body.labels,
      queue: body.queue,
      priority: body.priority,
      serializeKey: body.serialize_key,
      payload: body.simulated_steps ? { simulated_steps: body.simulated_steps } : {},
    });

    if (body.execute_inline) {
      const leases = await executionEngine.claim('api-inline', [body.queue], 1);
      const lease = leases.find((l) => l.runId === created.id);
      if (lease) {
        try {
          const steps = body.simulated_steps ?? [{ type: 'decision', summary: { ok: true } }];
          for (let i = 0; i < steps.length; i++) {
            const s = steps[i]!;
            const stepSeq = i + 1;
            if (s.fail_code) {
              throw new PlatformError(s.fail_code, `Simulated failure ${s.fail_code}`);
            }
            const res = await effectLedger.executeOnce(
              orgId,
              { runId: lease.runId, stepSeq },
              async () => s.output ?? { step: stepSeq, ok: true },
            );
            await executionEngine.commitTurn(lease, {
              steps: [
                {
                  seq: stepSeq,
                  type: s.type ?? 'decision',
                  summary: s.summary ?? { step: stepSeq },
                  input: s.input,
                  output: res.result,
                  tokensIn: s.tokens_in ?? 0,
                  tokensOut: s.tokens_out ?? 0,
                  costMicroUsd: s.cost_micro_usd ?? 0,
                  latencyMs: s.latency_ms ?? 5,
                },
              ],
              checkpoint: {
                seq: stepSeq,
                cursor: i + 1,
                scratchpad: {},
                messages: [],
                blackboard: {},
                engine_version: '1.0.0',
              },
              milestone: i === steps.length - 1,
            });
          }
          await executionEngine.complete(lease, {
            status: 'succeeded',
            terminationReason: 'final_answer',
            output: { steps: steps.length },
          });
        } catch (err) {
          const pe =
            err instanceof PlatformError
              ? err
              : new PlatformError('SYS_INTERNAL', err instanceof Error ? err.message : String(err));
          await executionEngine.retryOrFail(lease, pe);
        }
      }
    }

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'run.create',
      resource: { type: 'run', id: created.id, workspace_id: workspaceId },
      decision: 'allow',
    });

    const latest = (await executionEngine.getRun(orgId, created.id)) ?? created;
    await persistIdempotencyIfNeeded(req, routePath, 202, latest);
    return reply.status(202).send(latest);
  });

  app.get('/api/v1/runs', async (req) => {
    const contract = findContract('GET', '/api/v1/runs')!;
    const query = validateWithSchema<{ status?: RunStatus; workspace_id?: string }>(
      contract.querySchema,
      req.query,
    );
    const orgId = req.platformState!.auth!.context.org.id;
    const data = await executionEngine.listRuns(orgId, {
      workspaceId: query.workspace_id,
      status: query.status,
    });
    return { data };
  });

  app.get('/api/v1/runs/:id', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };
    const run = await executionEngine.getRun(orgId, id);
    if (!run) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${id} not found.`);
    }
    return run;
  });

  app.get('/api/v1/runs/:id/steps', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };
    const data = await executionEngine.listSteps(orgId, id);
    return { data };
  });

  app.get('/api/v1/runs/:id/events', async (req, reply) => {
    const contract = findContract('GET', '/api/v1/runs/{id}/events')!;
    const query = validateWithSchema<{ after_seq?: number; stream?: 'true' | 'false' }>(
      contract.querySchema,
      req.query,
    );
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };

    const lastEventIdHeader = req.headers['last-event-id'];
    const parsedHeaderSeq =
      typeof lastEventIdHeader === 'string' && /^\d+$/.test(lastEventIdHeader.trim())
        ? Number(lastEventIdHeader.trim())
        : undefined;
    const afterSeq = parsedHeaderSeq ?? query.after_seq ?? 0;

    const events = await executionEngine.listEvents(orgId, id, afterSeq);
    const wantsSse =
      query.stream === 'true' ||
      (typeof req.headers.accept === 'string' && req.headers.accept.includes('text/event-stream'));

    if (wantsSse) {
      reply.header('Content-Type', 'text/event-stream; charset=utf-8');
      reply.header('Cache-Control', 'no-cache');
      const frames = events
        .map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`)
        .join('');
      return reply.status(200).send(frames);
    }

    return { data: events };
  });

  app.post('/api/v1/runs/:id/cancel', async (req) => {
    const routePath = '/api/v1/runs/{id}/cancel';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{ reason: string }>(contract.bodySchema, req.body ?? {});
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };

    const cancelled = await executionEngine.cancel(buildTenantContext(req), id, body.reason);
    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'run.cancel',
      resource: { type: 'run', id },
      decision: 'allow',
    });
    await persistIdempotencyIfNeeded(req, routePath, 200, cancelled);
    return cancelled;
  });

  app.post('/api/v1/runs/:id/signal', async (req) => {
    const routePath = '/api/v1/runs/{id}/signal';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      kind: 'approval' | 'input' | 'timer' | 'child';
      reason: string;
      payload?: Record<string, unknown>;
    }>(contract.bodySchema, req.body);
    const auth = req.platformState!.auth!;
    const { id } = req.params as { id: string };

    const resumed = await executionEngine.signal(buildTenantContext(req), id, body);
    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'run.signal',
      resource: { type: 'run', id, kind: body.kind },
      decision: 'allow',
    });
    await persistIdempotencyIfNeeded(req, routePath, 200, resumed);
    return resumed;
  });

  app.get('/api/v1/dlq', async (req) => {
    const auth = req.platformState!.auth!;
    const data = await executionEngine.listDlq(auth.context.org.id);
    return { data };
  });

  app.post('/api/v1/runs:bulk-redrive', async (req) => {
    const routePath = '/api/v1/runs:bulk-redrive';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{ run_ids: string[]; input_patch?: unknown }>(
      contract.bodySchema,
      req.body,
    );
    const auth = req.platformState!.auth!;
    const redriven = await executionEngine.redrive(
      buildTenantContext(req),
      body.run_ids,
      body.input_patch,
    );
    await store.appendAudit(auth.context.org.id, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'run.redrive',
      resource: { type: 'run_batch', run_ids: body.run_ids },
      decision: 'allow',
    });
    const responseBody = { data: redriven };
    await persistIdempotencyIfNeeded(req, routePath, 200, responseBody);
    return responseBody;
  });

  // ---------- S0.3 Model Gateway, Tool Registry, Agents & Usage Ledger ----------

  function getRegistryForWorkspace(orgId: string, workspaceId: string): InMemoryToolRegistry {
    const reg = new InMemoryToolRegistry(false);
    for (const c of toolGateway.registry.list()) {
      reg.register(c, toolGateway.registry.getExecutor(c.name));
    }
    for (const c of workspaceCustomTools.get(`${orgId}::${workspaceId}`) ?? []) {
      reg.register(c);
    }
    return reg;
  }

  function formatModelCap(c: ModelCapability): Record<string, unknown> {
    return {
      id: c.id,
      provider: c.provider,
      display_name: c.displayName,
      tier: c.tier,
      context_window_tokens: c.contextWindowTokens,
      max_output_tokens: c.maxOutputTokens,
      supports_tools: c.supportsTools,
      supports_structured_output: c.supportsStructuredOutput,
      supports_vision: c.supportsVision,
      supports_streaming: c.supportsStreaming,
      pricing_per_million: {
        input_micro_usd: c.pricing.inputPerMillionMicroUsd,
        output_micro_usd: c.pricing.outputPerMillionMicroUsd,
        cached_input_micro_usd: c.pricing.cachedInputPerMillionMicroUsd,
      },
      status: c.status,
    };
  }

  function formatLethalTrifecta(r: LethalTrifectaReport): Record<string, unknown> {
    return {
      detected: r.detected,
      has_private_data: r.hasPrivateData,
      has_untrusted_input: r.hasUntrustedInput,
      has_external_comms: r.hasExternalComms,
      reasons: [...r.reasons],
    };
  }

  function formatAgentVersion(v: StoredAgentVersion): Record<string, unknown> {
    return {
      id: v.id,
      agent_id: v.agent_id,
      semver: v.semver,
      state: v.state,
      definition: v.definition,
      definition_hash: v.definition_hash,
      message: v.message,
      lethal_trifecta: formatLethalTrifecta(v.lethal_trifecta),
      created_by: v.created_by,
      created_at: v.created_at,
    };
  }

  function formatAgent(agent: StoredAgent): Record<string, unknown> {
    const published =
      agent.versions.find((v) => v.id === agent.current_version_id) ??
      [...agent.versions].reverse().find((v) => v.state === 'published') ??
      null;
    const draft = [...agent.versions].reverse().find((v) => v.state === 'draft') ?? null;
    return {
      id: agent.id,
      org_id: agent.org_id,
      workspace_id: agent.workspace_id,
      project_id: agent.project_id,
      name: agent.name,
      description: agent.description,
      status: agent.status,
      current_version_id: agent.current_version_id,
      draft_version: draft ? formatAgentVersion(draft) : null,
      published_version: published ? formatAgentVersion(published) : null,
      versions: agent.versions.map(formatAgentVersion),
      created_at: agent.created_at,
      updated_at: agent.updated_at,
    };
  }

  function formatUsageEntry(u: UsageLedgerEntry): Record<string, unknown> {
    return {
      id: u.id,
      org_id: u.orgId,
      workspace_id: u.workspaceId,
      project_id: u.projectId,
      environment_id: u.environmentId,
      run_id: u.runId,
      step_seq: u.stepSeq,
      principal_id: u.principalId,
      category: u.category,
      provider: u.provider,
      model: u.model,
      tokens_in: u.tokensIn,
      tokens_out: u.tokensOut,
      cached_tokens: u.cachedTokens,
      quantity: u.quantity,
      unit: u.unit,
      cost_micro_usd: u.costMicroUsd as number,
      ts: u.ts,
    };
  }

  function parseProjectMaxAutonomy(raw?: string): AutonomyLevel {
    if (raw === 'L0') return 0;
    if (raw === 'L1') return 1;
    if (raw === 'L2') return 2;
    if (raw === 'L4') return 4;
    return 3;
  }

  app.get('/api/v1/models', async () => {
    return { data: modelGateway.registry.list().map(formatModelCap) };
  });

  app.get('/api/v1/tools', async (req) => {
    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const workspaceId = state.workspaceId ?? auth.context.workspaces[0]?.id ?? 'ws_default';
    return { data: getRegistryForWorkspace(orgId, workspaceId).list() };
  });

  app.post('/api/v1/tools', async (req, reply) => {
    const routePath = '/api/v1/tools';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<ToolContract & { workspace_id?: string }>(
      contract.bodySchema,
      req.body,
    );
    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const workspaceId = body.workspace_id ?? state.workspaceId ?? auth.context.workspaces[0]?.id;
    if (!workspaceId) {
      throw new PlatformError('RES_NOT_FOUND', 'No accessible workspace found.');
    }

    const parsedContract = ToolContractSchema.parse(body);
    const key = `${orgId}::${workspaceId}`;
    const existing = (workspaceCustomTools.get(key) ?? []).filter(
      (t) => t.name !== parsedContract.name,
    );
    existing.push(parsedContract);
    workspaceCustomTools.set(key, existing);

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'tool.create',
      resource: { type: 'tool', name: parsedContract.name, workspace_id: workspaceId },
      decision: 'allow',
    });

    await persistIdempotencyIfNeeded(req, routePath, 201, parsedContract);
    return reply.status(201).send(parsedContract);
  });

  app.get('/api/v1/agents', async (req) => {
    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const wsFilter = state.workspaceId;
    const data = [...agentsById.values()]
      .filter((a) => a.org_id === orgId && (!wsFilter || a.workspace_id === wsFilter))
      .map(formatAgent);
    return { data };
  });

  app.post('/api/v1/agents', async (req, reply) => {
    const routePath = '/api/v1/agents';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      workspace_id?: string;
      project_id?: string;
      definition: AgentDefinition;
    }>(contract.bodySchema, req.body);

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const workspaceId = body.workspace_id ?? state.workspaceId ?? auth.context.workspaces[0]?.id;
    if (!workspaceId) {
      throw new PlatformError('RES_NOT_FOUND', 'No accessible workspace found.');
    }
    const ws = await store.getWorkspace(orgId, workspaceId);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${workspaceId} not found.`);
    }

    const projects = await store.listProjects(orgId, workspaceId);
    const project = body.project_id
      ? projects.find((p) => p.id === body.project_id)
      : projects[0];
    if (!project) {
      throw new PlatformError('RES_NOT_FOUND', 'No accessible project found in workspace.');
    }

    const duplicate = [...agentsById.values()].find(
      (a) =>
        a.org_id === orgId && a.project_id === project.id && a.name === body.definition.name,
    );
    if (duplicate) {
      throw new PlatformError(
        'RES_CONFLICT',
        `Agent "${body.definition.name}" already exists in project.`,
      );
    }

    const reg = getRegistryForWorkspace(orgId, workspaceId);
    const validated = validateAgentDefinition(body.definition, {
      toolRegistry: reg,
      projectMaxAutonomy: parseProjectMaxAutonomy(project.max_autonomy_level),
    });

    const nowIso = clock.now().toISOString();
    const agentId = idGen.uuidv7();
    const versionId = idGen.uuidv7();
    const agent: StoredAgent = {
      id: agentId,
      org_id: orgId,
      workspace_id: workspaceId,
      project_id: project.id,
      name: validated.definition.name,
      description: validated.definition.description ?? null,
      status: 'draft',
      current_version_id: null,
      versions: [
        {
          id: versionId,
          agent_id: agentId,
          semver: validated.definition.version,
          state: 'draft',
          definition: validated.definition,
          definition_hash: validated.definitionHash,
          message: 'Initial draft',
          lethal_trifecta: validated.lethalTrifecta,
          created_by: auth.subject.principalId,
          created_at: nowIso,
        },
      ],
      created_at: nowIso,
      updated_at: nowIso,
    };

    agentsById.set(agentId, agent);
    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'agent.create',
      resource: { type: 'agent', id: agentId, name: agent.name, workspace_id: workspaceId },
      decision: 'allow',
    });

    const formatted = formatAgent(agent);
    await persistIdempotencyIfNeeded(req, routePath, 201, formatted);
    return reply.status(201).send(formatted);
  });

  app.get('/api/v1/agents/:id', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };
    const agent = agentsById.get(id);
    if (!agent || agent.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Agent ${id} not found.`);
    }
    return formatAgent(agent);
  });

  app.patch('/api/v1/agents/:id', async (req) => {
    const routePath = '/api/v1/agents/{id}';
    const contract = findContract('PATCH', routePath)!;
    const body = validateWithSchema<{ definition: AgentDefinition; message?: string }>(
      contract.bodySchema,
      req.body,
    );
    const auth = req.platformState!.auth!;
    const orgId = auth.context.org.id;
    const { id } = req.params as { id: string };

    const agent = agentsById.get(id);
    if (!agent || agent.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Agent ${id} not found.`);
    }

    const projects = await store.listProjects(orgId, agent.workspace_id);
    const project = projects.find((p) => p.id === agent.project_id);
    const reg = getRegistryForWorkspace(orgId, agent.workspace_id);
    const validated = validateAgentDefinition(body.definition, {
      toolRegistry: reg,
      projectMaxAutonomy: parseProjectMaxAutonomy(project?.max_autonomy_level),
    });

    const nowIso = clock.now().toISOString();
    const existingSameSemver = agent.versions.find(
      (v) => v.semver === validated.definition.version,
    );

    if (existingSameSemver) {
      if (existingSameSemver.state !== 'draft') {
        throw new PlatformError(
          'RES_CONFLICT',
          `Version ${existingSameSemver.semver} is already ${existingSameSemver.state}; increment semver for a new draft.`,
        );
      }
      existingSameSemver.definition = validated.definition;
      existingSameSemver.definition_hash = validated.definitionHash;
      existingSameSemver.lethal_trifecta = validated.lethalTrifecta;
      existingSameSemver.message = body.message ?? existingSameSemver.message;
    } else {
      agent.versions.push({
        id: idGen.uuidv7(),
        agent_id: agent.id,
        semver: validated.definition.version,
        state: 'draft',
        definition: validated.definition,
        definition_hash: validated.definitionHash,
        message: body.message ?? 'Draft update',
        lethal_trifecta: validated.lethalTrifecta,
        created_by: auth.subject.principalId,
        created_at: nowIso,
      });
    }

    agent.description = validated.definition.description ?? agent.description;
    agent.updated_at = nowIso;

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'agent.update_draft',
      resource: { type: 'agent', id: agent.id, semver: validated.definition.version },
      decision: 'allow',
    });

    return formatAgent(agent);
  });

  app.post('/api/v1/agents/:id/versions/:vid/publish', async (req) => {
    const routePath = '/api/v1/agents/{id}/versions/{vid}/publish';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{ message?: string; allow_l4_autonomy?: boolean }>(
      contract.bodySchema,
      req.body ?? {},
    );
    const auth = req.platformState!.auth!;
    const orgId = auth.context.org.id;
    const { id, vid } = req.params as { id: string; vid: string };

    const agent = agentsById.get(id);
    if (!agent || agent.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Agent ${id} not found.`);
    }

    const target = agent.versions.find((v) => v.id === vid);
    if (!target) {
      throw new PlatformError('RES_NOT_FOUND', `Agent version ${vid} not found.`);
    }
    if (target.state !== 'draft') {
      throw new PlatformError(
        'RES_CONFLICT',
        `Version ${target.semver} cannot be published from state "${target.state}".`,
      );
    }

    const projects = await store.listProjects(orgId, agent.workspace_id);
    const project = projects.find((p) => p.id === agent.project_id);
    const reg = getRegistryForWorkspace(orgId, agent.workspace_id);
    validateAgentDefinition(target.definition, {
      toolRegistry: reg,
      projectMaxAutonomy: parseProjectMaxAutonomy(project?.max_autonomy_level),
      allowL4Autonomy: body.allow_l4_autonomy,
    });

    for (const v of agent.versions) {
      if (v.state === 'published') {
        v.state = 'retired';
      }
    }
    target.state = 'published';
    if (body.message) {
      target.message = body.message;
    }
    agent.current_version_id = target.id;
    agent.status = 'active';
    agent.updated_at = clock.now().toISOString();

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'agent.publish',
      resource: { type: 'agent_version', id: target.id, agent_id: agent.id, semver: target.semver },
      decision: 'allow',
    });

    const formatted = formatAgent(agent);
    await persistIdempotencyIfNeeded(req, routePath, 200, formatted);
    return formatted;
  });

  app.get('/api/v1/agents/:id/diff', async (req) => {
    const contract = findContract('GET', '/api/v1/agents/{id}/diff')!;
    const query = validateWithSchema<{ from: string; to: string }>(contract.querySchema, req.query);
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };

    const agent = agentsById.get(id);
    if (!agent || agent.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Agent ${id} not found.`);
    }

    const fromVer = agent.versions.find((v) => v.id === query.from || v.semver === query.from);
    const toVer = agent.versions.find((v) => v.id === query.to || v.semver === query.to);
    if (!fromVer || !toVer) {
      throw new PlatformError('RES_NOT_FOUND', 'Requested agent versions for diff were not found.');
    }

    const diff = diffAgentDefinitions(fromVer.definition, toVer.definition);
    return {
      from_version: diff.fromVersion,
      to_version: diff.toVersion,
      breaking: diff.breaking,
      changes: diff.changes,
    };
  });

  app.post('/api/v1/agents/:id/runs', async (req, reply) => {
    const routePath = '/api/v1/agents/{id}/runs';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      environment?: EnvironmentKind;
      version_id?: string;
      input: string | Record<string, unknown>;
      dry_run: boolean;
      mock_turns?: Array<Record<string, unknown>>;
    }>(contract.bodySchema, req.body);

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const { id } = req.params as { id: string };

    const agent = agentsById.get(id);
    if (!agent || agent.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Agent ${id} not found.`);
    }

    const targetVersion =
      (body.version_id
        ? agent.versions.find((v) => v.id === body.version_id)
        : agent.versions.find((v) => v.id === agent.current_version_id) ??
          [...agent.versions].reverse()[0]) ?? null;
    if (!targetVersion) {
      throw new PlatformError('RES_NOT_FOUND', 'No runnable agent version found.');
    }

    const envs = await store.listEnvironments(orgId, agent.workspace_id);
    const envKind = body.environment ?? state.environment ?? 'dev';
    const env = envs.find((e) => e.kind === envKind) ?? envs[0];
    if (!env) {
      throw new PlatformError('RES_NOT_FOUND', `Environment ${envKind} not found.`);
    }

    const tenantCtx = buildTenantContext(req, agent.workspace_id, env.id);
    const runRecord = await executionEngine.createRun(tenantCtx, {
      workspaceId: agent.workspace_id,
      environmentId: env.id,
      subjectType: 'agent_version',
      subjectVersionId: targetVersion.id,
      input: body.input,
      limits: {
        max_steps: targetVersion.definition.limits.max_steps,
        max_tokens: targetVersion.definition.limits.max_tokens,
        max_wall_time_ms: targetVersion.definition.limits.max_wall_time_ms,
        max_cost_micro_usd: targetVersion.definition.limits.max_cost_micro_usd,
      },
      labels: {
        agent_name: agent.name,
        agent_version: targetVersion.semver,
        dry_run: String(body.dry_run),
      },
      queue: 'default',
      priority: 5,
    });

    const leases = await executionEngine.claim('api-agent-runtime', ['default'], 5);
    const lease = leases.find((l) => l.runId === runRecord.id);

    const reg = getRegistryForWorkspace(orgId, agent.workspace_id);
    const reqToolGateway = new ToolGateway({ registry: reg, clock });

    let effectiveModelGateway = modelGateway;
    if (body.mock_turns && body.mock_turns.length > 0) {
      const transientGw = new ModelGateway({ clock });
      const transientMock = new MockModelProvider();
      transientMock.enqueue(...(body.mock_turns as unknown as MockTurnBehavior[]));
      transientGw.registerProvider(transientMock);
      effectiveModelGateway = transientGw;
    }

    const userPrompt =
      typeof body.input === 'string'
        ? body.input
        : String(body.input['prompt'] ?? body.input['query'] ?? JSON.stringify(body.input));

    const projects = await store.listProjects(orgId, agent.workspace_id);
    const project = projects.find((p) => p.id === agent.project_id);

    const execResult = await executeReActAgentRun(
      {
        ctx: tenantCtx,
        projectId: agent.project_id,
        environmentId: env.id,
        runId: runRecord.id,
        agentId: agent.id,
        definition: targetVersion.definition,
        userInput: userPrompt,
        dryRun: body.dry_run,
      },
      {
        modelGateway: effectiveModelGateway,
        toolGateway: reqToolGateway,
        usageLedger,
        clock,
        idGen,
        projectMaxAutonomy: parseProjectMaxAutonomy(project?.max_autonomy_level),
      },
    );

    if (lease) {
      if (execResult.steps.length > 0) {
        const turnSteps: TurnStepInput[] = execResult.steps.map((s) => ({
          seq: s.seq,
          type: s.type,
          agentId: s.agent_id,
          status: s.status,
          attempt: s.attempt,
          summary: s.summary,
          input: s.input,
          output: s.output,
          model: s.model,
          tokensIn: s.tokens_in,
          tokensOut: s.tokens_out,
          costMicroUsd: s.cost_micro_usd,
          latencyMs: s.latency_ms,
          error: s.error,
        }));
        await executionEngine.commitTurn(lease, {
          steps: turnSteps,
          checkpoint: {
            seq: execResult.steps.length,
            cursor: execResult.steps.length,
            scratchpad: {},
            messages: [],
            blackboard: {},
            engine_version: '1.0.0',
          },
          milestone: true,
        });
      }

      if (
        execResult.status === 'succeeded' ||
        execResult.status === 'timed_out' ||
        execResult.status === 'budget_exceeded' ||
        execResult.status === 'policy_blocked'
      ) {
        await executionEngine.complete(lease, {
          status: execResult.status,
          terminationReason: execResult.terminationReason,
          output: execResult.output ?? (execResult.error ? { error: execResult.error } : null),
        });
      } else if (execResult.status === 'waiting_input' || execResult.status === 'waiting_approval') {
        await executionEngine.suspend(lease, {
          kind: execResult.status === 'waiting_input' ? 'input' : 'approval',
          reason:
            typeof execResult.output === 'object' && execResult.output !== null
              ? JSON.stringify(execResult.output)
              : execResult.terminationReason,
        });
      } else {
        await executionEngine.retryOrFail(
          lease,
          new PlatformError('SYS_INTERNAL', execResult.error?.message ?? 'Agent run failed', {
            code: execResult.error?.code,
          }),
        );
      }
    }

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'agent.run',
      resource: {
        type: 'run',
        id: runRecord.id,
        agent_id: agent.id,
        version: targetVersion.semver,
        dry_run: body.dry_run,
      },
      decision: 'allow',
    });

    const latestRun = (await executionEngine.getRun(orgId, runRecord.id)) ?? runRecord;
    await persistIdempotencyIfNeeded(req, routePath, 201, latestRun);
    return reply.status(201).send(latestRun);
  });

  app.get('/api/v1/runs/:id/usage-ledger', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };
    const run = await executionEngine.getRun(orgId, id);
    if (!run) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${id} not found.`);
    }
    const entries = await usageLedger.listByRun(orgId, id);
    const total = (await usageLedger.sumRunCostMicroUsd(orgId, id)) as number;
    return {
      data: entries.map(formatUsageEntry),
      total_cost_micro_usd: total,
    };
  });

  // ---------- S0.4 Workflows, JSONata, Triggers & Webhooks ----------

  function parseWorkflowInput(raw: { graph?: unknown; yaml_source?: string }): WorkflowGraph {
    let candidate: unknown = raw.graph;
    if (!candidate && raw.yaml_source) {
      candidate = parseWorkflowFromYaml(raw.yaml_source);
    }
    if (!candidate) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Either graph or yaml_source is required.');
    }
    const parsed = WorkflowGraphSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Workflow graph failed schema validation', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  function formatWorkflowVersion(v: StoredWorkflowVersion): Record<string, unknown> {
    return {
      id: v.id,
      workflow_id: v.workflow_id,
      semver: v.semver,
      state: v.state,
      schema_version: v.schema_version,
      graph: v.graph,
      graph_hash: v.graph_hash,
      yaml_source: v.yaml_source,
      message: v.message,
      created_by: v.created_by,
      created_at: v.created_at,
    };
  }

  function formatWorkflow(wf: StoredWorkflow): Record<string, unknown> {
    const published =
      wf.versions.find((v) => v.id === wf.current_version_id) ??
      [...wf.versions].reverse().find((v) => v.state === 'published') ??
      null;
    const draft = [...wf.versions].reverse().find((v) => v.state === 'draft') ?? null;
    return {
      id: wf.id,
      org_id: wf.org_id,
      workspace_id: wf.workspace_id,
      project_id: wf.project_id,
      name: wf.name,
      description: wf.description,
      status: wf.status,
      current_version_id: wf.current_version_id,
      draft_version: draft ? formatWorkflowVersion(draft) : null,
      published_version: published ? formatWorkflowVersion(published) : null,
      versions: wf.versions.map(formatWorkflowVersion),
      created_at: wf.created_at,
      updated_at: wf.updated_at,
    };
  }

  function formatTrigger(t: TriggerRecord): Record<string, unknown> {
    return {
      id: t.id,
      org_id: t.orgId,
      workspace_id: t.workspaceId,
      environment_id: t.environmentId,
      workflow_id: t.workflowId,
      workflow_version_id: t.workflowVersionId,
      node_id: t.nodeId,
      kind: t.kind,
      external_id: t.externalId,
      path: t.path,
      active: t.active,
      test_mode: t.testMode,
      last_fired_at: t.lastFiredAt,
      next_fire_at: t.nextFireAt,
    };
  }

  function resolveAgentForWorkflow(
    orgId: string,
    ref: string,
  ): AgentDefinition | undefined {
    const byId = agentsById.get(ref);
    if (byId && byId.org_id === orgId) {
      return (
        byId.versions.find((v) => v.id === byId.current_version_id)?.definition ??
        byId.versions[byId.versions.length - 1]?.definition
      );
    }
    const byName = [...agentsById.values()].find((a) => a.org_id === orgId && a.name === ref);
    if (!byName) return undefined;
    return (
      byName.versions.find((v) => v.id === byName.current_version_id)?.definition ??
      byName.versions[byName.versions.length - 1]?.definition
    );
  }

  app.get('/api/v1/workflows/nodes', async () => {
    return {
      data: nodeRegistry.list().map((h) => ({
        type: h.type,
        category: h.category,
        label: h.label,
        inputs: [...h.ports.inputs],
        outputs: [...h.ports.outputs],
      })),
    };
  });

  app.post('/api/v1/workflows:validate', async (req) => {
    const routePath = '/api/v1/workflows:validate';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      workspace_id?: string;
      environment?: EnvironmentKind;
      graph?: unknown;
      yaml_source?: string;
    }>(contract.bodySchema, req.body);

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const workspaceId = body.workspace_id ?? state.workspaceId ?? auth.context.workspaces[0]?.id;
    const envs = workspaceId ? await store.listEnvironments(orgId, workspaceId) : [];
    const envKind = body.environment ?? state.environment ?? 'dev';
    const env = envs.find((e) => e.kind === envKind) ?? envs[0];
    const usedPaths = new Set(
      triggerService
        .listByOrg(orgId, workspaceId)
        .filter((t) => t.active && (!env || t.environmentId === env.id) && t.path)
        .map((t) => t.path!),
    );

    const graph = parseWorkflowInput(body);
    const valRes = validateWorkflowGraph(graph, nodeRegistry, usedPaths);
    const payload = {
      valid: valRes.valid,
      errors: valRes.errors.map((e) => ({
        severity: e.severity,
        code: e.code,
        message: e.message,
        ...(e.nodeId ? { node_id: e.nodeId } : {}),
        ...(e.edgeId ? { edge_id: e.edgeId } : {}),
      })),
      warnings: valRes.warnings.map((w) => ({
        severity: w.severity,
        code: w.code,
        message: w.message,
        ...(w.nodeId ? { node_id: w.nodeId } : {}),
        ...(w.edgeId ? { edge_id: w.edgeId } : {}),
      })),
    };
    await persistIdempotencyIfNeeded(req, routePath, 200, payload);
    return payload;
  });

  app.get('/api/v1/workflows', async (req) => {
    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const wsFilter = state.workspaceId;
    const data = [...workflowsById.values()]
      .filter((w) => w.org_id === orgId && (!wsFilter || w.workspace_id === wsFilter))
      .map(formatWorkflow);
    return { data };
  });

  app.post('/api/v1/workflows', async (req, reply) => {
    const routePath = '/api/v1/workflows';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      workspace_id?: string;
      project_id?: string;
      name: string;
      description?: string;
      semver: string;
      graph?: unknown;
      yaml_source?: string;
    }>(contract.bodySchema, req.body);

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const workspaceId = body.workspace_id ?? state.workspaceId ?? auth.context.workspaces[0]?.id;
    if (!workspaceId) {
      throw new PlatformError('RES_NOT_FOUND', 'No accessible workspace found.');
    }
    const ws = await store.getWorkspace(orgId, workspaceId);
    if (!ws) {
      throw new PlatformError('RES_NOT_FOUND', `Workspace ${workspaceId} not found.`);
    }

    const projects = await store.listProjects(orgId, workspaceId);
    const project = body.project_id
      ? projects.find((p) => p.id === body.project_id)
      : projects[0];
    if (!project) {
      throw new PlatformError('RES_NOT_FOUND', 'No accessible project found in workspace.');
    }

    const duplicate = [...workflowsById.values()].find(
      (w) => w.org_id === orgId && w.project_id === project.id && w.name === body.name,
    );
    if (duplicate) {
      throw new PlatformError('RES_CONFLICT', `Workflow "${body.name}" already exists in project.`);
    }

    const graph = parseWorkflowInput(body);
    const val = validateWorkflowGraph(graph, nodeRegistry);
    if (!val.valid) {
      throw new PlatformError(
        'VAL_GRAPH_INVALID',
        `Workflow graph invalid: ${val.errors.map((e) => e.message).join('; ')}`,
        { errors: val.errors },
      );
    }

    const nowIso = clock.now().toISOString();
    const wfId = idGen.uuidv7();
    const verId = idGen.uuidv7();
    const wf: StoredWorkflow = {
      id: wfId,
      org_id: orgId,
      workspace_id: workspaceId,
      project_id: project.id,
      owner_id: auth.subject.principalId,
      name: body.name,
      description: body.description ?? null,
      status: 'draft',
      current_version_id: null,
      versions: [
        {
          id: verId,
          workflow_id: wfId,
          semver: body.semver,
          state: 'draft',
          schema_version: 1,
          graph,
          graph_hash: computeWorkflowHash(graph),
          yaml_source: serializeWorkflowToYaml(graph),
          message: 'Initial draft',
          created_by: auth.subject.principalId,
          created_at: nowIso,
        },
      ],
      created_at: nowIso,
      updated_at: nowIso,
    };

    workflowsById.set(wfId, wf);
    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'workflow.create',
      resource: { type: 'workflow', id: wfId, name: wf.name, workspace_id: workspaceId },
      decision: 'allow',
    });

    const formatted = formatWorkflow(wf);
    await persistIdempotencyIfNeeded(req, routePath, 201, formatted);
    return reply.status(201).send(formatted);
  });

  app.get('/api/v1/workflows/:id', async (req) => {
    const orgId = req.platformState!.auth!.context.org.id;
    const { id } = req.params as { id: string };
    const wf = workflowsById.get(id);
    if (!wf || wf.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Workflow ${id} not found.`);
    }
    return formatWorkflow(wf);
  });

  app.patch('/api/v1/workflows/:id', async (req) => {
    const routePath = '/api/v1/workflows/{id}';
    const contract = findContract('PATCH', routePath)!;
    const body = validateWithSchema<{
      semver: string;
      description?: string;
      graph?: unknown;
      yaml_source?: string;
      message?: string;
    }>(contract.bodySchema, req.body);

    const auth = req.platformState!.auth!;
    const orgId = auth.context.org.id;
    const { id } = req.params as { id: string };

    const wf = workflowsById.get(id);
    if (!wf || wf.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Workflow ${id} not found.`);
    }

    const graph = parseWorkflowInput(body);
    const val = validateWorkflowGraph(graph, nodeRegistry);
    if (!val.valid) {
      throw new PlatformError(
        'VAL_GRAPH_INVALID',
        `Workflow graph invalid: ${val.errors.map((e) => e.message).join('; ')}`,
        { errors: val.errors },
      );
    }

    const nowIso = clock.now().toISOString();
    const existingSameSemver = wf.versions.find((v) => v.semver === body.semver);
    if (existingSameSemver) {
      if (existingSameSemver.state !== 'draft') {
        throw new PlatformError(
          'RES_CONFLICT',
          `Version ${existingSameSemver.semver} is already ${existingSameSemver.state}.`,
        );
      }
      existingSameSemver.graph = graph;
      existingSameSemver.graph_hash = computeWorkflowHash(graph);
      existingSameSemver.yaml_source = serializeWorkflowToYaml(graph);
      existingSameSemver.message = body.message ?? existingSameSemver.message;
    } else {
      wf.versions.push({
        id: idGen.uuidv7(),
        workflow_id: wf.id,
        semver: body.semver,
        state: 'draft',
        schema_version: 1,
        graph,
        graph_hash: computeWorkflowHash(graph),
        yaml_source: serializeWorkflowToYaml(graph),
        message: body.message ?? 'Draft update',
        created_by: auth.subject.principalId,
        created_at: nowIso,
      });
    }

    if (body.description !== undefined) {
      wf.description = body.description;
    }
    wf.updated_at = nowIso;

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'workflow.update_draft',
      resource: { type: 'workflow', id: wf.id, semver: body.semver },
      decision: 'allow',
    });

    return formatWorkflow(wf);
  });

  app.post('/api/v1/workflows/:id/versions/:vid/publish', async (req) => {
    const routePath = '/api/v1/workflows/{id}/versions/{vid}/publish';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      environment?: EnvironmentKind;
      message?: string;
      activate_triggers: boolean;
    }>(contract.bodySchema, req.body ?? {});

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const { id, vid } = req.params as { id: string; vid: string };

    const wf = workflowsById.get(id);
    if (!wf || wf.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Workflow ${id} not found.`);
    }

    const target = wf.versions.find((v) => v.id === vid);
    if (!target) {
      throw new PlatformError('RES_NOT_FOUND', `Workflow version ${vid} not found.`);
    }
    if (target.state !== 'draft') {
      throw new PlatformError(
        'RES_CONFLICT',
        `Workflow version ${target.semver} is already ${target.state}.`,
      );
    }

    const envs = await store.listEnvironments(orgId, wf.workspace_id);
    const envKind = body.environment ?? state.environment ?? 'dev';
    const env = envs.find((e) => e.kind === envKind) ?? envs[0];
    if (!env) {
      throw new PlatformError('RES_NOT_FOUND', `Environment ${envKind} not found.`);
    }

    triggerService.registerWorkflowTriggers({
      orgId,
      workspaceId: wf.workspace_id,
      environmentId: env.id,
      workflowId: wf.id,
      workflowVersionId: target.id,
      graph: target.graph,
      active: body.activate_triggers,
    });

    for (const v of wf.versions) {
      if (v.state === 'published') v.state = 'retired';
    }
    target.state = 'published';
    if (body.message) target.message = body.message;
    wf.current_version_id = target.id;
    wf.status = 'active';
    wf.updated_at = clock.now().toISOString();

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'workflow.publish',
      resource: {
        type: 'workflow_version',
        id: target.id,
        workflow_id: wf.id,
        semver: target.semver,
      },
      decision: 'allow',
    });

    const formatted = formatWorkflow(wf);
    await persistIdempotencyIfNeeded(req, routePath, 200, formatted);
    return formatted;
  });

  app.post('/api/v1/workflows/:id/runs', async (req, reply) => {
    const routePath = '/api/v1/workflows/{id}/runs';
    const contract = findContract('POST', routePath)!;
    const body = validateWithSchema<{
      environment?: EnvironmentKind;
      version_id?: string;
      trigger_payload: Record<string, unknown>;
      pinned_data?: Record<string, unknown[]>;
      start_from_node_id?: string;
    }>(contract.bodySchema, req.body);

    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const { id } = req.params as { id: string };

    const wf = workflowsById.get(id);
    if (!wf || wf.org_id !== orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Workflow ${id} not found.`);
    }

    const version =
      (body.version_id
        ? wf.versions.find((v) => v.id === body.version_id)
        : wf.versions.find((v) => v.id === wf.current_version_id) ??
          wf.versions[wf.versions.length - 1]) ?? null;
    if (!version) {
      throw new PlatformError('RES_NOT_FOUND', 'No runnable workflow version found.');
    }

    const envs = await store.listEnvironments(orgId, wf.workspace_id);
    const envKind = body.environment ?? state.environment ?? 'dev';
    const env = envs.find((e) => e.kind === envKind) ?? envs[0];
    if (!env) {
      throw new PlatformError('RES_NOT_FOUND', `Environment ${envKind} not found.`);
    }

    const tenantCtx = buildTenantContext(req, wf.workspace_id, env.id);
    const execResult = await executeWorkflowGraph(
      {
        ctx: { ...tenantCtx, projectId: wf.project_id as TenantContext['projectId'] },
        workflowId: wf.id,
        workflowName: wf.name,
        versionId: version.id,
        graph: version.graph,
        triggerPayload: body.trigger_payload,
        pinnedData: body.pinned_data as Record<string, Record<string, unknown>[]> | undefined,
        startFromNodeId: body.start_from_node_id,
      },
      {
        registry: nodeRegistry,
        executionEngine,
        effectLedger,
        modelGateway,
        toolGateway,
        usageLedger,
        clock,
        idGen,
        resolveAgent: (agentRef) => resolveAgentForWorkflow(orgId, agentRef),
      },
    );

    await store.appendAudit(orgId, {
      actor: { id: auth.subject.principalId, type: auth.context.principal.type },
      action: 'workflow.run',
      resource: {
        type: 'run',
        id: execResult.runId,
        workflow_id: wf.id,
        version: version.semver,
      },
      decision: 'allow',
    });

    const latestRun = await executionEngine.getRun(orgId, execResult.runId);
    await persistIdempotencyIfNeeded(req, routePath, 201, latestRun);
    return reply.status(201).send(latestRun);
  });

  app.get('/api/v1/triggers', async (req) => {
    const state = req.platformState!;
    const auth = state.auth!;
    const orgId = auth.context.org.id;
    const data = triggerService.listByOrg(orgId, state.workspaceId).map(formatTrigger);
    return { data };
  });

  app.post('/api/v1/hooks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rawBody =
      (req as FastifyRequest & { rawBodyText?: string }).rawBodyText ??
      (req.body ? JSON.stringify(req.body) : '');

    const normHeaders: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      normHeaders[k] = Array.isArray(v) ? v[0] : v;
    }

    const delivery = await triggerService.receiveWebhook({
      externalIdOrPath: id,
      method: req.method,
      headers: normHeaders,
      rawBody,
    });

    let runId: string | null = null;
    if (delivery.shouldStartRun) {
      const wf = workflowsById.get(delivery.trigger.workflowId);
      const version = wf?.versions.find((v) => v.id === delivery.trigger.workflowVersionId);
      if (wf && version) {
        const hookCtx: TenantContext = {
          orgId: wf.org_id as OrgId,
          workspaceId: wf.workspace_id as WorkspaceId,
          projectId: wf.project_id as TenantContext['projectId'],
          environmentId: delivery.trigger.environmentId as EnvironmentId,
          principal: {
            id: wf.owner_id as PrincipalId,
            type: 'service_account',
          },
          requestId: req.platformState?.requestId ?? `req_${idGen.uuidv7()}`,
          traceId: req.platformState?.traceId ?? '00000000000000000000000000000000',
        };
        const execResult = await executeWorkflowGraph(
          {
            ctx: hookCtx,
            workflowId: wf.id,
            workflowName: wf.name,
            versionId: version.id,
            graph: version.graph,
            triggerPayload: delivery.payload,
          },
          {
            registry: nodeRegistry,
            executionEngine,
            effectLedger,
            modelGateway,
            toolGateway,
            usageLedger,
            clock,
            idGen,
            resolveAgent: (agentRef) => resolveAgentForWorkflow(wf.org_id, agentRef),
          },
        );
        runId = execResult.runId;
        delivery.event.runId = runId;
      }
    }

    return reply.status(202).send({
      status: delivery.shouldStartRun ? 'accepted' : 'captured_test',
      trigger_id: delivery.trigger.id,
      event_id: delivery.event.id,
      run_id: runId,
    });
  });

  return { app, store, executionEngine, modelGateway, toolGateway, usageLedger, triggerService };
}
