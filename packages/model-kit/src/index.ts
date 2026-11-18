import {
  PlatformError,
  SystemClock,
  microUsd,
  type Clock,
  type ErrorCode,
  type MicroUsd,
  type TenantContext,
} from '@elshad/domain';
import type { SecretRef, SecretsProvider } from '@elshad/platform-kit';
import { withSpan } from '@elshad/telemetry';

export type ModelTier = 'fast' | 'standard' | 'reasoning' | 'embedding';
export type RoutingStrategy = 'latency' | 'cost' | 'quality' | 'capability';

export interface ModelPricing {
  /** Micro-USD per 1,000,000 input tokens */
  readonly inputPerMillionMicroUsd: number;
  /** Micro-USD per 1,000,000 output tokens */
  readonly outputPerMillionMicroUsd: number;
  /** Micro-USD per 1,000,000 cached input tokens */
  readonly cachedInputPerMillionMicroUsd: number;
}

export interface TokenUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cachedInputTokens?: number;
}

export interface ModelCapability {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly tier: ModelTier;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsTools: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly avgLatencyMs: number;
  readonly qualityScore: number;
  readonly pricing: ModelPricing;
  readonly status: 'active' | 'deprecated';
}

export const DEFAULT_MODEL_CATALOG: readonly ModelCapability[] = [
  {
    id: 'mock/react-default',
    provider: 'mock',
    displayName: 'Mock ReAct Default (Deterministic)',
    tier: 'standard',
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsStreaming: true,
    avgLatencyMs: 15,
    qualityScore: 80,
    pricing: {
      inputPerMillionMicroUsd: 500_000,
      outputPerMillionMicroUsd: 1_500_000,
      cachedInputPerMillionMicroUsd: 125_000,
    },
    status: 'active',
  },
  {
    id: 'mock/react-fast',
    provider: 'mock',
    displayName: 'Mock ReAct Fast',
    tier: 'fast',
    contextWindowTokens: 64_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsStreaming: true,
    avgLatencyMs: 5,
    qualityScore: 70,
    pricing: {
      inputPerMillionMicroUsd: 150_000,
      outputPerMillionMicroUsd: 600_000,
      cachedInputPerMillionMicroUsd: 50_000,
    },
    status: 'active',
  },
  {
    id: 'mock/react-reasoning',
    provider: 'mock',
    displayName: 'Mock ReAct Reasoning',
    tier: 'reasoning',
    contextWindowTokens: 200_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsStreaming: true,
    avgLatencyMs: 40,
    qualityScore: 95,
    pricing: {
      inputPerMillionMicroUsd: 3_000_000,
      outputPerMillionMicroUsd: 15_000_000,
      cachedInputPerMillionMicroUsd: 750_000,
    },
    status: 'active',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'OpenAI GPT-4o Mini',
    tier: 'fast',
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsStreaming: true,
    avgLatencyMs: 320,
    qualityScore: 82,
    pricing: {
      inputPerMillionMicroUsd: 150_000,
      outputPerMillionMicroUsd: 600_000,
      cachedInputPerMillionMicroUsd: 75_000,
    },
    status: 'active',
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'OpenAI GPT-4o',
    tier: 'standard',
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsStreaming: true,
    avgLatencyMs: 650,
    qualityScore: 92,
    pricing: {
      inputPerMillionMicroUsd: 2_500_000,
      outputPerMillionMicroUsd: 10_000_000,
      cachedInputPerMillionMicroUsd: 1_250_000,
    },
    status: 'active',
  },
  {
    id: 'claude-3-5-sonnet-latest',
    provider: 'anthropic',
    displayName: 'Anthropic Claude 3.5 Sonnet',
    tier: 'standard',
    contextWindowTokens: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsStreaming: true,
    avgLatencyMs: 700,
    qualityScore: 94,
    pricing: {
      inputPerMillionMicroUsd: 3_000_000,
      outputPerMillionMicroUsd: 15_000_000,
      cachedInputPerMillionMicroUsd: 300_000,
    },
    status: 'active',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'google',
    displayName: 'Google Gemini 2.5 Pro',
    tier: 'reasoning',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsStreaming: true,
    avgLatencyMs: 900,
    qualityScore: 96,
    pricing: {
      inputPerMillionMicroUsd: 1_250_000,
      outputPerMillionMicroUsd: 10_000_000,
      cachedInputPerMillionMicroUsd: 312_500,
    },
    status: 'active',
  },
  {
    id: 'ollama/llama3.2',
    provider: 'openai_compatible',
    displayName: 'Ollama Llama 3.2 (Local)',
    tier: 'fast',
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    supportsStructuredOutput: false,
    supportsVision: false,
    supportsStreaming: true,
    avgLatencyMs: 250,
    qualityScore: 74,
    pricing: {
      inputPerMillionMicroUsd: 0,
      outputPerMillionMicroUsd: 0,
      cachedInputPerMillionMicroUsd: 0,
    },
    status: 'active',
  },
];

