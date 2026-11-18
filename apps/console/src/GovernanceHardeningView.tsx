import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PlatformError, type EnvironmentKind } from '@elshad/domain';
import {
  type AgentIdentityDto,
  type AuditExportDto,
  type AuditVerifyDto,
  type BudgetDto,
  type EvidencePackDto,
  type KillSwitchDto,
  type PlatformClient,
  type PolicyDto,
  type PolicyPointDto,
  type PolicySimulationReportDto,
  type SecretMetadataDto,
  type ToolGrantDto,
} from '@elshad/sdk-ts';
import { StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  FileCheck,
  FileDown,
  Key,
  OctagonAlert,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

export interface GovernanceHardeningViewProps {
  client: PlatformClient;
  workspaceId?: string;
  environment: EnvironmentKind;
}

export function GovernanceHardeningView({
  client,
  workspaceId,
  environment,
}: GovernanceHardeningViewProps) {
  const [secrets, setSecrets] = useState<SecretMetadataDto[]>([]);
  const [budgets, setBudgets] = useState<BudgetDto[]>([]);
  const [killSwitches, setKillSwitches] = useState<KillSwitchDto[]>([]);
  const [auditVerify, setAuditVerify] = useState<AuditVerifyDto | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Secret form state
  const [secretName, setSecretName] = useState('stripe_api_key');
  const [secretValue, setSecretValue] = useState('');
  const [rotateTargetId, setRotateTargetId] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState('');

  // Budget form state
  const [budgetScopeType, setBudgetScopeType] = useState<'org' | 'workspace' | 'project' | 'agent'>('workspace');
  const [budgetScopeId, setBudgetScopeId] = useState(workspaceId ?? 'ws_1');
  const [softMicroUsd, setSoftMicroUsd] = useState('500000');
  const [hardMicroUsd, setHardMicroUsd] = useState('1000000');
  const [budgetAction, setBudgetAction] = useState<'stop' | 'downgrade_model' | 'require_approval'>('stop');

  // Kill Switch form state
  const [ksScopeType, setKsScopeType] = useState<'global' | 'workspace' | 'agent' | 'tool'>('global');
  const [ksScopeId, setKsScopeId] = useState('*');
  const [ksReason, setKsReason] = useState('Emergency containment pause');

  // S1.2 Governance v1 state (Policies, Agent Identities, Tool Grants, Export & Evidence Pack)
  const [policies, setPolicies] = useState<PolicyDto[]>([]);
  const [agentIdentities, setAgentIdentities] = useState<AgentIdentityDto[]>([]);
  const [toolGrants, setToolGrants] = useState<ToolGrantDto[]>([]);
  const [auditExport, setAuditExport] = useState<AuditExportDto | null>(null);
  const [evidencePack, setEvidencePack] = useState<EvidencePackDto | null>(null);
  const [simReport, setSimReport] = useState<PolicySimulationReportDto | null>(null);
  const [expandedRegoId, setExpandedRegoId] = useState<string | null>(null);

  const [policySlug, setPolicySlug] = useState('deny-destructive-prod');
  const [policyName, setPolicyName] = useState('Block destructive tools in prod');
  const [policyPoint, setPolicyPoint] = useState<PolicyPointDto>('tool_call');
  const [policyEffect, setPolicyEffect] = useState<'allow' | 'deny' | 'require_approval'>('deny');
  const [policyEnv, setPolicyEnv] = useState<'dev' | 'staging' | 'prod'>('prod');
  const [policySecondApprover, setPolicySecondApprover] = useState('prn_reviewer_2');

  const [aidAgentId, setAidAgentId] = useState('agt_1');
  const [aidDisplayName, setAidDisplayName] = useState('Triage Agent Identity');
  const [aidTools, setAidTools] = useState('current_time,http_request');

  const [tgToolId, setTgToolId] = useState('http_request');
  const [tgSideEffect, setTgSideEffect] = useState<'read' | 'write' | 'destructive' | 'external_comms'>('write');
  const [tgDomains, setTgDomains] = useState('api.trusted.internal');
  const [tgMaxCalls, setTgMaxCalls] = useState('3');
  const [tgApproverId, setTgApproverId] = useState('prn_reviewer_2');

  const loadHardeningState = useCallback(async () => {
    try {
      const [secList, budList, ksList, polList, aidList, tgList] = await Promise.all([
        client.secrets.list().catch(() => [] as SecretMetadataDto[]),
        client.budgets.list().catch(() => [] as BudgetDto[]),
        client.killswitches.list().catch(() => [] as KillSwitchDto[]),
        client.policies?.list ? client.policies.list().catch(() => [] as PolicyDto[]) : Promise.resolve([]),
        client.agentIdentities?.list
          ? client.agentIdentities.list().catch(() => [] as AgentIdentityDto[])
          : Promise.resolve([]),
        client.toolGrants?.list
          ? client.toolGrants.list().catch(() => [] as ToolGrantDto[])
          : Promise.resolve([]),
      ]);
      setSecrets(secList);
      setBudgets(budList);
      setKillSwitches(ksList);
      setPolicies(polList);
      setAgentIdentities(aidList);
      setToolGrants(tgList);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [client]);

  useEffect(() => {
    void loadHardeningState();
  }, [loadHardeningState]);

  const activeKillSwitches = killSwitches.filter((k) => k.active);

  async function handleStoreSecret(e: FormEvent) {
    e.preventDefault();
    if (!secretName.trim() || !secretValue) return;
    setError(null);
    setNotice(null);
    try {
      const saved = await client.secrets.put({
        name: secretName.trim(),
        value: secretValue,
      });
      setSecretValue('');
      setSecrets((prev) => {
        const filtered = prev.filter((s) => s.id !== saved.id);
        return [saved, ...filtered];
      });
      setNotice(`Encrypted secret "${saved.name}" stored as write-only ref ${saved.ref} (v${saved.keyVersion}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleRotateSecret(e: FormEvent) {
    e.preventDefault();
    if (!rotateTargetId || !rotateValue) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.secrets.rotate(rotateTargetId, rotateValue);
      setRotateValue('');
      setRotateTargetId(null);
      setSecrets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setNotice(`Rotated "${updated.name}" to key version v${updated.keyVersion}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleSaveBudget(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const saved = await client.budgets.upsert({
        scopeType: budgetScopeType,
        scopeId: budgetScopeId.trim() || workspaceId || 'ws_1',
        workspaceId,
        softLimitMicroUsd: softMicroUsd.trim() ? Number(softMicroUsd) : null,
        hardLimitMicroUsd: hardMicroUsd.trim() ? Number(hardMicroUsd) : null,
        actionOnBreach: budgetAction,
      });
      setBudgets((prev) => {
        const filtered = prev.filter((b) => b.id !== saved.id);
        return [saved, ...filtered];
      });
      setNotice(
        `Saved ${saved.scopeType} budget (${saved.scopeId}): hard limit ${saved.hardLimitMicroUsd ?? 'none'} micro-USD (${saved.actionOnBreach}).`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleActivateKillSwitch(e: FormEvent) {
    e.preventDefault();
    if (!ksReason.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const ks = await client.killswitches.activate({
        scopeType: ksScopeType,
        scopeId: ksScopeId.trim() || '*',
        workspaceId,
        reason: ksReason.trim(),
      });
      setKillSwitches((prev) => {
        const filtered = prev.filter((k) => k.id !== ks.id);
        return [ks, ...filtered];
      });
      setNotice(`Kill switch activated (${ks.scopeType}:${ks.scopeId}). New & active runs halted.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleDeactivateKillSwitch(id: string) {
    setError(null);
    setNotice(null);
    try {
      const updated = await client.killswitches.deactivate(id);
      setKillSwitches((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
      setNotice(`Deactivated kill switch (${updated.scopeType}:${updated.scopeId}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleVerifyAuditChain() {
    setError(null);
    setNotice(null);
    try {
      const res = await client.audit.verify();
      setAuditVerify(res);
      if (res.valid) {
        setNotice(`Audit hash chain verified (${res.checkedCount} events intact).`);
      } else {
        setError(`Audit chain integrity failure at seq ${res.brokenAtSeq ?? 'unknown'}: ${res.reason ?? ''}`);
      }
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleExportAuditCsv() {
    setError(null);
    setNotice(null);
    try {
      const res = await client.audit.export({ format: 'csv' });
      setAuditExport(res);
      setNotice(`Exported CSV (${res.rowCount} rows, chain intact: ${String(res.chainValid)}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleGenerateEvidencePack() {
    setError(null);
    setNotice(null);
    try {
      const pack = await client.audit.generateEvidencePack({ workspaceId });
      setEvidencePack(pack);
      setNotice(`Generated compliance evidence pack ${pack.packId} (SHA-256 ${pack.digestSha256.slice(0, 12)}...).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleCreatePolicy(e: FormEvent) {
    e.preventDefault();
    if (!policySlug.trim() || !policyName.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const created = await client.policies.create({
        workspaceId,
        slug: policySlug.trim(),
        name: policyName.trim(),
        point: policyPoint,
        effect: policyEffect,
        mode: 'audit_only',
        condition: {
          environments: [policyEnv],
        },
      });
      setPolicies((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      setNotice(`Created policy "${created.name}" (${created.mode}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleSimulatePolicy(policyId: string) {
    setError(null);
    setNotice(null);
    try {
      const report = await client.policies.simulate({ policyId });
      setSimReport(report);
      setNotice(
        `Simulated ${report.policySlug}: ${report.blockedCount} blocked, ${report.approvalRequiredCount} approval-gated across ${report.totalRunsEvaluated} runs.`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleEnforcePolicy(policyId: string) {
    setError(null);
    setNotice(null);
    try {
      const updated = await client.policies.enforce(policyId, {
        secondApproverId: policySecondApprover.trim() || undefined,
      });
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setNotice(`Policy "${updated.name}" promoted to enforce (approved by ${updated.approvedBy}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleProvisionAgentIdentity(e: FormEvent) {
    e.preventDefault();
    if (!aidAgentId.trim() || !aidDisplayName.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const allowedToolIds = aidTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const created = await client.agentIdentities.create({
        workspaceId,
        agentId: aidAgentId.trim(),
        environment,
        displayName: aidDisplayName.trim(),
        allowedToolIds,
      });
      setAgentIdentities((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setNotice(`Provisioned agent identity "${created.displayName}" (${created.principalId}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleGrantTool(e: FormEvent) {
    e.preventDefault();
    if (!aidAgentId.trim() || !tgToolId.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const allowedDomains = tgDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      const created = await client.toolGrants.create({
        workspaceId,
        agentId: aidAgentId.trim(),
        toolId: tgToolId.trim(),
        sideEffectClass: tgSideEffect,
        scope: {
          ...(allowedDomains.length > 0 ? { allowedDomains } : {}),
          ...(tgMaxCalls.trim() ? { maxCallsPerRun: Number(tgMaxCalls) } : {}),
        },
        approvedBy: tgSideEffect === 'read' ? undefined : tgApproverId.trim() || undefined,
      });
      setToolGrants((prev) => [created, ...prev.filter((g) => g.id !== created.id)]);
      setNotice(`Granted ${created.sideEffectClass} tool "${created.toolId}" to ${created.agentId}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  return (
    <div style={{ display: 'grid', gap: '16px', marginTop: '12px' }}>
      {activeKillSwitches.length > 0 && (
        <div
          role="alert"
          data-testid="killswitch-banner"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '2px solid var(--danger)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
            <OctagonAlert size={18} aria-hidden="true" />
            <span>
              Emergency Kill Switch Active ({activeKillSwitches.length}) in {environment.toUpperCase()}:{' '}
              {activeKillSwitches.map((k) => `${k.scopeType}:${k.scopeId} (${k.reason})`).join('; ')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleDeactivateKillSwitch(activeKillSwitches[0]!.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--danger)',
              backgroundColor: 'var(--surface)',
              color: 'var(--danger)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Deactivate Kill Switch
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {notice && <SuccessNotice message={notice} />}

      {/* Audit Hash Chain Verification Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 14px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={16} aria-hidden="true" />
          <h2 style={{ margin: 0, fontSize: '15px' }}>Audit Chain Integrity</h2>
          {auditVerify && (
            <StatusChip
              label={
                auditVerify.valid
                  ? `Verified (${auditVerify.checkedCount} events)`
                  : `Broken at seq ${auditVerify.brokenAtSeq ?? '?'}`
              }
              tone={auditVerify.valid ? 'success' : 'danger'}
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void handleVerifyAuditChain()}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Verify Audit Chain
          </button>
          <button
            type="button"
            onClick={() => void handleExportAuditCsv()}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <FileDown size={14} aria-hidden="true" />
            <span>Export Audit CSV</span>
          </button>
          <button
            type="button"
            onClick={() => void handleGenerateEvidencePack()}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <FileCheck size={14} aria-hidden="true" />
            <span>Generate Evidence Pack</span>
          </button>
        </div>
      </div>

      {auditExport && (
        <div
          data-testid="audit-csv-export"
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
          }}
        >
          <strong>Audit Export ({auditExport.format.toUpperCase()}):</strong> {auditExport.rowCount} rows ·{' '}
          Chain Valid: {String(auditExport.chainValid)}
        </div>
      )}

      {evidencePack && (
        <div
          data-testid="evidence-pack-summary"
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
          }}
        >
          <strong>Evidence Pack {evidencePack.packId}:</strong> SHA-256{' '}
          <code>{evidencePack.digestSha256}</code> · Policies: {evidencePack.policies.length} · Grants:{' '}
          {evidencePack.toolGrants.length} · Agent Identities: {evidencePack.agentIdentities.length}
        </div>
      )}

      {/* Hardening Controls Grid: Kill Switch | Budgets | Secrets */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        {/* 1. Emergency Kill Switch */}
        <section
          aria-label="Emergency Kill Switches"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldAlert size={16} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Emergency Kill Switches</h2>
          </div>
          <form onSubmit={(e) => void handleActivateKillSwitch(e)} style={{ display: 'grid', gap: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="ks-scope-type" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Kill Scope
                </label>
                <select
                  id="ks-scope-type"
                  value={ksScopeType}
                  onChange={(e) =>
                    setKsScopeType(e.target.value as 'global' | 'workspace' | 'agent' | 'tool')
                  }
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                >
                  <option value="global">global</option>
                  <option value="workspace">workspace</option>
                  <option value="agent">agent</option>
                  <option value="tool">tool</option>
                </select>
              </div>
              <div>
                <label htmlFor="ks-scope-id" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Target Scope ID
                </label>
                <input
                  id="ks-scope-id"
                  type="text"
                  value={ksScopeId}
                  onChange={(e) => setKsScopeId(e.target.value)}
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="ks-reason" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Incident Reason
              </label>
              <input
                id="ks-reason"
                type="text"
                required
                value={ksReason}
                onChange={(e) => setKsReason(e.target.value)}
                style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
              />
            </div>
            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--danger)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Activate Kill Switch
            </button>
          </form>

          {killSwitches.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', display: 'grid', gap: '4px' }}>
              {killSwitches.map((k) => (
                <li key={k.id}>
                  <strong>
                    {k.scopeType}:{k.scopeId}
                  </strong>{' '}
                  — {k.active ? 'ACTIVE' : 'inactive'} ({k.reason})
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 2. Hierarchical Budgets & Hard Stops */}
        <section
          aria-label="Budgets and Hard Stops"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Wallet size={16} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Budgets &amp; Hard Stops (N.2.6)</h2>
          </div>
          <form onSubmit={(e) => void handleSaveBudget(e)} style={{ display: 'grid', gap: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="budget-scope-type" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Budget Scope
                </label>
                <select
                  id="budget-scope-type"
                  value={budgetScopeType}
                  onChange={(e) =>
                    setBudgetScopeType(e.target.value as 'org' | 'workspace' | 'project' | 'agent')
                  }
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                >
                  <option value="workspace">workspace</option>
                  <option value="agent">agent</option>
                  <option value="project">project</option>
                  <option value="org">org</option>
                </select>
              </div>
              <div>
                <label htmlFor="budget-scope-id" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Budget Target ID
                </label>
                <input
                  id="budget-scope-id"
                  type="text"
                  required
                  value={budgetScopeId}
                  onChange={(e) => setBudgetScopeId(e.target.value)}
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="budget-soft" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Soft (micro-USD)
                </label>
                <input
                  id="budget-soft"
                  type="number"
                  min={0}
                  value={softMicroUsd}
                  onChange={(e) => setSoftMicroUsd(e.target.value)}
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="budget-hard" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Hard (micro-USD)
                </label>
                <input
                  id="budget-hard"
                  type="number"
                  min={0}
                  value={hardMicroUsd}
                  onChange={(e) => setHardMicroUsd(e.target.value)}
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="budget-action" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  On Breach
                </label>
                <select
                  id="budget-action"
                  value={budgetAction}
                  onChange={(e) =>
                    setBudgetAction(
                      e.target.value as 'stop' | 'downgrade_model' | 'require_approval',
                    )
                  }
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                >
                  <option value="stop">stop</option>
                  <option value="downgrade_model">downgrade_model</option>
                  <option value="require_approval">require_approval</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Save Budget
            </button>
          </form>

          {budgets.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', display: 'grid', gap: '4px' }}>
              {budgets.map((b) => (
                <li key={b.id}>
                  <strong>
                    {b.scopeType}:{b.scopeId}
                  </strong>{' '}
                  — spent {b.spentMicroUsd} / hard {b.hardLimitMicroUsd ?? 'unbounded'} µUSD ({b.actionOnBreach})
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3. Write-Only Envelope Secrets Vault */}
        <section
          aria-label="Secrets Vault"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Key size={16} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Secrets Vault (Write-Only)</h2>
          </div>
          <form onSubmit={(e) => void handleStoreSecret(e)} style={{ display: 'grid', gap: '8px' }}>
            <div>
              <label htmlFor="secret-name-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Secret Name
              </label>
              <input
                id="secret-name-input"
                type="text"
                required
                value={secretName}
                onChange={(e) => setSecretName(e.target.value)}
                style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="secret-value-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Secret Value (Write-Only)
              </label>
              <input
                id="secret-value-input"
                type="password"
                required
                placeholder="Enter credential value..."
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
              />
            </div>
            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Store Secret
            </button>
          </form>

          {secrets.length > 0 && (
            <div style={{ display: 'grid', gap: '6px' }}>
              {secrets.map((sec) => (
                <div
                  key={sec.id}
                  style={{
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <strong>{sec.name}</strong> · <code>{sec.ref}</code> · v{sec.keyVersion}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRotateTargetId(sec.id);
                      setRotateValue('');
                    }}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                    }}
                  >
                    <RefreshCw size={11} aria-hidden="true" />
                    <span>Rotate</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {rotateTargetId && (
            <form
              onSubmit={(e) => void handleRotateSecret(e)}
              style={{
                display: 'grid',
                gap: '6px',
                padding: '8px',
                border: '1px solid var(--brand)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <label htmlFor="rotate-secret-value" style={{ fontSize: '12px', fontWeight: 600 }}>
                New Secret Value for Rotation
              </label>
              <input
                id="rotate-secret-value"
                type="password"
                required
                value={rotateValue}
                onChange={(e) => setRotateValue(e.target.value)}
                style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="submit"
                  style={{
                    padding: '5px 10px',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Confirm Rotate
                </button>
                <button
                  type="button"
                  onClick={() => setRotateTargetId(null)}
                  style={{
                    padding: '5px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      {/* S1.2 Governance v1: Declarative Policies & Simulation | Agent Identities & Tool Grants */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        {/* 4. Declarative Policies & Simulation */}
        <section
          aria-label="Declarative Policies and Simulation"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Shield size={16} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Declarative Policies &amp; Simulation</h2>
          </div>

          <form onSubmit={(e) => void handleCreatePolicy(e)} style={{ display: 'grid', gap: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="policy-slug-input" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Policy Slug
                </label>
                <input
                  id="policy-slug-input"
                  type="text"
                  required
                  value={policySlug}
                  onChange={(e) => setPolicySlug(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="policy-name-input" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Policy Name
                </label>
                <input
                  id="policy-name-input"
                  type="text"
                  required
                  value={policyName}
                  onChange={(e) => setPolicyName(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="policy-point-select" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Hook Point
                </label>
                <select
                  id="policy-point-select"
                  value={policyPoint}
                  onChange={(e) => setPolicyPoint(e.target.value as PolicyPointDto)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                >
                  <option value="tool_call">tool_call</option>
                  <option value="data_access">data_access</option>
                  <option value="memory_read">memory_read</option>
                  <option value="memory_write">memory_write</option>
                  <option value="model_select">model_select</option>
                  <option value="egress">egress</option>
                  <option value="promotion">promotion</option>
                  <option value="publish">publish</option>
                </select>
              </div>
              <div>
                <label htmlFor="policy-effect-select" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Effect
                </label>
                <select
                  id="policy-effect-select"
                  value={policyEffect}
                  onChange={(e) => setPolicyEffect(e.target.value as 'allow' | 'deny' | 'require_approval')}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                >
                  <option value="deny">deny</option>
                  <option value="require_approval">require_approval</option>
                  <option value="allow">allow</option>
                </select>
              </div>
              <div>
                <label htmlFor="policy-env-input" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Target Env
                </label>
                <select
                  id="policy-env-input"
                  value={policyEnv}
                  onChange={(e) => setPolicyEnv(e.target.value as 'dev' | 'staging' | 'prod')}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                >
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="prod">prod</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Create Policy
            </button>
          </form>

          <div>
            <label htmlFor="policy-second-approver" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
              Second Policy Approver ID (SoD)
            </label>
            <input
              id="policy-second-approver"
              type="text"
              value={policySecondApprover}
              onChange={(e) => setPolicySecondApprover(e.target.value)}
              style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
            />
          </div>

          {simReport && (
            <div
              data-testid="policy-sim-report"
              style={{
                padding: '8px',
                backgroundColor: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
              }}
            >
              Simulated <strong>{simReport.policySlug}</strong>: {simReport.blockedCount} blocked,{' '}
              {simReport.approvalRequiredCount} approvals across {simReport.totalRunsEvaluated} runs (
              {simReport.durationMs}ms)
            </div>
          )}

          {policies.length > 0 && (
            <div style={{ display: 'grid', gap: '6px' }}>
              {policies.map((pol) => (
                <div
                  key={pol.id}
                  style={{
                    padding: '8px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    display: 'grid',
                    gap: '6px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <div>
                      <strong>{pol.name}</strong> (<code>{pol.slug}</code>) · {pol.effect} ·{' '}
                      <StatusChip label={pol.mode} tone={pol.mode === 'enforce' ? 'success' : 'info'} />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedRegoId((prev) => (prev === pol.id ? null : pol.id))}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--surface)',
                          cursor: 'pointer',
                          fontSize: '11px',
                        }}
                      >
                        View Rego
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSimulatePolicy(pol.id)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--surface)',
                          cursor: 'pointer',
                          fontSize: '11px',
                        }}
                      >
                        Simulate Policy
                      </button>
                      {pol.mode === 'audit_only' && (
                        <button
                          type="button"
                          onClick={() => void handleEnforcePolicy(pol.id)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--brand)',
                            backgroundColor: 'var(--brand)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          Enforce Policy (SoD)
                        </button>
                      )}
                    </div>
                  </div>
                  {expandedRegoId === pol.id && (
                    <pre
                      data-testid="policy-rego-preview"
                      style={{
                        margin: 0,
                        padding: '8px',
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        overflowX: 'auto',
                        fontSize: '11px',
                      }}
                    >
                      {pol.regoSource}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Agent Identities & Scoped Tool Grants */}
        <section
          aria-label="Agent Identities and Scoped Tool Grants"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={16} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Agent Identities &amp; Scoped Tool Grants</h2>
          </div>

          <form onSubmit={(e) => void handleProvisionAgentIdentity(e)} style={{ display: 'grid', gap: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="aid-agent-id" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Target Agent ID
                </label>
                <input
                  id="aid-agent-id"
                  type="text"
                  required
                  value={aidAgentId}
                  onChange={(e) => setAidAgentId(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="aid-display-name" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Identity Display Name
                </label>
                <input
                  id="aid-display-name"
                  type="text"
                  required
                  value={aidDisplayName}
                  onChange={(e) => setAidDisplayName(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="aid-tools-input" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                Allowed Tool IDs (comma-separated)
              </label>
              <input
                id="aid-tools-input"
                type="text"
                value={aidTools}
                onChange={(e) => setAidTools(e.target.value)}
                style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
              />
            </div>
            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                borderColor: 'var(--border)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Provision Agent Identity
            </button>
          </form>

          {agentIdentities.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', display: 'grid', gap: '4px' }}>
              {agentIdentities.map((ai) => (
                <li key={ai.id}>
                  <strong>{ai.displayName}</strong> · principal <code>{ai.principalId}</code> · tools [{ai.allowedToolIds.join(', ')}]
                </li>
              ))}
            </ul>
          )}

          <hr style={{ width: '100%', border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />

          <form onSubmit={(e) => void handleGrantTool(e)} style={{ display: 'grid', gap: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="tg-tool-id" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Tool Name
                </label>
                <input
                  id="tg-tool-id"
                  type="text"
                  required
                  value={tgToolId}
                  onChange={(e) => setTgToolId(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="tg-side-effect" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Side-Effect Class
                </label>
                <select
                  id="tg-side-effect"
                  value={tgSideEffect}
                  onChange={(e) =>
                    setTgSideEffect(e.target.value as 'read' | 'write' | 'destructive' | 'external_comms')
                  }
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                >
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="destructive">destructive</option>
                  <option value="external_comms">external_comms</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: '6px' }}>
              <div>
                <label htmlFor="tg-allowed-domains" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Allowed Domains
                </label>
                <input
                  id="tg-allowed-domains"
                  type="text"
                  value={tgDomains}
                  onChange={(e) => setTgDomains(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="tg-max-calls" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Max Calls
                </label>
                <input
                  id="tg-max-calls"
                  type="number"
                  min={1}
                  value={tgMaxCalls}
                  onChange={(e) => setTgMaxCalls(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="tg-approver-id" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                  Approver ID (SoD)
                </label>
                <input
                  id="tg-approver-id"
                  type="text"
                  value={tgApproverId}
                  onChange={(e) => setTgApproverId(e.target.value)}
                  style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Grant Scoped Tool
            </button>
          </form>

          {toolGrants.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', display: 'grid', gap: '4px' }}>
              {toolGrants.map((g) => (
                <li key={g.id}>
                  <strong>{g.toolId}</strong> ({g.sideEffectClass}) → {g.agentId} · max {g.scope.maxCallsPerRun ?? '∞'} calls
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
