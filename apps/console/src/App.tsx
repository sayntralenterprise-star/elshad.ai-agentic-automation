import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  Bot,
  CheckSquare,
  Database,
  FileCheck2,
  GitBranch,
  Home,
  KeyRound,
  Moon,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Search,
  Settings,
  Shield,
  Sun,
  Wrench,
  Bell,
} from 'lucide-react';
import { PlatformError, type EnvironmentKind } from '@elshad/domain';
import {
  PlatformClient,
  type ApiKeyDto,
  type AuditEventDto,
  type CreatedApiKeyDto,
  type DlqItemDto,
  type MeDto,
  type ProjectDto,
  type RunDto,
  type RunEventDto,
  type RunStepDto,
} from '@elshad/sdk-ts';
import { EnvBadge, StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import { AgentStudioView } from './AgentStudioView.js';
import { ApprovalsView } from './ApprovalsView.js';
import { EvaluationsView } from './EvaluationsView.js';
import { GovernanceHardeningView } from './GovernanceHardeningView.js';
import { KnowledgeMemoryView } from './KnowledgeMemoryView.js';
import { RunsView } from './RunsView.js';
import { WorkflowCanvasView } from './WorkflowCanvasView.js';
import { t } from './i18n.js';

export type NavSection =
  | 'home'
  | 'agents'
  | 'workflows'
  | 'tools'
  | 'knowledge'
  | 'runs'
  | 'approvals'
  | 'evaluations'
  | 'monitoring'
  | 'governance'
  | 'settings';

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

interface NavItem {
  id: NavSection;
  label: string;
  icon: typeof Home;
  sliceHint?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'agents', label: 'Agents', icon: Bot, sliceHint: 'S0.3' },
  { id: 'workflows', label: 'Workflows', icon: GitBranch, sliceHint: 'S0.4' },
  { id: 'tools', label: 'Tools & Connections', icon: Wrench, sliceHint: 'S0.3 / S1.5' },
  { id: 'knowledge', label: 'Knowledge & Memory', icon: Database, sliceHint: 'S0.5' },
  { id: 'runs', label: 'Runs' , icon: Activity },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare, sliceHint: 'S1.1' },
  { id: 'evaluations', label: 'Evaluations', icon: FileCheck2, sliceHint: 'S1.3' },
  { id: 'monitoring', label: 'Monitoring', icon: Activity, sliceHint: 'S1.8' },
  { id: 'governance', label: 'Governance', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function parseConsoleRoute(pathname: string): {
  workspaceSlug?: string;
  env?: EnvironmentKind;
  section?: NavSection;
} {
  const match = /^\/w\/([^/]+)\/e\/(dev|staging|prod)(?:\/([^/]+))?/.exec(pathname);
  if (!match) return {};
  const section = match[3] as NavSection | undefined;
  const validSections = new Set(NAV_ITEMS.map((n) => n.id));
  return {
    workspaceSlug: decodeURIComponent(match[1]!),
    env: match[2] as EnvironmentKind,
    section: section && validSections.has(section) ? section : 'home',
  };
}

export function formatConsoleRoute(
  workspaceSlug: string,
  env: EnvironmentKind,
  section: NavSection,
): string {
  return `/w/${encodeURIComponent(workspaceSlug)}/e/${env}/${section}`;
}

export interface ConsoleAppProps {
  client?: PlatformClient;
  initialPath?: string;
  initialTheme?: ThemeMode;
}

export function ConsoleApp({ client: providedClient, initialPath, initialTheme }: ConsoleAppProps) {
  const client = useMemo(
    () => providedClient ?? new PlatformClient({ baseUrl: '' }),
    [providedClient],
  );

  const initialRoute = parseConsoleRoute(
    initialPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/'),
  );

  const [theme, setTheme] = useState<ThemeMode>(initialTheme ?? 'light');
  const [me, setMe] = useState<MeDto | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginError, setLoginError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [email, setEmail] = useState('admin@elshad.local');
  const [password, setPassword] = useState('');

  const [workspaceSlug, setWorkspaceSlug] = useState<string>(
    initialRoute.workspaceSlug ?? 'default',
  );
  const [env, setEnv] = useState<EnvironmentKind>(initialRoute.env ?? 'dev');
  const [section, setSection] = useState<NavSection>(initialRoute.section ?? 'home');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [bottomDrawerOpen, setBottomDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyDto[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysError, setApiKeysError] = useState<PlatformError | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKeySecret, setCreatedKeySecret] = useState<CreatedApiKeyDto | null>(null);

  const [auditEvents, setAuditEvents] = useState<AuditEventDto[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<PlatformError | null>(null);

  const [runs, setRuns] = useState<RunDto[]>([]);
  const [dlqItems, setDlqItems] = useState<DlqItemDto[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<PlatformError | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDto | null>(null);
  const [selectedSteps, setSelectedSteps] = useState<RunStepDto[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<RunEventDto[]>([]);
  const [selectedStep, setSelectedStep] = useState<RunStepDto | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const activeWorkspace = useMemo(() => {
    if (!me) return null;
    return (
      me.workspaces.find((w) => w.slug === workspaceSlug) ??
      me.workspaces[0] ??
      null
    );
  }, [me, workspaceSlug]);

  const syncUrl = useCallback(
    (nextWsSlug: string, nextEnv: EnvironmentKind, nextSection: NavSection) => {
      if (typeof window !== 'undefined') {
        const nextUrl = formatConsoleRoute(nextWsSlug, nextEnv, nextSection);
        if (window.location.pathname !== nextUrl) {
          window.history.pushState({}, '', nextUrl);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeWorkspace) return;
    client.setScope({ workspaceId: activeWorkspace.id, environment: env });
    syncUrl(activeWorkspace.slug, env, section);
  }, [activeWorkspace, env, section, client, syncUrl]);

  useEffect(() => {
    let cancelled = false;
    client.auth
      .me()
      .then((profile) => {
        if (cancelled) return;
        setMe(profile);
        if (profile.workspaces[0] && !initialRoute.workspaceSlug) {
          setWorkspaceSlug(profile.workspaces[0].slug);
        }
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, initialRoute.workspaceSlug]);

  const loadWorkspaceData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const prj = await client.projects.list(activeWorkspace.id);
      setProjects(prj);
    } catch {
      setProjects([]);
    }
  }, [activeWorkspace, client]);

  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    setApiKeysError(null);
    try {
      const rows = await client.apiKeys.list();
      setApiKeys(rows);
    } catch (err) {
      setApiKeysError(err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to load API keys'));
    } finally {
      setApiKeysLoading(false);
    }
  }, [client]);

  const loadAuditEvents = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const page = await client.auditEvents.list({ limit: 50 });
      setAuditEvents(page.data);
    } catch (err) {
      setAuditError(err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to load audit events'));
    } finally {
      setAuditLoading(false);
    }
  }, [client]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const [runRows, dlqRows] = await Promise.all([
        client.runs.list({ workspaceId: activeWorkspace?.id }),
        client.runs.listDlq(),
      ]);
      setRuns(runRows);
      setDlqItems(dlqRows);
    } catch (err) {
      setRunsError(
        err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to load runs'),
      );
    } finally {
      setRunsLoading(false);
    }
  }, [client, activeWorkspace?.id]);

  const selectRun = useCallback(
    async (runId: string) => {
      try {
        const [run, steps, evts] = await Promise.all([
          client.runs.get(runId),
          client.runs.listSteps(runId),
          client.runs.listEvents(runId),
        ]);
        setSelectedRun(run);
        setSelectedSteps(steps);
        setSelectedEvents(evts);
        setSelectedStep(null);
      } catch (err) {
        setRunsError(
          err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to load trace'),
        );
      }
    },
    [client],
  );

  useEffect(() => {
    if (!me) return;
    void loadWorkspaceData();
    if (section === 'settings') {
      void loadApiKeys();
    } else if (section === 'governance') {
      void loadAuditEvents();
    } else if (section === 'runs') {
      void loadRuns();
    }
  }, [me, section, loadWorkspaceData, loadApiKeys, loadAuditEvents, loadRuns]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === '?' && !paletteOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          setShortcutsOpen((prev) => !prev);
        }
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen]);

  async function handleLogin(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await client.auth.login(email, password);
      setMe(res.me);
      if (res.me.workspaces[0]) {
        setWorkspaceSlug(res.me.workspaces[0].slug);
      }
    } catch (err) {
      if (err instanceof PlatformError) {
        setLoginError({ message: err.message, code: err.code });
      } else {
        setLoginError({ message: 'Unable to sign in' });
      }
    }
  }

  async function handleOidcLogin(): Promise<void> {
    try {
      const res = await fetch('/api/v1/auth/oidc/authorize');
      const data = (await res.json()) as { authorize_url?: string };
      if (data.authorize_url && typeof window !== 'undefined') {
        window.location.assign(data.authorize_url);
      }
    } catch {
      setLoginError({ message: 'OIDC discovery is not reachable.' });
    }
  }

  async function handleCreateApiKey(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setApiKeysError(null);
    try {
      const created = await client.apiKeys.create(
        {
          name: newKeyName.trim(),
          scopes: [],
          workspaceId: activeWorkspace?.id,
        },
        `ui-key-${Date.now()}`,
      );
      setCreatedKeySecret(created);
      setNewKeyName('');
      await loadApiKeys();
    } catch (err) {
      setApiKeysError(err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to create API key'));
    }
  }

  async function handleRevokeApiKey(id: string): Promise<void> {
    try {
      await client.apiKeys.revoke(id);
      await loadApiKeys();
    } catch (err) {
      setApiKeysError(err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to revoke key'));
    }
  }

  async function handleLogout(): Promise<void> {
    await client.auth.logout();
    setMe(null);
    setPassword('');
  }

  if (authChecking) {
    return (
      <main style={{ padding: '32px', maxWidth: '480px', margin: '0 auto' }}>
        <StateView
          state="loading"
          title="Loading console session"
          description="Checking your authentication state..."
        />
      </main>
    );
  }

  if (!me) {
    return (
      <div
        data-theme={theme}
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg)',
          color: 'var(--text-primary)',
          padding: '24px',
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: '420px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '28px',
          }}
        >
          <h1 style={{ margin: '0 0 6px 0', fontSize: '20px' }}>{t('login.title')}</h1>
          <p style={{ margin: '0 0 20px 0', color: 'var(--text-secondary)' }}>
            {t('login.subtitle')}
          </p>

          {loginError && (
            <div role="alert" style={{ marginBottom: '16px' }}>
              <StateView
                state="error"
                title="Sign-in failed"
                description={loginError.message}
                errorCode={loginError.code}
              />
            </div>
          )}

          <form onSubmit={(e) => void handleLogin(e)} style={{ display: 'grid', gap: '14px' }}>
            <div>
              <label htmlFor="login-email" style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                {t('login.email')}
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '36px',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label htmlFor="login-password" style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                {t('login.password')}
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '36px',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                minHeight: '38px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: 'var(--brand-contrast)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('login.submit')}
            </button>

            <button
              type="button"
              onClick={() => void handleOidcLogin()}
              style={{
                minHeight: '38px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('login.sso')}
            </button>
          </form>
        </main>
      </div>
    );
  }

  const isProd = env === 'prod';
  const filteredNavForPalette = NAV_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  return (
    <div
      data-theme={theme}
      data-environment={env}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg)',
        color: 'var(--text-primary)',
        borderTop: isProd ? '4px solid var(--env-prod)' : '4px solid transparent',
      }}
    >
      {isProd && (
        <div
          role="region"
          aria-label="Production safety notice"
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: 600,
            borderBottom: '1px solid var(--danger)',
          }}
        >
          {t('env.prod.banner')}
        </div>
      )}

      {/* Top Bar (§7.2) */}
      <header
        style={{
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setNavCollapsed((v) => !v)}
            style={{
              minWidth: '32px',
              minHeight: '32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>

          <strong>{me.orgName}</strong>

          <label htmlFor="workspace-select" style={{ position: 'absolute', left: '-9999px' }}>
            Workspace
          </label>
          <select
            id="workspace-select"
            aria-label="Workspace"
            value={activeWorkspace?.slug ?? ''}
            onChange={(e) => setWorkspaceSlug(e.target.value)}
            style={{
              minHeight: '32px',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg)',
              color: 'var(--text-primary)',
            }}
          >
            {me.workspaces.map((ws) => (
              <option key={ws.id} value={ws.slug}>
                {ws.name}
              </option>
            ))}
          </select>

          <label htmlFor="env-select" style={{ position: 'absolute', left: '-9999px' }}>
            Environment
          </label>
          <select
            id="env-select"
            aria-label="Environment"
            value={env}
            onChange={(e) => setEnv(e.target.value as EnvironmentKind)}
            style={{
              minHeight: '32px',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="dev">DEV</option>
            <option value="staging">STAGING</option>
            <option value="prod">PROD</option>
          </select>

          <EnvBadge env={env} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            style={{
              minHeight: '32px',
              padding: '4px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Search size={14} aria-hidden="true" />
            <span>Search (Ctrl+K)</span>
          </button>

          <button
            type="button"
            aria-label="Toggle right inspector"
            onClick={() => setRightDrawerOpen((v) => !v)}
            style={{
              minWidth: '32px',
              minHeight: '32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <PanelRight size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label="Toggle bottom console"
            onClick={() => setBottomDrawerOpen((v) => !v)}
            style={{
              minWidth: '32px',
              minHeight: '32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <PanelBottom size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label="Notifications"
            style={{
              minWidth: '32px',
              minHeight: '32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <Bell size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label={`Switch theme (current: ${theme})`}
            onClick={() =>
              setTheme((curr) =>
                curr === 'light' ? 'dark' : curr === 'dark' ? 'high-contrast' : 'light',
              )
            }
            style={{
              minWidth: '32px',
              minHeight: '32px',
              padding: '0 8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            {theme === 'light' ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            <span>{theme}</span>
          </button>

          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {me.principal.displayName}
          </span>

          <button
            type="button"
            onClick={() => void handleLogout()}
            style={{
              minHeight: '32px',
              padding: '4px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left Navigation (§7.2) */}
        <nav
          aria-label="Primary"
          style={{
            width: navCollapsed ? '60px' : '220px',
            backgroundColor: 'var(--surface)',
            borderRight: '1px solid var(--border)',
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setSection(item.id)}
                style={{
                  minHeight: '34px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: active ? '1px solid var(--brand)' : '1px solid transparent',
                  backgroundColor: active ? 'var(--info-bg)' : 'transparent',
                  color: active ? 'var(--info)' : 'var(--text-primary)',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {!navCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Main Workspace + Bottom Drawer */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <main style={{ flex: 1, padding: '24px', overflow: 'auto' }}>
            {section === 'home' && (
              <div style={{ display: 'grid', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h1 style={{ margin: 0, fontSize: '22px' }}>{t('home.title')}</h1>
                  <StatusChip label="Slice S1.1 Active (Human-in-the-loop)" tone="success" />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <div style={{ padding: '16px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Workspaces</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{me.workspaces.length}</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Projects in Workspace</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{projects.length}</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Active Environment</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{env.toUpperCase()}</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Role Bindings</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{me.bindings.length}</div>
                  </div>
                </div>

                <section
                  aria-label={t('home.onboarding')}
                  style={{
                    padding: '20px',
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <h2 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>{t('home.onboarding')}</h2>
                  <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '8px' }}>
                    <li>Authenticate &amp; verify organization tenancy — Complete</li>
                    <li>
                      Issue a scoped API key for CLI/SDK automation —{' '}
                      <button
                        type="button"
                        onClick={() => setSection('settings')}
                        style={{
                          minHeight: '28px',
                          padding: '2px 8px',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--surface-raised)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        Go to Settings → API Keys
                      </button>
                    </li>
                    <li>Inspect hash-chained audit events — available under Governance</li>
                    <li>Durable run engine &amp; trace viewer — available under Runs</li>
                    <li>First ReAct agent &amp; Model Gateway — available under Agents</li>
                    <li>Workflow Canvas, YAML round-trip &amp; triggers — available under Workflows</li>
                    <li>pgvector Knowledge Bases, citations &amp; scoped Memory Explorer — available under Knowledge &amp; Memory</li>
                    <li>Envelope secrets vault, 1-step budgets &amp; emergency kill switches — available under Governance</li>
                    <li>Governance v1: O.1 RBAC, agent identities, scoped tool grants, declarative policies &amp; evidence packs — available under Governance</li>
                    <li>Human-in-the-loop Approvals Inbox, Slack/email notifications &amp; edit-and-approve — available under Approvals</li>
                    <li>Evaluation v1: Golden datasets, test cases, automated graders, experiments matrix &amp; release gates — available under Evaluations</li>
                  </ul>
                </section>
              </div>
            )}

            {section === 'settings' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <KeyRound size={20} aria-hidden="true" />
                  <h1 style={{ margin: 0, fontSize: '22px' }}>{t('settings.apikeys.title')}</h1>
                </div>

                <form
                  onSubmit={(e) => void handleCreateApiKey(e)}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'end',
                    padding: '16px',
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="new-api-key-name"
                      style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
                    >
                      API Key Name
                    </label>
                    <input
                      id="new-api-key-name"
                      type="text"
                      placeholder="e.g., CI Pipeline Key"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '34px',
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    style={{
                      minHeight: '34px',
                      padding: '6px 14px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: 'var(--brand-contrast)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Create API Key
                  </button>
                </form>

                {createdKeySecret && (
                  <div
                    role="status"
                    style={{
                      padding: '14px',
                      backgroundColor: 'var(--success-bg)',
                      border: '1px solid var(--success)',
                      borderRadius: 'var(--radius-md)',
                      display: 'grid',
                      gap: '6px',
                    }}
                  >
                    <SuccessNotice message="API key created. Copy this secret now — it will not be shown again." />
                    <code style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                      {createdKeySecret.secret}
                    </code>
                  </div>
                )}

                {apiKeysLoading && (
                  <StateView
                    state="loading"
                    title="Loading API keys"
                    description="Fetching active and revoked keys..."
                  />
                )}

                {!apiKeysLoading && apiKeysError && (
                  <StateView
                    state={apiKeysError.code === 'AUTH_FORBIDDEN' ? 'forbidden' : 'error'}
                    title={
                      apiKeysError.code === 'AUTH_FORBIDDEN'
                        ? 'Permission required'
                        : 'Failed to load API keys'
                    }
                    description={apiKeysError.message}
                    errorCode={apiKeysError.code}
                    requiredPermission={
                      apiKeysError.code === 'AUTH_FORBIDDEN' ? 'api_key:manage' : undefined
                    }
                    actionLabel="Retry"
                    onAction={() => void loadApiKeys()}
                  />
                )}

                {!apiKeysLoading && !apiKeysError && apiKeys.length === 0 && (
                  <StateView
                    state="empty"
                    title="No API keys yet"
                    description="Create a scoped API key above to call the REST API or run agentctl."
                  />
                )}

                {!apiKeysLoading && !apiKeysError && apiKeys.length > 0 && (
                  <table
                    aria-label="API keys"
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '10px' }}>Name</th>
                        <th style={{ padding: '10px' }}>Prefix</th>
                        <th style={{ padding: '10px' }}>Status</th>
                        <th style={{ padding: '10px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((k) => (
                        <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px' }}>{k.name}</td>
                          <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                            {k.keyPrefix}…
                          </td>
                          <td style={{ padding: '10px' }}>
                            <StatusChip
                              label={k.revokedAt ? 'Revoked' : 'Active'}
                              tone={k.revokedAt ? 'danger' : 'success'}
                            />
                          </td>
                          <td style={{ padding: '10px' }}>
                            {!k.revokedAt && (
                              <button
                                type="button"
                                onClick={() => void handleRevokeApiKey(k.id)}
                                style={{
                                  minHeight: '28px',
                                  minWidth: '64px',
                                  padding: '4px 10px',
                                  border: '1px solid var(--danger)',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: 'var(--danger-bg)',
                                  color: 'var(--danger)',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {section === 'governance' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h1 style={{ margin: 0, fontSize: '22px' }}>{t('governance.audit.title')}</h1>
                  <StatusChip label="Hash-Chained (SHA-256)" tone="info" />
                </div>

                {auditLoading && (
                  <StateView
                    state="loading"
                    title="Loading audit log"
                    description="Fetching tamper-evident audit records..."
                  />
                )}

                {!auditLoading && auditError && (
                  <StateView
                    state={auditError.code === 'AUTH_FORBIDDEN' ? 'forbidden' : 'error'}
                    title={
                      auditError.code === 'AUTH_FORBIDDEN'
                        ? 'Permission required'
                        : 'Failed to load audit log'
                    }
                    description={auditError.message}
                    errorCode={auditError.code}
                    requiredPermission={
                      auditError.code === 'AUTH_FORBIDDEN' ? 'audit:read' : undefined
                    }
                  />
                )}

                {!auditLoading && !auditError && auditEvents.length === 0 && (
                  <StateView
                    state="empty"
                    title="No audit events recorded"
                    description="Security and administrative events will appear here."
                  />
                )}

                {!auditLoading && !auditError && auditEvents.length > 0 && (
                  <table
                    aria-label="Audit events"
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '10px' }}>Seq</th>
                        <th style={{ padding: '10px' }}>Action</th>
                        <th style={{ padding: '10px' }}>Decision</th>
                        <th style={{ padding: '10px' }}>Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEvents.map((evt) => (
                        <tr key={evt.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px' }}>{evt.seq}</td>
                          <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                            {evt.action}
                          </td>
                          <td style={{ padding: '10px' }}>{evt.decision ?? '—'}</td>
                          <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                            {evt.hash.slice(0, 16)}…
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <GovernanceHardeningView
                  client={client}
                  workspaceId={activeWorkspace?.id}
                  environment={env}
                />
              </div>
            )}

            {section === 'knowledge' && (
              <KnowledgeMemoryView
                client={client}
                workspaceId={activeWorkspace?.id}
                projectId={projects[0]?.id}
                environment={env}
              />
            )}

            {section === 'workflows' && (
              <WorkflowCanvasView
                client={client}
                workspaceId={activeWorkspace?.id}
                projectId={projects[0]?.id}
                environment={env}
              />
            )}

            {section === 'agents' && (
              <AgentStudioView
                client={client}
                workspaceId={activeWorkspace?.id}
                projectId={projects[0]?.id}
                environment={env}
              />
            )}

            {section === 'runs' && (
              <RunsView
                runs={runs}
                dlqItems={dlqItems}
                loading={runsLoading}
                error={runsError ? { message: runsError.message, code: runsError.code } : null}
                selectedRun={selectedRun}
                selectedSteps={selectedSteps}
                selectedEvents={selectedEvents}
                selectedStepId={selectedStep?.id}
                onRefresh={() => void loadRuns()}
                onStartSampleRun={() => {
                  void (async () => {
                    const created = await client.runs.create(
                      {
                        workspaceId: activeWorkspace?.id,
                        environment: env,
                        subjectType: 'agent_version',
                        subjectVersionId: 'agv_demo',
                        executeInline: true,
                        simulatedSteps: [
                          { type: 'decision', summary: { note: 'Plan turn' }, cost_micro_usd: 120, latency_ms: 14 },
                          { type: 'tool_call', summary: { tool: 'http_get' }, cost_micro_usd: 40, latency_ms: 35 },
                        ],
                      },
                      `ui-run-${Date.now()}`,
                    );
                    await loadRuns();
                    await selectRun(created.id);
                  })();
                }}
                onSelectRun={(runId) => void selectRun(runId)}
                onSelectStep={(step) => {
                  setSelectedStep(step);
                  setRightDrawerOpen(true);
                }}
                onCancelRun={(runId) => {
                  void (async () => {
                    await client.runs.cancel(runId, 'Cancelled from console', `ui-cancel-${Date.now()}`);
                    await loadRuns();
                    if (selectedRun?.id === runId) {
                      await selectRun(runId);
                    }
                  })();
                }}
                onRedriveRun={(runId) => {
                  void (async () => {
                    await client.runs.bulkRedrive([runId], `ui-redrive-${Date.now()}`);
                    await loadRuns();
                  })();
                }}
                onSaveAsTestCase={() => {
                  setSection('evaluations');
                }}
              />
            )}

            {section === 'approvals' && (
              <ApprovalsView client={client} workspaceId={activeWorkspace?.id} />
            )}

            {section === 'evaluations' && (
              <EvaluationsView client={client} workspaceId={activeWorkspace?.id} />
            )}

            {section !== 'home' &&
              section !== 'settings' &&
              section !== 'governance' &&
              section !== 'runs' &&
              section !== 'agents' &&
              section !== 'workflows' &&
              section !== 'knowledge' &&
              section !== 'approvals' &&
              section !== 'evaluations' && (
              <div>
                <h1 style={{ margin: '0 0 16px 0', fontSize: '22px' }}>
                  {NAV_ITEMS.find((n) => n.id === section)?.label}
                </h1>
                <StateView
                  state="empty"
                  title={`${NAV_ITEMS.find((n) => n.id === section)?.label} arrives in slice ${NAV_ITEMS.find((n) => n.id === section)?.sliceHint ?? 'next'}`}
                  description="This area is scaffolded in the S0.1 console shell and will light up as its vertical slice is delivered."
                  actionLabel="Return to Home"
                  onAction={() => setSection('home')}
                />
              </div>
            )}
          </main>

          {bottomDrawerOpen && (
            <section
              aria-label="Bottom run console"
              style={{
                height: '160px',
                backgroundColor: 'var(--surface)',
                borderTop: '1px solid var(--border)',
                padding: '12px 16px',
              }}
            >
              <strong>Console Drawer</strong>
              <p style={{ margin: '6px 0 0 0', color: 'var(--text-secondary)' }}>
                Live logs and test output will stream here starting in Slice S0.2/S0.3.
              </p>
            </section>
          )}
        </div>

        {rightDrawerOpen && (
          <aside
            aria-label="Contextual inspector"
            style={{
              width: '280px',
              backgroundColor: 'var(--surface)',
              borderLeft: '1px solid var(--border)',
              padding: '16px',
            }}
          >
            <h2 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>Contextual Inspector</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              Workspace: <strong>{activeWorkspace?.name}</strong>
            </p>
            <p style={{ margin: '6px 0 0 0', color: 'var(--text-secondary)' }}>
              Environment: <strong>{env.toUpperCase()}</strong>
            </p>
            {selectedStep && (
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'grid', gap: '6px', fontSize: '12px' }}>
                <strong>Step #{selectedStep.seq} ({selectedStep.type})</strong>
                <div>Status: {selectedStep.status}</div>
                <div>Latency: {selectedStep.latencyMs}ms</div>
                <div>Tokens: {selectedStep.tokensIn} in / {selectedStep.tokensOut} out</div>
                <div style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  Idempotency: {selectedStep.idempotencyKey}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {paletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '10vh',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '480px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'grid',
              gap: '10px',
            }}
          >
            <label htmlFor="cmd-palette-input" style={{ fontWeight: 600 }}>
              Jump to section
            </label>
            <input
              id="cmd-palette-input"
              autoFocus
              type="text"
              placeholder="Type a page name..."
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              style={{
                minHeight: '36px',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
              }}
            />
            <div style={{ display: 'grid', gap: '4px' }}>
              {filteredNavForPalette.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    setPaletteOpen(false);
                    setPaletteQuery('');
                  }}
                  style={{
                    minHeight: '32px',
                    padding: '6px 10px',
                    textAlign: 'left',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  Go to {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(false)}
              style={{
                minHeight: '30px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Close (Esc)
            </button>
          </div>
        </div>
      )}

      {shortcutsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '400px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Keyboard Shortcuts</h2>
            <ul>
              <li><code>Ctrl/Cmd + K</code>: Command Palette</li>
              <li><code>?</code>: Toggle Shortcut Sheet</li>
              <li><code>Esc</code>: Close Dialog</li>
            </ul>
            <button
              type="button"
              onClick={() => setShortcutsOpen(false)}
              style={{
                minHeight: '32px',
                padding: '6px 12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
