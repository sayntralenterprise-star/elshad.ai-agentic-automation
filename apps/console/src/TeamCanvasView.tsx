import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { type EnvironmentKind } from '@elshad/domain';
import {
  type PlatformClient,
  type TeamDto,
  type TeamSimulationDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Layers,
  Network,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Split,
  Table,
  Zap,
} from 'lucide-react';

export interface TeamCanvasViewProps {
  client: PlatformClient;
  workspaceId?: string;
  projectId?: string;
  environment: EnvironmentKind;
}

function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(6)}`;
}

export function TeamCanvasView({
  client,
  workspaceId: _workspaceId,
  projectId: _projectId,
  environment: _environment,
}: TeamCanvasViewProps) {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Inspector selection
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Simulation state
  const [simulationPrompt, setSimulationPrompt] = useState(
    'Enterprise customer billing tier downgrade and dispute investigation.',
  );
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<TeamSimulationDto | null>(null);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number>(-1);
  const [isPlayingAnimation, setIsPlayingAnimation] = useState(false);

  // Create team modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('Customer Support Swarm');
  const [newTeamDescription, setNewTeamDescription] = useState(
    'Supervisor orchestrating triage, identity verification, and billing specialists.',
  );

  const loadTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await client.teams.list();
      setTeams(list);
      if (list.length > 0 && !selectedTeamId) {
        setSelectedTeamId(list[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, selectedTeamId]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedTeamId) ?? teams[0] ?? null,
    [teams, selectedTeamId],
  );

  const supervisorMember = useMemo(
    () => selectedTeam?.members.find((m) => m.role === 'supervisor') ?? null,
    [selectedTeam],
  );

  const specialistMembers = useMemo(
    () => selectedTeam?.members.filter((m) => m.role === 'specialist') ?? [],
    [selectedTeam],
  );

  const selectedMember = useMemo(
    () => selectedTeam?.members.find((m) => m.id === selectedMemberId) ?? null,
    [selectedTeam, selectedMemberId],
  );

  const selectedEdge = useMemo(
    () => selectedTeam?.handoffs.find((h) => h.id === selectedEdgeId) ?? null,
    [selectedTeam, selectedEdgeId],
  );

  // Animation player for message replay
  useEffect(() => {
    if (!isPlayingAnimation || !simulationResult || simulationResult.messages.length === 0) {
      return;
    }
    const interval = setInterval(() => {
      setActiveMessageIndex((prev) => {
        if (prev + 1 >= simulationResult.messages.length) {
          setIsPlayingAnimation(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [isPlayingAnimation, simulationResult]);

  const handleCreateStarterTeam = async () => {
    try {
      setLoading(true);
      setError(null);
      const created = await client.teams.create({
        name: newTeamName,
        description: newTeamDescription,
        pattern: 'supervisor_specialists',
        supervisorAgentId: 'agent_supervisor',
        members: [
          {
            agentId: 'agent_supervisor',
            role: 'supervisor',
            maxSteps: 25,
            timeoutSeconds: 60,
            maxSpendMicroUsd: 1_000_000,
            readKeys: ['*'],
            writeKeys: ['*'],
          },
          {
            agentId: 'agent_triage',
            role: 'specialist',
            maxSteps: 10,
            timeoutSeconds: 30,
            maxSpendMicroUsd: 100_000,
            readKeys: ['ticket_id', 'customer_id'],
            writeKeys: ['triage_assessment', 'priority'],
          },
          {
            agentId: 'agent_auth',
            role: 'specialist',
            maxSteps: 10,
            timeoutSeconds: 30,
            maxSpendMicroUsd: 100_000,
            readKeys: ['customer_id', 'triage_assessment'],
            writeKeys: ['auth_verified', 'risk_score'],
          },
          {
            agentId: 'agent_billing',
            role: 'specialist',
            maxSteps: 10,
            timeoutSeconds: 30,
            maxSpendMicroUsd: 200_000,
            readKeys: ['customer_id', 'auth_verified', 'triage_assessment'],
            writeKeys: ['refund_issued_micro_usd', 'resolution_summary'],
          },
        ],
        handoffs: [
          {
            fromAgentId: 'agent_supervisor',
            toAgentId: 'agent_triage',
            name: 'Triage Handoff Contract',
            description: 'Severity analysis and customer categorization',
            handoffSchema: {
              goal: 'Analyze support ticket severity, categorize issue, and extract customer identity',
              context_summary: 'Customer submitted an enterprise billing dispute ticket',
              artifacts: ['raw_ticket_text'],
              constraints: ['response_must_be_structured_json', 'p0_triage_under_5_seconds'],
            },
            returnSchema: {
              type: 'object',
              required: ['triage_assessment', 'priority'],
              properties: {
                triage_assessment: { type: 'string' },
                priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
              },
            },
          },
          {
            fromAgentId: 'agent_supervisor',
            toAgentId: 'agent_auth',
            name: 'Auth Handoff Contract',
            description: 'Account ownership and permission validation',
            handoffSchema: {
              goal: 'Verify account ownership and validate API key permissions',
              context_summary: 'Customer claims enterprise plan ownership',
              artifacts: ['customer_id', 'triage_assessment'],
              constraints: ['mfa_or_active_session_required'],
            },
            returnSchema: {
              type: 'object',
              required: ['auth_verified', 'risk_score'],
              properties: {
                auth_verified: { type: 'boolean' },
                risk_score: { type: 'number' },
              },
            },
          },
          {
            fromAgentId: 'agent_supervisor',
            toAgentId: 'agent_billing',
            name: 'Billing Handoff Contract',
            description: 'Ledger inspection and refund adjustments',
            handoffSchema: {
              goal: 'Inspect billing ledgers, verify plan pricing, and compute refund adjustments',
              context_summary: 'Identity verified and issue classified as billing discrepancy',
              artifacts: ['customer_id', 'auth_verified'],
              constraints: ['max_instant_refund_usd_500'],
            },
            returnSchema: {
              type: 'object',
              required: ['refund_issued_micro_usd', 'resolution_summary'],
              properties: {
                refund_issued_micro_usd: { type: 'number' },
                resolution_summary: { type: 'string' },
              },
            },
          },
        ],
      });
      setTeams((prev) => [created, ...prev]);
      setSelectedTeamId(created.id);
      setCreateModalOpen(false);
      setNotice(`Created multi-agent team: ${created.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRunSimulation = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedTeam) return;

    try {
      setSimulating(true);
      setError(null);
      setNotice(null);
      setSelectedMemberId(null);
      setSelectedEdgeId(null);
      const res = await client.teams.simulate(selectedTeam.id, {
        input: { prompt: simulationPrompt },
        initialBlackboard: {
          customer_id: 'cust_enterprise_4091',
          ticket_id: 'tkt_882194',
        },
      });
      setSimulationResult(res);
      setActiveMessageIndex(0);
      setIsPlayingAnimation(true);
      setNotice(`Simulation completed with ${res.childRuns.length} child runs.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* Top Banner / Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Network size={24} aria-hidden="true" style={{ color: 'var(--brand)' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Team Canvas</h1>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
              Multi-agent supervisor &amp; specialists topology, typed handoffs, and blackboard inspector.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusChip label="FR-RT-23 Max Depth: 3" tone="info" />
          <StatusChip label="FR-RT-24 Max Fan-out: 8" tone="info" />
          <StatusChip label="Typed Handoffs: Strict" tone="success" />

          <button
            type="button"
            onClick={() => void loadTeams()}
            aria-label="Refresh teams"
            style={{
              minHeight: '34px',
              padding: '6px 10px',
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

          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            style={{
              minHeight: '34px',
              padding: '6px 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--brand)',
              color: 'var(--brand-contrast)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Plus size={16} aria-hidden="true" />
            New Team
          </button>
        </div>
      </div>

      {notice && <SuccessNotice message={notice} />}

      {error && (
        <StateView
          state="error"
          title="Team Canvas Error"
          description={error}
          actionLabel="Dismiss"
          onAction={() => setError(null)}
        />
      )}

      {/* Team Selector & Simulation Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label htmlFor="team-select" style={{ fontSize: '13px', fontWeight: 600 }}>
            Active Team:
          </label>
          {teams.length > 0 ? (
            <select
              id="team-select"
              value={selectedTeamId ?? ''}
              onChange={(e) => {
                setSelectedTeamId(e.target.value);
                setSelectedMemberId(null);
                setSelectedEdgeId(null);
                setSimulationResult(null);
              }}
              style={{
                minHeight: '34px',
                padding: '4px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                fontWeight: 600,
              }}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.pattern})
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              No teams found.{' '}
              <button
                type="button"
                onClick={() => void handleCreateStarterTeam()}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--brand)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                  font: 'inherit',
                }}
              >
                Create starter Benchmark Swarm
              </button>
            </span>
          )}
        </div>

        {selectedTeam && (
          <form
            onSubmit={(e) => void handleRunSimulation(e)}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, justifyContent: 'flex-end' }}
          >
            <label htmlFor="simulation-prompt-input" style={{ position: 'absolute', left: '-9999px' }}>
              Simulation Prompt
            </label>
            <input
              id="simulation-prompt-input"
              type="text"
              value={simulationPrompt}
              onChange={(e) => setSimulationPrompt(e.target.value)}
              placeholder="Task prompt for team simulation..."
              style={{
                minHeight: '34px',
                minWidth: '280px',
                maxWidth: '450px',
                flex: 1,
                padding: '6px 12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg)',
                color: 'var(--text-primary)',
                fontSize: '13px',
              }}
            />
            <button
              type="submit"
              disabled={simulating}
              style={{
                minHeight: '34px',
                padding: '6px 14px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: simulating ? 'var(--surface-raised)' : 'var(--brand)',
                color: simulating ? 'var(--text-secondary)' : 'var(--brand-contrast)',
                fontWeight: 600,
                cursor: simulating ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Play size={14} aria-hidden="true" />
              {simulating ? 'Simulating...' : 'Run Simulation'}
            </button>
          </form>
        )}
      </div>

      {loading && !selectedTeam && (
        <StateView
          state="loading"
          title="Loading Team Topology"
          description="Fetching supervisor and specialist nodes..."
        />
      )}

      {/* Main Canvas + Inspector Grid */}
      {selectedTeam && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 340px',
            gap: '20px',
            alignItems: 'start',
          }}
        >
          {/* Visual Canvas Area */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              minHeight: '520px',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={18} aria-hidden="true" style={{ color: 'var(--brand)' }} />
                <strong style={{ fontSize: '15px' }}>{selectedTeam.name}</strong>
                <StatusChip label={selectedTeam.pattern} tone="info" />
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {selectedTeam.members.length} Agents &bull; {selectedTeam.handoffs.length} Typed Handoffs
              </div>
            </div>

            {/* Topology Graph Container */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'space-around',
                gap: '40px',
                padding: '10px 0',
              }}
            >
              {/* Supervisor Node */}
              {supervisorMember && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedMemberId(supervisorMember.id);
                    setSelectedEdgeId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedMemberId(supervisorMember.id);
                      setSelectedEdgeId(null);
                    }
                  }}
                  aria-label={`Supervisor node: ${supervisorMember.agentId}`}
                  style={{
                    width: '320px',
                    padding: '14px 18px',
                    backgroundColor:
                      selectedMemberId === supervisorMember.id
                        ? 'var(--info-bg)'
                        : 'var(--surface-raised)',
                    border:
                      selectedMemberId === supervisorMember.id
                        ? '2px solid var(--brand)'
                        : '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    display: 'grid',
                    gap: '8px',
                    zIndex: 2,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Bot size={20} aria-hidden="true" style={{ color: 'var(--brand)' }} />
                      <strong style={{ fontSize: '14px' }}>{supervisorMember.agentId}</strong>
                    </div>
                    <StatusChip label="Supervisor" tone="info" />
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span>Max steps: {supervisorMember.maxSteps}</span>
                    <span>&bull;</span>
                    <span>Spend cap: {formatUsd(supervisorMember.maxSpendMicroUsd)}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
                    <span style={{ padding: '2px 6px', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      Read: all
                    </span>
                    <span style={{ padding: '2px 6px', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      Write: all
                    </span>
                  </div>
                </div>
              )}

              {/* Edge connectors / Handoff Badges */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-around',
                  width: '100%',
                  gap: '12px',
                  position: 'relative',
                }}
              >
                {selectedTeam.handoffs.map((handoff, idx) => {
                  const isEdgeSelected = selectedEdgeId === handoff.id;
                  const isActiveMessageEdge =
                    simulationResult &&
                    activeMessageIndex >= 0 &&
                    simulationResult.messages[activeMessageIndex]?.receiverAgentId === handoff.toAgentId;

                  return (
                    <button
                      key={handoff.id || idx}
                      type="button"
                      onClick={() => {
                        setSelectedEdgeId(handoff.id);
                        setSelectedMemberId(null);
                      }}
                      aria-label={`Typed handoff edge to ${handoff.toAgentId}`}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: isEdgeSelected
                          ? '2px solid var(--brand)'
                          : isActiveMessageEdge
                            ? '2px solid var(--success)'
                            : '1px dashed var(--border)',
                        backgroundColor: isActiveMessageEdge
                          ? 'var(--success-bg)'
                          : isEdgeSelected
                            ? 'var(--info-bg)'
                            : 'var(--surface-raised)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <Split size={12} aria-hidden="true" />
                      <span>
                        Handoff: <strong>{handoff.name}</strong>
                      </span>
                      {isActiveMessageEdge && (
                        <Zap size={12} style={{ color: 'var(--success)' }} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Specialist Nodes Row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.max(1, specialistMembers.length)}, 1fr)`,
                  gap: '16px',
                  width: '100%',
                }}
              >
                {specialistMembers.map((spec) => {
                  const isSelected = selectedMemberId === spec.id;
                  const isSimulatingActive =
                    simulationResult &&
                    activeMessageIndex >= 0 &&
                    simulationResult.messages[activeMessageIndex]?.receiverAgentId === spec.agentId;

                  return (
                    <div
                      key={spec.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedMemberId(spec.id);
                        setSelectedEdgeId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedMemberId(spec.id);
                          setSelectedEdgeId(null);
                        }
                      }}
                      aria-label={`Specialist node: ${spec.agentId}`}
                      style={{
                        padding: '12px 14px',
                        backgroundColor: isSelected
                          ? 'var(--info-bg)'
                          : isSimulatingActive
                            ? 'var(--success-bg)'
                            : 'var(--surface-raised)',
                        border: isSelected
                          ? '2px solid var(--brand)'
                          : isSimulatingActive
                            ? '2px solid var(--success)'
                            : '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <strong style={{ fontSize: '13px' }}>{spec.agentId}</strong>
                        <StatusChip label="Specialist" tone="neutral" />
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Steps: {spec.maxSteps} &bull; Timeout: {spec.timeoutSeconds}s
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Spend: {formatUsd(spec.maxSpendMicroUsd)}
                      </div>

                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {spec.writeKeys.map((k: string) => (
                          <span
                            key={k}
                            style={{
                              fontSize: '10px',
                              fontFamily: 'var(--font-mono)',
                              padding: '1px 5px',
                              backgroundColor: 'var(--surface)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            +{k}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Blackboard State Inspector (Bottom of Canvas) */}
            <div
              style={{
                marginTop: '20px',
                borderTop: '1px solid var(--border)',
                paddingTop: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Table size={16} aria-hidden="true" style={{ color: 'var(--brand)' }} />
                  <strong style={{ fontSize: '13px' }}>Shared Run Blackboard (FR-RT-22)</strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    CAS Concurrency: <strong>Active</strong>
                  </span>
                  <StatusChip
                    label={`CAS Version: v${simulationResult?.blackboard.version ?? 1}`}
                    tone="info"
                  />
                </div>
              </div>

              {simulationResult ? (
                <div
                  style={{
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    overflowX: 'auto',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>Key</th>
                        <th style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>Current Value</th>
                        <th style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>Scope Enforcement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(simulationResult.blackboard.state).map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {k}
                          </td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)' }}>
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={12} /> Scoped OK
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                  }}
                >
                  Run simulation above to inspect live blackboard reads, writes, and optimistic CAS versions.
                </div>
              )}
            </div>
          </div>

          {/* Right Inspector Panel */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '18px',
              display: 'grid',
              gap: '16px',
            }}
          >
            {/* Edge Inspector (Typed Handoff) */}
            {selectedEdge && (
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Typed Handoff Contract</h3>
                  <StatusChip label="FR-RT-21" tone="info" />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  From <strong>{selectedEdge.fromAgentId}</strong> to <strong>{selectedEdge.toAgentId}</strong>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Goal</div>
                  <div style={{ fontSize: '12px', marginTop: '2px' }}>
                    {String(selectedEdge.handoffSchema['goal'] ?? selectedEdge.name)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Context Summary
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '2px' }}>
                    {String(selectedEdge.handoffSchema['context_summary'] ?? selectedEdge.description ?? '—')}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Contract Schema
                  </div>
                  <pre
                    style={{
                      margin: '4px 0 0 0',
                      padding: '8px',
                      backgroundColor: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      maxHeight: '140px',
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(selectedEdge.handoffSchema, null, 2)}
                  </pre>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Return Schema (JSON Schema)
                  </div>
                  <pre
                    style={{
                      margin: '4px 0 0 0',
                      padding: '8px',
                      backgroundColor: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      maxHeight: '140px',
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(selectedEdge.returnSchema, null, 2)}
                  </pre>
                </div>

                <div
                  style={{
                    padding: '8px',
                    backgroundColor: 'var(--info-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '11px',
                    color: 'var(--info)',
                  }}
                >
                  <ShieldCheck size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  Free text handoffs forbidden. Schema validated before transition.
                </div>
              </div>
            )}

            {/* Member Inspector */}
            {selectedMember && !selectedEdge && (
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Member Inspector</h3>
                  <StatusChip label={selectedMember.role} tone="info" />
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Agent ID</div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{selectedMember.agentId}</div>
                  <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    Role: {selectedMember.role}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Limits</div>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px', fontSize: '12px' }}>
                    <li>Max Steps: {selectedMember.maxSteps}</li>
                    <li>Timeout: {selectedMember.timeoutSeconds} s</li>
                    <li>Max Spend: {formatUsd(selectedMember.maxSpendMicroUsd)}</li>
                  </ul>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Blackboard Read Scopes
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {selectedMember.readKeys.map((k: string) => (
                      <span
                        key={k}
                        style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          padding: '2px 6px',
                          backgroundColor: 'var(--surface-raised)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Blackboard Write Scopes
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {selectedMember.writeKeys.map((k: string) => (
                      <span
                        key={k}
                        style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          padding: '2px 6px',
                          backgroundColor: 'var(--surface-raised)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Simulation Results Inspector */}
            {simulationResult && !selectedEdge && !selectedMember && (
              <div style={{ display: 'grid', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Simulation Results</h3>
                  <StatusChip label="Completed" tone="success" />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    padding: '10px',
                    backgroundColor: 'var(--surface-raised)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Rolled-up Cost</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--brand)' }}>
                      {formatUsd(simulationResult.totalCostMicroUsd)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Total Tokens</div>
                    <div style={{ fontSize: '15px', fontWeight: 700 }}>
                      {(simulationResult.totalTokensIn + simulationResult.totalTokensOut).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Child Run Roll-up (FR-RT-20)
                  </div>
                  <div style={{ display: 'grid', gap: '6px' }}>
                    {simulationResult.childRuns.map((cr) => (
                      <div
                        key={cr.childRunId}
                        style={{
                          padding: '8px',
                          backgroundColor: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '11px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                          <span>{cr.role}</span>
                          <span>{formatUsd(cr.costMicroUsd)}</span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {cr.childRunId} &bull; {cr.tokensIn + cr.tokensOut} toks
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '6px',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Message Flow ({simulationResult.messages.length})
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveMessageIndex(0);
                        setIsPlayingAnimation(true);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--brand)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Replay
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: '6px', maxHeight: '180px', overflow: 'auto' }}>
                    {simulationResult.messages.map((m, idx) => {
                      const isActive = activeMessageIndex === idx;
                      return (
                        <div
                          key={m.id || idx}
                          style={{
                            padding: '6px 8px',
                            backgroundColor: isActive ? 'var(--info-bg)' : 'var(--bg)',
                            border: isActive ? '1px solid var(--brand)' : '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '11px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <span>{m.senderAgentId}</span>
                            <ArrowRight size={10} />
                            <span>{m.receiverAgentId}</span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {m.purpose}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {!selectedEdge && !selectedMember && !simulationResult && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                Click a node to inspect member limits &amp; scopes, or click a handoff badge to view the typed schema.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {createModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-team-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: '460px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              display: 'grid',
              gap: '16px',
            }}
          >
            <h2 id="create-team-title" style={{ margin: 0, fontSize: '18px' }}>
              Create Multi-Agent Team
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
              Configure a supervisor + specialists team with typed handoffs and blackboard isolation.
            </p>

            <div>
              <label htmlFor="new-team-name-input" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Team Name
              </label>
              <input
                id="new-team-name-input"
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
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
              <label htmlFor="new-team-desc-input" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Description
              </label>
              <textarea
                id="new-team-desc-input"
                value={newTeamDescription}
                onChange={(e) => setNewTeamDescription(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                style={{
                  minHeight: '34px',
                  padding: '6px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface-raised)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateStarterTeam()}
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
                Create Swarm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