/**
 * PRD N.2.6 ceiling token pricing formula in integer micro-USD (1 USD = 1,000,000 micro-USD).
 */
export function costMicroUsd(usage: TokenUsage, pricing: ModelPricing): MicroUsd {
  const cached = usage.cachedInputTokens ?? 0;
  const raw =
    (usage.tokensIn * pricing.inputPerMillionMicroUsd +
      usage.tokensOut * pricing.outputPerMillionMicroUsd +
      cached * pricing.cachedInputPerMillionMicroUsd) /
    1_000_000;
  return microUsd(Math.ceil(Math.max(0, raw)));
}

/**
 * PRD N.2.3 fallback token estimator (~3.2 chars per token).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.2);
}

export interface CapabilityRegistry {
  list(filter?: { tier?: ModelTier; provider?: string; supportsTools?: boolean }): ModelCapability[];
  get(provider: string, modelId: string): ModelCapability | undefined;
  register(cap: ModelCapability): void;
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly items = new Map<string, ModelCapability>();

  constructor(initialCatalog: readonly ModelCapability[] = DEFAULT_MODEL_CATALOG) {
    for (const cap of initialCatalog) {
      this.register(cap);
    }
  }

  private key(provider: string, modelId: string): string {
    return `${provider}::${modelId}`;
  }

  register(cap: ModelCapability): void {
    this.items.set(this.key(cap.provider, cap.id), cap);
  }

  get(provider: string, modelId: string): ModelCapability | undefined {
    return this.items.get(this.key(provider, modelId));
  }

  list(filter?: { tier?: ModelTier; provider?: string; supportsTools?: boolean }): ModelCapability[] {
    return [...this.items.values()].filter((cap) => {
      if (filter?.tier && cap.tier !== filter.tier) return false;
      if (filter?.provider && cap.provider !== filter.provider) return false;
      if (filter?.supportsTools !== undefined && cap.supportsTools !== filter.supportsTools) {
        return false;
      }
      return true;
    });
  }
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ModelCompletionRequest {
  readonly tier?: ModelTier;
  readonly provider?: string;
  readonly model?: string;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly responseSchema?: Record<string, unknown>;
  readonly routingStrategy?: RoutingStrategy;
  readonly fallbackChain?: readonly ModelTarget[];
  readonly metadata?: Record<string, string>;
}

export interface ModelCompletionResponse {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  readonly content: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage: TokenUsage;
  readonly confidence?: number;
  readonly refusalReason?: string;
  readonly latencyMs: number;
}

export interface ModelStreamChunk {
  readonly type: 'delta' | 'tool_call' | 'done';
  readonly delta?: string;
  readonly toolCall?: ModelToolCall;
  readonly response?: ModelCompletionResponse;
}

export interface ModelTarget {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
}

export interface ModelProvider {
  readonly providerId: string;
  complete(
    req: ModelCompletionRequest & { provider: string; model: string; baseUrl?: string },
    apiKey?: string,
  ): Promise<ModelCompletionResponse>;
  stream(
    req: ModelCompletionRequest & { provider: string; model: string; baseUrl?: string },
    apiKey?: string,
  ): AsyncIterable<ModelStreamChunk>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function mapHttpStatusToErrorCode(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'MODEL_AUTH_FAILED';
  if (status === 429) return 'MODEL_RATE_LIMIT';
  if (status === 400 || status === 422) return 'MODEL_CONTEXT_EXCEEDED';
  return 'MODEL_OVERLOADED';
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly providerId: string;
  private readonly defaultBaseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options?: {
    providerId?: string;
    defaultBaseUrl?: string;
    fetchFn?: FetchLike;
  }) {
    this.providerId = options?.providerId ?? 'openai';
    this.defaultBaseUrl = options?.defaultBaseUrl ?? 'https://api.openai.com/v1';
    this.fetchFn = options?.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  }

  async complete(
    req: ModelCompletionRequest & { provider: string; model: string; baseUrl?: string },
    apiKey?: string,
  ): Promise<ModelCompletionResponse> {
    const startMs = Date.now();
    const baseUrl = (req.baseUrl ?? this.defaultBaseUrl).replace(/\/$/, '');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
            }
          : {}),
      })),
      temperature: req.temperature ?? 0.2,
    };

    if (req.maxOutputTokens !== undefined) {
      body['max_tokens'] = req.maxOutputTokens;
    }
    if (req.tools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }
    if (req.responseSchema) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: 'agent_output',
          strict: true,
          schema: req.responseSchema,
        },
      };
    }

    const res = await this.fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const code = mapHttpStatusToErrorCode(res.status);
      const errText = await res.text().catch(() => '');
      throw new PlatformError(code, `OpenAI-compatible provider returned HTTP ${res.status}`, {
        provider: req.provider,
        model: req.model,
        status: res.status,
        body: errText.slice(0, 400),
      });
    }

    const json = (await res.json()) as {
      id?: string;
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          refusal?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };

    const choice = json.choices?.[0];
    const message = choice?.message;
    if (message?.refusal) {
      throw new PlatformError('MODEL_REFUSAL', message.refusal, {
        provider: req.provider,
        model: req.model,
      });
    }

    const toolCalls: ModelToolCall[] = (message?.tool_calls ?? []).map((tc) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(tc.function.arguments || '{}') as unknown;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          parsedArgs = raw as Record<string, unknown>;
        }
      } catch {
        throw new PlatformError('MODEL_OUTPUT_INVALID', 'Invalid JSON tool arguments from model', {
          tool: tc.function.name,
        });
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
      };
    });

    const content = message?.content ?? '';
    const tokensIn =
      json.usage?.prompt_tokens ??
      req.messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
    const tokensOut = json.usage?.completion_tokens ?? estimateTokenCount(content);
    const cachedInputTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      id: json.id ?? `cmpl_${Date.now()}`,
      provider: req.provider,
      model: req.model,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : choice?.finish_reason === 'length'
            ? 'length'
            : 'stop',
      content,
      toolCalls,
      usage: { tokensIn, tokensOut, cachedInputTokens },
      latencyMs: Date.now() - startMs,
    };
  }

  async *stream(
    req: ModelCompletionRequest & { provider: string; model: string; baseUrl?: string },
    apiKey?: string,
  ): AsyncIterable<ModelStreamChunk> {
    const response = await this.complete(req, apiKey);
    if (response.content.length > 0) {
      yield { type: 'delta', delta: response.content };
    }
    for (const tc of response.toolCalls) {
      yield { type: 'tool_call', toolCall: tc };
    }
    yield { type: 'done', response };
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly providerId = 'anthropic';
  private readonly defaultBaseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options?: { defaultBaseUrl?: string; fetchFn?: FetchLike }) {
    this.defaultBaseUrl = options?.defaultBaseUrl ?? 'https://api.anthropic.com/v1';
    this.fetchFn = options?.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  }

  async complete(
    req: ModelCompletionRequest & { provider: string; model: string; baseUrl?: string },
    apiKey?: string,
  ): Promise<ModelCompletionResponse> {
    const startMs = Date.now();
    if (!apiKey) {
      throw new PlatformError('MODEL_AUTH_FAILED', 'Anthropic provider requires an API key.');
    }

    const baseUrl = (req.baseUrl ?? this.defaultBaseUrl).replace(/\/$/, '');
    const systemText = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const nonSystem = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content:
          m.role === 'tool'
            ? `[Tool ${m.toolName ?? 'unknown'} (${m.toolCallId ?? 'call'})]: ${m.content}`
            : m.content,
      }));

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages: nonSystem,
      ...(systemText ? { system: systemText } : {}),
    };

    if (req.tools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const res = await this.fetchFn(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const code = mapHttpStatusToErrorCode(res.status);
      const errText = await res.text().catch(() => '');
      throw new PlatformError(code, `Anthropic provider returned HTTP ${res.status}`, {
        provider: req.provider,
        model: req.model,
        status: res.status,
        body: errText.slice(0, 400),
      });
    }

    const json = (await res.json()) as {
      id?: string;
      stop_reason?: string;
      content?: Array<{
        type: 'text' | 'tool_use';
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    const textParts: string[] = [];
    const toolCalls: ModelToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          id: block.id ?? `toolu_${toolCalls.length + 1}`,
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }

    const content = textParts.join('\n');
    const tokensIn = json.usage?.input_tokens ?? estimateTokenCount(systemText);
    const tokensOut = json.usage?.output_tokens ?? estimateTokenCount(content);
    const cachedInputTokens = json.usage?.cache_read_input_tokens ?? 0;

    return {
      id: json.id ?? `msg_${Date.now()}`,
      provider: req.provider,
      model: req.model,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : json.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop',
      content,
      toolCalls,
      usage: { tokensIn, tokensOut, cachedInputTokens },
      latencyMs: Date.now() - startMs,
    };
  }

  async *stream(
    req: ModelCompletionRequest & { provider: string; model: string; baseUrl?: string },
    apiKey?: string,
  ): AsyncIterable<ModelStreamChunk> {
    const response = await this.complete(req, apiKey);
    if (response.content.length > 0) {
      yield { type: 'delta', delta: response.content };
    }
    for (const tc of response.toolCalls) {
      yield { type: 'tool_call', toolCall: tc };
    }
    yield { type: 'done', response };
  }
}

export type MockTurnBehavior =
  | {
      readonly kind: 'answer';
      readonly content: string;
      readonly tokensIn?: number;
      readonly tokensOut?: number;
      readonly cachedInputTokens?: number;
      readonly confidence?: number;
    }
  | {
      readonly kind: 'tool_calls';
      readonly thought?: string;
      readonly calls: readonly ModelToolCall[];
      readonly tokensIn?: number;
      readonly tokensOut?: number;
    }
  | {
      readonly kind: 'error';
      readonly code: ErrorCode;
      readonly message: string;
    };

export type MockHandler = (
  req: ModelCompletionRequest & { provider: string; model: string },
  callIndex: number,
) => Promise<MockTurnBehavior> | MockTurnBehavior;

/**
 * Deterministic programmable mock ModelProvider for local dev and integration suites [E0.3-2].
 * Requires zero external API keys.
 */
