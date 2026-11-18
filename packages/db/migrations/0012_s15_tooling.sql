-- 0012_s15_tooling.sql
-- PRD E1.5 / FR-TL-1 (client), FR-TL-2, FR-TL-5, FR-TL-7, FR-TL-8, FR-TL-9 / §5.3 / §7.3.7 (Tooling v1)

-- 1. Custom Tools (OpenAPI imported, Code tools, Registry entries)
CREATE TABLE custom_tools (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  description text NOT NULL,
  side_effect_class text NOT NULL DEFAULT 'read' CHECK (side_effect_class IN ('read', 'write', 'destructive', 'external_comms')),
  implementation text NOT NULL DEFAULT 'http' CHECK (implementation IN ('http', 'sandbox_js', 'sandbox_python', 'mcp', 'workflow', 'builtin')),
  input_schema jsonb NOT NULL DEFAULT '{}',
  output_schema jsonb NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}',
  tags jsonb NOT NULL DEFAULT '[]',
  owner text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  untrusted_source boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_tools_org_ws_name_ver_idx
  ON custom_tools (org_id, workspace_id, name, version);

SELECT enable_tenant_rls('custom_tools');

-- 2. External MCP Servers (FR-TL-1)
CREATE TABLE mcp_servers (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  transport text NOT NULL CHECK (transport IN ('sse', 'stdio', 'http')),
  endpoint text NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  metadata jsonb NOT NULL DEFAULT '{}',
  last_health_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_servers_org_ws_idx
  ON mcp_servers (org_id, workspace_id, created_at DESC);

SELECT enable_tenant_rls('mcp_servers');

-- 3. Discovered MCP Server Tools (Blocked until approved per FR-TL-1)
CREATE TABLE mcp_server_tools (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  mcp_server_id uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  input_schema jsonb NOT NULL DEFAULT '{}',
  side_effect_class text NOT NULL DEFAULT 'read' CHECK (side_effect_class IN ('read', 'write', 'destructive', 'external_comms')),
  approval_status text NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval', 'approved', 'rejected')),
  approved_by uuid REFERENCES principals(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mcp_server_tools_server_name_idx
  ON mcp_server_tools (org_id, mcp_server_id, name);

SELECT enable_tenant_rls('mcp_server_tools');

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  custom_tools, mcp_servers, mcp_server_tools
  TO platform_app;
