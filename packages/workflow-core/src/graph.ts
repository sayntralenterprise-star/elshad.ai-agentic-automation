import { createHash } from 'node:crypto';
import { canonicalJson } from '@elshad/db';
import { PlatformError, type Clock, type TenantContext } from '@elshad/domain';
import type { ModelGateway } from '@elshad/model-kit';
import { executeReActAgentRun, type AgentDefinition, type UsageLedger } from '@elshad/runtime-core';
import { SandboxRunner, ToolGateway, assertSafeOutboundUrl } from '@elshad/tool-kit';
import { z } from 'zod';
import type { ExprScope } from './expression.js';
import { SandboxedJsonataEngine } from './expression.js';

export interface WorkflowItem {
  readonly json: Record<string, unknown>;
  readonly binary?: { readonly key: string };
  readonly meta: {
    readonly source_node: string;
    readonly item_index: number;
  };
}

export function makeItem(
  json: Record<string, unknown>,
  sourceNode: string,
  itemIndex = 0,
  binary?: { readonly key: string },
): WorkflowItem {
  return {
    json,
    ...(binary ? { binary } : {}),
    meta: { source_node: sourceNode, item_index: itemIndex },
  };
}

export const NodeErrorPolicySchema = z.object({
  mode: z.enum(['fail', 'continue', 'retry', 'route']).default('fail'),
  retry: z
    .object({
      max: z.number().int().min(1).max(10).default(2),
      backoff_ms: z.number().int().min(0).max(60_000).default(250),
    })
    .optional(),
});

export type NodeErrorPolicy = z.infer<typeof NodeErrorPolicySchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(3).max(64),
  name: z.string().min(1).max(128),
  position: z
    .object({
      x: z.number().default(0),
      y: z.number().default(0),
    })
    .default({ x: 0, y: 0 }),
  config: z.record(z.string(), z.unknown()).default({}),
  on_error: NodeErrorPolicySchema.optional(),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1).max(64),
  from: z.object({
    node: z.string().min(1),
    port: z.string().min(1).default('main'),
  }),
  to: z.object({
    node: z.string().min(1),
    port: z.string().min(1).default('in'),
  }),
});

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowSettingsSchema = z.object({
  max_concurrency: z.number().int().min(1).max(100).default(10),
  queue: z.string().default('default'),
  timeout_ms: z.number().int().min(1000).max(86_400_000).default(900_000),
  error_workflow: z.string().optional(),
  serialize_by: z.string().optional(),
});

export const WorkflowGraphSchema = z.object({
  schema_version: z.literal(1).default(1),
  settings: WorkflowSettingsSchema.default({
    max_concurrency: 10,
    queue: 'default',
    timeout_ms: 900_000,
  }),
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema).default([]),
  pinned_data: z.record(z.string(), z.array(z.unknown())).default({}),
  notes: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    )
    .default([]),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export interface NodeExecutionContext {
  readonly ctx: TenantContext;
  readonly runId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly stepSeq: number;
  readonly env: Record<string, string>;
  readonly nodeOutputs: Record<string, Record<string, WorkflowItem[]>>;
  readonly triggerPayload: Record<string, unknown>;
  readonly exprEngine: SandboxedJsonataEngine;
  readonly clock: Clock;
  readonly modelGateway?: ModelGateway;
  readonly toolGateway?: ToolGateway;
  readonly usageLedger?: UsageLedger;
  readonly sandboxRunner: SandboxRunner;
  readonly notificationsLog: Array<{ channel: string; recipients: string[]; message: string }>;
  readonly customActionExecutor?: (
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  readonly resolveAgent?: (agentRef: string) => AgentDefinition | undefined;
  readonly executeSubworkflow?: (
    workflowRef: string,
    input: WorkflowItem[],
  ) => Promise<WorkflowItem[]>;
}

export type NodeResult =
  | {
      readonly kind: 'output';
      readonly ports: Record<string, WorkflowItem[]>;
    }
  | {
      readonly kind: 'wait';
      readonly waitKind: 'timer' | 'input' | 'approval';
      readonly resumeAfterMs?: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'stop';
      readonly status: 'succeeded' | 'failed';
      readonly message: string;
      readonly output: WorkflowItem[];
    };

export interface NodeHandler<C = Record<string, unknown>> {
  readonly type: string;
  readonly category: 'Trigger' | 'AI' | 'Logic' | 'Data' | 'Integration' | 'Human' | 'Control';
  readonly label: string;
  readonly configSchema: z.ZodType<C>;
  readonly ports: {
    readonly inputs: readonly string[];
    readonly outputs: readonly string[];
  };
  getOutputPorts?: (config: C) => readonly string[];
  execute(input: WorkflowItem[], config: C, ctx: NodeExecutionContext): Promise<NodeResult>;
}

export function makeExprScope(
  item: WorkflowItem | undefined,
  index: number,
  nodeCtx: NodeExecutionContext,
): ExprScope {
  const nodeMap: Record<string, { json: Record<string, unknown> }> = {};
  for (const [nid, ports] of Object.entries(nodeCtx.nodeOutputs)) {
    const first = ports['main']?.[0] ?? Object.values(ports)[0]?.[0];
    if (first) {
      nodeMap[nid] = { json: first.json };
    }
  }
  return {
    json: item?.json ?? {},
    item: index,
    node: nodeMap,
    trigger: nodeCtx.triggerPayload,
    run: {
      id: nodeCtx.runId,
      started: nodeCtx.clock.now().toISOString(),
      labels: {},
    },
    env: nodeCtx.env,
    now: nodeCtx.clock.now().toISOString(),
    workflow: {
      id: nodeCtx.workflowId,
      name: nodeCtx.workflowName,
      version: '1',
    },
  };
}

function setNestedPath(obj: Record<string, unknown>, path: string, val: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let curr: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (!curr[k] || typeof curr[k] !== 'object' || Array.isArray(curr[k])) {
      curr[k] = {};
    }
    curr = curr[k] as Record<string, unknown>;
  }
  curr[parts[parts.length - 1]!] = val;
}

