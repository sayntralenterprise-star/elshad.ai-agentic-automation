import { describe, expect, it } from 'vitest';
import type { BuiltInRole } from '@elshad/authz';
import { createTestConfig } from '@elshad/config';
import { verifyAuditEventsChain } from '@elshad/db';
import { buildApiServer } from './index.js';
import { InMemoryIamAuditStore } from './store.js';

function parseCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error('Missing set-cookie header');
  return raw.split(';')[0]!;
}

describe('@elshad/api gateway, authN/authZ, tenancy, idempotency, and audit [E0.1-4..6]', () => {
  it('enforces local auth, CSRF on cookie mutations, session refresh, logout, and failed-login throttling', async () => {
    const config = createTestConfig();
    const { app } = buildApiServer({ config });

    // 5 failed attempts trigger 429 lockout
    for (let i = 0; i < 4; i++) {
      const fail = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@elshad.local', password: 'wrong-password' },
      });
      expect(fail.statusCode).toBe(401);
      expect(fail.json().error.code).toBe('AUTH_UNAUTHENTICATED');
      expect(fail.json().error.request_id).toMatch(/^req_/);
      expect(fail.json().error.trace_id).toHaveLength(32);
    }

    const throttled = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@elshad.local', password: 'wrong-password' },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error.code).toBe('BUD_RATE_LIMITED');
    expect(throttled.headers['retry-after']).toBeDefined();

    // Another user logs in cleanly
    const cfg2 = createTestConfig();
    const { app: app2 } = buildApiServer({ config: cfg2 });
    const ok = await app2.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
      payload: { email: 'admin@elshad.local', password: 'ChangeMe123!' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-trace-id']).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    const cookie = parseCookie(ok.headers['set-cookie']);
    const csrfToken = ok.json().csrf_token as string;

    // Missing CSRF header rejected on cookie POST
    const missingCsrf = await app2.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie, 'Idempotency-Key': 'idem-csrf' },
      payload: { slug: 'eng-ws', name: 'Eng' },
    });
    expect(missingCsrf.statusCode).toBe(403);

    // Refresh rotates CSRF token
    const refreshed = await app2.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const newCsrf = refreshed.json().csrf_token as string;
    expect(newCsrf).not.toBe(csrfToken);

    // Logout revokes session
    const out = await app2.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'x-csrf-token': newCsrf },
    });
    expect(out.statusCode).toBe(200);

    const afterLogout = await app2.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);

    await app.close();
    await app2.close();
  });

  it('supports OIDC PKCE authorize and callback flow [D14]', async () => {
    const config = createTestConfig({
      PLATFORM_OIDC_ISSUER: 'https://idp.example.com',
      PLATFORM_OIDC_CLIENT_ID: 'elshad-web',
    });
    const { app } = buildApiServer({
      config,
      oidcExchange: async ({ codeVerifier, expectedNonce }) => {
        expect(codeVerifier.length).toBeGreaterThan(20);
        expect(expectedNonce.length).toBeGreaterThan(10);
        return {
          externalId: 'sub_oidc_42',
          email: 'marcus@elshad.local',
          displayName: 'Marcus Builder',
        };
      },
    });

    const authzRes = await app.inject({ method: 'GET', url: '/api/v1/auth/oidc/authorize' });
    expect(authzRes.statusCode).toBe(200);
    const { authorize_url: authorizeUrl, state } = authzRes.json() as {
      authorize_url: string;
      state: string;
    };
    expect(authorizeUrl).toContain('code_challenge_method=S256');

    const cbRes = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oidc/callback?code=auth_code_1&state=${encodeURIComponent(state)}`,
    });
    expect(cbRes.statusCode).toBe(200);
    expect(cbRes.json().me.principal.email).toBe('marcus@elshad.local');
    await app.close();
  });

  it('enforces cross-org tenant isolation across all S0.1 endpoints [NFR-4]', async () => {
    const config = createTestConfig();
    const store = new InMemoryIamAuditStore({
      adminEmail: 'admin-a@org-a.local',
      adminPassword: 'PasswordA123!',
      apiKeyPepper: config.PLATFORM_API_KEY_PEPPER,
    });
    const orgB = store.seedOrganization({
      slug: 'org-b',
      name: 'Organization B',
      adminEmail: 'admin-b@org-b.local',
      adminPassword: 'PasswordB123!',
    });

    const { app } = buildApiServer({ config, store });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin-a@org-a.local', password: 'PasswordA123!' },
    });
    const cookieA = parseCookie(loginA.headers['set-cookie']);
    const csrfA = loginA.json().csrf_token as string;

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin-b@org-b.local', password: 'PasswordB123!' },
    });
    const cookieB = parseCookie(loginB.headers['set-cookie']);
    const csrfB = loginB.json().csrf_token as string;

    // Org B creates an API key and project
    const keyBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { cookie: cookieB, 'x-csrf-token': csrfB, 'Idempotency-Key': 'b-key-1' },
      payload: { name: 'OrgB Secret Key', scopes: [] },
    });
    expect(keyBRes.statusCode).toBe(201);
    const keyBId = keyBRes.json().id as string;

    // Org A tries to read Org B's workspace, projects, environments, or revoke Org B's key
    const getWsB = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${orgB.workspace.id}`,
      headers: { cookie: cookieA },
    });
    expect(getWsB.statusCode).toBe(404);

    const listProjB = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${orgB.workspace.id}/projects`,
      headers: { cookie: cookieA },
    });
    expect(listProjB.statusCode).toBe(404);

    const listKeysA = await app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: { cookie: cookieA },
    });
    expect(listKeysA.statusCode).toBe(200);
    expect(listKeysA.json().data).toHaveLength(0);

    const revokeB = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${keyBId}`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA },
    });
    expect(revokeB.statusCode).toBe(404);

    const auditA = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events',
      headers: { cookie: cookieA },
    });
    const serializedAudit = JSON.stringify(auditA.json());
    expect(serializedAudit).not.toContain('admin-b@org-b.local');
    expect(serializedAudit).not.toContain(keyBId);

    await app.close();
  });

  it('passes full 7-role RBAC authorization matrix and Builder own-key boundary [NFR-10, O.1]', async () => {
    const config = createTestConfig();
    const store = new InMemoryIamAuditStore({
      adminEmail: 'owner@elshad.local',
      adminPassword: 'Password123!',
      apiKeyPepper: config.PLATFORM_API_KEY_PEPPER,
    });
    const orgId = [...store.orgs.keys()][0]!;
    const wsId = [...store.workspaces.keys()][0]!;

    const roleCases: Array<{
      role: BuiltInRole;
      canCreateWorkspace: boolean;
      canCreateProject: boolean;
      canListRoleBindings: boolean;
      canManageOwnApiKey: boolean;
      canReadAudit: boolean;
    }> = [
      {
        role: 'org_owner',
        canCreateWorkspace: true,
        canCreateProject: true,
        canListRoleBindings: true,
        canManageOwnApiKey: true,
        canReadAudit: true,
      },
      {
        role: 'workspace_admin',
        canCreateWorkspace: true,
        canCreateProject: true,
        canListRoleBindings: true,
        canManageOwnApiKey: true,
        canReadAudit: true,
      },
      {
        role: 'builder',
        canCreateWorkspace: false,
        canCreateProject: false,
        canListRoleBindings: false,
        canManageOwnApiKey: true,
        canReadAudit: false,
      },
      {
        role: 'operator',
        canCreateWorkspace: false,
        canCreateProject: false,
        canListRoleBindings: false,
        canManageOwnApiKey: false,
        canReadAudit: false,
      },
      {
        role: 'reviewer',
        canCreateWorkspace: false,
        canCreateProject: false,
        canListRoleBindings: false,
        canManageOwnApiKey: false,
        canReadAudit: false,
      },
      {
        role: 'auditor',
        canCreateWorkspace: false,
        canCreateProject: false,
        canListRoleBindings: false,
        canManageOwnApiKey: false,
        canReadAudit: true,
      },
      {
        role: 'viewer',
        canCreateWorkspace: false,
        canCreateProject: false,
        canListRoleBindings: false,
        canManageOwnApiKey: false,
        canReadAudit: false,
      },
    ];

    // Seed an admin-owned API key to verify builder cannot revoke someone else's key
    const ownerPrincipal = [...store.principals.values()][0]!;
    const { record: ownerKey } = await store.createApiKey(orgId, {
      principal_id: ownerPrincipal.id,
      name: 'Owner Key',
      scopes: [],
    });

    const { app } = buildApiServer({ config, store });

    for (const tc of roleCases) {
      const subOrg = store.seedOrganization({
        slug: `org-${tc.role}`,
        name: `Org ${tc.role}`,
        adminEmail: `${tc.role}@elshad.local`,
        adminPassword: 'RolePass123!',
        role: tc.role,
      });

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: `${tc.role}@elshad.local`, password: 'RolePass123!' },
      });
      const cookie = parseCookie(login.headers['set-cookie']);
      const csrf = login.json().csrf_token as string;

      const kebabRole = tc.role.replace(/_/g, '-');
      const wsRes = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: { cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `ws-${tc.role}` },
        payload: { slug: `ws-${kebabRole}`, name: `WS ${tc.role}` },
      });
      expect(wsRes.statusCode).toBe(tc.canCreateWorkspace ? 201 : 403);

      const prjRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${subOrg.workspace.id}/projects`,
        headers: { cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `prj-${tc.role}` },
        payload: { slug: `prj-${kebabRole}`, name: `PRJ ${tc.role}` },
      });
      expect(prjRes.statusCode).toBe(tc.canCreateProject ? 201 : 403);

      const rbRes = await app.inject({
        method: 'GET',
        url: '/api/v1/role-bindings',
        headers: { cookie },
      });
      expect(rbRes.statusCode).toBe(tc.canListRoleBindings ? 200 : 403);

      const keyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `key-${tc.role}` },
        payload: { name: `${tc.role}-key`, scopes: [] },
      });
      expect(keyRes.statusCode).toBe(tc.canManageOwnApiKey ? 201 : 403);

      const auditRes = await app.inject({
        method: 'GET',
        url: '/api/v1/audit-events',
        headers: { cookie },
      });
      expect(auditRes.statusCode).toBe(tc.canReadAudit ? 200 : 403);
    }

    // Builder in same org cannot revoke owner's key
    const builderPrincipalId = '01900000-0000-7000-8000-000000000099';
    store.principals.set(builderPrincipalId, {
      id: builderPrincipalId,
      org_id: orgId,
      type: 'user',
      external_id: null,
      email: 'same-org-builder@elshad.local',
      display_name: 'Same Org Builder',
      disabled_at: null,
    });
    const { session: builderSession } = await store.createSession(
      store.principals.get(builderPrincipalId)!,
    );
    await store.createRoleBinding(orgId, {
      principal_id: builderPrincipalId,
      role_name: 'builder',
      scope_type: 'workspace',
      scope_id: wsId,
    });

    const revokeOtherKey = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${ownerKey.id}`,
      headers: {
        cookie: `platform_session=${builderSession.id}`,
        'x-csrf-token': builderSession.csrf_token,
      },
    });
    expect(revokeOtherKey.statusCode).toBe(403);

    await app.close();
  });

  it('enforces idempotency replay/conflict, rate-limit headers, API keys, and valid audit hash chain [B.1, M.6]', async () => {
    const config = createTestConfig();
    const { app, store } = buildApiServer({
      config,
      rateLimits: { write: 5, read: 50, auth: 50, public: 50 },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@elshad.local', password: 'ChangeMe123!' },
    });
    const cookie = parseCookie(login.headers['set-cookie']);
    const csrf = login.json().csrf_token as string;
    const orgId = login.json().me.org_id as string;

    // Create API key and authenticate with it (write #1)
    const createdKey = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { cookie, 'x-csrf-token': csrf, 'Idempotency-Key': 'create-key-1' },
      payload: { name: 'CI Key', scopes: ['workspace:create', 'audit:read'] },
    });
    expect(createdKey.statusCode).toBe(201);
    const keySecret = createdKey.json().secret as string;
    expect(keySecret).toMatch(/^key_/);

    // Idempotent POST workspace (write #2)
    const ws1 = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { Authorization: `Bearer ${keySecret}`, 'Idempotency-Key': 'ws-idem-1' },
      payload: { slug: 'finance', name: 'Finance Ops' },
    });
    expect(ws1.statusCode).toBe(201);
    expect(ws1.headers['x-ratelimit-limit']).toBe('5');
    expect(ws1.headers['x-ratelimit-remaining']).toBe('3');

    // Replay same key & body -> returns cached 201 (write #3)
    const wsReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { Authorization: `Bearer ${keySecret}`, 'Idempotency-Key': 'ws-idem-1' },
      payload: { slug: 'finance', name: 'Finance Ops' },
    });
    expect(wsReplay.statusCode).toBe(201);
    expect(wsReplay.headers['x-idempotency-replayed']).toBe('true');
    expect(wsReplay.json().id).toBe(ws1.json().id);

    // Reuse same key with DIFFERENT body -> 422 VAL_SCHEMA_MISMATCH (write #4)
    const wsConflict = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { Authorization: `Bearer ${keySecret}`, 'Idempotency-Key': 'ws-idem-1' },
      payload: { slug: 'finance-2', name: 'Different Name' },
    });
    expect(wsConflict.statusCode).toBe(422);
    expect(wsConflict.json().error.code).toBe('VAL_SCHEMA_MISMATCH');

    // Write #5 allowed, write #6 exceeds limit -> 429
    const wsOk5 = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { Authorization: `Bearer ${keySecret}`, 'Idempotency-Key': 'ws-idem-2' },
      payload: { slug: 'sales', name: 'Sales Ops' },
    });
    expect(wsOk5.statusCode).toBe(201);

    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { Authorization: `Bearer ${keySecret}`, 'Idempotency-Key': 'ws-idem-3' },
      payload: { slug: 'legal', name: 'Legal Ops' },
    });
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.json().error.code).toBe('BUD_RATE_LIMITED');
    expect(rateLimited.headers['retry-after']).toBeDefined();

    // Verify OpenAPI endpoint
    const oas = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(oas.statusCode).toBe(200);
    expect(oas.json().openapi).toBe('3.1.0');

    // Verify Prometheus metrics endpoint
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('platform_api_requests_total');

    // Verify full audit chain for org
    const events = (store as InMemoryIamAuditStore).auditEvents.get(orgId) ?? [];
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(verifyAuditEventsChain(events)).toEqual({
      valid: true,
      checkedCount: events.length,
    });

    await app.close();
  });

  it('handles run lifecycle, SSE Last-Event-ID resume, RES_CONFLICT, DLQ redrive, and cross-org isolation [E0.2-4, E0.2-6]', async () => {
    const config = createTestConfig();
    const store = new InMemoryIamAuditStore({
      adminEmail: 'admin-a@org-a.local',
      adminPassword: 'PasswordA123!',
      apiKeyPepper: config.PLATFORM_API_KEY_PEPPER,
    });
    store.seedOrganization({
      slug: 'org-b',
      name: 'Org B',
      adminEmail: 'admin-b@org-b.local',
      adminPassword: 'PasswordB123!',
    });

    const { app } = buildApiServer({ config, store });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin-a@org-a.local', password: 'PasswordA123!' },
    });
    const cookieA = parseCookie(loginA.headers['set-cookie']);
    const csrfA = loginA.json().csrf_token as string;

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin-b@org-b.local', password: 'PasswordB123!' },
    });
    const cookieB = parseCookie(loginB.headers['set-cookie']);
    const csrfB = loginB.json().csrf_token as string;

    // 1. Start inline run with 2 steps
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'run-1' },
      payload: {
        subject_type: 'agent_version',
        subject_version_id: 'agv_1',
        execute_inline: true,
        simulated_steps: [
          { type: 'decision', summary: { note: 'plan' }, cost_micro_usd: 100 },
          { type: 'tool_call', summary: { tool: 'http' }, cost_micro_usd: 250 },
        ],
      },
    });
    expect(runRes.statusCode).toBe(202);
    const runId = runRes.json().id as string;
    expect(runRes.json().status).toBe('succeeded');
    expect(runRes.json().cost_micro_usd).toBe(350);

    // Steps listed
    const stepsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/steps`,
      headers: { cookie: cookieA },
    });
    expect(stepsRes.statusCode).toBe(200);
    expect(stepsRes.json().data).toHaveLength(2);

    // SSE stream & Last-Event-ID resume without gaps
    const fullSse = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/events?stream=true`,
      headers: { cookie: cookieA, Accept: 'text/event-stream' },
    });
    expect(fullSse.statusCode).toBe(200);
    expect(fullSse.headers['content-type']).toContain('text/event-stream');
    expect(fullSse.body).toContain('event: run.created');
    expect(fullSse.body).toContain('event: run.completed');

    const resumedSse = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/events?stream=true`,
      headers: { cookie: cookieA, 'Last-Event-ID': '4' },
    });
    expect(resumedSse.statusCode).toBe(200);
    expect(resumedSse.body).not.toContain('id: 1\n');
    expect(resumedSse.body).not.toContain('id: 4\n');
    expect(resumedSse.body).toContain('id: 5\n');

    // Illegal transition: cancelling a succeeded run -> 409 RES_CONFLICT
    const illegalCancel = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${runId}/cancel`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'cancel-illegal' },
      payload: { reason: 'too late' },
    });
    expect(illegalCancel.statusCode).toBe(409);
    expect(illegalCancel.json().error.code).toBe('RES_CONFLICT');

    // 2. Queued run cancellation
    const queuedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'run-queued' },
      payload: { subject_version_id: 'agv_1' },
    });
    expect(queuedRes.statusCode).toBe(202);
    const queuedId = queuedRes.json().id as string;

    const cancelOk = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${queuedId}/cancel`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'cancel-ok' },
      payload: { reason: 'stop queued' },
    });
    expect(cancelOk.statusCode).toBe(200);
    expect(cancelOk.json().status).toBe('cancelled');

    // 3. Permanent failure -> DLQ -> bulk redrive
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'run-fail' },
      payload: {
        subject_version_id: 'agv_1',
        execute_inline: true,
        simulated_steps: [{ fail_code: 'TOOL_UPSTREAM_REJECTED' }],
      },
    });
    expect(failRes.statusCode).toBe(202);
    const failedId = failRes.json().id as string;
    expect(failRes.json().status).toBe('failed');

    const dlqList = await app.inject({
      method: 'GET',
      url: '/api/v1/dlq',
      headers: { cookie: cookieA },
    });
    expect(dlqList.statusCode).toBe(200);
    expect(dlqList.json().data).toHaveLength(1);
    expect(dlqList.json().data[0].run_id).toBe(failedId);

    const redriveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/runs:bulk-redrive',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'redrive-1' },
      payload: { run_ids: [failedId], input_patch: { retry: true } },
    });
    expect(redriveRes.statusCode).toBe(200);
    expect(redriveRes.json().data[0].status).toBe('queued');

    // 4. Cross-org run isolation
    const orgBGetRun = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}`,
      headers: { cookie: cookieB },
    });
    expect(orgBGetRun.statusCode).toBe(404);

    const orgBListRuns = await app.inject({
      method: 'GET',
      url: '/api/v1/runs',
      headers: { cookie: cookieB },
    });
    expect(orgBListRuns.statusCode).toBe(200);
    expect(orgBListRuns.json().data).toHaveLength(0);

    const orgBRedrive = await app.inject({
      method: 'POST',
      url: '/api/v1/runs:bulk-redrive',
      headers: { cookie: cookieB, 'x-csrf-token': csrfB, 'Idempotency-Key': 'b-redrive' },
      payload: { run_ids: [failedId] },
    });
    expect(orgBRedrive.statusCode).toBe(404);

    await app.close();
  });
});
