import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  type Clock,
  type OrgId,
  type PrincipalId,
  type TenantContext,
} from '@elshad/domain';
import {
  EnvelopeSecretsProvider,
  InMemoryCache,
  InMemoryEventBus,
  InMemoryObjectStore,
  SlidingWindowRateLimiter,
} from './index.js';

class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): Date {
    return new Date(this.currentMs);
  }
  advance(ms: number): void {
    this.currentMs += ms;
  }
}

const makeCtx = (orgId: string): TenantContext => ({
  orgId: orgId as OrgId,
  principal: { id: 'prn_1' as PrincipalId, type: 'user' },
  requestId: 'req_1',
  traceId: 'trace_1',
});

describe('@elshad/platform-kit [D13, F.3]', () => {
  it('encrypts secrets with envelope AES-256-GCM, hides plaintext from metadata, and isolates by org', async () => {
    const clock = new FakeClock(1_760_000_000_000);
    const provider = new EnvelopeSecretsProvider(
      '0123456789abcdef0123456789abcdef0123456789abcdef',
      clock,
    );
    const orgA = makeCtx('org_a');
    const orgB = makeCtx('org_b');

    const secretText = 'sk-super-secret-key';
    const ref = await provider.put(orgA, new TextEncoder().encode(secretText), {
      name: 'openai_prod',
    });

    const meta = await provider.getMetadata(orgA, ref);
    expect(meta?.name).toBe('openai_prod');
    expect(meta?.keyVersion).toBe(1);
    expect(JSON.stringify(meta)).not.toContain(secretText);

    const resolved = await provider.resolve(orgA, ref, 'provider_call');
    expect(new TextDecoder().decode(resolved)).toBe(secretText);

    await expect(provider.resolve(orgB, ref, 'provider_call')).rejects.toThrowError(PlatformError);

    await provider.rotate(orgA, ref, new TextEncoder().encode('sk-rotated-key'));
    const rotatedMeta = await provider.getMetadata(orgA, ref);
    expect(rotatedMeta?.keyVersion).toBe(2);
    const rotatedVal = await provider.resolve(orgA, ref, 'provider_call');
    expect(new TextDecoder().decode(rotatedVal)).toBe('sk-rotated-key');
  });

  it('tracks sliding-window rate limits accurately across time advancement', async () => {
    const clock = new FakeClock(1_000_000);
    const cache = new InMemoryCache(clock);
    const limiter = new SlidingWindowRateLimiter(cache, clock);

    const r1 = await limiter.consume('key_1', 2, 60_000);
    const r2 = await limiter.consume('key_1', 2, 60_000);
    const r3 = await limiter.consume('key_1', 2, 60_000);

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    clock.advance(61_000);
    const r4 = await limiter.consume('key_1', 2, 60_000);
    expect(r4.allowed).toBe(true);
  });

  it('publishes and isolates CloudEvents and blobs by org', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    await bus.subscribe({ orgId: 'org_a' }, (e) => {
      received.push(e.id);
    });

    await bus.publish({
      specversion: '1.0',
      id: 'evt_1',
      source: 'platform/api',
      type: 'api_key.created',
      subject: 'key_1',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      orgid: 'org_a',
      schema: 1,
      data: {},
    });
    await bus.publish({
      specversion: '1.0',
      id: 'evt_2',
      source: 'platform/api',
      type: 'api_key.created',
      subject: 'key_2',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      orgid: 'org_b',
      schema: 1,
      data: {},
    });

    expect(received).toEqual(['evt_1']);

    const store = new InMemoryObjectStore();
    const ref = await store.put(makeCtx('org_a'), 'trace.json', Buffer.from('{"ok":true}'));
    const readBack = await store.get(makeCtx('org_a'), ref);
    expect(Buffer.from(readBack).toString('utf8')).toBe('{"ok":true}');
    await expect(store.get(makeCtx('org_b'), ref)).rejects.toThrowError(PlatformError);
  });
});
