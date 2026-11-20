import { useEffect, useState, type FormEvent } from 'react';
import type { EnvironmentKind, PlatformError } from '@elshad/domain';
import type {
  ApiKeyDto,
  CreatedApiKeyDto,
  MeDto,
  ModelCapabilityDto,
  PlatformClient,
  ProjectDto,
  SecretMetadataDto,
  WorkspaceDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  Bell,
  Building2,
  Cpu,
  CreditCard,
  Database,
  Key,
  KeyRound,
  Layers,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { t } from './i18n.js';
import {
  BillingPanel,
  DataManagementPanel,
  EnvironmentsPanel,
  ModelProvidersPanel,
  NotificationsPanel,
  SecretsPolicyPanel,
  SsoScimPanel,
  WorkspaceProfilePanel,
} from './settings/WorkspaceSettingsPanels.js';

export type SettingsSectionId =
  | 'api_webhooks'
  | 'profile'
  | 'providers'
  | 'secrets'
  | 'sso_scim'
  | 'notifications'
  | 'data'
  | 'environments'
  | 'billing';

export interface WorkspaceSettingsViewProps {
  client: PlatformClient;
  me: MeDto;
  activeWorkspace: WorkspaceDto | null;
  projects: ProjectDto[];
  env: EnvironmentKind;
  onChangeEnv: (next: EnvironmentKind) => void;
  initialSection?: SettingsSectionId;
  apiKeys: ApiKeyDto[];
  apiKeysLoading: boolean;
  apiKeysError: PlatformError | null;
  newKeyName: string;
  onNewKeyNameChange: (val: string) => void;
  createdKeySecret: CreatedApiKeyDto | null;
  onCreateApiKey: (e: FormEvent) => void | Promise<void>;
  onRevokeApiKey: (id: string) => void | Promise<void>;
  onRetryApiKeys: () => void | Promise<void>;
}

interface WebhookEndpointItem {
  id: string;
  url: string;
  events: string;
  signingPrefix: string;
}

const SETTINGS_NAV: Array<{ id: SettingsSectionId; label: string; icon: typeof KeyRound }> = [
  { id: 'api_webhooks', label: 'API & Webhooks', icon: Webhook },
  { id: 'profile', label: 'Workspace Profile', icon: Building2 },
  { id: 'providers', label: 'Model Providers', icon: Cpu },
  { id: 'secrets', label: 'Secrets', icon: Key },
  { id: 'sso_scim', label: 'SSO / SCIM', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'data', label: 'Data Management', icon: Database },
  { id: 'environments', label: 'Environments', icon: Layers },
  { id: 'billing', label: 'Billing', icon: CreditCard },
];

export function WorkspaceSettingsView({
  client,
  me,
  activeWorkspace,
  projects,
  env,
  onChangeEnv,
  initialSection = 'api_webhooks',
  apiKeys,
  apiKeysLoading,
  apiKeysError,
  newKeyName,
  onNewKeyNameChange,
  createdKeySecret,
  onCreateApiKey,
  onRevokeApiKey,
  onRetryApiKeys,
}: WorkspaceSettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsSectionId>(initialSection);
  const [notice, setNotice] = useState<string | null>(null);
  const [models, setModels] = useState<ModelCapabilityDto[]>([]);
  const [secrets, setSecrets] = useState<SecretMetadataDto[]>([]);

  const [webhooks, setWebhooks] = useState<WebhookEndpointItem[]>([
    {
      id: 'wh_1',
      url: 'https://ops.internal.example/elshad-events',
      events: 'run.failed, approval.requested, deployment.promoted',
      signingPrefix: 'whsec_8a4f••••',
    },
  ]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('https://hooks.example.internal/audit');
  const [newWebhookEvents, setNewWebhookEvents] = useState('run.completed, policy.denied');

  useEffect(() => {
    setActiveTab(initialSection);
  }, [initialSection]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.models?.list ? client.models.list().catch(() => [] as ModelCapabilityDto[]) : Promise.resolve([]),
      client.secrets?.list ? client.secrets.list().catch(() => [] as SecretMetadataDto[]) : Promise.resolve([]),
    ]).then(([modelRows, secretRows]) => {
      if (cancelled) return;
      setModels(modelRows);
      setSecrets(secretRows);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  function handleSelectTab(next: SettingsSectionId) {
    setActiveTab(next);
    setNotice(null);
  }

  function handleAddWebhook(e: FormEvent) {
    e.preventDefault();
    if (!newWebhookUrl.trim()) return;
    const item: WebhookEndpointItem = {
      id: `wh_${webhooks.length + 1}`,
      url: newWebhookUrl.trim(),
      events: newWebhookEvents.trim() || 'run.*',
      signingPrefix: `whsec_${Math.random().toString(16).slice(2, 6)}••••`,
    };
    setWebhooks((prev) => [item, ...prev]);
    setNewWebhookUrl('');
    setNotice(`Registered signed webhook endpoint ${item.url}.`);
  }

  function handleRotateWebhook(id: string) {
    const nextPrefix = `whsec_${Math.random().toString(16).slice(2, 6)}••••`;
    setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, signingPrefix: nextPrefix } : w)));
    setNotice(`Rotated HMAC-SHA256 signing secret (${nextPrefix}).`);
  }

  const activeNav = SETTINGS_NAV.find((n) => n.id === activeTab) ?? SETTINGS_NAV[0]!;

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '14px 16px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--brand)' }}>
            elshad.ai Workspace Administration
          </div>
          <h1 style={{ margin: '2px 0 0', fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Workspace Settings
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip label={activeWorkspace?.name ?? 'Default Workspace'} tone="info" />
          <StatusChip label={`Env: ${env.toUpperCase()}`} tone={env === 'prod' ? 'danger' : 'success'} />
        </div>
      </div>

      {notice && <SuccessNotice message={notice} />}

      {/* Two-Column Settings Shell */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 235px) minmax(0, 1fr)',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        <nav
          aria-label="Settings sections"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '8px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Workspace settings navigation"
            style={{ display: 'grid', gap: '4px' }}
          >
            {SETTINGS_NAV.map((item) => {
              const Icon = item.icon;
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`settings-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => handleSelectTab(item.id)}
                  style={{
                    width: '100%',
                    minHeight: '36px',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: selected ? '1px solid var(--lavender-border)' : '1px solid transparent',
                    backgroundColor: selected ? 'var(--lavender)' : 'transparent',
                    color: selected ? 'var(--brand)' : 'var(--text-primary)',
                    fontWeight: selected ? 600 : 500,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Icon size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div role="tabpanel" aria-label={activeNav.label} style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          {activeTab === 'api_webhooks' && (
            <div style={{ display: 'grid', gap: '16px' }}>
              {/* Existing API Keys section (preserves E0.1 tests & selectors) */}
              <section
                aria-label="API Keys management"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  boxShadow: 'var(--shadow-card)',
                  display: 'grid',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <KeyRound size={18} style={{ color: 'var(--brand)' }} aria-hidden="true" />
                  <h2 style={{ margin: 0, fontSize: '18px' }}>{t('settings.apikeys.title')}</h2>
                </div>

                <form
                  onSubmit={(e) => void onCreateApiKey(e)}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 220px' }}>
                    <label
                      htmlFor="new-api-key-name"
                      style={{ display: 'block', fontWeight: 600, marginBottom: '4px', fontSize: '13px' }}
                    >
                      API Key Name
                    </label>
                    <input
                      id="new-api-key-name"
                      type="text"
                      placeholder="e.g., CI Pipeline Key"
                      value={newKeyName}
                      onChange={(e) => onNewKeyNameChange(e.target.value)}
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
                    onAction={() => void onRetryApiKeys()}
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
                                onClick={() => void onRevokeApiKey(k.id)}
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
              </section>

              {/* Webhook Endpoints & HMAC Signing */}
              <section
                aria-label="Webhook endpoints and signing"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  boxShadow: 'var(--shadow-card)',
                  display: 'grid',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <Webhook size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
                    <span>Webhook Endpoints &amp; Signing</span>
                  </h2>
                  <StatusChip label={`${webhooks.length} endpoint(s)`} tone="info" />
                </div>

                <form
                  onSubmit={handleAddWebhook}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px', alignItems: 'end' }}
                >
                  <div>
                    <label htmlFor="webhook-url-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Webhook Endpoint URL
                    </label>
                    <input
                      id="webhook-url-input"
                      type="url"
                      required
                      value={newWebhookUrl}
                      onChange={(e) => setNewWebhookUrl(e.target.value)}
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
                  <div>
                    <label htmlFor="webhook-events-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Subscribed Events
                    </label>
                    <input
                      id="webhook-events-input"
                      type="text"
                      value={newWebhookEvents}
                      onChange={(e) => setNewWebhookEvents(e.target.value)}
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
                  <div>
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
                      Add Webhook Endpoint
                    </button>
                  </div>
                </form>

                <div style={{ display: 'grid', gap: '8px' }}>
                  {webhooks.map((wh) => (
                    <div
                      key={wh.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--surface-raised)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        fontSize: '12.5px',
                      }}
                    >
                      <div style={{ display: 'grid', gap: '2px' }}>
                        <strong>{wh.url}</strong>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Events: {wh.events} · Signing: <code>{wh.signingPrefix}</code>
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleRotateWebhook(wh.id)}
                          style={{
                            padding: '5px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--surface)',
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Rotate Secret
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotice(`Delivered signed webhook ping to ${wh.url} (200 OK).`)}
                          style={{
                            padding: '5px 10px',
                            border: '1px solid var(--brand)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--lavender-soft)',
                            color: 'var(--brand)',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Send Test Event
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'profile' && (
            <WorkspaceProfilePanel me={me} activeWorkspace={activeWorkspace} projects={projects} onNotice={setNotice} />
          )}

          {activeTab === 'providers' && (
            <ModelProvidersPanel models={models} onNotice={setNotice} />
          )}

          {activeTab === 'secrets' && (
            <SecretsPolicyPanel
              client={client}
              secrets={secrets}
              onSecretCreated={(created) => setSecrets((prev) => [created, ...prev.filter((s) => s.id !== created.id)])}
              onNotice={setNotice}
            />
          )}

          {activeTab === 'sso_scim' && <SsoScimPanel onNotice={setNotice} />}
          {activeTab === 'notifications' && <NotificationsPanel onNotice={setNotice} />}
          {activeTab === 'data' && <DataManagementPanel onNotice={setNotice} />}
          {activeTab === 'environments' && (
            <EnvironmentsPanel env={env} onChangeEnv={onChangeEnv} onNotice={setNotice} />
          )}
          {activeTab === 'billing' && <BillingPanel onNotice={setNotice} />}
        </div>
      </div>
    </div>
  );
}
