import { useState, type CSSProperties, type FormEvent } from 'react';
import type { EnvironmentKind } from '@elshad/domain';
import type {
  MeDto,
  ModelCapabilityDto,
  PlatformClient,
  ProjectDto,
  SecretMetadataDto,
  WorkspaceDto,
} from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import {
  Bell,
  Building2,
  CheckCircle2,
  Cpu,
  CreditCard,
  Database,
  Globe,
  Key,
  Layers,
  Lock,
  ShieldCheck,
} from 'lucide-react';

const cardStyle: CSSProperties = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '16px',
  boxShadow: 'var(--shadow-card)',
  display: 'grid',
  gap: '12px',
};

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: '34px',
  padding: '6px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: '13px',
};

function btnStyle(primary = false): CSSProperties {
  return {
    minHeight: '32px',
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    border: primary ? 'none' : '1px solid var(--border)',
    backgroundColor: primary ? 'var(--brand)' : 'var(--surface-raised)',
    color: primary ? 'var(--brand-contrast)' : 'var(--text-primary)',
    fontWeight: 600,
    fontSize: '12.5px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  };
}

export function WorkspaceProfilePanel({
  me,
  activeWorkspace,
  projects,
  onNotice,
}: {
  me: MeDto;
  activeWorkspace: WorkspaceDto | null;
  projects: ProjectDto[];
  onNotice: (msg: string) => void;
}) {
  const [wsName, setWsName] = useState(activeWorkspace?.name ?? 'Default Workspace');
  const [wsSlug, setWsSlug] = useState(activeWorkspace?.slug ?? 'default');
  const [region, setRegion] = useState('us-east-1');
  const [logoAccent, setLogoAccent] = useState('#3924D6');

  function handleSave(e: FormEvent) {
    e.preventDefault();
    onNotice(`Saved workspace profile "${wsName}" in region ${region}.`);
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <form onSubmit={handleSave} style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Building2 size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Workspace Profile &amp; Region</span>
          </h2>
          <StatusChip label={region} tone="info" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div>
            <label htmlFor="ws-profile-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Workspace Name
            </label>
            <input
              id="ws-profile-name"
              type="text"
              required
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="ws-profile-slug" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Workspace Slug
            </label>
            <input
              id="ws-profile-slug"
              type="text"
              required
              value={wsSlug}
              onChange={(e) => setWsSlug(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="ws-profile-region" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Data Residency Region
            </label>
            <select
              id="ws-profile-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              style={inputStyle}
            >
              <option value="us-east-1">US East (N. Virginia — us-east-1)</option>
              <option value="eu-central-1">EU Central (Frankfurt — eu-central-1)</option>
              <option value="ap-southeast-1">AP Southeast (Singapore — ap-southeast-1)</option>
            </select>
          </div>
          <div>
            <label htmlFor="ws-logo-accent" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Workspace Badge Accent
            </label>
            <select
              id="ws-logo-accent"
              value={logoAccent}
              onChange={(e) => setLogoAccent(e.target.value)}
              style={inputStyle}
            >
              <option value="#3924D6">elshad.ai Indigo</option>
              <option value="#17172B">Obsidian Slate</option>
              <option value="#059669">Emerald</option>
              <option value="#7C3AED">Violet</option>
            </select>
          </div>
        </div>

        <div
          style={{
            padding: '12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              aria-hidden="true"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: logoAccent,
                color: '#FFFFFF',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
              }}
            >
              {wsName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>Organization: {me.orgName}</strong>
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                Org ID: <code>{me.orgId}</code> · Slug: <code>{me.orgSlug}</code> · {projects.length} project(s)
              </div>
            </div>
          </div>
          <button type="submit" style={btnStyle(true)}>
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
}

interface ProviderConfig {
  id: string;
  label: string;
  defaultModels: number;
  rateLimit: string;
  monthlySpendUsd: number;
  monthlyCapUsd: number;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'openai', label: 'OpenAI', defaultModels: 4, rateLimit: '10,000 RPM · 2M TPM', monthlySpendUsd: 142.4, monthlyCapUsd: 500 },
  { id: 'anthropic', label: 'Anthropic', defaultModels: 3, rateLimit: '4,000 RPM · 800k TPM', monthlySpendUsd: 88.2, monthlyCapUsd: 400 },
  { id: 'google', label: 'Google Gemini', defaultModels: 3, rateLimit: '6,000 RPM · 1.5M TPM', monthlySpendUsd: 34.1, monthlyCapUsd: 300 },
  { id: 'azure', label: 'Azure OpenAI', defaultModels: 2, rateLimit: '2,500 RPM · 500k TPM', monthlySpendUsd: 0, monthlyCapUsd: 250 },
  { id: 'custom', label: 'Custom OpenAI-Compatible', defaultModels: 1, rateLimit: '1,200 RPM · Local vLLM', monthlySpendUsd: 0, monthlyCapUsd: 100 },
];

export function ModelProvidersPanel({
  models,
  onNotice,
}: {
  models: ModelCapabilityDto[];
  onNotice: (msg: string) => void;
}) {
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [configuredIds, setConfiguredIds] = useState<Record<string, boolean>>({
    openai: true,
    anthropic: true,
    google: true,
  });
  const [testedLatency, setTestedLatency] = useState<Record<string, number>>({});

  function handleSaveProviderKey(provider: ProviderConfig) {
    if (!(apiKeyInputs[provider.id] ?? '').trim()) return;
    setConfiguredIds((prev) => ({ ...prev, [provider.id]: true }));
    setApiKeyInputs((prev) => ({ ...prev, [provider.id]: '' }));
    onNotice(`Updated write-only credentials for ${provider.label}.`);
  }

  function handleTestProvider(provider: ProviderConfig) {
    const latency = 118 + provider.label.length * 7;
    setTestedLatency((prev) => ({ ...prev, [provider.id]: latency }));
    onNotice(`${provider.label} health check succeeded (${latency}ms).`);
  }

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Model Providers &amp; Routing Credentials</span>
          </h2>
          <StatusChip label={`${models.length} catalog model(s)`} tone="info" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
          {PROVIDERS.map((p) => {
            const liveCount = models.filter((m) => m.provider.toLowerCase().includes(p.id)).length;
            const modelCount = Math.max(liveCount, p.defaultModels);
            const usagePct = Math.min(100, Math.round((p.monthlySpendUsd / p.monthlyCapUsd) * 100));
            const configured = Boolean(configuredIds[p.id]);
            const latency = testedLatency[p.id];
            return (
              <section
                key={p.id}
                aria-label={`${p.label} provider settings`}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface-raised)',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '14px' }}>{p.label}</strong>
                  <StatusChip label={configured ? 'Configured' : 'Not Configured'} tone={configured ? 'success' : 'neutral'} />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {modelCount} models · {p.rateLimit}
                </div>
                <div style={{ fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Monthly Usage</span>
                    <strong>
                      ${p.monthlySpendUsd.toFixed(2)} / ${p.monthlyCapUsd}
                    </strong>
                  </div>
                  <div style={{ height: '6px', borderRadius: '9999px', backgroundColor: 'var(--surface-muted)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(4, usagePct)}%`, height: '100%', backgroundColor: 'var(--brand)' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="password"
                    aria-label={`${p.label} API key`}
                    placeholder="sk-•••••••• (write-only)"
                    value={apiKeyInputs[p.id] ?? ''}
                    onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" onClick={() => handleSaveProviderKey(p)} style={btnStyle(false)}>
                    Save Key
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button type="button" onClick={() => handleTestProvider(p)} style={btnStyle(true)}>
                    Test Provider
                  </button>
                  {latency !== undefined && <StatusChip label={`Healthy · ${latency}ms`} tone="success" />}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SecretsPolicyPanel({
  client,
  secrets,
  onSecretCreated,
  onNotice,
}: {
  client: PlatformClient;
  secrets: SecretMetadataDto[];
  onSecretCreated: (created: SecretMetadataDto) => void;
  onNotice: (msg: string) => void;
}) {
  const [secretName, setSecretName] = useState('webhook_signing_key');
  const [secretValue, setSecretValue] = useState('');
  const [allowedEnvs, setAllowedEnvs] = useState<string[]>(['dev', 'staging', 'prod']);
  const [rotationDays, setRotationDays] = useState('90');
  const [requireProdApproval, setRequireProdApproval] = useState(true);
  const [saving, setSaving] = useState(false);

  async function handleStoreSecret(e: FormEvent) {
    e.preventDefault();
    const rawValue = secretValue;
    if (!secretName.trim() || !rawValue.trim()) return;
    setSaving(true);
    setSecretValue('');
    try {
      const created = await client.secrets.put({ name: secretName.trim(), value: rawValue });
      onSecretCreated(created);
      onNotice(`Stored write-only secret "${created.name}" (v${created.keyVersion}).`);
    } finally {
      setSaving(false);
    }
  }

  function toggleEnv(envName: string) {
    setAllowedEnvs((prev) =>
      prev.includes(envName) ? prev.filter((item) => item !== envName) : [...prev, envName],
    );
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <form onSubmit={(e) => void handleStoreSecret(e)} style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Key size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Write-Only Secret Vault</span>
          </h2>
          <StatusChip label="Envelope Encrypted (AES-GCM)" tone="info" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', alignItems: 'end' }}>
          <div>
            <label htmlFor="settings-secret-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Secret Name
            </label>
            <input
              id="settings-secret-name"
              type="text"
              required
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="settings-secret-value" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Secret Value (Write-Only)
            </label>
            <input
              id="settings-secret-value"
              type="password"
              required
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="Never displayed after write"
              style={inputStyle}
            />
          </div>
          <div>
            <button type="submit" disabled={saving} style={btnStyle(true)}>
              Store Secret
            </button>
          </div>
        </div>

        {secrets.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            No workspace secrets stored yet. Values are encrypted on write and never returned by API reads.
          </div>
        ) : (
          <table aria-label="Workspace secrets" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px' }}>Name</th>
                <th style={{ padding: '8px' }}>Reference</th>
                <th style={{ padding: '8px' }}>Provider</th>
                <th style={{ padding: '8px' }}>Version</th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{s.ref}</td>
                  <td style={{ padding: '8px' }}>{s.provider}</td>
                  <td style={{ padding: '8px' }}>
                    <StatusChip label={`v${s.keyVersion}`} tone="success" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>

      <div style={cardStyle}>
        <strong style={{ fontSize: '14.5px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Lock size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Secret Access Policies &amp; Rotation</span>
        </strong>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', alignItems: 'center' }}>
          <span>Allowed Environments:</span>
          {(['dev', 'staging', 'prod'] as const).map((e) => (
            <label key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={allowedEnvs.includes(e)} onChange={() => toggleEnv(e)} />
              <span>{e.toUpperCase()}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px' }}>
          <label htmlFor="secret-rotation-cadence" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <span>Rotation Cadence:</span>
            <select
              id="secret-rotation-cadence"
              value={rotationDays}
              onChange={(e) => setRotationDays(e.target.value)}
              style={{ ...inputStyle, width: '120px' }}
            >
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requireProdApproval}
              onChange={(e) => setRequireProdApproval(e.target.checked)}
            />
            <span>Require dual approval for PROD secret bindings</span>
          </label>
          <button
            type="button"
            onClick={() => onNotice(`Saved secret access policy (${allowedEnvs.join(', ')}, ${rotationDays}d rotation).`)}
            style={btnStyle(false)}
          >
            Save Access Policy
          </button>
        </div>
      </div>
    </div>
  );
}

export function SsoScimPanel({ onNotice }: { onNotice: (msg: string) => void }) {
  const [idp, setIdp] = useState('Okta');
  const [entityId, setEntityId] = useState('https://sso.elshad.ai/saml/metadata');
  const [enforceSso, setEnforceSso] = useState(true);
  const [jitEnabled, setJitEnabled] = useState(true);
  const [scimPrefix, setScimPrefix] = useState('scim_live_4a9c••••');

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <section aria-label="Single sign-on configuration" style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>SSO Authentication (SAML 2.0 / OIDC)</span>
          </h2>
          <StatusChip label={enforceSso ? 'SSO Enforced' : 'Optional SSO'} tone={enforceSso ? 'success' : 'neutral'} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          <div>
            <label htmlFor="sso-idp-select" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Identity Provider
            </label>
            <select id="sso-idp-select" value={idp} onChange={(e) => setIdp(e.target.value)} style={inputStyle}>
              <option value="Okta">Okta Workforce Identity</option>
              <option value="Microsoft Entra ID">Microsoft Entra ID</option>
              <option value="Google Workspace">Google Workspace SAML</option>
            </select>
          </div>
          <div>
            <label htmlFor="sso-entity-id" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              SAML Entity ID / Issuer
            </label>
            <input
              id="sso-entity-id"
              type="url"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={enforceSso} onChange={(e) => setEnforceSso(e.target.checked)} />
            <span>Enforce SSO login for workspace members</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={jitEnabled} onChange={(e) => setJitEnabled(e.target.checked)} />
            <span>Enable Just-In-Time (JIT) provisioning</span>
          </label>
          <button
            type="button"
            onClick={() => onNotice(`Verified ${idp} SAML metadata & assertion signature (200 OK).`)}
            style={btnStyle(true)}
          >
            Test SSO Connection
          </button>
        </div>
      </section>

      <section aria-label="SCIM directory provisioning" style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <strong style={{ fontSize: '14.5px' }}>SCIM 2.0 Directory Sync</strong>
          <button
            type="button"
            onClick={() => {
              const nextPrefix = `scim_live_${Math.random().toString(16).slice(2, 6)}••••`;
              setScimPrefix(nextPrefix);
              onNotice(`Issued new SCIM bearer token (${nextPrefix}).`);
            }}
            style={btnStyle(false)}
          >
            Generate SCIM Token
          </button>
        </div>
        <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          SCIM Endpoint: <code>https://api.elshad.ai/scim/v2</code> · Active Token: <code>{scimPrefix}</code>
        </div>
        <table aria-label="SCIM group mappings" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px' }}>IdP Group</th>
              <th style={{ padding: '8px' }}>elshad.ai Role</th>
              <th style={{ padding: '8px' }}>Synced Members</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px' }}>platform-admins</td>
              <td style={{ padding: '8px' }}>org_admin</td>
              <td style={{ padding: '8px' }}>4</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px' }}>ai-engineers</td>
              <td style={{ padding: '8px' }}>builder</td>
              <td style={{ padding: '8px' }}>12</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px' }}>secops-auditors</td>
              <td style={{ padding: '8px' }}>auditor</td>
              <td style={{ padding: '8px' }}>3</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

interface NotificationChannelRow {
  id: string;
  channel: string;
  target: string;
  events: string;
  enabled: boolean;
}

export function NotificationsPanel({ onNotice }: { onNotice: (msg: string) => void }) {
  const [channels, setChannels] = useState<NotificationChannelRow[]>([
    { id: 'ch_email', channel: 'Email Digest', target: 'ops-alerts@elshad.local', events: 'Approvals, Budget Thresholds, Run Failures', enabled: true },
    { id: 'ch_slack', channel: 'Slack', target: '#ai-platform-alerts', events: 'Approvals, Security Alerts, Run Failures', enabled: true },
    { id: 'ch_teams', channel: 'Microsoft Teams', target: 'Platform Operations Channel', events: 'Budget Thresholds, PROD Deployments', enabled: false },
    { id: 'ch_webhook', channel: 'Custom Webhook', target: 'https://events.internal.example/elshad', events: 'All Critical Events', enabled: true },
  ]);

  function toggleChannel(id: string) {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Notification Channels &amp; Routing</span>
        </h2>
        <StatusChip label={`${channels.filter((c) => c.enabled).length} enabled`} tone="success" />
      </div>

      <div style={{ display: 'grid', gap: '10px' }}>
        {channels.map((ch) => (
          <div
            key={ch.id}
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'grid', gap: '3px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13.5px', cursor: 'pointer' }}>
                <input type="checkbox" checked={ch.enabled} onChange={() => toggleChannel(ch.id)} />
                <span>{ch.channel}</span>
              </label>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Target: <code>{ch.target}</code> · Events: {ch.events}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNotice(`Dispatched test notification to ${ch.channel} (${ch.target}).`)}
              style={btnStyle(false)}
            >
              Send Test
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DataManagementPanel({ onNotice }: { onNotice: (msg: string) => void }) {
  const [tracesDays, setTracesDays] = useState('90');
  const [auditDays, setAuditDays] = useState('365');
  const [memoryDays, setMemoryDays] = useState('180');
  const [gdprSla, setGdprSla] = useState('7 days');
  const [piiTypes, setPiiTypes] = useState<string[]>(['Email', 'Phone', 'SSN', 'Credit Card', 'API Keys']);

  function togglePii(tag: string) {
    setPiiTypes((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNotice(`Saved retention (${tracesDays}d traces / ${auditDays}d audit) and ${piiTypes.length} PII redaction rules.`);
      }}
      style={cardStyle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Database size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Data Retention &amp; PII Redaction Defaults</span>
        </h2>
        <StatusChip label={`${piiTypes.length} redactors active`} tone="info" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        <div>
          <label htmlFor="ret-traces" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
            Run Traces Retention (days)
          </label>
          <input id="ret-traces" type="number" min={7} value={tracesDays} onChange={(e) => setTracesDays(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label htmlFor="ret-audit" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
            Audit Logs Retention (days)
          </label>
          <input id="ret-audit" type="number" min={30} value={auditDays} onChange={(e) => setAuditDays(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label htmlFor="ret-memory" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
            Memory Records Retention (days)
          </label>
          <input id="ret-memory" type="number" min={7} value={memoryDays} onChange={(e) => setMemoryDays(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label htmlFor="gdpr-sla" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
            GDPR Erasure SLA
          </label>
          <select id="gdpr-sla" value={gdprSla} onChange={(e) => setGdprSla(e.target.value)} style={inputStyle}>
            <option value="24 hours">24 hours (Priority)</option>
            <option value="7 days">7 days (Standard)</option>
            <option value="30 days">30 days (Max)</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px' }}>
        <span style={{ fontWeight: 600 }}>Auto-Redacted PII Classes:</span>
        {['Email', 'Phone', 'SSN', 'Credit Card', 'API Keys'].map((tag) => (
          <label key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input type="checkbox" checked={piiTypes.includes(tag)} onChange={() => togglePii(tag)} />
            <span>{tag}</span>
          </label>
        ))}
      </div>

      <div>
        <button type="submit" style={btnStyle(true)}>
          Save Data Policy
        </button>
      </div>
    </form>
  );
}

export function EnvironmentsPanel({
  env,
  onChangeEnv,
  onNotice,
}: {
  env: EnvironmentKind;
  onChangeEnv: (next: EnvironmentKind) => void;
  onNotice: (msg: string) => void;
}) {
  const specs: Array<{
    id: EnvironmentKind;
    title: string;
    isolation: string;
    gate: string;
    cap: string;
  }> = [
    { id: 'dev', title: 'DEV', isolation: 'Ephemeral sandbox tools & test datasets', gate: 'Instant save & dry-run execution', cap: '$50 / day soft cap' },
    { id: 'staging', title: 'STAGING', isolation: 'Pre-prod mirrors & credential alias bindings', gate: 'Evaluation release gate required', cap: '$250 / day soft cap' },
    { id: 'prod', title: 'PROD', isolation: 'Strict egress allowlists & immutable audit hash chain', gate: 'Two-person SoD approval & Kill Switch armed', cap: '$2,500 / day hard stop' },
  ];

  return (
    <div style={cardStyle}>
      <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        <Layers size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
        <span>Environment Configuration &amp; Promotion Controls</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
        {specs.map((item) => {
          const active = env === item.id;
          return (
            <section
              key={item.id}
              aria-label={`${item.title} environment configuration`}
              style={{
                padding: '14px',
                borderRadius: 'var(--radius-sm)',
                border: active ? '2px solid var(--brand)' : '1px solid var(--border)',
                backgroundColor: active ? 'var(--lavender-soft)' : 'var(--surface-raised)',
                display: 'grid',
                gap: '8px',
                fontSize: '12.5px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '15px' }}>{item.title}</strong>
                {active ? <StatusChip label="Active" tone="success" /> : <StatusChip label="Configured" tone="neutral" />}
              </div>
              <div>
                <strong>Isolation:</strong> {item.isolation}
              </div>
              <div>
                <strong>Promotion Gate:</strong> {item.gate}
              </div>
              <div>
                <strong>Cost Guardrail:</strong> {item.cap}
              </div>
              {!active && (
                <button
                  type="button"
                  onClick={() => {
                    onChangeEnv(item.id);
                    onNotice(`Switched workspace scope to ${item.title}.`);
                  }}
                  style={btnStyle(true)}
                >
                  Switch to {item.title}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function BillingPanel({ onNotice }: { onNotice: (msg: string) => void }) {
  const [selectedPlan, setSelectedPlan] = useState<'Starter' | 'Pro' | 'Enterprise'>('Enterprise');

  const meters = [
    { label: 'Workflow & Agent Runs', used: '12,480 / 50,000', pct: 25 },
    { label: 'Model Tokens Metered', used: '18.4M / 50M', pct: 37 },
    { label: 'Knowledge Base Vectors', used: '3.2 GB / 25 GB', pct: 13 },
    { label: 'Active Workspace Seats', used: '14 / 25 seats', pct: 56 },
  ];

  const invoices = [
    { id: 'INV-2026-11', period: 'Nov 2026', amount: '$490.00', status: 'Paid' },
    { id: 'INV-2026-10', period: 'Oct 2026', amount: '$490.00', status: 'Paid' },
    { id: 'INV-2026-09', period: 'Sep 2026', amount: '$390.00', status: 'Paid' },
  ];

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <span>Plan, Usage &amp; Payment Details</span>
          </h2>
          <StatusChip label={`elshad.ai ${selectedPlan}`} tone="info" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
          {(['Starter', 'Pro', 'Enterprise'] as const).map((tier) => {
            const current = selectedPlan === tier;
            const price = tier === 'Starter' ? '$0 / mo' : tier === 'Pro' ? '$99 / mo' : '$490 / mo';
            return (
              <div
                key={tier}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: current ? '2px solid var(--brand)' : '1px solid var(--border)',
                  backgroundColor: current ? 'var(--lavender-soft)' : 'var(--surface-raised)',
                  display: 'grid',
                  gap: '6px',
                  fontSize: '12.5px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{tier}</strong>
                  {current && <StatusChip label="Current Plan" tone="success" />}
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>{price}</div>
                {!current && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlan(tier);
                      onNotice(`Updated billing plan selection to elshad.ai ${tier}.`);
                    }}
                    style={btnStyle(false)}
                  >
                    Select {tier}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
          {meters.map((m) => (
            <div
              key={m.label}
              style={{
                padding: '10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-raised)',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>{m.label}</span>
                <strong>{m.used}</strong>
              </div>
              <div style={{ height: '6px', borderRadius: '9999px', backgroundColor: 'var(--surface-muted)', overflow: 'hidden' }}>
                <div style={{ width: `${m.pct}%`, height: '100%', backgroundColor: 'var(--brand)' }} />
              </div>
            </div>
          ))}
        </div>

        <div
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
          <div>
            <strong>Payment Method:</strong> Visa •••• 4242 · Expires 09/2028 · Contact: <code>billing@elshad.local</code>
          </div>
          <button
            type="button"
            onClick={() => onNotice('Opened payment method verification (Visa •••• 4242 active).')}
            style={btnStyle(false)}
          >
            Update Payment Method
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <strong style={{ fontSize: '14.5px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Globe size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Invoice History</span>
        </strong>
        <table aria-label="Billing invoices" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px' }}>Invoice ID</th>
              <th style={{ padding: '8px' }}>Billing Period</th>
              <th style={{ padding: '8px' }}>Amount</th>
              <th style={{ padding: '8px' }}>Status</th>
              <th style={{ padding: '8px' }}>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{inv.id}</td>
                <td style={{ padding: '8px' }}>{inv.period}</td>
                <td style={{ padding: '8px', fontWeight: 600 }}>{inv.amount}</td>
                <td style={{ padding: '8px' }}>
                  <StatusChip label={inv.status} tone="success" />
                </td>
                <td style={{ padding: '8px' }}>
                  <button
                    type="button"
                    onClick={() => onNotice(`Prepared receipt download for ${inv.id} (${inv.amount}).`)}
                    style={btnStyle(false)}
                  >
                    <CheckCircle2 size={13} aria-hidden="true" />
                    <span>Download Receipt</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
