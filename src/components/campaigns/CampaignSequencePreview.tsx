import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesInitialized,
  useReactFlow,
  type NodeProps,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowRightLeft,
  Bot,
  Brain,
  Calendar,
  Clock,
  CornerDownLeft,
  Eye,
  FileText,
  Flag,
  GitBranch,
  Heart,
  Instagram,
  Linkedin,
  ListPlus,
  Mail,
  MailCheck,
  MailPlus,
  MessageCircle,
  MessageSquare,
  MessageSquareReply,
  PhoneCall,
  Play,
  Search,
  Send,
  Sparkles,
  Target,
  ThumbsUp,
  UserCheck,
  UserPlus,
  Zap,
  ArrowUpRight,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { computeAutoLayout } from "@/lib/auto-layout";
import {
  NODE_TYPE_CONFIGS,
  getNodeSourceHandles,
  type SequenceNode,
  type SequenceEdge,
  type SequenceNodeType,
} from "@/lib/sequence-utils";

const NODE_ICONS: Record<string, LucideIcon> = {
  ArrowRightLeft,
  Bot,
  Brain,
  Calendar,
  Clock,
  CornerDownLeft,
  Eye,
  FileText,
  Flag,
  GitBranch,
  Heart,
  Instagram,
  Linkedin,
  ListPlus,
  Mail,
  MailCheck,
  MailPlus,
  MessageCircle,
  MessageSquare,
  MessageSquareReply,
  PhoneCall,
  Play,
  Search,
  Send,
  Sparkles,
  Target,
  ThumbsUp,
  UserCheck,
  UserPlus,
  Zap,
};

const BRANCH_LABELS: Record<string, string> = {
  accepted: "Connected",
  notAccepted: "Not connected",
  replied: "Replied",
  noReply: "No reply",
  available: "Available",
  notAvailable: "Unavailable",
  hasWhatsapp: "On WhatsApp",
  noWhatsapp: "No WhatsApp",
  opened: "Opened",
  notOpened: "Not opened",
  clicked: "Clicked",
  notClicked: "Not clicked",
  enriched: "Email found",
  notEnriched: "No email",
  analyzed: "Analyzed",
  notAnalyzed: "Not analyzed",
  clean: "Valid email",
  risky: "Risky email",
  failed: "Invalid email",
  pass: "Meets threshold",
  fail: "Below threshold",
  open: "Open profile",
  notOpen: "Regular profile",
  closed: "Regular profile",
  linkedin: "LinkedIn",
  email: "Email",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  none: "No channel",
  default: "Continue",
};

function branchLabel(handle?: string | null) {
  if (!handle) return "Continue";
  return (
    BRANCH_LABELS[handle] ||
    handle.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")
  );
}

function nodeLabel(node: SequenceNode) {
  const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
  return (
    node.data?.customLabel || node.data?.label || config?.label || "Custom step"
  );
}