export class MockModelProvider implements ModelProvider {
  readonly providerId = 'mock';
  private readonly queue: MockTurnBehavior[] = [];
  private customHandler: MockHandler | null = null;
  private callCount = 0;

  enqueue(...turns: MockTurnBehavior[]): void {
    this.queue.push(...turns);
  }

  setHandler(handler: MockHandler | null): void {
    this.customHandler = handler;
  }

  get callsExecuted(): number {
    return this.callCount;
  }

  reset(): void {
    this.queue.length = 0;
    this.customHandler = null;
    this.callCount = 0;
  }

  async complete(
    req: ModelCompletionRequest & { provider: string; model: string },
  ): Promise<ModelCompletionResponse> {
    const idx = this.callCount++;
    const behavior: MockTurnBehavior = this.customHandler
      ? await this.customHandler(req, idx)
      : (this.queue.shift() ?? this.defaultBehavior(req));

    if (behavior.kind === 'error') {
      throw new PlatformError(behavior.code, behavior.message, {
        provider: req.provider,
        model: req.model,
        callIndex: idx,
      });
    }

    const promptTokens = req.messages.reduce(
      (sum, m) => sum + Math.max(4, estimateTokenCount(m.content)),
      0,
    );

    if (behavior.kind === 'tool_calls') {
      const content = behavior.thought ?? '';
      return {
        id: `mock_${idx + 1}`,
        provider: req.provider,
        model: req.model,
        finishReason: 'tool_calls',
        content,
        toolCalls: behavior.calls,
        usage: {
          tokensIn: behavior.tokensIn ?? promptTokens,
          tokensOut: behavior.tokensOut ?? Math.max(12, estimateTokenCount(content) + 16),
          cachedInputTokens: 0,
        },
        confidence: 0.88,
        latencyMs: 8,
      };
    }

    return {
      id: `mock_${idx + 1}`,
      provider: req.provider,
      model: req.model,
      finishReason: 'stop',
      content: behavior.content,
      toolCalls: [],
      usage: {
        tokensIn: behavior.tokensIn ?? promptTokens,
        tokensOut: behavior.tokensOut ?? Math.max(8, estimateTokenCount(behavior.content)),
        cachedInputTokens: behavior.cachedInputTokens ?? 0,
      },
      confidence: behavior.confidence ?? 0.94,
      latencyMs: 6,
    };
  }

