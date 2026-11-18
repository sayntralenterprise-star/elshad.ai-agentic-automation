import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  PlatformError,
  SystemClock,
  type Clock,
  type TenantContext,
} from '@elshad/domain';
import type { Cache } from '@elshad/platform-kit';
import {
  DefaultV1PolicyEvaluator,
  enforcePolicyDecision,
  type AutonomyLevel,
  type PolicyDecision,
  type PolicyEvaluator,
  type SideEffectClass,
} from '@elshad/policy-kit';
import { withSpan } from '@elshad/telemetry';
import {
  MAX_TOOL_OUTPUT_BYTES,
  sanitizeAndWrapToolResult,
  ToolContractSchema,
  validateJsonSchema,
  type ProvenanceLabel,
  type SanitizedToolOutput,
  type ToolContract,
  type ToolGrant,
} from './shared.js';

export * from './shared.js';

// ---------- Lethal Trifecta Detector (FR-TL-5) ----------

export interface LethalTrifectaReport {
  readonly detected: boolean;
  readonly hasPrivateData: boolean;
  readonly hasUntrustedInput: boolean;
  readonly hasExternalComms: boolean;
  readonly reasons: readonly string[];
}

export function detectLethalTrifecta(contracts: readonly ToolContract[]): LethalTrifectaReport {
  const privateDataTools = contracts
    .filter((c) =>
      c.data_classification_touched.some(
        (d) => d === 'confidential' || d === 'restricted' || d === 'pii',
      ),
    )
    .map((c) => c.name);

  const untrustedTools = contracts
    .filter((c) => c.untrusted_source === true || c.name === 'web_fetch')
    .map((c) => c.name);

  const externalCommsTools = contracts
    .filter((c) => c.side_effect_class === 'external_comms')
    .map((c) => c.name);

  const hasPrivateData = privateDataTools.length > 0;
  const hasUntrustedInput = untrustedTools.length > 0;
  const hasExternalComms = externalCommsTools.length > 0;
  const detected = hasPrivateData && hasUntrustedInput && hasExternalComms;

  const reasons: string[] = [];
  if (detected) {
    reasons.push(
      `Lethal trifecta present: private data tools [${privateDataTools.join(', ')}] + untrusted content [${untrustedTools.join(', ')}] + external comms [${externalCommsTools.join(', ')}].`,
    );
  }

  return {
    detected,
    hasPrivateData,
    hasUntrustedInput,
    hasExternalComms,
    reasons,
  };
}

// ---------- SSRF Guard (PRD N.5) ----------

export type ResolveHostFn = (hostname: string) => Promise<readonly string[]>;

function isBlockedIpv4Tuple(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((octet) => octet < 0 || octet > 255 || !Number.isInteger(octet))) {
    return true;
  }
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // Loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local & AWS/GCP metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