function stepContent(node: SequenceNode): {
  summary: string;
  content?: string;
  subject?: string;
  isPrompt?: boolean;
  variantCount?: number;
  missingConfiguration?: boolean;
} {
  const data = (node.data ?? {}) as {
    days?: number;
    hours?: number;
    minutes?: number;
    minScore?: number;
    threshold?: number;
    messageMode?: string;
    emailMode?: string;
    sequenceMode?: string;
    prompt?: string;
    emailPrompt?: string;
    message?: string;
    body?: string;
    emailBody?: string;
    commentTemplates?: string[];
    bodyTemplate?: string;
    subject?: string;
    emailSubject?: string;
    targetChannel?: string;
    sequenceName?: string;
    existingSequenceName?: string;
    listName?: string;
    targetNodeId?: string;
    emailCount?: number;
    scoreType?: string;
    promptVariations?: string[];
    messageVariations?: (string | { subject?: string; message?: string })[];
    bodyVariations?: string[];
    subjectVariations?: string[];
  };
  const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
  if (!node.data && config?.category !== "terminal")
    return {
      summary: "Step configuration is missing. Open the editor to review it.",
      missingConfiguration: true,
    };
  if (node.type === "delay") {
    const parts = [
      data.days && `${data.days} day${data.days === 1 ? "" : "s"}`,
      data.hours && `${data.hours} hour${data.hours === 1 ? "" : "s"}`,
      data.minutes && `${data.minutes} minute${data.minutes === 1 ? "" : "s"}`,
    ].filter(Boolean);
    return {
      summary: parts.length
        ? `Wait ${parts.join(", ")}`
        : "Continue without a delay",
    };
  }
  const isPrompt =
    node.type === "generateEmails" ||
    data.messageMode === "prompt" ||
    data.emailMode === "prompt" ||
    data.sequenceMode === "prompt";
  const baseContent = isPrompt
    ? data.prompt || data.emailPrompt
    : data.message ||
      data.body ||
      data.emailBody ||
      data.commentTemplates?.[0] ||
      data.bodyTemplate;
  const variants = (
    isPrompt
      ? data.promptVariations || []
      : [...(data.messageVariations || []), ...(data.bodyVariations || [])]
  ).filter((variant) =>
    typeof variant === "string" ? !!variant.trim() : !!variant?.message?.trim(),
  );
  const firstVariant = variants[0];
  const content = baseContent?.trim()
    ? baseContent
    : typeof firstVariant === "string"
      ? firstVariant
      : firstVariant?.message;
  const subject =
    data.subject ||
    data.emailSubject ||
    data.subjectVariations?.find((variation) => !!variation?.trim()) ||
    (typeof firstVariant === "object" ? firstVariant?.subject : undefined);
  const variantCount = (baseContent?.trim() ? 1 : 0) + variants.length;
  if (content)
    return {
      summary: isPrompt
        ? "Personalized with AI"
        : String(content)
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
      content: String(content),
      subject,
      isPrompt,
      variantCount,
    };
  if (node.type === "conditionIcpScore")
    return {
      summary: `Minimum ${data.scoreType === "dm" ? "decision-maker" : "ICP"} score: ${data.minScore ?? data.threshold ?? 0}`,
    };
  if (node.type === "switchChannel")
    return {
      summary: `Continue on ${data.targetChannel || "the selected channel"}`,
    };
  if (data.sequenceName) return { summary: data.sequenceName };
  if (data.existingSequenceName)
    return { summary: `Enroll in ${data.existingSequenceName}` };
  if (data.listName) return { summary: `Add to ${data.listName}` };
  if (node.type === "goTo")
    return {
      summary: data.targetNodeId
        ? "Jump to the configured target step"
        : "No jump target configured",
    };
  return {
    summary: config?.description || "Open the editor to configure this step",
  };
}

type PreviewNode = Node<
  {
    sequenceNode: SequenceNode;
    sourceHandles: string[];
    targetHandles: (string | null)[];
    disconnected: boolean;
  },
  "preview"
>;

const PreviewStep = memo(function PreviewStep({
  data,
  selected,
}: NodeProps<PreviewNode>) {
  const node = data.sequenceNode;
  const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
  const Icon = NODE_ICONS[config?.icon] || GitBranch;
  const isCondition = getNodeSourceHandles(node).length > 1;
  const content = stepContent(node);
  return (
    <div
      className={cn(
        "w-[260px] rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors",
        selected
          ? "border-violet-500 ring-2 ring-violet-500/15"
          : "border-border",
        data.disconnected && "border-dashed",
      )}
    >
      {data.targetHandles.map((handle) => (
        <Handle
          key={handle || "target"}
          id={handle || undefined}
          type="target"
          position={Position.Top}
          isConnectable={false}
          className="!h-2 !w-2 !border-background !bg-slate-400"
        />
      ))}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isCondition
              ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : node.type === "delay"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-5 break-words">
            {nodeLabel(node)}
          </p>
          <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
            {config?.channel === "any"
              ? config.category
              : config?.channel || "Step"}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
        {content.summary}
      </p>
      {data.disconnected && (
        <p className="mt-2 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          Not connected to the start
        </p>
      )}
      {data.sourceHandles.map((handle, index) => (
        <Handle
          key={handle}
          id={handle}
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          style={{
            left: `${((index + 1) / (data.sourceHandles.length + 1)) * 100}%`,
          }}
          className="!h-2 !w-2 !border-background !bg-slate-400"
        />
      ))}
    </div>
  );
});

