import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeProps,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  WorkflowEdgeDto,
  WorkflowNodeDescriptorDto,
  WorkflowNodeDto,
} from '@elshad/sdk-ts';
import {
  CATEGORY_META,
  getNodeCategory,
  getNodeConfigPreview,
  type NodeExecutionOverlay,
  type NodeExecutionOverlayEntry,
} from './workflowTemplates.js';

const NODE_WIDTH = 216;
const NODE_HEIGHT = 92;
const SNAP_GRID: [number, number] = [16, 16];
const FIT_VIEW_OPTIONS = { padding: 0.2 };
const DELETE_KEY_CODE = ['Backspace', 'Delete'];
const PRO_OPTIONS = { hideAttribution: true };

interface WorkflowFlowNodeData extends Record<string, unknown> {
  wfNode: WorkflowNodeDto;
  isSelected: boolean;
  isMultiSelected: boolean;
  isPinned: boolean;
  isHovered: boolean;
  connectingFromNodeId: string | null;
  errorsCount: number;
  overlay?: NodeExecutionOverlayEntry;
  nodeCatalog: WorkflowNodeDescriptorDto[];
  onSelectNode: (nodeId: string, shiftKey: boolean) => void;
  onHoverNode: (nodeId: string | null) => void;
  onToggleConnectingFrom: (nodeId: string | null) => void;
  onConnectNodes: (fromId: string, toId: string) => void;
  onQuickAddNode: (
    desc: WorkflowNodeDescriptorDto,
    position: { x: number; y: number },
    connectFromId: string,
  ) => void;
}

