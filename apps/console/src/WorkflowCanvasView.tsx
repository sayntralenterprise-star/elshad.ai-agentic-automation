import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from 'react';
import { PlatformError, type EnvironmentKind } from '@elshad/domain';
import {
  type PlatformClient,
  type RunDto,
  type RunStepDto,
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
  History,
  LayoutGrid,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Rocket,
  Save,
  Search,
  Share2,
  ShieldCheck,
  SkipForward,
  StickyNote,
  Undo2,
  ZoomIn,
  ZoomOut,
  Play,
} from 'lucide-react';
import { WorkflowExecutionsView } from './workflows/WorkflowExecutionsView.js';
import { WorkflowInspectorPanel } from './workflows/WorkflowInspectorPanel.js';
import { WorkflowsRegistryView } from './workflows/WorkflowsRegistryView.js';
import {
  CATEGORY_META,
  EXTENDED_FALLBACK_NODES,
  autoLayoutGraph,
  buildSupportTriageGraph,
  buildExecutionOverlay,
  getNodeCategory,
  getNodeConfigPreview,
  type NodeExecutionOverlay,
  type WorkflowTemplate,
} from './workflows/workflowTemplates.js';

export interface WorkflowCanvasViewProps {
  client: PlatformClient;
  workspaceId?: string;
  projectId?: string;
  environment: EnvironmentKind;
  ownerName?: string;
}

type WorkflowSubView = 'builder' | 'registry' | 'executions';

const NODE_WIDTH = 204;
const NODE_HEIGHT = 90;
const MAX_CULLED_NODES = 48;
const MAX_HISTORY_DEPTH = 30;

const CATEGORY_ORDER = [
  'trigger',
  'ai',
  'logic',
  'data',
  'integration',
  'human',
  'control',
] as const;

