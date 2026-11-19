import { describe, expect, it } from 'vitest';
import { exportRunToOtelGenAi } from '@elshad/telemetry';

describe('@elshad/telemetry OTel GenAI export [E1.8]', () => {
  it('exports run and steps as OTLP resourceSpans with gen_ai semantic conventions', () => {
    const payload = exportRunToOtelGenAi({
      id: 'run_obs_1',
      orgId: 'org_1',
      workspaceId: 'ws_1',
      agentId: 'agt_1',
      status: 'failed',
      startedAt: '2026-11-19T10:00:00.000Z',
      finishedAt: '2026-11-19T10:00:02.000Z',
      tokensIn: 120,
      tokensOut: 45,
      costUsd: 0.0042,
      errorMessage: 'tool_error',
      steps: [
        {
          id: 'stp_1',
          stepIndex: 1,
          kind: 'llm_call',
          status: 'succeeded',
          startedAt: '2026-11-19T10:00:00.100Z',
          finishedAt: '2026-11-19T10:00:01.000Z',
          durationMs: 900,
          tokensIn: 120,
          tokensOut: 45,
          costUsd: 0.0042,
          model: 'openai:gpt-4o-mini',
        },
        {
          id: 'stp_2',
          stepIndex: 2,
          kind: 'tool_call',
          status: 'failed',
          startedAt: '2026-11-19T10:00:01.100Z',
          finishedAt: '2026-11-19T10:00:02.000Z',
          durationMs: 900,
          tokensIn: null,
          tokensOut: null,
          costUsd: 0,
          errorMessage: 'HTTP 502 from upstream',
        },
      ],
    });

    expect(payload.resourceSpans).toHaveLength(1);
    const spans = payload.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans).toHaveLength(3);
    expect(spans[0]!.name).toBe('agent.run run_obs_1');
    expect(spans[0]!.status.code).toBe(2);
    expect(
      spans[1]!.attributes.some(
        (a) => a.key === 'gen_ai.request.model' && a.value.stringValue === 'openai:gpt-4o-mini',
      ),
    ).toBe(true);
    expect(
      spans[2]!.attributes.some(
        (a) => a.key === 'gen_ai.operation.name' && a.value.stringValue === 'execute_tool',
      ),
    ).toBe(true);
    expect(spans[2]!.parentSpanId).toBe(spans[0]!.spanId);
  });
});