  async *stream(
    req: ModelCompletionRequest & { provider: string; model: string },
  ): AsyncIterable<ModelStreamChunk> {
    const response = await this.complete(req);
    const words = response.content.split(/(\s+)/);
    for (const part of words) {
      if (part.length > 0) {
        yield { type: 'delta', delta: part };
      }
    }
    for (const tc of response.toolCalls) {
      yield { type: 'tool_call', toolCall: tc };
    }
    yield { type: 'done', response };
  }

  private defaultBehavior(req: ModelCompletionRequest): MockTurnBehavior {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');

    // If user asked for current time and we haven't called tool yet, call current_time automatically.
    if (
      !lastTool &&
      /\btime\b/i.test(lastUser) &&
      req.tools?.some((t) => t.name === 'current_time')
    ) {
      return {
        kind: 'tool_calls',
        thought: 'Checking the current UTC time via current_time tool.',
        calls: [{ id: 'tc_mock_time_1', name: 'current_time', arguments: {} }],
      };
    }

    if (lastTool) {
      return {
        kind: 'answer',
        content: `Completed using ${lastTool.toolName ?? 'tool'}: ${lastTool.content.slice(0, 200)}`,
      };
    }

    if (req.responseSchema) {
      return {
        kind: 'answer',
        content: JSON.stringify({ answer: `Processed: ${lastUser.slice(0, 120)}`, ok: true }),
      };
    }

    return {
      kind: 'answer',
      content: `Mock response to: ${lastUser.slice(0, 200)}`,
    };
  }
}

