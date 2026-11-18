-- 0007_s06_hardening.sql
-- PRD F.3 / FR-GOV-14 / FR-INT-3 / C.8 / E0.6-1..3 (secrets envelope vault, budgets, killswitches)

-- 1. Envelope-encrypted DB Secrets Vault (D13, F.3)
CREATE TABLE secrets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  environment_id uuid REFERENCES environments(id),
  name text NOT NULL,
  secret_ref text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'db' CHECK (provider IN ('db','vault','env')),
  key_version int NOT NULL DEFAULT 1,
  wrapped_dek bytea NOT NULL,
  dek_iv bytea NOT NULL,
  dek_tag bytea NOT NULL,
  ciphertext bytea NOT NULL,
  data_iv bytea NOT NULL,
  data_tag bytea NOT NULL,
  purpose_allowlist jsonb NOT NULL DEFAULT '["tool_exec","model_provider","connector","webhook_verify"]',
  last_rotated_at timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, workspace_id, environment_id, name)
);

CREATE INDEX secrets_org_ws_idx
  ON secrets (org_id, workspace_id)
  WHERE deleted_at IS NULL;

SELECT enable_tenant_rls('secrets');

-- 2. Hierarchical Cost & Token Budgets with Hard Stops (FR-GOV-14, N.2.6, D22 micro-USD)
CREATE TABLE budgets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid REFERENCES workspaces(id),
  project_id uuid REFERENCES projects(id),
  agent_id uuid,
  scope_type text NOT NULL CHECK (scope_type IN ('org','workspace','project','agent')),
  scope_id text NOT NULL,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','weekly','monthly')),
  soft_limit_micro_usd bigint,
  hard_limit_micro_usd bigint,
  soft_limit_tokens bigint,
  hard_limit_tokens bigint,
  spent_micro_usd bigint NOT NULL DEFAULT 0,
  spent_tokens bigint NOT NULL DEFAULT 0,
  action_on_breach text NOT NULL DEFAULT 'stop' CHECK (action_on_breach IN ('downgrade_model','require_approval','stop')),
  alert_emitted_at timestamptz,
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, scope_type, scope_id)
);

CREATE INDEX budgets_org_scope_idx
  ON budgets (org_id, scope_type, scope_id);

SELECT enable_tenant_rls('budgets');

-- 3. Emergency Kill Switches (C.8, E0.6-3)
CREATE TABLE killswitches (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid REFERENCES workspaces(id),
  scope_type text NOT NULL CHECK (scope_type IN ('global','workspace','agent','tool')),
  scope_id text NOT NULL DEFAULT '*',
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  activated_by uuid NOT NULL REFERENCES principals(id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_by uuid REFERENCES principals(id),
  deactivated_at timestamptz,
  UNIQUE (org_id, scope_type, scope_id)
);

CREATE INDEX killswitches_active_idx
  ON killswitches (org_id, scope_type, scope_id)
  WHERE active = true;

SELECT enable_tenant_rls('killswitches');

-- Grants for least-privilege app role
GRANT SELECT, INSERT, UPDATE, DELETE ON
  secrets, budgets, killswitches
  TO platform_app;
