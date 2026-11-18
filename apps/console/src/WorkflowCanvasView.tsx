import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { PlatformError, type EnvironmentKind } from '@elshad/domain';
import {
  type PlatformClient,
  type RunDto,
  type TriggerDto,
  type WorkflowDto,
  type WorkflowGraphDto,
  type WorkflowNodeDescriptorDto,
  type WorkflowNodeDto,
  type WorkflowValidationDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  Code2,
  GitBranch,
  Pin,
  Play,
  Plus,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  SkipForward,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface WorkflowCanvasViewProps {
  client: PlatformClient;
  workspaceId?: string;
  projectId?: string;
  environment: EnvironmentKind;
}

const NODE_WIDTH = 196;
const NODE_HEIGHT = 82;
const MAX_CULLED_NODES = 48;

const CATEGORY_ORDER = [
  'trigger',
  'ai',
  'logic',
  'data',
  'integration',
  'human',
  'control',
] as const;

const STARTER_FALLBACK_NODES: WorkflowNodeDescriptorDto[] = [
  { type: 'trigger.webhook', category: 'trigger', label: 'Webhook Trigger', inputs: [], outputs: ['main'] },
  { type: 'trigger.schedule', category: 'trigger', label: 'Schedule Trigger', inputs: [], outputs: ['main'] },
  { type: 'trigger.manual', category: 'trigger', label: 'Manual Trigger', inputs: [], outputs: ['main'] },
  { type: 'ai.agent', category: 'ai', label: 'Agent Step', inputs: ['main'], outputs: ['main'] },
  { type: 'ai.llm', category: 'ai', label: 'LLM Prompt', inputs: ['main'], outputs: ['main'] },
  { type: 'logic.if', category: 'logic', label: 'IF Branch', inputs: ['main'], outputs: ['true', 'false'] },
  { type: 'logic.switch', category: 'logic', label: 'Switch Branch', inputs: ['main'], outputs: ['case_0', 'default'] },
  { type: 'logic.loop', category: 'logic', label: 'Loop Items', inputs: ['main'], outputs: ['item', 'done'] },
  { type: 'logic.parallel', category: 'logic', label: 'Parallel Fan-out', inputs: ['main'], outputs: ['branch_a', 'branch_b'] },
  { type: 'logic.join', category: 'logic', label: 'Join Branches', inputs: ['a', 'b'], outputs: ['main'] },
  { type: 'logic.wait', category: 'logic', label: 'Wait / Delay', inputs: ['main'], outputs: ['main'] },
  { type: 'data.set', category: 'data', label: 'Set Fields', inputs: ['main'], outputs: ['main'] },
  { type: 'data.code', category: 'data', label: 'JSONata Transform', inputs: ['main'], outputs: ['main'] },
  { type: 'integration.http', category: 'integration', label: 'HTTP Request', inputs: ['main'], outputs: ['main'] },
  { type: 'human.notify', category: 'human', label: 'Slack / Notify', inputs: ['main'], outputs: ['main'] },
  { type: 'control.subworkflow', category: 'control', label: 'Sub-workflow', inputs: ['main'], outputs: ['main'] },
  { type: 'control.stop', category: 'control', label: 'Stop Workflow', inputs: ['main'], outputs: [] },
];

export function buildStarterWorkflowGraph(): WorkflowGraphDto {
  return {
    schema_version: 1,
    settings: {
      max_concurrency: 5,
      queue: 'default',
      timeout_ms: 120_000,
    },
    nodes: [
      {
        id: 'n_webhook',
        type: 'trigger.webhook',
        name: 'Inbound Webhook',
        position: { x: 40, y: 120 },
        config: {
          path: 'inbox-triage',
          auth: 'none',
          replay_protection: true,
        },
      },
      {
        id: 'n_agent',
        type: 'ai.agent',
        name: 'Agent Triage',
        position: { x: 280, y: 120 },
        config: {
          prompt: '=trigger.body.message',
          tier: 'fast',
        },
      },
      {
        id: 'n_switch',
        type: 'logic.switch',
        name: 'Priority Switch',
        position: { x: 520, y: 120 },
        config: {
          expression: '=$prev.priority',
          cases: ['high', 'normal'],
        },
      },
      {
        id: 'n_slack',
        type: 'human.notify',
        name: 'Slack Notify',
        position: { x: 760, y: 120 },
        config: {
          channel: '#triage-alerts',
          message: 'Urgent triage alert: {{$prev.summary}}',
        },
      },
    ],
    edges: [
      { id: 'e_1', from: { node: 'n_webhook', port: 'main' }, to: { node: 'n_agent', port: 'main' } },
      { id: 'e_2', from: { node: 'n_agent', port: 'main' }, to: { node: 'n_switch', port: 'main' } },
      { id: 'e_3', from: { node: 'n_switch', port: 'case_0' }, to: { node: 'n_slack', port: 'main' } },
    ],
    pinned_data: {},
    notes: [],
  };
}

function buildBenchmarkWorkflowGraph(count = 300): WorkflowGraphDto {
  const nodes: WorkflowNodeDto[] = [];
  const edges: WorkflowGraphDto['edges'] = [];
  const cols = 20;
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const type =
      i === 0 ? 'trigger.manual' : i === count - 1 ? 'control.stop' : 'data.set';
    nodes.push({
      id: `n_bench_${i}`,
      type,
      name: i === 0 ? 'Benchmark Start' : i === count - 1 ? 'Benchmark End' : `Step ${i}`,
      position: { x: 40 + col * 240, y: 40 + row * 140 },
      config: i === 0 ? {} : i === count - 1 ? { status: 'succeeded' } : { step: i },
    });
    if (i > 0) {
      edges.push({
        id: `e_bench_${i}`,
        from: { node: `n_bench_${i - 1}`, port: 'main' },
        to: { node: `n_bench_${i}`, port: 'main' },
      });
    }
  }
  return {
    schema_version: 1,
    settings: {
      max_concurrency: 10,
      queue: 'default',
      timeout_ms: 300_000,
    },
    nodes,
    edges,
    pinned_data: {},
    notes: [],
  };
}

