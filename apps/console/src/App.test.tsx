// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import {
  PlatformClient,
  type ApiKeyDto,
  type MeDto,
} from '@elshad/sdk-ts';
import { ConsoleApp } from './App.js';

afterEach(() => {
  cleanup();
});

function createMockClient(opts: { authenticatedInitially?: boolean } = {}) {
  let authed = opts.authenticatedInitially ?? false;
  const keys: ApiKeyDto[] = [];

  const me: MeDto = {
    principal: {
      id: 'prn_1',
      orgId: 'org_1',
      type: 'user',
      email: 'admin@elshad.local',
      displayName: 'Platform Admin',
    },
    orgId: 'org_1',
    orgSlug: 'default-org',
    orgName: 'Default Organization',
    bindings: [
      {
        id: 'rbi_1',
        principalId: 'prn_1',
        roleId: 'rol_1',
        roleName: 'org_owner',
        scopeType: 'org',
        scopeId: 'org_1',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
    ],
    workspaces: [
      {
        id: 'ws_1',
        orgId: 'org_1',
        slug: 'default',
        name: 'Default Workspace',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
      {
        id: 'ws_2',
        orgId: 'org_1',
        slug: 'finance',
        name: 'Finance Ops',
        createdAt: '2026-11-18T12:00:00.000Z',
      },
    ],
  };

  const client = new PlatformClient({ baseUrl: 'http://localhost:8080' });

  client.auth.me = async () => {
    if (!authed) {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Not signed in');
    }
    return me;
  };
  client.auth.login = async (_email, password) => {
    if (password !== 'ChangeMe123!') {
      throw new PlatformError('AUTH_UNAUTHENTICATED', 'Invalid email or password.');
    }
    authed = true;
    return { csrfToken: 'csrf_1', me };
  };
  client.auth.logout = async () => {
    authed = false;
  };
  client.projects.list = async () => [
    {
      id: 'prj_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      slug: 'default-project',
      name: 'Default Project',
      description: null,
      maxAutonomyLevel: 'L3',
      createdAt: '2026-11-18T12:00:00.000Z',
    },
  ];
  client.apiKeys.list = async () => [...keys];
  client.apiKeys.create = async (input) => {
    const item = {
      id: `key_${keys.length + 1}`,
      name: input.name,
      keyPrefix: 'key_abc12345',
      scopes: input.scopes ?? [],
      workspaceId: input.workspaceId ?? null,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-11-18T12:00:00.000Z',
      secret: 'key_abc12345_super_secret_once',
    };
    keys.push(item);
    return item;
  };
  client.apiKeys.revoke = async (id) => {
    const found = keys.find((k) => k.id === id);
    if (found) found.revokedAt = '2026-11-18T12:05:00.000Z';
  };
  client.auditEvents.list = async () => ({
    data: [
      {
        id: 'aud_1',
        seq: 1,
        ts: '2026-11-18T12:00:00.000Z',
        actor: { id: 'prn_1' },
        action: 'auth.login',
        resource: { type: 'session' },
        decision: 'allow',
        hash: 'a'.repeat(64),
        prevHash: '0'.repeat(64),
      },
    ],
    nextCursor: null,
  });

  return client;
}

describe('@elshad/console shell, env safety, API keys, and accessibility [E0.1-7, NFR-15]', () => {
  it('logs in, switches workspace & environment in URL, activates PROD safety banner, and manages API keys', async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const { container } = render(<ConsoleApp client={client} initialPath="/" />);

    // Login screen loads
    const pwInput = await screen.findByLabelText('Password');
    await user.type(pwInput, 'ChangeMe123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Home dashboard appears
    expect(await screen.findByRole('heading', { name: 'Platform Overview' })).toBeTruthy();

    // Switch environment to PROD -> URL updates and safety banner renders
    const envSelect = screen.getByLabelText('Environment');
    await user.selectOptions(envSelect, 'prod');
    await waitFor(() => {
      expect(window.location.pathname).toBe('/w/default/e/prod/home');
    });
    expect(screen.getByRole('region', { name: 'Production safety notice' })).toBeTruthy();

    // Switch workspace -> URL updates
    const wsSelect = screen.getByLabelText('Workspace');
    await user.selectOptions(wsSelect, 'finance');
    await waitFor(() => {
      expect(window.location.pathname).toBe('/w/finance/e/prod/home');
    });

    // Open command palette with Ctrl+K and navigate to Settings
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go to Settings' }));

    expect(await screen.findByRole('heading', { name: 'API Keys' })).toBeTruthy();

    // Create API key and observe one-time secret
    const keyInput = screen.getByLabelText('API Key Name');
    await user.type(keyInput, 'Deploy Key');
    await user.click(screen.getByRole('button', { name: 'Create API Key' }));

    expect(await screen.findByText('key_abc12345_super_secret_once')).toBeTruthy();

    // Revoke key
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Revoked')).toBeTruthy();

    // Accessibility check in light theme
    const axeLight = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeLight.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  });

  it('passes axe accessibility checks in dark theme on login and authenticated shell [NFR-15]', async () => {
    const clientUnauth = createMockClient({ authenticatedInitially: false });
    const { container: loginContainer } = render(
      <ConsoleApp client={clientUnauth} initialTheme="dark" />,
    );
    await screen.findByRole('heading', { name: 'Sign in to Elshad Platform' });
    const axeLogin = await axe.run(loginContainer, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeLogin.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
    cleanup();

    const clientAuth = createMockClient({ authenticatedInitially: true });
    const { container: shellContainer } = render(
      <ConsoleApp client={clientAuth} initialTheme="dark" initialPath="/w/default/e/dev/governance" />,
    );
    await screen.findByRole('heading', { name: 'Immutable Audit Log' });
    const axeShell = await axe.run(shellContainer, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(axeShell.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  });
});