// ---------- Built-in Node Definitions (E0.4-4, PRD N.5) ----------

const WebhookConfigSchema = z.object({
  path: z.string().min(1).max(200),
  methods: z.array(z.string()).default(['POST']),
  auth: z
    .object({
      mode: z.enum(['none', 'token', 'hmac', 'jwt']).default('none'),
      secret_ref: z.string().optional(),
      secret: z.string().optional(),
      jwt_issuer: z.string().optional(),
    })
    .default({ mode: 'none' }),
  response_mode: z.enum(['ack', 'sync', 'stream']).default('ack'),
  max_body_bytes: z.number().int().min(64).max(10_485_760).default(5_242_880),
});

const ScheduleConfigSchema = z.object({
  cron: z.string().optional(),
  interval_ms: z.number().int().min(1000).optional(),
  timezone: z.string().default('UTC'),
  misfire_policy: z.enum(['skip', 'run_once', 'run_all']).default('run_once'),
});

const ManualConfigSchema = z.object({
  input_schema: z.record(z.string(), z.unknown()).optional(),
});

const IfConfigSchema = z.object({
  condition: z.string().min(1),
});

const SwitchConfigSchema = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        expr: z.string().min(1),
      }),
    )
    .default([]),
  default: z.boolean().default(true),
});

const LoopConfigSchema = z.object({
  mode: z.enum(['for_each', 'while']).default('for_each'),
  items: z.string().optional(),
  condition: z.string().optional(),
  max_iterations: z.number().int().min(1).max(100_000).default(1000),
  batch_size: z.number().int().min(1).max(1000).default(1),
});

const ParallelConfigSchema = z.object({
  concurrency_cap: z.number().int().min(1).max(50).default(5),
  branches: z.array(z.string()).optional(),
});

const JoinConfigSchema = z.object({
  join_mode: z.enum(['all', 'any', 'n_of_m']).default('all'),
  required_count: z.number().int().min(1).optional(),
  timeout_ms: z.number().int().min(100).optional(),
});

const WaitConfigSchema = z.object({
  duration_ms: z.number().int().min(0).optional(),
  reason: z.string().default('Waiting on timer'),
});

const SetConfigSchema = z.object({
  assignments: z
    .array(
      z.object({
        path: z.string().min(1),
        expr: z.unknown(),
      }),
    )
    .default([]),
  keep_only_set: z.boolean().default(false),
});

const CodeConfigSchema = z.object({
  language: z.enum(['javascript', 'python']).default('javascript'),
  code: z.string().min(1),
  timeout_ms: z.number().int().min(50).max(15_000).default(3_000),
});

const HttpConfigSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.unknown().optional(),
  timeout_ms: z.number().int().min(100).max(60_000).default(10_000),
});

const AgentNodeConfigSchema = z.object({
  agent: z.string().min(1),
  version: z.string().default('channel:stable'),
  input: z.unknown().default('={{ $json }}'),
  dry_run: z.boolean().default(false),
});

const LlmNodeConfigSchema = z.object({
  tier: z.enum(['fast', 'standard', 'reasoning']).default('standard'),
  provider: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().min(1),
  system: z.string().optional(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
});

const NotifyConfigSchema = z.object({
  channel: z.enum(['slack', 'teams', 'email', 'sms', 'webhook']).default('slack'),
  template: z.string().min(1),
  recipients: z.array(z.string()).default(['#ops']),
});

const SubworkflowConfigSchema = z.object({
  workflow: z.string().min(1),
  version: z.string().optional(),
  await: z.boolean().default(true),
});

const StopConfigSchema = z.object({
  status: z.enum(['succeeded', 'failed']).default('succeeded'),
  message: z.string().default('Workflow stopped cleanly.'),
});

export function createDefaultNodeHandlers(): NodeHandler<never>[] {
  const passThrough = (
    type: string,
    category: NodeHandler['category'],
    label: string,
    configSchema: z.ZodTypeAny,
    isTrigger = false,
  ): NodeHandler<Record<string, unknown>> => ({
    type,
    category,
    label,
    configSchema: configSchema as z.ZodType<Record<string, unknown>>,
    ports: { inputs: isTrigger ? [] : ['in'], outputs: ['main'] },
    async execute(input, _cfg, nodeCtx) {
      const items =
        input.length > 0 ? input : [makeItem(nodeCtx.triggerPayload, nodeCtx.nodeId, 0)];
      return { kind: 'output', ports: { main: items } };
    },
  });

  const ifNode: NodeHandler<z.infer<typeof IfConfigSchema>> = {
    type: 'logic.if',
    category: 'Logic',
    label: 'IF Condition',
    configSchema: IfConfigSchema,
    ports: { inputs: ['in'], outputs: ['true', 'false', 'error'] },
    async execute(input, config, nodeCtx) {
      const trueItems: WorkflowItem[] = [];
      const falseItems: WorkflowItem[] = [];
      for (let i = 0; i < input.length; i++) {
        const item = input[i]!;
        const scope = makeExprScope(item, i, nodeCtx);
        const cond = await nodeCtx.exprEngine.evaluate(config.condition, scope);
        if (cond) trueItems.push(item);
        else falseItems.push(item);
      }
      return {
        kind: 'output',
        ports: {
          ...(trueItems.length > 0 ? { true: trueItems } : {}),
          ...(falseItems.length > 0 ? { false: falseItems } : {}),
        },
      };
    },
  };

  const switchNode: NodeHandler<z.infer<typeof SwitchConfigSchema>> = {
    type: 'logic.switch',
    category: 'Logic',
    label: 'Switch Router',
    configSchema: SwitchConfigSchema,
    ports: { inputs: ['in'], outputs: ['default', 'error'] },
    getOutputPorts: (cfg) => [
      ...cfg.cases.map((c) => c.id),
      ...(cfg.default ? ['default'] : []),
      'error',
    ],
    async execute(input, config, nodeCtx) {
      const ports: Record<string, WorkflowItem[]> = {};
      for (let i = 0; i < input.length; i++) {
        const item = input[i]!;
        const scope = makeExprScope(item, i, nodeCtx);
        let matched = false;
        for (const c of config.cases) {
          const ok = await nodeCtx.exprEngine.evaluate(c.expr, scope);
          if (ok) {
            ports[c.id] = [...(ports[c.id] ?? []), item];
            matched = true;
            break;
          }
        }
        if (!matched && config.default) {
          ports['default'] = [...(ports['default'] ?? []), item];
        }
      }
      return { kind: 'output', ports };
    },
  };

  const loopNode: NodeHandler<z.infer<typeof LoopConfigSchema>> = {
    type: 'logic.loop',
    category: 'Logic',
    label: 'Loop (For-Each / While)',
    configSchema: LoopConfigSchema,
    ports: { inputs: ['in'], outputs: ['loop', 'done', 'error'] },
    async execute(input) {
      return { kind: 'output', ports: { done: input } };
    },
  };

  const parallelNode: NodeHandler<z.infer<typeof ParallelConfigSchema>> = {
    type: 'logic.parallel',
    category: 'Logic',
    label: 'Parallel Split',
    configSchema: ParallelConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    getOutputPorts: (cfg) =>
      cfg.branches && cfg.branches.length > 0 ? [...cfg.branches, 'error'] : ['main', 'error'],
    async execute(input, config) {
      if (config.branches && config.branches.length > 0) {
        const ports: Record<string, WorkflowItem[]> = {};
        for (const b of config.branches) {
          ports[b] = [...input];
        }
        return { kind: 'output', ports };
      }
      return { kind: 'output', ports: { main: input } };
    },
  };

  const joinNode: NodeHandler<z.infer<typeof JoinConfigSchema>> = {
    type: 'logic.join',
    category: 'Logic',
    label: 'Parallel Join',
    configSchema: JoinConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input) {
      return { kind: 'output', ports: { main: input } };
    },
  };

  const waitNode: NodeHandler<z.infer<typeof WaitConfigSchema>> = {
    type: 'logic.wait',
    category: 'Logic',
    label: 'Wait / Delay',
    configSchema: WaitConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'timeout'] },
    async execute(input, config) {
      if (config.duration_ms !== undefined && config.duration_ms > 0) {
        return {
          kind: 'wait',
          waitKind: 'timer',
          resumeAfterMs: config.duration_ms,
          reason: config.reason,
        };
      }
      return { kind: 'output', ports: { main: input } };
    },
  };

  const setNode: NodeHandler<z.infer<typeof SetConfigSchema>> = {
    type: 'data.set',
    category: 'Data',
    label: 'Set / Transform',
    configSchema: SetConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input, config, nodeCtx) {
      const out: WorkflowItem[] = [];
      for (let i = 0; i < input.length; i++) {
        const item = input[i]!;
        const scope = makeExprScope(item, i, nodeCtx);
        const nextJson: Record<string, unknown> = config.keep_only_set
          ? {}
          : structuredClone(item.json);
        for (const assign of config.assignments) {
          const val = await nodeCtx.exprEngine.evaluateConfigValue(assign.expr, scope);
          setNestedPath(nextJson, assign.path, val);
        }
        out.push(makeItem(nextJson, nodeCtx.nodeId, i));
      }
      return { kind: 'output', ports: { main: out } };
    },
  };

  const codeNode: NodeHandler<z.infer<typeof CodeConfigSchema>> = {
    type: 'data.code',
    category: 'Data',
    label: 'Code (JS / Python Sandbox)',
    configSchema: CodeConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input, config, nodeCtx) {
      const inputsObj = {
        items: input.map((it) => it.json),
        first: input[0]?.json ?? {},
      };
      const exec =
        config.language === 'python'
          ? await nodeCtx.sandboxRunner.runPython(config.code, inputsObj, config.timeout_ms)
          : await nodeCtx.sandboxRunner.runJavaScript(config.code, inputsObj, config.timeout_ms);

      const outJson =
        exec.result && typeof exec.result === 'object' && !Array.isArray(exec.result)
          ? (exec.result as Record<string, unknown>)
          : { result: exec.result, stdout: exec.stdout };
      return { kind: 'output', ports: { main: [makeItem(outJson, nodeCtx.nodeId, 0)] } };
    },
  };

  const httpNode: NodeHandler<z.infer<typeof HttpConfigSchema>> = {
    type: 'integration.http',
    category: 'Integration',
    label: 'HTTP Request (SSRF Guarded)',
    configSchema: HttpConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input, config, nodeCtx) {
      const scope = makeExprScope(input[0], 0, nodeCtx);
      const urlRaw = String(await nodeCtx.exprEngine.evaluateConfigValue(config.url, scope));
      const safeUrl = await assertSafeOutboundUrl(urlRaw);
      const resolvedBody =
        config.body !== undefined
          ? await nodeCtx.exprEngine.evaluateConfigValue(config.body, scope)
          : undefined;
      if (nodeCtx.customActionExecutor) {
        const res = await nodeCtx.customActionExecutor('integration.http', {
          method: config.method,
          url: safeUrl.toString(),
          headers: config.headers,
          body: resolvedBody,
        });
        return { kind: 'output', ports: { main: [makeItem(res, nodeCtx.nodeId, 0)] } };
      }
      const res = await fetch(safeUrl.toString(), {
        method: config.method,
        headers: config.headers,
        body: resolvedBody !== undefined ? JSON.stringify(resolvedBody) : undefined,
        redirect: 'manual',
      });
      const text = await res.text();
      return {
        kind: 'output',
        ports: { main: [makeItem({ status: res.status, body: text }, nodeCtx.nodeId, 0)] },
      };
    },
  };

  const agentNode: NodeHandler<z.infer<typeof AgentNodeConfigSchema>> = {
    type: 'ai.agent',
    category: 'AI',
    label: 'Agent Step',
    configSchema: AgentNodeConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'escalated', 'error'] },
    async execute(input, config, nodeCtx): Promise<NodeResult> {
      const out: WorkflowItem[] = [];
      for (let i = 0; i < input.length; i++) {
        const item = input[i]!;
        const scope = makeExprScope(item, i, nodeCtx);
        const evaluatedInput = await nodeCtx.exprEngine.evaluateConfigValue(config.input, scope);
        const userInput =
          typeof evaluatedInput === 'string' ? evaluatedInput : JSON.stringify(evaluatedInput);

        const resolvedDef = nodeCtx.resolveAgent?.(config.agent);
        if (resolvedDef && nodeCtx.modelGateway && nodeCtx.toolGateway && nodeCtx.usageLedger) {
          const runRes = await executeReActAgentRun(
            {
              ctx: nodeCtx.ctx,
              projectId: nodeCtx.ctx.projectId ?? 'prj_default',
              environmentId: nodeCtx.ctx.environmentId ?? 'env_dev',
              agentId: config.agent,
              definition: resolvedDef,
              userInput,
              dryRun: config.dry_run,
            },
            {
              modelGateway: nodeCtx.modelGateway,
              toolGateway: nodeCtx.toolGateway,
              usageLedger: nodeCtx.usageLedger,
              clock: nodeCtx.clock,
            },
          );
          if (runRes.terminationReason === 'escalated') {
            return {
              kind: 'output',
              ports: {
                escalated: [
                  makeItem(
                    {
                      agent: config.agent,
                      status: runRes.status,
                      output: runRes.output,
                    },
                    nodeCtx.nodeId,
                    i,
                  ),
                ],
              },
            };
          }
          const jsonOut =
            runRes.output && typeof runRes.output === 'object' && !Array.isArray(runRes.output)
              ? (runRes.output as Record<string, unknown>)
              : { answer: runRes.output };
          out.push(makeItem({ ...jsonOut, cost_micro_usd: runRes.costMicroUsd }, nodeCtx.nodeId, i));
        } else {
          out.push(
            makeItem(
              {
                agent: config.agent,
                answer: `Handled by ${config.agent}: ${userInput.slice(0, 120)}`,
                category: item.json['category'] ?? 'general',
              },
              nodeCtx.nodeId,
              i,
            ),
          );
        }
      }
      return { kind: 'output', ports: { main: out } };
    },
  };

  const llmNode: NodeHandler<z.infer<typeof LlmNodeConfigSchema>> = {
    type: 'ai.llm',
    category: 'AI',
    label: 'LLM Completion',
    configSchema: LlmNodeConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input, config, nodeCtx) {
      const out: WorkflowItem[] = [];
      for (let i = 0; i < input.length; i++) {
        const item = input[i]!;
        const scope = makeExprScope(item, i, nodeCtx);
        const prompt = String(await nodeCtx.exprEngine.evaluateConfigValue(config.prompt, scope));
        if (nodeCtx.modelGateway) {
          const gw = await nodeCtx.modelGateway.complete(
            nodeCtx.ctx,
            nodeCtx.ctx.workspaceId ?? 'ws_default',
            {
              tier: config.tier,
              provider: config.provider,
              model: config.model,
              messages: [
                ...(config.system ? [{ role: 'system' as const, content: config.system }] : []),
                { role: 'user' as const, content: prompt },
              ],
              responseSchema: config.output_schema,
            },
          );
          out.push(
            makeItem(
              { text: gw.response.content, cost_micro_usd: gw.costMicroUsd },
              nodeCtx.nodeId,
              i,
            ),
          );
        } else {
          out.push(makeItem({ text: `LLM response: ${prompt.slice(0, 100)}` }, nodeCtx.nodeId, i));
        }
      }
      return { kind: 'output', ports: { main: out } };
    },
  };

  const notifyNode: NodeHandler<z.infer<typeof NotifyConfigSchema>> = {
    type: 'human.notify',
    category: 'Human',
    label: 'Notify (Slack / Email / Webhook)',
    configSchema: NotifyConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input, config, nodeCtx) {
      const out: WorkflowItem[] = [];
      for (let i = 0; i < input.length; i++) {
        const item = input[i]!;
        const scope = makeExprScope(item, i, nodeCtx);
        const message = String(
          await nodeCtx.exprEngine.evaluateConfigValue(config.template, scope),
        );
        nodeCtx.notificationsLog.push({
          channel: config.channel,
          recipients: [...config.recipients],
          message,
        });
        out.push(
          makeItem(
            { notified: true, channel: config.channel, recipients: config.recipients, message },
            nodeCtx.nodeId,
            i,
          ),
        );
      }
      return { kind: 'output', ports: { main: out } };
    },
  };

  const subworkflowNode: NodeHandler<z.infer<typeof SubworkflowConfigSchema>> = {
    type: 'control.subworkflow',
    category: 'Control',
    label: 'Sub-Workflow Call',
    configSchema: SubworkflowConfigSchema,
    ports: { inputs: ['in'], outputs: ['main', 'error'] },
    async execute(input, config, nodeCtx) {
      if (nodeCtx.executeSubworkflow) {
        const items = await nodeCtx.executeSubworkflow(config.workflow, input);
        return { kind: 'output', ports: { main: items } };
      }
      return { kind: 'output', ports: { main: input } };
    },
  };

  const stopNode: NodeHandler<z.infer<typeof StopConfigSchema>> = {
    type: 'control.stop',
    category: 'Control',
    label: 'Stop Workflow',
    configSchema: StopConfigSchema,
    ports: { inputs: ['in'], outputs: [] },
    async execute(input, config) {
      return {
        kind: 'stop',
        status: config.status,
        message: config.message,
        output: input,
      };
    },
  };

  return [
    passThrough('trigger.webhook', 'Trigger', 'Webhook Trigger', WebhookConfigSchema, true) as unknown as NodeHandler<never>,
    passThrough('trigger.schedule', 'Trigger', 'Schedule Trigger', ScheduleConfigSchema, true) as unknown as NodeHandler<never>,
    passThrough('trigger.manual', 'Trigger', 'Manual Trigger', ManualConfigSchema, true) as unknown as NodeHandler<never>,
    ifNode as unknown as NodeHandler<never>,
    switchNode as unknown as NodeHandler<never>,
    loopNode as unknown as NodeHandler<never>,
    parallelNode as unknown as NodeHandler<never>,
    joinNode as unknown as NodeHandler<never>,
    waitNode as unknown as NodeHandler<never>,
    setNode as unknown as NodeHandler<never>,
    codeNode as unknown as NodeHandler<never>,
    httpNode as unknown as NodeHandler<never>,
    agentNode as unknown as NodeHandler<never>,
    llmNode as unknown as NodeHandler<never>,
    notifyNode as unknown as NodeHandler<never>,
    subworkflowNode as unknown as NodeHandler<never>,
    stopNode as unknown as NodeHandler<never>,
  ];
}

