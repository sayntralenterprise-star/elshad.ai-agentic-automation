-- 0014_s17_promotions.sql
-- PRD E1.7 / FR-WF-8, 11 / FR-EV-4 / N.2.13 / §7.3.3 (Environments, Promotions & Rollback)

CREATE TABLE promotions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  subject_type text NOT NULL CHECK (subject_type IN ('agent', 'workflow')),
  subject_id uuid NOT NULL,
  version_id uuid NOT NULL,
  from_env text NOT NULL CHECK (from_env IN ('dev', 'staging', 'prod')),
  to_env text NOT NULL CHECK (to_env IN ('dev', 'staging', 'prod')),
  status text NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'deployed', 'rolled_back', 'failed')),
  eval_gate_passed boolean NOT NULL DEFAULT false,
  eval_score double precision,
  diff_summary jsonb NOT NULL DEFAULT '{}',
  credential_mapping jsonb NOT NULL DEFAULT '{}',
  canary_pct int NOT NULL DEFAULT 100 CHECK (canary_pct BETWEEN 0 AND 100),
  approval_id uuid,
  initiated_by uuid NOT NULL REFERENCES principals(id),
  approved_by uuid REFERENCES principals(id),
  deployed_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX promotions_org_ws_idx
  ON promotions (org_id, workspace_id, to_env, created_at DESC);

SELECT enable_tenant_rls('promotions');

GRANT SELECT, INSERT, UPDATE, DELETE ON promotions TO platform_app;
