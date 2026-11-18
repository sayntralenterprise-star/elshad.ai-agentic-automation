-- 0009_s11_approvals.sql
-- PRD E1.1 / FR-GOV-12, FR-GOV-13, FR-ORC-4 / M.4 / N.1 (Approvals & Notifications)

-- 1. Durable Human-in-the-Loop Approvals (M.4, N.1)
CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('tool_call', 'promotion', 'write_grant', 'policy_enforce', 'workflow_gate', 'custom')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'info_requested')),
  payload jsonb NOT NULL,
  requested_from jsonb NOT NULL DEFAULT '[]',
  required_decisions int NOT NULL DEFAULT 1 CHECK (required_decisions >= 1),
  separation_of_duties boolean NOT NULL DEFAULT true,
  initiated_by uuid NOT NULL REFERENCES principals(id),
  delegated_to uuid REFERENCES principals(id),
  expires_at timestamptz,
  on_timeout text NOT NULL DEFAULT 'escalate' CHECK (on_timeout IN ('reject', 'escalate', 'approve')),
  auto_approve_on_timeout boolean NOT NULL DEFAULT false,
  escalation jsonb NOT NULL DEFAULT '[]',
  escalated_at timestamptz,
  snoozed_until timestamptz,
  info_request_question text,
  info_request_answer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX approvals_org_status_idx
  ON approvals (org_id, workspace_id, status, expires_at);

SELECT enable_tenant_rls('approvals');

-- 2. Approval Decisions Ledger (dual-approval & edit payloads)
CREATE TABLE approval_decisions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  approval_id uuid NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  decided_by uuid NOT NULL REFERENCES principals(id),
  decision text NOT NULL CHECK (decision IN ('approve', 'reject', 'approve_with_edit', 'request_info', 'provide_info', 'delegate')),
  reason text,
  edited_payload jsonb,
  channel text NOT NULL CHECK (channel IN ('console', 'slack', 'email', 'api')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX approval_decisions_approval_idx
  ON approval_decisions (org_id, approval_id, created_at);

SELECT enable_tenant_rls('approval_decisions');

-- 3. Actionable Notifications (Slack, Email, In-App)
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid REFERENCES workspaces(id),
  approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('slack', 'email', 'in_app', 'webhook')),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  action_links jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_org_created_idx
  ON notifications (org_id, created_at DESC);

SELECT enable_tenant_rls('notifications');

GRANT SELECT, INSERT, UPDATE, DELETE ON
  approvals, approval_decisions, notifications
  TO platform_app;
