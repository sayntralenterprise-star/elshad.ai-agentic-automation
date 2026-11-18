import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { type EnvironmentKind } from '@elshad/domain';
import {
  type DeploymentDto,
  type PlatformClient,
  type PromotionDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  ArrowRight,
  CheckCircle2,
  GitCompare,
  RefreshCw,
  Rocket,
  RotateCcw,
  XCircle,
} from 'lucide-react';

export interface DeploymentsViewProps {
  client: PlatformClient;
  subjectType: 'agent' | 'workflow';
  subjectId: string;
  defaultVersionId?: string;
}

export function DeploymentsView({
  client,
  subjectType,
  subjectId,
  defaultVersionId = 'agv_1',
}: DeploymentsViewProps) {
  const [deployments, setDeployments] = useState<DeploymentDto[]>([]);
  const [promotions, setPromotions] = useState<PromotionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Promotion form state
  const [versionId, setVersionId] = useState(defaultVersionId);
  const [fromEnv, setFromEnv] = useState<EnvironmentKind>('staging');
  const [toEnv, setToEnv] = useState<EnvironmentKind>('prod');
  const [requiredCredsText, setRequiredCredsText] = useState('slack_bot_token');
  const [mappedCredsText, setMappedCredsText] = useState('slack_bot_token=conn_prod_slack');
  const [canaryPct, setCanaryPct] = useState(100);
  const [evalGatePassed, setEvalGatePassed] = useState(true);
  const [promoting, setPromoting] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [deps, promos] = await Promise.all([
        client.deployments.list().catch(() => [] as DeploymentDto[]),
        client.promotions.list().catch(() => [] as PromotionDto[]),
      ]);
      setDeployments(deps);
      setPromotions(promos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handlePromote = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setPromoting(true);
      setError(null);
      setNotice(null);

      const requiredCredentials = requiredCredsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const credentialMapping: Record<string, string> = {};
      for (const pair of mappedCredsText.split(',')) {
        const [k, v] = pair.split('=').map((x) => x.trim());
        if (k && v) {
          credentialMapping[k] = v;
        }
      }

      const res = await client.promotions.create({
        subjectType,
        subjectId,
        versionId,
        versionPublished: true,
        fromEnv,
        toEnv,
        requiredCredentials,
        credentialMapping,
        evalGatePassed,
        canaryPct,
      });
      await loadAll();
      setNotice(
        res.promotion.status === 'pending_approval'
          ? `Promotion ${res.promotion.id} queued for Separation-of-Duties approval in ${toEnv}.`
          : `Promoted ${versionId} to ${toEnv} (${canaryPct}% traffic).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromoting(false);
    }
  };

  const handleApprove = async (promoId: string) => {
    try {
      setError(null);
      const res = await client.promotions.approve(promoId);
      await loadAll();
      setNotice(
        `Approved promotion ${res.promotion.id}. Deployed ${res.deployment?.versionId ?? ''} to ${res.promotion.toEnv}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReject = async (promoId: string) => {
    try {
      setError(null);
      const res = await client.promotions.reject(promoId);
      await loadAll();
      setNotice(`Rejected promotion ${res.id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRollback = async (deploymentId: string) => {
    try {
      setError(null);
      const res = await client.deployments.rollback(deploymentId);
      await loadAll();
      setNotice(`Rolled back ${res.environment} deployment to version ${res.versionId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Rocket size={18} aria-hidden="true" style={{ color: 'var(--brand)' }} />
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            Environments, Promotions &amp; Rollback (§7.3.3)
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          aria-label="Refresh deployments"
          style={{
            minHeight: '32px',
            padding: '4px 10px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {notice && <SuccessNotice message={notice} />}

      {error && (
        <StateView
          state="error"
          title="Promotion Blocked"
          description={error}
          actionLabel="Dismiss"
          onAction={() => setError(null)}
        />
      )}

      {/* Live Environment Deployments */}
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Live Environment Deployments</h3>
        {loading && deployments.length === 0 ? (
          <StateView state="loading" title="Loading deployments" description="Fetching environment state..." />
        ) : deployments.length === 0 ? (
          <StateView
            state="empty"
            title="No active deployments"
            description="Promote a published version below to deploy into dev, staging, or prod."
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            {deployments.map((d) => (
              <div
                key={d.id}
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <StatusChip
                    label={d.environment.toUpperCase()}
                    tone={d.environment === 'prod' ? 'danger' : d.environment === 'staging' ? 'warning' : 'info'}
                  />
                  <StatusChip
                    label={`${d.status} (${d.trafficPct}%)`}
                    tone={d.status === 'active' ? 'success' : d.status === 'canary' ? 'warning' : 'neutral'}
                  />
                </div>
                <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  Live: {d.versionId}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Previous: {d.previousVersionId ?? 'none'}
                </div>
                {d.previousVersionId && (
                  <button
                    type="button"
                    onClick={() => void handleRollback(d.id)}
                    style={{
                      minHeight: '30px',
                      padding: '4px 10px',
                      border: '1px solid var(--danger)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--danger-bg)',
                      color: 'var(--danger)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    Rollback to {d.previousVersionId}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote Version Form */}
      <form
        onSubmit={(e) => void handlePromote(e)}
        style={{
          padding: '16px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          display: 'grid',
          gap: '12px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '14px' }}>Promote Version Across Environments (N.2.13)</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '10px',
          }}
        >
          <div>
            <label htmlFor="promo-version-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              Version ID
            </label>
            <input
              id="promo-version-input"
              type="text"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              style={{
                width: '100%',
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label htmlFor="promo-from-env" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              From Env
            </label>
            <select
              id="promo-from-env"
              value={fromEnv}
              onChange={(e) => setFromEnv(e.target.value as EnvironmentKind)}
              style={{
                width: '100%',
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
            </select>
          </div>

          <div>
            <label htmlFor="promo-to-env" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              Target Env
            </label>
            <select
              id="promo-to-env"
              value={toEnv}
              onChange={(e) => setToEnv(e.target.value as EnvironmentKind)}
              style={{
                width: '100%',
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="staging">STAGING</option>
              <option value="prod">PROD</option>
            </select>
          </div>

          <div>
            <label htmlFor="promo-canary-pct" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              Canary Traffic (%)
            </label>
            <input
              id="promo-canary-pct"
              type="number"
              min={1}
              max={100}
              value={canaryPct}
              onChange={(e) => setCanaryPct(Number(e.target.value))}
              style={{
                width: '100%',
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label htmlFor="promo-req-creds" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              Required Credentials (comma-separated)
            </label>
            <input
              id="promo-req-creds"
              type="text"
              value={requiredCredsText}
              onChange={(e) => setRequiredCredsText(e.target.value)}
              style={{
                width: '100%',
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label htmlFor="promo-map-creds" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              Target Credential Mapping (key=conn_id)
            </label>
            <input
              id="promo-map-creds"
              type="text"
              value={mappedCredsText}
              onChange={(e) => setMappedCredsText(e.target.value)}
              style={{
                width: '100%',
                minHeight: '32px',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={evalGatePassed}
              onChange={(e) => setEvalGatePassed(e.target.checked)}
            />
            <span>Evaluation Release Gate Passed</span>
          </label>

          <button
            type="submit"
            disabled={promoting}
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
            {promoting ? 'Promoting...' : 'Promote Version'}
          </button>
        </div>
      </form>

      {/* Promotions Queue & History */}
      {promotions.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflowX: 'auto',
          }}
        >
          <table
            aria-label="Promotion History"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
          >
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px' }}>Path</th>
                <th style={{ padding: '10px' }}>Version &amp; Diff</th>
                <th style={{ padding: '10px' }}>Status</th>
                <th style={{ padding: '10px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px', fontWeight: 600 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {p.fromEnv.toUpperCase()} <ArrowRight size={12} /> {p.toEnv.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    <div>{p.versionId} ({p.canaryPct}%)</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <GitCompare size={10} />
                      prev: {String(p.diffSummary['previous_version_id'] ?? 'none')}
                    </div>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <StatusChip
                      label={p.status}
                      tone={
                        p.status === 'deployed'
                          ? 'success'
                          : p.status === 'pending_approval'
                            ? 'warning'
                            : 'danger'
                      }
                    />
                  </td>
                  <td style={{ padding: '10px', display: 'flex', gap: '6px' }}>
                    {p.status === 'pending_approval' && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleApprove(p.id)}
                          style={{
                            minHeight: '28px',
                            padding: '4px 10px',
                            border: '1px solid var(--success)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--success-bg)',
                            color: 'var(--success)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <CheckCircle2 size={12} aria-hidden="true" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReject(p.id)}
                          style={{
                            minHeight: '28px',
                            padding: '4px 10px',
                            border: '1px solid var(--danger)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--danger-bg)',
                            color: 'var(--danger)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <XCircle size={12} aria-hidden="true" />
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
