import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { SequenceCanvas } from "@/components/campaign-builder/SequenceCanvas";
import { CampaignAudienceContext, CampaignEntryContext } from "@/components/campaign-builder/CampaignEntryContext";
import { useLeadLists } from "@/hooks/useLeadLists";
import { ActionMenu } from "@/components/campaign-builder/ActionMenu";
import { NodeConfigPanel } from "@/components/campaign-builder/NodeConfigPanel";
import { CampaignMessagePreviewContext } from "@/components/campaign-builder/CampaignMessagePreview";
import { Button } from "@/components/ui/button";
import { Copy, AlertCircle, AlertTriangle, ChevronDown, GitBranch, Maximize2, Minimize2, Undo2, MoreHorizontal, MessageSquare, PanelLeft } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { validateNode, NODE_TYPE_CONFIGS, getNodeSourceHandles } from "@/lib/sequence-utils";
import { NODE_ICONS } from "@/lib/node-menu-shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";
import type { SequenceNode, SequenceNodeType } from "@/lib/sequence-utils";
import type { NodeValidation } from "@/components/campaign-builder/nodes/BaseNode";

interface BannerItem {
  message: string;
  nodeId?: string;
  level: 'error' | 'warning';
}

interface BannerGroup {
  nodeId: string | null;
  nodeLabel: string;
  items: BannerItem[];
  errorCount: number;
  warningCount: number;
}

interface Step4SequenceProps {
  builder: CampaignBuilderReturn;
}

