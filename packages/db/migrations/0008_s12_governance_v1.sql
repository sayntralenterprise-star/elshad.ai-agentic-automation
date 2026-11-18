-- 0008_s12_governance_v1.sql
-- PRD E1.2 / FR-GOV-1,2,4..12,17,18 / FR-TL-3 / FR-RT-7 / O.1 / M.6 (Governance v1)

-- 1. Scoped Agent Identities (FR-GOV-1, F.1)
CREATE TABLE agent_identities (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  environment_id uuid NOT NULL REFERENCES environments(id),
  display_name text NOT NULL,
  allowed_tool_ids jsonb NOT NULL DEFAULT '[]',
  token_ttl_seconds int NOT NULL DEFAULT 900 CHECK (token_ttl_seconds > 0 AND token_ttl_seconds <= 86400),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, environment_id)
);

CREATE INDEX agent_identities_org_ws_idx
  ON agent_identities (org_id, workspace_id, status);

SELECT enable_tenant_rls('agent_identities');

-- 2. Declarative Policies & Immutable Versions (FR-GOV-4..9, D7)
CREATE TABLE policies (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid REFERENCES workspaces(id),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  point text NOT NULL CHECK (point IN (
    'tool_call',
    'data_access',
    'memory_read',
    'memory_write',
    'model_select',
    'egress',
    'promotion',
    'publish'
  )),
  mode text NOT NULL DEFAULT 'audit_only' CHECK (mode IN ('audit_only', 'enforce')),
  active_version_id uuid,
  created_by uuid NOT NULL REFERENCES principals(id),
  approved_by uuid REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, workspace_id, slug)
);

CREATE INDEX policies_org_ws_point_idx
  ON policies (org_id, workspace_id, point)
  WHERE deleted_at IS NULL;

SELECT enable_tenant_rls('policies');

CREATE TABLE policy_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version int NOT NULL,
  effect text NOT NULL CHECK (effect IN ('allow', 'deny', 'require_approval')),
  rules_json jsonb NOT NULL DEFAULT '{}',
  rego_source text NOT NULL,
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

SELECT enable_tenant_rls('policy_versions');

-- 3. Partitioned Append-Only Policy Decisions Ledger (FR-GOV-6, D7)
CREATE TABLE policy_decisions (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid,
  run_id uuid,
  policy_id uuid,
  point text NOT NULL,
  effect text NOT NULL,
  matched_policy_ids text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  input_summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE policy_decisions_2026_11 PARTITION OF policy_decisions
  FOR VALUES FROM ('2026-11-01 00:00:00Z') TO ('2026-12-01 00:00:00Z');
CREATE TABLE policy_decisions_2026_12 PARTITION OF policy_decisions
  FOR VALUES FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z');
CREATE TABLE policy_decisions_2027_01 PARTITION OF policy_decisions
  FOR VALUES FROM ('2027-01-01 00:00:00Z') TO ('2027-02-01 00:00:00Z');
CREATE TABLE policy_decisions_2027_02 PARTITION OF policy_decisions
  FOR VALUES FROM ('2027-02-01 00:00:00Z') TO ('2027-03-01 00:00:00Z');
CREATE TABLE policy_decisions_default PARTITION OF policy_decisions DEFAULT;

CREATE INDEX policy_decisions_org_run_idx
  ON policy_decisions (org_id, run_id, created_at DESC);

SELECT enable_tenant_rls('policy_decisions');
REVOKE UPDATE, DELETE, TRUNCATE ON policy_decisions FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON policy_decisions FROM platform_app;

-- Grants for least-privilege app role
GRANT SELECT, INSERT, UPDATE, DELETE ON
  agent_identities, policies, policy_versions
  TO platform_app;

GRANT SELECT, INSERT ON
  policy_decisions
  TO platform_app;
