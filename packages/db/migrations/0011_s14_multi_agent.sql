-- 0011_s14_multi_agent.sql
-- PRD E1.4 / FR-RT-20..24 / §5.1 / §7.3.3 / M.1 (Multi-agent v1: Supervisor + Specialists, Typed Handoffs, Blackboard)

-- 1. Teams (Supervisor + Specialists architectures)
CREATE TABLE teams (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  pattern text NOT NULL DEFAULT 'supervisor_specialists' CHECK (pattern IN ('supervisor_specialists', 'sequential_pipeline', 'parallel_fanout_aggregate', 'critic_pair', 'router')),
  supervisor_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teams_org_workspace_idx
  ON teams (org_id, workspace_id, created_at DESC);

SELECT enable_tenant_rls('teams');

-- 2. Team Members (Specialists with read/write scopes and guardrails)
CREATE TABLE team_members (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'specialist' CHECK (role IN ('supervisor', 'specialist', 'critic', 'worker', 'router')),
  read_keys jsonb NOT NULL DEFAULT '[]',
  write_keys jsonb NOT NULL DEFAULT '[]',
  max_steps int NOT NULL DEFAULT 10,
  timeout_seconds int NOT NULL DEFAULT 60,
  max_spend_micro_usd bigint NOT NULL DEFAULT 5000000,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX team_members_team_idx
  ON team_members (org_id, team_id, agent_id);

SELECT enable_tenant_rls('team_members');

-- 3. Typed Handoffs between Agents (FR-RT-21)
CREATE TABLE team_handoffs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  from_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  handoff_schema jsonb NOT NULL DEFAULT '{}',
  return_schema jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX team_handoffs_team_idx
  ON team_handoffs (org_id, team_id, from_agent_id, to_agent_id);

SELECT enable_tenant_rls('team_handoffs');

-- 4. Shared Run-Scoped Blackboard (FR-RT-22)
CREATE TABLE blackboards (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  run_id uuid NOT NULL,
  version int NOT NULL DEFAULT 1,
  state jsonb NOT NULL DEFAULT '{}',
  history jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX blackboards_run_idx
  ON blackboards (org_id, run_id);

SELECT enable_tenant_rls('blackboards');

-- 5. Inter-Agent Messages in Traces (FR-RT-24)
CREATE TABLE agent_messages (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  run_id uuid NOT NULL,
  sender_agent_id text NOT NULL,
  receiver_agent_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('delegation_request', 'delegation_response', 'blackboard_update', 'critic_feedback', 'error_rejection')),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_messages_run_idx
  ON agent_messages (org_id, run_id, created_at ASC);

SELECT enable_tenant_rls('agent_messages');

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  teams, team_members, team_handoffs, blackboards, agent_messages
  TO platform_app;
