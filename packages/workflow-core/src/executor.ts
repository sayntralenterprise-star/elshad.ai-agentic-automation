import {
  PlatformError,
  SystemClock,
  SystemIdGen,
  type Clock,
  type FailureClass,
  type IdGen,
  type RunStatus,
  type TenantContext,
} from '@elshad/domain';
import {
  InMemoryEffectLedger,
  InMemoryExecutionEngine,
  type EffectLedger,
  type ExecutionEngine,
  type Lease,
  type RunRecord,
  type RunStepRecord,
  type TerminationReason,
  type TurnStepInput,
} from '@elshad/execution';
import type { ModelGateway } from '@elshad/model-kit';
import type { AgentDefinition, UsageLedger } from '@elshad/runtime-core';
import { withSpan } from '@elshad/telemetry';
import { SandboxRunner, ToolGateway } from '@elshad/tool-kit';
import { SandboxedJsonataEngine } from './expression.js';
import {
  NodeRegistry,
  analyzeLoopSubgraphs,
  assertValidWorkflowGraph,
  makeExprScope,
  makeItem,
  type NodeExecutionContext,
  type NodeResult,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowItem,
  type WorkflowNode,
} from './graph.js';

export interface NodeExecutionTraceEntry {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly seq: number;
  readonly status: 'succeeded' | 'failed';
  readonly inputCount: number;
  readonly outputCounts: Record<string, number>;
  readonly fromPinnedData: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface ExecuteWorkflowInput {
  readonly ctx: TenantContext;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly versionId: string;
  readonly graph: WorkflowGraph;
  readonly triggerPayload?: Record<string, unknown>;
  readonly env?: Record<string, string>;
  readonly pinnedData?: Record<string, WorkflowItem[] | Record<string, unknown>[]>;
  readonly startFromNodeId?: string;
  readonly existingRunId?: string;
  readonly checkpointBatchSize?: number;
  readonly simulateCrashAfterStep?: number;
}

export interface ExecuteWorkflowDeps {
  readonly registry?: NodeRegistry;
  readonly executionEngine?: ExecutionEngine;
  readonly effectLedger?: EffectLedger;
  readonly exprEngine?: SandboxedJsonataEngine;
  readonly modelGateway?: ModelGateway;
  readonly toolGateway?: ToolGateway;
  readonly usageLedger?: UsageLedger;
  readonly sandboxRunner?: SandboxRunner;
  readonly clock?: Clock;
  readonly idGen?: IdGen;
  readonly resolveAgent?: (agentRef: string) => AgentDefinition | undefined;
  readonly customActionExecutor?: (
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

export interface ExecuteWorkflowResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly terminationReason: TerminationReason;
  readonly failureClass: FailureClass | null;
  readonly nodeOutputs: Record<string, Record<string, WorkflowItem[]>>;
  readonly trace: readonly NodeExecutionTraceEntry[];
  readonly notificationsLog: readonly {
    channel: string;
    recipients: string[];
    message: string;
  }[];
  readonly steps: readonly RunStepRecord[];
  readonly finalOutput: WorkflowItem[];
  readonly error?: { readonly code: string; readonly message: string };
}

interface LoopCursorState {
  cursor: number;
  sourceItems: WorkflowItem[];
  accumulated: WorkflowItem[];
}

interface PendingTask {
  nodeId: string;
  items: WorkflowItem[];
  fromNodeId?: string;
}

interface WorkflowScratchpad {
  queue: PendingTask[];
  nodeOutputs: Record<string, Record<string, WorkflowItem[]>>;
  joinInbox: Record<string, Record<string, WorkflowItem[]>>;
  loopProgress: Record<string, LoopCursorState>;
  trace: NodeExecutionTraceEntry[];
  notificationsLog: Array<{ channel: string; recipients: string[]; message: string }>;
  stepSeq: number;
}

function normalizePinnedItems(
  nodeId: string,
  raw: readonly unknown[],
): WorkflowItem[] {
  return raw.map((entry, idx) => {
    if (
      entry &&
      typeof entry === 'object' &&
      'json' in entry &&
      'meta' in entry
    ) {
      return entry as WorkflowItem;
    }
    return makeItem(
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : { value: entry },
      nodeId,
      idx,
    );
  });
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWorkflowGraph(
  input: ExecuteWorkflowInput,
  deps: ExecuteWorkflowDeps = {},
): Promise<ExecuteWorkflowResult> {
  const clock = deps.clock ?? new SystemClock();
  const idGen = deps.idGen ?? new SystemIdGen();
  const registry = deps.registry ?? new NodeRegistry(true);
  const exprEngine = deps.exprEngine ?? new SandboxedJsonataEngine();
  const executionEngine = deps.executionEngine ?? new InMemoryExecutionEngine({ clock, idGen });
  const effectLedger = deps.effectLedger ?? new InMemoryEffectLedger(clock);
  const sandboxRunner = deps.sandboxRunner ?? new SandboxRunner();

  assertValidWorkflowGraph(input.graph, registry);

  const nodesById = new Map<string, WorkflowNode>(input.graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const e of input.graph.edges) {
    outgoing.set(e.from.node, [...(outgoing.get(e.from.node) ?? []), e]);
    incoming.set(e.to.node, [...(incoming.get(e.to.node) ?? []), e]);
  }
  const { loopBodies } = analyzeLoopSubgraphs(input.graph);

  // Merge graph.pinned_data and call-site pinnedData
  const effectivePinned = new Map<string, WorkflowItem[]>();
  for (const [nid, items] of Object.entries(input.graph.pinned_data ?? {})) {
    if (Array.isArray(items) && items.length > 0) {
      effectivePinned.set(nid, normalizePinnedItems(nid, items));
    }
  }
  for (const [nid, items] of Object.entries(input.pinnedData ?? {})) {
    if (Array.isArray(items) && items.length > 0) {
      effectivePinned.set(nid, normalizePinnedItems(nid, items));
    }
  }

  // Create or resume durable Run + Lease
  let runRecord: RunRecord;
  let lease: Lease | undefined;
  let scratch: WorkflowScratchpad;

  const workspaceId = input.ctx.workspaceId ?? 'ws_default';
  const envId = input.ctx.environmentId ?? 'env_dev';
  const queueName = input.graph.settings.queue || 'default';

  if (input.existingRunId) {
    const found = await executionEngine.getRun(input.ctx.orgId, input.existingRunId);
    if (!found) {
      throw new PlatformError('RES_NOT_FOUND', `Run ${input.existingRunId} not found.`);
    }
    runRecord = found;
    // Ensure a work item can be claimed on resume
    if (runRecord.status === 'failed' || runRecord.status === 'timed_out') {
      await executionEngine.redrive(input.ctx, [runRecord.id]);
    }
    await executionEngine.requeueExpiredLeases(new Date(clock.now().getTime() + 120_000));
    const claimed = await executionEngine.claim('wf-worker-resume', [queueName], 10);
    lease = claimed.find((l) => l.runId === runRecord.id);
    const saved = lease ? await executionEngine.loadState(lease) : null;
    if (saved && saved.scratchpad && 'queue' in saved.scratchpad) {
      scratch = structuredClone(saved.scratchpad as unknown as WorkflowScratchpad);
    } else {
      scratch = initFreshScratchpad();
    }
  } else {
    runRecord = await executionEngine.createRun(input.ctx, {
      workspaceId,
      environmentId: envId,
      subjectType: 'workflow_version',
      subjectVersionId: input.versionId,
      input: input.triggerPayload ?? {},
      limits: {
        max_steps: 5_000,
        max_tokens: 500_000,
        max_wall_time_ms: input.graph.settings.timeout_ms,
        max_cost_micro_usd: 10_000_000,
      },
      labels: { workflow_name: input.workflowName },
      queue: queueName,
      priority: 5,
    });
    const claimed = await executionEngine.claim('wf-worker', [queueName], 10);
    lease = claimed.find((l) => l.runId === runRecord.id);
    scratch = initFreshScratchpad();
  }

  function initFreshScratchpad(): WorkflowScratchpad {
    const nodeOutputs: Record<string, Record<string, WorkflowItem[]>> = {};
    for (const [nid, pItems] of effectivePinned.entries()) {
      nodeOutputs[nid] = { main: pItems };
    }

    const queue: PendingTask[] = [];
    if (input.startFromNodeId) {
      const startNode = nodesById.get(input.startFromNodeId);
      if (!startNode) {
        throw new PlatformError(
          'VAL_GRAPH_INVALID',
          `startFromNodeId "${input.startFromNodeId}" not found in workflow.`,
        );
      }
      const inEdges = incoming.get(startNode.id) ?? [];
      const seedItems: WorkflowItem[] = [];
      for (const e of inEdges) {
        const upOut = nodeOutputs[e.from.node]?.[e.from.port] ?? nodeOutputs[e.from.node]?.['main'];
        if (upOut) seedItems.push(...upOut);
      }
      queue.push({
        nodeId: startNode.id,
        items:
          seedItems.length > 0
            ? seedItems
            : [makeItem(input.triggerPayload ?? {}, 'manual_seed', 0)],
      });
    } else {
      const triggers = input.graph.nodes.filter((n) => n.type.startsWith('trigger.'));
      for (const t of triggers) {
        queue.push({
          nodeId: t.id,
          items: [makeItem(input.triggerPayload ?? {}, t.id, 0)],
        });
      }
    }

    return {
      queue,
      nodeOutputs,
      joinInbox: {},
      loopProgress: {},
      trace: [],
      notificationsLog: [],
      stepSeq: 0,
    };
  }

  const commitCheckpoint = async (stepsToCommit: TurnStepInput[], milestone = false): Promise<void> => {
    if (!lease) return;
    await executionEngine.commitTurn(lease, {
      steps: stepsToCommit,
      checkpoint: {
        seq: scratch.stepSeq,
        cursor: scratch.stepSeq,
        scratchpad: structuredClone(scratch) as unknown as Record<string, unknown>,
        messages: [],
        blackboard: {},
        engine_version: '1.0.0',
      },
      milestone,
    });
  };

  let checkpointsCommittedInAttempt = 0;

  const executeSingleNodeOnce = async (
    node: WorkflowNode,
    items: WorkflowItem[],
  ): Promise<{
    result: NodeResult;
    fromPinned: boolean;
    latencyMs: number;
  }> => {
    const t0 = Date.now();
    // Use pinned output when configured and not explicitly re-testing that exact node
    const pinned = effectivePinned.get(node.id);
    if (pinned && input.startFromNodeId !== node.id) {
      return {
        result: { kind: 'output', ports: { main: pinned } },
        fromPinned: true,
        latencyMs: 0,
      };
    }

    const handler = registry.get(node.type);
    if (!handler) {
      throw new PlatformError('SYS_INTERNAL', `Missing node handler for "${node.type}".`);
    }

    const runAction = async (): Promise<NodeResult> => {
      const nodeCtx: NodeExecutionContext = {
        ctx: input.ctx,
        runId: runRecord.id,
        workflowId: input.workflowId,
        workflowName: input.workflowName,
        nodeId: node.id,
        nodeName: node.name,
        stepSeq: scratch.stepSeq + 1,
        env: input.env ?? {},
        nodeOutputs: scratch.nodeOutputs,
        triggerPayload: input.triggerPayload ?? {},
        exprEngine,
        clock,
        modelGateway: deps.modelGateway,
        toolGateway: deps.toolGateway,
        usageLedger: deps.usageLedger,
        sandboxRunner,
        notificationsLog: scratch.notificationsLog,
        customActionExecutor: deps.customActionExecutor,
        resolveAgent: deps.resolveAgent,
      };

      // Deduplicate external side-effecting nodes via EffectLedger
      if (node.type === 'human.notify' || node.type === 'integration.http') {
        const dedupSeq = scratch.stepSeq + 1;
        const once = await effectLedger.executeOnce(
          input.ctx.orgId,
          { runId: runRecord.id, stepSeq: dedupSeq },
          async () => handler.execute(items, node.config as never, nodeCtx),
        );
        return once.result;
      }
      return handler.execute(items, node.config as never, nodeCtx);
    };

    const errMode = node.on_error?.mode ?? 'fail';
    const maxRetries = errMode === 'retry' ? (node.on_error?.retry?.max ?? 2) : 0;
    const backoffMs = errMode === 'retry' ? (node.on_error?.retry?.backoff_ms ?? 50) : 0;

    let attempt = 0;
    while (true) {
      try {
        const result = await runAction();
        return {
          result,
          fromPinned: false,
          latencyMs: Date.now() - t0,
        };
      } catch (err) {
        if (attempt < maxRetries) {
          attempt += 1;
          await sleepMs(backoffMs * attempt);
          continue;
        }
        if (errMode === 'continue') {
          return {
            result: { kind: 'output', ports: { main: items } },
            fromPinned: false,
            latencyMs: Date.now() - t0,
          };
        }
        if (errMode === 'route') {
          const msg = err instanceof Error ? err.message : String(err);
          const errItems = items.map((it, idx) =>
            makeItem({ ...it.json, error: { message: msg, node: node.id } }, node.id, idx),
          );
          return {
            result: {
              kind: 'output',
              ports: {
                error:
                  errItems.length > 0
                    ? errItems
                    : [makeItem({ error: { message: msg, node: node.id } }, node.id, 0)],
              },
            },
            fromPinned: false,
            latencyMs: Date.now() - t0,
          };
        }
        throw err;
      }
    }
  };

  const executeLoopNode = async (
    loopNode: WorkflowNode,
    inputItems: WorkflowItem[],
  ): Promise<WorkflowItem[]> => {
    const cfg = loopNode.config as {
      mode?: 'for_each' | 'while';
      items?: string;
      condition?: string;
      max_iterations?: number;
      batch_size?: number;
    };
    const mode = cfg.mode ?? 'for_each';
    const maxIter = cfg.max_iterations ?? 1000;
    const batchSize = Math.max(1, cfg.batch_size ?? 1);
    const checkpointChunk = Math.max(batchSize, input.checkpointBatchSize ?? 50);

    let progress = scratch.loopProgress[loopNode.id];
    if (!progress) {
      let sourceItems = inputItems;
      if (mode === 'for_each' && cfg.items) {
        const exprScope = makeExprScope(inputItems[0], 0, {
          ctx: input.ctx,
          runId: runRecord.id,
          workflowId: input.workflowId,
          workflowName: input.workflowName,
          nodeId: loopNode.id,
          nodeName: loopNode.name,
          stepSeq: scratch.stepSeq,
          env: input.env ?? {},
          nodeOutputs: scratch.nodeOutputs,
          triggerPayload: input.triggerPayload ?? {},
          exprEngine,
          clock,
          sandboxRunner,
          notificationsLog: scratch.notificationsLog,
        });
        const evalRes =
          cfg.items.startsWith('=') || cfg.items.includes('{{')
            ? await exprEngine.evaluateConfigValue(cfg.items, exprScope)
            : await exprEngine.evaluate(cfg.items, exprScope);
        if (Array.isArray(evalRes)) {
          sourceItems = evalRes.map((v, idx) =>
            makeItem(
              v && typeof v === 'object' && !Array.isArray(v)
                ? (v as Record<string, unknown>)
                : { value: v },
              loopNode.id,
              idx,
            ),
          );
        }
      }
      if (mode === 'for_each' && sourceItems.length > maxIter) {
        throw new PlatformError(
          'RUN_STEP_LIMIT',
          `Loop node "${loopNode.name}" received ${sourceItems.length} items, exceeding max_iterations (${maxIter}).`,
        );
      }
      progress = { cursor: 0, sourceItems, accumulated: [] };
      scratch.loopProgress[loopNode.id] = progress;
    }

    const bodySet = loopBodies.get(loopNode.id) ?? new Set<string>();
    const loopStartEdges = (outgoing.get(loopNode.id) ?? []).filter((e) => e.from.port === 'loop');

    const runBodyOnce = async (batchItems: WorkflowItem[]): Promise<WorkflowItem[]> => {
      const localQueue: PendingTask[] = loopStartEdges.map((e) => ({
        nodeId: e.to.node,
        items: batchItems,
        fromNodeId: loopNode.id,
      }));
      let batchResult = batchItems;

      while (localQueue.length > 0) {
        const task = localQueue.shift()!;
        const bodyNode = nodesById.get(task.nodeId);
        if (!bodyNode || !bodySet.has(bodyNode.id)) continue;

        const exec = await executeSingleNodeOnce(bodyNode, task.items);
        if (exec.result.kind === 'output') {
          scratch.nodeOutputs[bodyNode.id] = exec.result.ports;
          for (const edge of outgoing.get(bodyNode.id) ?? []) {
            const portItems = exec.result.ports[edge.from.port];
            if (!portItems || portItems.length === 0) continue;
            if (edge.to.node === loopNode.id) {
              batchResult = portItems;
            } else if (bodySet.has(edge.to.node)) {
              localQueue.push({ nodeId: edge.to.node, items: portItems, fromNodeId: bodyNode.id });
            }
          }
        }
      }
      return batchResult;
    };

    if (mode === 'while') {
      let iter = progress.cursor;
      while (true) {
        if (iter >= maxIter) {
          throw new PlatformError(
            'RUN_STEP_LIMIT',
            `While loop "${loopNode.name}" exceeded max_iterations (${maxIter}).`,
          );
        }
        const scope = makeExprScope(
          progress.accumulated[progress.accumulated.length - 1] ?? progress.sourceItems[0],
          iter,
          {
            ctx: input.ctx,
            runId: runRecord.id,
            workflowId: input.workflowId,
            workflowName: input.workflowName,
            nodeId: loopNode.id,
            nodeName: loopNode.name,
            stepSeq: scratch.stepSeq,
            env: input.env ?? {},
            nodeOutputs: scratch.nodeOutputs,
            triggerPayload: input.triggerPayload ?? {},
            exprEngine,
            clock,
            sandboxRunner,
            notificationsLog: scratch.notificationsLog,
          },
        );
        const keepGoing = cfg.condition ? await exprEngine.evaluate(cfg.condition, scope) : false;
        if (!keepGoing) break;

        const iterOut = await runBodyOnce(progress.sourceItems);
        progress.accumulated.push(...iterOut);
        iter += 1;
        progress.cursor = iter;

        if (iter % checkpointChunk === 0) {
          scratch.stepSeq += 1;
          scratch.queue.unshift({ nodeId: loopNode.id, items: inputItems });
          await commitCheckpoint([
            {
              seq: scratch.stepSeq,
              type: 'node',
              summary: { nodeId: loopNode.id, loopCursor: iter },
              costMicroUsd: 0,
              latencyMs: 1,
            },
          ]);
          scratch.queue.shift();
          checkpointsCommittedInAttempt += 1;
          if (
            input.simulateCrashAfterStep !== undefined &&
            checkpointsCommittedInAttempt >= input.simulateCrashAfterStep
          ) {
            throw new PlatformError('SYS_UNAVAILABLE', 'SIMULATED_WORKER_CRASH');
          }
        }
      }
      return progress.accumulated;
    }

    // for_each mode
    const total = progress.sourceItems.length;
    let processedSinceCheckpoint = 0;

    while (progress.cursor < total) {
      const end = Math.min(total, progress.cursor + batchSize);
      const batch = progress.sourceItems.slice(progress.cursor, end);
      const out = await runBodyOnce(batch);
      progress.accumulated.push(...out);
      progress.cursor = end;
      processedSinceCheckpoint += batch.length;

      if (processedSinceCheckpoint >= checkpointChunk || progress.cursor >= total) {
        processedSinceCheckpoint = 0;
        scratch.stepSeq += 1;
        const stepInput: TurnStepInput = {
          seq: scratch.stepSeq,
          type: 'node',
          summary: {
            nodeId: loopNode.id,
            nodeType: loopNode.type,
            loopCursor: progress.cursor,
            loopTotal: total,
          },
          output: { processed: progress.cursor, total },
          costMicroUsd: 0,
          latencyMs: 1,
        };
        if (progress.cursor < total) {
          scratch.queue.unshift({ nodeId: loopNode.id, items: inputItems });
        }
        await commitCheckpoint([stepInput]);
        if (progress.cursor < total) {
          scratch.queue.shift();
        }
        checkpointsCommittedInAttempt += 1;
        if (
          input.simulateCrashAfterStep !== undefined &&
          checkpointsCommittedInAttempt >= input.simulateCrashAfterStep &&
          progress.cursor < total
        ) {
          throw new PlatformError('SYS_UNAVAILABLE', 'SIMULATED_WORKER_CRASH');
        }
      }
    }

    return progress.accumulated;
  };

  let lastOutput: WorkflowItem[] = [];

  return withSpan(
    'workflow.execute',
    {
      'elshad.org_id': input.ctx.orgId,
      'elshad.run_id': runRecord.id,
      'workflow.id': input.workflowId,
    },
    async () => {
      try {
        while (scratch.queue.length > 0) {
          // Process ready tasks respecting parallel concurrency cap
          const maxConcurrent = Math.max(1, input.graph.settings.max_concurrency);
          const batchTasks = scratch.queue.splice(0, maxConcurrent);

          const readyToRun: PendingTask[] = [];
          for (const task of batchTasks) {
            const targetNode = nodesById.get(task.nodeId);
            if (!targetNode) continue;

            if (targetNode.type === 'logic.join') {
              const sourceKey = task.fromNodeId ?? 'default';
              const inbox = (scratch.joinInbox[targetNode.id] ??= {});
              inbox[sourceKey] = task.items;

              const expectedInputs = (incoming.get(targetNode.id) ?? []).length;
              const arrivedCount = Object.keys(inbox).length;
              const joinMode = String(targetNode.config['join_mode'] ?? 'all');
              const reqCount =
                joinMode === 'any'
                  ? 1
                  : joinMode === 'n_of_m'
                    ? Number(targetNode.config['required_count'] ?? expectedInputs)
                    : Math.max(1, expectedInputs);

              if (arrivedCount < reqCount) {
                continue;
              }
              const merged = Object.values(inbox).flat();
              delete scratch.joinInbox[targetNode.id];
              readyToRun.push({ nodeId: targetNode.id, items: merged });
            } else {
              readyToRun.push(task);
            }
          }

          const results = await Promise.all(
            readyToRun.map(async (task) => {
              const node = nodesById.get(task.nodeId)!;
              if (node.type === 'logic.loop') {
                const doneItems = await executeLoopNode(node, task.items);
                return {
                  node,
                  inputCount: task.items.length,
                  fromPinned: false,
                  latencyMs: 1,
                  result: { kind: 'output', ports: { done: doneItems } } as NodeResult,
                };
              }
              const exec = await executeSingleNodeOnce(node, task.items);
              return {
                node,
                inputCount: task.items.length,
                fromPinned: exec.fromPinned,
                latencyMs: exec.latencyMs,
                result: exec.result,
              };
            }),
          );

          for (const r of results) {
            if (r.result.kind === 'wait') {
              if (lease) {
                await executionEngine.suspend(lease, {
                  kind: 'timer',
                  reason: r.result.reason,
                  fireAt: r.result.resumeAfterMs
                    ? new Date(clock.now().getTime() + r.result.resumeAfterMs).toISOString()
                    : undefined,
                });
              }
              const steps = await executionEngine.listSteps(input.ctx.orgId, runRecord.id);
              return {
                runId: runRecord.id,
                status: 'waiting_timer',
                terminationReason: 'escalated',
                failureClass: null,
                nodeOutputs: scratch.nodeOutputs,
                trace: scratch.trace,
                notificationsLog: scratch.notificationsLog,
                steps,
                finalOutput: lastOutput,
              };
            }

            if (r.result.kind === 'stop') {
              scratch.stepSeq += 1;
              lastOutput = r.result.output;
              scratch.trace.push({
                nodeId: r.node.id,
                nodeName: r.node.name,
                nodeType: r.node.type,
                seq: scratch.stepSeq,
                status: r.result.status === 'failed' ? 'failed' : 'succeeded',
                inputCount: r.inputCount,
                outputCounts: {},
                fromPinnedData: r.fromPinned,
                latencyMs: r.latencyMs,
              });
              await commitCheckpoint(
                [
                  {
                    seq: scratch.stepSeq,
                    type: 'node',
                    status: r.result.status === 'failed' ? 'failed' : 'succeeded',
                    summary: { nodeId: r.node.id, message: r.result.message },
                    output: r.result.output,
                    latencyMs: r.latencyMs,
                  },
                ],
                true,
              );
              if (r.result.status === 'failed') {
                if (lease) {
                  await executionEngine.retryOrFail(
                    lease,
                    new PlatformError('SYS_INTERNAL', r.result.message),
                  );
                }
                const steps = await executionEngine.listSteps(input.ctx.orgId, runRecord.id);
                return {
                  runId: runRecord.id,
                  status: 'failed',
                  terminationReason: 'error',
                  failureClass: 'permanent',
                  nodeOutputs: scratch.nodeOutputs,
                  trace: scratch.trace,
                  notificationsLog: scratch.notificationsLog,
                  steps,
                  finalOutput: lastOutput,
                  error: { code: 'SYS_INTERNAL', message: r.result.message },
                };
              }
              scratch.queue = [];
              break;
            }

            // Normal output result
            scratch.nodeOutputs[r.node.id] = r.result.ports;
            const outputCounts: Record<string, number> = {};
            for (const [portName, arr] of Object.entries(r.result.ports)) {
              outputCounts[portName] = arr.length;
              if (arr.length > 0) lastOutput = arr;
            }

            scratch.stepSeq += 1;
            scratch.trace.push({
              nodeId: r.node.id,
              nodeName: r.node.name,
              nodeType: r.node.type,
              seq: scratch.stepSeq,
              status: 'succeeded',
              inputCount: r.inputCount,
              outputCounts,
              fromPinnedData: r.fromPinned,
              latencyMs: r.latencyMs,
            });

            // Route items across outgoing edges BEFORE checkpointing so resumed state retains the next frontier
            const outEdges = outgoing.get(r.node.id) ?? [];
            for (const edge of outEdges) {
              const portItems = r.result.ports[edge.from.port];
              if (!portItems || portItems.length === 0) continue;
              scratch.queue.push({
                nodeId: edge.to.node,
                items: portItems,
                fromNodeId: `${r.node.id}:${edge.from.port}`,
              });
            }

            await commitCheckpoint(
              [
                {
                  seq: scratch.stepSeq,
                  type: 'node',
                  status: 'succeeded',
                  summary: {
                    nodeId: r.node.id,
                    nodeType: r.node.type,
                    fromPinnedData: r.fromPinned,
                    outputCounts,
                  },
                  output: r.result.ports,
                  latencyMs: r.latencyMs,
                },
              ],
              false,
            );
            checkpointsCommittedInAttempt += 1;

            if (
              input.simulateCrashAfterStep !== undefined &&
              checkpointsCommittedInAttempt >= input.simulateCrashAfterStep
            ) {
              throw new PlatformError('SYS_UNAVAILABLE', 'SIMULATED_WORKER_CRASH');
            }
          }
        }

        if (lease) {
          await executionEngine.complete(lease, {
            status: 'succeeded',
            terminationReason: 'final_answer',
            output: { items: lastOutput.map((it) => it.json) },
          });
        }
        const steps = await executionEngine.listSteps(input.ctx.orgId, runRecord.id);
        return {
          runId: runRecord.id,
          status: 'succeeded',
          terminationReason: 'final_answer',
          failureClass: null,
          nodeOutputs: scratch.nodeOutputs,
          trace: scratch.trace,
          notificationsLog: scratch.notificationsLog,
          steps,
          finalOutput: lastOutput,
        };
      } catch (err) {
        const pe =
          err instanceof PlatformError
            ? err
            : new PlatformError('SYS_INTERNAL', err instanceof Error ? err.message : String(err));
        const isSimulatedCrash = pe.message === 'SIMULATED_WORKER_CRASH';
        if (lease && !isSimulatedCrash) {
          await executionEngine.retryOrFail(lease, pe);
        }
        const steps = await executionEngine.listSteps(input.ctx.orgId, runRecord.id);
        return {
          runId: runRecord.id,
          status: 'failed',
          terminationReason: 'error',
          failureClass: pe.failureClass,
          nodeOutputs: scratch.nodeOutputs,
          trace: scratch.trace,
          notificationsLog: scratch.notificationsLog,
          steps,
          finalOutput: lastOutput,
          error: { code: pe.code, message: pe.message },
        };
      }
    },
  );
}
