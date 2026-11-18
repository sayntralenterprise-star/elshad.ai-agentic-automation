import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  microUsd,
  type OrgId,
  type PrincipalId,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import { EnvelopeSecretsProvider } from '@elshad/platform-kit';
import {
  AnthropicProvider,
  InMemoryCapabilityRegistry,
  MockModelProvider,
  ModelGateway,
  OpenAiCompatibleProvider,
  costMicroUsd,
} from './index.js';

const ctx: TenantContext = {
  orgId: '01930000-0000-7000-8000-000000000001' as OrgId,
  workspaceId: '01930000-0000-7000-8000-000000000002' as WorkspaceId,
  principal: {
    id: '01930000-0000-7000-8000-000000000003' as PrincipalId,
    type: 'user',
  },
  requestId: 'req_test_1',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
};

describe('@elshad/model-kit registry, pricing, providers, and gateway [E0.3-1, E0.3-2, N.2.6]', () => {
  it('calculates ceiling integer micro-USD cost accurately [D22, N.2.6]', () => {
    const cost = costMicroUsd(
      { tokensIn: 1200, tokensOut: 450, cachedInputTokens: 200 },
      {
        inputPerMillionMicroUsd: 2_500_000,
        outputPerMillionMicroUsd: 10_000_000,
        cachedInputPerMillionMicroUsd: 1_250_000,
      },
    );
    // (1200*2.5 + 450*10 + 200*1.25) = 3000 + 4500 + 250 = 7750 micro-USD
    expect(cost).toBe(microUsd(7750));

    // Fractional check rounds up via Math.ceil
    const fractional = costMicroUsd(
      { tokensIn: 1, tokensOut: 1 },
      {
        inputPerMillionMicroUsd: 150_000,
        outputPerMillionMicroUsd: 600_000,
        cachedInputPerMillionMicroUsd: 0,
      },
    );
    expect(fractional).toBe(microUsd(1));
  });

  it('routes logical tier, trips circuit breaker on primary failure, and falls back [FR-MG-4]', async () => {
    const gateway = new ModelGateway({ circuitFailureThreshold: 2, circuitResetMs: 60_000 });

    const failingPrimary = new MockModelProvider();
    Object.defineProperty(failingPrimary, 'providerId', { value: 'openai' });
    failingPrimary.setHandler(() => ({
      kind: 'error',
      code: 'MODEL_OVERLOADED',
      message: 'Simulated 503 overload',
    }));

    const healthyBackup = new MockModelProvider();
    healthyBackup.enqueue({ kind: 'answer', content: 'Recovered via fallback mock.' });

    gateway.registerProvider(failingPrimary);
    gateway.registerProvider(healthyBackup);
    gateway.setWorkspaceMapping({
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId!,
      tier: 'standard',
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbackChain: [{ provider: 'mock', model: 'mock/react-default' }],
    });

    const first = await gateway.complete(ctx, ctx.workspaceId!, {
      tier: 'standard',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(first.fallbackUsed).toBe(true);
    expect(first.routeTaken).toEqual({ provider: 'mock', model: 'mock/react-default' });
    expect(first.response.content).toBe('Recovered via fallback mock.');
    expect(gateway.isCircuitOpen('openai')).toBe(false);

    // Second failure trips the circuit breaker (threshold = 2)
    healthyBackup.enqueue({ kind: 'answer', content: 'Recovered second time.' });
    await gateway.complete(ctx, ctx.workspaceId!, {
      tier: 'standard',
      messages: [{ role: 'user', content: 'hello again' }],
    });
    expect(gateway.isCircuitOpen('openai')).toBe(true);
  });

  it('resolves BYOK encrypted secrets via EnvelopeSecretsProvider without leaking keys [FR-MG-3]', async () => {
    const secrets = new EnvelopeSecretsProvider('master-key-material-at-least-32-chars!!');
    const ref = await secrets.put(ctx, Buffer.from('sk-byok-secret-1234', 'utf8'), {
      name: 'openai-key',
    });

    let seenAuthHeader = '';
    const openai = new OpenAiCompatibleProvider({
      fetchFn: async (_url, init) => {
        seenAuthHeader = String((init?.headers as Record<string, string>)['authorization'] ?? '');
        return new Response(
          JSON.stringify({
            id: 'cmpl_test',
            choices: [{ finish_reason: 'stop', message: { content: 'BYOK OK' } }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const gateway = new ModelGateway({ secretsProvider: secrets });
    gateway.registerProvider(openai);
    gateway.registerByokKey({
      id: 'key_1',
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId!,
      provider: 'openai',
      label: 'primary',
      secretRef: ref,
      status: 'active',
    });

    const result = await gateway.complete(ctx, ctx.workspaceId!, {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(seenAuthHeader).toBe('Bearer sk-byok-secret-1234');
    expect(result.response.content).toBe('BYOK OK');

    // Cross-org BYOK resolution must fail with RES_NOT_FOUND
    const otherCtx: TenantContext = {
      ...ctx,
      orgId: '01930000-0000-7000-8000-999999999999' as OrgId,
    };
    await expect(secrets.resolve(otherCtx, ref, 'provider_call')).rejects.toThrow(PlatformError);
  });

  it('normalizes Anthropic responses and exposes capability queries [FR-MG-1, FR-MG-2]', async () => {
    const anthropic = new AnthropicProvider({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            id: 'msg_1',
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: 'Let me check the clock.' },
              { type: 'tool_use', id: 'toolu_1', name: 'current_time', input: {} },
            ],
            usage: { input_tokens: 50, output_tokens: 25 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const res = await anthropic.complete(
      {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Time?' },
        ],
      },
      'sk-ant-test',
    );
    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls).toEqual([{ id: 'toolu_1', name: 'current_time', arguments: {} }]);

    const catalog = new InMemoryCapabilityRegistry();
    expect(catalog.list({ tier: 'fast' }).length).toBeGreaterThanOrEqual(2);
  });
});