export class NodeRegistry {
  private readonly handlers = new Map<string, NodeHandler<never>>();

  constructor(seedBuiltins = true) {
    if (seedBuiltins) {
      for (const h of createDefaultNodeHandlers()) {
        this.register(h);
      }
    }
  }

  register<C>(handler: NodeHandler<C>): void {
    this.handlers.set(handler.type, handler as unknown as NodeHandler<never>);
  }

  get(type: string): NodeHandler<never> | undefined {
    return this.handlers.get(type);
  }

  list(): NodeHandler<never>[] {
    return [...this.handlers.values()];
  }
}

// ---------- Graph Validation (M.2, FR-WF-1) ----------

export interface GraphValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'DUPLICATE_NODE_ID'
    | 'UNKNOWN_NODE_TYPE'
    | 'INVALID_NODE_CONFIG'
    | 'MISSING_EDGE_ENDPOINT'
    | 'INVALID_PORT'
    | 'NO_TRIGGER'
    | 'ORPHAN_NODE'
    | 'ILLEGAL_CYCLE'
    | 'DUPLICATE_TRIGGER_PATH'
    | 'UNCONNECTED_BRANCH';
  readonly message: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly GraphValidationIssue[];
  readonly warnings: readonly GraphValidationIssue[];
}

export function getEffectiveOutputPorts(
  node: WorkflowNode,
  handler: NodeHandler<never>,
): readonly string[] {
  if (handler.getOutputPorts) {
    return handler.getOutputPorts(node.config as never);
  }
  return handler.ports.outputs;
}

