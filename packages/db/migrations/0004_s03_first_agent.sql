-- 0004_s03_first_agent.sql
-- PRD Appendix M.6 + E0.3-1 (model registry / BYOK), E0.3-5 (tools + grants), E0.3-9 (usage_ledger)

-- 1. Tool registry & versioned contracts
CREATE TABLE tools (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  side_effect_class text NOT NULL CHECK (side_effect_class IN ('read','write','destructive','external_comms')),
  is_builtin boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

SELECT enable_tenant_rls('tools');

CREATE TABLE tool_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  tool_id uuid NOT NULL REFERENCES tools(id),
  semver text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','retired')),
  contract jsonb NOT NULL,
  contract_hash text NOT NULL,
  created_by uuid REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_id, semver)
);

SELECT enable_tenant_rls('tool_versions');

-- 2. Scoped tool grants per agent (FR-TL-3)
CREATE TABLE tool_grants (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  tool_id uuid NOT NULL REFERENCES tools(id),
  scope jsonb NOT NULL DEFAULT '{}',
  approval text NOT NULL DEFAULT 'auto' CHECK (approval IN ('never','auto','always')),
  created_by uuid REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, tool_id)
);

SELECT enable_tenant_rls('tool_grants');

-- 3. Model Gateway BYOK secret references & tier mappings (FR-MG-1..4)
CREATE TABLE model_provider_keys (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider text NOT NULL,
  label text NOT NULL,
  secret_ref text NOT NULL,
  base_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by uuid REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, label)
);

SELECT enable_tenant_rls('model_provider_keys');

CREATE TABLE workspace_model_mappings (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  tier text NOT NULL CHECK (tier IN ('fast','standard','reasoning','embedding')),
  primary_provider text NOT NULL,
  primary_model text NOT NULL,
  fallback_chain jsonb NOT NULL DEFAULT '[]',
  routing_rules jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tier)
);

SELECT enable_tenant_rls('workspace_model_mappings');

-- 4. Usage ledger (monthly range-partitioned, integer micro-USD per D22 / E0.3-9)
CREATE TABLE usage_ledger (
  id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  environment_id uuid NOT NULL REFERENCES environments(id),
  run_id uuid NOT NULL,
  step_seq int,
  principal_id uuid,
  category text NOT NULL CHECK (category IN ('llm_tokens','tool_call','sandbox_ms','storage')),
  provider text,
  model text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  cached_tokens int NOT NULL DEFAULT 0,
  quantity bigint NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'tokens',
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  ts timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

CREATE INDEX usage_ledger_run_idx ON usage_ledger (run_id, ts DESC);
CREATE INDEX usage_ledger_ws_idx ON usage_ledger (workspace_id, ts DESC);

CREATE TABLE usage_ledger_2026_11 PARTITION OF usage_ledger FOR VALUES FROM ('2026-11-01 00:00:00Z') TO ('2026-12-01 00:00:00Z');
CREATE TABLE usage_ledger_2026_12 PARTITION OF usage_ledger FOR VALUES FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z');
CREATE TABLE usage_ledger_2027_01 PARTITION OF usage_ledger FOR VALUES FROM ('2027-01-01 00:00:00Z') TO ('2027-02-01 00:00:00Z');
CREATE TABLE usage_ledger_2027_02 PARTITION OF usage_ledger FOR VALUES FROM ('2027-02-01 00:00:00Z') TO ('2027-03-01 00:00:00Z');

SELECT enable_tenant_rls('usage_ledger');

-- Grants for least-privilege app role
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tools, tool_versions, tool_grants, model_provider_keys, workspace_model_mappings, usage_ledger
  TO platform_app;
