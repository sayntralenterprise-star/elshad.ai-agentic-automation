import type {
  RunDto,
  RunStepDto,
  WorkflowDto,
  WorkflowGraphDto,
  WorkflowNodeDescriptorDto,
  WorkflowNodeDto,
} from '@elshad/sdk-ts';

export interface WorkflowTemplate {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  useCase: string;
  triggerType: 'webhook' | 'schedule' | 'manual';
  previewNodes: Array<{ label: string; category: string }>;
  buildGraph: () => WorkflowGraphDto;
}

export interface NodeExecutionOverlayEntry {
  status: 'succeeded' | 'failed' | 'waiting';
  durationMs: number;
  count: number;
  output?: unknown;
  error?: string;
}

export type NodeExecutionOverlay = Record<string, NodeExecutionOverlayEntry>;

export const CATEGORY_META: Record<
  string,
  { label: string; accent: string; tint: string }
> = {
  trigger: { label: 'Triggers', accent: '#3924D6', tint: '#EAE8F7' },
  ai: { label: 'AI & LLM', accent: '#7C3AED', tint: '#F3E8FF' },
  logic: { label: 'Conditions & Loops', accent: '#D97706', tint: '#FEF3C7' },
  data: { label: 'Data Transform', accent: '#0284C7', tint: '#E0F2FE' },
  integration: { label: 'HTTP, DB & Apps', accent: '#059669', tint: '#D1FAE5' },
  human: { label: 'Human & Notify', accent: '#DB2777', tint: '#FCE7F3' },
  control: { label: 'Control & Delays', accent: '#475467', tint: '#F2F4F7' },
};

export const EXTENDED_FALLBACK_NODES: WorkflowNodeDescriptorDto[] = [
  { type: 'trigger.webhook', category: 'trigger', label: 'Webhook Trigger', inputs: [], outputs: ['main'] },
  { type: 'trigger.schedule', category: 'trigger', label: 'Schedule Trigger', inputs: [], outputs: ['main'] },
  { type: 'trigger.manual', category: 'trigger', label: 'Manual Trigger', inputs: [], outputs: ['main'] },
  { type: 'ai.agent', category: 'ai', label: 'Agent Step', inputs: ['in'], outputs: ['main', 'escalated', 'error'] },
  { type: 'ai.llm', category: 'ai', label: 'LLM Prompt', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'logic.if', category: 'logic', label: 'IF Branch', inputs: ['in'], outputs: ['true', 'false', 'error'] },
  { type: 'logic.switch', category: 'logic', label: 'Switch Branch', inputs: ['in'], outputs: ['default', 'error'] },
  { type: 'logic.loop', category: 'logic', label: 'Loop Items', inputs: ['in'], outputs: ['loop', 'done', 'error'] },
  { type: 'logic.parallel', category: 'logic', label: 'Parallel Fan-out', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'logic.join', category: 'logic', label: 'Join Branches', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'logic.wait', category: 'logic', label: 'Wait / Delay', inputs: ['in'], outputs: ['main', 'timeout'] },
  { type: 'data.set', category: 'data', label: 'Set Fields', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'data.code', category: 'data', label: 'JSONata Transform', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'integration.http', category: 'integration', label: 'HTTP Request', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'integration.db', category: 'integration', label: 'Database Query', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'integration.crm', category: 'integration', label: 'CRM Sync', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'human.approval', category: 'human', label: 'Human Approval', inputs: ['in'], outputs: ['approved', 'rejected', 'error'] },
  { type: 'human.notify', category: 'human', label: 'Slack / Notify', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'control.subworkflow', category: 'control', label: 'Sub-workflow', inputs: ['in'], outputs: ['main', 'error'] },
  { type: 'control.stop', category: 'control', label: 'Stop Workflow', inputs: ['in'], outputs: [] },
];

