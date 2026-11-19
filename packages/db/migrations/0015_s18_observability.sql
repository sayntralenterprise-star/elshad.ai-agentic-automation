-- S1.8 Observability v1: alert rules & alert incidents

CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  metric text NOT NULL,
  operator text NOT NULL DEFAULT 'gt',
  threshold double precision NOT NULL,
  window_minutes integer NOT NULL DEFAULT 5,
  channels_json jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT enable_tenant_rls('alert_rules');

CREATE INDEX IF NOT EXISTS alert_rules_ws_idx ON alert_rules (org_id, workspace_id, enabled);

CREATE TABLE IF NOT EXISTS alert_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  metric text NOT NULL,
  observed_value double precision NOT NULL,
  threshold double precision NOT NULL,
  status text NOT NULL DEFAULT 'firing',
  summary text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz NULL,
  resolved_at timestamptz NULL
);

SELECT enable_tenant_rls('alert_incidents');

CREATE INDEX IF NOT EXISTS alert_incidents_ws_status_idx ON alert_incidents (org_id, workspace_id, status, fired_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rules, alert_incidents TO platform_app;
