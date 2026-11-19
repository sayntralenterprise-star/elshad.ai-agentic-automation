import { createHash } from 'node:crypto';

function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/(?:bearer|sk-|secret|token|password|api_key)[=\s:]+\S+/gi, '[REDACTED]');
}

export interface OtelRunStepInput {
  id: string;
  stepIndex: number;
  kind: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  model?: string | null;
  errorMessage?: string | null;
}

export interface OtelRunInput {
  id: string;
  orgId: string;
  workspaceId: string;
  agentId: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  errorMessage?: string | null;
  steps: OtelRunStepInput[];
}

export interface OtelAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: number };
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelAttribute[];
  status: { code: 1 | 2; message?: string };
}

export interface OtelExportPayload {
  resourceSpans: Array<{
    resource: {
      attributes: OtelAttribute[];
    };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OtelSpan[];
    }>;
  }>;
}

function deterministicHex(seed: string, length: number): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, length);
}

function toNano(iso: string | null, fallbackMs: number): string {
  const ms = iso ? Date.parse(iso) : fallbackMs;
  const validMs = Number.isFinite(ms) ? ms : fallbackMs;
  return String(BigInt(Math.max(0, Math.floor(validMs))) * 1_000_000n);
}

function strAttr(key: string, val: string): OtelAttribute {
  return { key, value: { stringValue: val } };
}

function intAttr(key: string, val: number): OtelAttribute {
  return { key, value: { intValue: String(Math.round(val)) } };
}

function dblAttr(key: string, val: number): OtelAttribute {
  return { key, value: { doubleValue: val } };
}

/**
 * Exports a platform Run and its steps as an OpenTelemetry OTLP-compatible JSON
 * payload using GenAI semantic conventions.
 */
export function exportRunToOtelGenAi(run: OtelRunInput): OtelExportPayload {
  const traceId = deterministicHex(`trace:${run.id}`, 32);
  const rootSpanId = deterministicHex(`span:run:${run.id}`, 16);
  const nowMs = Date.now();
  const rootStartNano = toNano(run.startedAt, nowMs);
  const rootEndNano = toNano(run.finishedAt ?? run.startedAt, nowMs);

  const rootAttrs: OtelAttribute[] = [
    strAttr('gen_ai.operation.name', 'invoke_agent'),
    strAttr('elshad.run.id', run.id),
    strAttr('elshad.org.id', run.orgId),
    strAttr('elshad.workspace.id', run.workspaceId),
    strAttr('elshad.run.status', run.status),
    intAttr('gen_ai.usage.input_tokens', run.tokensIn),
    intAttr('gen_ai.usage.output_tokens', run.tokensOut),
    dblAttr('elshad.cost.usd', run.costUsd),
  ];
  if (run.agentId) {
    rootAttrs.push(strAttr('gen_ai.agent.id', run.agentId));
  }

  const spans: OtelSpan[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: `agent.run ${run.id}`,
      kind: 1,
      startTimeUnixNano: rootStartNano,
      endTimeUnixNano: rootEndNano,
      attributes: rootAttrs,
      status:
        run.status === 'failed'
          ? {
              code: 2,
              message: sanitizeErrorMessage(run.errorMessage ?? 'Run failed'),
            }
          : { code: 1 },
    },
  ];

  for (const step of run.steps) {
    const startMs = Date.parse(step.startedAt) || nowMs;
    const endMs =
      (step.finishedAt ? Date.parse(step.finishedAt) : null) ??
      startMs + (step.durationMs ?? 0);
    const opName =
      step.kind === 'llm_call' || step.kind === 'model'
        ? 'chat'
        : step.kind === 'tool_call'
          ? 'execute_tool'
          : step.kind;

    const stepAttrs: OtelAttribute[] = [
      strAttr('gen_ai.operation.name', opName),
      strAttr('elshad.step.id', step.id),
      intAttr('elshad.step.index', step.stepIndex),
      strAttr('elshad.step.kind', step.kind),
      strAttr('elshad.step.status', step.status),
    ];
    if (step.model) {
      stepAttrs.push(strAttr('gen_ai.system', step.model.split(':')[0] ?? 'openai'));
      stepAttrs.push(strAttr('gen_ai.request.model', step.model));
    }
    if (step.tokensIn !== null) {
      stepAttrs.push(intAttr('gen_ai.usage.input_tokens', step.tokensIn));
    }
    if (step.tokensOut !== null) {
      stepAttrs.push(intAttr('gen_ai.usage.output_tokens', step.tokensOut));
    }
    if (step.costUsd !== null) {
      stepAttrs.push(dblAttr('elshad.cost.usd', step.costUsd));
    }

    spans.push({
      traceId,
      spanId: deterministicHex(`span:step:${step.id}`, 16),
      parentSpanId: rootSpanId,
      name: `${opName} #${step.stepIndex}`,
      kind: 3,
      startTimeUnixNano: String(BigInt(Math.max(0, Math.floor(startMs))) * 1_000_000n),
      endTimeUnixNano: String(BigInt(Math.max(0, Math.floor(endMs))) * 1_000_000n),
      attributes: stepAttrs,
      status:
        step.status === 'failed'
          ? {
              code: 2,
              message: sanitizeErrorMessage(step.errorMessage ?? 'Step failed'),
            }
          : { code: 1 },
    });
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            strAttr('service.name', 'elshad-agent-platform'),
            strAttr('telemetry.sdk.name', '@elshad/telemetry'),
            strAttr('gen_ai.semantic_conventions.version', '1.27.0'),
          ],
        },
        scopeSpans: [
          {
            scope: { name: '@elshad/telemetry', version: '0.1.0' },
            spans,
          },
        ],
      },
    ],
  };
}
