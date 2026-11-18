import { describe, expect, it } from 'vitest';
import { PlatformError, type TenantContext } from '@elshad/domain';
import {
  BlackboardManager,
  DelegationEngine,
  MultiAgentCoordinator,
  TypedHandoffValidator,
  type SpecialistRunner,
  type TeamDefinition,
} from './multi-agent.js';

describe('@elshad/runtime-core multi-agent v1: Supervisor + Specialists, Typed Handoffs & Blackboard [E1.4, FR-RT-20..24, §5.1, M.1]', () => {
  const dummyTenantCtx: TenantContext = {
    orgId: 'org_test',
    workspaceId: 'ws_test',
    principal: {
      id: 'prn_test',
      orgId: 'org_test',
      type: 'user',
      roles: ['admin'],
      permissions: ['*'],
      authMethod: 'local',
    },
    requestId: 'req_test',
    traceId: 'trc_test',
  };

  describe('Run-Scoped Shared Blackboard Manager (FR-RT-22)', () => {
    it('stores, updates, snapshots state and maintains mutation history', () => {
      const bb = new BlackboardManager('run_123', { customer_id: 'cust_99', initial_status: 'pending' });

      expect(bb.get('customer_id')).toBe('cust_99');
      const setRes = bb.set('order_id', 'ord_442', 'agent_supervisor', ['*']);
      expect(setRes.success).toBe(true);
      expect(setRes.version).toBe(2);

      const snapshot = bb.snapshot();
      expect(snapshot.version).toBe(2);
      expect(snapshot.data['customer_id']).toBe('cust_99');
      expect(snapshot.data['order_id']).toBe('ord_442');
      expect(snapshot.history).toHaveLength(1);
      expect(snapshot.history[0]?.key).toBe('order_id');
      expect(snapshot.history[0]?.agentId).toBe('agent_supervisor');
    });

    it('enforces scoped read permissions (PERM_FORBIDDEN on unauthorized read)', () => {
      const bb = new BlackboardManager('run_123', {
        user_profile: { name: 'Alice' },
        credit_card_vault_id: 'vault_secret_99',
      });

      // Allowed read
      expect(bb.get('user_profile', 'auth_specialist', ['user_profile', 'session_id'])).toEqual({ name: 'Alice' });

      // Unauthorized read
      expect(() => {
        bb.get('credit_card_vault_id', 'auth_specialist', ['user_profile', 'session_id']);
      }).toThrowError(PlatformError);

      try {
        bb.get('credit_card_vault_id', 'auth_specialist', ['user_profile', 'session_id']);
      } catch (err: unknown) {
        expect((err as PlatformError).code).toBe('MEM_SCOPE_DENIED');
      }

      // Filtered state
      const scopedState = bb.getState('auth_specialist', ['user_profile', 'session_id']);
      expect(scopedState['user_profile']).toBeDefined();
      expect(scopedState['credit_card_vault_id']).toBeUndefined();
    });

    it('enforces scoped write permissions and optimistic concurrency CAS (RES_CONFLICT)', () => {
      const bb = new BlackboardManager('run_123', { status: 'open' });

      // Unauthorized write
      expect(() => {
        bb.set('payout_amount', 5000, 'triage_agent', ['status', 'notes']);
      }).toThrowError(PlatformError);

      // Permitted write
      const ok = bb.set('notes', 'Checked triage log', 'triage_agent', ['status', 'notes']);
      expect(ok.success).toBe(true);

      // CAS conflict
      expect(() => {
        bb.set('status', 'in_progress', 'triage_agent', ['status', 'notes'], 1); // expected 1, but current is 2
      }).toThrowError(PlatformError);

      try {
        bb.set('status', 'in_progress', 'triage_agent', ['status', 'notes'], 1);
      } catch (err: unknown) {
        expect((err as PlatformError).code).toBe('RES_CONFLICT');
      }
    });
  });

  describe('Typed Handoff Validator (FR-RT-21)', () => {
    it('accepts compliant typed handoff object', () => {
      const payload = {
        goal: 'Verify authorization and fraud score for refund request',
        context_summary: 'User requests refund for order #1234 after 10 days',
        artifacts: [
          { id: 'art_1', name: 'order_receipt', type: 'invoice_pdf', uri: 's3://artifacts/1234.pdf' },
        ],
        constraints: { max_refund_usd: 500, require_id_verification: true },
        return_schema: {
          type: 'object',
          properties: { approved: { type: 'boolean' } },
        },
      };

      const validated = TypedHandoffValidator.validate(payload);
      expect(validated.goal).toBe(payload.goal);
      expect(validated.artifacts).toHaveLength(1);
      expect(validated.constraints['max_refund_usd']).toBe(500);
    });

    it('rejects free-text-only handoff or missing typed fields (VALIDATION_FAILED)', () => {
      // Free text only
      expect(() => {
        TypedHandoffValidator.validate({ text: 'Please handle this refund for me' });
      }).toThrowError(/Typed handoff requires a non-empty string "goal"/);

      // Missing artifacts
      expect(() => {
        TypedHandoffValidator.validate({
          goal: 'Handle refund',
          context_summary: 'summary',
          constraints: {},
          return_schema: {},
        });
      }).toThrowError(/requires an "artifacts" array/);

      // Missing return schema
      expect(() => {
        TypedHandoffValidator.validate({
          goal: 'Handle refund',
          context_summary: 'summary',
          artifacts: [],
          constraints: {},
        });
      }).toThrowError(/requires a "return_schema" object/);
    });
  });

  describe('Delegation Engine & Guardrails (FR-RT-23, FR-RT-24)', () => {
    it('prevents runaway delegation exceeding depth limit (default 3)', () => {
      const engine = new DelegationEngine({ maxDepth: 3 });

      // Depth 1 and 2 allowed
      expect(() => engine.validateDelegation('agent_sup', 'agent_spec1', 1)).not.toThrow();
      expect(() => engine.validateDelegation('agent_spec1', 'agent_subspec', 2)).not.toThrow();

      // Depth 3 rejected
      expect(() => engine.validateDelegation('agent_subspec', 'agent_leaf', 3)).toThrowError(
        /Delegation depth limit exceeded/,
      );
    });

    it('prevents runaway delegation exceeding fan-out limit (default 8)', () => {
      const engine = new DelegationEngine({ maxFanout: 3 });

      // 3 delegations allowed
      engine.validateDelegation('agent_sup', 'spec_1', 1);
      engine.validateDelegation('agent_sup', 'spec_2', 1);
      engine.validateDelegation('agent_sup', 'spec_3', 1);

      // 4th delegation exceeds fan-out limit
      expect(() => engine.validateDelegation('agent_sup', 'spec_4', 1)).toThrowError(
        /Delegation fan-out limit exceeded/,
      );
    });

    it('records every inter-agent message in the trace with sender, receiver, and purpose (FR-RT-24)', () => {
      const engine = new DelegationEngine();
      const msg = engine.recordMessage('run_123', 'agent_sup', 'agent_spec', 'delegation_request', {
        goal: 'Diagnose network error',
      });

      expect(msg.id).toMatch(/^msg_/);
      expect(msg.purpose).toBe('delegation_request');
      expect(msg.senderAgentId).toBe('agent_sup');
      expect(msg.receiverAgentId).toBe('agent_spec');
      expect(engine.getMessages()).toHaveLength(1);
    });
  });

  describe('Supervisor + 3 Specialists Multi-Agent Benchmark Execution (FR-RT-20..24)', () => {
    it('supervisor coordinates 3 specialists with typed handoffs, blackboard isolation, and cost roll-up', async () => {
      const teamDef: TeamDefinition = {
        id: 'team_incident_triage',
        orgId: 'org_test',
        workspaceId: 'ws_test',
        name: 'Incident Triage Multi-Agent Team',
        pattern: 'supervisor_specialists',
        supervisorAgentId: 'supervisor_triage',
        members: [
          {
            id: 'tm_1',
            teamId: 'team_incident_triage',
            agentId: 'supervisor_triage',
            role: 'supervisor',
            readKeys: ['*'],
            writeKeys: ['*'],
            maxSteps: 15,
            timeoutSeconds: 120,
            maxSpendMicroUsd: 10_000_000,
          },
          {
            id: 'tm_2',
            teamId: 'team_incident_triage',
            agentId: 'spec_auth',
            role: 'specialist',
            readKeys: ['user_id', 'session_token'],
            writeKeys: ['auth_status', 'mfa_verified'],
            maxSteps: 5,
            timeoutSeconds: 30,
            maxSpendMicroUsd: 2_000_000,
          },
          {
            id: 'tm_3',
            teamId: 'team_incident_triage',
            agentId: 'spec_billing',
            role: 'specialist',
            readKeys: ['user_id', 'order_id', 'auth_status'],
            writeKeys: ['refund_eligibility', 'refund_amount'],
            maxSteps: 5,
            timeoutSeconds: 30,
            maxSpendMicroUsd: 2_000_000,
          },
          {
            id: 'tm_4',
            teamId: 'team_incident_triage',
            agentId: 'spec_network',
            role: 'specialist',
            readKeys: ['endpoint', 'error_code'],
            writeKeys: ['infra_diagnosis', 'routing_fix'],
            maxSteps: 5,
            timeoutSeconds: 30,
            maxSpendMicroUsd: 2_000_000,
          },
        ],
        handoffs: [],
      };

      const coordinator = new MultiAgentCoordinator(teamDef, 'run_root_001');

      // Specialist execution mock
      const specialistRunner: SpecialistRunner = async (
        agentId,
        handoff,
        blackboard,
        memberConfig,
      ) => {
        expect(handoff.goal).toBeDefined();

        if (agentId === 'spec_auth') {
          blackboard.set('auth_status', 'verified', agentId, memberConfig.writeKeys);
          blackboard.set('mfa_verified', true, agentId, memberConfig.writeKeys);
          return {
            output: { status: 'auth_confirmed', user: 'valid' },
            tokensIn: 220,
            tokensOut: 60,
            costMicroUsd: 2500,
            durationMs: 40,
          };
        }

        if (agentId === 'spec_billing') {
          // Read permitted keys from blackboard
          const authStatus = blackboard.get('auth_status', agentId, memberConfig.readKeys);
          expect(authStatus).toBe('verified');

          blackboard.set('refund_eligibility', 'eligible', agentId, memberConfig.writeKeys);
          blackboard.set('refund_amount', 149.99, agentId, memberConfig.writeKeys);
          return {
            output: { status: 'refund_approved', amount: 149.99 },
            tokensIn: 310,
            tokensOut: 90,
            costMicroUsd: 3800,
            durationMs: 55,
          };
        }

        if (agentId === 'spec_network') {
          blackboard.set('infra_diagnosis', 'gateway_timeout_mitigated', agentId, memberConfig.writeKeys);
          blackboard.set('routing_fix', 'rerouted_to_secondary_pop', agentId, memberConfig.writeKeys);
          return {
            output: { status: 'infra_healthy', latencyMs: 12 },
            tokensIn: 180,
            tokensOut: 40,
            costMicroUsd: 1900,
            durationMs: 25,
          };
        }

        throw new Error(`Unknown agentId ${agentId}`);
      };

      const result = await coordinator.executeSupervisorWorkflow(
        'run_root_001',
        dummyTenantCtx,
        {
          user_id: 'usr_8821',
          session_token: 'tok_active_xyz',
          order_id: 'ord_9901',
          endpoint: 'api.elshad.local/v1/checkout',
          error_code: 'GATEWAY_504',
        },
        specialistRunner,
      );

      // Verify execution outcome
      expect(result.finalOutput['status']).toBe('success');
      expect(result.childRuns).toHaveLength(3);

      // Verify blackboard state contains mutations from all 3 specialists
      expect(result.blackboard.data['auth_status']).toBe('verified');
      expect(result.blackboard.data['mfa_verified']).toBe(true);
      expect(result.blackboard.data['refund_eligibility']).toBe('eligible');
      expect(result.blackboard.data['refund_amount']).toBe(149.99);
      expect(result.blackboard.data['infra_diagnosis']).toBe('gateway_timeout_mitigated');

      // Verify token and cost roll-up into root run (FR-RT-20)
      // Base: tokensIn=150, tokensOut=80, cost=1500
      // spec_auth: tokensIn=220, tokensOut=60, cost=2500
      // spec_billing: tokensIn=310, tokensOut=90, cost=3800
      // spec_network: tokensIn=180, tokensOut=40, cost=1900
      // Total tokensIn = 150 + 220 + 310 + 180 = 860
      // Total tokensOut = 80 + 60 + 90 + 40 = 270
      // Total cost = 1500 + 2500 + 3800 + 1900 = 9700
      expect(result.totalTokensIn).toBe(860);
      expect(result.totalTokensOut).toBe(270);
      expect(result.totalCostMicroUsd).toBe(9700);

      // Verify inter-agent message tracking in trace (FR-RT-24)
      // 1 root delegation request + 3 requests + 3 responses = 7 messages
      expect(result.messages).toHaveLength(7);
      const purposes = result.messages.map((m) => m.purpose);
      expect(purposes).toContain('delegation_request');
      expect(purposes).toContain('delegation_response');
    });
  });
});