export function isBlockedIpAddress(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const ipVersion = isIP(ip);
  if (ipVersion === 4) {
    const parts = ip.split('.').map(Number);
    return isBlockedIpv4Tuple(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
  }
  if (ipVersion === 6) {
    if (ip === '::' || ip === '::1') return true;
    // IPv4-mapped IPv6 dotted: ::ffff:127.0.0.1
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice('::ffff:'.length);
      if (isIP(mapped) === 4) {
        const parts = mapped.split('.').map(Number);
        return isBlockedIpv4Tuple(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
      }
      // IPv4-mapped IPv6 hex form e.g. ::ffff:7f00:1 or ::ffff:a9fe:a9fe
      const hexGroups = mapped.split(':');
      if (hexGroups.length === 2) {
        const hi = Number.parseInt(hexGroups[0]!, 16);
        const lo = Number.parseInt(hexGroups[1]!, 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          return isBlockedIpv4Tuple((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
        }
      }
    }
    const firstGroup = Number.parseInt(ip.split(':')[0] || '0', 16);
    if ((firstGroup & 0xfe00) === 0xfc00) return true; // fc00::/7 Unique Local
    if ((firstGroup & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-Local
    if ((firstGroup & 0xff00) === 0xff00) return true; // ff00::/8 Multicast
    return false;
  }
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
]);

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  try {
    const entries = await dnsLookup(hostname, { all: true });
    return entries.map((e) => e.address);
  } catch {
    return [];
  }
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  resolveHostFn: ResolveHostFn = defaultResolveHost,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PlatformError('TOOL_ARGS_INVALID', `Malformed outbound URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PlatformError(
      'TOOL_SSRF_BLOCKED',
      `Blocked URL protocol "${parsed.protocol}"; only http and https are permitted.`,
      { url: rawUrl },
    );
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) {
    throw new PlatformError('TOOL_SSRF_BLOCKED', 'URL missing valid hostname.');
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new PlatformError('TOOL_SSRF_BLOCKED', `Blocked internal/metadata host "${host}".`, {
      host,
    });
  }

  if (isIP(host) !== 0 && isBlockedIpAddress(host)) {
    throw new PlatformError('TOOL_SSRF_BLOCKED', `Blocked private/reserved IP address "${host}".`, {
      host,
    });
  }

  if (isIP(host) === 0) {
    const resolved = await resolveHostFn(host);
    for (const addr of resolved) {
      if (isBlockedIpAddress(addr)) {
        throw new PlatformError(
          'TOOL_SSRF_BLOCKED',
          `Hostname "${host}" resolved to blocked internal IP "${addr}".`,
          { host, resolvedIp: addr },
        );
      }
    }
  }

  return parsed;
}

// ---------- Sandboxed Code Execution (E0.3-5, ADR-0008) ----------

export interface SandboxExecutionResult {
  readonly stdout: string;
  readonly result: unknown;
  readonly durationMs: number;
}

export class SandboxRunner {
  private readonly pythonRuntimePath: string;

  constructor(options?: { pythonRuntimePath?: string }) {
    const here = dirname(fileURLToPath(import.meta.url));
    this.pythonRuntimePath =
      options?.pythonRuntimePath ??
      resolve(here, '..', '..', '..', 'python', 'sandbox-runtime');
  }

  async runJavaScript(
    code: string,
    inputs: Record<string, unknown> = {},
    timeoutMs = 3_000,
  ): Promise<SandboxExecutionResult> {
    const started = Date.now();
    const boundedTimeout = Math.max(50, Math.min(timeoutMs, 10_000));
    const stdoutChunks: string[] = [];
    let totalBytes = 0;

    const sandboxGlobals: Record<string, unknown> = {
      inputs: structuredClone(inputs),
      Math,
      JSON,
      Number,
      String,
      Boolean,
      Array,
      Date,
      result: undefined,
      console: {
        log: (...args: unknown[]) => {
          const line = args
            .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ');
          totalBytes += Buffer.byteLength(line, 'utf8');
          if (totalBytes > MAX_TOOL_OUTPUT_BYTES) {
            throw new PlatformError('TOOL_SANDBOX_ERROR', 'Sandbox stdout exceeded 64 KB limit.');
          }
          stdoutChunks.push(line);
        },
      },
    };

    const context = vm.createContext(sandboxGlobals, {
      microtaskMode: 'afterEvaluate',
      codeGeneration: { strings: false, wasm: false },
    });

    try {
      const value = vm.runInContext(
        `"use strict";\n${code}`,
        context,
        {
          timeout: boundedTimeout,
          filename: 'agent-sandbox.js',
        },
      );
      return {
        stdout: stdoutChunks.join('\n'),
        result: sandboxGlobals['result'] !== undefined ? sandboxGlobals['result'] : value,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof PlatformError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/timed out/i.test(msg)) {
        throw new PlatformError('TOOL_TIMEOUT', `Sandbox execution timed out after ${boundedTimeout}ms`, {
          timeoutMs: boundedTimeout,
        });
      }
      throw new PlatformError('TOOL_SANDBOX_ERROR', `Sandbox error: ${msg}`);
    }
  }

  async runPython(
    code: string,
    inputs: Record<string, unknown> = {},
    timeoutMs = 5_000,
  ): Promise<SandboxExecutionResult> {
    const started = Date.now();
    const boundedTimeout = Math.max(100, Math.min(timeoutMs, 15_000));
    const pythonCmd = process.env['PYTHON_BIN'] || 'python';

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(pythonCmd, ['-m', 'sandbox_runtime.runner'], {
        env: {
          PATH: process.env['PATH'] ?? '',
          PYTHONPATH: this.pythonRuntimePath,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, boundedTimeout);

      child.stdout.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stdout, 'utf8') + chunk.byteLength <= MAX_TOOL_OUTPUT_BYTES * 2) {
          stdout += chunk.toString('utf8');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 4096) {
          stderr += chunk.toString('utf8');
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        rejectPromise(
          new PlatformError('TOOL_SANDBOX_ERROR', `Failed to launch Python sandbox: ${err.message}`),
        );
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (timedOut) {
          rejectPromise(
            new PlatformError(
              'TOOL_TIMEOUT',
              `Python sandbox timed out after ${boundedTimeout}ms`,
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(stdout || '{}') as {
            ok?: boolean;
            stdout?: string;
            result?: unknown;
            error?: string;
            error_type?: string;
          };
          if (exitCode === 0 && parsed.ok) {
            resolvePromise({
              stdout: parsed.stdout ?? '',
              result: parsed.result ?? null,
              durationMs: Date.now() - started,
            });
            return;
          }
          rejectPromise(
            new PlatformError(
              'TOOL_SANDBOX_ERROR',
              parsed.error ?? (stderr.trim() || `Python sandbox failed with exit ${exitCode}`),
              { errorType: parsed.error_type },
            ),
          );
        } catch {
          rejectPromise(
            new PlatformError(
              'TOOL_SANDBOX_ERROR',
              stderr.trim() || `Python sandbox produced invalid output (exit ${exitCode})`,
            ),
          );
        }
      });

      child.stdin.write(JSON.stringify({ code, inputs }));
      child.stdin.end();
    });
  }
}

// ---------- Built-in Tool Contracts (FR-TL-6) ----------

export const BUILTIN_TOOL_CONTRACTS: readonly ToolContract[] = [
  {
    name: 'current_time',
    version: '1.0.0',
    description: 'Return the current UTC timestamp in ISO-8601 format and Unix milliseconds.',
    input_schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string' },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      required: ['iso', 'unix_ms'],
      properties: {
        iso: { type: 'string' },
        unix_ms: { type: 'integer' },
      },
    },
    side_effect_class: 'read',
    idempotent: true,
    required_permissions: ['tool:run'],
    data_classification_touched: ['public'],
    timeout_ms: 2_000,
    retry_policy: { max_attempts: 1, backoff_ms: 0 },
    cost_model: { per_call_micro_usd: 0 },
    examples: [{ input: {}, output: { iso: '2026-11-18T12:00:00.000Z', unix_ms: 1795003200000 } }],
    implementation: 'builtin',
  },
  {
    name: 'web_fetch',
    version: '1.0.0',
    description: 'Fetch a public web page via HTTP GET after SSRF and grant domain checks.',
    input_schema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', minLength: 8, maxLength: 2048 },
        headers: { type: 'object' },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      required: ['status', 'body', 'url'],
      properties: {
        status: { type: 'integer' },
        body: { type: 'string' },
        url: { type: 'string' },
      },
    },
    side_effect_class: 'read',
    idempotent: true,
    required_permissions: ['tool:run'],
    data_classification_touched: ['public'],
    timeout_ms: 15_000,
    retry_policy: { max_attempts: 2, backoff_ms: 500 },
    rate_limit: { max_calls: 30, window_ms: 60_000 },
    cost_model: { per_call_micro_usd: 10 },
    examples: [
      {
        input: { url: 'https://example.com' },
        output: { status: 200, body: 'Example Domain', url: 'https://example.com' },
      },
    ],
    implementation: 'http',
    untrusted_source: true,
  },
  {
    name: 'http_request',
    version: '1.0.0',
    description: 'Send an outbound HTTP request with SSRF guard and grant domain/method policy.',
    input_schema: {
      type: 'object',
      required: ['url', 'method'],
      properties: {
        url: { type: 'string', minLength: 8, maxLength: 2048 },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        headers: { type: 'object' },
        body: { type: 'string' },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      required: ['status', 'body'],
      properties: {
        status: { type: 'integer' },
        body: { type: 'string' },
      },
    },
    side_effect_class: 'external_comms',
    idempotent: false,
    required_permissions: ['tool:run'],
    data_classification_touched: ['internal'],
    timeout_ms: 15_000,
    retry_policy: { max_attempts: 2, backoff_ms: 500 },
    rate_limit: { max_calls: 20, window_ms: 60_000 },
    cost_model: { per_call_micro_usd: 25 },
    examples: [
      {
        input: { url: 'https://api.example.com/webhook', method: 'POST', body: '{"ok":true}' },
        output: { status: 200, body: '{"accepted":true}' },
      },
    ],
    implementation: 'http',
    untrusted_source: true,
  },
  {
    name: 'code_interpreter',
    version: '1.0.0',
    description: 'Execute JavaScript or Python calculations inside an isolated resource-capped sandbox.',
    input_schema: {
      type: 'object',
      required: ['language', 'code'],
      properties: {
        language: { type: 'string', enum: ['javascript', 'python'] },
        code: { type: 'string', minLength: 1, maxLength: 32_768 },
        inputs: { type: 'object' },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      required: ['stdout', 'result'],
      properties: {
        stdout: { type: 'string' },
      },
    },
    side_effect_class: 'read',
    idempotent: true,
    required_permissions: ['tool:run'],
    data_classification_touched: ['internal'],
    timeout_ms: 10_000,
    retry_policy: { max_attempts: 1, backoff_ms: 0 },
    cost_model: { per_call_micro_usd: 50 },
    examples: [
      {
        input: { language: 'javascript', code: 'result = 2 + 2;' },
        output: { stdout: '', result: 4 },
      },
    ],
    implementation: 'sandbox_js',
  },
  {
    name: 'ask_human',
    version: '1.0.0',
    description: 'Pause agent work and ask the human user a clarifying question.',
    input_schema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 2000 },
        options: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      required: ['status', 'question'],
      properties: {
        status: { type: 'string' },
        question: { type: 'string' },
      },
    },
    side_effect_class: 'read',
    idempotent: true,
    required_permissions: ['tool:run'],
    data_classification_touched: ['internal'],
    timeout_ms: 5_000,
    retry_policy: { max_attempts: 1, backoff_ms: 0 },
    cost_model: { per_call_micro_usd: 0 },
    examples: [
      {
        input: { question: 'Which environment should I target?' },
        output: { status: 'awaiting_human_input', question: 'Which environment should I target?' },
      },
    ],
    implementation: 'builtin',
  },
];

// ---------- Tool Registry & Gateway (FR-TL-3, FR-TL-4, FR-TL-9) ----------

export type CustomToolExecutor = (
  args: Record<string, unknown>,
  ctx: TenantContext,
) => Promise<Record<string, unknown>>;

export class InMemoryToolRegistry {
  private readonly contracts = new Map<string, ToolContract>();
  private readonly executors = new Map<string, CustomToolExecutor>();

  constructor(seedBuiltins = true) {
    if (seedBuiltins) {
      for (const c of BUILTIN_TOOL_CONTRACTS) {
        this.register(c);
      }
    }
  }

  register(contract: ToolContract, executor?: CustomToolExecutor): void {
    const validated = ToolContractSchema.parse(contract);
    this.contracts.set(validated.name, validated);
    if (executor) {
      this.executors.set(validated.name, executor);
    }
  }

  get(name: string): ToolContract | undefined {
    return this.contracts.get(name);
  }

  getExecutor(name: string): CustomToolExecutor | undefined {
    return this.executors.get(name);
  }

  list(): ToolContract[] {
    return [...this.contracts.values()];
  }
}

export interface EffectRecordStore {
  get(orgId: string, key: string): Promise<{ status: 'succeeded' | 'failed'; resultJson?: Record<string, unknown> } | null>;
  record(entry: {
    orgId: string;
    idempotencyKey: string;
    runId: string;
    stepSeq: number;
    attemptGroup: number;
    status: 'succeeded' | 'failed';
    resultJson?: Record<string, unknown>;
  }): Promise<void>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ToolInvokeInput {
  readonly ctx: TenantContext;
  readonly runId: string;
  readonly stepSeq: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly autonomyLevel: AutonomyLevel;
  readonly grant?: ToolGrant;
  readonly untrustedContentInContext?: boolean;
  readonly toolCallCountInRun?: number;
  readonly dryRun?: boolean;
  readonly idempotencyKey?: string;
}

export interface ToolInvokeResult {
  readonly output: Record<string, unknown>;
  readonly sanitized: SanitizedToolOutput;
  readonly policyDecision: PolicyDecision;
  readonly fromCache: boolean;
  readonly dryRun: boolean;
  readonly latencyMs: number;
  readonly costMicroUsd: number;
}

export interface ToolGatewayOptions {
  readonly registry?: InMemoryToolRegistry;
  readonly policyEvaluator?: PolicyEvaluator;
  readonly clock?: Clock;
  readonly cache?: Cache;
  readonly effectStore?: EffectRecordStore;
  readonly sandboxRunner?: SandboxRunner;
  readonly fetchFn?: FetchLike;
  readonly resolveHostFn?: ResolveHostFn;
}

export class ToolGateway {
  readonly registry: InMemoryToolRegistry;
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly clock: Clock;
  private readonly cache?: Cache;
  private readonly effectStore?: EffectRecordStore;
  private readonly sandboxRunner: SandboxRunner;
  private readonly fetchFn: FetchLike;
  private readonly resolveHostFn: ResolveHostFn;

  constructor(options: ToolGatewayOptions = {}) {
    this.registry = options.registry ?? new InMemoryToolRegistry(true);
    this.policyEvaluator = options.policyEvaluator ?? new DefaultV1PolicyEvaluator();
    this.clock = options.clock ?? new SystemClock();
    this.cache = options.cache;
    this.effectStore = options.effectStore;
    this.sandboxRunner = options.sandboxRunner ?? new SandboxRunner();
    this.fetchFn = options.fetchFn ?? ((url, init) => globalThis.fetch(url, init));
    this.resolveHostFn = options.resolveHostFn ?? defaultResolveHost;
  }

  async invoke(input: ToolInvokeInput): Promise<ToolInvokeResult> {
    return withSpan(
      'tool.invoke',
      {
        'elshad.org_id': input.ctx.orgId,
        'elshad.run_id': input.runId,
        'tool.name': input.toolName,
        'tool.dry_run': Boolean(input.dryRun),
      },
      async () => this.invokePipeline(input),
    );
  }

  private async invokePipeline(input: ToolInvokeInput): Promise<ToolInvokeResult> {
    const started = Date.now();
    // Step 1: Lookup contract
    const contract = this.registry.get(input.toolName);
    if (!contract) {
      throw new PlatformError('TOOL_NOT_GRANTED', `Unknown tool "${input.toolName}".`);
    }

    // Step 2: Check grant
    if (input.grant && !input.grant.enabled) {
      throw new PlatformError('TOOL_NOT_GRANTED', `Tool grant for "${input.toolName}" is disabled.`);
    }

    // Step 3: Validate input args against JSON Schema
    const argErrors = validateJsonSchema(contract.input_schema, input.args);
    if (argErrors.length > 0) {
      throw new PlatformError('TOOL_ARGS_INVALID', `Invalid tool arguments: ${argErrors.join('; ')}`, {
        errors: argErrors,
      });
    }

    // Step 4: Rate limit check
    if (contract.rate_limit && this.cache) {
      const rateKey = `rl:${input.ctx.orgId}:${input.ctx.workspaceId ?? 'ws'}:${contract.name}`;
      const win = await this.cache.incrWindow(rateKey, contract.rate_limit.window_ms);
      if (win.count > contract.rate_limit.max_calls) {
        throw new PlatformError(
          'BUD_RATE_LIMITED',
          `Tool "${contract.name}" rate limit exceeded (${contract.rate_limit.max_calls} calls per window).`,
        );
      }
    }

    // Step 5: Policy evaluator seam (D15)
    const targetUrl = typeof input.args['url'] === 'string' ? input.args['url'] : undefined;
    const httpMethod =
      typeof input.args['method'] === 'string'
        ? input.args['method']
        : contract.name === 'web_fetch'
          ? 'GET'
          : undefined;

    const policyDecision = await this.policyEvaluator.evaluate({
      ctx: input.ctx,
      action: 'tool.invoke',
      autonomyLevel: input.autonomyLevel,
      sideEffectClass: contract.side_effect_class,
      toolName: contract.name,
      approvalMode: input.grant?.approval ?? 'auto',
      untrustedContentInContext: input.untrustedContentInContext,
      targetUrl,
      httpMethod,
      grantScope: input.grant?.scope,
      toolCallCountInRun: input.toolCallCountInRun,
    });
    enforcePolicyDecision(policyDecision);

    // Step 6: Dry-run short circuit (FR-TL-9)
    if (input.dryRun) {
      if (targetUrl) {
        await assertSafeOutboundUrl(targetUrl, this.resolveHostFn);
      }
      const dryOutput: Record<string, unknown> = {
        dry_run: true,
        tool: contract.name,
        side_effect_class: contract.side_effect_class,
        validated_args: input.args,
      };
      const sanitized = sanitizeAndWrapToolResult(
        input.toolCallId,
        contract.name,
        dryOutput,
        'internal_trusted',
      );
      return {
        output: dryOutput,
        sanitized,
        policyDecision,
        fromCache: false,
        dryRun: true,
        latencyMs: Date.now() - started,
        costMicroUsd: 0,
      };
    }

    // Step 7: Effect idempotency ledger check for non-idempotent tools
    if (!contract.idempotent && input.idempotencyKey && this.effectStore) {
      const existing = await this.effectStore.get(input.ctx.orgId, input.idempotencyKey);
      if (existing?.status === 'succeeded' && existing.resultJson) {
        const provenance: ProvenanceLabel = contract.untrusted_source
          ? 'untrusted_external'
          : 'tool_output';
        const sanitized = sanitizeAndWrapToolResult(
          input.toolCallId,
          contract.name,
          existing.resultJson,
          provenance,
        );
        return {
          output: existing.resultJson,
          sanitized,
          policyDecision,
          fromCache: true,
          dryRun: false,
          latencyMs: Date.now() - started,
          costMicroUsd: 0,
        };
      }
    }

    // Step 8: Execute tool implementation (with SSRF guard & output validation)
    const rawOutput = await this.executeToolImpl(contract, input.args, input.ctx);

    const outErrors = validateJsonSchema(contract.output_schema, rawOutput);
    if (outErrors.length > 0) {
      throw new PlatformError(
        'TOOL_CONTRACT_VIOLATION',
        `Tool "${contract.name}" output violated declared output_schema: ${outErrors.join('; ')}`,
        { errors: outErrors },
      );
    }

    if (!contract.idempotent && input.idempotencyKey && this.effectStore) {
      await this.effectStore.record({
        orgId: input.ctx.orgId,
        idempotencyKey: input.idempotencyKey,
        runId: input.runId,
        stepSeq: input.stepSeq,
        attemptGroup: 1,
        status: 'succeeded',
        resultJson: rawOutput,
      });
    }

    const provenance: ProvenanceLabel = contract.untrusted_source
      ? 'untrusted_external'
      : 'tool_output';
    const sanitized = sanitizeAndWrapToolResult(
      input.toolCallId,
      contract.name,
      rawOutput,
      provenance,
    );

    return {
      output: rawOutput,
      sanitized,
      policyDecision,
      fromCache: false,
      dryRun: false,
      latencyMs: Date.now() - started,
      costMicroUsd: contract.cost_model.per_call_micro_usd,
    };
  }

  private async executeToolImpl(
    contract: ToolContract,
    args: Record<string, unknown>,
    ctx: TenantContext,
  ): Promise<Record<string, unknown>> {
    const custom = this.registry.getExecutor(contract.name);
    if (custom) {
      return custom(args, ctx);
    }

    switch (contract.name) {
      case 'current_time': {
        const now = this.clock.now();
        return { iso: now.toISOString(), unix_ms: now.getTime() };
      }

      case 'ask_human': {
        return {
          status: 'awaiting_human_input',
          question: String(args['question'] ?? ''),
          options: Array.isArray(args['options']) ? args['options'] : [],
        };
      }

      case 'code_interpreter': {
        const lang = String(args['language'] ?? 'javascript');
        const code = String(args['code'] ?? '');
        const inputs =
          args['inputs'] && typeof args['inputs'] === 'object' && !Array.isArray(args['inputs'])
            ? (args['inputs'] as Record<string, unknown>)
            : {};
        const execResult =
          lang === 'python'
            ? await this.sandboxRunner.runPython(code, inputs, contract.timeout_ms)
            : await this.sandboxRunner.runJavaScript(code, inputs, contract.timeout_ms);
        return {
          stdout: execResult.stdout,
          result: execResult.result ?? null,
        };
      }

      case 'web_fetch':
      case 'http_request': {
        const rawUrl = String(args['url'] ?? '');
        const safeUrl = await assertSafeOutboundUrl(rawUrl, this.resolveHostFn);
        const method =
          contract.name === 'web_fetch'
            ? 'GET'
            : String(args['method'] ?? 'GET').toUpperCase();
        const headers =
          args['headers'] && typeof args['headers'] === 'object' && !Array.isArray(args['headers'])
            ? (args['headers'] as Record<string, string>)
            : undefined;
        const body = typeof args['body'] === 'string' ? args['body'] : undefined;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), contract.timeout_ms);
        try {
          const response = await this.fetchFn(safeUrl.toString(), {
            method,
            headers,
            body: method === 'GET' ? undefined : body,
            redirect: 'manual',
            signal: controller.signal,
          });
          if (response.status >= 300 && response.status < 400) {
            throw new PlatformError(
              'TOOL_SSRF_BLOCKED',
              `Outbound HTTP redirect blocked (${response.status}) to prevent SSRF redirect bypass.`,
            );
          }
          const text = await response.text();
          return {
            status: response.status,
            body: text,
            ...(contract.name === 'web_fetch' ? { url: safeUrl.toString() } : {}),
          };
        } finally {
          clearTimeout(timer);
        }
      }

      default:
        throw new PlatformError(
          'SYS_INTERNAL',
          `No executor registered for non-builtin tool "${contract.name}".`,
        );
    }
  }
}

export function computeContractHash(contract: ToolContract): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export type { SideEffectClass };
export * from './openapi-importer.js';
export * from './mcp-client.js';
