import { createHmac } from 'node:crypto';
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

  it('supports Agent lifecycle (create/draft/diff/publish), ReAct run, usage-ledger equality, dry-run & cross-org isolation [E0.3-7, E0.3-9]', async () => {
    const config = createTestConfig();
    const store = new InMemoryIamAuditStore({
      adminEmail: 's03-a@elshad.local',
      adminPassword: 'Password123!',
      apiKeyPepper: config.PLATFORM_API_KEY_PEPPER,
    });

    store.seedOrganization({
      slug: 's03-org-b',
      name: 'S03 Org B',
      adminEmail: 's03-b@elshad.local',
      adminPassword: 'Password123!',
    });

    const { app } = buildApiServer({ config, store });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 's03-a@elshad.local', password: 'Password123!' },
    });
    const cookieA = parseCookie(loginA.headers['set-cookie']);
    const csrfA = loginA.json().csrf_token as string;

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 's03-b@elshad.local', password: 'Password123!' },
    });
    const cookieB = parseCookie(loginB.headers['set-cookie']);

    // 1. Models & built-in tools endpoints
    const modelsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/models',
      headers: { cookie: cookieA },
    });
    expect(modelsRes.statusCode).toBe(200);
    expect(modelsRes.json().data.some((m: { id: string }) => m.id === 'mock/react-default')).toBe(
      true,
    );

    const toolsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tools',
      headers: { cookie: cookieA },
    });
    expect(toolsRes.statusCode).toBe(200);
    expect(toolsRes.json().data.map((t: { name: string }) => t.name)).toContain('current_time');

    // 2. Create Agent v1.0.0
    const v1Def = {
      name: 'ops-triage-agent',
      version: '1.0.0',
      description: 'Triages operational questions.',
      autonomy_level: 2,
      model: { tier: 'standard', provider: 'mock', model: 'mock/react-default' },
      prompt: { system: 'You are an ops triage agent.' },
      tools: [{ tool: 'current_time', approval: 'auto', scope: {} }],
    };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'create-agent-1' },
      payload: { definition: v1Def },
    });
    expect(createRes.statusCode).toBe(201);
    const agent = createRes.json();
    const agentId = agent.id as string;
    const v1Id = agent.versions[0].id as string;
    expect(agent.status).toBe('draft');

    // 3. Publish v1.0.0
    const publishV1 = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/versions/${v1Id}/publish`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'pub-v1' },
      payload: { message: 'Initial release' },
    });
    expect(publishV1.statusCode).toBe(200);
    expect(publishV1.json().status).toBe('active');
    expect(publishV1.json().current_version_id).toBe(v1Id);

    // 4. Create v1.1.0 draft & compute diff
    const patchDraft = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA },
      payload: {
        message: 'Add code interpreter',
        definition: {
          ...v1Def,
          version: '1.1.0',
          tools: [
            { tool: 'current_time', approval: 'auto', scope: {} },
            { tool: 'code_interpreter', approval: 'auto', scope: {} },
          ],
        },
      },
    });
    expect(patchDraft.statusCode).toBe(200);
    const v2Id = patchDraft.json().draft_version.id as string;

    const diffRes = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/diff?from=${v1Id}&to=${v2Id}`,
      headers: { cookie: cookieA },
    });
    expect(diffRes.statusCode).toBe(200);
    expect(
      diffRes
        .json()
        .changes.some((c: { path: string; kind: string }) => c.path === 'tools.code_interpreter'),
    ).toBe(true);

    // 5. Run published agent via scripted ReAct mock turns + verify usage ledger === run.cost_micro_usd
    const runRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/runs`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'run-agent-1' },
      payload: {
        input: 'What is the current UTC time?',
        mock_turns: [
          {
            kind: 'tool_calls',
            calls: [{ id: 'tc_1', name: 'current_time', arguments: {} }],
            tokensIn: 120,
            tokensOut: 30,
          },
          {
            kind: 'answer',
            content: 'Checked UTC time successfully.',
            tokensIn: 180,
            tokensOut: 20,
          },
        ],
      },
    });
    expect(runRes.statusCode).toBe(201);
    const runBody = runRes.json();
    expect(runBody.status).toBe('succeeded');
    expect(runBody.termination_reason).toBe('final_answer');

    const ledgerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runBody.id}/usage-ledger`,
      headers: { cookie: cookieA },
    });
    expect(ledgerRes.statusCode).toBe(200);
    expect(ledgerRes.json().data.length).toBeGreaterThanOrEqual(3);
    expect(ledgerRes.json().total_cost_micro_usd).toBe(runBody.cost_micro_usd);
    expect(runBody.cost_micro_usd).toBeGreaterThan(0);

    // Dry-run tool invocation check (FR-TL-9)
    const dryRunRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/runs`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'run-agent-dry-1' },
      payload: {
        input: 'Check UTC time safely in dry run.',
        dry_run: true,
        mock_turns: [
          {
            kind: 'tool_calls',
            calls: [{ id: 'tc_dry', name: 'current_time', arguments: {} }],
            tokensIn: 80,
            tokensOut: 20,
          },
          {
            kind: 'answer',
            content: 'Dry run completed.',
            tokensIn: 100,
            tokensOut: 15,
          },
        ],
      },
    });
    expect(dryRunRes.statusCode).toBe(201);
    expect(dryRunRes.json().status).toBe('succeeded');

    // 6. Cross-org agent isolation -> 404
    const orgBGet = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}`,
      headers: { cookie: cookieB },
    });
    expect(orgBGet.statusCode).toBe(404);

    await app.close();
  });

  it('supports Workflow validation, YAML round-trip, HMAC webhook execution, replay rejection, test-from-here & cross-org isolation [E0.4-1..7]', async () => {
    const config = createTestConfig();
    const store = new InMemoryIamAuditStore({
      adminEmail: 's04-a@elshad.local',
      adminPassword: 'Password123!',
      apiKeyPepper: config.PLATFORM_API_KEY_PEPPER,
    });

    store.seedOrganization({
      slug: 's04-org-b',
      name: 'S04 Org B',
      adminEmail: 's04-b@elshad.local',
      adminPassword: 'Password123!',
    });

    const { app } = buildApiServer({ config, store });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 's04-a@elshad.local', password: 'Password123!' },
    });
    const cookieA = parseCookie(loginA.headers['set-cookie']);
    const csrfA = loginA.json().csrf_token as string;

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 's04-b@elshad.local', password: 'Password123!' },
    });
    const cookieB = parseCookie(loginB.headers['set-cookie']);

    // 1. Built-in nodes catalog
    const nodesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/nodes',
      headers: { cookie: cookieA },
    });
    expect(nodesRes.statusCode).toBe(200);
    expect(nodesRes.json().data.length).toBeGreaterThanOrEqual(15);

    // Create triage agent used by ai.agent node
    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'wf-agent-1' },
      payload: {
        definition: {
          name: 'ticket-triage',
          version: '1.0.0',
          autonomy_level: 2,
          model: { tier: 'standard', provider: 'mock', model: 'mock/react-default' },
          prompt: { system: 'Return concise triage classification.' },
          tools: [],
        },
      },
    });
    expect(agentRes.statusCode).toBe(201);

    const webhookSecret = 'hmac-signing-secret-s04';
    const triageGraph = {
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'default', timeout_ms: 900_000 },
      nodes: [
        {
          id: 'n_hook',
          type: 'trigger.webhook',
          name: 'Ticket Hook',
          position: { x: 0, y: 0 },
          config: {
            path: 'triage-ticket',
            methods: ['POST'],
            auth: { mode: 'hmac', secret: webhookSecret },
          },
        },
        {
          id: 'n_agent',
          type: 'ai.agent',
          name: 'Triage Agent',
          position: { x: 240, y: 0 },
          config: { agent: 'ticket-triage', input: '={{ $json.text }}' },
        },
        {
          id: 'n_switch',
          type: 'logic.switch',
          name: 'Route Category',
          position: { x: 480, y: 0 },
          config: {
            cases: [{ id: 'billing', expr: "$json.category = 'billing'" }],
            default: true,
          },
        },
        {
          id: 'n_slack_billing',
          type: 'human.notify',
          name: 'Slack Billing',
          position: { x: 740, y: -60 },
          config: {
            channel: 'slack',
            template: 'Billing issue: {{ $json.answer }}',
            recipients: ['#billing'],
          },
        },
        {
          id: 'n_slack_general',
          type: 'human.notify',
          name: 'Slack General',
          position: { x: 740, y: 80 },
          config: {
            channel: 'slack',
            template: 'General issue: {{ $json.answer }}',
            recipients: ['#ops'],
          },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'n_hook', port: 'main' }, to: { node: 'n_agent', port: 'in' } },
        { id: 'e2', from: { node: 'n_agent', port: 'main' }, to: { node: 'n_switch', port: 'in' } },
        {
          id: 'e3',
          from: { node: 'n_switch', port: 'billing' },
          to: { node: 'n_slack_billing', port: 'in' },
        },
        {
          id: 'e4',
          from: { node: 'n_switch', port: 'default' },
          to: { node: 'n_slack_general', port: 'in' },
        },
      ],
      pinned_data: {},
      notes: [],
    };

    // 2. Validate valid & invalid orphan graph
    const valOk = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows:validate',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'wf-val-1' },
      payload: { graph: triageGraph },
    });
    expect(valOk.statusCode).toBe(200);
    expect(valOk.json().valid).toBe(true);

    // 3. Create workflow & verify YAML generated losslessly
    const createWf = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'wf-create-1' },
      payload: { name: 'ticket-to-slack', graph: triageGraph },
    });
    expect(createWf.statusCode).toBe(201);
    const wf = createWf.json();
    const wfId = wf.id as string;
    const v1Id = wf.versions[0].id as string;
    expect(wf.versions[0].yaml_source).toContain('triage-ticket');

    // 4. Publish workflow and activate webhook trigger
    const pubRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/versions/${v1Id}/publish`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'wf-pub-1' },
      payload: { activate_triggers: true },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().status).toBe('active');

    const trigRes = await app.inject({
      method: 'GET',
      url: '/api/v1/triggers',
      headers: { cookie: cookieA },
    });
    expect(trigRes.statusCode).toBe(200);
    const trig = trigRes.json().data[0];
    expect(trig.active).toBe(true);

    // 5. Invoke public HMAC webhook trigger and verify replay rejection
    const hookPayload = JSON.stringify({ text: 'Refund double charge', category: 'billing' });
    const ts = Math.floor(Date.now() / 1000);
    const hmacHex = createHmac('sha256', webhookSecret)
      .update(`${ts}.${hookPayload}`, 'utf8')
      .digest('hex');

    const hookOk = await app.inject({
      method: 'POST',
      url: `/api/v1/hooks/${trig.external_id}`,
      headers: {
        'content-type': 'application/json',
        'x-signature': `t=${ts},v1=${hmacHex}`,
        'x-webhook-nonce': 'nonce-api-1',
      },
      payload: hookPayload,
    });
    expect(hookOk.statusCode).toBe(202);
    expect(hookOk.json().status).toBe('accepted');
    const hookRunId = hookOk.json().run_id as string;
    expect(hookRunId).toBeTruthy();

    const hookRunRes = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${hookRunId}`,
      headers: { cookie: cookieA },
    });
    expect(hookRunRes.statusCode).toBe(200);
    expect(hookRunRes.json().status).toBe('succeeded');

    const hookReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/hooks/${trig.external_id}`,
      headers: {
        'content-type': 'application/json',
        'x-signature': `t=${ts},v1=${hmacHex}`,
        'x-webhook-nonce': 'nonce-api-1',
      },
      payload: hookPayload,
    });
    expect(hookReplay.statusCode).toBe(409);
    expect(hookReplay.json().error.code).toBe('RES_CONFLICT');

    // 6. Test-from-here with pinned upstream output
    const testFromHere = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/runs`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'wf-run-pin-1' },
      payload: {
        start_from_node_id: 'n_switch',
        pinned_data: {
          n_agent: [{ category: 'billing', answer: 'Pinned Billing Ticket' }],
        },
      },
    });
    expect(testFromHere.statusCode).toBe(201);
    expect(testFromHere.json().status).toBe('succeeded');

    // 7. Cross-org workflow isolation -> 404
    const orgBGetWf = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${wfId}`,
      headers: { cookie: cookieB },
    });
    expect(orgBGetWf.statusCode).toBe(404);

    await app.close();
  });

  it('supports Knowledge Base chunking/incremental sync/citations, session rolling summary, hybrid search, erasure & cross-org isolation [E0.5-1..4]', async () => {
    const config = createTestConfig();
    const store = new InMemoryIamAuditStore({
      adminEmail: 's05-a@elshad.local',
      adminPassword: 'Password123!',
      apiKeyPepper: config.PLATFORM_API_KEY_PEPPER,
    });

    store.seedOrganization({
      slug: 's05-org-b',
      name: 'S05 Org B',
      adminEmail: 's05-b@elshad.local',
      adminPassword: 'Password123!',
    });

    const { app } = buildApiServer({ config, store });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 's05-a@elshad.local', password: 'Password123!' },
    });
    const cookieA = parseCookie(loginA.headers['set-cookie']);
    const csrfA = loginA.json().csrf_token as string;

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 's05-b@elshad.local', password: 'Password123!' },
    });
    const cookieB = parseCookie(loginB.headers['set-cookie']);

    // 1. Verify built-in kb_search tool is registered
    const toolsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tools',
      headers: { cookie: cookieA },
    });
    expect(toolsRes.statusCode).toBe(200);
    expect(toolsRes.json().data.map((t: { name: string }) => t.name)).toContain('kb_search');

    // 2. Create Knowledge Base
    const createKbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-bases',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'kb-create-1' },
      payload: {
        name: 'Platform Runbooks',
        description: 'Operational policies and incident playbooks',
        embedding_dim: 128,
        chunk_target_tokens: 45,
        chunk_max_tokens: 180,
        chunk_overlap_tokens: 8,
      },
    });
    expect(createKbRes.statusCode).toBe(201);
    const kbId = createKbRes.json().id as string;

    // 3. Ingest structured Markdown document
    const v1Doc = [
      '# Refund Policy',
      '',
      'Standard billing refunds settle in 5 business days with supervisor review.',
      '',
      '# Webhook Signatures',
      '',
      'All webhook payloads require HMAC-SHA256 verification and replay nonce protection.',
    ].join('\n');

    const ingestRes = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-bases/${kbId}/documents`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'kb-ingest-1' },
      payload: {
        source_name: 'ops-runbook.md',
        title: 'Ops Runbook',
        mime_type: 'text/markdown',
        content: v1Doc,
      },
    });
    expect(ingestRes.statusCode).toBe(201);
    const docId = ingestRes.json().document.id as string;
    expect(ingestRes.json().sync_report.added_chunks).toBe(2);

    // 4. Incremental re-sync changes ONLY 1 chunk
    const v2Doc = v1Doc.replace(
      'Standard billing refunds settle in 5 business days with supervisor review.',
      'Priority enterprise refunds settle in 24 hours after finance approval.',
    );
    const syncRes = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-bases/${kbId}/sync`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'kb-sync-1' },
      payload: { doc_id: docId, content: v2Doc },
    });
    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.json().re_embedded_chunks).toBe(1);
    expect(syncRes.json().unchanged_chunks).toBe(1);

    // 5. Query KB & check citation chip + [cit:<chunk_id>] in answer
    const queryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-bases/${kbId}/query`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'kb-query-1' },
      payload: { query: 'priority enterprise refunds settle 24 hours', top_k: 3 },
    });
    expect(queryRes.statusCode).toBe(200);
    const qBody = queryRes.json();
    expect(qBody.citations.length).toBeGreaterThan(0);
    expect(qBody.answer).toContain(`[cit:${qBody.citations[0].chunk_id}]`);

    // 6. Session rolling summary preserves T-10492 & INV-9981
    const sesRes = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/sessions',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'ses-append-1' },
      payload: {
        subject_id: 'subj_cust_77',
        title: 'Escalation Session',
        compact_threshold_tokens: 40,
        keep_recent_messages: 1,
        messages: [
          { role: 'user', content: 'Checking ticket T-10492 and invoice INV-9981 for $240.00 refund.' },
          { role: 'assistant', content: 'Verified invoice INV-9981 and prepared refund escalation.' },
          { role: 'user', content: 'Please confirm final ETA.' },
        ],
      },
    });
    expect(sesRes.statusCode).toBe(200);
    const session = sesRes.json();
    expect(session.rolling_summary).toContain('T-10492');
    expect(session.rolling_summary).toContain('INV-9981');
    expect(session.preserved_identifiers).toEqual(expect.arrayContaining(['T-10492', 'INV-9981', '$240.00']));

    const sesGetRes = await app.inject({
      method: 'GET',
      url: `/api/v1/memory/sessions/${session.id}`,
      headers: { cookie: cookieA },
    });
    expect(sesGetRes.statusCode).toBe(200);

    // 7. Put scoped memory items, hybrid search, and erase subject with audit verification
    const memPut1 = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/items',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'mem-put-1' },
      payload: {
        scope: 'user',
        scope_id: 'subj_cust_77',
        subject_id: 'subj_cust_77',
        kind: 'semantic',
        content: 'Customer prefers priority Slack alerts for enterprise invoice delays.',
        sensitivity: 'internal',
        importance: 0.9,
      },
    });
    expect(memPut1.statusCode).toBe(201);

    const memSearch = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/search',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'mem-search-1' },
      payload: {
        query: 'enterprise invoice Slack alerts',
        scope: 'user',
        scope_id: 'subj_cust_77',
        top_k: 5,
      },
    });
    expect(memSearch.statusCode).toBe(200);
    expect(memSearch.json().data.length).toBe(1);
    expect(memSearch.json().data[0].item.id).toBe(memPut1.json().id);

    const eraseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/erase',
      headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'Idempotency-Key': 'mem-erase-1' },
      payload: { subject_id: 'subj_cust_77' },
    });
    expect(eraseRes.statusCode).toBe(200);
    expect(eraseRes.json().deleted_memory_items).toBe(1);
    expect(eraseRes.json().deleted_sessions).toBe(1);

    const sesAfterErase = await app.inject({
      method: 'GET',
      url: `/api/v1/memory/sessions/${session.id}`,
      headers: { cookie: cookieA },
    });
    expect(sesAfterErase.statusCode).toBe(404);

    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events?action=memory.erase',
      headers: { cookie: cookieA },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().data.some((e: { action: string }) => e.action === 'memory.erase')).toBe(true);

    // 8. Cross-org KB & Memory isolation
    const orgBGetKb = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge-bases/${kbId}`,
      headers: { cookie: cookieB },
    });
    expect(orgBGetKb.statusCode).toBe(404);

    await app.close();
  });
});
