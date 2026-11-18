import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  MetricsRegistry,
  createLogger,
  drainRecordedSpans,
  enableSpanRecording,
  formatTraceparent,
  parseTraceparent,
  runWithLogContext,
  withSpan,
} from './index.js';

describe('@elshad/telemetry [E0.1-8, L.3]', () => {
  it('redacts sensitive fields and emits all required structured JSON log fields', async () => {
    const lines: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString('utf8'));
        cb();
      },
    });
    const logger = createLogger({ service: 'api-test', level: 'info', destination: dest });

    await withSpan(
      'http.request',
      { route: '/api/v1/login' },
      async (ctx) => {
        runWithLogContext(
          {
            org_id: 'org_1',
            workspace_id: 'ws_1',
            principal_id: 'prn_1',
          },
          () => {
            logger.info('login attempt', {
              password: 'super-secret-password',
              nested: {
                api_key: 'sk-live-secret',
                token: 'tok_abc',
                safe: 'visible',
              },
            });
          },
        );
        expect(ctx.traceId).toHaveLength(32);
      },
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.msg).toBe('login attempt');
    expect(parsed.level).toBe('info');
    expect(parsed.ts).toBeTypeOf('string');
    expect(parsed.trace_id).toBeTypeOf('string');
    expect(parsed.span_id).toBeTypeOf('string');
    expect(parsed.org_id).toBe('org_1');
    expect(parsed.workspace_id).toBe('ws_1');
    expect(parsed).toHaveProperty('run_id');
    expect(parsed).toHaveProperty('step_id');
    expect(parsed.principal_id).toBe('prn_1');
    expect(parsed.password).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).token).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).safe).toBe('visible');
  });

  it('propagates trace_id from incoming W3C traceparent and records spans', async () => {
    enableSpanRecording(true);
    drainRecordedSpans();

    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceparent(incoming);
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');

    await withSpan(
      'parent',
      {},
      async (parentCtx) => {
        expect(parentCtx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        expect(parentCtx.parentSpanId).toBe('00f067aa0ba902b7');
        expect(formatTraceparent(parentCtx)).toMatch(
          /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/,
        );
      },
      incoming,
    );

    const spans = drainRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    enableSpanRecording(false);
  });

  it('renders Prometheus counters and histograms', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('platform_test_requests_total', 'Test counter');
    c.inc({ method: 'GET', status: 200 });
    c.inc({ method: 'GET', status: 200 }, 2);
    const h = reg.histogram('platform_test_latency_seconds', 'Test hist', [0.1, 1]);
    h.observe(0.05, { route: '/health' });

    const out = reg.renderPrometheus();
    expect(out).toContain('platform_test_requests_total{method="GET",status="200"} 3');
    expect(out).toContain('platform_test_latency_seconds_bucket{le="0.1",route="/health"} 1');
    expect(out).toContain('platform_test_latency_seconds_count{route="/health"} 1');
  });
});