const nodeTypes = { preview: PreviewStep };
const EMPTY_NODES: SequenceNode[] = [];
const EMPTY_EDGES: SequenceEdge[] = [];
const INITIAL_FIT_OPTIONS = { padding: 0.15, maxZoom: 0.85 };

function PreviewViewportReady({
  onReady,
}: {
  onReady: (ready: boolean) => void;
}) {
  const nodesInitialized = useNodesInitialized();
  const { viewportInitialized } = useReactFlow<PreviewNode, Edge>();
  useEffect(() => {
    onReady(nodesInitialized && viewportInitialized);
  }, [nodesInitialized, viewportInitialized, onReady]);
  return null;
}

function effectivePreviewEdges(
  nodes: SequenceNode[],
  edges: SequenceEdge[],
): SequenceEdge[] {
  const jumps = new Set(
    nodes.filter((node) => node.type === "goTo").map((node) => node.id),
  );
  // Go To execution follows targetNodeId, even when its stored visual edge is
  // missing or stale. Keep ordinary edges and draw only the effective jump.
  const effective = edges.filter((edge) => !jumps.has(edge.source));
  for (const node of nodes.filter((step) => step.type === "goTo")) {
    const targetId = (node.data as { targetNodeId?: string } | null)
      ?.targetNodeId;
    if (!targetId || !nodes.some((target) => target.id === targetId)) continue;
    const savedEdge = edges.find(
      (edge) => edge.source === node.id && edge.target === targetId,
    );
    effective.push(
      savedEdge || {
        id: `preview-jump-${node.id}-${targetId}`,
        source: node.id,
        target: targetId,
        sourceHandle: "default",
        label: "Jump to step",
      },
    );
  }
  return effective;
}

interface CampaignSequencePreviewProps {
  nodes: SequenceNode[];
  edges: SequenceEdge[];
  onEdit?: () => void;
}