export function Step4Sequence({ builder }: Step4SequenceProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const { setOpen: setSidebarOpen } = useSidebar();
  const sidebarWasOpenRef = useRef(true);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      const next = !prev;
      if (next) {
        // Remember sidebar state, then collapse
        sidebarWasOpenRef.current = document.querySelector('[data-state="expanded"]') !== null;
        setSidebarOpen(false);
      } else {
        // Restore sidebar state
        if (sidebarWasOpenRef.current) setSidebarOpen(true);
      }
      return next;
    });
  }, [setSidebarOpen]);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
        if (sidebarWasOpenRef.current) setSidebarOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (sidebarWasOpenRef.current) setSidebarOpen(true);
    };
  }, [isFullscreen, setSidebarOpen]);

  // Ctrl+Z / Cmd+Z undo for sequence changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Don't intercept if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        builder.undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [builder]);

  const {
    state,
    setNodes,
    setEdges,
    addNode,
    addNodeAtPosition,
    updateNode,
    removeNode,
    duplicateNode,
    duplicateBranch,
    selectNode,
    selectedNode,
    validation,
    undo,
    canUndo,
  } = builder;

  const { leadLists } = useLeadLists();
  const audience = useMemo(
    () => leadLists
      .filter(list => state.leadListIds.includes(list.id))
      .map(list => ({ name: list.name, count: list.lead_count || 0 })),
    [leadLists, state.leadListIds],
  );

  const orderedNodes = useMemo(() => {
    const byId = new Map(state.sequenceNodes.map(node => [node.id, node]));
    const visited = new Set<string>();
    const ordered: SequenceNode[] = [];
    const visit = (id: string) => {
      const node = byId.get(id);
      if (!node || visited.has(id)) return;
      visited.add(id);
      ordered.push(node);
      if (node.type !== "goTo") {
        state.sequenceEdges.filter(edge => edge.source === id).forEach(edge => visit(edge.target));
      }
    };
    state.sequenceNodes.filter(node => node.type === "start").forEach(node => visit(node.id));
    state.sequenceNodes.forEach(node => visit(node.id));
    return ordered;
  }, [state.sequenceNodes, state.sequenceEdges]);

  const stepLabel = (node: typeof state.sequenceNodes[number]) =>
    node.data?.customLabel || node.data?.label || NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || "Custom step";

  // Compute per-node validation map, clickable banner items, and grouped data
  const { nodeValidationMap, bannerItems, bannerGroups, totalErrors, totalWarnings } = useMemo(() => {
    const map = new Map<string, NodeValidation>();
    const items: BannerItem[] = [];
    const groupMap = new Map<string, BannerGroup>();

    for (const node of state.sequenceNodes) {
      const result = validateNode(node, state.sequenceEdges);
      if (result.errors.length > 0 || result.warnings.length > 0) {
        // Filter connection-related messages — they are checked by the canvas
        // against React Flow's internal edge state (always up-to-date) and shown
        // as inline node badges. Including them in the banner causes false
        // positives due to async edge propagation timing.
        const filteredErrors = result.errors.filter(e => e !== 'Must be connected to at least one action');
        const filteredWarnings = result.warnings.filter(w => w !== 'Not connected to the sequence');
        if (filteredErrors.length === 0 && filteredWarnings.length === 0) continue;
        map.set(node.id, { errors: filteredErrors, warnings: filteredWarnings });
        const nodeLabel = NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type;

        // Ensure group exists
        if (!groupMap.has(node.id)) {
          groupMap.set(node.id, { nodeId: node.id, nodeLabel, items: [], errorCount: 0, warningCount: 0 });
        }
        const group = groupMap.get(node.id)!;

        for (const err of filteredErrors) {
          const item: BannerItem = { message: err, nodeId: node.id, level: 'error' };
          items.push(item);
          group.items.push(item);
          group.errorCount++;
        }
        for (const warn of filteredWarnings) {
          const item: BannerItem = { message: warn, nodeId: node.id, level: 'warning' };
          items.push(item);
          group.items.push(item);
          group.warningCount++;
        }
      }
    }

    // Add global errors that aren't already covered by per-node errors.
    // Skip connection-related errors — these suffer from the same async
    // edge propagation timing issue and are validated by the canvas inline.
    const connectionErrors = ['Start node must be connected to at least one action'];
    const globalGroup: BannerGroup = { nodeId: null, nodeLabel: 'General', items: [], errorCount: 0, warningCount: 0 };
    for (const err of validation.steps.sequence.errors) {
      if (connectionErrors.includes(err)) continue;
      if (!items.some(item => item.message === err || item.message.endsWith(`: ${err}`))) {
        const item: BannerItem = { message: err, level: 'error' };
        items.push(item);
        globalGroup.items.push(item);
        globalGroup.errorCount++;
      }
    }
    if (globalGroup.items.length > 0) {
      groupMap.set('__global__', globalGroup);
    }

    const errors = items.filter(i => i.level === 'error').length;
    const warnings = items.filter(i => i.level === 'warning').length;

    return {
      nodeValidationMap: map,
      bannerItems: items,
      bannerGroups: Array.from(groupMap.values()),
      totalErrors: errors,
      totalWarnings: warnings,
    };
  }, [state.sequenceNodes, state.sequenceEdges, validation.steps.sequence.errors]);

  // Prefer the selected step's next unused branch, then the deepest available
  // step. Using the actual handle prevents a second edge on an occupied branch.
  const handleAddNode = (type: SequenceNodeType) => {
    const freeHandle = (node: SequenceNode) => getNodeSourceHandles(node).find(handle =>
      !state.sequenceEdges.some(edge => edge.source === node.id && (edge.sourceHandle || "default") === handle));
    const candidates = state.sequenceNodes.filter(node => freeHandle(node));
    const targetNode = (selectedNode && freeHandle(selectedNode) ? selectedNode : null)
      || candidates.sort((a, b) => b.position.y - a.position.y)[0];
    if (targetNode) {
      addNodeAtPosition(type, { x: targetNode.position.x, y: targetNode.position.y + 160 }, { nodeId: targetNode.id, handleId: freeHandle(targetNode) });
    } else {
      addNode(type);
    }
  };

  const content = (
    <div className={
      isFullscreen
        ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
        : "relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card"
    }>
        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="outline" size="sm" className="hidden h-9 gap-2 xl:flex"
              aria-label="Toggle sequence step list" aria-expanded={outlineOpen} aria-controls="sequence-step-list"
              onClick={() => setOutlineOpen(open => !open)}>
              <PanelLeft className="h-4 w-4" /> Steps
            </Button>
            <ActionMenu
              existingNodes={state.sequenceNodes}
              onAddNode={handleAddNode}
            />

            {selectedNode && selectedNode.type !== "start" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Selected step actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => window.setTimeout(() => duplicateNode(selectedNode.id), 0)}>
                      <Copy className="mr-2 h-4 w-4" /> Duplicate step
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => window.setTimeout(() => duplicateBranch(selectedNode.id), 0)}>
                      <GitBranch className="mr-2 h-4 w-4" /> Duplicate branch
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="mr-2 hidden text-xs sm:inline">{state.sequenceNodes.length} steps · {state.sequenceEdges.length} connections</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo sequence change"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit sequence fullscreen" : "Open sequence fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="shrink-0 border-b px-3 py-2 xl:hidden">
          <Select value={state.selectedNodeId || "__overview__"} onValueChange={id => selectNode(id === "__overview__" ? null : id)}>
            <SelectTrigger aria-label="Choose a sequence step" className="h-9 w-full bg-background text-left">
              <SelectValue placeholder="Choose a step to edit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__overview__">Sequence overview</SelectItem>
              {orderedNodes.map((node, index) => (
                <SelectItem key={node.id} value={node.id}>{index + 1}. {stepLabel(node)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Collapsible Errors/Warnings banner */}
        {bannerItems.length > 0 && (
          <Collapsible open={bannerOpen} onOpenChange={setBannerOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center justify-between w-full px-4 py-2 border-b text-sm transition-colors",
                  "hover:bg-muted/70 cursor-pointer",
                  totalErrors > 0
                    ? "bg-destructive/5 dark:bg-destructive/10"
                    : "bg-yellow-500/5 dark:bg-yellow-500/10"
                )}
              >
                <div className="flex items-center gap-2">
                  {totalErrors > 0 ? (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
                  )}
                  <span className="font-medium">
                    {totalErrors > 0 && (
                      <span className="text-destructive">
                        {totalErrors} {totalErrors === 1 ? 'error' : 'errors'}
                      </span>
                    )}
                    {totalErrors > 0 && totalWarnings > 0 && (
                      <span className="text-muted-foreground mx-1">&middot;</span>
                    )}
                    {totalWarnings > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-500">
                        {totalWarnings} {totalWarnings === 1 ? 'warning' : 'warnings'}
                      </span>
                    )}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    bannerOpen && "rotate-180"
                  )}
                />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="px-4 py-2 border-b bg-muted/30 space-y-3 max-h-60 overflow-y-auto">
                {bannerGroups.map((group) => (
                  <div key={group.nodeId || '__global__'}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {group.nodeLabel}
                      </span>
                      {group.errorCount > 0 && (
                        <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px] leading-none">
                          {group.errorCount}
                        </Badge>
                      )}
                      {group.warningCount > 0 && (
                        <Badge variant="outline" className="h-4 min-w-4 px-1 text-[10px] leading-none text-yellow-600 border-yellow-500/50">
                          {group.warningCount}
                        </Badge>
                      )}
                    </div>
                    {/* Individual messages */}
                    <div className="space-y-0.5 ml-1">
                      {group.items.map((item, i) => (
                        <button
                          key={`${item.level}-${i}`}
                          type="button"
                          className={cn(
                            "text-sm flex items-center gap-1.5 w-full text-left rounded px-1.5 py-0.5",
                            item.nodeId ? "hover:bg-muted/50 cursor-pointer" : "cursor-default",
                            item.level === 'error' ? "text-destructive" : "text-yellow-600 dark:text-yellow-500"
                          )}
                          onClick={() => item.nodeId && selectNode(item.nodeId)}
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{item.message}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <aside id="sequence-step-list" className={cn("hidden w-56 shrink-0 flex-col border-r bg-card", outlineOpen && "xl:flex")} aria-label="Sequence steps">
            <div className="shrink-0 border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Sequence steps</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Select a step to edit its settings.</p>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              <button type="button" onClick={() => selectNode(null)} aria-pressed={!state.selectedNodeId}
                className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted", !state.selectedNodeId && "bg-muted font-medium")}>
                <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" /> Overview
              </button>
              {orderedNodes.map((node, index) => {
                const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
                const Icon = NODE_ICONS[node.type as SequenceNodeType] || MessageSquare;
                const issues = nodeValidationMap.get(node.id);
                const colorClass = config?.category === "condition" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
                  : config?.category === "control" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                  : config?.category === "terminal" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : config?.channel === "email" ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                  : config?.channel === "whatsapp" ? "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300"
                  : config?.channel === "instagram" ? "bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300";
                return (
                  <button key={node.id} type="button" onClick={() => selectNode(node.id)}
                    aria-label={`Edit step ${index + 1}: ${stepLabel(node)}`} aria-pressed={state.selectedNodeId === node.id}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg border border-transparent p-2.5 text-left transition-colors hover:bg-muted/70", state.selectedNodeId === node.id && "border-border bg-muted")}>
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", colorClass)}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{stepLabel(node)}</span><span className="text-xs text-muted-foreground">Step {index + 1}</span></span>
                    {issues && <AlertCircle className={cn("h-3.5 w-3.5 shrink-0", issues.errors.length ? "text-destructive" : "text-amber-600")} aria-label="Step needs attention" />}
                  </button>
                );
              })}
            </div>
          </aside>
        {/* Canvas */}
        <div className="min-h-0 min-w-0 flex-1">
          <CampaignAudienceContext.Provider value={audience}><CampaignEntryContext.Provider value={state.entryTriggers}><SequenceCanvas
            nodes={state.sequenceNodes}
            edges={state.sequenceEdges}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onNodeSelect={selectNode}
            selectedNodeId={state.selectedNodeId}
            onAddNodeAtPosition={addNodeAtPosition}
            onInsertNodeOnEdge={builder.insertNodeOnEdge}
            onDuplicateNode={duplicateNode}
            onDuplicateBranch={duplicateBranch}
            onDeleteNode={removeNode}
            nodeValidation={nodeValidationMap}
          /></CampaignEntryContext.Provider></CampaignAudienceContext.Provider>
        </div>
      {/* Config panel */}
      {selectedNode && (
        <CampaignMessagePreviewContext.Provider
          value={{
            leadListIds: state.leadListIds,
            senderAccounts: state.senderAccounts,
            channel: NODE_TYPE_CONFIGS[selectedNode.type as SequenceNodeType]?.channel,
          }}
        >
        <NodeConfigPanel
          node={selectedNode}
          allNodes={state.sequenceNodes}
          entryTriggers={state.entryTriggers}
          onOpenTriggers={() => { if (isFullscreen) toggleFullscreen(); builder.goToStep("triggers"); }}
          onUpdate={(data) => updateNode(selectedNode.id, data)}
          onDelete={() => {
            removeNode(selectedNode.id);
            selectNode(null);
          }}
          onClose={() => selectNode(null)}
        />
        </CampaignMessagePreviewContext.Provider>
      )}
        </div>
    </div>
  );

  // Portal to document.body in fullscreen to escape SidebarInset stacking context
  if (isFullscreen) return createPortal(content, document.body);
  return content;
}