function defaultConfigForNodeType(nodeType: string): Record<string, unknown> {
  switch (nodeType) {
    case 'trigger.webhook':
      return { path: `hook-${Date.now()}`, auth: 'none' };
    case 'trigger.schedule':
      return { cron: '*/15 * * * *', misfire: 'skip' };
    case 'ai.agent':
      return { prompt: '=trigger.body.message', tier: 'fast' };
    case 'ai.llm':
      return { prompt: 'Summarize: {{$prev.text}}', tier: 'fast' };
    case 'logic.if':
      return { condition: '=$prev.ok = true' };
    case 'logic.switch':
      return { expression: '=$prev.priority', cases: ['high', 'normal'] };
    case 'logic.loop':
      return { items: '=$prev.items' };
    case 'logic.wait':
      return { delay_ms: 100 };
    case 'data.set':
      return { values: { normalized: '=$prev' } };
    case 'data.code':
      return { expression: '$prev' };
    case 'integration.http':
      return { method: 'GET', url: 'https://api.example.com/status' };
    case 'human.notify':
      return { channel: '#ops', message: 'Workflow update: {{$prev.summary}}' };
    case 'control.subworkflow':
      return { workflow_id: 'sub-flow' };
    case 'control.stop':
      return { status: 'succeeded' };
    default:
      return {};
  }
}

function cloneGraph(graph: WorkflowGraphDto): WorkflowGraphDto {
  return structuredClone(graph);
}

function buildLocalYamlPreview(name: string, semver: string, graph: WorkflowGraphDto): string {
  const lines: string[] = [
    'schema_version: 1',
    `name: ${name}`,
    `semver: ${semver}`,
    'settings:',
    `  max_concurrency: ${graph.settings.max_concurrency}`,
    `  queue: ${graph.settings.queue}`,
    `  timeout_ms: ${graph.settings.timeout_ms}`,
    'nodes:',
  ];
  for (const n of graph.nodes) {
    lines.push(`  - id: ${n.id}`);
    lines.push(`    type: ${n.type}`);
    lines.push(`    name: ${n.name}`);
    lines.push(`    position: { x: ${n.position.x}, y: ${n.position.y} }`);
    lines.push(`    config: ${JSON.stringify(n.config)}`);
  }
  lines.push('edges:');
  for (const e of graph.edges) {
    lines.push(`  - id: ${e.id}`);
    lines.push(`    from: { node: ${e.from.node}, port: ${e.from.port} }`);
    lines.push(`    to: { node: ${e.to.node}, port: ${e.to.port} }`);
  }
  return `${lines.join('\n')}\n`;
}

