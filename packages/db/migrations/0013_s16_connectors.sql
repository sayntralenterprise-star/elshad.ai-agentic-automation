-- 0013_s16_connectors.sql
-- PRD E1.6 / FR-INT-1..6 / §5.8 / D.2-D.5 / D17 / P.4 (Connectors Wave 1 & Write-Only Connections)

-- 1. Connections (write-only credential vaulting, environment mapping, sharing, egress domains)
CREATE TABLE connections (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  connector_id text NOT NULL,
  name text NOT NULL,
  auth_type text NOT NULL CHECK (auth_type IN ('api_key', 'oauth2', 'basic', 'jwt', 'mtls', 'aws_sigv4', 'custom')),
  sharing_mode text NOT NULL DEFAULT 'shared' CHECK (sharing_mode IN ('personal', 'shared')),
  owner_id uuid NOT NULL REFERENCES principals(id),
  environment_mapping jsonb NOT NULL DEFAULT '{}',
  secret_ref text NOT NULL,
  secret_version int NOT NULL DEFAULT 1,
  scopes jsonb NOT NULL DEFAULT '[]',
  allowed_agents jsonb NOT NULL DEFAULT '["*"]',
  egress_domains jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'expiring', 'failed', 'pending_approval')),
  last_tested_at timestamptz,
  last_error text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX connections_org_ws_idx
  ON connections (org_id, workspace_id, connector_id, created_at DESC);

SELECT enable_tenant_rls('connections');

-- 2. Connection Usage Audit (FR-INT-3)
CREATE TABLE connection_usage_logs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  run_id uuid,
  agent_id uuid,
  action_name text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('dev', 'staging', 'prod')),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'blocked_egress')),
  latency_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX connection_usage_conn_idx
  ON connection_usage_logs (org_id, connection_id, created_at DESC);

SELECT enable_tenant_rls('connection_usage_logs');

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  connections, connection_usage_logs
  TO platform_app;