export function CampaignSequencePreview({
  nodes: rawNodes,
  edges: rawEdges,
  onEdit,
}: CampaignSequencePreviewProps) {
  const nodes = rawNodes || EMPTY_NODES;
  const edges = rawEdges || EMPTY_EDGES;
  const flowRef = useRef<ReactFlowInstance<PreviewNode, Edge> | null>(null);
  const [graphReady, setGraphReady] = useState(false);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      nodes.find(
        (node) =>
          NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.category ===
          "action",
      )?.id ||
      nodes[0]?.id ||
      null,
  );
  const routingEdges = useMemo(
    () => effectivePreviewEdges(nodes, edges),
    [nodes, edges],
  );
  const orderedSteps = useMemo(() => {
    const visited = new Set<string>();
    const ordered: SequenceNode[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodes.find((step) => step.id === id);
      if (!node) return;
      ordered.push(node);
      routingEdges
        .filter((edge) => edge.source === id)
        .forEach((edge) => visit(edge.target));
    };
    const start = nodes.find((node) => node.type === "start");
    if (start) visit(start.id);
    nodes.forEach((node) => visit(node.id));
    return ordered;
  }, [nodes, routingEdges]);
  const { previewNodes, previewEdges } = useMemo(() => {
    const positions = computeAutoLayout(nodes, routingEdges);
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      routingEdges
        .filter((edge) => edge.source === id)
        .forEach((edge) => visit(edge.target));
    };
    const start = nodes.find((node) => node.type === "start");
    if (start) visit(start.id);
    const previewNodes: PreviewNode[] = nodes.map((node, index) => {
      const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
      const position = positions.get(node.id) ||
        node.position || { x: 0, y: index * 170 };
      const outgoingHandles = routingEdges
        .filter((edge) => edge.source === node.id)
        .map((edge) => edge.sourceHandle || "default");
      const targetHandles = [
        ...new Set(
          routingEdges
            .filter((edge) => edge.target === node.id)
            .map((edge) => edge.targetHandle || null),
        ),
      ];
      return {
        id: node.id,
        type: "preview",
        position: { x: position.x * 1.4, y: position.y * 1.6 },
        measured: measurements[node.id],
        data: {
          sequenceNode: node,
          sourceHandles: [
            ...new Set([...getNodeSourceHandles(node), ...outgoingHandles]),
          ],
          targetHandles: targetHandles.length
            ? targetHandles
            : config?.handles.target
              ? [null]
              : [],
          disconnected: !!start && !reachable.has(node.id),
        },
        selected: node.id === selectedId,
      };
    });
    const previewEdges: Edge[] = routingEdges.map((edge) => ({
      ...edge,
      type:
        nodes.find((node) => node.id === edge.source)?.type === "goTo"
          ? "default"
          : "smoothstep",
      sourceHandle: edge.sourceHandle || "default",
      label:
        edge.label ||
        (getNodeSourceHandles(nodes.find((node) => node.id === edge.source) ?? {}).length > 1
          ? branchLabel(edge.sourceHandle)
          : undefined),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#94a3b8",
        width: 16,
        height: 16,
      },
      style: {
        stroke: "#94a3b8",
        strokeWidth: 1.5,
        ...(nodes.find((node) => node.id === edge.source)?.type === "goTo"
          ? { strokeDasharray: "5 4" }
          : {}),
      },
      labelStyle: { fill: "#64748b", fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: "#f8fafc" },
      labelBgPadding: [8, 5],
      labelBgBorderRadius: 5,
    }));
    return { previewNodes, previewEdges };
  }, [nodes, routingEdges, selectedId, measurements]);
  const inspectStep = (id: string) => {
    if (!graphReady) return;
    setSelectedId(id);
    // Fit the graph's live measured node, rather than a recomputed prop position
    // with guessed dimensions. This also waits for React Flow's node internals
    // after selection/refetch updates, keeping the selected step inside the pane.
    void flowRef.current?.fitView({
      nodes: [{ id }],
      minZoom: 0.85,
      maxZoom: 0.85,
      padding: 0.2,
      duration: 0,
    });
  };
  const selected =
    nodes.find((node) => node.id === selectedId) ||
    nodes.find(
      (node) =>
        NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.category === "action",
    ) ||
    nodes[0];
  const content = selected ? stepContent(selected) : null;
  const selectedConfig = selected
    ? NODE_TYPE_CONFIGS[selected.type as SequenceNodeType]
    : null;
  const actionCount = nodes.filter(
    (node) =>
      NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.category === "action",
  ).length;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Campaign sequence</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {actionCount} action{actionCount === 1 ? "" : "s"} · Select a step
            to inspect its content and routing.
          </p>
        </div>
        {onEdit && (
          <Button variant="cta" size="sm" onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit sequence
          </Button>
        )}
      </div>
      {nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <label
            htmlFor="campaign-preview-step"
            className="text-xs font-medium text-muted-foreground"
          >
            Inspect step
          </label>
          <Select
            value={selected?.id}
            onValueChange={inspectStep}
            disabled={!graphReady}
          >
            <SelectTrigger
              id="campaign-preview-step"
              className="w-full sm:w-[320px]"
            >
              <SelectValue placeholder="Choose a step" />
            </SelectTrigger>
            <SelectContent>
              {orderedSteps.map((node, index) => (
                <SelectItem key={node.id} value={node.id}>
                  {index + 1}. {nodeLabel(node)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">
            {graphReady
              ? `${nodes.length} steps · Jump directly to any step`
              : "Preparing sequence…"}
          </span>
        </div>
      )}
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <GitBranch className="h-8 w-8 text-muted-foreground/50" />
          <div>
            <p className="font-medium">Build your first step</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add an action and define how contacts move through the campaign.
            </p>
          </div>
          {onEdit && (
            <Button variant="cta" onClick={onEdit}>
              Build sequence
            </Button>
          )}
        </div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div
            className="relative h-[460px] min-w-0 bg-muted/20 sm:h-[560px]"
            role="region"
            aria-label="Read-only campaign sequence graph"
          >
            <ReactFlow
              nodes={previewNodes}
              edges={previewEdges}
              nodeTypes={nodeTypes}
              onInit={(instance) => {
                flowRef.current = instance;
              }}
              fitView
              fitViewOptions={INITIAL_FIT_OPTIONS}
              onNodesChange={(changes) => {
                // Even a read-only controlled graph must retain measurements.
                // Otherwise selecting a node recreates it without bounds, so
                // readiness and node-specific viewport fitting cannot settle.
                setMeasurements((current) => {
                  let next = current;
                  for (const change of changes) {
                    if (change.type !== "dimensions" || !change.dimensions) continue;
                    const previous = current[change.id];
                    if (previous?.width === change.dimensions.width && previous?.height === change.dimensions.height) continue;
                    if (next === current) next = { ...current };
                    next[change.id] = change.dimensions;
                  }
                  return next;
                });
              }}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onSelectionChange={({ nodes: selectedNodes }) => {
                if (selectedNodes[0]) setSelectedId(selectedNodes[0].id);
              }}
              minZoom={0.06}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              panOnScroll={false}
              zoomOnScroll={false}
              preventScrolling={false}
              panOnDrag
              proOptions={{ hideAttribution: true }}
            >
              <PreviewViewportReady onReady={setGraphReady} />
              <Background gap={22} size={1} color="#cbd5e1" />
              <Controls
                showInteractive={false}
                className="!border-border !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-muted"
              />
            </ReactFlow>
          </div>
          <aside
            className="min-w-0 border-t bg-card p-5 lg:border-l lg:border-t-0"
            aria-label="Selected sequence step"
          >
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Step details
            </p>
            <h3 className="mt-3 break-words text-sm font-semibold">
              {selected && nodeLabel(selected)}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {selectedConfig?.channel === "any"
                  ? selectedConfig.category
                  : selectedConfig?.channel || "Step"}
              </Badge>
              {content?.isPrompt && (
                <Badge variant="outline" className="text-[10px]">
                  AI prompt
                </Badge>
              )}
              {(content?.variantCount || 0) > 1 && (
                <Badge variant="outline" className="text-[10px]">
                  {content?.variantCount} variants
                </Badge>
              )}
              {content?.missingConfiguration && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-amber-600 dark:text-amber-400"
                >
                  Needs configuration
                </Badge>
              )}
            </div>
            {content?.subject && (
              <div className="mt-5">
                <p className="text-xs font-medium text-muted-foreground">
                  Subject
                </p>
                <p className="mt-2 break-words text-sm">{content.subject}</p>
              </div>
            )}
            <div className="mt-5">
              <p className="text-xs font-medium text-muted-foreground">
                {content?.content
                  ? content.isPrompt
                    ? "Personalization instructions"
                    : "Message preview"
                  : "Behavior"}
              </p>
              <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs leading-6">
                {content?.content
                  ? content.content.replace(/<[^>]*>/g, " ")
                  : content?.summary}
              </div>
            </div>
            {selected && getNodeSourceHandles(selected).length > 1 && (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Outcome routes
                </p>
                {getNodeSourceHandles(selected).map((handle) => {
                  const route = routingEdges.find(
                    (edge) =>
                      edge.source === selected.id &&
                      (edge.sourceHandle || "default") === handle,
                  );
                  const target = nodes.find(
                    (node) => node.id === route?.target,
                  );
                  return (
                    <div key={handle} className="rounded-lg border px-3 py-2">
                      <p className="text-xs font-medium">
                        {branchLabel(handle)}
                      </p>
                      {target ? (
                        <button
                          type="button"
                          onClick={() => inspectStep(target.id)}
                          className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <span className="truncate">{nodeLabel(target)}</span>
                          <ArrowUpRight className="h-3 w-3 shrink-0" />
                        </button>
                      ) : (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          No route · contact exits here
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {selected?.type === "goTo" && (
              <div className="mt-5">
                <p className="text-xs font-medium text-muted-foreground">
                  Jump destination
                </p>
                {(() => {
                  const targetId =
                    (selected.data as { targetNodeId?: string } | null)
                      ?.targetNodeId ||
                    routingEdges.find((edge) => edge.source === selected.id)
                      ?.target;
                  const target = nodes.find((node) => node.id === targetId);
                  return target ? (
                    <button
                      type="button"
                      onClick={() => inspectStep(target.id)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {nodeLabel(target)}
                      <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </button>
                  ) : (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Choose a target step in the editor.
                    </p>
                  );
                })()}
              </div>
            )}
            <p className="mt-5 text-[11px] leading-5 text-muted-foreground">
              Drag the graph to explore branches. Use the zoom controls or step
              selector to inspect longer sequences.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