export function buildSupportTriageGraph(): WorkflowGraphDto {
  return {
    schema_version: 1,
    settings: { max_concurrency: 5, queue: 'default', timeout_ms: 120_000 },
    nodes: [
      {
        id: 'n_webhook',
        type: 'trigger.webhook',
        name: 'Inbound Webhook',
        position: { x: 40, y: 120 },
        config: { path: 'inbox-triage', auth: { mode: 'none' } },
      },
      {
        id: 'n_agent',
        type: 'ai.agent',
        name: 'Agent Triage',
        position: { x: 280, y: 120 },
        config: { agent: 'ticket-triage', input: '={{ $json.message }}' },
      },
      {
        id: 'n_switch',
        type: 'logic.switch',
        name: 'Priority Switch',
        position: { x: 520, y: 120 },
        config: {
          cases: [{ id: 'high', expr: "$json.priority = 'high'" }],
          default: true,
        },
      },
      {
        id: 'n_slack',
        type: 'human.notify',
        name: 'Slack Notify',
        position: { x: 760, y: 120 },
        config: {
          channel: 'slack',
          template: 'Urgent triage alert: {{ $json.summary }}',
          recipients: ['#triage-alerts'],
        },
      },
    ],
    edges: [
      { id: 'e_1', from: { node: 'n_webhook', port: 'main' }, to: { node: 'n_agent', port: 'in' } },
      { id: 'e_2', from: { node: 'n_agent', port: 'main' }, to: { node: 'n_switch', port: 'in' } },
      { id: 'e_3', from: { node: 'n_switch', port: 'high' }, to: { node: 'n_slack', port: 'in' } },
      { id: 'e_4', from: { node: 'n_switch', port: 'default' }, to: { node: 'n_slack', port: 'in' } },
    ],
    pinned_data: {},
    notes: [],
  };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'tpl_support_triage',
    name: 'Support Ticket Triage',
    slug: 'support-ticket-triage',
    category: 'Customer Operations',
    description: 'Classifies inbound webhook tickets with an AI agent, branches on priority, and alerts Slack.',
    useCase: 'Route P0/P1 customer incidents in under 2 seconds with zero manual triage.',
    triggerType: 'webhook',
    previewNodes: [
      { label: 'Webhook', category: 'trigger' },
      { label: 'AI Triage', category: 'ai' },
      { label: 'Switch', category: 'logic' },
      { label: 'Slack Alert', category: 'human' },
    ],
    buildGraph: buildSupportTriageGraph,
  },
  {
    id: 'tpl_invoice_match',
    name: 'Invoice 3-Way Match',
    slug: 'invoice-3way-match',
    category: 'Finance Automation',
    description: 'Reconciles scheduled vendor invoices against ERP purchase orders with human approval for variances.',
    useCase: 'Automate AP exception resolution while gating variances above tolerance.',
    triggerType: 'schedule',
    previewNodes: [
      { label: 'Cron 15m', category: 'trigger' },
      { label: 'ERP Query', category: 'integration' },
      { label: 'AI Match', category: 'ai' },
      { label: 'Approval', category: 'human' },
    ],
    buildGraph: () => ({
      schema_version: 1,
      settings: { max_concurrency: 3, queue: 'finance', timeout_ms: 180_000 },
      nodes: [
        {
          id: 'n_cron',
          type: 'trigger.schedule',
          name: 'Every 15m Poll',
          position: { x: 40, y: 120 },
          config: { cron: '*/15 * * * *', misfire: 'skip' },
        },
        {
          id: 'n_db',
          type: 'integration.db',
          name: 'Fetch Open POs',
          position: { x: 280, y: 120 },
          config: { query: 'SELECT * FROM purchase_orders WHERE status = $1', source: 'erp_pg' },
        },
        {
          id: 'n_agent',
          type: 'ai.agent',
          name: 'Invoice Matcher',
          position: { x: 520, y: 120 },
          config: { prompt: '=trigger.body.message', tier: 'standard' },
          onError: { mode: 'retry', retry: { max: 3, backoff_ms: 500 } },
        },
        {
          id: 'n_approval',
          type: 'human.approval',
          name: 'Finance Approval',
          position: { x: 760, y: 120 },
          config: { approverRole: 'finance_reviewer', thresholdUsd: 500 },
        },
      ],
      edges: [
        { id: 'e_1', from: { node: 'n_cron', port: 'main' }, to: { node: 'n_db', port: 'main' } },
        { id: 'e_2', from: { node: 'n_db', port: 'main' }, to: { node: 'n_agent', port: 'main' } },
        { id: 'e_3', from: { node: 'n_agent', port: 'main' }, to: { node: 'n_approval', port: 'main' } },
      ],
      pinned_data: {},
      notes: [],
    }),
  },
  {
    id: 'tpl_lead_enrichment',
    name: 'Lead Enrichment & CRM Sync',
    slug: 'lead-enrichment-crm-sync',
    category: 'Revenue Operations',
    description: 'Enriches incoming signup webhooks via clearbit-style HTTP lookup, summarizes fit, and upserts CRM.',
    useCase: 'Score inbound B2B leads and sync tailored outbound context to Salesforce/HubSpot.',
    triggerType: 'webhook',
    previewNodes: [
      { label: 'Signup Hook', category: 'trigger' },
      { label: 'HTTP Lookup', category: 'integration' },
      { label: 'LLM Score', category: 'ai' },
      { label: 'CRM Upsert', category: 'integration' },
    ],
    buildGraph: () => ({
      schema_version: 1,
      settings: { max_concurrency: 10, queue: 'default', timeout_ms: 90_000 },
      nodes: [
        {
          id: 'n_hook',
          type: 'trigger.webhook',
          name: 'Lead Signup Webhook',
          position: { x: 40, y: 120 },
          config: { path: 'lead-capture', auth: 'hmac' },
        },
        {
          id: 'n_http',
          type: 'integration.http',
          name: 'Firmographic Lookup',
          position: { x: 280, y: 120 },
          config: { method: 'GET', url: 'https://enrich.internal/company' },
        },
        {
          id: 'n_llm',
          type: 'ai.llm',
          name: 'ICP Fit Scorer',
          position: { x: 520, y: 120 },
          config: { prompt: 'Score ICP fit: {{$prev.domain}}', tier: 'fast' },
        },
        {
          id: 'n_crm',
          type: 'integration.crm',
          name: 'Upsert CRM Lead',
          position: { x: 760, y: 120 },
          config: { object: 'Lead', operation: 'upsert' },
        },
      ],
      edges: [
        { id: 'e_1', from: { node: 'n_hook', port: 'main' }, to: { node: 'n_http', port: 'main' } },
        { id: 'e_2', from: { node: 'n_http', port: 'main' }, to: { node: 'n_llm', port: 'main' } },
        { id: 'e_3', from: { node: 'n_llm', port: 'main' }, to: { node: 'n_crm', port: 'main' } },
      ],
      pinned_data: {},
      notes: [],
    }),
  },
  {
    id: 'tpl_incident_escalation',
    name: 'Incident Escalation Pipeline',
    slug: 'incident-escalation-pipeline',
    category: 'Site Reliability',
    description: 'Triages PagerDuty alerts with AI runbook lookup, waits for acknowledgment, and escalates cleanly.',
    useCase: 'Correlate alerts with recent deployments and page secondary on-call if unacked.',
    triggerType: 'webhook',
    previewNodes: [
      { label: 'Alert Hook', category: 'trigger' },
      { label: 'Runbook AI', category: 'ai' },
      { label: 'Wait 5m', category: 'logic' },
      { label: 'Page On-Call', category: 'human' },
    ],
    buildGraph: () => ({
      schema_version: 1,
      settings: { max_concurrency: 5, queue: 'sre', timeout_ms: 300_000 },
      nodes: [
        {
          id: 'n_alert',
          type: 'trigger.webhook',
          name: 'Alertmanager Webhook',
          position: { x: 40, y: 120 },
          config: { path: 'sre-alerts', auth: 'bearer' },
        },
        {
          id: 'n_runbook',
          type: 'ai.agent',
          name: 'Runbook Investigator',
          position: { x: 280, y: 120 },
          config: { prompt: 'Investigate alert: {{trigger.body.message}}', tier: 'reasoning' },
        },
        {
          id: 'n_wait',
          type: 'logic.wait',
          name: 'Ack Window',
          position: { x: 520, y: 120 },
          config: { delay_ms: 5000 },
        },
        {
          id: 'n_page',
          type: 'human.notify',
          name: 'Escalate On-Call',
          position: { x: 760, y: 120 },
          config: { channel: '#sre-incidents', message: 'Escalated: {{$prev.summary}}' },
        },
      ],
      edges: [
        { id: 'e_1', from: { node: 'n_alert', port: 'main' }, to: { node: 'n_runbook', port: 'main' } },
        { id: 'e_2', from: { node: 'n_runbook', port: 'main' }, to: { node: 'n_wait', port: 'main' } },
        { id: 'e_3', from: { node: 'n_wait', port: 'main' }, to: { node: 'n_page', port: 'main' } },
      ],
      pinned_data: {},
      notes: [],
    }),
  },
];

