-- 0002_s01_core_schema.sql
-- PRD Appendix M.6 + DOC-Q-001 (projects) + DOC-Q-002 (outbox) + S0.1 IAM/Audit tables

-- 1. Tenancy hierarchy
CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  region text NOT NULL DEFAULT 'default',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  slug text NOT NULL,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, slug)
);
SELECT enable_tenant_rls('workspaces');

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  max_autonomy_level text NOT NULL DEFAULT 'L3' CHECK (max_autonomy_level IN ('L0','L1','L2','L3','L4')),
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, slug)
);
SELECT enable_tenant_rls('projects');

CREATE TABLE environments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL CHECK (kind IN ('dev','staging','prod')),
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind)
);
SELECT enable_tenant_rls('environments');

-- 2. IAM: Principals, Roles, Bindings, Local Credentials, Sessions, API Keys
CREATE TABLE principals (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  type text NOT NULL CHECK (type IN ('user','group','service_account','agent')),
  external_id text,
  email citext,
  display_name text NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}',
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, type, external_id)
);
SELECT enable_tenant_rls('principals');

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  USING (org_id IS NULL OR org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

CREATE TABLE role_bindings (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  scope_type text NOT NULL CHECK (scope_type IN ('org','workspace','project','resource')),
  scope_id uuid NOT NULL,
  created_by uuid REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, role_id, scope_type, scope_id)
);
CREATE INDEX role_bindings_principal_idx ON role_bindings (principal_id, scope_type, scope_id);
SELECT enable_tenant_rls('role_bindings');

CREATE TABLE local_credentials (
  principal_id uuid PRIMARY KEY REFERENCES principals(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  password_hash text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('local_credentials');

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  refresh_token_hash text NOT NULL,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_principal_idx ON sessions (principal_id) WHERE revoked_at IS NULL;
SELECT enable_tenant_rls('sessions');

CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid REFERENCES workspaces(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_prefix_idx ON api_keys (key_prefix) WHERE revoked_at IS NULL;
SELECT enable_tenant_rls('api_keys');

-- 3. Idempotency, Feature Flags, Settings, Outbox
CREATE TABLE idempotency_keys (
  org_id uuid NOT NULL REFERENCES organizations(id),
  principal_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status int NOT NULL,
  response_body jsonb,
  response_ref text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, key)
);
SELECT enable_tenant_rls('idempotency_keys');

CREATE TABLE feature_flags (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  scope_type text NOT NULL CHECK (scope_type IN ('org','workspace','environment')),
  scope_id uuid NOT NULL,
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, flag_key)
);
SELECT enable_tenant_rls('feature_flags');

CREATE TABLE settings (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  scope_type text NOT NULL CHECK (scope_type IN ('org','workspace','project','environment')),
  scope_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, key)
);
SELECT enable_tenant_rls('settings');

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  subject text NOT NULL,
  payload jsonb NOT NULL,
  traceparent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at ASC) WHERE published_at IS NULL;
SELECT enable_tenant_rls('outbox');

-- 4. Hash-chained append-only Audit Log (partitioned monthly)
CREATE TABLE audit_events (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  seq bigint NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL,
  on_behalf_of jsonb,
  action text NOT NULL,
  resource jsonb NOT NULL,
  decision text,
  policy_ids text[],
  context jsonb NOT NULL DEFAULT '{}',
  context_hash text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  PRIMARY KEY (org_id, seq, ts)
) PARTITION BY RANGE (ts);

CREATE TABLE audit_events_2026_11 PARTITION OF audit_events
  FOR VALUES FROM ('2026-11-01 00:00:00Z') TO ('2026-12-01 00:00:00Z');
CREATE TABLE audit_events_2026_12 PARTITION OF audit_events
  FOR VALUES FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z');
CREATE TABLE audit_events_2027_01 PARTITION OF audit_events
  FOR VALUES FROM ('2027-01-01 00:00:00Z') TO ('2027-02-01 00:00:00Z');
CREATE TABLE audit_events_2027_02 PARTITION OF audit_events
  FOR VALUES FROM ('2027-02-01 00:00:00Z') TO ('2027-03-01 00:00:00Z');

SELECT enable_tenant_rls('audit_events');
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM platform_app;

-- 5. Core Agent Registry Tables (M.6 baseline)
CREATE TABLE agents (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES principals(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated','archived')),
  risk_tier text NOT NULL DEFAULT 'low',
  identity_principal_id uuid REFERENCES principals(id),
  current_version_id uuid,
  labels jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, name)
);
SELECT enable_tenant_rls('agents');

CREATE TABLE agent_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  semver text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','retired')),
  definition jsonb NOT NULL,
  definition_hash text NOT NULL,
  message text,
  eval_status text NOT NULL DEFAULT 'none',
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, semver)
);
SELECT enable_tenant_rls('agent_versions');

CREATE TABLE deployments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  environment_id uuid NOT NULL REFERENCES environments(id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  version_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'stable',
  traffic_pct int NOT NULL DEFAULT 100 CHECK (traffic_pct BETWEEN 0 AND 100),
  status text NOT NULL,
  deployed_by uuid REFERENCES principals(id),
  deployed_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('deployments');

-- Grants for least-privilege app role
GRANT USAGE ON SCHEMA public TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, workspaces, projects, environments, principals, roles, role_bindings,
  local_credentials, sessions, api_keys, idempotency_keys, feature_flags, settings,
  outbox, agents, agent_versions, deployments
  TO platform_app;
GRANT SELECT, INSERT ON audit_events TO platform_app;