export interface WorkspaceModelMapping {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly tier: ModelTier;
  readonly primary: ModelTarget;
  readonly fallbackChain: readonly ModelTarget[];
  readonly routingStrategy?: RoutingStrategy;
}

export interface ByokKeyRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly label: string;
  readonly secretRef: SecretRef;
  readonly baseUrl?: string;
  readonly status: 'active' | 'disabled';
}

interface CircuitState {
  consecutiveFailures: number;
  openUntilMs: number;
}

export interface GatewayCompletionResult {
  readonly response: ModelCompletionResponse;
  readonly costMicroUsd: MicroUsd;
  readonly fallbackUsed: boolean;
  readonly routeTaken: ModelTarget;
  readonly attempts: number;
}

export interface ModelGatewayOptions {
  readonly registry?: CapabilityRegistry;
  readonly secretsProvider?: SecretsProvider;
  readonly clock?: Clock;
  readonly circuitFailureThreshold?: number;
  readonly circuitResetMs?: number;
}

export class ModelGateway {
  readonly registry: CapabilityRegistry;
  private readonly providers = new Map<string, ModelProvider>();
  private readonly workspaceMappings = new Map<string, WorkspaceModelMapping>();
  private readonly byokKeys = new Map<string, ByokKeyRecord[]>();
  private readonly circuits = new Map<string, CircuitState>();
  private readonly secretsProvider?: SecretsProvider;
  private readonly clock: Clock;
  private readonly circuitFailureThreshold: number;
  private readonly circuitResetMs: number;