export function getNodeCategory(nodeType: string): string {
  const prefix = nodeType.split('.')[0] ?? 'control';
  return prefix in CATEGORY_META ? prefix : 'control';
}

export function getNodeConfigPreview(node: WorkflowNodeDto): string {
  const cfg = node.config ?? {};
  if (typeof cfg.path === 'string') return `/${cfg.path}`;
  if (typeof cfg.cron === 'string') return `cron: ${cfg.cron}`;
  if (typeof cfg.channel === 'string') return `${cfg.channel}`;
  if (typeof cfg.url === 'string') return `${String(cfg.method ?? 'GET')} ${cfg.url}`;
  if (typeof cfg.tier === 'string') return `tier: ${cfg.tier}`;
  if (typeof cfg.expression === 'string') return `expr: ${cfg.expression}`;
  if (typeof cfg.condition === 'string') return cfg.condition;
  if (typeof cfg.query === 'string') return cfg.query.slice(0, 26);
  if (typeof cfg.approverRole === 'string') return `role: ${cfg.approverRole}`;
  if (typeof cfg.delay_ms === 'number') return `wait ${cfg.delay_ms}ms`;
  const firstKey = Object.keys(cfg).find((k) => !k.startsWith('_'));
  if (!firstKey) return 'ready';
  const raw = cfg[firstKey];
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return `${firstKey}: ${String(serialized ?? '').slice(0, 22)}`;
}

