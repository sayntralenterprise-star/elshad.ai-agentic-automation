import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { DestinationStream } from 'pino';
import { pino } from 'pino';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
}

export interface LogContext {
  trace_id?: string;
  span_id?: string;
  org_id?: string | null;
  workspace_id?: string | null;
  run_id?: string | null;
  step_id?: string | null;
  principal_id?: string | null;
}

export interface SpanRecord {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean | undefined>;
  errorMessage?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();
const logContextStorage = new AsyncLocalStorage<LogContext>();

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function parseTraceparent(header: string | undefined): TraceContext | null {
  if (!header) return null;
  const match = TRACEPARENT_REGEX.exec(header.trim());
  if (!match) return null;
  const [, version, traceId, spanId, traceFlags] = match;
  if (version === 'ff' || traceId === '0'.repeat(32) || spanId === '0'.repeat(16)) {
    return null;
  }
  return {
    traceId: traceId!.toLowerCase(),
    spanId: spanId!.toLowerCase(),
    traceFlags: traceFlags!.toLowerCase(),
  };
}

export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`;
}

export function getActiveTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const merged = { ...logContextStorage.getStore(), ...ctx };
  return logContextStorage.run(merged, fn);
}

const recordedSpans: SpanRecord[] = [];
let recordSpansEnabled = false;

export function enableSpanRecording(enabled: boolean): void {
  recordSpansEnabled = enabled;
}

export function drainRecordedSpans(): SpanRecord[] {
  return recordedSpans.splice(0, recordedSpans.length);
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (ctx: TraceContext) => Promise<T> | T,
  incomingTraceparent?: string,
): Promise<T> {
  const parent = parseTraceparent(incomingTraceparent) ?? traceStorage.getStore();
  const ctx: TraceContext = {
    traceId: parent?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parent?.spanId,
    traceFlags: parent?.traceFlags ?? '01',
  };

  const startedAtMs = Date.now();
  return traceStorage.run(ctx, async () => {
    try {
      const result = await fn(ctx);
      if (recordSpansEnabled) {
        const endedAtMs = Date.now();
        recordedSpans.push({
          name,
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          parentSpanId: ctx.parentSpanId,
          startedAtMs,
          endedAtMs,
          durationMs: endedAtMs - startedAtMs,
          status: 'ok',
          attributes,
        });
      }
      return result;
    } catch (err) {
      if (recordSpansEnabled) {
        const endedAtMs = Date.now();
        recordedSpans.push({
          name,
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          parentSpanId: ctx.parentSpanId,
          startedAtMs,
          endedAtMs,
          durationMs: endedAtMs - startedAtMs,
          status: 'error',
          attributes,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  });
}

const SENSITIVE_KEY_PATTERN =
  /^(password|secret|token|authorization|api_key|apikey|master_key|client_secret|cookie|set-cookie|credential|private_key|refresh_token|access_token)$/i;

export function redactSensitiveValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSensitiveValue(v, seen);
    }
  }
  return out;
}

export interface PlatformLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  service: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  destination?: DestinationStream;
}

export function createLogger(opts: LoggerOptions): PlatformLogger {
  const pinoLogger = pino(
    {
      level: opts.level ?? 'info',
      messageKey: 'msg',
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level(label) {
          return { level: label };
        },
        bindings() {
          return { service: opts.service };
        },
      },
    },
    opts.destination,
  );

  const emit = (
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    fields: Record<string, unknown> = {},
  ): void => {
    const activeTrace = traceStorage.getStore();
    const activeLogCtx = logContextStorage.getStore();
    const sanitized = redactSensitiveValue(fields) as Record<string, unknown>;

    const payload: Record<string, unknown> = {
      trace_id: (sanitized.trace_id as string | undefined) ?? activeTrace?.traceId ?? activeLogCtx?.trace_id ?? null,
      span_id: (sanitized.span_id as string | undefined) ?? activeTrace?.spanId ?? activeLogCtx?.span_id ?? null,
      org_id: sanitized.org_id ?? activeLogCtx?.org_id ?? null,
      workspace_id: sanitized.workspace_id ?? activeLogCtx?.workspace_id ?? null,
      run_id: sanitized.run_id ?? activeLogCtx?.run_id ?? null,
      step_id: sanitized.step_id ?? activeLogCtx?.step_id ?? null,
      principal_id: sanitized.principal_id ?? activeLogCtx?.principal_id ?? null,
      ...sanitized,
    };

    pinoLogger[level](payload, msg);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

type LabelSet = Record<string, string | number>;

function serializeLabels(labels: LabelSet): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

export class CounterMetric {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: LabelSet = {}, amount = 1): void {
    const key = serializeLabels(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [labelKey, val] of this.values.entries()) {
      lines.push(`${this.name}${labelKey} ${val}`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.values.clear();
  }
}

export class HistogramMetric {
  private readonly buckets: number[];
  private readonly samples = new Map<
    string,
    { counts: number[]; sum: number; count: number; rawLabels: LabelSet }
  >();

  constructor(
    readonly name: string,
    readonly help: string,
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(value: number, labels: LabelSet = {}): void {
    const key = serializeLabels(labels);
    let entry = this.samples.get(key);
    if (!entry) {
      entry = {
        counts: new Array<number>(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
        rawLabels: labels,
      };
      this.samples.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) {
        entry.counts[i] = (entry.counts[i] ?? 0) + 1;
      }
    }
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [, entry] of this.samples.entries()) {
      for (let i = 0; i < this.buckets.length; i++) {
        const bLabels = serializeLabels({ ...entry.rawLabels, le: this.buckets[i]! });
        lines.push(`${this.name}_bucket${bLabels} ${entry.counts[i]}`);
      }
      const infLabels = serializeLabels({ ...entry.rawLabels, le: '+Inf' });
      lines.push(`${this.name}_bucket${infLabels} ${entry.count}`);
      const baseLabels = serializeLabels(entry.rawLabels);
      lines.push(`${this.name}_sum${baseLabels} ${entry.sum}`);
      lines.push(`${this.name}_count${baseLabels} ${entry.count}`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.samples.clear();
  }
}

export class MetricsRegistry {
  private readonly metrics: Array<CounterMetric | HistogramMetric> = [];

  counter(name: string, help: string): CounterMetric {
    const existing = this.metrics.find((m) => m.name === name);
    if (existing && existing instanceof CounterMetric) return existing;
    const metric = new CounterMetric(name, help);
    this.metrics.push(metric);
    return metric;
  }

  histogram(name: string, help: string, buckets?: number[]): HistogramMetric {
    const existing = this.metrics.find((m) => m.name === name);
    if (existing && existing instanceof HistogramMetric) return existing;
    const metric = new HistogramMetric(name, help, buckets);
    this.metrics.push(metric);
    return metric;
  }

  renderPrometheus(): string {
    return this.metrics.map((m) => m.render()).join('\n\n') + '\n';
  }

  resetAll(): void {
    for (const m of this.metrics) m.reset();
  }
}

export const defaultMetrics = new MetricsRegistry();
export const httpRequestsTotal = defaultMetrics.counter(
  'platform_api_requests_total',
  'Total HTTP requests handled by API gateway',
);
export const httpRequestDurationSeconds = defaultMetrics.histogram(
  'platform_api_request_duration_seconds',
  'HTTP request duration in seconds',
);
export const authEventsTotal = defaultMetrics.counter(
  'platform_auth_events_total',
  'Authentication and authorization outcomes',
);