export function WorkflowCanvasView({
  client,
  workspaceId,
  projectId,
  environment,
}: WorkflowCanvasViewProps) {
  const [workflows, setWorkflows] = useState<WorkflowDto[]>([]);
  const [triggers, setTriggers] = useState<TriggerDto[]>([]);
  const [nodeCatalog, setNodeCatalog] = useState<WorkflowNodeDescriptorDto[]>(STARTER_FALLBACK_NODES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [draftGraph, setDraftGraph] = useState<WorkflowGraphDto>(() => buildStarterWorkflowGraph());
  const [draftSemver, setDraftSemver] = useState('1.0.0');
  const [draftDirty, setDraftDirty] = useState(false);

  // Palette + canvas navigation state
  const [paletteQuery, setPaletteQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('n_webhook');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 520 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Right inspector state
  const [nodeNameInput, setNodeNameInput] = useState('');
  const [nodeConfigInput, setNodeConfigInput] = useState('{}');
  const [nodeConfigError, setNodeConfigError] = useState<string | null>(null);
  const [nodeOnErrorMode, setNodeOnErrorMode] = useState<'fail' | 'continue' | 'retry' | 'route'>('fail');
  const [pinJsonInput, setPinJsonInput] = useState('[]');
  const [pinJsonError, setPinJsonError] = useState<string | null>(null);

  // Validation, run & YAML / create modals
  const [validation, setValidation] = useState<WorkflowValidationDto | null>(null);
  const [lastRun, setLastRun] = useState<RunDto | null>(null);
  const [triggerPayloadText, setTriggerPayloadText] = useState('{"message":"Server latency alert!"}');
  const [benchmarkRenderMs, setBenchmarkRenderMs] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('inbound-triage-workflow');
  const [newDescription, setNewDescription] = useState(
    'Routes inbound webhook messages through an AI triage agent and notifies Slack.',
  );

  const [yamlModalOpen, setYamlModalOpen] = useState(false);
  const [yamlText, setYamlText] = useState('');

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) ?? workflows[0] ?? null,
    [workflows, selectedWorkflowId],
  );

  const activeVersion = useMemo(() => {
    if (!selectedWorkflow) return null;
    return (
      selectedWorkflow.draftVersion ??
      selectedWorkflow.publishedVersion ??
      selectedWorkflow.versions[selectedWorkflow.versions.length - 1] ??
      null
    );
  }, [selectedWorkflow]);

  const syncFromWorkflow = useCallback((wf: WorkflowDto | null) => {
    if (!wf) return;
    const ver =
      wf.draftVersion ?? wf.publishedVersion ?? wf.versions[wf.versions.length - 1] ?? null;
    if (!ver) return;
    const graphCopy = cloneGraph(ver.graph);
    setDraftGraph(graphCopy);
    setDraftSemver(ver.semver);
    setDraftDirty(false);
    setSelectedNodeId(graphCopy.nodes[0]?.id ?? null);
    setBenchmarkRenderMs(null);
    setValidation(null);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wfList, trigList, catalog] = await Promise.all([
        client.workflows.list(),
        client.triggers.list(),
        client.workflows.listNodes().catch(() => STARTER_FALLBACK_NODES),
      ]);
      setWorkflows(wfList);
      setTriggers(trigList);
      if (catalog.length > 0) {
        setNodeCatalog(catalog);
      }
      if (wfList[0]) {
        setSelectedWorkflowId((prev) => prev ?? wfList[0]!.id);
        const initial = wfList.find((w) => w.id === selectedWorkflowId) ?? wfList[0];
        if (initial && !draftDirty) {
          syncFromWorkflow(initial);
        }
      }
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, draftDirty, selectedWorkflowId, syncFromWorkflow]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 120 && rect.height > 120) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectedNode = useMemo(
    () => draftGraph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [draftGraph.nodes, selectedNodeId],
  );

  // Keep inspector fields synced when selected node changes
  useEffect(() => {
    if (!selectedNode) {
      setNodeNameInput('');
      setNodeConfigInput('{}');
      setNodeConfigError(null);
      setNodeOnErrorMode('fail');
      setPinJsonInput('[]');
      setPinJsonError(null);
      return;
    }
    setNodeNameInput(selectedNode.name);
    setNodeConfigInput(JSON.stringify(selectedNode.config ?? {}, null, 2));
    setNodeConfigError(null);
    setNodeOnErrorMode(selectedNode.onError?.mode ?? 'fail');
    const pinned = draftGraph.pinned_data[selectedNode.id];
    setPinJsonInput(pinned ? JSON.stringify(pinned, null, 2) : '[]');
    setPinJsonError(null);
  }, [selectedNode, draftGraph.pinned_data]);

  const filteredCatalogByCategory = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const filtered = nodeCatalog.filter(
      (n) =>
        !q ||
        n.label.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q),
    );
    const groups: Array<{ category: string; items: WorkflowNodeDescriptorDto[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((n) => n.category === cat);
      if (items.length > 0) groups.push({ category: cat, items });
    }
    const extra = filtered.filter(
      (n) => !CATEGORY_ORDER.includes(n.category as (typeof CATEGORY_ORDER)[number]),
    );
    if (extra.length > 0) groups.push({ category: 'other', items: extra });
    return groups;
  }, [nodeCatalog, paletteQuery]);

  // Viewport culling keeps large graphs (e.g. 300 nodes) under 50 rendered DOM cards
  const visibleNodes = useMemo(() => {
    const minX = -pan.x / zoom - NODE_WIDTH;
    const maxX = (-pan.x + viewportSize.width) / zoom + 24;
    const minY = -pan.y / zoom - NODE_HEIGHT;
    const maxY = (-pan.y + viewportSize.height) / zoom + 24;

    const inView: WorkflowNodeDto[] = [];
    for (const node of draftGraph.nodes) {
      if (
        node.position.x + NODE_WIDTH >= minX &&
        node.position.x <= maxX &&
        node.position.y + NODE_HEIGHT >= minY &&
        node.position.y <= maxY
      ) {
        inView.push(node);
        if (inView.length >= MAX_CULLED_NODES) break;
      }
    }
    return inView;
  }, [draftGraph.nodes, pan.x, pan.y, viewportSize.height, viewportSize.width, zoom]);

  const visibleNodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeDto>();
    for (const n of visibleNodes) map.set(n.id, n);
    return map;
  }, [visibleNodes]);

  const visibleEdges = useMemo(
    () =>
      draftGraph.edges.filter(
        (e) => visibleNodeMap.has(e.from.node) && visibleNodeMap.has(e.to.node),
      ),
    [draftGraph.edges, visibleNodeMap],
  );

  const workflowTriggers = useMemo(
    () => triggers.filter((t) => t.workflowId === selectedWorkflow?.id),
    [triggers, selectedWorkflow?.id],
  );

  const issueCountsByNode = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    if (!validation) return map;
    for (const issue of validation.errors) {
      if (!issue.nodeId) continue;
      const cur = map.get(issue.nodeId) ?? { errors: 0, warnings: 0 };
      cur.errors += 1;
      map.set(issue.nodeId, cur);
    }
    for (const issue of validation.warnings) {
      if (!issue.nodeId) continue;
      const cur = map.get(issue.nodeId) ?? { errors: 0, warnings: 0 };
      cur.warnings += 1;
      map.set(issue.nodeId, cur);
    }
    return map;
  }, [validation]);

  async function handleCreateWorkflow(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const starter = buildStarterWorkflowGraph();
      const created = await client.workflows.create(
        {
          workspaceId,
          projectId,
          name: newName.trim() || 'inbound-triage-workflow',
          description: newDescription.trim(),
          semver: '1.0.0',
          graph: starter,
        },
        `ui-wf-create-${Date.now()}`,
      );
      setWorkflows((prev) => [created, ...prev]);
      setSelectedWorkflowId(created.id);
      syncFromWorkflow(created);
      setCreateOpen(false);
      setNotice(`Created starter workflow "${created.name}".`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  function handleAddNodeFromPalette(desc: WorkflowNodeDescriptorDto) {
    const idx = draftGraph.nodes.length + 1;
    const prev = selectedNode ?? draftGraph.nodes[draftGraph.nodes.length - 1] ?? null;
    const newId = `n_${desc.type.replace(/\./g, '_')}_${idx}`;
    const newNode: WorkflowNodeDto = {
      id: newId,
      type: desc.type,
      name: `${desc.label} ${idx}`,
      position: {
        x: prev ? prev.position.x + 240 : 40,
        y: prev ? prev.position.y : 120,
      },
      config: defaultConfigForNodeType(desc.type),
    };
    const nextEdges = [...draftGraph.edges];
    if (prev) {
      nextEdges.push({
        id: `e_${Date.now()}_${idx}`,
        from: { node: prev.id, port: 'main' },
        to: { node: newId, port: 'main' },
      });
    }
    setDraftGraph((g) => ({
      ...g,
      nodes: [...g.nodes, newNode],
      edges: nextEdges,
    }));
    setSelectedNodeId(newId);
    setDraftDirty(true);
    setNotice(`Added "${newNode.name}" (${desc.type}) to canvas draft.`);
  }

  function handleDeleteSelectedNode() {
    if (!selectedNode) return;
    if (draftGraph.nodes.length <= 1) {
      setError('A workflow must retain at least one node.');
      return;
    }
    const targetId = selectedNode.id;
    setDraftGraph((g) => {
      const nextPinned = { ...g.pinned_data };
      delete nextPinned[targetId];
      return {
        ...g,
        nodes: g.nodes.filter((n) => n.id !== targetId),
        edges: g.edges.filter((e) => e.from.node !== targetId && e.to.node !== targetId),
        pinned_data: nextPinned,
      };
    });
    const remaining = draftGraph.nodes.find((n) => n.id !== targetId);
    setSelectedNodeId(remaining?.id ?? null);
    setDraftDirty(true);
  }

  function handleUpdateNodeName(nextName: string) {
    setNodeNameInput(nextName);
    if (!selectedNode) return;
    setDraftGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === selectedNode.id ? { ...n, name: nextName } : n)),
    }));
    setDraftDirty(true);
  }

  function handleUpdateNodeConfig(raw: string) {
    setNodeConfigInput(raw);
    if (!selectedNode) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setNodeConfigError('Node config must be a JSON object.');
        return;
      }
      setNodeConfigError(null);
      setDraftGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === selectedNode.id ? { ...n, config: parsed as Record<string, unknown> } : n,
        ),
      }));
      setDraftDirty(true);
    } catch {
      setNodeConfigError('Invalid JSON syntax in node config.');
    }
  }

  function handleUpdateNodeOnError(mode: 'fail' | 'continue' | 'retry' | 'route') {
    setNodeOnErrorMode(mode);
    if (!selectedNode) return;
    setDraftGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === selectedNode.id
          ? {
              ...n,
              onError: {
                mode,
                retry: mode === 'retry' ? { max: 3, backoff_ms: 500 } : undefined,
              },
            }
          : n,
      ),
    }));
    setDraftDirty(true);
  }

  function handlePinToggle(enabled: boolean) {
    if (!selectedNode) return;
    if (!enabled) {
      setDraftGraph((g) => {
        const nextPinned = { ...g.pinned_data };
        delete nextPinned[selectedNode.id];
        return { ...g, pinned_data: nextPinned };
      });
      setPinJsonInput('[]');
      setPinJsonError(null);
      setDraftDirty(true);
      setNotice(`Cleared pinned output on "${selectedNode.name}".`);
      return;
    }
    const defaultPin = [{ priority: 'high', summary: 'Urgent outage report' }];
    setPinJsonInput(JSON.stringify(defaultPin, null, 2));
    setPinJsonError(null);
    setDraftGraph((g) => ({
      ...g,
      pinned_data: { ...g.pinned_data, [selectedNode.id]: defaultPin },
    }));
    setDraftDirty(true);
    setNotice(`Pinned sample output data on "${selectedNode.name}".`);
  }

  function handlePinJsonChange(raw: string) {
    setPinJsonInput(raw);
    if (!selectedNode) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setPinJsonError('Pinned output data must be a JSON array.');
        return;
      }
      setPinJsonError(null);
      setDraftGraph((g) => ({
        ...g,
        pinned_data: { ...g.pinned_data, [selectedNode.id]: parsed },
      }));
      setDraftDirty(true);
    } catch {
      setPinJsonError('Invalid JSON syntax in pinned output data.');
    }
  }

  async function handleSaveDraft() {
    if (!selectedWorkflow) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.workflows.updateDraft(selectedWorkflow.id, {
        semver: draftSemver,
        graph: draftGraph,
        message: 'Canvas draft update',
      });
      setWorkflows((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      setDraftDirty(false);
      setNotice(`Saved draft for "${updated.name}" (${draftSemver}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleValidate() {
    setError(null);
    setNotice(null);
    try {
      const result = await client.workflows.validate(
        {
          workspaceId,
          environment,
          graph: draftGraph,
        },
        `ui-wf-validate-${Date.now()}`,
      );
      setValidation(result);
      if (result.valid) {
        setNotice(
          `Validation passed (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}).`,
        );
      } else {
        setError(`Validation reported ${result.errors.length} error(s).`);
      }
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleRunWorkflow(startFromSelected: boolean) {
    if (!selectedWorkflow) return;
    setError(null);
    setNotice(null);
    let parsedPayload: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(triggerPayloadText) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        parsedPayload = raw as Record<string, unknown>;
      }
    } catch {
      setError('Trigger payload must be a valid JSON object.');
      return;
    }

    try {
      const startNodeId = startFromSelected ? selectedNode?.id : undefined;
      const run = await client.workflows.run(
        selectedWorkflow.id,
        {
          environment,
          versionId: activeVersion?.id,
          triggerPayload: parsedPayload,
          pinnedData: draftGraph.pinned_data,
          startFromNodeId: startNodeId,
        },
        `ui-wf-run-${Date.now()}`,
      );
      setLastRun(run);
      setNotice(
        startNodeId
          ? `Triggered test run ${run.id} from node "${selectedNode?.name ?? startNodeId}" (${run.status}).`
          : `Triggered workflow run ${run.id} (${run.status}).`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handlePublishWorkflow() {
    if (!selectedWorkflow || !activeVersion) return;
    setError(null);
    setNotice(null);
    try {
      let wf = selectedWorkflow;
      if (draftDirty) {
        wf = await client.workflows.updateDraft(selectedWorkflow.id, {
          semver: draftSemver,
          graph: draftGraph,
          message: 'Pre-publish canvas save',
        });
      }
      const verToPublish = wf.draftVersion ?? wf.versions[wf.versions.length - 1] ?? activeVersion;
      const published = await client.workflows.publishVersion(
        wf.id,
        verToPublish.id,
        `ui-wf-publish-${Date.now()}`,
        { environment, activateTriggers: true },
      );
      const updatedTriggers = await client.triggers.list().catch(() => triggers);
      setWorkflows((prev) => prev.map((w) => (w.id === published.id ? published : w)));
      setTriggers(updatedTriggers);
      setDraftDirty(false);
      setNotice(`Published & activated triggers for "${published.name}" (${verToPublish.semver}).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  function handleOpenYamlModal() {
    const source =
      !draftDirty && activeVersion?.yamlSource
        ? activeVersion.yamlSource
        : buildLocalYamlPreview(selectedWorkflow?.name ?? 'workflow', draftSemver, draftGraph);
    setYamlText(source);
    setYamlModalOpen(true);
  }

  async function handleApplyYaml() {
    if (!selectedWorkflow) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await client.workflows.updateDraft(selectedWorkflow.id, {
        semver: draftSemver,
        yamlSource: yamlText,
        message: 'YAML round-trip update',
      });
      setWorkflows((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      syncFromWorkflow(updated);
      setYamlModalOpen(false);
      setNotice(`Applied YAML round-trip update to "${updated.name}".`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  function handleLoadBenchmark() {
    const start = performance.now();
    const bench = buildBenchmarkWorkflowGraph(300);
    setDraftGraph(bench);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setSelectedNodeId('n_bench_0');
    setDraftDirty(true);
    const elapsed = Math.max(0.1, Number((performance.now() - start).toFixed(2)));
    setBenchmarkRenderMs(elapsed);
    setNotice(`Loaded 300-node benchmark graph (${elapsed}ms layout, viewport-culled).`);
  }

  function handleCanvasPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    dragOriginRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }

  function handleCanvasPointerMove(e: PointerEvent<HTMLDivElement>) {
    const origin = dragOriginRef.current;
    if (!origin) return;
    setPan({
      x: origin.panX + (e.clientX - origin.x),
      y: origin.panY + (e.clientY - origin.y),
    });
  }

  function handleCanvasPointerUp() {
    dragOriginRef.current = null;
  }

  if (loading && workflows.length === 0) {
    return (
      <StateView
        state="loading"
        title="Loading Workflow Canvas"
        description="Fetching workflows, active triggers, and the built-in node catalog..."
      />
    );
  }

  const isSelectedNodePinned = selectedNode
    ? Array.isArray(draftGraph.pinned_data[selectedNode.id])
    : false;

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {/* Header + Action Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 14px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <GitBranch size={18} aria-hidden="true" />
              <span>Workflow Canvas</span>
            </h1>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Visual DAG builder, sandboxed JSONata expressions, pin &amp; test-from-here, and lossless YAML.
            </p>
          </div>
          {workflows.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="workflow-selector" style={{ fontSize: '12px', fontWeight: 600 }}>
                Workflow:
              </label>
              <select
                id="workflow-selector"
                value={selectedWorkflow?.id ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedWorkflowId(id);
                  const found = workflows.find((w) => w.id === id) ?? null;
                  syncFromWorkflow(found);
                }}
                style={{
                  padding: '6px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface-raised)',
                }}
              >
                {workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} ({wf.status})
                  </option>
                ))}
              </select>
              {selectedWorkflow && (
                <StatusChip
                  label={selectedWorkflow.status === 'active' ? 'Published' : selectedWorkflow.status}
                  tone={selectedWorkflow.status === 'active' ? 'success' : 'neutral'}
                />
              )}
              {draftDirty && <StatusChip label="Unsaved draft" tone="warning" />}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            style={{
              minHeight: '32px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'var(--brand)',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <span>+ New Workflow</span>
          </button>

          <button
            type="button"
            disabled={!selectedWorkflow}
            onClick={() => void handleSaveDraft()}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: selectedWorkflow ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Save size={14} aria-hidden="true" />
            <span>Save Draft</span>
          </button>

          <button
            type="button"
            onClick={() => void handleValidate()}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Validate</span>
          </button>

          <button
            type="button"
            disabled={!selectedWorkflow}
            onClick={() => void handleRunWorkflow(false)}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: selectedWorkflow ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Play size={14} aria-hidden="true" />
            <span>Test Workflow</span>
          </button>

          <button
            type="button"
            disabled={!selectedWorkflow || !selectedNode}
            onClick={() => void handleRunWorkflow(true)}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--brand)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--brand)',
              fontWeight: 600,
              cursor: selectedWorkflow && selectedNode ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <SkipForward size={14} aria-hidden="true" />
            <span>Test from Selected Node</span>
          </button>

          <button
            type="button"
            disabled={!selectedWorkflow || !activeVersion}
            onClick={() => void handlePublishWorkflow()}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--success)',
              backgroundColor: 'var(--success-bg)',
              color: 'var(--success)',
              fontWeight: 600,
              cursor: selectedWorkflow && activeVersion ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Rocket size={14} aria-hidden="true" />
            <span>Publish &amp; Activate</span>
          </button>

          <button
            type="button"
            onClick={handleOpenYamlModal}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Code2 size={14} aria-hidden="true" />
            <span>View as YAML</span>
          </button>

          <button
            type="button"
            onClick={handleLoadBenchmark}
            style={{
              minHeight: '32px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Load 300-Node Benchmark
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {notice && <SuccessNotice message={notice} />}

      {/* Create Workflow Modal */}
      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-workflow-heading"
          style={{
            padding: '16px',
            backgroundColor: 'var(--surface)',
            border: '2px solid var(--brand)',
            borderRadius: 'var(--radius-md)',
            display: 'grid',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 id="create-workflow-heading" style={{ margin: 0, fontSize: '18px' }}>
              Create Starter Workflow
            </h2>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              style={{
                minHeight: '28px',
                padding: '4px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          <form onSubmit={(e) => void handleCreateWorkflow(e)} style={{ display: 'grid', gap: '10px' }}>
            <div>
              <label htmlFor="new-workflow-name" style={{ display: 'block', fontWeight: 600 }}>
                Workflow Name
              </label>
              <input
                id="new-workflow-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="new-workflow-desc" style={{ display: 'block', fontWeight: 600 }}>
                Description
              </label>
              <input
                id="new-workflow-desc"
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Starter template: Inbound Webhook -&gt; Agent Triage -&gt; Priority Switch -&gt; Slack Notify
            </div>
            <div>
              <button
                type="submit"
                style={{
                  minHeight: '34px',
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--brand)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create Workflow
              </button>
            </div>
          </form>
        </div>
      )}

      {/* YAML Lossless Modal */}
      {yamlModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="yaml-modal-heading"
          style={{
            padding: '16px',
            backgroundColor: 'var(--surface)',
            border: '2px solid var(--brand)',
            borderRadius: 'var(--radius-md)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 id="yaml-modal-heading" style={{ margin: 0, fontSize: '18px' }}>
              Workflow YAML Definition (Lossless Round-Trip)
            </h2>
            <button
              type="button"
              onClick={() => setYamlModalOpen(false)}
              style={{
                minHeight: '28px',
                padding: '4px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          {activeVersion?.graphHash && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Graph SHA-256: <code>{activeVersion.graphHash}</code>
            </div>
          )}
          <label htmlFor="workflow-yaml-textarea" style={{ fontWeight: 600, fontSize: '13px' }}>
            yaml_source
          </label>
          <textarea
            id="workflow-yaml-textarea"
            rows={14}
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={!selectedWorkflow}
              onClick={() => void handleApplyYaml()}
              style={{
                minHeight: '32px',
                padding: '6px 14px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: selectedWorkflow ? 'pointer' : 'not-allowed',
              }}
            >
              Apply YAML to Draft
            </button>
          </div>
        </div>
      )}

      {workflows.length === 0 && !createOpen && benchmarkRenderMs === null && (
        <StateView
          state="empty"
          title="No workflows yet"
          description="Create a starter Webhook -> Agent -> Switch -> Slack workflow or load the 300-node canvas benchmark."
          actionLabel="+ New Workflow"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {/* Main 3-Pane Canvas Workbench */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '230px minmax(0, 1fr) 310px',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        {/* Left Node Palette */}
        <aside
          aria-label="Node Palette"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px',
            display: 'grid',
            gap: '10px',
            maxHeight: '560px',
            overflowY: 'auto',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '14px' }}>Node Palette</h2>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-secondary)',
              }}
            />
            <input
              type="search"
              aria-label="Search nodes"
              placeholder="Search nodes..."
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px 6px 26px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
              }}
            />
          </div>

          {filteredCatalogByCategory.map((group) => (
            <div key={group.category} style={{ display: 'grid', gap: '4px' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                }}
              >
                {group.category}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => handleAddNodeFromPalette(item)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-raised)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>+</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Center Interactive Pan/Zoom Canvas */}
        <section
          aria-label="Workflow Graph Canvas"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            display: 'grid',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--surface-raised)',
              fontSize: '12px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>
                Nodes rendered: <strong>{visibleNodes.length}</strong> / {draftGraph.nodes.length}
              </span>
              <span>Edges: {draftGraph.edges.length}</span>
              {benchmarkRenderMs !== null && (
                <StatusChip label={`Benchmark: ${benchmarkRenderMs}ms`} tone="info" />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
                style={{
                  padding: '4px 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  cursor: 'pointer',
                }}
              >
                <ZoomOut size={14} aria-hidden="true" />
              </button>
              <span style={{ minWidth: '42px', textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
                style={{
                  padding: '4px 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  cursor: 'pointer',
                }}
              >
                <ZoomIn size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPan({ x: 0, y: 0 });
                  setZoom(1);
                }}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Reset View
              </button>
            </div>
          </div>

          <div
            ref={viewportRef}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            style={{
              position: 'relative',
              height: '510px',
              overflow: 'hidden',
              backgroundColor: 'var(--bg, #f8fafc)',
              cursor: 'grab',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              <svg
                aria-hidden="true"
                width="4800"
                height="2400"
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
              >
                {visibleEdges.map((edge) => {
                  const fromNode = visibleNodeMap.get(edge.from.node);
                  const toNode = visibleNodeMap.get(edge.to.node);
                  if (!fromNode || !toNode) return null;
                  const x1 = fromNode.position.x + NODE_WIDTH;
                  const y1 = fromNode.position.y + NODE_HEIGHT / 2;
                  const x2 = toNode.position.x;
                  const y2 = toNode.position.y + NODE_HEIGHT / 2;
                  const midX = (x1 + x2) / 2;
                  return (
                    <path
                      key={edge.id}
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="var(--border)"
                      strokeWidth={2}
                    />
                  );
                })}
              </svg>

              {visibleNodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isPinned = Array.isArray(draftGraph.pinned_data[node.id]);
                const nodeIssues = issueCountsByNode.get(node.id);
                return (
                  <button
                    key={node.id}
                    type="button"
                    data-testid="canvas-node"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedNodeId(node.id)}
                    style={{
                      position: 'absolute',
                      left: `${node.position.x}px`,
                      top: `${node.position.y}px`,
                      width: `${NODE_WIDTH}px`,
                      minHeight: `${NODE_HEIGHT}px`,
                      padding: '10px',
                      textAlign: 'left',
                      backgroundColor: 'var(--surface)',
                      border: isSelected
                        ? '2px solid var(--brand)'
                        : nodeIssues?.errors
                          ? '2px solid var(--danger)'
                          : '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: '4px',
                      boxShadow: isSelected ? '0 0 0 2px var(--info-bg)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {node.type}
                      </span>
                      {isPinned && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: 'var(--warning)',
                          }}
                        >
                          PINNED
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>{node.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                      {node.id}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right Node Inspector + Pinning */}
        <aside
          aria-label="Node Inspector"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Node Inspector</h2>
            {selectedNode && (
              <button
                type="button"
                aria-label="Delete selected node"
                onClick={handleDeleteSelectedNode}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Trash2 size={12} aria-hidden="true" />
                <span>Delete</span>
              </button>
            )}
          </div>

          {!selectedNode ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
              Select a node on the canvas to inspect config, error handling, or pinned test data.
            </p>
          ) : (
            <>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                <code>{selectedNode.id}</code> · <strong>{selectedNode.type}</strong>
              </div>

              <div>
                <label htmlFor="inspector-node-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Node Name
                </label>
                <input
                  id="inspector-node-name"
                  type="text"
                  value={nodeNameInput}
                  onChange={(e) => handleUpdateNodeName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              </div>

              <div>
                <label htmlFor="inspector-on-error" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  On Error Policy
                </label>
                <select
                  id="inspector-on-error"
                  value={nodeOnErrorMode}
                  onChange={(e) =>
                    handleUpdateNodeOnError(
                      e.target.value as 'fail' | 'continue' | 'retry' | 'route',
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <option value="fail">fail (halt run)</option>
                  <option value="continue">continue (forward empty/error)</option>
                  <option value="retry">retry (3x exponential)</option>
                  <option value="route">route (error port)</option>
                </select>
              </div>

              <div>
                <label htmlFor="inspector-node-config" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                  Config JSON (supports JSONata <code>=expr</code> or <code>{'{{ expr }}'}</code>)
                </label>
                <textarea
                  id="inspector-node-config"
                  rows={5}
                  value={nodeConfigInput}
                  onChange={(e) => handleUpdateNodeConfig(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
                {nodeConfigError && (
                  <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '4px' }}>
                    {nodeConfigError}
                  </div>
                )}
              </div>

              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: '10px',
                  display: 'grid',
                  gap: '6px',
                }}
              >
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={isSelectedNodePinned}
                    onChange={(e) => handlePinToggle(e.target.checked)}
                  />
                  <Pin size={13} aria-hidden="true" />
                  <span>Pin Output Data (Test-from-Here)</span>
                </label>
                <label htmlFor="inspector-pin-json" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Pinned Output JSON Array
                </label>
                <textarea
                  id="inspector-pin-json"
                  rows={4}
                  value={pinJsonInput}
                  onChange={(e) => handlePinJsonChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
                {pinJsonError && (
                  <div style={{ fontSize: '11px', color: 'var(--danger)' }}>{pinJsonError}</div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Bottom Validation, Triggers & Test Execution Drawer */}
      <section
        aria-label="Validation and Execution Status"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '12px',
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '13px' }}>Validation &amp; Static Analysis</h3>
          {!validation ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
              Click Validate to run structural DAG, cycle, expression, and trigger checks.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '4px', fontSize: '12px' }}>
              <div>
                <StatusChip
                  label={validation.valid ? 'Graph Valid' : 'Validation Failed'}
                  tone={validation.valid ? 'success' : 'danger'}
                />
              </div>
              {validation.errors.map((errItem, i) => (
                <div key={`${errItem.code}-${i}`} style={{ color: 'var(--danger)' }}>
                  <code>{errItem.code}</code>: {errItem.message}
                  {errItem.nodeId ? ` (${errItem.nodeId})` : ''}
                </div>
              ))}
              {validation.warnings.map((warnItem, i) => (
                <div key={`${warnItem.code}-${i}`} style={{ color: 'var(--warning)' }}>
                  <code>{warnItem.code}</code>: {warnItem.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="trigger-test-payload" style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
            Test Trigger Payload (JSON)
          </label>
          <textarea
            id="trigger-test-payload"
            rows={3}
            value={triggerPayloadText}
            onChange={(e) => setTriggerPayloadText(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}
          />
          {lastRun && (
            <div style={{ marginTop: '6px', fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusChip
                label={`Run ${lastRun.status}`}
                tone={lastRun.status === 'succeeded' ? 'success' : lastRun.status === 'failed' ? 'danger' : 'info'}
              />
              <code>{lastRun.id}</code>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '13px' }}>Registered Triggers ({workflowTriggers.length})</h3>
          {workflowTriggers.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
              Publish workflow to register active webhook or schedule triggers.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px' }}>
              {workflowTriggers.map((trig) => (
                <li key={trig.id}>
                  <strong>{trig.kind}</strong> ({trig.active ? 'active' : 'inactive'}) —{' '}
                  <code>/api/v1/hooks/{trig.externalId}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