export function getWorkflowTriggerKind(wf: WorkflowDto): 'webhook' | 'schedule' | 'manual' {
  const graph = wf.draftVersion?.graph ?? wf.publishedVersion?.graph ?? wf.versions[0]?.graph;
  const trigger = graph?.nodes.find((n) => n.type.startsWith('trigger.'));
  if (trigger?.type === 'trigger.webhook') return 'webhook';
  if (trigger?.type === 'trigger.schedule') return 'schedule';
  return 'manual';
}

export function autoLayoutGraph(graph: WorkflowGraphDto): WorkflowGraphDto {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!inDegree.has(e.from.node) || !inDegree.has(e.to.node)) continue;
    inDegree.set(e.to.node, (inDegree.get(e.to.node) ?? 0) + 1);
    adj.get(e.from.node)!.push(e.to.node);
  }

  const layerByNode = new Map<string, number>();
  const queue: string[] = [];
  for (const n of graph.nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0 || n.type.startsWith('trigger.')) {
      if (!layerByNode.has(n.id)) {
        layerByNode.set(n.id, 0);
        queue.push(n.id);
      }
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layerByNode.get(cur) ?? 0;
    for (const nxt of adj.get(cur) ?? []) {
      const nextLayer = curLayer + 1;
      if ((layerByNode.get(nxt) ?? -1) < nextLayer && nextLayer <= graph.nodes.length) {
        layerByNode.set(nxt, nextLayer);
        queue.push(nxt);
      }
    }
  }

  const byLayer = new Map<number, WorkflowNodeDto[]>();
  for (const n of graph.nodes) {
    const layer = layerByNode.get(n.id) ?? 0;
    const arr = byLayer.get(layer) ?? [];
    arr.push(n);
    byLayer.set(layer, arr);
  }

  const posMap = new Map<string, { x: number; y: number }>();
  for (const [layer, nodesInLayer] of byLayer.entries()) {
    nodesInLayer.forEach((n, rowIdx) => {
      posMap.set(n.id, {
        x: 40 + layer * 252,
        y: 60 + rowIdx * 134,
      });
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: posMap.get(n.id) ?? n.position,
    })),
  };
}

