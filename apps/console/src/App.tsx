import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  Bell,
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Database,
  FileCheck2,
  GitBranch,
  Home,
  KeyRound,
  Moon,
  Network,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Rocket,
  Search,
  Settings,
  Shield,
  Sun,
  Wrench,
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
import { ElshadLogo, EnvBadge, StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import { AgentStudioView } from './AgentStudioView.js';
import { ApprovalsView } from './ApprovalsView.js';
import { EvaluationsView } from './EvaluationsView.js';
import { GovernanceHardeningView } from './GovernanceHardeningView.js';
import { HomeOverviewView } from './HomeOverviewView.js';
import { KnowledgeMemoryView } from './KnowledgeMemoryView.js';
import { ObservabilityView } from './ObservabilityView.js';
import { PilotsView } from './PilotsView.js';
import { RunsView } from './RunsView.js';
import { TeamCanvasView } from './TeamCanvasView.js';
import { ToolsView } from './ToolsView.js';
import { WorkflowCanvasView } from './WorkflowCanvasView.js';
import { t } from './i18n.js';

export type NavSection =
  | 'home'
  | 'agents'
  | 'teams'
  | 'workflows'
  | 'tools'
  | 'knowledge'
  | 'runs'
  | 'approvals'
  | 'evaluations'
  | 'monitoring'
  | 'pilots'
  | 'governance'
  | 'settings';

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

interface NavItem {
  id: NavSection;
  label: string;
  icon: typeof Home;
  sliceHint?: string;
  hasSubmenu?: boolean;
  dividerBefore?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'agents', label: 'Agents', icon: Bot, sliceHint: 'S0.3' },
  { id: 'workflows', label: 'Workflows', icon: GitBranch, sliceHint: 'S0.4' },
  { id: 'tools', label: 'Tools & Connections', icon: Wrench, sliceHint: 'S0.3 / S1.5' },
  { id: 'knowledge', label: 'Knowledge & Memory', icon: Database, sliceHint: 'S0.5' },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare, sliceHint: 'S1.1' },
  { id: 'evaluations', label: 'Evaluations', icon: FileCheck2, sliceHint: 'S1.3' },
  { id: 'monitoring', label: 'Monitoring', icon: Activity, sliceHint: 'S1.8', hasSubmenu: true },
  { id: 'governance', label: 'Governance', icon: Shield, hasSubmenu: true },
  { id: 'teams', label: 'Team Canvas', icon: Network, sliceHint: 'S1.4', dividerBefore: true },
  { id: 'pilots', label: 'Pilot Agents', icon: Rocket, sliceHint: 'S1.9' },
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
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);
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
    const [prjRes, appRes] = await Promise.allSettled([
      client.projects.list(activeWorkspace.id),
      client.approvals.list(),
    ]);
    if (prjRes.status === 'fulfilled') setProjects(prjRes.value);
    else setProjects([]);

    if (appRes.status === 'fulfilled') {
      setPendingApprovalsCount(appRes.value.filter((a) => a.status === 'pending').length);
    }
  }, [activeWorkspace, client]);

  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    setApiKeysError(null);
    try {
      const rows = await client.apiKeys.list();
      setApiKeys(rows);
    } catch (err) {
      setApiKeysError(
        err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to load API keys'),
      );
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
      setAuditError(
        err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to load audit events'),
      );
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
      setApiKeysError(
        err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to create API key'),
      );
    }
  }

  async function handleRevokeApiKey(id: string): Promise<void> {
    try {
      await client.apiKeys.revoke(id);
      await loadApiKeys();
    } catch (err) {
      setApiKeysError(
        err instanceof PlatformError ? err : new PlatformError('SYS_INTERNAL', 'Failed to revoke key'),
      );
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
          background: 'linear-gradient(135deg, var(--lavender-soft) 0%, var(--bg) 60%)',
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
            boxShadow: 'var(--shadow-card)',
            padding: '28px',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <ElshadLogo size={32} />
          </div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 700 }}>{t('login.title')}</h1>
          <p style={{ margin: '0 0 20px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
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
                  minHeight: '38px',
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
                  minHeight: '38px',
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
                minHeight: '40px',
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
                minHeight: '40px',
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
  const initials = me.principal.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div
      data-theme={theme}
      data-environment={env}
      style={{
        minHeight: '100vh',
        display: 'flex',
        backgroundColor: 'var(--bg)',
        color: 'var(--text-primary)',
        borderTop: isProd ? '4px solid var(--env-prod)' : '4px solid transparent',
      }}
    >
      {/* Left Navigation Sidebar (elshad.ai Design Language) */}
      <aside
        style={{
          width: navCollapsed ? '68px' : '240px',
          backgroundColor: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '14px 12px',
          flexShrink: 0,
        }}
      >
        <div>
          {/* Brand Row + Collapse Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: navCollapsed ? 'center' : 'space-between',
              padding: '4px 6px 14px 6px',
            }}
          >
            <ElshadLogo collapsed={navCollapsed} size={28} />
            {!navCollapsed && (
              <button
                type="button"
                aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                onClick={() => setNavCollapsed((v) => !v)}
                style={{
                  minWidth: '28px',
                  minHeight: '28px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <PanelLeftClose size={15} />
              </button>
            )}
          </div>

          {navCollapsed && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
              <button
                type="button"
                aria-label="Expand navigation"
                onClick={() => setNavCollapsed(false)}
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
                <PanelLeftOpen size={15} />
              </button>
            </div>
          )}

          <nav aria-label="Primary" style={{ display: 'grid', gap: '3px' }}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <div key={item.id}>
                  {item.dividerBefore && (
                    <div
                      style={{
                        height: '1px',
                        backgroundColor: 'var(--border-subtle)',
                        margin: '8px 6px',
                      }}
                    />
                  )}
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSection(item.id)}
                    style={{
                      width: '100%',
                      minHeight: '36px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: navCollapsed ? 'center' : 'space-between',
                      gap: '10px',
                      padding: navCollapsed ? '6px' : '6px 10px',
                      borderRadius: 'var(--radius-md)',
                      border: active ? '1px solid var(--lavender-border)' : '1px solid transparent',
                      backgroundColor: active ? 'var(--lavender)' : 'transparent',
                      color: active ? 'var(--brand)' : 'var(--text-primary)',
                      fontWeight: active ? 600 : 500,
                      fontSize: '13.5px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                      {!navCollapsed && (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.label}
                        </span>
                      )}
                    </span>
                    {!navCollapsed && item.id === 'approvals' && (
                      <span
                        style={{
                          minWidth: '20px',
                          height: '20px',
                          padding: '0 6px',
                          borderRadius: '9999px',
                          backgroundColor: 'var(--brand)',
                          color: 'var(--brand-contrast)',
                          fontSize: '11px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {pendingApprovalsCount || 4}
                      </span>
                    )}
                    {!navCollapsed && item.hasSubmenu && (
                      <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                    )}
                  </button>
                </div>
              );
            })}
          </nav>
        </div>

        {/* Upgrade Promo Card (matches reference left rail footer) */}
        {!navCollapsed && (
          <div
            style={{
              marginTop: '16px',
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--lavender-soft)',
              border: '1px solid var(--lavender-border)',
              display: 'grid',
              gap: '8px',
            }}
          >
            <span
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                backgroundColor: 'var(--lavender)',
                color: 'var(--brand)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Rocket size={15} aria-hidden="true" />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                Upgrade to Pro
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Unlock advanced features and higher limits.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSection('settings')}
              style={{
                minHeight: '32px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: 'var(--brand-contrast)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              View Plans →
            </button>
          </div>
        )}
      </aside>

      {/* Right Column: Production Banner + Top Header + Workspace Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {isProd && (
          <div
            role="region"
            aria-label="Production safety notice"
            style={{
              backgroundColor: 'var(--danger-bg)',
              color: 'var(--danger)',
              padding: '6px 20px',
              fontSize: '13px',
              fontWeight: 600,
              borderBottom: '1px solid var(--danger)',
            }}
          >
            {t('env.prod.banner')}
          </div>
        )}

        {/* Top Bar */}
        <header
          style={{
            height: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            backgroundColor: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            gap: '14px',
          }}
        >
          {/* Left: Workspace Pill + Environment Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 10px',
                minHeight: '34px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
              }}
            >
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                {me.orgName} /
              </span>
              <label htmlFor="workspace-select" style={{ position: 'absolute', left: '-9999px' }}>
                Workspace
              </label>
              <select
                id="workspace-select"
                aria-label="Workspace"
                value={activeWorkspace?.slug ?? ''}
                onChange={(e) => setWorkspaceSlug(e.target.value)}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {me.workspaces.map((ws) => (
                  <option key={ws.id} value={ws.slug}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 8px',
                minHeight: '34px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '9999px',
                  backgroundColor:
                    env === 'prod'
                      ? 'var(--env-prod)'
                      : env === 'staging'
                        ? 'var(--env-staging)'
                        : 'var(--env-dev)',
                }}
              />
              <label htmlFor="env-select" style={{ position: 'absolute', left: '-9999px' }}>
                Environment
              </label>
              <select
                id="env-select"
                aria-label="Environment"
                value={env}
                onChange={(e) => setEnv(e.target.value as EnvironmentKind)}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <option value="dev">DEV</option>
                <option value="staging">STAGING</option>
                <option value="prod">PROD</option>
              </select>
              <EnvBadge env={env} />
            </div>
          </div>

          {/* Center: Global Search Pill */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            style={{
              flex: '0 1 360px',
              minHeight: '36px',
              padding: '6px 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-muted)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <Search size={14} aria-hidden="true" />
            <span>Search anything... (Ctrl+K)</span>
          </button>

          {/* Right: Drawers, Bell, Theme, Profile & Sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                backgroundColor: 'var(--surface)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <PanelRight size={15} aria-hidden="true" />
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
                backgroundColor: 'var(--surface)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <PanelBottom size={15} aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-label="Notifications"
              style={{
                position: 'relative',
                minWidth: '32px',
                minHeight: '32px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <Bell size={15} aria-hidden="true" />
              <span
                style={{
                  position: 'absolute',
                  top: '5px',
                  right: '6px',
                  width: '7px',
                  height: '7px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--danger)',
                }}
              />
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
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {theme === 'light' ? (
                <Sun size={14} aria-hidden="true" />
              ) : (
                <Moon size={14} aria-hidden="true" />
              )}
              <span>{theme}</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '4px' }}>
              <span
                aria-hidden="true"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--lavender)',
                  color: 'var(--brand)',
                  fontWeight: 700,
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {initials || 'AD'}
              </span>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: '12.5px', fontWeight: 600 }}>{me.principal.displayName}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Administrator</div>
              </div>
              <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            </div>

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
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <main style={{ flex: 1, padding: '24px 28px', overflow: 'auto' }}>
              {section === 'home' && (
                <HomeOverviewView
                  client={client}
                  workspaceId={activeWorkspace?.id}
                  env={env}
                  onNavigate={setSection}
                />
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
                  ownerName={me.principal.displayName}
                />
              )}

              {section === 'agents' && (
                <AgentStudioView
                  client={client}
                  workspaceId={activeWorkspace?.id}
                  projectId={projects[0]?.id}
                  environment={env}
                  ownerName={me.principal.displayName}
                />
              )}

              {section === 'teams' && (
                <TeamCanvasView
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
                  client={client}
                  environment={env}
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
                  onBulkCancel={(runIds) => {
                    void (async () => {
                      for (const id of runIds) {
                        await client.runs.cancel(id, 'Bulk cancelled from console', `ui-bcancel-${id}-${Date.now()}`).catch(() => {});
                      }
                      await loadRuns();
                    })();
                  }}
                  onBulkRedrive={(runIds) => {
                    void (async () => {
                      await client.runs.bulkRedrive(runIds, `ui-bredrive-${Date.now()}`).catch(() => {});
                      await loadRuns();
                    })();
                  }}
                  onReplayRun={(run) => {
                    void (async () => {
                      const created = await client.runs.create(
                        {
                          workspaceId: activeWorkspace?.id,
                          environment: env,
                          subjectType: run.subjectType as 'agent_version' | 'workflow_version',
                          subjectVersionId: run.subjectVersionId,
                          input: run.input,
                          executeInline: true,
                        },
                        `ui-replay-${run.id}-${Date.now()}`,
                      );
                      await loadRuns();
                      await selectRun(created.id);
                    })();
                  }}
                  onForkFromStep={(run, stepSeq) => {
                    void (async () => {
                      const created = await client.runs.create(
                        {
                          workspaceId: activeWorkspace?.id,
                          environment: env,
                          subjectType: run.subjectType as 'agent_version' | 'workflow_version',
                          subjectVersionId: run.subjectVersionId,
                          labels: { forked_from: run.id, fork_step: String(stepSeq) },
                          executeInline: true,
                        },
                        `ui-fork-${run.id}-${stepSeq}-${Date.now()}`,
                      );
                      await loadRuns();
                      await selectRun(created.id);
                    })();
                  }}
                  onSaveAsTestCase={() => {
                    setSection('evaluations');
                  }}
                />
              )}

              {section === 'approvals' && (
                <ApprovalsView
                  client={client}
                  workspaceId={activeWorkspace?.id}
                  currentPrincipalId={me.principal.id}
                />
              )}

              {section === 'evaluations' && (
                <EvaluationsView client={client} workspaceId={activeWorkspace?.id} />
              )}

              {section === 'monitoring' && (
                <ObservabilityView client={client} workspaceId={activeWorkspace?.id} />
              )}

              {section === 'pilots' && (
                <PilotsView client={client} workspaceId={activeWorkspace?.id} />
              )}

              {section === 'tools' && (
                <ToolsView
                  client={client}
                  workspaceId={activeWorkspace?.id}
                  environment={env}
                />
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
                  Live logs and execution console stream here during active agent and workflow runs.
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
                <div
                  style={{
                    marginTop: '16px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--border)',
                    display: 'grid',
                    gap: '6px',
                    fontSize: '12px',
                  }}
                >
                  <strong>
                    Step #{selectedStep.seq} ({selectedStep.type})
                  </strong>
                  <div>Status: {selectedStep.status}</div>
                  <div>Latency: {selectedStep.latencyMs}ms</div>
                  <div>
                    Tokens: {selectedStep.tokensIn} in / {selectedStep.tokensOut} out
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                    Idempotency: {selectedStep.idempotencyKey}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>

      {paletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(23, 23, 43, 0.45)',
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
            backgroundColor: 'rgba(23, 23, 43, 0.45)',
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
              <li>
                <code>Ctrl/Cmd + K</code>: Command Palette
              </li>
              <li>
                <code>?</code>: Toggle Shortcut Sheet
              </li>
              <li>
                <code>Esc</code>: Close Dialog
              </li>
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
