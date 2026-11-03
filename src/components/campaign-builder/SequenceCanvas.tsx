import { campaignBranchLabel, campaignBranchTone } from "@/lib/campaign-node-preview";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Panel,
  useStore,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  useReactFlow,
  useNodesInitialized,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type OnConnectStart,
  type OnReconnect,
  type FinalConnectionState,
  type HandleType,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  // Terminal & Control
  StartNode,
  DelayNode,
  EndNode,
  // LinkedIn
  ConnectionRequestNode,
  MessageNode,
  InMailNode,
  ConditionConnectionNode,
  ConditionOpenProfileNode,
  ViewProfileNode,
  FollowNode,
  LikePostNode,
  WarmupEngagementNode,
  // Control
  ConditionReplyReceivedNode,
  ConditionIntentNode,
  SwitchChannelNode,
  ConditionChannelAvailableNode,
  RouteByChannelNode,
  GoToNode,
  // Multi-channel
  WhatsAppMessageNode,
  WhatsAppCheckNumberNode,
  InstagramDmNode,
  InstagramFollowNode,
  InstagramLikePostNode,
  TelegramMessageNode,
  SmsMessageNode,
  WhatsAppTemplateNode,
  ScheduleMeetingNode,
  // Integration/Handoff
  SendToSmartleadNode,
  SendToInstantlyNode,
  SendToLeadConnectorNode,
  SendToZapMailNode,
  // Enrichment
  FindEmailNode,
  AnalyzeContactNode,
  GenerateEmailsNode,
  ConditionEnrichedNode,
  ConditionAnalyzedNode,
  VerifyEmailNode,
  ConditionIcpScoreNode,
  AddToListNode,
  HandoffToAgentNode,
  // Email
  EmailNode,
  ConditionEmailOpenedNode,
  ConditionEmailClickedNode,
  // Notion
  CreateNotionPageNode,
  // Fallback
  UnknownNode,
} from "@/components/campaign-builder/nodes";
import { SequenceEdge } from "@/components/campaign-builder/edges/SequenceEdge";
import { NodeTypeMenuContent } from "@/components/campaign-builder/NodeTypeMenuContent";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Trash2, GitBranch, Minus, Plus, Scan, Map as MapIcon } from "lucide-react";
import { computeAutoLayout, animateToLayout } from "@/lib/auto-layout";
import { SequenceCanvasContext, type SequenceCanvasActions } from "@/components/campaign-builder/SequenceCanvasContext";
import { cn } from "@/lib/utils";
import type { NodeValidation } from "@/components/campaign-builder/nodes/BaseNode";
import { NODE_TYPE_CONFIGS, type SequenceNode, type SequenceEdge as SequenceEdgeType, type SequenceNodeType, type GoToNodeData } from "@/lib/sequence-utils";

// Define node types — uses a Proxy so that any unrecognised type (e.g. a
// deleted node type still stored in the DB) falls back to UnknownNode
// instead of crashing React Flow.
const _nodeTypes = {
  // Terminal
  start: StartNode,
  end: EndNode,

  // Control
  delay: DelayNode,
  conditionReplyReceived: ConditionReplyReceivedNode,
  conditionIntent: ConditionIntentNode,
  switchChannel: SwitchChannelNode,
  conditionChannelAvailable: ConditionChannelAvailableNode,
  routeByChannel: RouteByChannelNode,
  goTo: GoToNode as unknown as NodeTypes[string],

  // LinkedIn
  connectionRequest: ConnectionRequestNode,
  message: MessageNode,
  inmail: InMailNode,
  viewProfile: ViewProfileNode,
  follow: FollowNode,
  likePost: LikePostNode,
  warmupEngagement: WarmupEngagementNode,
  conditionConnection: ConditionConnectionNode,
  conditionOpenProfile: ConditionOpenProfileNode,

  // WhatsApp
  whatsappMessage: WhatsAppMessageNode,
  whatsappCheckNumber: WhatsAppCheckNumberNode,

  // Instagram
  instagramDm: InstagramDmNode,
  instagramFollow: InstagramFollowNode,
  instagramLikePost: InstagramLikePostNode,

  // Telegram
  telegramMessage: TelegramMessageNode,

  // SMS
  smsMessage: SmsMessageNode,

  // WhatsApp Business template
  whatsappTemplate: WhatsAppTemplateNode,

  // Calendar
  scheduleMeeting: ScheduleMeetingNode,

  // Email
  email: EmailNode,
  conditionEmailOpened: ConditionEmailOpenedNode,
  conditionEmailClicked: ConditionEmailClickedNode,

  // Integration/Handoff
  sendToSmartlead: SendToSmartleadNode,
  sendToInstantly: SendToInstantlyNode,
  sendToLeadConnector: SendToLeadConnectorNode,
  sendToZapMail: SendToZapMailNode,

  // Enrichment
  findEmail: FindEmailNode,
  analyzeContact: AnalyzeContactNode,
  generateEmails: GenerateEmailsNode,
  conditionEnriched: ConditionEnrichedNode,
  conditionAnalyzed: ConditionAnalyzedNode,
  verifyEmail: VerifyEmailNode,
  conditionIcpScore: ConditionIcpScoreNode,

  // Routing
  addToList: AddToListNode,

  // AI agent handoff
  handoffToAgent: HandoffToAgentNode,

  // Notion
  createNotionPage: CreateNotionPageNode,
};

