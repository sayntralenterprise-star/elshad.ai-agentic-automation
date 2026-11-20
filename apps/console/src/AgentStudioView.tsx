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
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CloudUpload,
  Code2,
  Database,
  FileCheck2,
  GitBranch,
  History,
  Info,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings2,
  Shield,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { AgentsRegistryView } from './AgentsRegistryView.js';
import { DeploymentsView } from './DeploymentsView.js';
import { TeamCanvasView } from './TeamCanvasView.js';

type StudioTab =
  | 'configure'
  | 'tools'
  | 'memory'
  | 'guardrails'
  | 'test'
  | 'evals'
  | 'versions'
  | 'deployments'
  | 'activity'
  | 'teams';

type ConfigureSectionId = 'basic-info' | 'system-prompt' | 'model-routing' | 'reasoning-pattern' | 'limits';
type ReasoningPatternKind = 'react' | 'plan_execute' | 'reflexion' | 'deterministic' | 'custom_code';

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
  ownerName?: string;
}

function formatUsdFromMicro(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

const PROMPT_TEMPLATES: Record<string, string> = {
  support:
    'You are Support Triage, a helpful customer support assistant.\nUse the customer context: {{user.name}} and memory: {{memory.fact}}.\nRoute complex issues to a human agent.\nBe concise and professional.',
  extractor:
    'You are Invoice Extractor. Parse structured line items from documents.\nValidate totals and flag discrepancies above $50 USD.\nNever alter source amounts.',
  research:
    'You are Research Assistant. Query trusted knowledge sources first.\nCite every factual claim using document references.\nSummarize key findings clearly.',
};

export function AgentStudioView({
  client,
  workspaceId,
  projectId,
  environment,
  ownerName = 'Workspace Admin',
}: AgentStudioViewProps) {
  const [viewMode, setViewMode] = useState<'registry' | 'studio'>('registry');
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [toolsCatalog, setToolsCatalog] = useState<ToolContractDto[]>([]);
  const [modelsCatalog, setModelsCatalog] = useState<ModelCapabilityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [studioTab, setStudioTab] = useState<StudioTab>('configure');
  const [activeNavSection, setActiveNavSection] = useState<ConfigureSectionId>('basic-info');
  const [studioEnv, setStudioEnv] = useState<EnvironmentKind>(environment);
  const [consoleExpanded, setConsoleExpanded] = useState(false);

  // Create / Import modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [newName, setNewName] = useState('research-assistant');
  const [newDescription, setNewDescription] = useState('Analyzes operational prompts safely.');
  const [newTier, setNewTier] = useState<'fast' | 'standard' | 'reasoning'>('standard');
  const [newAutonomy, setNewAutonomy] = useState<0 | 1 | 2 | 3>(2);
  const [newSystemPrompt, setNewSystemPrompt] = useState(
    'You are a concise, policy-compliant assistant.',
  );
  const [newSelectedTools, setNewSelectedTools] = useState<string[]>(['current_time']);

  // Screen 03 Draft editor state
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftOwner, setDraftOwner] = useState(ownerName);
  const [draftTags, setDraftTags] = useState<string[]>(['support', 'customer-service', 'triage']);
  const [newTagInput, setNewTagInput] = useState('');
  const [avatarVariant, setAvatarVariant] = useState(0);
  const [draftSemver, setDraftSemver] = useState('1.0.0');
  const [draftAutonomy, setDraftAutonomy] = useState<0 | 1 | 2 | 3 | 4>(2);
  const [draftRiskTier, setDraftRiskTier] = useState<'low' | 'medium' | 'high'>('medium');
  const [draftTier, setDraftTier] = useState<'fast' | 'standard' | 'reasoning'>('standard');
  const [draftModelId, setDraftModelId] = useState('mock/react-default');
  const [draftProvider, setDraftProvider] = useState('mock');
  const [fallbackModels, setFallbackModels] = useState<string[]>([
    'Claude 3.5 Sonnet',
    'Gemini 2.5 Flash',
  ]);
  const [routingCondition, setRoutingCondition] = useState('complex_query');
  const [routingAction, setRoutingAction] = useState('use_primary');
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [modelMaxTokens, setModelMaxTokens] = useState(2048);
  const [structuredOutput, setStructuredOutput] = useState(true);
  const [schemaPreviewOpen, setSchemaPreviewOpen] = useState(false);
  const [reasoningPattern, setReasoningPattern] = useState<ReasoningPatternKind>('react');
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  const [draftMaxSteps, setDraftMaxSteps] = useState(20);
  const [draftMaxTokens, setDraftMaxTokens] = useState(8000);
  const [draftMaxWallTimeMs, setDraftMaxWallTimeMs] = useState(600_000);
  const [draftMaxCostMicroUsd, setDraftMaxCostMicroUsd] = useState(500_000);
  const [draftMaxToolCalls, setDraftMaxToolCalls] = useState(15);
  const [draftDelegationDepth, setDraftDelegationDepth] = useState(2);
  const [draftToolBindings, setDraftToolBindings] = useState<ToolBindingDraft[]>([]);
  const [versionDiff, setVersionDiff] = useState<AgentDiffDto | null>(null);

  // Test Playground state
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
      description?: string;
      autonomy_level?: 0 | 1 | 2 | 3 | 4;
      model?: { tier?: 'fast' | 'standard' | 'reasoning'; provider?: string; model?: string };
      prompt?: { system?: string };
      limits?: {
        max_steps?: number;
        max_tokens?: number;
        max_wall_time_ms?: number;
        max_cost_micro_usd?: number;
        max_tool_calls?: number;
      };
      tools?: Array<{
        tool: string;
        approval?: 'never' | 'auto' | 'always';
        scope?: { allowed_domains?: string[] };
      }>;
    };
    setDraftName(agent.name);
    setDraftDescription(def.description ?? agent.description ?? '');
    setDraftSemver(def.version ?? ver.semver);
    setDraftAutonomy(def.autonomy_level ?? 2);
    setDraftTier(def.model?.tier ?? 'standard');
    setDraftProvider(def.model?.provider ?? 'mock');
    setDraftModelId(def.model?.model ?? 'mock/react-default');
    setDraftSystemPrompt(def.prompt?.system ?? PROMPT_TEMPLATES.support!);
    setDraftMaxSteps(def.limits?.max_steps ?? 20);
    setDraftMaxTokens(def.limits?.max_tokens ?? 8000);
    setDraftMaxWallTimeMs(def.limits?.max_wall_time_ms ?? 600_000);
    setDraftMaxCostMicroUsd(def.limits?.max_cost_micro_usd ?? 500_000);
    setDraftMaxToolCalls(def.limits?.max_tool_calls ?? 15);
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
      setViewMode('studio');
      setStudioTab('configure');
      setNotice(`Created agent "${created.name}" (v1.0.0 draft).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleImportAgent(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const parsed = JSON.parse(importJson) as Record<string, unknown>;
      const created = await client.agents.create(
        { workspaceId, projectId, definition: parsed },
        `ui-agent-import-${Date.now()}`,
      );
      setAgents((prev) => [...prev, created]);
      setSelectedAgentId(created.id);
      syncDraftFromAgent(created);
      setImportOpen(false);
      setViewMode('studio');
      setNotice(`Imported agent "${created.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid agent JSON definition');
    }
  }

  function buildDraftDefinitionPayload(): Record<string, unknown> {
    return {
      kind: 'AgentVersion',
      apiVersion: 'elshad.ai/v1',
      name: draftName.trim() || selectedAgent?.name || 'agent',
      version: draftSemver.trim(),
      description: draftDescription.trim() || selectedAgent?.description || undefined,
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
        max_tokens: draftMaxTokens,
        max_wall_time_ms: draftMaxWallTimeMs,
        max_cost_micro_usd: draftMaxCostMicroUsd,
        max_tool_calls: draftMaxToolCalls,
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
          environment: studioEnv,
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
      setConsoleExpanded(true);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setRunningTest(false);
    }
  }

  function scrollToConfigureSection(id: ConfigureSectionId) {
    setActiveNavSection(id);
    if (typeof document !== 'undefined') {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (loading) {
    return (
      <StateView
        state="loading"
        title="Loading Agents…"
        description="Fetching workspace agents, built-in tool contracts, and registered models."
      />
    );
  }

  const promptLines = Math.max(4, draftSystemPrompt.split('\n').length);
  const estimatedPromptTokens = Math.max(1, Math.round(draftSystemPrompt.length / 4));

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
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

      {/* Create Agent Modal Dialog */}
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
            boxShadow: 'var(--shadow-card)',
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
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
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
                  onChange={(e) => setNewTier(e.target.value as 'fast' | 'standard' | 'reasoning')}
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
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
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
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
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
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
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
              />
            </div>

            <fieldset style={{ border: '1px solid var(--border)', padding: '10px', borderRadius: 'var(--radius-sm)' }}>
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
                color: 'var(--brand-contrast)',
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

      {/* Import Agent Dialog */}
      {importOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Import Agent Definition"
          style={{
            padding: '20px',
            backgroundColor: 'var(--surface)',
            border: '2px solid var(--brand)',
            borderRadius: 'var(--radius-md)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '16px' }}>Import Agent JSON</h2>
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              style={{
                padding: '4px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          <form onSubmit={(e) => void handleImportAgent(e)} style={{ display: 'grid', gap: '10px' }}>
            <textarea
              aria-label="Agent definition JSON"
              rows={5}
              required
              placeholder='{"kind":"AgentVersion","apiVersion":"elshad.ai/v1","name":"imported-agent","version":"1.0.0"}'
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              style={{ width: '100%', padding: '8px', fontFamily: 'var(--font-mono)', border: '1px solid var(--border)' }}
            />
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
                justifySelf: 'start',
                cursor: 'pointer',
              }}
            >
              Import Agent
            </button>
          </form>
        </div>
      )}

      {/* SCREEN 02: AGENTS REGISTRY */}
      {(viewMode === 'registry' || !selectedAgent) && (
        <AgentsRegistryView
          agents={agents}
          environment={environment}
          onCreateClick={() => setCreateOpen(true)}
          onImportClick={() => setImportOpen(true)}
          onOpenAgent={(agent, tab = 'configure') => {
            setSelectedAgentId(agent.id);
            syncDraftFromAgent(agent);
            setStudioTab(tab);
            setViewMode('studio');
          }}
          onDuplicateAgent={(agent) => {
            setNewName(`${agent.name}-copy`);
            setNewDescription(agent.description ?? '');
            setCreateOpen(true);
          }}
        />
      )}

      {/* SCREEN 03: AGENT STUDIO */}
      {viewMode === 'studio' && selectedAgent && (
        <div
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
            display: 'grid',
          }}
        >
          {/* Back Breadcrumb + Header Strip */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setViewMode('registry')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                <span>Agent Studio</span>
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              {/* Agent Avatar + Name + Metadata Pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--lavender)',
                    color: 'var(--brand)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Bot size={22} aria-hidden="true" />
                </span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                      {selectedAgent.name}
                    </h2>
                    <StatusChip
                      label={selectedAgent.status === 'active' ? 'Active' : selectedAgent.status}
                      tone={selectedAgent.status === 'active' ? 'success' : 'neutral'}
                    />
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {selectedAgent.description || 'Configure instructions, tools, model routing and limits.'}
                  </div>
                </div>

                {/* Inline Autonomy / Risk / Version pills */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '6px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface)',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    Autonomy: L{draftAutonomy}
                  </span>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface)',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    Risk: {draftRiskTier}
                  </span>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface)',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    Draft / v{draftSemver}
                  </span>
                </div>
              </div>

              {/* Environment Segment + Test / Save Draft / Diff / Publish */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div
                  role="group"
                  aria-label="Studio environment"
                  style={{
                    display: 'inline-flex',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    padding: '2px',
                    backgroundColor: 'var(--surface-raised)',
                  }}
                >
                  {(['dev', 'staging', 'prod'] as const).map((envKey) => (
                    <button
                      key={envKey}
                      type="button"
                      onClick={() => setStudioEnv(envKey)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: studioEnv === envKey ? 'var(--brand)' : 'transparent',
                        color: studioEnv === envKey ? 'var(--brand-contrast)' : 'var(--text-secondary)',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {envKey === 'dev' ? 'Dev' : envKey === 'staging' ? 'Staging' : 'Prod'}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setStudioTab('test')}
                  style={{
                    minHeight: '32px',
                    padding: '4px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                  }}
                >
                  <Play size={13} aria-hidden="true" />
                  <span>Quick Test</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveDraft()}
                  style={{
                    minHeight: '32px',
                    padding: '4px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                  }}
                >
                  <Save size={13} aria-hidden="true" />
                  <span>Save Draft</span>
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
                      fontWeight: 600,
                      fontSize: '12.5px',
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
                    padding: '4px 14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: 'var(--brand-contrast)',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    cursor: selectedAgent.draftVersion ? 'pointer' : 'not-allowed',
                    opacity: selectedAgent.draftVersion ? 1 : 0.6,
                  }}
                >
                  <Rocket size={13} aria-hidden="true" />
                  <span>Publish</span>
                </button>
              </div>
            </div>

            {/* Studio Horizontal Tabs (03–11 + Team Canvas) */}
            <div
              role="tablist"
              aria-label="Agent Studio Sections"
              style={{
                display: 'flex',
                gap: '6px',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '10px',
                overflowX: 'auto',
              }}
            >
              {(
                [
                  { id: 'configure', label: 'Configure', icon: Settings2 },
                  { id: 'tools', label: 'Tools', icon: Wrench },
                  { id: 'memory', label: 'Memory', icon: Database },
                  { id: 'guardrails', label: 'Guardrails', icon: Shield },
                  { id: 'test', label: 'Test', icon: Play },
                  { id: 'evals', label: 'Evals', icon: FileCheck2 },
                  { id: 'versions', label: 'Versions', icon: History },
                  { id: 'deployments', label: 'Deployments', icon: CloudUpload },
                  { id: 'activity', label: 'Activity', icon: Activity },
                  { id: 'teams', label: 'Team Canvas', icon: GitBranch },
                ] as const
              ).map((tabDef) => {
                const TabIcon = tabDef.icon;
                const active = studioTab === tabDef.id;
                return (
                  <button
                    key={tabDef.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setStudioTab(tabDef.id)}
                    style={{
                      minHeight: '34px',
                      padding: '6px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
                      backgroundColor: active ? 'var(--lavender-soft)' : 'transparent',
                      color: active ? 'var(--brand)' : 'var(--text-secondary)',
                      fontWeight: active ? 600 : 500,
                      fontSize: '13px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <TabIcon size={14} aria-hidden="true" />
                    <span>{tabDef.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {versionDiff && (
            <div
              style={{
                margin: '12px 20px 0 20px',
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

          {/* TAB: CONFIGURE (3-Column Layout matching Image 1) */}
          {studioTab === 'configure' && (
            <div
              role="tabpanel"
              aria-label="Configure Agent"
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 276px',
                gap: '16px',
                padding: '18px 20px',
                backgroundColor: 'var(--bg)',
                alignItems: 'start',
              }}
            >
              {/* Left Mini-Nav */}
              <nav aria-label="Configure sections" style={{ display: 'grid', gap: '4px' }}>
                {(
                  [
                    { id: 'basic-info', label: 'Basic info', icon: Info },
                    { id: 'system-prompt', label: 'System prompt', icon: Code2 },
                    { id: 'model-routing', label: 'Model & routing', icon: Sparkles },
                    { id: 'reasoning-pattern', label: 'Reasoning pattern', icon: GitBranch },
                    { id: 'limits', label: 'Limits', icon: Shield },
                  ] as const
                ).map((item) => {
                  const NavIcon = item.icon;
                  const active = activeNavSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToConfigureSection(item.id)}
                      style={{
                        minHeight: '34px',
                        padding: '6px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderRadius: 'var(--radius-sm)',
                        border: active ? '1px solid var(--lavender-border)' : '1px solid transparent',
                        backgroundColor: active ? 'var(--lavender)' : 'transparent',
                        color: active ? 'var(--brand)' : 'var(--text-secondary)',
                        fontWeight: active ? 600 : 500,
                        fontSize: '12.5px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <NavIcon size={14} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Center Configuration Cards */}
              <div style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
                {/* 1. Basic Information Card */}
                <section
                  id="basic-info"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'grid',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>Basic information</h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Set the identity and purpose of your agent.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr 1fr', gap: '12px', alignItems: 'start' }}>
                    <div style={{ display: 'grid', gap: '6px', justifyItems: 'center' }}>
                      <div
                        style={{
                          width: '72px',
                          height: '72px',
                          borderRadius: '10px',
                          backgroundColor: avatarVariant % 2 === 0 ? 'var(--lavender)' : 'var(--info-bg)',
                          color: 'var(--brand)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid var(--lavender-border)',
                        }}
                      >
                        <Bot size={28} aria-hidden="true" />
                      </div>
                      <button
                        type="button"
                        onClick={() => setAvatarVariant((v) => v + 1)}
                        style={{
                          width: '72px',
                          minHeight: '26px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--surface)',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Change
                      </button>
                    </div>

                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <label htmlFor="studio-agent-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                          Name *
                        </label>
                        <input
                          id="studio-agent-name"
                          type="text"
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        />
                      </div>
                      <div>
                        <label htmlFor="studio-semver" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                          Version (semver)
                        </label>
                        <input
                          id="studio-semver"
                          type="text"
                          value={draftSemver}
                          onChange={(e) => setDraftSemver(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <label htmlFor="studio-owner" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                          Owner
                        </label>
                        <input
                          id="studio-owner"
                          type="text"
                          value={draftOwner}
                          onChange={(e) => setDraftOwner(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        />
                      </div>
                      <div>
                        <label htmlFor="studio-description" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                          Description * ({draftDescription.length}/500)
                        </label>
                        <input
                          id="studio-description"
                          type="text"
                          maxLength={500}
                          value={draftDescription}
                          onChange={(e) => setDraftDescription(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Tags row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Tags</span>
                    {draftTags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          backgroundColor: 'var(--lavender)',
                          color: 'var(--brand)',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {tag}
                        <button
                          type="button"
                          aria-label={`Remove tag ${tag}`}
                          onClick={() => setDraftTags((prev) => prev.filter((x) => x !== tag))}
                          style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                        >
                          <X size={11} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      aria-label="Add tag"
                      placeholder="Add tag..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTagInput.trim()) {
                          e.preventDefault();
                          const next = newTagInput.trim();
                          if (!draftTags.includes(next)) {
                            setDraftTags((prev) => [...prev, next]);
                          }
                          setNewTagInput('');
                        }
                      }}
                      style={{
                        border: '1px dashed var(--border)',
                        borderRadius: '9999px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        width: '96px',
                      }}
                    />
                  </div>
                </section>

                {/* 2. System Prompt Card (Obsidian #17172B Code Surface) */}
                <section
                  id="system-prompt"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'grid',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>System Prompt</h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Define how the agent should behave and respond.
                      </p>
                    </div>
                    <select
                      aria-label="Use Template"
                      defaultValue=""
                      onChange={(e) => {
                        const tpl = PROMPT_TEMPLATES[e.target.value];
                        if (tpl) setDraftSystemPrompt(tpl);
                      }}
                      style={{
                        minHeight: '30px',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        fontSize: '12px',
                      }}
                    >
                      <option value="">Use Template</option>
                      <option value="support">Support Triage Template</option>
                      <option value="extractor">Invoice Extractor Template</option>
                      <option value="research">Research Assistant Template</option>
                    </select>
                  </div>

                  {/* Obsidian Code Editor */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '34px 1fr',
                      backgroundColor: 'var(--obsidian)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      border: '1px solid var(--obsidian-surface)',
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        padding: '10px 6px',
                        backgroundColor: 'var(--obsidian-surface)',
                        color: '#7E84A3',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        lineHeight: 1.55,
                        textAlign: 'right',
                        userSelect: 'none',
                      }}
                    >
                      {Array.from({ length: promptLines }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                    <textarea
                      id="studio-system-prompt"
                      aria-label="System Prompt"
                      rows={5}
                      value={draftSystemPrompt}
                      onChange={(e) => setDraftSystemPrompt(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: 'var(--obsidian-text)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12.5px',
                        lineHeight: 1.55,
                        resize: 'vertical',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                      ✓ No issues found
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {estimatedPromptTokens} tokens
                    </span>
                  </div>
                </section>

                {/* 3. Model & Routing Card */}
                <section
                  id="model-routing"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'grid',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>Model &amp; Routing</h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Choose the best model and set fallback strategy.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', alignItems: 'start' }}>
                    <div>
                      <label htmlFor="studio-model" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                        Primary Model
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
                        style={{
                          width: '100%',
                          padding: '8px',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        {modelsCatalog.map((m) => (
                          <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
                            {m.displayName} ({m.tier})
                          </option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <StatusChip label="High Quality" tone="success" />
                        <StatusChip label="$2.00 / 1M tokens" tone="info" />
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Fallback Chain</div>
                      <div style={{ display: 'grid', gap: '4px' }}>
                        {fallbackModels.map((fb, idx) => (
                          <div
                            key={fb}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '5px 8px',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '12px',
                            }}
                          >
                            <span>
                              {idx + 1}. {fb}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove fallback ${fb}`}
                              onClick={() =>
                                setFallbackModels((prev) => prev.filter((item) => item !== fb))
                              }
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setFallbackModels((prev) =>
                              prev.includes('GPT-4o mini') ? prev : [...prev, 'GPT-4o mini'],
                            )
                          }
                          style={{
                            justifySelf: 'start',
                            background: 'none',
                            border: 'none',
                            color: 'var(--brand)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            padding: '2px 0',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Plus size={12} aria-hidden="true" />
                          <span>Add Fallback</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Routing Rule</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>IF</span>
                        <select
                          aria-label="Routing condition"
                          value={routingCondition}
                          onChange={(e) => setRoutingCondition(e.target.value)}
                          style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                        >
                          <option value="complex_query">complex_query</option>
                          <option value="high_risk">high_risk</option>
                        </select>
                        <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>THEN</span>
                        <select
                          aria-label="Routing action"
                          value={routingAction}
                          onChange={(e) => setRoutingAction(e.target.value)}
                          style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                        >
                          <option value="use_primary">use_primary</option>
                          <option value="use_fallback">use_fallback</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Parameters row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                      paddingTop: '10px',
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: '12px',
                    }}
                  >
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span>Temperature</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={temperature}
                        onChange={(e) => setTemperature(Number(e.target.value))}
                        style={{ width: '58px', padding: '4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                      />
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span>Top-p</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={topP}
                        onChange={(e) => setTopP(Number(e.target.value))}
                        style={{ width: '58px', padding: '4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                      />
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span>Max Tokens</span>
                      <input
                        type="number"
                        value={modelMaxTokens}
                        onChange={(e) => setModelMaxTokens(Number(e.target.value))}
                        style={{ width: '74px', padding: '4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                      />
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={structuredOutput}
                        onChange={(e) => setStructuredOutput(e.target.checked)}
                      />
                      <span>Structured Output</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setSchemaPreviewOpen((v) => !v)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--surface-raised)',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      &lt;/&gt; Schema
                    </button>
                  </div>

                  {schemaPreviewOpen && (
                    <pre
                      style={{
                        margin: 0,
                        padding: '10px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--obsidian)',
                        color: 'var(--obsidian-text)',
                        fontSize: '11.5px',
                        overflowX: 'auto',
                      }}
                    >
                      {JSON.stringify(
                        {
                          type: 'object',
                          properties: {
                            answer: { type: 'string' },
                            confidence: { type: 'number' },
                            escalate: { type: 'boolean' },
                          },
                          required: ['answer'],
                        },
                        null,
                        2,
                      )}
                    </pre>
                  )}
                </section>

                {/* 4. Reasoning Pattern Card */}
                <section
                  id="reasoning-pattern"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'grid',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>Reasoning Pattern</h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Choose a reasoning approach for this agent.
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '9999px',
                        backgroundColor: 'var(--lavender)',
                        color: 'var(--brand)',
                        fontSize: '11.5px',
                        fontWeight: 600,
                      }}
                    >
                      Recommended for support agents
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                    {(
                      [
                        { id: 'react', title: 'ReAct', desc: 'Think, act, repeat' },
                        { id: 'plan_execute', title: 'Plan-and-Execute', desc: 'Plan tasks first' },
                        { id: 'reflexion', title: 'Reflexion', desc: 'Learn from feedback' },
                        { id: 'deterministic', title: 'Deterministic Flow', desc: 'Follow a fixed plan' },
                        { id: 'custom_code', title: 'Custom Code', desc: 'Write your own logic' },
                      ] as const
                    ).map((pat) => {
                      const active = reasoningPattern === pat.id;
                      return (
                        <button
                          key={pat.id}
                          type="button"
                          onClick={() => setReasoningPattern(pat.id)}
                          style={{
                            padding: '10px',
                            borderRadius: 'var(--radius-sm)',
                            border: active ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                            backgroundColor: active ? 'var(--lavender-soft)' : 'var(--surface)',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'grid',
                            gap: '4px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <RefreshCw size={14} style={{ color: active ? 'var(--brand)' : 'var(--text-muted)' }} aria-hidden="true" />
                            {active && <CheckCircle2 size={14} style={{ color: 'var(--brand)' }} aria-hidden="true" />}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
                            {pat.title}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{pat.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Right Sidebar: Safety Configuration & Limits */}
              <aside
                id="limits"
                aria-label="Safety Configuration"
                style={{
                  backgroundColor: 'var(--lavender-soft)',
                  border: '1px solid var(--lavender-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--lavender)',
                      color: 'var(--brand)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Shield size={15} aria-hidden="true" />
                  </span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Safety Configuration</h3>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      Control how the agent operates.
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="studio-autonomy" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Autonomy Level
                  </label>
                  <select
                    id="studio-autonomy"
                    value={String(draftAutonomy)}
                    onChange={(e) => setDraftAutonomy(Number(e.target.value) as 0 | 1 | 2 | 3 | 4)}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  >
                    <option value="0">L0 — Advisory</option>
                    <option value="1">L1 — Assisted</option>
                    <option value="2">L2 — Supervised</option>
                    <option value="3">L3 — Autonomous</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="studio-risk-tier" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Risk Tier
                  </label>
                  <select
                    id="studio-risk-tier"
                    value={draftRiskTier}
                    onChange={(e) => setDraftRiskTier(e.target.value as 'low' | 'medium' | 'high')}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="studio-max-steps" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Max Steps
                  </label>
                  <input
                    id="studio-max-steps"
                    type="number"
                    value={draftMaxSteps}
                    onChange={(e) => setDraftMaxSteps(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="studio-max-tokens" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Max Tokens
                  </label>
                  <input
                    id="studio-max-tokens"
                    type="number"
                    value={draftMaxTokens}
                    onChange={(e) => setDraftMaxTokens(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="studio-max-cost" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Cost Ceiling (micro-USD)
                  </label>
                  <input
                    id="studio-max-cost"
                    type="number"
                    value={draftMaxCostMicroUsd}
                    onChange={(e) => setDraftMaxCostMicroUsd(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="studio-max-tool-calls" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Max Tool Calls
                  </label>
                  <input
                    id="studio-max-tool-calls"
                    type="number"
                    value={draftMaxToolCalls}
                    onChange={(e) => setDraftMaxToolCalls(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="studio-delegation-depth" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Delegation Depth
                  </label>
                  <input
                    id="studio-delegation-depth"
                    type="number"
                    value={draftDelegationDepth}
                    onChange={(e) => setDraftDelegationDepth(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '7px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                    }}
                  />
                </div>

                <div
                  style={{
                    marginTop: '4px',
                    padding: '10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--warning-bg)',
                    border: '1px solid var(--warning)',
                    fontSize: '11.5px',
                    color: 'var(--warning)',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                  }}
                >
                  <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                  <div>
                    Unlimited limits can increase costs and risks.
                  </div>
                </div>
              </aside>
            </div>
          )}

          {/* TAB: TOOLS */}
          {studioTab === 'tools' && (
            <div role="tabpanel" aria-label="Agent Tools" style={{ padding: '18px 20px', display: 'grid', gap: '12px' }}>
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

          {/* TAB: MEMORY */}
          {studioTab === 'memory' && (
            <div role="tabpanel" aria-label="Agent Memory" style={{ padding: '18px 20px', display: 'grid', gap: '12px' }}>
              <StateView
                state="empty"
                title="Agent Memory & Knowledge Scopes"
                description="Configure Run, Session, User, Agent, Project, and Org memory scopes and Top-K Knowledge Base retrieval."
              />
            </div>
          )}

          {/* TAB: GUARDRAILS */}
          {studioTab === 'guardrails' && (
            <div role="tabpanel" aria-label="Agent Guardrails" style={{ padding: '18px 20px', display: 'grid', gap: '12px' }}>
              <StateView
                state="empty"
                title="Input, Output & Tool Guardrails"
                description="Configure PII redaction, prompt injection screening, schema validation, and escalation triggers."
              />
            </div>
          )}

          {/* TAB: TEST PLAYGROUND */}
          {studioTab === 'test' && (
            <div role="tabpanel" aria-label="Test Playground" style={{ padding: '18px 20px', display: 'grid', gap: '14px' }}>
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
                    style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
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
                      color: 'var(--brand-contrast)',
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
                    <strong>Output:</strong> <code>{JSON.stringify(lastRun.output)}</code>
                  </div>

                  <div>
                    <h3 style={{ margin: '4px 0', fontSize: '14px' }}>
                      Execution Trace ({lastSteps.length} steps · {lastLedger.length} ledger rows)
                    </h3>
                    <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                      {lastSteps.map((s) => (
                        <li key={s.id}>
                          <code>
                            #{s.seq} {s.type}
                          </code>{' '}
                          — {s.status} ({s.costMicroUsd} micro-USD, {s.latencyMs}ms)
                        </li>
                      ))}
                    </ul>
                  </div>

                  {savedTestCases.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Saved eval test cases: {savedTestCases.length}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: EVALS */}
          {studioTab === 'evals' && (
            <div role="tabpanel" aria-label="Agent Evals" style={{ padding: '18px 20px' }}>
              <StateView
                state="empty"
                title="Agent Evaluation Scorecards"
                description="Run golden-set experiments in the Evaluations workspace to gate staging and production promotions."
              />
            </div>
          )}

          {/* TAB: VERSIONS */}
          {studioTab === 'versions' && (
            <div role="tabpanel" aria-label="Agent Versions" style={{ padding: '18px 20px', display: 'grid', gap: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '15px' }}>Version History ({selectedAgent.versions.length})</h3>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '6px' }}>
                {selectedAgent.versions.map((v) => (
                  <li key={v.id} style={{ fontSize: '13px' }}>
                    <strong>v{v.semver}</strong> ({v.state}) — {v.message ?? 'Draft version'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* TAB: TEAM CANVAS */}
          {studioTab === 'teams' && (
            <div role="tabpanel" aria-label="Team Canvas" style={{ padding: '18px 20px', display: 'grid', gap: '14px' }}>
              <TeamCanvasView
                client={client}
                workspaceId={workspaceId}
                projectId={projectId}
                environment={environment}
              />
            </div>
          )}

          {/* TAB: DEPLOYMENTS */}
          {studioTab === 'deployments' && (
            <div role="tabpanel" aria-label="Deployments" style={{ padding: '18px 20px', display: 'grid', gap: '14px' }}>
              <DeploymentsView
                client={client}
                subjectType="agent"
                subjectId={selectedAgent.id}
                defaultVersionId={
                  selectedAgent.publishedVersion?.id ?? selectedAgent.draftVersion?.id ?? 'agv_1'
                }
              />
            </div>
          )}

          {/* TAB: ACTIVITY */}
          {studioTab === 'activity' && (
            <div role="tabpanel" aria-label="Agent Activity" style={{ padding: '18px 20px' }}>
              <StateView
                state="empty"
                title="Agent Activity Timeline"
                description="Version updates, deployments, runs, and approval events for this agent appear here."
              />
            </div>
          )}

          {/* Bottom Collapsible Run Console Strip (Image 1) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 18px',
              borderTop: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              fontSize: '12.5px',
            }}
          >
            <button
              type="button"
              onClick={() => setConsoleExpanded((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>{consoleExpanded ? '▾' : '‹'}</span>
              <span style={{ color: 'var(--success)' }}>●</span>
              <span>Live logs / Test output / Run console</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>● Ready to test</span>
              <button
                type="button"
                aria-label="Open test console and run"
                onClick={() => setStudioTab('test')}
                style={{
                  minHeight: '30px',
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--brand)',
                  color: 'var(--brand-contrast)',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Run Test ▷
              </button>
            </div>
          </div>

          {consoleExpanded && (
            <div
              style={{
                padding: '10px 18px',
                backgroundColor: 'var(--obsidian)',
                color: 'var(--obsidian-text)',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
              }}
            >
              {lastRun
                ? `[${lastRun.id}] ${lastRun.status} — ${lastSteps.length} step(s), ${lastRun.usage.tokensIn + lastRun.usage.tokensOut} tokens`
                : 'Console ready. Use the Test tab to run the agent against the selected environment.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