  constructor(options: ModelGatewayOptions = {}) {
    this.registry = options.registry ?? new InMemoryCapabilityRegistry();
    this.secretsProvider = options.secretsProvider;
    this.clock = options.clock ?? new SystemClock();
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? 3;
    this.circuitResetMs = options.circuitResetMs ?? 30_000;
  }

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  setWorkspaceMapping(mapping: WorkspaceModelMapping): void {
    this.workspaceMappings.set(`${mapping.workspaceId}::${mapping.tier}`, mapping);
  }

  registerByokKey(record: ByokKeyRecord): void {
    const key = `${record.workspaceId}::${record.provider}`;
    const existing = this.byokKeys.get(key) ?? [];
    this.byokKeys.set(key, [...existing, record]);
  }

  isCircuitOpen(provider: string): boolean {
    const state = this.circuits.get(provider);
    if (!state) return false;
    return this.clock.now().getTime() < state.openUntilMs;
  }

  resetCircuit(provider: string): void {
    this.circuits.delete(provider);
  }

  private recordFailure(provider: string): void {
    const prev = this.circuits.get(provider) ?? { consecutiveFailures: 0, openUntilMs: 0 };
    const nextFailures = prev.consecutiveFailures + 1;
    const openUntilMs =
      nextFailures >= this.circuitFailureThreshold
        ? this.clock.now().getTime() + this.circuitResetMs
        : prev.openUntilMs;
    this.circuits.set(provider, { consecutiveFailures: nextFailures, openUntilMs });
  }

  private recordSuccess(provider: string): void {
    this.circuits.delete(provider);
  }

  resolveTargets(workspaceId: string, req: ModelCompletionRequest): readonly ModelTarget[] {
    const explicitChain = req.fallbackChain ?? [];
    if (req.provider && req.model) {
      return [{ provider: req.provider, model: req.model }, ...explicitChain];
    }

    const tier: ModelTier = req.tier ?? 'standard';
    const mapping = this.workspaceMappings.get(`${workspaceId}::${tier}`);
    if (mapping) {
      return [mapping.primary, ...mapping.fallbackChain, ...explicitChain];
    }

    // Strategy-based selection across catalog for registered providers.
    const candidates = this.registry.list({
      tier,
      supportsTools: req.tools && req.tools.length > 0 ? true : undefined,
    });
    const strategy = req.routingStrategy ?? 'quality';
    const sorted = [...candidates].sort((a, b) => {
      const aRegistered = this.providers.has(a.provider) ? 0 : 1;
      const bRegistered = this.providers.has(b.provider) ? 0 : 1;
      if (aRegistered !== bRegistered) return aRegistered - bRegistered;

      if (strategy === 'cost') {
        return a.pricing.inputPerMillionMicroUsd - b.pricing.inputPerMillionMicroUsd;
      }
      if (strategy === 'latency') {
        return a.avgLatencyMs - b.avgLatencyMs;
      }
      return b.qualityScore - a.qualityScore;
    });

    const targets = sorted
      .filter((c) => this.providers.has(c.provider))
      .map((c) => ({ provider: c.provider, model: c.id }));

    if (targets.length === 0) {
      const fallbackMock = this.providers.has('mock')
        ? [{ provider: 'mock', model: `mock/react-${tier === 'embedding' ? 'default' : tier}` }]
        : [];
      return [...fallbackMock, ...explicitChain];
    }

    return [...targets, ...explicitChain];
  }

