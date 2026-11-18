import { describe, expect, it } from 'vitest';
import {
  CodeAssertionGrader,
  ExactMatchGrader,
  JsonSchemaGrader,
  LlmJudgeGrader,
  ReleaseGateEvaluator,
  buildTestCaseFromRun,
  calculateStatistics,
  runExperiment,
  type GraderRecord,
  type TestCaseRecord,
} from './eval.js';

describe('Evaluation Engine & Graders [FR-EV-1..4, FR-EV-8, E1.3, N.4]', () => {
  it('ExactMatchGrader compares string and structured outputs with trim & case options', () => {
    // String exact match
    const res1 = ExactMatchGrader.evaluate(' Hello World! ', 'hello world!', {
      case_sensitive: false,
      trim: true,
    });
    expect(res1.passed).toBe(true);
    expect(res1.score).toBe(1.0);
    expect(res1.diff).toBeUndefined();

    // String mismatch with case sensitive
    const res2 = ExactMatchGrader.evaluate('Hello', 'hello', { case_sensitive: true });
    expect(res2.passed).toBe(false);
    expect(res2.score).toBe(0.0);
    expect(res2.diff).toBeDefined();

    // Deep object match
    const objA = { status: 'success', data: { id: 101, tags: ['a', 'b'] } };
    const objB = { status: 'success', data: { id: 101, tags: ['a', 'b'] } };
    const res3 = ExactMatchGrader.evaluate(objA, objB);
    expect(res3.passed).toBe(true);
    expect(res3.score).toBe(1.0);

    // Deep object mismatch
    const objC = { status: 'failed', data: { id: 101 } };
    const res4 = ExactMatchGrader.evaluate(objC, objA);
    expect(res4.passed).toBe(false);
    expect(res4.diff).toBeDefined();

    // Field path extraction
    const res5 = ExactMatchGrader.evaluate(
      { result: { verdict: 'OK' } },
      { result: { verdict: 'OK' } },
      { field_path: 'result.verdict' },
    );
    expect(res5.passed).toBe(true);
  });

  it('JsonSchemaGrader validates structured outputs against schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['answer', 'confidence'],
    };

    const valid = { answer: 'Platform is online', confidence: 0.99 };
    const resValid = JsonSchemaGrader.evaluate(valid, { schema });
    expect(resValid.passed).toBe(true);
    expect(resValid.score).toBe(1.0);

    const invalid = { answer: 12345 };
    const resInvalid = JsonSchemaGrader.evaluate(invalid, { schema });
    expect(resInvalid.passed).toBe(false);
    expect(resInvalid.score).toBe(0.0);
    expect(resInvalid.rationale).toContain('JSON schema validation failed');
  });

  it('CodeAssertionGrader evaluates sandboxed code expressions', () => {
    const code = `
      if (typeof actual.count !== 'number') return { passed: false, rationale: 'count must be number' };
      if (actual.count < 10) return { passed: false, rationale: 'count below threshold' };
      return { passed: true, score: 1.0, rationale: 'count meets criteria' };
    `;

    const passRes = CodeAssertionGrader.evaluate(
      { count: 15 },
      {},
      {},
      { code },
    );
    expect(passRes.passed).toBe(true);
    expect(passRes.score).toBe(1.0);

    const failRes = CodeAssertionGrader.evaluate(
      { count: 5 },
      {},
      {},
      { code },
    );
    expect(failRes.passed).toBe(false);
    expect(failRes.rationale).toBe('count below threshold');

    // Thrown error in code
    const errRes = CodeAssertionGrader.evaluate(
      null,
      {},
      {},
      { code: 'throw new Error("Invalid assertion input");' },
    );
    expect(errRes.passed).toBe(false);
    expect(errRes.rationale).toContain('Invalid assertion input');
  });

  it('LlmJudgeGrader scores rubric items on 1..5 scale with rationale per PRD N.4', () => {
    const inputs = { query: 'Summarize refund policy' };
    const expected = { summary: 'Customers may request a full refund within 30 days of purchase.' };
    const actual = { summary: 'Full refund is available within 30 days of purchase.' };

    const judgeRes = LlmJudgeGrader.evaluate(actual, expected, inputs, {}, {
      pass_threshold: 3.5,
    });

    expect(judgeRes.passed).toBe(true);
    expect(judgeRes.score).toBeGreaterThanOrEqual(3.5);
    expect(judgeRes.rubric_scores['accuracy']).toBeGreaterThanOrEqual(3.5);
    expect(judgeRes.rationale).toContain('LLM Judge evaluated');
  });

  it('Statistical comparison flags small sample warnings and Welch t-test significance', () => {
    // Small sample (< 5)
    const small = calculateStatistics([1, 1, 0.8], [0.5, 0.6]);
    expect(small.small_sample_warning).toBe(true);
    expect(small.statistically_significant).toBe(false);

    // Adequate sample with significant improvement
    const candidate = [1.0, 0.95, 0.98, 0.92, 0.99, 0.97];
    const baseline = [0.4, 0.45, 0.5, 0.38, 0.42, 0.48];
    const stats = calculateStatistics(candidate, baseline);
    expect(stats.small_sample_warning).toBe(false);
    expect(stats.statistically_significant).toBe(true);
    expect(stats.p_value).toBeLessThan(0.01);
  });

  it('ReleaseGateEvaluator verifies pass rate, minimum score, and regression ceilings', () => {
    const metrics = {
      total_cases: 10,
      passed_cases: 10,
      failed_cases: 0,
      pass_rate: 1.0,
      avg_score: 4.8,
      min_score: 4.5,
      max_score: 5.0,
      total_cost_micro_usd: 5000,
      avg_cost_micro_usd: 500,
      avg_duration_ms: 120,
      regression_count: 0,
    };

    const passVerdict = ReleaseGateEvaluator.evaluate(metrics, {
      min_pass_rate: 0.95,
      min_score: 4.0,
      fail_on_critical_regression: true,
    });
    expect(passVerdict.verdict).toBe('passed');
    expect(passVerdict.violations).toHaveLength(0);

    const failMetrics = {
      ...metrics,
      passed_cases: 8,
      failed_cases: 2,
      pass_rate: 0.8,
      regression_count: 1,
    };
    const failVerdict = ReleaseGateEvaluator.evaluate(
      failMetrics,
      { min_pass_rate: 0.95, fail_on_critical_regression: true },
      [{ id: 'r1', org_id: 'org1', experiment_id: 'e1', test_case_id: 'tc1', grader_results: [], passed: false, score: 0, duration_ms: 50, cost_micro_usd: 10, is_regression: true }],
    );
    expect(failVerdict.verdict).toBe('failed');
    expect(failVerdict.violations.some((v) => v.includes('Pass rate 80.0% is below threshold 95.0%'))).toBe(true);
    expect(failVerdict.violations.some((v) => v.includes('regression(s) detected'))).toBe(true);
  });

  it('runExperiment executes test cases against agent versions with cost and duration rollups', async () => {
    const testCases: TestCaseRecord[] = [
      {
        id: 'tc_1',
        org_id: 'org_test',
        workspace_id: 'ws_test',
        dataset_id: 'ds_test',
        name: 'Greeting case',
        inputs: { message: 'hello' },
        expected_output: { text: 'Hello, how can I help?' },
      },
      {
        id: 'tc_2',
        org_id: 'org_test',
        workspace_id: 'ws_test',
        dataset_id: 'ds_test',
        name: 'JSON format case',
        inputs: { query: 'account status' },
        expected_output: { status: 'active' },
      },
    ];

    const graders: GraderRecord[] = [
      {
        id: 'grd_exact',
        org_id: 'org_test',
        workspace_id: 'ws_test',
        name: 'Exact Match Grader',
        type: 'exact_match',
        config: { trim: true, case_sensitive: false },
      },
    ];

    const runner = async (agentVersionId: string, inputs: Record<string, unknown>) => {
      if (inputs['message'] === 'hello') {
        return {
          output: { text: 'Hello, how can I help?' },
          costMicroUsd: 1200,
          durationMs: 45,
          runId: 'run_sample_1',
        };
      }
      return {
        output: { status: 'active' },
        costMicroUsd: 1500,
        durationMs: 60,
        runId: 'run_sample_2',
      };
    };

    const expResult = await runExperiment(
      { orgId: 'org_test', workspaceId: 'ws_test' },
      {
        experimentId: 'exp_1',
        datasetId: 'ds_test',
        agentVersionId: 'agv_candidate',
        graders,
        testCases,
        releaseGateConfig: { min_pass_rate: 1.0 },
        runner,
      },
    );

    expect(expResult.metrics.total_cases).toBe(2);
    expect(expResult.metrics.passed_cases).toBe(2);
    expect(expResult.metrics.pass_rate).toBe(1.0);
    expect(expResult.metrics.total_cost_micro_usd).toBe(2700);
    expect(expResult.gateVerdict.verdict).toBe('warning'); // warning due to small sample size < 5
    expect(expResult.results).toHaveLength(2);
    expect(expResult.results[0]!.passed).toBe(true);
  });

  it('buildTestCaseFromRun converts a run into an evaluation test case with provenance [FR-EV-8]', () => {
    const tc = buildTestCaseFromRun({
      orgId: 'org_alpha',
      workspaceId: 'ws_alpha',
      datasetId: 'ds_alpha',
      name: 'Regression from failed production run #42',
      runId: 'run_prod_42',
      stepId: 'stp_failed_3',
      runInputs: { prompt: 'Calculate annual ROI with 5% inflation' },
      runOutput: { result: 'Calculation failed with timeout' },
      expectedOutput: { result: 'Annual ROI: 7.2%' },
      difficulty: 'hard',
      tags: ['production_incident'],
    });

    expect(tc.id.startsWith('tc_')).toBe(true);
    expect(tc.dataset_id).toBe('ds_alpha');
    expect(tc.source_run_id).toBe('run_prod_42');
    expect(tc.source_step_id).toBe('stp_failed_3');
    expect(tc.difficulty).toBe('hard');
    expect(tc.tags).toContain('production_incident');
    expect(tc.tags).toContain('captured_from_run');
    expect(tc.expected_output).toEqual({ result: 'Annual ROI: 7.2%' });
  });
});