export function buildStarterWorkflowGraph(): WorkflowGraphDto {
  return buildSupportTriageGraph();
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
        to: { node: `n_bench_${i}`, port: 'in' },
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
      return { path: `hook-${Date.now()}`, methods: ['POST'], auth: { mode: 'none' } };
    case 'trigger.schedule':
      return { cron: '*/15 * * * *', timezone: 'UTC', misfire_policy: 'skip' };
    case 'trigger.manual':
      return {};
    case 'ai.agent':
      return { agent: 'triage-agent', version: 'channel:stable', input: '=trigger.body.message', dry_run: false };
    case 'ai.llm':
      return { tier: 'fast', prompt: 'Summarize: {{$prev.text}}' };
    case 'logic.if':
      return { condition: '=$prev.ok = true' };
    case 'logic.switch':
      return { cases: [{ id: 'high', expr: "$json.priority = 'high'" }], default: true };
    case 'logic.loop':
      return { mode: 'for_each', items: '=$prev.items', max_iterations: 100 };
    case 'logic.parallel':
      return { concurrency_cap: 5 };
    case 'logic.join':
      return { join_mode: 'all' };
    case 'logic.wait':
      return { duration_ms: 1000, reason: 'Waiting on timer' };
    case 'data.set':
      return { assignments: [{ path: 'normalized', expr: '=$prev' }], keep_only_set: false };
    case 'data.code':
      return { language: 'javascript', code: 'return items;', timeout_ms: 3000 };
    case 'integration.http':
      return { method: 'GET', url: 'https://api.example.com/status', timeout_ms: 10000 };
    case 'integration.db':
      return { source: 'primary_pg', query: 'SELECT * FROM records LIMIT 25', readonly: true };
    case 'integration.crm':
      return { provider: 'salesforce', object: 'Lead', operation: 'upsert', payload: {} };
    case 'human.approval':
      return { approverRole: 'operator', timeoutMinutes: 60, reason: 'Approve action before continuing' };
    case 'human.notify':
      return { channel: 'slack', template: 'Workflow update: {{$prev.summary}}', recipients: ['#ops'] };
    case 'control.subworkflow':
      return { workflow: 'sub-flow', await: true };
    case 'control.stop':
      return { status: 'succeeded', message: 'Workflow stopped cleanly.' };
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
  ownerName = 'Administrator',
}: WorkflowCanvasViewProps) {
  const [subView, setSubView] = useState<WorkflowSubView>('builder');
  const [workflows, setWorkflows] = useState<WorkflowDto[]>([]);
  const [triggers, setTriggers] = useState<TriggerDto[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<RunDto[]>([]);
  const [stepsByRunId, setStepsByRunId] = useState<Record<string, RunStepDto[]>>({});
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, 'active' | 'paused' | 'archived'>
  >({});
  const [nodeCatalog, setNodeCatalog] =
    useState<WorkflowNodeDescriptorDto[]>(EXTENDED_FALLBACK_NODES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [draftGraph, setDraftGraph] = useState<WorkflowGraphDto>(() => buildStarterWorkflowGraph());
  const [draftSemver, setDraftSemver] = useState('1.0.0');
  const [draftDirty, setDraftDirty] = useState(false);

  // Undo / Redo history + clipboard
  const [historyPast, setHistoryPast] = useState<WorkflowGraphDto[]>([]);
  const [historyFuture, setHistoryFuture] = useState<WorkflowGraphDto[]>([]);
  const copiedNodeRef = useRef<WorkflowNodeDto | null>(null);

  // Palette, multi-select, minimap & canvas navigation state
  const [paletteQuery, setPaletteQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('n_webhook');
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showMinimap, setShowMinimap] = useState(true);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 520 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const nodeDragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  // Execution status overlay on canvas
  const [activeOverlayRun, setActiveOverlayRun] = useState<RunDto | null>(null);
  const [executionOverlay, setExecutionOverlay] = useState<NodeExecutionOverlay | null>(null);

  // Right inspector state
  const [nodeNameInput, setNodeNameInput] = useState('');
  const [nodeConfigInput, setNodeConfigInput] = useState('{}');
  const [nodeConfigError, setNodeConfigError] = useState<string | null>(null);
  const [nodeOnErrorMode, setNodeOnErrorMode] = useState<'fail' | 'continue' | 'retry' | 'route'>('fail');
  const [pinJsonInput, setPinJsonInput] = useState('[]');
  const [pinJsonError, setPinJsonError] = useState<string | null>(null);

  // Validation, run & YAML/JSON / create modals
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
  const [codeModalTab, setCodeModalTab] = useState<'yaml' | 'json'>('yaml');
  const [yamlText, setYamlText] = useState('');
  const [jsonText, setJsonText] = useState('');

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
    setHistoryPast([]);
    setHistoryFuture([]);
    setSelectedNodeId(graphCopy.nodes[0]?.id ?? null);
    setMultiSelectedIds([]);
    setBenchmarkRenderMs(null);
    setValidation(null);
  }, []);

  const commitGraphChange = useCallback(
    (updater: (prev: WorkflowGraphDto) => WorkflowGraphDto, pushHistory = true) => {
      setDraftGraph((prev) => {
        if (pushHistory) {
          setHistoryPast((past) => [...past.slice(-(MAX_HISTORY_DEPTH - 1)), cloneGraph(prev)]);
          setHistoryFuture([]);
        }
        return updater(prev);
      });
      setDraftDirty(true);
    },
    [],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wfList, trigList, catalog, runList] = await Promise.all([
        client.workflows.list(),
        client.triggers.list(),
        client.workflows.listNodes().catch(() => EXTENDED_FALLBACK_NODES),
        client.runs.list({ workspaceId }).catch(() => [] as RunDto[]),
      ]);
      setWorkflows(wfList);
      setTriggers(trigList);
      setWorkflowRuns((prev) => {
        const merged = new Map<string, RunDto>();
        for (const r of runList) merged.set(r.id, r);
        for (const r of prev) {
          if (!merged.has(r.id)) merged.set(r.id, r);
        }
        return Array.from(merged.values());
      });
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
  }, [client, draftDirty, selectedWorkflowId, syncFromWorkflow, workspaceId]);

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
    const groups: Array<{ category: string; label: string; items: WorkflowNodeDescriptorDto[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((n) => n.category === cat);
      if (items.length > 0) {
        groups.push({
          category: cat,
          label: CATEGORY_META[cat]?.label ?? cat,
          items,
        });
      }
    }
    const extra = filtered.filter(
      (n) => !CATEGORY_ORDER.includes(n.category as (typeof CATEGORY_ORDER)[number]),
    );
    if (extra.length > 0) groups.push({ category: 'other', label: 'Other', items: extra });
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

  const allNodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeDto>();
    for (const n of draftGraph.nodes) map.set(n.id, n);
    return map;
  }, [draftGraph.nodes]);

  const visibleNodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeDto>();
    for (const n of visibleNodes) map.set(n.id, n);
    return map;
  }, [visibleNodes]);

  const visibleEdges = useMemo(
    () =>
      draftGraph.edges.filter(
        (e) =>
          allNodeMap.has(e.from.node) &&
          allNodeMap.has(e.to.node) &&
          (visibleNodeMap.has(e.from.node) || visibleNodeMap.has(e.to.node)),
      ),
    [draftGraph.edges, allNodeMap, visibleNodeMap],
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
      setSubView('builder');
      setNotice(`Created starter workflow "${created.name}".`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleCreateFromTemplate(tpl: WorkflowTemplate) {
    setError(null);
    setNotice(null);
    try {
      const graph = tpl.buildGraph();
      const suffix = workflows.length + 1;
      const created = await client.workflows.create(
        {
          workspaceId,
          projectId,
          name: `${tpl.slug}-${suffix}`,
          description: tpl.description,
          semver: '1.0.0',
          graph,
        },
        `ui-wf-tpl-${tpl.id}-${Date.now()}`,
      );
      setWorkflows((prev) => [created, ...prev]);
      setSelectedWorkflowId(created.id);
      syncFromWorkflow(created);
      setSubView('builder');
      setNotice(`Created workflow "${created.name}" from template "${tpl.name}".`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleDuplicateWorkflow(wf: WorkflowDto) {
    setError(null);
    setNotice(null);
    try {
      const baseVer = wf.draftVersion ?? wf.publishedVersion ?? wf.versions[0];
      const created = await client.workflows.create(
        {
          workspaceId,
          projectId,
          name: `${wf.name}-copy`,
          description: wf.description ?? `Copy of ${wf.name}`,
          semver: '1.0.0',
          graph: baseVer ? cloneGraph(baseVer.graph) : buildStarterWorkflowGraph(),
        },
        `ui-wf-dup-${wf.id}-${Date.now()}`,
      );
      setWorkflows((prev) => [created, ...prev]);
      setNotice(`Duplicated workflow "${wf.name}" as "${created.name}".`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleToggleWorkflowActive(wf: WorkflowDto, nextStatus: 'active' | 'paused') {
    setError(null);
    setNotice(null);
    if (nextStatus === 'active' && wf.status !== 'active') {
      const ver = wf.draftVersion ?? wf.publishedVersion ?? wf.versions[0];
      if (ver) {
        try {
          const published = await client.workflows.publishVersion(
            wf.id,
            ver.id,
            `ui-wf-activate-${Date.now()}`,
            { environment, activateTriggers: true },
          );
          setWorkflows((prev) => prev.map((w) => (w.id === published.id ? published : w)));
        } catch (err) {
          setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
          return;
        }
      }
    }
    setStatusOverrides((prev) => ({ ...prev, [wf.id]: nextStatus }));
    setNotice(
      nextStatus === 'active'
        ? `Activated workflow "${wf.name}".`
        : `Paused workflow "${wf.name}".`,
    );
  }

  function handleArchiveWorkflow(wf: WorkflowDto) {
    setStatusOverrides((prev) => ({ ...prev, [wf.id]: 'archived' }));
    setNotice(`Archived workflow "${wf.name}".`);
  }

  function defaultOutputPortForNode(node: WorkflowNodeDto): string {
    const desc = nodeCatalog.find((n) => n.type === node.type);
    if (desc && desc.outputs.length > 0) {
      if (desc.outputs.includes('main')) return 'main';
      if (desc.outputs.includes('approved')) return 'approved';
      if (desc.outputs.includes('true')) return 'true';
      if (desc.outputs.includes('done')) return 'done';
      return desc.outputs[0]!;
    }
    return 'main';
  }

  function addNodeAtPosition(
    desc: WorkflowNodeDescriptorDto,
    position?: { x: number; y: number },
    connectFromId?: string,
  ) {
    const idx = draftGraph.nodes.length + 1;
    const prev =
      (connectFromId ? draftGraph.nodes.find((n) => n.id === connectFromId) : null) ??
      selectedNode ??
      draftGraph.nodes[draftGraph.nodes.length - 1] ??
      null;
    const newId = `n_${desc.type.replace(/\./g, '_')}_${idx}_${Date.now().toString(36).slice(-3)}`;
    const newNode: WorkflowNodeDto = {
      id: newId,
      type: desc.type,
      name: `${desc.label} ${idx}`,
      position: position ?? {
        x: prev ? prev.position.x + 250 : 40,
        y: prev ? prev.position.y : 120,
      },
      config: defaultConfigForNodeType(desc.type),
    };
    commitGraphChange((g) => {
      const nextEdges = [...g.edges];
      if (prev && (!position || connectFromId)) {
        nextEdges.push({
          id: `e_${Date.now()}_${idx}`,
          from: { node: prev.id, port: defaultOutputPortForNode(prev) },
          to: { node: newId, port: 'in' },
        });
      }
      return {
        ...g,
        nodes: [...g.nodes, newNode],
        edges: nextEdges,
      };
    });
    setSelectedNodeId(newId);
    setNotice(`Added "${newNode.name}" (${desc.type}) to canvas draft.`);
  }

  function handleDeleteSelectedNode() {
    if (!selectedNode) return;
    if (draftGraph.nodes.length <= 1) {
      setError('A workflow must retain at least one node.');
      return;
    }
    const targetId = selectedNode.id;
    commitGraphChange((g) => {
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
  }

  function handleDuplicateSelectedNode() {
    if (!selectedNode) return;
    const copyId = `${selectedNode.id}_copy_${Date.now().toString(36).slice(-3)}`;
    const clone: WorkflowNodeDto = {
      ...structuredClone(selectedNode),
      id: copyId,
      name: `${selectedNode.name} Copy`,
      position: {
        x: selectedNode.position.x + 48,
        y: selectedNode.position.y + 96,
      },
    };
    commitGraphChange((g) => ({
      ...g,
      nodes: [...g.nodes, clone],
    }));
    setSelectedNodeId(copyId);
    setNotice(`Duplicated node "${selectedNode.name}".`);
  }

  function handleUndo() {
    if (historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1]!;
    setHistoryPast((p) => p.slice(0, -1));
    setHistoryFuture((f) => [cloneGraph(draftGraph), ...f.slice(0, MAX_HISTORY_DEPTH - 1)]);
    setDraftGraph(previous);
    setDraftDirty(true);
    if (!previous.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(previous.nodes[0]?.id ?? null);
    }
    setNotice('Undid last canvas change.');
  }

  function handleRedo() {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0]!;
    setHistoryFuture((f) => f.slice(1));
    setHistoryPast((p) => [...p.slice(-(MAX_HISTORY_DEPTH - 1)), cloneGraph(draftGraph)]);
    setDraftGraph(next);
    setDraftDirty(true);
    if (!next.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(next.nodes[0]?.id ?? null);
    }
    setNotice('Redid canvas change.');
  }

  function handleAutoLayout() {
    commitGraphChange((g) => autoLayoutGraph(g));
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setNotice('Auto-arranged canvas nodes by topological execution layers.');
  }

  function handleAddStickyNote(textOverride?: string) {
    const count = (draftGraph.notes?.length ?? 0) + 1;
    const anchor = selectedNode?.position ?? { x: 80 + count * 30, y: 250 };
    const noteId = `note_${Date.now()}_${count}`;
    commitGraphChange((g) => ({
      ...g,
      notes: [
        ...(g.notes ?? []),
        {
          id: noteId,
          text: textOverride ?? `Sticky Note ${count}: annotate branching or SLA rules here.`,
          position: { x: anchor.x, y: anchor.y + 110 },
        },
      ],
    }));
    setNotice('Added sticky note to canvas.');
  }

  function handleUpdateStickyNote(noteId: string, text: string) {
    setDraftGraph((g) => ({
      ...g,
      notes: (g.notes ?? []).map((n) => (n.id === noteId ? { ...n, text } : n)),
    }));
    setDraftDirty(true);
  }

  function handleRemoveStickyNote(noteId: string) {
    commitGraphChange((g) => ({
      ...g,
      notes: (g.notes ?? []).filter((n) => n.id !== noteId),
    }));
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
    commitGraphChange((g) => ({
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
  }

  function handleUpdateRetryConfig(max: number, backoffMs: number) {
    if (!selectedNode) return;
    setDraftGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === selectedNode.id
          ? {
              ...n,
              onError: {
                mode: 'retry',
                retry: { max, backoff_ms: backoffMs },
              },
            }
          : n,
      ),
    }));
    setDraftDirty(true);
  }

  function handleUpdateNodeNote(note: string) {
    if (!selectedNode) return;
    const nextConfig = { ...(selectedNode.config ?? {}), _note: note };
    setNodeConfigInput(JSON.stringify(nextConfig, null, 2));
    setDraftGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === selectedNode.id ? { ...n, config: nextConfig } : n)),
    }));
    setDraftDirty(true);
  }

  function handleAddEdge(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromNode = draftGraph.nodes.find((n) => n.id === fromId);
    const fromPort = fromNode ? defaultOutputPortForNode(fromNode) : 'main';
    commitGraphChange((g) => {
      const alreadyExists = g.edges.some((e) => e.from.node === fromId && e.to.node === toId);
      if (alreadyExists) return g;
      return {
        ...g,
        edges: [
          ...g.edges,
          {
            id: `e_${Date.now()}`,
            from: { node: fromId, port: fromPort },
            to: { node: toId, port: 'in' },
          },
        ],
      };
    });
    setConnectingFromNodeId(null);
    setNotice('Connected workflow nodes.');
  }

  function handleFitView() {
    if (draftGraph.nodes.length === 0) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of draftGraph.nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.position.y + NODE_HEIGHT);
    }
    const graphW = Math.max(1, maxX - minX + 80);
    const graphH = Math.max(1, maxY - minY + 80);
    const nextZoom = Math.min(1, Math.max(0.4, Math.min(viewportSize.width / graphW, viewportSize.height / graphH)));
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({
      x: Math.round(40 - minX * nextZoom),
      y: Math.round(40 - minY * nextZoom),
    });
  }

  function handleRemoveEdge(edgeId: string) {
    commitGraphChange((g) => ({
      ...g,
      edges: g.edges.filter((e) => e.id !== edgeId),
    }));
  }

  function handlePinToggle(enabled: boolean) {
    if (!selectedNode) return;
    if (!enabled) {
      commitGraphChange((g) => {
        const nextPinned = { ...g.pinned_data };
        delete nextPinned[selectedNode.id];
        return { ...g, pinned_data: nextPinned };
      });
      setPinJsonInput('[]');
      setPinJsonError(null);
      setNotice(`Cleared pinned output on "${selectedNode.name}".`);
      return;
    }
    const defaultPin = [{ priority: 'high', summary: 'Urgent outage report' }];
    setPinJsonInput(JSON.stringify(defaultPin, null, 2));
    setPinJsonError(null);
    commitGraphChange((g) => ({
      ...g,
      pinned_data: { ...g.pinned_data, [selectedNode.id]: defaultPin },
    }));
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

  async function handleRunWorkflow(startFromSelected: boolean, targetWf?: WorkflowDto | null) {
    const wf = targetWf ?? selectedWorkflow;
    if (!wf) return;
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
        wf.id,
        {
          environment,
          versionId: (wf.draftVersion ?? wf.publishedVersion ?? wf.versions[0])?.id,
          triggerPayload: parsedPayload,
          pinnedData: wf.id === selectedWorkflow?.id ? draftGraph.pinned_data : undefined,
          startFromNodeId: startNodeId,
        },
        `ui-wf-run-${Date.now()}`,
      );
      setLastRun(run);
      setWorkflowRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      if (wf.id === selectedWorkflow?.id) {
        setExecutionOverlay(buildExecutionOverlay(draftGraph, run, []));
        setActiveOverlayRun(run);
      }
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

  function handleOpenYamlModal(initialTab: 'yaml' | 'json' = 'yaml') {
    const source =
      !draftDirty && activeVersion?.yamlSource
        ? activeVersion.yamlSource
        : buildLocalYamlPreview(selectedWorkflow?.name ?? 'workflow', draftSemver, draftGraph);
    setYamlText(source);
    setJsonText(JSON.stringify(draftGraph, null, 2));
    setCodeModalTab(initialTab);
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

  function handleApplyJson() {
    try {
      const parsed = JSON.parse(jsonText) as WorkflowGraphDto;
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        setError('Workflow JSON must include nodes[] and edges[].');
        return;
      }
      commitGraphChange(() => parsed);
      setYamlModalOpen(false);
      setNotice('Applied Workflow JSON to canvas draft.');
    } catch {
      setError('Invalid JSON syntax in Workflow JSON editor.');
    }
  }

  function handleLoadBenchmark() {
    const start = performance.now();
    const bench = buildBenchmarkWorkflowGraph(300);
    setDraftGraph(bench);
    setHistoryPast([]);
    setHistoryFuture([]);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setSelectedNodeId('n_bench_0');
    setMultiSelectedIds([]);
    setDraftDirty(true);
    const elapsed = Math.max(0.1, Number((performance.now() - start).toFixed(2)));
    setBenchmarkRenderMs(elapsed);
    setNotice(`Loaded 300-node benchmark graph (${elapsed}ms layout, viewport-culled).`);
  }

  async function handleInspectRunOnCanvas(run: RunDto, wf: WorkflowDto | null) {
    const targetWf = wf ?? selectedWorkflow;
    let targetGraph = draftGraph;
    if (targetWf) {
      setSelectedWorkflowId(targetWf.id);
      const ver = targetWf.draftVersion ?? targetWf.publishedVersion ?? targetWf.versions[0];
      if (ver) {
        targetGraph = cloneGraph(ver.graph);
        setDraftGraph(targetGraph);
        setDraftSemver(ver.semver);
        setDraftDirty(false);
        setSelectedNodeId(targetGraph.nodes[0]?.id ?? null);
      }
    }
    const steps = stepsByRunId[run.id] ?? (await loadStepsForRun(run.id));
    setExecutionOverlay(buildExecutionOverlay(targetGraph, run, steps));
    setActiveOverlayRun(run);
    setSubView('builder');
    setNotice(`Inspecting execution ${run.id} (${run.status}) on Canvas Builder.`);
  }

  async function loadStepsForRun(runId: string): Promise<RunStepDto[]> {
    try {
      const steps = await client.runs.listSteps(runId);
      setStepsByRunId((prev) => ({ ...prev, [runId]: steps }));
      return steps;
    } catch {
      return [];
    }
  }

  async function handleCancelRun(runId: string) {
    try {
      const updated = await client.runs.cancel(
        runId,
        'Cancelled from Workflow Executions',
        `ui-wf-cancel-${Date.now()}`,
      );
      setWorkflowRuns((prev) => prev.map((r) => (r.id === runId ? updated : r)));
      setNotice(`Cancelled execution ${runId}.`);
    } catch {
      setWorkflowRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, status: 'cancelled' } : r)),
      );
      setNotice(`Marked execution ${runId} as cancelled.`);
    }
  }

  function handleCanvasDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const nodeType =
      e.dataTransfer?.getData('application/x-elshad-node') ||
      e.dataTransfer?.getData('text/plain');
    if (!nodeType) return;
    const desc = nodeCatalog.find((d) => d.type === nodeType);
    if (!desc) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    const x = rect ? Math.round((e.clientX - rect.left - pan.x) / zoom) : 120;
    const y = rect ? Math.round((e.clientY - rect.top - pan.y) / zoom) : 120;
    addNodeAtPosition(desc, { x: Math.max(20, x), y: Math.max(20, y) });
  }

  function handleCanvasKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
    } else if (mod && e.key.toLowerCase() === 'c' && selectedNode) {
      e.preventDefault();
      copiedNodeRef.current = structuredClone(selectedNode);
      setNotice(`Copied node "${selectedNode.name}".`);
    } else if (mod && e.key.toLowerCase() === 'v' && copiedNodeRef.current) {
      e.preventDefault();
      const src = copiedNodeRef.current;
      const pasteId = `${src.id}_paste_${Date.now().toString(36).slice(-3)}`;
      const pasted: WorkflowNodeDto = {
        ...structuredClone(src),
        id: pasteId,
        name: `${src.name} Paste`,
        position: { x: src.position.x + 40, y: src.position.y + 40 },
      };
      commitGraphChange((g) => ({ ...g, nodes: [...g.nodes, pasted] }));
      setSelectedNodeId(pasteId);
      setNotice(`Pasted node "${pasted.name}".`);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
      e.preventDefault();
      handleDeleteSelectedNode();
    }
  }

  function handleCanvasPointerDown(e: PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (e.target !== e.currentTarget && target?.dataset?.canvasBg !== 'true') return;
    dragOriginRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }

  function handleCanvasPointerMove(e: PointerEvent<HTMLDivElement>) {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag) {
      const dx = (e.clientX - nodeDrag.startX) / zoom;
      const dy = (e.clientY - nodeDrag.startY) / zoom;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        nodeDrag.moved = true;
      }
      if (nodeDrag.moved) {
        const nextX = Math.round(nodeDrag.origX + dx);
        const nextY = Math.round(nodeDrag.origY + dy);
        setDraftGraph((g) => ({
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === nodeDrag.nodeId ? { ...n, position: { x: nextX, y: nextY } } : n,
          ),
        }));
      }
      return;
    }
    const origin = dragOriginRef.current;
    if (!origin) return;
    setPan({
      x: origin.panX + (e.clientX - origin.x),
      y: origin.panY + (e.clientY - origin.y),
    });
  }

  function handleCanvasPointerUp() {
    if (nodeDragRef.current?.moved) {
      setDraftDirty(true);
    }
    nodeDragRef.current = null;
    dragOriginRef.current = null;
  }

  const overlayCounts = useMemo(() => {
    if (!executionOverlay) return null;
    const vals = Object.values(executionOverlay);
    return {
      succeeded: vals.filter((v) => v.status === 'succeeded').length,
      failed: vals.filter((v) => v.status === 'failed').length,
      waiting: vals.filter((v) => v.status === 'waiting').length,
    };
  }, [executionOverlay]);

  const minimapSample = useMemo(
    () => (draftGraph.nodes.length > 80 ? draftGraph.nodes.slice(0, 80) : draftGraph.nodes),
    [draftGraph.nodes],
  );

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
    <div style={{ display: 'grid', gap: '12px' }} onKeyDown={handleCanvasKeyDown}>
      {/* Top Sub-View Switcher (Screens 12, 13, 14) */}
      <div
        role="tablist"
        aria-label="Workflow views"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          width: 'fit-content',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {(
          [
            { key: 'builder', label: 'Canvas Builder' },
            { key: 'registry', label: 'Registry' },
            { key: 'executions', label: `Executions (${workflowRuns.length})` },
          ] as Array<{ key: WorkflowSubView; label: string }>
        ).map((item) => {
          const active = subView === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubView(item.key)}
              style={{
                minHeight: '32px',
                padding: '5px 14px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: active ? 'var(--brand)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          );
        })}
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

      {/* Create Workflow Modal (shared between Registry & Canvas Builder) */}
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
            boxShadow: 'var(--shadow-card)',
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

      {/* Screen 12: Workflows Registry & Template Gallery */}
      {subView === 'registry' && (
        <WorkflowsRegistryView
          workflows={workflows}
          runs={workflowRuns}
          environment={environment}
          ownerName={ownerName}
          statusOverrides={statusOverrides}
          onCreateClick={() => setCreateOpen(true)}
          onOpenBuilder={(wf) => {
            setSelectedWorkflowId(wf.id);
            syncFromWorkflow(wf);
            setSubView('builder');
          }}
          onDuplicateWorkflow={handleDuplicateWorkflow}
          onToggleActive={handleToggleWorkflowActive}
          onArchiveWorkflow={handleArchiveWorkflow}
          onCreateFromTemplate={handleCreateFromTemplate}
        />
      )}

      {/* Screen 14: Workflow Executions */}
      {subView === 'executions' && (
        <WorkflowExecutionsView
          workflows={workflows}
          runs={workflowRuns}
          stepsByRunId={stepsByRunId}
          environment={environment}
          loading={loading}
          onRefresh={() => void loadAll()}
          onInspectOnCanvas={handleInspectRunOnCanvas}
          onCancelRun={handleCancelRun}
          onRerunWorkflow={(run, wf) => handleRunWorkflow(false, wf ?? workflows.find((w) => w.id === run.subjectVersionId) ?? selectedWorkflow)}
          onLoadRunSteps={loadStepsForRun}
          onRunSelectedWorkflow={() => void handleRunWorkflow(false)}
        />
      )}

      {/* Screen 13: Workflow Canvas Builder */}
      {subView === 'builder' && (
        <>
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
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '20px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <GitBranch size={18} style={{ color: 'var(--brand)' }} aria-hidden="true" />
                  <span>Workflow Canvas</span>
                </h1>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Visual DAG builder, sandboxed JSONata expressions, pin &amp; test-from-here, and lossless YAML/JSON.
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
                      setExecutionOverlay(null);
                      setActiveOverlayRun(null);
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
                        {wf.name} ({statusOverrides[wf.id] ?? wf.status})
                      </option>
                    ))}
                  </select>
                  {selectedWorkflow && (
                    <StatusChip
                      label={
                        (statusOverrides[selectedWorkflow.id] ?? selectedWorkflow.status) === 'active'
                          ? 'Published'
                          : statusOverrides[selectedWorkflow.id] ?? selectedWorkflow.status
                      }
                      tone={
                        (statusOverrides[selectedWorkflow.id] ?? selectedWorkflow.status) === 'active'
                          ? 'success'
                          : 'neutral'
                      }
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
                onClick={() => handleOpenYamlModal('yaml')}
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
                disabled={historyPast.length === 0}
                onClick={handleUndo}
                style={{
                  minHeight: '32px',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface-raised)',
                  fontWeight: 600,
                  cursor: historyPast.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Undo2 size={13} aria-hidden="true" />
                <span>Undo</span>
              </button>

              <button
                type="button"
                disabled={historyFuture.length === 0}
                onClick={handleRedo}
                style={{
                  minHeight: '32px',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface-raised)',
                  fontWeight: 600,
                  cursor: historyFuture.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Redo2 size={13} aria-hidden="true" />
                <span>Redo</span>
              </button>

              <button
                type="button"
                onClick={handleAutoLayout}
                style={{
                  minHeight: '32px',
                  padding: '6px 8px',
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
                <LayoutGrid size={13} aria-hidden="true" />
                <span>Auto-Layout</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddStickyNote()}
                style={{
                  minHeight: '32px',
                  padding: '6px 8px',
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
                <StickyNote size={13} aria-hidden="true" />
                <span>Sticky Note</span>
              </button>

              <button
                type="button"
                onClick={() => setVersionsDrawerOpen((v) => !v)}
                style={{
                  minHeight: '32px',
                  padding: '6px 8px',
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
                <History size={13} aria-hidden="true" />
                <span>Versions</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const link =
                    typeof window !== 'undefined' ? window.location.href : '/w/default/e/dev/workflows';
                  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(link).catch(() => {});
                  }
                  setNotice(`Share link ready for "${selectedWorkflow?.name ?? 'workflow'}": ${link}`);
                }}
                style={{
                  minHeight: '32px',
                  padding: '6px 8px',
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
                <Share2 size={13} aria-hidden="true" />
                <span>Share</span>
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

          {/* Version History Drawer */}
          {versionsDrawerOpen && selectedWorkflow && (
            <section
              aria-label="Workflow version history"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--lavender-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                display: 'grid',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Version History ({selectedWorkflow.versions.length})</strong>
                <button
                  type="button"
                  onClick={() => setVersionsDrawerOpen(false)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-raised)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Close History
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {selectedWorkflow.versions.map((ver) => (
                  <div
                    key={ver.id}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface-raised)',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <strong>v{ver.semver}</strong>
                    <StatusChip
                      label={ver.state}
                      tone={ver.state === 'published' ? 'success' : 'neutral'}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        commitGraphChange(() => cloneGraph(ver.graph));
                        setDraftSemver(ver.semver);
                        setNotice(`Restored canvas from v${ver.semver}.`);
                      }}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--brand)',
                        backgroundColor: 'var(--surface)',
                        color: 'var(--brand)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Execution Status Overlay Banner (when opened from Screen 14 or live test) */}
          {activeOverlayRun && executionOverlay && overlayCounts && (
            <div
              role="region"
              aria-label="Execution overlay status"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--lavender-border)',
                backgroundColor: 'var(--lavender-soft)',
                fontSize: '12.5px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong>Execution Overlay:</strong>
                <code>{activeOverlayRun.id}</code>
                <StatusChip
                  label={activeOverlayRun.status}
                  tone={
                    activeOverlayRun.status === 'succeeded'
                      ? 'success'
                      : activeOverlayRun.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  }
                />
                <span>
                  {overlayCounts.succeeded} succeeded · {overlayCounts.failed} failed ·{' '}
                  {overlayCounts.waiting} waiting
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveOverlayRun(null);
                  setExecutionOverlay(null);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Exit Execution Overlay
              </button>
            </div>
          )}

          {/* YAML / JSON Lossless Modal */}
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
                boxShadow: 'var(--shadow-card)',
                display: 'grid',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <h2 id="yaml-modal-heading" style={{ margin: 0, fontSize: '18px' }}>
                  Workflow YAML / JSON Definition (Lossless Round-Trip)
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
              <div role="tablist" aria-label="Definition format" style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={codeModalTab === 'yaml'}
                  onClick={() => setCodeModalTab('yaml')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: codeModalTab === 'yaml' ? 'var(--brand)' : 'var(--surface-raised)',
                    color: codeModalTab === 'yaml' ? '#fff' : 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  YAML
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={codeModalTab === 'json'}
                  onClick={() => setCodeModalTab('json')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    backgroundColor: codeModalTab === 'json' ? 'var(--brand)' : 'var(--surface-raised)',
                    color: codeModalTab === 'json' ? '#fff' : 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  JSON
                </button>
              </div>
              {activeVersion?.graphHash && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Graph SHA-256: <code>{activeVersion.graphHash}</code>
                </div>
              )}
              {codeModalTab === 'yaml' ? (
                <>
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
                </>
              ) : (
                <>
                  <label htmlFor="workflow-json-textarea" style={{ fontWeight: 600, fontSize: '13px' }}>
                    workflow_json
                  </label>
                  <textarea
                    id="workflow-json-textarea"
                    rows={14}
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
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
                      onClick={handleApplyJson}
                      style={{
                        minHeight: '32px',
                        padding: '6px 14px',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--brand)',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Apply JSON to Draft
                    </button>
                  </div>
                </>
              )}
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
              gridTemplateColumns: `${paletteCollapsed || canvasExpanded ? '' : '220px '}minmax(0, 1fr)${inspectorCollapsed || canvasExpanded ? '' : ' 310px'}`,
              gap: '12px',
              alignItems: 'start',
            }}
          >
            {/* Left Draggable Node Palette */}
            {!paletteCollapsed && !canvasExpanded && (
              <aside
                aria-label="Node Palette"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  boxShadow: 'var(--shadow-card)',
                  display: 'grid',
                  gap: '10px',
                  maxHeight: '640px',
                  overflowY: 'auto',
                }}
              >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '14px' }}>Node Palette</h2>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Drag or click</span>
              </div>
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

              {filteredCatalogByCategory.map((group) => {
                const catMeta = CATEGORY_META[group.category] ?? CATEGORY_META.control!;
                return (
                  <div key={group.category} style={{ display: 'grid', gap: '4px' }}>
                    <div
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: catMeta.accent,
                      }}
                    >
                      {group.label}
                    </div>
                    {group.items.map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer?.setData('application/x-elshad-node', item.type);
                          e.dataTransfer?.setData('text/plain', item.type);
                        }}
                        onClick={() => addNodeAtPosition(item)}
                        style={{
                          textAlign: 'left',
                          padding: '6px 8px',
                          borderRadius: 'var(--radius-sm)',
                          borderTop: '1px solid var(--border)',
                          borderRight: '1px solid var(--border)',
                          borderBottom: '1px solid var(--border)',
                          borderLeft: `3px solid ${catMeta.accent}`,
                          backgroundColor: 'var(--surface-raised)',
                          cursor: 'grab',
                          fontSize: '12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{item.label}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>+</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              </aside>
            )}

            {/* Center Interactive Pan/Zoom Canvas */}
            <section
              aria-label="Workflow Graph Canvas"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-card)',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span>
                    Nodes rendered: <strong>{visibleNodes.length}</strong> / {draftGraph.nodes.length}
                  </span>
                  <span>Edges: {draftGraph.edges.length}</span>
                  {(draftGraph.notes?.length ?? 0) > 0 && (
                    <span>Notes: {draftGraph.notes.length}</span>
                  )}
                  {benchmarkRenderMs !== null && (
                    <StatusChip label={`Benchmark: ${benchmarkRenderMs}ms`} tone="info" />
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                  {connectingFromNodeId && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--lavender-soft)',
                        border: '1px solid var(--brand)',
                        color: 'var(--brand)',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      <span>Click target input port to connect</span>
                      <button
                        type="button"
                        onClick={() => setConnectingFromNodeId(null)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--brand)',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="Toggle node palette"
                    onClick={() => setPaletteCollapsed((c) => !c)}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: !paletteCollapsed && !canvasExpanded ? 'var(--lavender)' : 'var(--surface)',
                      color: !paletteCollapsed && !canvasExpanded ? 'var(--brand)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <PanelLeft size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Toggle node inspector"
                    onClick={() => setInspectorCollapsed((c) => !c)}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: !inspectorCollapsed && !canvasExpanded ? 'var(--lavender)' : 'var(--surface)',
                      color: !inspectorCollapsed && !canvasExpanded ? 'var(--brand)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <PanelRight size={13} aria-hidden="true" />
                  </button>
                  {multiSelectedIds.length > 1 && (
                    <>
                      <StatusChip label={`${multiSelectedIds.length} selected`} tone="info" />
                      <button
                        type="button"
                        onClick={() => {
                          handleAddStickyNote(`Group (${multiSelectedIds.length} nodes)`);
                          setMultiSelectedIds([]);
                        }}
                        style={{
                          padding: '3px 8px',
                          border: '1px solid var(--brand)',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--lavender-soft)',
                          color: 'var(--brand)',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Group Note
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label="Toggle minimap"
                    onClick={() => setShowMinimap((m) => !m)}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: showMinimap ? 'var(--lavender)' : 'var(--surface)',
                      color: showMinimap ? 'var(--brand)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <MapIcon size={13} aria-hidden="true" />
                  </button>
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
                    onClick={handleFitView}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Fit View
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
                  <button
                    type="button"
                    aria-label="Toggle fullscreen canvas"
                    onClick={() => setCanvasExpanded((v) => !v)}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: canvasExpanded ? 'var(--lavender)' : 'var(--surface)',
                      color: canvasExpanded ? 'var(--brand)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    {canvasExpanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div
                ref={viewportRef}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleCanvasDrop}
                style={{
                  position: 'relative',
                  height: canvasExpanded ? '78vh' : 'clamp(580px, 68vh, 860px)',
                  overflow: 'hidden',
                  backgroundColor: 'var(--bg, #F6F7FB)',
                  backgroundImage:
                    'radial-gradient(var(--border-strong) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                  cursor: 'grab',
                }}
              >
                <div
                  data-canvas-bg="true"
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
                    style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}
                  >
                    <defs>
                      <marker
                        id="wf-arrow-default"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#3924D6" />
                      </marker>
                      <marker
                        id="wf-arrow-success"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#12B76A" />
                      </marker>
                      <marker
                        id="wf-arrow-danger"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#D92D20" />
                      </marker>
                    </defs>
                    {visibleEdges.map((edge) => {
                      const fromNode = allNodeMap.get(edge.from.node);
                      const toNode = allNodeMap.get(edge.to.node);
                      if (!fromNode || !toNode) return null;
                      const x1 = fromNode.position.x + NODE_WIDTH;
                      const y1 = fromNode.position.y + NODE_HEIGHT / 2;
                      const x2 = toNode.position.x - 4;
                      const y2 = toNode.position.y + NODE_HEIGHT / 2;
                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2;
                      const edgeOverlay = executionOverlay?.[fromNode.id];
                      const strokeColor =
                        edgeOverlay?.status === 'succeeded'
                          ? '#12B76A'
                          : edgeOverlay?.status === 'failed'
                            ? '#D92D20'
                            : '#3924D6';
                      const markerId =
                        edgeOverlay?.status === 'succeeded'
                          ? 'wf-arrow-success'
                          : edgeOverlay?.status === 'failed'
                            ? 'wf-arrow-danger'
                            : 'wf-arrow-default';
                      return (
                        <g key={edge.id} data-testid="canvas-edge">
                          <path
                            d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={edgeOverlay ? 2.6 : 2.1}
                            markerEnd={`url(#${markerId})`}
                          />
                          {edge.from.port !== 'main' && (
                            <text
                              x={midX}
                              y={midY - 6}
                              textAnchor="middle"
                              fontSize="10"
                              fontWeight="600"
                              fill="#3924D6"
                            >
                              {edge.from.port}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {/* Sticky Notes inside Canvas */}
                  {(draftGraph.notes ?? []).map((note) => (
                    <div
                      key={note.id}
                      style={{
                        position: 'absolute',
                        left: `${note.position?.x ?? 80}px`,
                        top: `${note.position?.y ?? 260}px`,
                        width: '210px',
                        padding: '8px',
                        backgroundColor: '#FEF3C7',
                        border: '1px solid #F59E0B',
                        borderRadius: 'var(--radius-sm)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                        color: '#17172B',
                        display: 'grid',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 700 }}>
                        <span>STICKY NOTE</span>
                        <button
                          type="button"
                          aria-label="Remove sticky note"
                          onClick={() => handleRemoveStickyNote(note.id)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#92400E',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '11px',
                          }}
                        >
                          x
                        </button>
                      </div>
                      <textarea
                        aria-label="Sticky note"
                        rows={2}
                        value={note.text}
                        onChange={(e) => handleUpdateStickyNote(note.id, e.target.value)}
                        style={{
                          width: '100%',
                          border: '1px solid #FCD34D',
                          backgroundColor: '#FFFBEB',
                          color: '#17172B',
                          fontSize: '11.5px',
                          padding: '4px',
                          borderRadius: '4px',
                        }}
                      />
                    </div>
                  ))}

                  {visibleNodes.map((node) => {
                    const isSelected = node.id === selectedNodeId;
                    const isMultiSelected = multiSelectedIds.includes(node.id);
                    const isPinned = Array.isArray(draftGraph.pinned_data[node.id]);
                    const nodeIssues = issueCountsByNode.get(node.id);
                    const cat = getNodeCategory(node.type);
                    const catMeta = CATEGORY_META[cat] ?? CATEGORY_META.control!;
                    const overlay = executionOverlay?.[node.id];

                    const borderStyle = overlay
                      ? overlay.status === 'succeeded'
                        ? '2px solid var(--success)'
                        : overlay.status === 'failed'
                          ? '2px solid var(--danger)'
                          : '2px solid var(--warning)'
                      : isSelected
                        ? '2px solid var(--brand)'
                        : isMultiSelected
                          ? '2px dashed var(--brand)'
                          : nodeIssues?.errors
                            ? '2px solid var(--danger)'
                            : '1px solid var(--border)';

                    const bgStyle = overlay
                      ? overlay.status === 'succeeded'
                        ? 'var(--success-bg)'
                        : overlay.status === 'failed'
                          ? 'var(--danger-bg)'
                          : 'var(--warning-bg)'
                      : 'var(--surface)';

                    const isHovered = hoveredNodeId === node.id;
                    const showPorts = isHovered || isSelected || Boolean(connectingFromNodeId);

                    return (
                      <div
                        key={node.id}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
                        onFocus={() => setHoveredNodeId(node.id)}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                            setHoveredNodeId((prev) => (prev === node.id ? null : prev));
                          }
                        }}
                        onPointerDown={(e) => {
                          const target = e.target as HTMLElement | null;
                          if (target?.closest('[data-port-handle="true"]')) return;
                          e.stopPropagation();
                          nodeDragRef.current = {
                            nodeId: node.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            origX: node.position.x,
                            origY: node.position.y,
                            moved: false,
                          };
                        }}
                        style={{
                          position: 'absolute',
                          left: `${node.position.x}px`,
                          top: `${node.position.y}px`,
                          width: `${NODE_WIDTH}px`,
                          minHeight: `${NODE_HEIGHT}px`,
                          zIndex: isSelected || isHovered ? 4 : 2,
                        }}
                      >
                        {!node.type.startsWith('trigger.') && (
                          <button
                            type="button"
                            data-port-handle="true"
                            aria-label={`Input port (${node.id})`}
                            title={`Connect to ${node.name} input`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (connectingFromNodeId && connectingFromNodeId !== node.id) {
                                handleAddEdge(connectingFromNodeId, node.id);
                              }
                            }}
                            style={{
                              position: 'absolute',
                              left: '-9px',
                              top: `${NODE_HEIGHT / 2 - 9}px`,
                              width: '18px',
                              height: '18px',
                              padding: 0,
                              borderRadius: '9999px',
                              border: connectingFromNodeId && connectingFromNodeId !== node.id
                                ? '2px solid var(--brand)'
                                : '1.5px solid var(--border-strong)',
                              backgroundColor: connectingFromNodeId && connectingFromNodeId !== node.id
                                ? 'var(--lavender)'
                                : 'var(--surface)',
                              color: 'var(--brand)',
                              fontSize: '12px',
                              fontWeight: 700,
                              lineHeight: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: connectingFromNodeId ? 'crosshair' : 'default',
                              zIndex: 2,
                              opacity: showPorts ? 1 : 0,
                              transition: 'opacity 120ms ease',
                            }}
                          >
                            {connectingFromNodeId && connectingFromNodeId !== node.id ? '+' : ''}
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="canvas-node"
                          data-overlay-status={overlay?.status}
                          aria-pressed={isSelected}
                          onClick={(e) => {
                            setSelectedNodeId(node.id);
                            if (e.shiftKey) {
                              setMultiSelectedIds((prev) =>
                                prev.includes(node.id)
                                  ? prev.filter((id) => id !== node.id)
                                  : [...prev, node.id],
                              );
                            }
                          }}
                          style={{
                            width: '100%',
                            minHeight: `${NODE_HEIGHT}px`,
                            padding: '9px 10px',
                            textAlign: 'left',
                            backgroundColor: bgStyle,
                            borderRight: borderStyle,
                            borderBottom: borderStyle,
                            borderLeft: borderStyle,
                            borderTop: `4px solid ${catMeta.accent}`,
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            display: 'grid',
                            gap: '3px',
                            boxShadow: isSelected
                              ? '0 0 0 3px var(--lavender)'
                              : '0 2px 6px rgba(23, 23, 43, 0.06)',
                          }}
                        >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', alignItems: 'center' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: catMeta.accent,
                            }}
                          >
                            {node.type}
                          </span>
                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                            {node.onError?.mode === 'retry' && (
                              <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--info)' }}>
                                Retry {node.onError.retry?.max ?? 3}x
                              </span>
                            )}
                            {node.onError?.mode === 'route' && (
                              <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--warning)' }}>
                                Err Branch
                              </span>
                            )}
                            {isPinned && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  color: 'var(--warning)',
                                }}
                              >
                                PINNED
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                          {node.name}
                        </div>

                        <div
                          style={{
                            fontSize: '10.5px',
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {getNodeConfigPreview(node)}
                        </div>

                        {overlay && (
                          <div
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color:
                                overlay.status === 'succeeded'
                                  ? 'var(--success)'
                                  : overlay.status === 'failed'
                                    ? 'var(--danger)'
                                    : 'var(--warning)',
                            }}
                          >
                            {overlay.status === 'succeeded'
                              ? `OK · ${overlay.durationMs}ms`
                              : overlay.status === 'failed'
                                ? 'FAILED'
                                : 'WAITING'}
                          </div>
                        )}
                        </button>
                        {node.type !== 'control.stop' && (
                          <>
                            <button
                              type="button"
                              data-port-handle="true"
                              aria-label={`Output port (${node.id})`}
                              title={`Connect or add node after ${node.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConnectingFromNodeId((prev) => (prev === node.id ? null : node.id));
                              }}
                              style={{
                                position: 'absolute',
                                right: '-10px',
                                top: `${NODE_HEIGHT / 2 - 10}px`,
                                width: '20px',
                                height: '20px',
                                padding: 0,
                                borderRadius: '9999px',
                                border: '2px solid var(--brand)',
                                backgroundColor: connectingFromNodeId === node.id
                                  ? 'var(--brand)'
                                  : 'var(--surface)',
                                color: connectingFromNodeId === node.id ? '#FFFFFF' : 'var(--brand)',
                                fontSize: '14px',
                                fontWeight: 700,
                                lineHeight: 1,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                zIndex: 3,
                                boxShadow: '0 1px 4px rgba(23, 23, 43, 0.14)',
                                opacity: showPorts ? 1 : 0,
                                transition: 'opacity 120ms ease',
                              }}
                            >
                              +
                            </button>
                            {connectingFromNodeId === node.id && (
                              <div
                                role="region"
                                aria-label="Quick connect next node"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: 'absolute',
                                  left: `${NODE_WIDTH + 14}px`,
                                  top: '0px',
                                  width: '210px',
                                  padding: '8px',
                                  borderRadius: 'var(--radius-md)',
                                  border: '1px solid var(--lavender-border)',
                                  backgroundColor: 'var(--surface)',
                                  boxShadow: 'var(--shadow-card)',
                                  display: 'grid',
                                  gap: '5px',
                                  zIndex: 10,
                                  fontSize: '11.5px',
                                }}
                              >
                                <div style={{ fontWeight: 700, color: 'var(--brand)' }}>
                                  Add &amp; Connect Next Node
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                                  Pick a node below or click another node&apos;s left + port:
                                </div>
                                {nodeCatalog
                                  .filter((item) => !item.type.startsWith('trigger.'))
                                  .slice(0, 6)
                                  .map((item) => (
                                    <button
                                      key={`qc-${node.id}-${item.type}`}
                                      type="button"
                                      onClick={() => {
                                        addNodeAtPosition(
                                          item,
                                          {
                                            x: node.position.x + 260,
                                            y: node.position.y,
                                          },
                                          node.id,
                                        );
                                        setConnectingFromNodeId(null);
                                      }}
                                      style={{
                                        textAlign: 'left',
                                        padding: '4px 8px',
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--border)',
                                        backgroundColor: 'var(--surface-raised)',
                                        color: 'var(--text-primary)',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                      }}
                                    >
                                      <span>{item.label}</span>
                                      <span style={{ color: 'var(--brand)' }}>+</span>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Minimap Overlay */}
                {showMinimap && minimapSample.length > 0 && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      right: '10px',
                      bottom: '10px',
                      width: '126px',
                      height: '76px',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: 'var(--shadow-card)',
                      padding: '4px',
                      pointerEvents: 'none',
                    }}
                  >
                    <svg viewBox="0 0 1200 720" width="118" height="68">
                      {minimapSample.map((n) => (
                        <rect
                          key={`mm-${n.id}`}
                          x={Math.max(0, Math.min(1120, n.position.x))}
                          y={Math.max(0, Math.min(660, n.position.y))}
                          width={70}
                          height={36}
                          rx={6}
                          fill={n.id === selectedNodeId ? '#3924D6' : '#CBD5E1'}
                        />
                      ))}
                    </svg>
                  </div>
                )}
              </div>
            </section>

            {/* Right Contextual 6-Tab Inspector + Expression Editor */}
            {!inspectorCollapsed && !canvasExpanded && (
              <WorkflowInspectorPanel
                selectedNode={selectedNode}
                allNodes={draftGraph.nodes}
                edges={draftGraph.edges}
                nodeNameInput={nodeNameInput}
                nodeConfigInput={nodeConfigInput}
                nodeConfigError={nodeConfigError}
                nodeOnErrorMode={nodeOnErrorMode}
                isSelectedNodePinned={isSelectedNodePinned}
                pinJsonInput={pinJsonInput}
                pinJsonError={pinJsonError}
                triggerPayloadText={triggerPayloadText}
                pinnedData={draftGraph.pinned_data}
                overlayEntry={selectedNode ? executionOverlay?.[selectedNode.id] : undefined}
                onUpdateNodeName={handleUpdateNodeName}
                onUpdateNodeConfig={handleUpdateNodeConfig}
                onUpdateNodeOnError={handleUpdateNodeOnError}
                onUpdateRetryConfig={handleUpdateRetryConfig}
                onUpdateNodeNote={handleUpdateNodeNote}
                onPinToggle={handlePinToggle}
                onPinJsonChange={handlePinJsonChange}
                onDeleteSelectedNode={handleDeleteSelectedNode}
                onDuplicateSelectedNode={handleDuplicateSelectedNode}
                onAddEdge={handleAddEdge}
                onRemoveEdge={handleRemoveEdge}
              />
            )}
          </div>

          {/* Bottom Execution Logs & Validation Panel */}
          <section
            aria-label="Validation and Execution Status"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              boxShadow: 'var(--shadow-card)',
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
                      {errItem.nodeId && (
                        <button
                          type="button"
                          onClick={() => setSelectedNodeId(errItem.nodeId!)}
                          style={{
                            marginLeft: '6px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--brand)',
                            textDecoration: 'underline',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          Focus {errItem.nodeId}
                        </button>
                      )}
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
              <label
                htmlFor="trigger-test-payload"
                style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}
              >
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
              <h3 style={{ margin: '0 0 6px 0', fontSize: '13px' }}>
                Registered Triggers ({workflowTriggers.length})
              </h3>
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
        </>
      )}
    </div>
  );
}
