import { describe, expect, it } from 'vitest';
import {
  ERROR_CATALOGUE,
  ExternalPrefix,
  PlatformError,
  RUN_TRANSITIONS,
  addMicroUsd,
  assertAgentVersionTransition,
  assertApprovalTransition,
  assertDeploymentTransition,
  assertRunTransition,
  assertWorkItemTransition,
  formatMicroUsdAsUsd,
  fromExternalId,
  generateUuidv7,
  isValidUuid,
  microUsd,
  resolveEntityUuid,
  toErrorEnvelope,
  toExternalId,
  usdToMicroUsd,
} from './index.js';

describe('@elshad/domain ids [D21]', () => {
  it('generates valid RFC 9562 UUIDv7 ordered by timestamp', () => {
    const older = generateUuidv7(1_700_000_000_000);
    const newer = generateUuidv7(1_700_000_001_000);
    expect(isValidUuid(older)).toBe(true);
    expect(isValidUuid(newer)).toBe(true);
    expect(older[14]).toBe('7');
    expect(older < newer).toBe(true);
  });

  it('round-trips every entity prefix cleanly', () => {
    const id = generateUuidv7(1_760_000_000_123);
    for (const [kind, prefix] of Object.entries(ExternalPrefix)) {
      const ext = toExternalId(kind as keyof typeof ExternalPrefix, id);
      expect(ext.startsWith(prefix)).toBe(true);
      expect(fromExternalId(kind as keyof typeof ExternalPrefix, ext)).toBe(id);
      expect(resolveEntityUuid(kind as keyof typeof ExternalPrefix, ext)).toBe(id);
      expect(resolveEntityUuid(kind as keyof typeof ExternalPrefix, id)).toBe(id);
    }
  });

  it('rejects mismatched prefix or invalid UUID', () => {
    const id = generateUuidv7();
    const ext = toExternalId('agent', id);
    expect(() => fromExternalId('run', ext)).toThrow();
    expect(() => toExternalId('agent', 'not-a-uuid')).toThrow();
  });
});

describe('@elshad/domain money [D22]', () => {
  it('stores integer micro-USD without float drift', () => {
    const a = usdToMicroUsd(0.03);
    const b = usdToMicroUsd(0.07);
    const sum = addMicroUsd(a, b);
    expect(sum).toBe(microUsd(100_000));
    expect(formatMicroUsdAsUsd(sum, 2)).toBe('$0.10');
  });

  it('rejects negative or non-integer micro-USD', () => {
    expect(() => microUsd(-1)).toThrow();
    expect(() => microUsd(1.5)).toThrow();
    expect(() => usdToMicroUsd(-0.5)).toThrow();
  });
});

describe('@elshad/domain errors [O.2, B.1]', () => {
  it('contains all 49 documented error codes from Appendix O.2', () => {
    expect(Object.keys(ERROR_CATALOGUE)).toHaveLength(49);
    expect(ERROR_CATALOGUE.RES_CONFLICT.http).toBe(409);
    expect(ERROR_CATALOGUE.POL_DENIED.failureClass).toBe('policy_violation');
    expect(ERROR_CATALOGUE.BUD_HARD_LIMIT.http).toBe(402);
    expect(ERROR_CATALOGUE.TOOL_SSRF_BLOCKED.http).toBe(403);
  });

  it('formats PlatformError and unknown errors into the standard B.1 envelope', () => {
    const err = new PlatformError('POL_APPROVAL_REQUIRED', 'Needs approval', {
      approval_id: 'apr_1',
    });
    const env = toErrorEnvelope(err, 'req_123', '4bf92f3577b34da6a3ce929d0e0e4736');
    expect(env.status).toBe(202);
    expect(env.body.error.code).toBe('POL_APPROVAL_REQUIRED');
    expect(env.body.error.request_id).toBe('req_123');
    expect(env.body.error.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(env.body.error.doc_url).toContain('POL_APPROVAL_REQUIRED');

    const unknown = toErrorEnvelope(new Error('boom'), 'req_124', 'trace_1');
    expect(unknown.status).toBe(500);
    expect(unknown.body.error.code).toBe('SYS_INTERNAL');
    expect(unknown.body.error.details).toEqual({});
  });
});

describe('@elshad/domain state machines [N.1]', () => {
  it('allows every documented run transition and rejects illegal transitions with RES_CONFLICT', () => {
    for (const [from, targets] of Object.entries(RUN_TRANSITIONS)) {
      for (const to of targets) {
        expect(() =>
          assertRunTransition(
            from as keyof typeof RUN_TRANSITIONS,
            to as keyof typeof RUN_TRANSITIONS,
          ),
        ).not.toThrow();
      }
    }

    expect(() => assertRunTransition('succeeded', 'running')).toThrowError(PlatformError);
    try {
      assertRunTransition('queued', 'succeeded');
    } catch (e) {
      expect(e).toBeInstanceOf(PlatformError);
      expect((e as PlatformError).code).toBe('RES_CONFLICT');
    }
  });

  it('enforces approval, agent_version, deployment, and work_item transitions', () => {
    expect(() => assertApprovalTransition('pending', 'info_requested')).not.toThrow();
    expect(() => assertApprovalTransition('approved', 'rejected')).toThrow();

    expect(() => assertAgentVersionTransition('draft', 'published')).not.toThrow();
    expect(() => assertAgentVersionTransition('published', 'draft')).toThrow();

    expect(() => assertDeploymentTransition('pending', 'active')).not.toThrow();
    expect(() => assertDeploymentTransition('rolled_back', 'active')).toThrow();

    expect(() => assertWorkItemTransition('ready', 'leased')).not.toThrow();
    expect(() => assertWorkItemTransition('done', 'ready')).toThrow();
  });
});