  private async resolveApiKey(
    ctx: TenantContext,
    workspaceId: string,
    target: ModelTarget,
  ): Promise<{ apiKey?: string; baseUrl?: string }> {
    const records = this.byokKeys.get(`${workspaceId}::${target.provider}`) ?? [];
    const active = records.find((r) => r.status === 'active' && r.orgId === ctx.orgId);
    if (!active) {
      return { baseUrl: target.baseUrl };
    }
    if (!this.secretsProvider) {
      throw new PlatformError(
        'SYS_INTERNAL',
        'SecretsProvider not configured to resolve BYOK key.',
      );
    }
    const rawBytes = await this.secretsProvider.resolve(ctx, active.secretRef, 'provider_call');
    return {
      apiKey: Buffer.from(rawBytes).toString('utf8'),
      baseUrl: active.baseUrl ?? target.baseUrl,
    };
  }

  async complete(
    ctx: TenantContext,
    workspaceId: string,
    req: ModelCompletionRequest,
  ): Promise<GatewayCompletionResult> {
    return withSpan(
      'model.gateway.complete',
      {
        'elshad.org_id': ctx.orgId,
        'elshad.workspace_id': workspaceId,
        'model.tier': req.tier ?? 'standard',
      },
      async () => {
        const targets = this.resolveTargets(workspaceId, req);
        if (targets.length === 0) {
          throw new PlatformError(
            'MODEL_OVERLOADED',
            'No registered model provider is available for this request.',
          );
        }

        let lastError: unknown;
        let attempts = 0;

        for (let i = 0; i < targets.length; i++) {
          const target = targets[i]!;
          if (this.isCircuitOpen(target.provider)) {
            lastError = new PlatformError(
              'MODEL_OVERLOADED',
              `Circuit breaker open for provider "${target.provider}".`,
            );
            continue;
          }

          const provider = this.providers.get(target.provider);
          if (!provider) {
            lastError = new PlatformError(
              'MODEL_OVERLOADED',
              `Provider "${target.provider}" is not registered.`,
            );
            continue;
          }

          attempts += 1;
          try {
            const { apiKey, baseUrl } = await this.resolveApiKey(ctx, workspaceId, target);
            const response = await provider.complete(
              { ...req, provider: target.provider, model: target.model, baseUrl },
              apiKey,
            );
            this.recordSuccess(target.provider);
            const cap = this.registry.get(target.provider, target.model);
            const pricing: ModelPricing = cap?.pricing ?? {
              inputPerMillionMicroUsd: 0,
              outputPerMillionMicroUsd: 0,
              cachedInputPerMillionMicroUsd: 0,
            };
            return {
              response,
              costMicroUsd: costMicroUsd(response.usage, pricing),
              fallbackUsed: i > 0,
              routeTaken: target,
              attempts,
            };
          } catch (err) {
            lastError = err;
            const isPlatformErr = err instanceof PlatformError;
            if (isPlatformErr && !err.retryable) {
              throw err;
            }
            this.recordFailure(target.provider);
          }
        }

        if (lastError instanceof PlatformError) {
          throw lastError;
        }
        throw new PlatformError('MODEL_OVERLOADED', 'All model targets failed or were skipped.', {
          attempts,
        });
      },
    );
  }
}
