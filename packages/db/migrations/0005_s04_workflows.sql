-- 0005_s04_workflows.sql
-- PRD Appendix M.2 / M.6 + E0.4-1 (workflows, workflow_versions) + E0.4-5 (triggers, trigger_events)

-- 1. Workflows registry
CREATE TABLE workflows (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES principals(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  current_version_id uuid,
  labels jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, name)
);

SELECT enable_tenant_rls('workflows');

-- 2. Immutable-after-publish workflow graph versions
CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  semver text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','retired')),
  schema_version int NOT NULL DEFAULT 1,
  graph jsonb NOT NULL,
  graph_hash text NOT NULL,
  yaml_source text,
  message text,
  created_by uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, semver)
);

SELECT enable_tenant_rls('workflow_versions');

-- 3. Active trigger bindings (webhook / schedule / manual) per DOC-Q-020 & FR-WF-7
CREATE TABLE triggers (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  environment_id uuid NOT NULL REFERENCES environments(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id),
  node_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('webhook','schedule','manual')),
  external_id text NOT NULL UNIQUE,
  path text,
  config jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT false,
  test_mode boolean NOT NULL DEFAULT false,
  last_fired_at timestamptz,
  next_fire_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX triggers_env_path_uidx ON triggers (environment_id, path) WHERE path IS NOT NULL AND active = true;

SELECT enable_tenant_rls('triggers');

-- 4. Captured trigger events & webhook replay protection log
CREATE TABLE trigger_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  trigger_id uuid NOT NULL REFERENCES triggers(id),
  run_id uuid,
  dedup_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  headers jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('accepted','replayed','rejected','captured_test')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trigger_id, dedup_key)
);

SELECT enable_tenant_rls('trigger_events');

-- Grants for least-privilege app role
GRANT SELECT, INSERT, UPDATE, DELETE ON
  workflows, workflow_versions, triggers, trigger_events
  TO platform_app;
