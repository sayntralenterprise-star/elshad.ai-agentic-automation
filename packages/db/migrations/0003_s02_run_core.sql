-- 0003_s02_run_core.sql
-- PRD Appendix M.6 (Runs, Steps, Checkpoints, Work Items, Timers) + DOC-Q-017/018 + E0.2-5 (effect_ledger)

-- 1. Runs (monthly range-partitioned)
CREATE TABLE runs (
  id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  environment_id uuid NOT NULL REFERENCES environments(id),
  root_run_id uuid NOT NULL,
  parent_run_id uuid,
  subject_type text NOT NULL,
  subject_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued','running','waiting_approval','waiting_input','waiting_timer','waiting_child',
    'succeeded','failed','timed_out','budget_exceeded','policy_blocked','cancelled'
  )),
  failure_class text,
  termination_reason text CHECK (termination_reason IS NULL OR termination_reason IN (
    'final_answer','limit_reached','escalated','error','cancelled'
  )),
  initiator_id uuid NOT NULL REFERENCES principals(id),
  on_behalf_of_id uuid REFERENCES principals(id),
  trigger jsonb NOT NULL DEFAULT '{}',
  input_ref text,
  output_ref text,
  limits jsonb NOT NULL DEFAULT '{}',
  usage jsonb NOT NULL DEFAULT '{}',
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  wait jsonb,
  flags jsonb NOT NULL DEFAULT '{}',
  labels jsonb NOT NULL DEFAULT '{}',
  last_event_seq bigint NOT NULL DEFAULT 0,
  engine_version text NOT NULL DEFAULT '1.0.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX runs_ws_status_idx ON runs (workspace_id, status, created_at DESC);
CREATE INDEX runs_subject_idx ON runs (subject_version_id, created_at DESC);
CREATE INDEX runs_root_idx ON runs (root_run_id);
CREATE INDEX runs_labels_gin ON runs USING gin (labels jsonb_path_ops);

CREATE TABLE runs_2026_11 PARTITION OF runs FOR VALUES FROM ('2026-11-01 00:00:00Z') TO ('2026-12-01 00:00:00Z');
CREATE TABLE runs_2026_12 PARTITION OF runs FOR VALUES FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z');
CREATE TABLE runs_2027_01 PARTITION OF runs FOR VALUES FROM ('2027-01-01 00:00:00Z') TO ('2027-02-01 00:00:00Z');
CREATE TABLE runs_2027_02 PARTITION OF runs FOR VALUES FROM ('2027-02-01 00:00:00Z') TO ('2027-03-01 00:00:00Z');

SELECT enable_tenant_rls('runs');

-- 2. Event-sourced run events (monthly range-partitioned)
CREATE TABLE run_events (
  run_id uuid NOT NULL,
  seq bigint NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE run_events_2026_11 PARTITION OF run_events FOR VALUES FROM ('2026-11-01 00:00:00Z') TO ('2026-12-01 00:00:00Z');
CREATE TABLE run_events_2026_12 PARTITION OF run_events FOR VALUES FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z');
CREATE TABLE run_events_2027_01 PARTITION OF run_events FOR VALUES FROM ('2027-01-01 00:00:00Z') TO ('2027-02-01 00:00:00Z');
CREATE TABLE run_events_2027_02 PARTITION OF run_events FOR VALUES FROM ('2027-02-01 00:00:00Z') TO ('2027-03-01 00:00:00Z');

SELECT enable_tenant_rls('run_events');

-- 3. Run steps (monthly range-partitioned)
CREATE TABLE run_steps (
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  seq int NOT NULL,
  type text NOT NULL,
  agent_id uuid,
  status text NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}',
  input_ref text,
  output_ref text,
  model text,
  tokens_in int,
  tokens_out int,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  latency_ms int,
  policy jsonb,
  provenance text,
  error jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE UNIQUE INDEX run_steps_run_seq_uidx ON run_steps (run_id, seq, attempt, created_at);

CREATE TABLE run_steps_2026_11 PARTITION OF run_steps FOR VALUES FROM ('2026-11-01 00:00:00Z') TO ('2026-12-01 00:00:00Z');
CREATE TABLE run_steps_2026_12 PARTITION OF run_steps FOR VALUES FROM ('2026-12-01 00:00:00Z') TO ('2027-01-01 00:00:00Z');
CREATE TABLE run_steps_2027_01 PARTITION OF run_steps FOR VALUES FROM ('2027-01-01 00:00:00Z') TO ('2027-02-01 00:00:00Z');
CREATE TABLE run_steps_2027_02 PARTITION OF run_steps FOR VALUES FROM ('2027-02-01 00:00:00Z') TO ('2027-03-01 00:00:00Z');

SELECT enable_tenant_rls('run_steps');

-- 4. Checkpoints
CREATE TABLE checkpoints (
  run_id uuid NOT NULL,
  seq int NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  state_ref text NOT NULL,
  size_bytes int NOT NULL,
  milestone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

SELECT enable_tenant_rls('checkpoints');

-- 5. Work items queue (FOR UPDATE SKIP LOCKED + leases + serialize_key)
CREATE TABLE work_items (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  queue text NOT NULL DEFAULT 'default',
  priority smallint NOT NULL DEFAULT 5,
  run_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  serialize_key text,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','leased','done','dead')),
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_items_dispatch_idx ON work_items (queue, priority DESC, available_at ASC) WHERE status = 'ready';
CREATE INDEX work_items_lease_idx ON work_items (lease_expires_at) WHERE status = 'leased';
CREATE UNIQUE INDEX work_items_serialize_uidx ON work_items (workspace_id, serialize_key) WHERE status = 'leased' AND serialize_key IS NOT NULL;

SELECT enable_tenant_rls('work_items');

-- 6. Durable timers
CREATE TABLE timers (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  run_id uuid NOT NULL,
  kind text NOT NULL,
  fire_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  fired_at timestamptz
);

CREATE INDEX timers_due_idx ON timers (fire_at) WHERE fired_at IS NULL;

SELECT enable_tenant_rls('timers');

-- 7. Effect idempotency ledger (7-day retention per N.2.8)
CREATE TABLE effect_ledger (
  org_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text PRIMARY KEY,
  run_id uuid NOT NULL,
  step_seq int NOT NULL,
  attempt_group int NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('succeeded','failed')),
  result_ref text,
  result_json jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX effect_ledger_expires_idx ON effect_ledger (expires_at);

SELECT enable_tenant_rls('effect_ledger');

-- Grants for least-privilege app role
GRANT SELECT, INSERT, UPDATE, DELETE ON
  runs, run_events, run_steps, checkpoints, work_items, timers, effect_ledger
  TO platform_app;