/**
 * Finds all nodes inside a logic.loop's loop body subgraph and identifies legal back-edges returning into loop.in.
 */
export function analyzeLoopSubgraphs(graph: WorkflowGraph): {
  loopBodies: Map<string, Set<string>>;
  legalBackEdges: Set<string>;
} {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    outgoing.set(e.from.node, [...(outgoing.get(e.from.node) ?? []), e]);
  }

  const loopBodies = new Map<string, Set<string>>();
  const legalBackEdges = new Set<string>();

  for (const node of graph.nodes) {
    if (node.type !== 'logic.loop') continue;
    const body = new Set<string>();
    const loopStartEdges = (outgoing.get(node.id) ?? []).filter((e) => e.from.port === 'loop');
    const queue = loopStartEdges.map((e) => e.to.node);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === node.id || body.has(cur) || !nodesById.has(cur)) continue;
      body.add(cur);
      for (const e of outgoing.get(cur) ?? []) {
        if (e.to.node === node.id) {
          legalBackEdges.add(e.id);
        } else if (!body.has(e.to.node)) {
          queue.push(e.to.node);
        }
      }
    }
    loopBodies.set(node.id, body);
  }

  return { loopBodies, legalBackEdges };
}

export function validateWorkflowGraph(
  graph: WorkflowGraph,
  registry: NodeRegistry,
  existingEnvWebhookPaths: ReadonlySet<string> = new Set(),
): GraphValidationResult {
  const errors: GraphValidationIssue[] = [];
  const warnings: GraphValidationIssue[] = [];

  const nodesById = new Map<string, WorkflowNode>();
  const localTriggerPaths = new Set<string>();

  for (const node of graph.nodes) {
    if (nodesById.has(node.id)) {
      errors.push({
        severity: 'error',
        code: 'DUPLICATE_NODE_ID',
        nodeId: node.id,
        message: `Duplicate node ID "${node.id}".`,
      });
      continue;
    }
    nodesById.set(node.id, node);

    const handler = registry.get(node.type);
    if (!handler) {
      errors.push({
        severity: 'error',
        code: 'UNKNOWN_NODE_TYPE',
        nodeId: node.id,
        message: `Unknown node type "${node.type}" on node "${node.name}".`,
      });
      continue;
    }

    const parsedCfg = handler.configSchema.safeParse(node.config);
    if (!parsedCfg.success) {
      errors.push({
        severity: 'error',
        code: 'INVALID_NODE_CONFIG',
        nodeId: node.id,
        message: `Invalid config on "${node.name}": ${parsedCfg.error.issues.map((i) => i.message).join('; ')}`,
      });
    }

    if (node.type === 'trigger.webhook' && typeof node.config['path'] === 'string') {
      const p = node.config['path'];
      if (localTriggerPaths.has(p) || existingEnvWebhookPaths.has(p)) {
        errors.push({
          severity: 'error',
          code: 'DUPLICATE_TRIGGER_PATH',
          nodeId: node.id,
          message: `Webhook path "${p}" is already used in this environment.`,
        });
      }
      localTriggerPaths.add(p);
    }
  }

  const triggers = graph.nodes.filter((n) => n.type.startsWith('trigger.'));
  if (triggers.length === 0) {
    errors.push({
      severity: 'error',
      code: 'NO_TRIGGER',
      message: 'Workflow graph must contain at least one trigger node.',
    });
  }

  const outgoingByNode = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const fromNode = nodesById.get(edge.from.node);
    const toNode = nodesById.get(edge.to.node);
    if (!fromNode || !toNode) {
      errors.push({
        severity: 'error',
        code: 'MISSING_EDGE_ENDPOINT',
        edgeId: edge.id,
        message: `Edge "${edge.id}" references missing node.`,
      });
      continue;
    }
    const fromHandler = registry.get(fromNode.type);
    const toHandler = registry.get(toNode.type);
    if (fromHandler) {
      const validOutPorts = getEffectiveOutputPorts(fromNode, fromHandler);
      if (!validOutPorts.includes(edge.from.port)) {
        errors.push({
          severity: 'error',
          code: 'INVALID_PORT',
          edgeId: edge.id,
          nodeId: fromNode.id,
          message: `Edge "${edge.id}" uses invalid source port "${edge.from.port}" on "${fromNode.name}".`,
        });
      }
    }
    if (toHandler && !toHandler.ports.inputs.includes(edge.to.port)) {
      errors.push({
        severity: 'error',
        code: 'INVALID_PORT',
        edgeId: edge.id,
        nodeId: toNode.id,
        message: `Edge "${edge.id}" uses invalid target port "${edge.to.port}" on "${toNode.name}".`,
      });
    }
    outgoingByNode.set(edge.from.node, [...(outgoingByNode.get(edge.from.node) ?? []), edge]);
  }

  if (triggers.length > 0) {
    const visited = new Set<string>(triggers.map((t) => t.id));
    const q = [...triggers.map((t) => t.id)];
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const e of outgoingByNode.get(cur) ?? []) {
        if (!visited.has(e.to.node)) {
          visited.add(e.to.node);
          q.push(e.to.node);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!node.type.startsWith('trigger.') && !visited.has(node.id)) {
        errors.push({
          severity: 'error',
          code: 'ORPHAN_NODE',
          nodeId: node.id,
          message: `Node "${node.name}" is unreachable from any trigger.`,
        });
      }
    }
  }

  const { legalBackEdges } = analyzeLoopSubgraphs(graph);
  const color = new Map<string, 0 | 1 | 2>();
  const dfsCycle = (nodeId: string): boolean => {
    color.set(nodeId, 1);
    for (const edge of outgoingByNode.get(nodeId) ?? []) {
      if (legalBackEdges.has(edge.id)) continue;
      const targetColor = color.get(edge.to.node) ?? 0;
      if (targetColor === 1) {
        errors.push({
          severity: 'error',
          code: 'ILLEGAL_CYCLE',
          nodeId: edge.to.node,
          edgeId: edge.id,
          message: `Illegal cycle detected involving "${nodesById.get(edge.to.node)?.name ?? edge.to.node}"; cycles must use a logic.loop node.`,
        });
        return true;
      }
      if (targetColor === 0) {
        if (dfsCycle(edge.to.node)) return true;
      }
    }
    color.set(nodeId, 2);
    return false;
  };

  for (const node of graph.nodes) {
    if ((color.get(node.id) ?? 0) === 0) {
      dfsCycle(node.id);
    }
  }

  for (const node of graph.nodes) {
    const handler = registry.get(node.type);
    if (!handler) continue;
    if (node.type === 'logic.if' || node.type === 'logic.switch') {
      const connectedPorts = new Set((outgoingByNode.get(node.id) ?? []).map((e) => e.from.port));
      for (const port of getEffectiveOutputPorts(node, handler)) {
        if (port !== 'error' && !connectedPorts.has(port)) {
          warnings.push({
            severity: 'warning',
            code: 'UNCONNECTED_BRANCH',
            nodeId: node.id,
            message: `Branch port "${port}" on "${node.name}" is unconnected.`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function assertValidWorkflowGraph(
  graph: WorkflowGraph,
  registry: NodeRegistry,
  existingEnvWebhookPaths?: ReadonlySet<string>,
): void {
  const res = validateWorkflowGraph(graph, registry, existingEnvWebhookPaths);
  if (!res.valid) {
    throw new PlatformError(
      'VAL_GRAPH_INVALID',
      `Workflow graph validation failed: ${res.errors.map((e) => e.message).join('; ')}`,
      { errors: res.errors, warnings: res.warnings },
    );
  }
}

export function computeWorkflowHash(graph: WorkflowGraph): string {
  return createHash('sha256').update(canonicalJson(graph), 'utf8').digest('hex');
}