const nodeTypes: NodeTypes = new Proxy(_nodeTypes, {
  get(target, prop, receiver) {
    if (typeof prop === "string" && !(prop in target)) {
      return UnknownNode;
    }
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as NodeTypes;

// Define edge types
const edgeTypes = {
  sequenceEdge: SequenceEdge,
} as unknown as EdgeTypes;

// Bottom padding keeps cards clear of the floating view toolbar.
const FIT_PADDING = { top: "40px", bottom: "80px", x: "48px" } as const;
const INITIAL_FIT_OPTIONS = { padding: FIT_PADDING, maxZoom: 0.85 };
const FULL_FIT_OPTIONS = { padding: FIT_PADDING, maxZoom: 1 };
// Below this zoom card text is unreadable, so the opening view and step focus
// never go under it; the fit button can still zoom out to see everything.
const MIN_READABLE_ZOOM = 0.55;
const OPENING_MIN_ZOOM = 0.75;
const READABLE_ZOOM = 0.85;
const VIEW_PADDING = 48;
const TOOLBAR_CLEARANCE = 80;
// A step inserted mid-sequence must pass leads on, so it needs an outcome.
const INSERT_EXCLUDED_TYPES = (Object.keys(NODE_TYPE_CONFIGS) as SequenceNodeType[])
  .filter(type => type === "goTo" || type === "start" || NODE_TYPE_CONFIGS[type].handles.source.length === 0);
const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 10, height: 10, color: "hsl(var(--muted-foreground) / 0.85)", strokeWidth: 1 };

interface SequenceCanvasProps {
  nodes: SequenceNode[];
  edges: SequenceEdgeType[];
  onNodesChange: (nodes: SequenceNode[]) => void;
  onEdgesChange: (edges: SequenceEdgeType[]) => void;
  onNodeSelect: (nodeId: string | null) => void;
  selectedNodeId: string | null;
  onAddNodeAtPosition?: (
    type: SequenceNodeType,
    position: { x: number; y: number },
    connectFrom?: { nodeId: string; handleId?: string },
  ) => void;
  onInsertNodeOnEdge?: (type: SequenceNodeType, edgeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDuplicateBranch?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  nodeValidation?: Map<string, NodeValidation>;
}

// Inner component that uses useReactFlow hook
function SequenceCanvasInner({
  nodes: initialNodes,
  edges: initialEdges,
  onNodesChange,
  onEdgesChange,
  onNodeSelect,
  selectedNodeId,
  onAddNodeAtPosition,
  onInsertNodeOnEdge,
  onDuplicateNode,
  onDuplicateBranch,
  onDeleteNode,
  nodeValidation,
}: SequenceCanvasProps) {
  const {
    fitView, screenToFlowPosition, viewportInitialized, getViewport, setViewport,
    setCenter, getNode, getNodesBounds, zoomIn, zoomOut, zoomTo,
  } = useReactFlow();
  const zoom = useStore(store => store.transform[2]);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [viewReady, setViewReady] = useState(false);
  const nodesInitialized = useNodesInitialized();
  const prevNodesLengthRef = useRef(initialNodes.length);
  const prevNodesIdsRef = useRef(initialNodes.map(n => n.id).join(','));
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const previousCanvasSizeRef = useRef(canvasSize);

  useEffect(() => {
    if (!reactFlowWrapper.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(reactFlowWrapper.current);
    return () => observer.disconnect();
  }, []);

  // Opening or closing a navigation pane should keep the viewed area centered.
  // Selected steps have their own focus behavior below; neither changes node data.
  useEffect(() => {
    const previous = previousCanvasSizeRef.current;
    previousCanvasSizeRef.current = canvasSize;
    if (!viewportInitialized || selectedNodeId || !previous.width || !previous.height
      || !canvasSize.width || !canvasSize.height) return;
    const dx = (canvasSize.width - previous.width) / 2;
    const dy = (canvasSize.height - previous.height) / 2;
    if (!dx && !dy) return;
    const viewport = getViewport();
    void setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
  }, [canvasSize, selectedNodeId, viewportInitialized, getViewport, setViewport]);

  // Guard to prevent syncing external prop updates back to the parent
  const isSyncingRef = useRef(false);
  const pendingPropagateNodesRef = useRef(false);
  const pendingPropagateEdgesRef = useRef(false);
  // When set, the next render will animate nodes to these target positions (single-node add/remove)
  const pendingAnimateLayoutRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  // Larger cards can overlap legacy saved coordinates. Presentation repairs
  // remain local until a real layout edit changes those saved coordinates.
  const presentationPositionsRef = useRef(new Map<string, {
    saved: { x: number; y: number };
    displayed: { x: number; y: number };
  }>());
  const initialCollisionCheckedRef = useRef(false);
  const presentationFitFrameRef = useRef<number | null>(null);

  // Connection drag state for drop-on-pane menu
  const connectStartRef = useRef<{ nodeId: string; handleId?: string } | null>(null);
  // Edge reconnection drag state
  const reconnectEdgeRef = useRef<{ edge: Edge; handleType: HandleType } | null>(null);
  // ReactFlow fires `onPaneClick` on mouse up; when we open the drop menu from `onConnectEnd`
  // or `onReconnectEnd`, we need to ignore that click so the menu doesn't instantly close.
  const ignoreNextPaneClickRef = useRef(false);
  const [dropMenu, setDropMenu] = useState<{
    x: number;
    y: number;
    flowPosition: { x: number; y: number };
    /** Set when the menu inserts a step on this connection. */
    insertEdgeId?: string;
  } | null>(null);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
    nodeType: string;
  } | null>(null);

  useEffect(() => {
    if (!dropMenu && !contextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDropMenu(null);
      setContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropMenu, contextMenu]);

  // Use a ref-based callback for edge deletion to avoid circular dependency with useEdgesState
  const deleteEdgeRef = useRef<(edgeId: string) => void>(() => {});
  const stableDeleteEdge = useCallback((edgeId: string) => {
    deleteEdgeRef.current(edgeId);
  }, []);

  // Build a set of GoTo node IDs for edge styling
  const goToNodeIds = useMemo(
    () => new Set(initialNodes.filter(n => n.type === 'goTo').map(n => n.id)),
    [initialNodes]
  );

  const mapEdgeWithData = useCallback(
    (e: SequenceEdgeType) => {
      const nodeLabel = (id: string) => {
        const node = initialNodes.find(node => node.id === id);
        return node?.data?.customLabel || node?.data?.label || (node?.type && NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label) || "step";
      };
      return {
      ...e,
      type: "sequenceEdge" as const,
      label: e.label || (goToNodeIds.has(e.source) ? "Go To" : e.sourceHandle && e.sourceHandle !== "default" ? campaignBranchLabel(e.sourceHandle) : undefined),
      ariaLabel: e.ariaLabel || `${campaignBranchLabel(e.sourceHandle)} connection from ${nodeLabel(e.source)} to ${nodeLabel(e.target)}`,
      markerEnd: EDGE_MARKER,
      data: { onDeleteEdge: stableDeleteEdge, isGoTo: goToNodeIds.has(e.source), outcomeTone: campaignBranchTone(e.sourceHandle) },
      };
    },
    [stableDeleteEdge, goToNodeIds, initialNodes]
  );

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes as unknown as Node[]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState<Edge>(
    initialEdges.map(mapEdgeWithData)
  );
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Opening view: show the whole sequence when it fits at a readable zoom,
  // otherwise start at the top of the sequence at a readable zoom.
  const showOverview = useCallback((duration = 0) => {
    const visible = nodesRef.current.filter(node => !node.hidden);
    const wrapper = reactFlowWrapper.current;
    if (!visible.length || !wrapper) return;
    const { width, height } = wrapper.getBoundingClientRect();
    if (!width || !height) return;
    const bounds = getNodesBounds(visible);
    const roomX = width - VIEW_PADDING * 2;
    const fitZoom = Math.min(roomX / bounds.width, (height - VIEW_PADDING - TOOLBAR_CLEARANCE) / bounds.height);
    if (fitZoom >= MIN_READABLE_ZOOM) {
      void fitView({ ...INITIAL_FIT_OPTIONS, duration });
      return;
    }
    const nextZoom = Math.min(READABLE_ZOOM, Math.max(OPENING_MIN_ZOOM, roomX / bounds.width));
    const start = visible.find(node => node.type === "start");
    const centerX = bounds.width * nextZoom <= roomX || !start
      ? bounds.x + bounds.width / 2
      : start.position.x + (start.measured?.width ?? 320) / 2;
    void setViewport({ x: width / 2 - centerX * nextZoom, y: VIEW_PADDING - bounds.y * nextZoom, zoom: nextZoom }, { duration });
  }, [fitView, getNodesBounds, setViewport]);

  // Bring a step into view without changing zoom, unless the canvas is
  // zoomed out too far to read it.
  const focusNode = useCallback((id: string, duration = 180) => {
    const node = getNode(id);
    const wrapper = reactFlowWrapper.current;
    if (!node || !wrapper) return;
    const { width, height } = wrapper.getBoundingClientRect();
    const viewport = getViewport();
    const nextZoom = viewport.zoom < MIN_READABLE_ZOOM ? READABLE_ZOOM : viewport.zoom;
    const nodeWidth = node.measured?.width ?? 320;
    const nodeHeight = node.measured?.height ?? 80;
    const left = node.position.x * nextZoom + viewport.x;
    const top = node.position.y * nextZoom + viewport.y;
    const margin = 32;
    if (nextZoom === viewport.zoom && left >= margin && top >= margin
      && left + nodeWidth * nextZoom <= width - margin && top + nodeHeight * nextZoom <= height - TOOLBAR_CLEARANCE) return;
    void setCenter(node.position.x + nodeWidth / 2, node.position.y + nodeHeight / 2, { zoom: nextZoom, duration });
  }, [getNode, getViewport, setCenter]);

  // Wire up the delete ref now that setEdges is available
  deleteEdgeRef.current = (edgeId: string) => {
    pendingPropagateEdgesRef.current = true;
    setEdges((eds) => {
      // If deleting a GoTo edge, clear the GoTo node's targetNodeId
      const deletedEdge = eds.find(e => e.id === edgeId);
      if (deletedEdge && goToNodeIds.has(deletedEdge.source)) {
        setNodes(nds => nds.map(n =>
          n.id === deletedEdge.source
            ? { ...n, data: { ...n.data, targetNodeId: undefined } }
            : n
        ));
        pendingPropagateNodesRef.current = true;
      }
      return eds.filter((e) => e.id !== edgeId);
    });
  };

  // Track internal changes and propagate to parent in an effect (never during render).
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeInternal>[0]) => {
      onNodesChangeInternal(changes);
      if (isSyncingRef.current) return;
      // Dimensions and selection belong to the canvas. Persisting them makes a
      // measured node look like a campaign edit and can erase fresh field data.
      if (changes.some(change => change.type !== 'dimensions' && change.type !== 'select')) {
        pendingPropagateNodesRef.current = true;
      }
    },
    [onNodesChangeInternal]
  );

  // Track internal changes and propagate to parent in an effect (never during render).
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChangeInternal>[0]) => {
      onEdgesChangeInternal(changes);
      if (isSyncingRef.current) return;
      if (changes.some(change => change.type !== 'select')) pendingPropagateEdgesRef.current = true;
    },
    [onEdgesChangeInternal]
  );

  // Handle new connections
  const onConnect = useCallback(
    (connection: Connection) => {
      const isGoToSource = goToNodeIds.has(connection.source || "");

      const newEdge = {
        ...connection,
        id: `edge-${connection.source}-${connection.target}-${connection.sourceHandle || "default"}`,
        type: "sequenceEdge" as const,
        markerEnd: EDGE_MARKER,
        label: isGoToSource ? "Go To" : connection.sourceHandle && connection.sourceHandle !== "default"
          ? campaignBranchLabel(connection.sourceHandle) : undefined,
        data: { onDeleteEdge: stableDeleteEdge, isGoTo: isGoToSource, outcomeTone: campaignBranchTone(connection.sourceHandle) },
      };

      pendingPropagateEdgesRef.current = true;
      setEdges((eds) => {
        // GoTo nodes can only have one outgoing edge — remove any existing one
        const filtered = isGoToSource
          ? eds.filter(e => e.source !== connection.source)
          : eds;
        return addEdge<Edge>(newEdge, filtered);
      });

      // Sync GoTo node data with the edge target
      if (isGoToSource && connection.target) {
        setNodes(nds => nds.map(n =>
          n.id === connection.source
            ? { ...n, data: { ...n.data, targetNodeId: connection.target } }
            : n
        ));
        pendingPropagateNodesRef.current = true;
      }
    },
    [setEdges, setNodes, goToNodeIds, stableDeleteEdge]
  );

  // Track connection drag start
  const onConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectStartRef.current = {
      nodeId: params.nodeId || "",
      handleId: params.handleId || undefined,
    };
  }, []);

  // When connection drag ends on empty space, show action menu
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (!onAddNodeAtPosition) return;

      // Prefer the connection state (more reliable than `onConnectStart` in practice).
      if (connectionState.fromNode) {
        connectStartRef.current = {
          nodeId: connectionState.fromNode.id,
          handleId: connectionState.fromHandle?.id || undefined,
        };
      }

      // Only show the menu when the user didn't complete a valid connection.
      // `toNode` can remain set from the last hover target even if the user releases on the pane,
      // so `isValid` is the reliable signal here.
      if (!connectStartRef.current || connectionState.isValid) return;

      // Get screen coordinates
      let clientX: number, clientY: number;
      if ("changedTouches" in event) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }

      // Convert screen position to flow position for placing the node
      const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });

      ignoreNextPaneClickRef.current = true;
      setDropMenu({
        x: clientX,
        y: clientY,
        flowPosition,
      });
    },
    [onAddNodeAtPosition, screenToFlowPosition]
  );

  // Track edge reconnection drag start
  const onReconnectStart = useCallback(
    (_event: React.MouseEvent, edge: Edge, handleType: HandleType) => {
      reconnectEdgeRef.current = { edge, handleType };
    },
    []
  );

  // Handle valid edge reconnection (dropped on a node handle)
  const onReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      reconnectEdgeRef.current = null;
      pendingPropagateEdgesRef.current = true;
      const isGoToEdge = goToNodeIds.has(oldEdge.source);
      setEdges((eds) => {
        return reconnectEdge(oldEdge, newConnection, eds) as typeof eds;
      });
      // Sync GoTo targetNodeId when edge is reconnected to a different node
      if (isGoToEdge && newConnection.target) {
        setNodes(nds => nds.map(n =>
          n.id === oldEdge.source
            ? { ...n, data: { ...n.data, targetNodeId: newConnection.target } }
            : n
        ));
        pendingPropagateNodesRef.current = true;
      }
    },
    [setEdges, setNodes, goToNodeIds]
  );

  // When edge reconnection drag ends on empty space, show action menu
  const onReconnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, _edge: Edge, handleType: HandleType, connectionState: FinalConnectionState) => {
      const reconnectInfo = reconnectEdgeRef.current;
      reconnectEdgeRef.current = null;

      // Only show menu if dropped on empty pane (no target node)
      if (!onAddNodeAtPosition || !reconnectInfo || connectionState.isValid) return;

      // Get screen coordinates
      let clientX: number, clientY: number;
      if ("changedTouches" in event) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }

      const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });

      // Determine the source node for the new connection
      // If dragging the target handle, the source stays the same
      // If dragging the source handle, the target becomes the "source" for the new node
      const sourceNodeId = handleType === "target"
        ? reconnectInfo.edge.source
        : reconnectInfo.edge.target;
      const sourceHandleId = handleType === "target"
        ? reconnectInfo.edge.sourceHandle || undefined
        : undefined;

      connectStartRef.current = {
        nodeId: sourceNodeId,
        handleId: sourceHandleId,
      };

      ignoreNextPaneClickRef.current = true;
      setDropMenu({
        x: clientX,
        y: clientY,
        flowPosition,
      });
    },
    [onAddNodeAtPosition, screenToFlowPosition]
  );

  // Handle selecting a node type from the drop menu
  const handleDropMenuSelect = useCallback(
    (type: SequenceNodeType) => {
      if (dropMenu?.insertEdgeId) {
        onInsertNodeOnEdge?.(type, dropMenu.insertEdgeId);
        setDropMenu(null);
        return;
      }
      if (!dropMenu || !onAddNodeAtPosition || !connectStartRef.current) return;

      onAddNodeAtPosition(type, dropMenu.flowPosition, {
        nodeId: connectStartRef.current.nodeId,
        handleId: connectStartRef.current.handleId,
      });

      setDropMenu(null);
      connectStartRef.current = null;
    },
    [dropMenu, onAddNodeAtPosition, onInsertNodeOnEdge]
  );

  // "+" buttons on cards and connections open the same step menu.
  const canvasActions = useMemo<SequenceCanvasActions | null>(() => onAddNodeAtPosition ? {
    openAddAfter: (from, anchor) => {
      const source = nodesRef.current.find(node => node.id === from.nodeId);
      connectStartRef.current = from;
      setContextMenu(null);
      setDropMenu({
        ...anchor,
        flowPosition: source ? { x: source.position.x, y: source.position.y + 150 } : screenToFlowPosition(anchor),
      });
    },
    openInsertOnEdge: onInsertNodeOnEdge ? (edgeId, anchor) => {
      connectStartRef.current = null;
      setContextMenu(null);
      setDropMenu({ ...anchor, flowPosition: screenToFlowPosition(anchor), insertEdgeId: edgeId });
    } : undefined,
  } : null, [onAddNodeAtPosition, onInsertNodeOnEdge, screenToFlowPosition]);

  // Handle node click
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      onNodeSelect(node.id);
      setContextMenu(null);
      setDropMenu(null);
    },
    [onNodeSelect]
  );

  // Handle pane click (deselect)
  const onPaneClick = useCallback(() => {
    if (ignoreNextPaneClickRef.current) {
      ignoreNextPaneClickRef.current = false;
      return;
    }
    onNodeSelect(null);
    setDropMenu(null);
    setContextMenu(null);
  }, [onNodeSelect]);

  // Handle right-click on node
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string; type?: string }) => {
      event.preventDefault();
      if (node.type === 'start') return;
      onNodeSelect(node.id);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        nodeType: node.type || '',
      });
    },
    [onNodeSelect]
  );

  // Update nodes when external changes happen (e.g., loading templates)
  // and trigger fitView when the node structure changes significantly
  useEffect(() => {
    const currentNodesIds = initialNodes.map(n => n.id).join(',');
    const prevIds = prevNodesIdsRef.current;
    const nodesChanged = currentNodesIds !== prevIds;

    // Inject validation data into node data for rendering.
    // Filter out connection-related validation messages entirely — they suffer
    // from async edge propagation timing (edges may exist in React Flow or the
    // parent but not yet in the other) causing persistent false positives.
    // The banner in Step4Sequence applies the same filter.
    //
    // IMPORTANT: Always strip stale __validation from nodes before re-injecting.
    // Without this, __validation from a prior render cycle leaks into the parent
    // state via the node propagation effect and persists even after the validation
    // map no longer contains an entry for that node.
    // Build lightweight node list for Go To sublabel display
    const allNodesRef = initialNodes.map(n => ({ id: n.id, type: n.type, data: { customLabel: n.data?.customLabel || n.data?.label } }));

    const nodesWithValidation = initialNodes.map(n => {
      const v = nodeValidation?.get(n.id);
      const runtimeData = n.data as SequenceNode['data'] & { __validation?: NodeValidation; __allNodes?: unknown };
      // Inject __allNodes into Go To nodes so they can resolve target labels
      const goToExtra = n.type === 'goTo' ? { __allNodes: allNodesRef } : {};
      if (!v) {
        // Strip stale __validation if present
        if (runtimeData?.__validation || n.type === 'goTo') {
          const { __validation: _, __allNodes: _a, ...cleanData } = runtimeData;
          return { ...n, data: { ...cleanData, ...goToExtra } };
        }
        return n;
      }
      const filteredWarnings = v.warnings.filter(w =>
        w !== 'Not connected to the sequence'
      );
      const filteredErrors = v.errors.filter(e =>
        e !== 'Must be connected to at least one action'
      );
      if (filteredErrors.length === 0 && filteredWarnings.length === 0) {
        // Strip stale __validation if present
        if (runtimeData?.__validation || n.type === 'goTo') {
          const { __validation: _, __allNodes: _a, ...cleanData } = runtimeData;
          return { ...n, data: { ...cleanData, ...goToExtra } };
        }
        return n;
      }
      return { ...n, data: { ...n.data, ...goToExtra, __validation: { errors: filteredErrors, warnings: filteredWarnings } } };
    });

    const measuredById = new Map(nodesRef.current.map(node => [node.id, node]));
    const mergedNodes = nodesWithValidation.map(node => {
      const measured = measuredById.get(node.id);
      const presentation = presentationPositionsRef.current.get(node.id);
      const unchangedSavedPosition = presentation
        && presentation.saved.x === node.position.x && presentation.saved.y === node.position.y;
      if (presentation && !unchangedSavedPosition) presentationPositionsRef.current.delete(node.id);
      return {
        ...node,
        data: { ...node.data },
        position: unchangedSavedPosition ? presentation.displayed : node.position,
        measured: measured?.measured || node.measured,
        width: measured?.width || node.width,
        height: measured?.height || node.height,
        selected: node.id === selectedNodeId,
      };
    });
    isSyncingRef.current = true;
    setNodes(mergedNodes);
    isSyncingRef.current = false;

    if (nodesChanged && initialNodes.length > 0) {
      // This is a user graph change, which has its own persisted layout below.
      initialCollisionCheckedRef.current = true;
      const prevIdSet = new Set(prevIds.split(',').filter(Boolean));
      const currentIdSet = new Set(currentNodesIds.split(',').filter(Boolean));
      const addedIds = [...currentIdSet].filter(id => !prevIdSet.has(id));
      const removedCount = [...prevIdSet].filter(id => !currentIdSet.has(id)).length;

      // Determine if this is a bulk change (template load, initial load) vs single node add/remove
      const isBulkChange = prevIdSet.size === 0 || addedIds.length > 1 || removedCount > 1 ||
        (addedIds.length + removedCount) > 2;

      prevNodesIdsRef.current = currentNodesIds;
      prevNodesLengthRef.current = initialNodes.length;

      const layoutEdges = initialEdges.map(({ data: _data, ...rest }) => rest) as SequenceEdgeType[];
      const targetPositions = computeAutoLayout(mergedNodes as SequenceNode[], layoutEdges);

      if (isBulkChange) {
        // Bulk change (initial load, template swap): apply layout instantly + fit view
        if (targetPositions.size > 0) {
          isSyncingRef.current = true;
          setNodes(prev => prev.map(node => {
            const target = targetPositions.get(node.id);
            return target ? { ...node, position: target } : node;
          }));
          isSyncingRef.current = false;
          // Propagate auto-layout positions to parent
          pendingPropagateNodesRef.current = true;
        }
        requestAnimationFrame(() => {
          setTimeout(() => {
            const selectedId = selectedNodeIdRef.current;
            if (selectedId) focusNode(selectedId, 200);
            else showOverview(200);
          }, 50);
        });
      } else if (targetPositions.size > 0) {
        // Single node add/remove: animate existing nodes to make room, no viewport pan
        pendingAnimateLayoutRef.current = targetPositions;
      }
    }
  }, [initialNodes, initialEdges, selectedNodeId, setNodes, focusNode, showOverview, nodeValidation]);

  useEffect(() => {
    isSyncingRef.current = true;
    setEdges(initialEdges.map(mapEdgeWithData));
    isSyncingRef.current = false;
  }, [initialEdges, setEdges, mapEdgeWithData]);

  // Propagate only position/selection changes from React Flow back to parent.
  // IMPORTANT: We must preserve the parent's `node.data` instead of using React Flow's
  // internal copy, because the parent may have updated node data (e.g. via variable
  // insertion in NodeConfigPanel) that React Flow doesn't know about. Sending back
  // React Flow's stale `data` would overwrite those changes.
  useEffect(() => {
    if (isSyncingRef.current) return;
    if (!pendingPropagateNodesRef.current) return;
    pendingPropagateNodesRef.current = false;

    const parentDataById = new Map(
      initialNodes.map(n => [n.id, n.data])
    );
    const merged = (nodes as SequenceNode[]).map(node => {
      const parentData = parentDataById.get(node.id);
      if (!parentData) return node;
      // For GoTo nodes, preserve targetNodeId from React Flow's internal state
      // since it gets updated by edge connect/delete handlers
      if (node.type === 'goTo') {
        return { ...node, data: { ...parentData, targetNodeId: (node.data as GoToNodeData).targetNodeId } };
      }
      return { ...node, data: parentData };
    });
    onNodesChange(merged);
  }, [nodes, onNodesChange, initialNodes]);

  useEffect(() => {
    if (isSyncingRef.current) return;
    if (!pendingPropagateEdgesRef.current) return;
    pendingPropagateEdgesRef.current = false;
    // Strip runtime-only edge data (functions) before persisting to the builder state.
    const sanitized = edges.map(({ data: _data, ...rest }) => rest) as SequenceEdgeType[];
    onEdgesChange(sanitized);
  }, [edges, onEdgesChange]);

  // Auto-layout: compute tree layout and animate nodes into place
  const isAnimatingRef = useRef(false);
  const cancelAnimationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (initialCollisionCheckedRef.current || !nodesInitialized || !viewportInitialized
      || isAnimatingRef.current || pendingPropagateNodesRef.current) return;
    const visibleNodes = nodes.filter(node => !node.hidden);
    if (visibleNodes.some(node => !node.measured?.width || !node.measured?.height)) return;
    // Let the first ResizeObserver measurements replace any legacy dimensions
    // supplied with the saved graph before checking the card geometry once.
    const timer = window.setTimeout(() => {
      if (initialCollisionCheckedRef.current || isAnimatingRef.current || pendingPropagateNodesRef.current) return;
      initialCollisionCheckedRef.current = true;
      // Steps cannot be dragged, so saved positions only ever come from an
      // older auto layout. Show today's layout (spacing changes, larger cards).
      const repaired = computeAutoLayout(nodes as SequenceNode[], initialEdges);
      const differs = visibleNodes.some(node => {
        const target = repaired.get(node.id);
        return target && (Math.abs(target.x - node.position.x) > 1 || Math.abs(target.y - node.position.y) > 1);
      });
      if (!differs) return;
      const savedById = new Map(initialNodes.map(node => [node.id, node.position]));
      for (const [id, displayed] of repaired) {
        const saved = savedById.get(id);
        if (saved) presentationPositionsRef.current.set(id, { saved: { ...saved }, displayed });
      }
      // Do not set pendingPropagateNodesRef: opening the editor is not a layout edit.
      setNodes(previous => previous.map(node => ({ ...node, position: repaired.get(node.id) || node.position })));
      presentationFitFrameRef.current = requestAnimationFrame(() => {
        presentationFitFrameRef.current = null;
        const selectedId = selectedNodeIdRef.current;
        if (selectedId) focusNode(selectedId, 0);
        else showOverview(0);
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [nodes, nodesInitialized, viewportInitialized, initialNodes, initialEdges, setNodes, focusNode, showOverview]);

  // First view once cards are measured. The canvas stays transparent until
  // then so it never flashes at React Flow's default 100% top-left viewport.
  useEffect(() => {
    if (viewReady || !nodesInitialized || !viewportInitialized) return;
    const frame = requestAnimationFrame(() => {
      const selectedId = selectedNodeIdRef.current;
      if (selectedId) focusNode(selectedId, 0);
      else showOverview(0);
      setViewReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [viewReady, nodesInitialized, viewportInitialized, focusNode, showOverview]);

  const selectedPosition = nodes.find(node => node.id === selectedNodeId)?.position;
  useEffect(() => {
    if (!selectedNodeId || !nodesInitialized || !viewportInitialized || isAnimatingRef.current) return;
    const frame = requestAnimationFrame(() => focusNode(selectedNodeId));
    return () => cancelAnimationFrame(frame);
  }, [selectedNodeId, selectedPosition?.x, selectedPosition?.y, nodesInitialized, viewportInitialized, canvasSize.width, canvasSize.height, focusNode]);

  const handleAutoLayout = useCallback(() => {
    if (isAnimatingRef.current) return;

    const targetPositions = computeAutoLayout(
      nodes as SequenceNode[],
      // Strip runtime data from edges for the layout computation
      edges.map(({ data: _data, ...rest }) => rest) as SequenceEdgeType[],
    );

    if (targetPositions.size === 0) return;

    isAnimatingRef.current = true;
    isSyncingRef.current = true; // Prevent parent sync during animation frames

    cancelAnimationRef.current = animateToLayout(
      nodes as SequenceNode[],
      targetPositions,
      setNodes,
      () => {
        isAnimatingRef.current = false;
        isSyncingRef.current = false;
        // Propagate final positions to parent
        pendingPropagateNodesRef.current = true;
        // Trigger propagation by updating nodes one more time with final positions
        setNodes(prev => prev.map(node => {
          const target = targetPositions.get(node.id);
          return target ? { ...node, position: target } : node;
        }));
        // Re-frame after layout settles
        setTimeout(() => showOverview(200), 50);
      },
    );
  }, [nodes, edges, setNodes, showOverview]);

  // Animate nodes into place after a single-node add/remove
  useEffect(() => {
    const targetPositions = pendingAnimateLayoutRef.current;
    if (!targetPositions || isAnimatingRef.current) return;
    pendingAnimateLayoutRef.current = null;

    isAnimatingRef.current = true;
    isSyncingRef.current = true;

    cancelAnimationRef.current = animateToLayout(
      nodes as SequenceNode[],
      targetPositions,
      setNodes,
      () => {
        isAnimatingRef.current = false;
        isSyncingRef.current = false;
        pendingPropagateNodesRef.current = true;
        setNodes(prev => prev.map(node => {
          const target = targetPositions.get(node.id);
          return target ? { ...node, position: target } : node;
        }));
      },
      200, // shorter animation for single-node changes
    );
  }, [nodes, edges, setNodes]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      cancelAnimationRef.current?.();
      if (presentationFitFrameRef.current !== null) cancelAnimationFrame(presentationFitFrameRef.current);
    };
  }, []);

  // Canvas shortcuts. Only while focus is on the canvas (or nowhere), so
  // typing in the step settings panel never deletes a step.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body && !reactFlowWrapper.current?.contains(target)) return;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "")) return;
      if (dropMenu || contextMenu) return;
      const mod = event.metaKey || event.ctrlKey;
      const selectedId = selectedNodeIdRef.current;
      const selectedType = selectedId ? nodesRef.current.find(node => node.id === selectedId)?.type : undefined;
      const editableStep = !!selectedId && selectedType !== "start";

      if ((event.key === "Delete" || event.key === "Backspace") && !mod) {
        if (editableStep && onDeleteNode) {
          event.preventDefault();
          onDeleteNode(selectedId!);
          onNodeSelect(null);
          return;
        }
        const selectedEdge = edgesRef.current.find(edge => edge.selected);
        if (selectedEdge) {
          event.preventDefault();
          stableDeleteEdge(selectedEdge.id);
        }
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "d" && editableStep && onDuplicateNode) {
        event.preventDefault();
        onDuplicateNode(selectedId!);
        return;
      }
      if (!mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        void fitView({ ...FULL_FIT_OPTIONS, duration: 200 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropMenu, contextMenu, onDeleteNode, onDuplicateNode, onNodeSelect, stableDeleteEdge, fitView]);

  const showAutoLayoutButton = useMemo(() => nodes.length > 1, [nodes.length]);
  const showEmptyHint = useMemo(() => nodes.length <= 1, [nodes.length]);

  return (
    <SequenceCanvasContext.Provider value={canvasActions}>
    <div ref={reactFlowWrapper} className={cn("h-full w-full relative transition-opacity duration-150", !viewReady && "opacity-0")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        edgesFocusable
        deleteKeyCode={null}
        minZoom={0.15}
        maxZoom={1.5}
        panOnScroll
        zoomOnScroll={false}
        preventScrolling
        defaultEdgeOptions={{
          type: "sequenceEdge",
          markerEnd: EDGE_MARKER,
        }}
        className="bg-[#faf8f2] dark:bg-background [&_.react-flow__edge:focus-visible_.react-flow__edge-path]:!stroke-amber-500"
      >
        <Background gap={16} size={1.4} color="hsl(var(--muted-foreground) / 0.32)" />
        <Panel position="bottom-center" className="!mb-4">
          <div className="flex items-center gap-0.5 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur" role="toolbar" aria-label="Canvas view">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void zoomOut({ duration: 150 })} title="Zoom out" aria-label="Zoom out">
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 min-w-[52px] px-1.5 text-xs font-medium tabular-nums text-muted-foreground" onClick={() => void zoomTo(1, { duration: 150 })} title="Reset to 100%" aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void zoomIn({ duration: 150 })} title="Zoom in" aria-label="Zoom in">
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void fitView({ ...FULL_FIT_OPTIONS, duration: 200 })} title="Fit whole sequence (F)" aria-label="Fit whole sequence">
              <Scan className="h-3.5 w-3.5" />
            </Button>
            {showAutoLayoutButton && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={handleAutoLayout} title="Arrange sequence steps">
                <Sparkles className="h-3.5 w-3.5" />
                Tidy up
              </Button>
            )}
            {canvasSize.width >= 600 && (
              <Button variant="ghost" size="icon" className={cn("h-7 w-7", showMiniMap && "bg-muted text-foreground")} onClick={() => setShowMiniMap(show => !show)}
                title={showMiniMap ? "Hide map" : "Show map"} aria-label={showMiniMap ? "Hide map" : "Show map"} aria-pressed={showMiniMap}>
                <MapIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </Panel>
        {showMiniMap && canvasSize.width >= 600 && <MiniMap
          position="bottom-right"
          pannable
          zoomable
          bgColor="hsl(var(--background))"
          nodeColor="hsl(var(--muted-foreground) / 0.55)"
          maskColor="hsl(var(--muted) / 0.65)"
          maskStrokeColor="hsl(var(--border))"
          style={{ width: 128, height: 96 }}
          className="!hidden overflow-hidden !bg-background border rounded-lg sm:!block"
        />}
      </ReactFlow>

      {/* Empty canvas guidance */}
      {showEmptyHint && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <div className="text-center text-muted-foreground/60 -mt-16">
            <p className="text-sm font-medium">Click + under Campaign Start to add your first step</p>
            <p className="text-xs mt-1">Or use the "Add step" button in the toolbar</p>
          </div>
        </div>
      )}

      {/* Drop-on-pane action menu */}
      {dropMenu && (
        <div
          className="fixed z-50"
          style={{ left: Math.max(8, Math.min(dropMenu.x, window.innerWidth - 224)), top: Math.max(8, Math.min(dropMenu.y, window.innerHeight - 336)) }}
        >
          <div className="w-52 p-1.5 max-h-80 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
            <NodeTypeMenuContent
              existingNodes={initialNodes}
              onAddNode={handleDropMenuSelect}
              excludeTypes={dropMenu.insertEdgeId ? INSERT_EXCLUDED_TYPES : undefined}
            />
          </div>
        </div>
      )}

      {/* Node right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-50"
          style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 192)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 144)) }}
        >
          <div className="w-44 p-1 rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
            {onDuplicateNode && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => {
                  onDuplicateNode(contextMenu.nodeId);
                  setContextMenu(null);
                }}
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </button>
            )}
            {onDuplicateBranch && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => {
                  onDuplicateBranch(contextMenu.nodeId);
                  setContextMenu(null);
                }}
              >
                <GitBranch className="h-4 w-4" />
                Duplicate Branch
              </button>
            )}
            {(onDuplicateNode || onDuplicateBranch) && onDeleteNode && (
              <div className="my-1 h-px bg-border" />
            )}
            {onDeleteNode && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 cursor-pointer"
                onClick={() => {
                  onDeleteNode(contextMenu.nodeId);
                  setContextMenu(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </SequenceCanvasContext.Provider>
  );
}

// Wrapper component with ReactFlowProvider
export function SequenceCanvas(props: SequenceCanvasProps) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <SequenceCanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