function resolveDotPath(ctx: Record<string, unknown>, rawPath: string): unknown {
  const clean = rawPath.trim().replace(/^\$/, '$');
  const parts = clean.split('.').filter(Boolean);
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[part];
    } else if (Array.isArray(cur) && /^\d+$/.test(part)) {
      cur = cur[Number(part)];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function evaluateExpressionPreview(
  expr: string,
  sampleContext: Record<string, unknown>,
): { value: string; valid: boolean } {
  const trimmed = expr.trim();
  if (!trimmed) return { value: '(enter expression to preview)', valid: true };

  if (trimmed.startsWith('=')) {
    const resolved = resolveDotPath(sampleContext, trimmed.slice(1));
    if (resolved === undefined) {
      return { value: 'undefined (path not found in sample upstream context)', valid: true };
    }
    return {
      value: typeof resolved === 'string' ? resolved : JSON.stringify(resolved),
      valid: true,
    };
  }

  if (trimmed.includes('{{')) {
    const openCount = (trimmed.match(/\{\{/g) ?? []).length;
    const closeCount = (trimmed.match(/\}\}/g) ?? []).length;
    if (openCount !== closeCount) {
      return { value: 'Syntax error: unmatched {{ }} delimiter', valid: false };
    }
    const rendered = trimmed.replace(/\{\{([^}]+)\}\}/g, (_match, inner: string) => {
      const val = resolveDotPath(sampleContext, inner);
      if (val === undefined) return `<missing:${inner.trim()}>`;
      return typeof val === 'string' ? val : JSON.stringify(val);
    });
    return { value: rendered, valid: true };
  }

  return { value: trimmed, valid: true };
}

export function findWorkflowForRun(run: RunDto, workflows: WorkflowDto[]): WorkflowDto | null {
  const legacySubjectId = (run as unknown as { subjectId?: string }).subjectId;
  return (
    workflows.find(
      (wf) =>
        wf.id === run.subjectVersionId ||
        wf.id === legacySubjectId ||
        wf.currentVersionId === run.subjectVersionId ||
        wf.draftVersion?.id === run.subjectVersionId ||
        wf.publishedVersion?.id === run.subjectVersionId ||
        wf.versions.some((v) => v.id === run.subjectVersionId),
    ) ?? null
  );
}

export function buildExecutionOverlay(
  graph: WorkflowGraphDto,
  run: RunDto,
  steps: RunStepDto[],
): NodeExecutionOverlay {
  const overlay: NodeExecutionOverlay = {};
  const nodes = graph.nodes;
  if (nodes.length === 0) return overlay;

  // First try exact nodeId references inside step summary
  for (const step of steps) {
    const nodeId =
      typeof step.summary?.nodeId === 'string'
        ? step.summary.nodeId
        : typeof step.summary?.node_id === 'string'
          ? step.summary.node_id
          : null;
    if (nodeId && nodes.some((n) => n.id === nodeId)) {
      overlay[nodeId] = {
        status:
          step.status === 'failed'
            ? 'failed'
            : step.status === 'waiting' || step.status === 'running'
              ? 'waiting'
              : 'succeeded',
        durationMs: Math.max(1, step.latencyMs || 18),
        count: (overlay[nodeId]?.count ?? 0) + 1,
        output: step.summary,
      };
    }
  }

  if (Object.keys(overlay).length > 0) return overlay;

  // Deterministic topological overlay so every executed workflow run highlights nodes clearly
  const ordered = nodes;
  ordered.forEach((node, idx) => {
    const isLast = idx === ordered.length - 1;
    let status: 'succeeded' | 'failed' | 'waiting' = 'succeeded';
    if (run.status === 'failed' || run.status === 'timed_out') {
      status = isLast ? 'failed' : 'succeeded';
    } else if (
      run.status === 'waiting_approval' ||
      run.status === 'running' ||
      run.status === 'queued'
    ) {
      status = idx === ordered.length - 1 ? 'waiting' : 'succeeded';
    } else if (run.status === 'cancelled') {
      status = isLast ? 'waiting' : 'succeeded';
    }
    const matchingStep = steps[idx];
    overlay[node.id] = {
      status,
      durationMs: matchingStep?.latencyMs ?? 12 + idx * 19,
      count: 1,
      output: matchingStep?.summary ?? { node: node.name, status },
      error: status === 'failed' ? run.terminationReason ?? 'Execution error' : undefined,
    };
  });

  return overlay;
}