const WorkflowFlowNode = memo(function WorkflowFlowNode({
  data,
}: NodeProps<Node<WorkflowFlowNodeData>>) {
  const {
    wfNode,
    isSelected,
    isMultiSelected,
    isPinned,
    isHovered,
    connectingFromNodeId,
    errorsCount,
    overlay,
    nodeCatalog,
    onSelectNode,
    onHoverNode,
    onToggleConnectingFrom,
    onConnectNodes,
    onQuickAddNode,
  } = data;

  const cat = getNodeCategory(wfNode.type);
  const catMeta = CATEGORY_META[cat] ?? CATEGORY_META.control!;
  const showPorts = isHovered || isSelected || Boolean(connectingFromNodeId);
  const isTrigger = wfNode.type.startsWith('trigger.');
  const isStop = wfNode.type === 'control.stop';

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
        : errorsCount > 0
          ? '2px solid var(--danger)'
          : '1px solid var(--border)';

  const bgStyle = overlay
    ? overlay.status === 'succeeded'
      ? 'var(--success-bg)'
      : overlay.status === 'failed'
        ? 'var(--danger-bg)'
        : 'var(--warning-bg)'
    : 'var(--surface)';

  return (
    <div
      onMouseEnter={() => onHoverNode(wfNode.id)}
      onMouseLeave={() => onHoverNode(null)}
      onFocus={() => onHoverNode(wfNode.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) {
          onHoverNode(null);
        }
      }}
      style={{
        position: 'relative',
        width: `${NODE_WIDTH}px`,
        minHeight: `${NODE_HEIGHT}px`,
      }}
    >
      {!isTrigger && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="in"
            style={{
              width: '10px',
              height: '10px',
              left: '-5px',
              backgroundColor: 'var(--surface)',
              border: '2px solid var(--brand)',
              opacity: showPorts ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          />
          <button
            type="button"
            className="nodrag nopan"
            aria-label={`Input port (${wfNode.id})`}
            title={`Connect to ${wfNode.name} input`}
            onClick={(e) => {
              e.stopPropagation();
              if (connectingFromNodeId && connectingFromNodeId !== wfNode.id) {
                onConnectNodes(connectingFromNodeId, wfNode.id);
              }
            }}
            style={{
              position: 'absolute',
              left: '-10px',
              top: `${NODE_HEIGHT / 2 - 10}px`,
              width: '20px',
              height: '20px',
              padding: 0,
              borderRadius: '9999px',
              border:
                connectingFromNodeId && connectingFromNodeId !== wfNode.id
                  ? '2px solid var(--brand)'
                  : '1.5px solid var(--border-strong)',
              backgroundColor:
                connectingFromNodeId && connectingFromNodeId !== wfNode.id
                  ? 'var(--lavender)'
                  : 'var(--surface)',
              color: 'var(--brand)',
              fontSize: '12px',
              fontWeight: 700,
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: connectingFromNodeId ? 'crosshair' : 'pointer',
              zIndex: 4,
              opacity: showPorts ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          >
            {connectingFromNodeId && connectingFromNodeId !== wfNode.id ? '+' : ''}
          </button>
        </>
      )}

      <button
        type="button"
        data-testid="canvas-node"
        data-overlay-status={overlay?.status}
        aria-pressed={isSelected}
        onClick={(e) => {
          onSelectNode(wfNode.id, e.shiftKey);
        }}
        style={{
          width: '100%',
          minHeight: `${NODE_HEIGHT}px`,
          padding: '9px 12px',
          textAlign: 'left',
          backgroundColor: bgStyle,
          borderRight: borderStyle,
          borderBottom: borderStyle,
          borderLeft: borderStyle,
          borderTop: `4px solid ${catMeta.accent}`,
          borderRadius: 'var(--radius-md)',
          cursor: 'grab',
          display: 'grid',
          gap: '3px',
          boxShadow: isSelected
            ? '0 0 0 3px var(--lavender), 0 6px 18px rgba(57, 36, 214, 0.14)'
            : '0 2px 8px rgba(23, 23, 43, 0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: catMeta.accent }}>
            {wfNode.type}
          </span>
          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
            {wfNode.onError?.mode === 'retry' && (
              <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--info)' }}>
                Retry {wfNode.onError.retry?.max ?? 3}x
              </span>
            )}
            {wfNode.onError?.mode === 'route' && (
              <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--warning)' }}>
                Err Branch
              </span>
            )}
            {isPinned && (
              <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--warning)' }}>
                PINNED
              </span>
            )}
          </div>
        </div>

        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
          {wfNode.name}
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
          {getNodeConfigPreview(wfNode)}
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

      {!isStop && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="main"
            style={{
              width: '10px',
              height: '10px',
              right: '-5px',
              backgroundColor: 'var(--brand)',
              border: '2px solid var(--surface)',
              opacity: showPorts ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          />
          <button
            type="button"
            className="nodrag nopan"
            aria-label={`Output port (${wfNode.id})`}
            title={`Connect or add node after ${wfNode.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleConnectingFrom(connectingFromNodeId === wfNode.id ? null : wfNode.id);
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
              backgroundColor:
                connectingFromNodeId === wfNode.id ? 'var(--brand)' : 'var(--surface)',
              color: connectingFromNodeId === wfNode.id ? '#FFFFFF' : 'var(--brand)',
              fontSize: '14px',
              fontWeight: 700,
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 5,
              boxShadow: '0 1px 4px rgba(23, 23, 43, 0.16)',
              opacity: showPorts ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          >
            +
          </button>

          {connectingFromNodeId === wfNode.id && (
            <div
              role="region"
              aria-label="Quick connect next node"
              className="nodrag nopan"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: `${NODE_WIDTH + 14}px`,
                top: '0px',
                width: '214px',
                padding: '8px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--lavender-border)',
                backgroundColor: 'var(--surface)',
                boxShadow: 'var(--shadow-card)',
                display: 'grid',
                gap: '5px',
                zIndex: 20,
                fontSize: '11.5px',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--brand)' }}>
                Add &amp; Connect Next Node
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                Drag from handle, click a left + port, or quick-add:
              </div>
              {nodeCatalog
                .filter((item) => !item.type.startsWith('trigger.'))
                .slice(0, 6)
                .map((item) => (
                  <button
                    key={`qc-${wfNode.id}-${item.type}`}
                    type="button"
                    onClick={() => {
                      onQuickAddNode(
                        item,
                        { x: wfNode.position.x + 270, y: wfNode.position.y },
                        wfNode.id,
                      );
                      onToggleConnectingFrom(null);
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
});

interface WorkflowFlowEdgeData extends Record<string, unknown> {
  onRemoveEdge: (edgeId: string) => void;
}

const WorkflowFlowEdge = memo(function WorkflowFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  selected,
  data,
}: EdgeProps<Edge<WorkflowFlowEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={{
          ...style,
          stroke: selected ? '#D92D20' : style?.stroke,
          strokeWidth: selected ? 3 : (style?.strokeWidth ?? 2),
        }}
      />
      {(selected || Boolean(label)) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              zIndex: 15,
            }}
          >
            {label && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#3924D6',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '9999px',
                  padding: '1px 6px',
                }}
              >
                {String(label)}
              </span>
            )}
            {selected && (
              <button
                type="button"
                aria-label={`Disconnect edge ${id}`}
                title="Disconnect arrow from node (or press Delete)"
                onClick={(e) => {
                  e.stopPropagation();
                  data?.onRemoveEdge(id);
                }}
                style={{
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  border: '1px solid #FDA29B',
                  backgroundColor: '#FEF3F2',
                  color: '#B42318',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(16, 24, 40, 0.16)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>Disconnect</span>
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = {
  workflowNode: WorkflowFlowNode,
};

const edgeTypes = {
  workflowEdge: WorkflowFlowEdge,
};

export interface ReactFlowCanvasProps {
  nodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
  nodeCatalog: WorkflowNodeDescriptorDto[];
  pinnedData: Record<string, unknown[]>;
  selectedNodeId: string | null;
  multiSelectedIds: string[];
  connectingFromNodeId: string | null;
  hoveredNodeId: string | null;
  issueCountsByNode: Map<string, { errors: number; warnings: number }>;
  executionOverlay: NodeExecutionOverlay | null;
  showMinimap: boolean;
  notes: Array<{ id: string; text: string; position?: { x: number; y: number } }>;
  canvasHeight: string;
  fitViewTrigger: number;
  totalNodeCount?: number;
  onSelectNode: (nodeId: string, shiftKey: boolean) => void;
  onHoverNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, pos: { x: number; y: number }, dragging: boolean) => void;
  onConnectNodes: (fromId: string, toId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onToggleConnectingFrom: (nodeId: string | null) => void;
  onQuickAddNode: (
    desc: WorkflowNodeDescriptorDto,
    position: { x: number; y: number },
    connectFromId: string,
  ) => void;
  onDropNodeType: (nodeType: string, position: { x: number; y: number }) => void;
  onUpdateStickyNote: (noteId: string, text: string) => void;
  onRemoveStickyNote: (noteId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDisconnectNodeEdges?: (nodeId: string) => void;
  onTogglePinNode?: (nodeId: string) => void;
  onInspectNode?: (nodeId: string) => void;
  onTestFromNode?: (nodeId: string) => void;
}

function ReactFlowCanvasInner({
  nodes: wfNodes,
  edges: wfEdges,
  nodeCatalog,
  pinnedData,
  selectedNodeId,
  multiSelectedIds,
  connectingFromNodeId,
  hoveredNodeId,
  issueCountsByNode,
  executionOverlay,
  showMinimap,
  notes,
  canvasHeight,
  fitViewTrigger,
  totalNodeCount,
  onSelectNode,
  onHoverNode,
  onMoveNode,
  onConnectNodes,
  onRemoveEdge,
  onToggleConnectingFrom,
  onQuickAddNode,
  onDropNodeType,
  onUpdateStickyNote,
  onRemoveStickyNote,
  onDuplicateNode,
  onDeleteNode,
  onDisconnectNodeEdges,
  onTogglePinNode,
  onInspectNode,
  onTestFromNode,
}: ReactFlowCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const edgeReconnectSuccessful = useRef(true);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);

  const callbacksRef = useRef({
    onSelectNode,
    onHoverNode,
    onToggleConnectingFrom,
    onConnectNodes,
    onQuickAddNode,
    onRemoveEdge,
  });
  callbacksRef.current = {
    onSelectNode,
    onHoverNode,
    onToggleConnectingFrom,
    onConnectNodes,
    onQuickAddNode,
    onRemoveEdge,
  };

  const stableOnSelectNode = useCallback(
    (nodeId: string, shiftKey: boolean) => callbacksRef.current.onSelectNode(nodeId, shiftKey),
    [],
  );
  const stableOnHoverNode = useCallback(
    (nodeId: string | null) => callbacksRef.current.onHoverNode(nodeId),
    [],
  );
  const stableOnToggleConnectingFrom = useCallback(
    (nodeId: string | null) => callbacksRef.current.onToggleConnectingFrom(nodeId),
    [],
  );
  const stableOnConnectNodes = useCallback(
    (fromId: string, toId: string) => callbacksRef.current.onConnectNodes(fromId, toId),
    [],
  );
  const stableOnQuickAddNode = useCallback(
    (
      desc: WorkflowNodeDescriptorDto,
      position: { x: number; y: number },
      connectFromId: string,
    ) => callbacksRef.current.onQuickAddNode(desc, position, connectFromId),
    [],
  );
  const stableOnRemoveEdge = useCallback(
    (edgeId: string) => callbacksRef.current.onRemoveEdge(edgeId),
    [],
  );

  useEffect(() => {
    if (selectedEdgeId && !wfEdges.some((e) => e.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [wfEdges, selectedEdgeId]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextMenu]);

  useEffect(() => {
    if (fitViewTrigger > 0) {
      void fitView({ padding: 0.18, duration: 200 });
    }
  }, [fitViewTrigger, fitView]);

  const rfNodes = useMemo<Array<Node<WorkflowFlowNodeData>>>(
    () =>
      wfNodes.map((wfNode) => ({
        id: wfNode.id,
        type: 'workflowNode',
        position: wfNode.position,
        selected: wfNode.id === selectedNodeId,
        data: {
          wfNode,
          isSelected: wfNode.id === selectedNodeId,
          isMultiSelected: multiSelectedIds.includes(wfNode.id),
          isPinned: Array.isArray(pinnedData[wfNode.id]),
          isHovered: hoveredNodeId === wfNode.id,
          connectingFromNodeId,
          errorsCount: issueCountsByNode.get(wfNode.id)?.errors ?? 0,
          overlay: executionOverlay?.[wfNode.id],
          nodeCatalog,
          onSelectNode: stableOnSelectNode,
          onHoverNode: stableOnHoverNode,
          onToggleConnectingFrom: stableOnToggleConnectingFrom,
          onConnectNodes: stableOnConnectNodes,
          onQuickAddNode: stableOnQuickAddNode,
        },
      })),
    [
      wfNodes,
      selectedNodeId,
      multiSelectedIds,
      pinnedData,
      hoveredNodeId,
      connectingFromNodeId,
      issueCountsByNode,
      executionOverlay,
      nodeCatalog,
      stableOnSelectNode,
      stableOnHoverNode,
      stableOnToggleConnectingFrom,
      stableOnConnectNodes,
      stableOnQuickAddNode,
    ],
  );

  const isLargeGraph = (totalNodeCount ?? wfNodes.length) > 40;

  const rfEdges = useMemo<Array<Edge<WorkflowFlowEdgeData>>>(
    () =>
      wfEdges.map((edge) => {
        const edgeOverlay = executionOverlay?.[edge.from.node];
        const strokeColor =
          edgeOverlay?.status === 'succeeded'
            ? '#12B76A'
            : edgeOverlay?.status === 'failed'
              ? '#D92D20'
              : '#3924D6';
        return {
          id: edge.id,
          source: edge.from.node,
          target: edge.to.node,
          type: isLargeGraph ? 'default' : 'workflowEdge',
          selected: edge.id === selectedEdgeId,
          reconnectable: !isLargeGraph,
          animated: edgeOverlay?.status === 'succeeded',
          label: edge.from.port !== 'main' ? edge.from.port : undefined,
          labelStyle: { fontSize: 10, fontWeight: 700, fill: '#3924D6' },
          style: { stroke: strokeColor, strokeWidth: edgeOverlay ? 2.6 : 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: edge.id === selectedEdgeId ? '#D92D20' : strokeColor,
          },
          data: { onRemoveEdge: stableOnRemoveEdge },
        };
      }),
    [wfEdges, executionOverlay, selectedEdgeId, isLargeGraph, stableOnRemoveEdge],
  );

  const handleNodesChange = useCallback<OnNodesChange<Node<WorkflowFlowNodeData>>>(
    (changes) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          onMoveNode(
            ch.id,
            { x: Math.round(ch.position.x), y: Math.round(ch.position.y) },
            Boolean(ch.dragging),
          );
        }
      }
    },
    [onMoveNode],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target && conn.source !== conn.target) {
        onConnectNodes(conn.source, conn.target);
      }
    },
    [onConnectNodes],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        onRemoveEdge(e.id);
      }
    },
    [onRemoveEdge],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const nodeType =
        e.dataTransfer?.getData('application/x-elshad-node') ||
        e.dataTransfer?.getData('text/plain');
      if (!nodeType) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onDropNodeType(nodeType, {
        x: Math.round(pos.x),
        y: Math.round(pos.y),
      });
    },
    [screenToFlowPosition, onDropNodeType],
  );

  const handleReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnectSuccessful.current = true;
      if (
        newConnection.source &&
        newConnection.target &&
        newConnection.source !== newConnection.target
      ) {
        onRemoveEdge(oldEdge.id);
        onConnectNodes(newConnection.source, newConnection.target);
      }
    },
    [onRemoveEdge, onConnectNodes],
  );

  const handleReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: Edge,
      _handleType: 'source' | 'target',
      connectionState: FinalConnectionState,
    ) => {
      if (!edgeReconnectSuccessful.current && !connectionState.isValid) {
        onRemoveEdge(edge.id);
      }
      edgeReconnectSuccessful.current = true;
    },
    [onRemoveEdge],
  );

  const handleEdgeClick = useCallback((_e: unknown, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setContextMenu(null);
  }, []);

  const handleNodeClick = useCallback(() => {
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEdgeId(null);
    setContextMenu(null);
    callbacksRef.current.onToggleConnectingFrom(null);
  }, []);

  const handleMoveStart = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleNodeContextMenu = useCallback((e: ReactMouseEvent, node: Node) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect
      ? Math.min(Math.max(8, e.clientX - rect.left), Math.max(8, rect.width - 228))
      : 120;
    const y = rect
      ? Math.min(Math.max(8, e.clientY - rect.top), Math.max(8, rect.height - 280))
      : 120;
    callbacksRef.current.onSelectNode(node.id, false);
    setSelectedEdgeId(null);
    setContextMenu({ nodeId: node.id, x, y });
  }, []);

  const contextMenuNode = contextMenu
    ? wfNodes.find((n) => n.id === contextMenu.nodeId) ?? null
    : null;
  const contextMenuEdgeCount = contextMenuNode
    ? wfEdges.filter(
        (e) => e.from.node === contextMenuNode.id || e.to.node === contextMenuNode.id,
      ).length
    : 0;
  const contextMenuPinned = contextMenuNode
    ? Array.isArray(pinnedData[contextMenuNode.id])
    : false;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: canvasHeight,
        backgroundColor: 'var(--bg, #F6F7FB)',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onEdgeClick={handleEdgeClick}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onMoveStart={handleMoveStart}
        onNodeContextMenu={handleNodeContextMenu}
        edgesReconnectable={!isLargeGraph}
        reconnectRadius={24}
        onReconnectStart={handleReconnectStart}
        onReconnect={handleReconnect}
        onReconnectEnd={handleReconnectEnd}
        snapToGrid
        snapGrid={SNAP_GRID}
        nodesDraggable={typeof navigator === 'undefined' || !navigator.userAgent.includes('jsdom')}
        panOnDrag={typeof navigator === 'undefined' || !navigator.userAgent.includes('jsdom')}
        fitView={!isLargeGraph}
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.25}
        maxZoom={2}
        deleteKeyCode={DELETE_KEY_CODE}
        proOptions={PRO_OPTIONS}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--border-strong)" />
        <Controls showInteractive={false} showFitView={false} />
        {showMinimap && !isLargeGraph && (
          <MiniMap
            zoomable
            pannable
            nodeColor={(n) => (n.id === selectedNodeId ? '#3924D6' : '#CBD5E1')}
          />
        )}
      </ReactFlow>

      {/* Edge count hook for tests & screen readers */}
      <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
        {wfEdges.map((edge) => (
          <span key={`edge-marker-${edge.id}`} data-testid="canvas-edge">
            {edge.from.node}→{edge.to.node}
          </span>
        ))}
      </div>

      {/* Node Right-Click Context Menu */}
      {contextMenu && contextMenuNode && (
        <div
          role="menu"
          aria-label={`Node actions for ${contextMenuNode.name}`}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            width: '216px',
            padding: '6px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-strong)',
            backgroundColor: 'var(--surface)',
            boxShadow: '0 10px 24px rgba(16, 24, 40, 0.16)',
            display: 'grid',
            gap: '2px',
            zIndex: 30,
            fontSize: '12px',
          }}
        >
          <div
            style={{
              padding: '4px 8px 6px',
              borderBottom: '1px solid var(--border)',
              marginBottom: '2px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <strong
              style={{
                fontSize: '11.5px',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {contextMenuNode.name}
            </strong>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
              {contextMenuNode.type}
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onInspectNode?.(contextMenuNode.id);
              setContextMenu(null);
            }}
            style={contextMenuItemStyle(false)}
          >
            <span>Configure node</span>
          </button>

          {contextMenuNode.type !== 'control.stop' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleConnectingFrom(contextMenuNode.id);
                setContextMenu(null);
              }}
              style={contextMenuItemStyle(false)}
            >
              <span>Connect next node (+)</span>
            </button>
          )}

          {onTestFromNode && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onTestFromNode(contextMenuNode.id);
                setContextMenu(null);
              }}
              style={contextMenuItemStyle(false)}
            >
              <span>Test from here</span>
            </button>
          )}

          {onDuplicateNode && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDuplicateNode(contextMenuNode.id);
                setContextMenu(null);
              }}
              style={contextMenuItemStyle(false)}
            >
              <span>Duplicate node</span>
            </button>
          )}

          {onTogglePinNode && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onTogglePinNode(contextMenuNode.id);
                setContextMenu(null);
              }}
              style={contextMenuItemStyle(false)}
            >
              <span>{contextMenuPinned ? 'Unpin output' : 'Pin sample output'}</span>
            </button>
          )}

          {onDisconnectNodeEdges && (
            <button
              type="button"
              role="menuitem"
              disabled={contextMenuEdgeCount === 0}
              onClick={() => {
                onDisconnectNodeEdges(contextMenuNode.id);
                setContextMenu(null);
              }}
              style={contextMenuItemStyle(false, contextMenuEdgeCount === 0)}
            >
              <span>Disconnect arrows ({contextMenuEdgeCount})</span>
            </button>
          )}

          {onDeleteNode && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: '2px', paddingTop: '2px' }}>
              <button
                type="button"
                role="menuitem"
                disabled={wfNodes.length <= 1}
                onClick={() => {
                  onDeleteNode(contextMenuNode.id);
                  setContextMenu(null);
                }}
                style={contextMenuItemStyle(true, wfNodes.length <= 1)}
              >
                <span>Delete node</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky Notes overlay */}
      {notes.map((note, idx) => (
        <div
          key={note.id}
          style={{
            position: 'absolute',
            left: `${note.position?.x ?? 24 + idx * 20}px`,
            bottom: '14px',
            width: '210px',
            padding: '8px',
            backgroundColor: '#FEF3C7',
            border: '1px solid #F59E0B',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
            color: '#17172B',
            display: 'grid',
            gap: '4px',
            zIndex: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 700 }}>
            <span>STICKY NOTE</span>
            <button
              type="button"
              aria-label="Remove sticky note"
              onClick={() => onRemoveStickyNote(note.id)}
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
            onChange={(e) => onUpdateStickyNote(note.id, e.target.value)}
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
    </div>
  );
}

function contextMenuItemStyle(danger: boolean, disabled = false) {
  return {
    width: '100%',
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    backgroundColor: 'transparent',
    color: disabled
      ? 'var(--text-muted, #94A3B8)'
      : danger
        ? '#B42318'
        : 'var(--text-primary)',
    fontWeight: 600,
    fontSize: '12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };
}

export function ReactFlowCanvas(props: ReactFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <ReactFlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
