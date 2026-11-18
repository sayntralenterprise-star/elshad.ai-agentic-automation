-- 0010_s13_evaluation.sql
-- PRD E1.3 / FR-EV-1..4, FR-EV-8 / §5.6 / §7.3.9 / Appendix N.4 (Evaluation v1)

-- 1. Golden Evaluation Datasets (FR-EV-1, §7.3.9)
CREATE TABLE datasets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  tags jsonb NOT NULL DEFAULT '[]',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX datasets_org_workspace_idx
  ON datasets (org_id, workspace_id, created_at DESC);

SELECT enable_tenant_rls('datasets');

-- 2. Test Cases with Rubrics, Difficulty and Weights (FR-EV-1, FR-EV-8)
CREATE TABLE test_cases (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  name text NOT NULL,
  inputs jsonb NOT NULL,
  expected_output jsonb,
  rubric jsonb NOT NULL DEFAULT '{}',
  tags jsonb NOT NULL DEFAULT '[]',
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard', 'adversarial')),
  weight numeric NOT NULL DEFAULT 1.0 CHECK (weight > 0),
  source_run_id uuid,
  source_step_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX test_cases_dataset_idx
  ON test_cases (org_id, dataset_id, created_at DESC);

SELECT enable_tenant_rls('test_cases');

-- 3. Pluggable Graders (FR-EV-2: exact_match, json_schema, code_assertion, llm_judge)
CREATE TABLE graders (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  type text NOT NULL CHECK (type IN ('exact_match', 'json_schema', 'code_assertion', 'llm_judge')),
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX graders_org_workspace_idx
  ON graders (org_id, workspace_id, name);

SELECT enable_tenant_rls('graders');

-- 4. Experiments & Release Gates (FR-EV-3, FR-EV-4)
CREATE TABLE experiments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  agent_version_id uuid NOT NULL REFERENCES agent_versions(id),
  baseline_version_id uuid REFERENCES agent_versions(id),
  grader_ids jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  release_gate_config jsonb NOT NULL DEFAULT '{}',
  gate_verdict text CHECK (gate_verdict IN ('passed', 'failed', 'warning')),
  metrics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX experiments_org_workspace_idx
  ON experiments (org_id, workspace_id, created_at DESC);

SELECT enable_tenant_rls('experiments');

-- 5. Experiment Results Matrix (FR-EV-3)
CREATE TABLE experiment_results (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  run_id uuid,
  actual_output jsonb,
  grader_results jsonb NOT NULL DEFAULT '[]',
  passed boolean NOT NULL,
  score numeric NOT NULL DEFAULT 0.0,
  duration_ms int NOT NULL DEFAULT 0,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  is_regression boolean NOT NULL DEFAULT false,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX experiment_results_exp_case_idx
  ON experiment_results (org_id, experiment_id, test_case_id);

SELECT enable_tenant_rls('experiment_results');

GRANT SELECT, INSERT, UPDATE, DELETE ON
  datasets, test_cases, graders, experiments, experiment_results
  TO platform_app;
