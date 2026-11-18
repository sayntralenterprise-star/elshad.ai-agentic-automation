import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PlatformError, type EnvironmentKind } from '@elshad/domain';
import {
  type AgentDiffDto,
  type AgentDto,
  type ModelCapabilityDto,
  type PlatformClient,
  type RunDto,
  type RunStepDto,
  type ToolContractDto,
  type UsageLedgerEntryDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import { DeploymentsView } from './DeploymentsView.js';
import { TeamCanvasView } from './TeamCanvasView.js';

type StudioTab = 'configure' | 'tools' | 'test' | 'teams' | 'deployments';

interface ToolBindingDraft {
  tool: string;
  approval: 'never' | 'auto' | 'always';
  allowedDomainsText: string;
}

export interface AgentStudioViewProps {
  client: PlatformClient;
  workspaceId?: string;
  projectId?: string;
  environment: EnvironmentKind;
}

function formatUsdFromMicro(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(6)}`;
}

export function AgentStudioView({
  client,
  workspaceId,
  projectId,
  environment,
}: AgentStudioViewProps) {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [toolsCatalog, setToolsCatalog] = useState<ToolContractDto[]>([]);
  const [modelsCatalog, setModelsCatalog] = useState<ModelCapabilityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [studioTab, setStudioTab] = useState<StudioTab>('configure');

  // Create modal state (PRD P.1)
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('research-assistant');
  const [newDescription, setNewDescription] = useState('Analyzes operational prompts safely.');
  const [newTier, setNewTier] = useState<'fast' | 'standard' | 'reasoning'>('standard');
  const [newAutonomy, setNewAutonomy] = useState<0 | 1 | 2 | 3>(2);
  const [newSystemPrompt, setNewSystemPrompt] = useState(
    'You are a concise, policy-compliant assistant.',
  );
  const [newSelectedTools, setNewSelectedTools] = useState<string[]>(['current_time']);

  // Draft editor state
  const [draftSemver, setDraftSemver] = useState('1.0.0');
  const [draftAutonomy, setDraftAutonomy] = useState<0 | 1 | 2 | 3 | 4>(2);
  const [draftTier, setDraftTier] = useState<'fast' | 'standard' | 'reasoning'>('standard');
  const [draftModelId, setDraftModelId] = useState('mock/react-default');
  const [draftProvider, setDraftProvider] = useState('mock');
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  const [draftMaxSteps, setDraftMaxSteps] = useState(25);
  const [draftMaxCostMicroUsd, setDraftMaxCostMicroUsd] = useState(2_000_000);
  const [draftToolBindings, setDraftToolBindings] = useState<ToolBindingDraft[]>([]);
  const [versionDiff, setVersionDiff] = useState<AgentDiffDto | null>(null);

  // Test Playground state (PRD P.7)
  const [testPrompt, setTestPrompt] = useState('What is the current UTC time?');
  const [dryRun, setDryRun] = useState(false);
  const [runningTest, setRunningTest] = useState(false);
  const [lastRun, setLastRun] = useState<RunDto | null>(null);
  const [lastSteps, setLastSteps] = useState<RunStepDto[]>([]);
  const [lastLedger, setLastLedger] = useState<UsageLedgerEntryDto[]>([]);
  const [savedTestCases, setSavedTestCases] = useState<Array<{ prompt: string; runId: string }>>([]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );

  const syncDraftFromAgent = useCallback((agent: AgentDto | null) => {
    if (!agent) return;
    const ver = agent.draftVersion ?? agent.publishedVersion ?? agent.versions[agent.versions.length - 1];
    if (!ver) return;
    const def = ver.definition as {
      version?: string;
      autonomy_level?: 0 | 1 | 2 | 3 | 4;
      model?: { tier?: 'fast' | 'standard' | 'reasoning'; provider?: string; model?: string };
      prompt?: { system?: string };
      limits?: { max_steps?: number; max_cost_micro_usd?: number };
      tools?: Array<{ tool: string; approval?: 'never' | 'auto' | 'always'; scope?: { allowed_domains?: string[] } }>;
    };
    setDraftSemver(def.version ?? ver.semver);
    setDraftAutonomy(def.autonomy_level ?? 2);
    setDraftTier(def.model?.tier ?? 'standard');
    setDraftProvider(def.model?.provider ?? 'mock');
    setDraftModelId(def.model?.model ?? 'mock/react-default');
    setDraftSystemPrompt(def.prompt?.system ?? '');
    setDraftMaxSteps(def.limits?.max_steps ?? 25);
    setDraftMaxCostMicroUsd(def.limits?.max_cost_micro_usd ?? 2_000_000);
    setDraftToolBindings(
      (def.tools ?? []).map((t) => ({
        tool: t.tool,
        approval: t.approval ?? 'auto',
        allowedDomainsText: (t.scope?.allowed_domains ?? []).join(', '),
      })),
    );
    setVersionDiff(null);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentList, toolsList, modelsList] = await Promise.all([
        client.agents.list(),
        client.tools.list(),
        client.models.list(),
      ]);
      setAgents(agentList);
      setToolsCatalog(toolsList);
      setModelsCatalog(modelsList);
      const first = agentList[0] ?? null;
      if (first && !selectedAgentId) {
        setSelectedAgentId(first.id);
        syncDraftFromAgent(first);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Agent Studio data');
    } finally {
      setLoading(false);
    }
  }, [client, selectedAgentId, syncDraftFromAgent]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const liveTrifectaWarning = useMemo(() => {
    const enabledContracts = draftToolBindings
      .map((b) => toolsCatalog.find((t) => t.name === b.tool))
      .filter((t): t is ToolContractDto => Boolean(t));
    const hasPrivate = enabledContracts.some((t) =>
      t.dataClassificationTouched.some(
        (d) => d === 'confidential' || d === 'restricted' || d === 'pii',
      ),
    );
    const hasUntrusted = enabledContracts.some(
      (t) => t.name === 'web_fetch' || t.name === 'http_request',
    );
    const hasExternal = enabledContracts.some((t) => t.sideEffectClass === 'external_comms');
    const activeVersionTri = selectedAgent?.draftVersion?.lethalTrifecta.detected ?? false;
    return activeVersionTri || (hasPrivate && hasUntrusted && hasExternal);
  }, [draftToolBindings, toolsCatalog, selectedAgent]);

  async function handleCreateAgent(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await client.agents.create(
        {
          workspaceId,
          projectId,
          definition: {
            kind: 'AgentVersion',
            apiVersion: 'elshad.ai/v1',
            name: newName.trim(),
            version: '1.0.0',
            description: newDescription.trim(),
            autonomy_level: newAutonomy,
            model: {
              tier: newTier,
              provider: 'mock',
              model: `mock/react-${newTier}`,
            },
            prompt: {
              system: newSystemPrompt,
            },
            tools: newSelectedTools.map((tool) => ({
              tool,
              approval: 'auto',
              scope: {},
            })),
          },
        },
        `ui-agent-create-${Date.now()}`,
      );
      setAgents((prev) => [...prev, created]);
      setSelectedAgentId(created.id);
      syncDraftFromAgent(created);
      setCreateOpen(false);
      setNotice(`Created agent "${created.name}" (v1.0.0 draft).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  function buildDraftDefinitionPayload(): Record<string, unknown> {
    return {
      kind: 'AgentVersion',
      apiVersion: 'elshad.ai/v1',
      name: selectedAgent?.name ?? 'agent',
      version: draftSemver.trim(),
      description: selectedAgent?.description ?? undefined,
      autonomy_level: draftAutonomy,
      model: {
        tier: draftTier,
        provider: draftProvider,
        model: draftModelId,
      },
      prompt: {
        system: draftSystemPrompt,
      },
      tools: draftToolBindings.map((tb) => {
        const domains = tb.allowedDomainsText
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean);
        return {
          tool: tb.tool,
          approval: tb.approval,
          scope: domains.length > 0 ? { allowed_domains: domains } : {},
        };
      }),
      limits: {
        max_steps: draftMaxSteps,
        max_tokens: 200_000,
        max_wall_time_ms: 900_000,
        max_cost_micro_usd: draftMaxCostMicroUsd,
        max_tool_calls: 40,
      },
    };
  }

  async function handleSaveDraft() {
    if (!selectedAgent) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.agents.updateDraft(selectedAgent.id, {
        definition: buildDraftDefinitionPayload(),
        message: 'Updated via Agent Studio',
      });
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      syncDraftFromAgent(updated);
      setNotice(`Saved draft v${draftSemver}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handlePublishDraft() {
    const targetDraft = selectedAgent?.draftVersion;
    if (!selectedAgent || !targetDraft) return;
    const semver = targetDraft.semver;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.agents.publishVersion(
        selectedAgent.id,
        targetDraft.id,
        `ui-publish-${Date.now()}`,
        { message: 'Published via Agent Studio' },
      );
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      syncDraftFromAgent(updated);
      setNotice(`Published v${semver}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleComputeDiff() {
    if (!selectedAgent?.publishedVersion || !selectedAgent?.draftVersion) return;
    setError(null);
    try {
      const diff = await client.agents.diff(
        selectedAgent.id,
        selectedAgent.publishedVersion.id,
        selectedAgent.draftVersion.id,
      );
      setVersionDiff(diff);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  function toggleToolBinding(toolName: string) {
    setDraftToolBindings((prev) => {
      const exists = prev.some((b) => b.tool === toolName);
      if (exists) {
        return prev.filter((b) => b.tool !== toolName);
      }
      return [...prev, { tool: toolName, approval: 'auto', allowedDomainsText: '' }];
    });
  }

  async function handleRunPlayground(e: FormEvent) {
    e.preventDefault();
    if (!selectedAgent) return;
    setRunningTest(true);
    setError(null);
    try {
      const run = await client.agents.run(
        selectedAgent.id,
        {
          environment,
          input: testPrompt,
          dryRun,
        },
        `ui-playground-${Date.now()}`,
      );
      const [steps, ledger] = await Promise.all([
        client.runs.listSteps(run.id),
        client.runs.listUsageLedger(run.id),
      ]);
      setLastRun(run);
      setLastSteps(steps);
      setLastLedger(ledger.data);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setRunningTest(false);
    }
  }

  if (loading) {
    return (
      <StateView
        state="loading"
        title="Loading Agent Studio…"
        description="Fetching agents, built-in tool contracts, and registered models."
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '22px' }}>Agents Studio</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Configure versioned agents, inspect tool policies, and run isolated ReAct tests.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{
            minHeight: '36px',
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'var(--brand)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Create Agent
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '12px',
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

      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-agent-heading"
          style={{
            padding: '20px',
            backgroundColor: 'var(--surface)',
            border: '2px solid var(--brand)',
            borderRadius: 'var(--radius-md)',
            display: 'grid',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 id="create-agent-heading" style={{ margin: 0, fontSize: '18px' }}>
              Create New Agent
            </h2>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              style={{
                minHeight: '30px',
                padding: '4px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          <form onSubmit={(e) => void handleCreateAgent(e)} style={{ display: 'grid', gap: '12px' }}>
            <div>
              <label htmlFor="create-agent-name" style={{ display: 'block', fontWeight: 600 }}>
                Agent Name (kebab-case)
              </label>
              <input
                id="create-agent-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label htmlFor="create-agent-tier" style={{ display: 'block', fontWeight: 600 }}>
                  Model Tier
                </label>
                <select
                  id="create-agent-tier"
                  value={newTier}
                  onChange={(e) =>
                    setNewTier(e.target.value as 'fast' | 'standard' | 'reasoning')
                  }
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                >
                  <option value="fast">fast</option>
                  <option value="standard">standard</option>
                  <option value="reasoning">reasoning</option>
                </select>
              </div>
              <div>
                <label htmlFor="create-agent-autonomy" style={{ display: 'block', fontWeight: 600 }}>
                  Autonomy Level
                </label>
                <select
                  id="create-agent-autonomy"
                  value={String(newAutonomy)}
                  onChange={(e) => setNewAutonomy(Number(e.target.value) as 0 | 1 | 2 | 3)}
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                >
                  <option value="0">L0 — Advisory</option>
                  <option value="1">L1 — Assisted</option>
                  <option value="2">L2 — Supervised</option>
                  <option value="3">L3 — Autonomous</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="create-agent-desc" style={{ display: 'block', fontWeight: 600 }}>
                Description
              </label>
              <input
                id="create-agent-desc"
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
              />
            </div>

            <div>
              <label htmlFor="create-agent-prompt" style={{ display: 'block', fontWeight: 600 }}>
                System Prompt
              </label>
              <textarea
                id="create-agent-prompt"
                rows={3}
                required
                value={newSystemPrompt}
                onChange={(e) => setNewSystemPrompt(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
              />
            </div>

            <fieldset style={{ border: '1px solid var(--border)', padding: '10px' }}>
              <legend style={{ fontWeight: 600 }}>Starter Tools</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {toolsCatalog.map((tool) => (
                  <label key={tool.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={newSelectedTools.includes(tool.name)}
                      onChange={() =>
                        setNewSelectedTools((prev) =>
                          prev.includes(tool.name)
                            ? prev.filter((x) => x !== tool.name)
                            : [...prev, tool.name],
                        )
                      }
                    />
                    <span>{tool.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              style={{
                minHeight: '36px',
                padding: '8px 16px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                justifySelf: 'start',
              }}
            >
              Create Agent Draft
            </button>
          </form>
        </div>
      )}

      {agents.length === 0 ? (
        <StateView
          state="empty"
          title="No agents in this workspace yet"
          description="Create your first versioned ReAct agent to start configuring prompts, tools, and live test runs."
          actionLabel="+ Create Agent"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px' }}>
          {/* Agent Roster Sidebar */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px',
              display: 'grid',
              gap: '8px',
              alignContent: 'start',
            }}
          >
            <h2 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Workspace Agents ({agents.length})</h2>
            {agents.map((a) => {
              const isSelected = a.id === selectedAgent?.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedAgentId(a.id);
                    syncDraftFromAgent(a);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '10px',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '1px solid var(--brand)' : '1px solid var(--border)',
                    backgroundColor: isSelected ? 'var(--info-bg)' : 'var(--surface-raised)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: '4px',
                  }}
                >
                  <strong>{a.name}</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <StatusChip
                      label={a.status}
                      tone={a.status === 'active' ? 'success' : 'neutral'}
                    />
                    <span>{a.publishedVersion?.semver ?? a.draftVersion?.semver ?? 'draft'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Agent Studio Panel */}
          {selectedAgent && (
            <div
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                display: 'grid',
                gap: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px' }}>{selectedAgent.name}</h2>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Published: {selectedAgent.publishedVersion?.semver ?? 'none'} · Draft:{' '}
                    {selectedAgent.draftVersion?.semver ?? 'none'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => void handleSaveDraft()}
                    style={{
                      minHeight: '32px',
                      padding: '4px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface-raised)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    Save Draft
                  </button>
                  {selectedAgent.publishedVersion && selectedAgent.draftVersion && (
                    <button
                      type="button"
                      onClick={() => void handleComputeDiff()}
                      style={{
                        minHeight: '32px',
                        padding: '4px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      Diff Versions
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!selectedAgent.draftVersion}
                    onClick={() => void handlePublishDraft()}
                    style={{
                      minHeight: '32px',
                      padding: '4px 12px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: selectedAgent.draftVersion ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Publish Version
                  </button>
                </div>
              </div>

              {/* Studio Tabs */}
              <div role="tablist" aria-label="Agent Studio Sections" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                {(['configure', 'tools', 'test', 'teams', 'deployments'] as const).map((tabKey) => (
                  <button
                    key={tabKey}
                    type="button"
                    role="tab"
                    aria-selected={studioTab === tabKey}
                    onClick={() => setStudioTab(tabKey)}
                    style={{
                      minHeight: '32px',
                      padding: '4px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: studioTab === tabKey ? '1px solid var(--brand)' : '1px solid var(--border)',
                      backgroundColor: studioTab === tabKey ? 'var(--info-bg)' : 'var(--surface-raised)',
                      color: studioTab === tabKey ? 'var(--info)' : 'var(--text-primary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {tabKey === 'configure'
                      ? 'Configure'
                      : tabKey === 'tools'
                        ? 'Tools'
                        : tabKey === 'test'
                          ? 'Test Playground'
                          : tabKey === 'teams'
                            ? 'Team Canvas'
                            : 'Deployments'}
                  </button>
                ))}
              </div>

              {versionDiff && (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <strong>
                    Diff {versionDiff.fromVersion} → {versionDiff.toVersion}
                  </strong>
                  <ul style={{ margin: '6px 0 0 18px' }}>
                    {versionDiff.changes.map((c) => (
                      <li key={c.path}>
                        <code>{c.path}</code>: {c.kind}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {studioTab === 'configure' && (
                <div role="tabpanel" aria-label="Configure Agent" style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    <div>
                      <label htmlFor="studio-semver" style={{ display: 'block', fontWeight: 600 }}>
                        Version (semver)
                      </label>
                      <input
                        id="studio-semver"
                        type="text"
                        value={draftSemver}
                        onChange={(e) => setDraftSemver(e.target.value)}
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="studio-autonomy" style={{ display: 'block', fontWeight: 600 }}>
                        Autonomy Level
                      </label>
                      <select
                        id="studio-autonomy"
                        value={String(draftAutonomy)}
                        onChange={(e) => setDraftAutonomy(Number(e.target.value) as 0 | 1 | 2 | 3 | 4)}
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                      >
                        <option value="0">L0</option>
                        <option value="1">L1</option>
                        <option value="2">L2</option>
                        <option value="3">L3</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="studio-model" style={{ display: 'block', fontWeight: 600 }}>
                        Model
                      </label>
                      <select
                        id="studio-model"
                        value={`${draftProvider}::${draftModelId}`}
                        onChange={(e) => {
                          const [prov, mod] = e.target.value.split('::');
                          const found = modelsCatalog.find(
                            (m) => m.provider === prov && m.id === mod,
                          );
                          setDraftProvider(prov ?? 'mock');
                          setDraftModelId(mod ?? 'mock/react-default');
                          if (found && found.tier !== 'embedding') {
                            setDraftTier(found.tier);
                          }
                        }}
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                      >
                        {modelsCatalog.map((m) => (
                          <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
                            {m.displayName} ({m.tier})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="studio-system-prompt" style={{ display: 'block', fontWeight: 600 }}>
                      System Prompt
                    </label>
                    <textarea
                      id="studio-system-prompt"
                      rows={5}
                      value={draftSystemPrompt}
                      onChange={(e) => setDraftSystemPrompt(e.target.value)}
                      style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label htmlFor="studio-max-steps" style={{ display: 'block', fontWeight: 600 }}>
                        Max Steps
                      </label>
                      <input
                        id="studio-max-steps"
                        type="number"
                        value={draftMaxSteps}
                        onChange={(e) => setDraftMaxSteps(Number(e.target.value))}
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="studio-max-cost" style={{ display: 'block', fontWeight: 600 }}>
                        Cost Ceiling (micro-USD)
                      </label>
                      <input
                        id="studio-max-cost"
                        type="number"
                        value={draftMaxCostMicroUsd}
                        onChange={(e) => setDraftMaxCostMicroUsd(Number(e.target.value))}
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {studioTab === 'tools' && (
                <div role="tabpanel" aria-label="Agent Tools" style={{ display: 'grid', gap: '12px' }}>
                  {liveTrifectaWarning && (
                    <div
                      role="alert"
                      style={{
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--warning-bg)',
                        border: '1px solid var(--warning)',
                        color: 'var(--warning)',
                        fontWeight: 600,
                      }}
                    >
                      Lethal Trifecta Warning: Combining private data access, untrusted external
                      input, and external communication tools requires strict domain allowlists or
                      explicit approval.
                    </div>
                  )}

                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '8px' }}>Grant</th>
                        <th style={{ padding: '8px' }}>Tool</th>
                        <th style={{ padding: '8px' }}>Side Effect</th>
                        <th style={{ padding: '8px' }}>Approval</th>
                        <th style={{ padding: '8px' }}>Allowed Domains</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolsCatalog.map((tool) => {
                        const binding = draftToolBindings.find((b) => b.tool === tool.name);
                        const enabled = Boolean(binding);
                        return (
                          <tr key={tool.name} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px' }}>
                              <input
                                type="checkbox"
                                aria-label={`Enable tool ${tool.name}`}
                                checked={enabled}
                                onChange={() => toggleToolBinding(tool.name)}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <strong>{tool.name}</strong>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {tool.description}
                              </div>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <StatusChip
                                label={tool.sideEffectClass}
                                tone={tool.sideEffectClass === 'external_comms' ? 'warning' : 'neutral'}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <select
                                aria-label={`Approval mode for ${tool.name}`}
                                disabled={!enabled}
                                value={binding?.approval ?? 'auto'}
                                onChange={(e) =>
                                  setDraftToolBindings((prev) =>
                                    prev.map((b) =>
                                      b.tool === tool.name
                                        ? { ...b, approval: e.target.value as 'never' | 'auto' | 'always' }
                                        : b,
                                    ),
                                  )
                                }
                              >
                                <option value="auto">auto</option>
                                <option value="always">always</option>
                                <option value="never">never</option>
                              </select>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <input
                                type="text"
                                aria-label={`Allowed domains for ${tool.name}`}
                                disabled={!enabled}
                                placeholder="e.g., docs.example.com"
                                value={binding?.allowedDomainsText ?? ''}
                                onChange={(e) =>
                                  setDraftToolBindings((prev) =>
                                    prev.map((b) =>
                                      b.tool === tool.name
                                        ? { ...b, allowedDomainsText: e.target.value }
                                        : b,
                                    ),
                                  )
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {studioTab === 'test' && (
                <div role="tabpanel" aria-label="Test Playground" style={{ display: 'grid', gap: '14px' }}>
                  <form onSubmit={(e) => void handleRunPlayground(e)} style={{ display: 'grid', gap: '10px' }}>
                    <div>
                      <label htmlFor="playground-prompt" style={{ display: 'block', fontWeight: 600 }}>
                        Test Prompt
                      </label>
                      <textarea
                        id="playground-prompt"
                        rows={3}
                        required
                        value={testPrompt}
                        onChange={(e) => setTestPrompt(e.target.value)}
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={dryRun}
                          onChange={(e) => setDryRun(e.target.checked)}
                        />
                        <span>Dry-run (validate policies &amp; args without executing external tools)</span>
                      </label>
                      <button
                        type="submit"
                        disabled={runningTest}
                        style={{
                          minHeight: '34px',
                          padding: '6px 14px',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--brand)',
                          color: '#fff',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {runningTest ? 'Running…' : 'Run Test'}
                      </button>
                    </div>
                  </form>

                  {lastRun && (
                    <div style={{ display: 'grid', gap: '10px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <StatusChip
                            label={`${lastRun.status} (${lastRun.terminationReason ?? 'done'})`}
                            tone={lastRun.status === 'succeeded' ? 'success' : 'warning'}
                          />
                          <span>
                            Cost: <strong>{lastRun.costMicroUsd} micro-USD</strong> (
                            {formatUsdFromMicro(lastRun.costMicroUsd)})
                          </span>
                          <span>
                            Tokens: {lastRun.usage.tokensIn} in / {lastRun.usage.tokensOut} out
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSavedTestCases((prev) => [
                              ...prev,
                              { prompt: testPrompt, runId: lastRun.id },
                            ])
                          }
                          style={{
                            minHeight: '30px',
                            padding: '4px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--surface-raised)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                          }}
                        >
                          Save as test case
                        </button>
                      </div>

                      <div
                        style={{
                          padding: '10px',
                          backgroundColor: 'var(--surface-raised)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        <strong>Output:</strong>{' '}
                        <code>{JSON.stringify(lastRun.output)}</code>
                      </div>

                      <div>
                        <h3 style={{ margin: '4px 0', fontSize: '14px' }}>
                          Execution Trace ({lastSteps.length} steps · {lastLedger.length} ledger rows)
                        </h3>
                        <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                          {lastSteps.map((s) => (
                            <li key={s.id}>
                              <code>#{s.seq} {s.type}</code> — {s.status} ({s.costMicroUsd} micro-USD,{' '}
                              {s.latencyMs}ms)
                            </li>
                          ))}
                        </ul>
                      </div>

                      {savedTestCases.length > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Saved eval test cases: {savedTestCases.length} (full Eval runner unlocks in S1.3)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {studioTab === 'teams' && (
                <div role="tabpanel" aria-label="Team Canvas" style={{ display: 'grid', gap: '14px' }}>
                  <TeamCanvasView
                    client={client}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    environment={environment}
                  />
                </div>
              )}

              {studioTab === 'deployments' && (
                <div role="tabpanel" aria-label="Deployments" style={{ display: 'grid', gap: '14px' }}>
                  <DeploymentsView
                    client={client}
                    subjectType="agent"
                    subjectId={selectedAgent.id}
                    defaultVersionId={selectedAgent.publishedVersion?.id ?? selectedAgent.draftVersion?.id ?? 'agv_1'}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
