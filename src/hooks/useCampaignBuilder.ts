import { useState, useCallback, useMemo, useRef } from "react";
import { normalizeEntryRules, type CampaignEntryRule } from "@/lib/campaign-entry";
import type {
  SequenceNode,
  SequenceEdge,
  ChannelType,
} from "@/lib/sequence-utils";
import {
  createStartNode,
  createNode,
  createEdge,
  calculateNextPosition,
  createDefaultNodeData,
  getNodeSourceHandles,
  type SequenceNodeType,
} from "@/lib/sequence-utils";
import {
  validateCampaign,
  type CampaignData,
  type CampaignValidationResult,
} from "@/lib/campaign-validation";
import {
  activeInflowListIds,
  useEnrollmentInflows,
} from "@/hooks/useEnrollmentInflows";
import type {
  CampaignType,
  SenderAccountsByChannel,
} from "@/hooks/useCampaigns";
import type {
  CampaignPowerSettings,
  CampaignRateSettings,
  AutopilotConfig,
} from "@/types/email";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import {
  DEFAULT_CAMPAIGN_POWER_SETTINGS,
  DEFAULT_CAMPAIGN_RATE_SETTINGS,
} from "@/types/email";

// Wizard steps
export type WizardStep =
  | "name"
  | "leads"
  | "triggers"
  | "senders"
  | "sequence"
  | "settings"
  | "review";

export const WIZARD_STEPS: WizardStep[] = [
  "name",
  "leads",
  "triggers",
  "senders",
  "sequence",
  "settings",
  "review",
];

export const STEP_LABELS: Record<WizardStep, string> = {
  name: "Overview",
  leads: "Audience",
  triggers: "Triggers",
  senders: "Senders",
  sequence: "Sequence",
  settings: "Settings",
  review: "Review",
};

// Builder state interface
export interface CampaignBuilderState {
  // Step 1: Name
  name: string;
  description: string;
  // Step 2: Leads
  leadListIds: string[];
  exclusionListIds: string[];
  excludeOtherCampaigns: boolean;
  excludeSameSender: boolean;
  autoEnrollNewMembers: boolean;
  /** Filter step: only enrol list members matching these criteria. {} = everyone. */
  enrollFilterCriteria: SmartListFilterCriteria;
  // ICP score filtering
  icpProductId: string;
  minIcpScore: number | null;
  entryTriggers: CampaignEntryRule[];
  // Step 3: Senders (multi-channel)
  senderAccountIds: string[]; // Legacy: LinkedIn only (backward compatible)
  senderAccounts: SenderAccountsByChannel; // Multi-channel sender selection
  campaignType: CampaignType;
  primaryChannel: ChannelType;
  channelFallbackEnabled: boolean;
  fallbackOrder: ChannelType[];
  // Step 4: Sequence
  sequenceNodes: SequenceNode[];
  sequenceEdges: SequenceEdge[];
  // Selected node for editing
  selectedNodeId: string | null;
  // Behavior settings
  stopOnReply: boolean;
  // Step 5: Smart Settings
  campaignSettings: CampaignPowerSettings;
  rateSettings: CampaignRateSettings;
  autopilotConfig: AutopilotConfig;
  agentProfileId: string | null;
}

// Default fallback order for multi-channel campaigns
const DEFAULT_FALLBACK_ORDER: ChannelType[] = [
  "linkedin",
  "email",
  "whatsapp",
  "instagram",
];

// Imported/older graphs can omit configuration fields that node editors expect.
// Supply defaults locally without overwriting existing copy or custom settings.
export function normalizeCampaignNodes(nodes: SequenceNode[]): SequenceNode[] {
  return nodes.map((node, index) => {
    const defaults = createDefaultNodeData(node.type as SequenceNodeType) ?? {};
    const data = { ...defaults, ...(node.data ?? {}) };
    for (const [key, value] of Object.entries(defaults)) {
      if (Array.isArray(value) && !Array.isArray(data[key])) data[key] = [];
    }
    return {
      ...node,
      position: node.position ?? { x: 250, y: 50 + index * 150 },
      data,
    };
  });
}

// A copied branch must jump to its own copied steps; a single copied Go To
// keeps its original destination, and external branch targets remain external.
export function cloneCampaignNodeData(
  node: SequenceNode,
  idMap?: Map<string, string>,
): SequenceNode["data"] {
  const data = JSON.parse(JSON.stringify(node.data ?? {}));
  if (
    node.type === "goTo" &&
    typeof data.targetNodeId === "string" &&
    idMap?.has(data.targetNodeId)
  ) {
    data.targetNodeId = idMap.get(data.targetNodeId);
  }
  return data;
}

/** Copy ordinary descendants; a Go To destination remains a jump, not a child. */
export function cloneCampaignBranchGraph(
  nodes: SequenceNode[],
  edges: SequenceEdge[],
  rootId: string,
  createId: (oldId: string) => string = () => `node-${crypto.randomUUID().slice(0, 8)}`,
): { nodes: SequenceNode[]; edges: SequenceEdge[]; idMap: Map<string, string> } | null {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const root = nodeById.get(rootId);
  if (!root || root.type === "start") return null;
  const branchIds = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.shift()!;
    const node = nodeById.get(id);
    if (!node || node.type === "start" || branchIds.has(id)) continue;
    branchIds.add(id);
    if (node.type === "goTo") continue;
    for (const edge of edges) if (edge.source === id) pending.push(edge.target);
  }
  const idMap = new Map([...branchIds].map(id => [id, createId(id)]));
  const copiedNodes = [...branchIds].map(id => {
    const node = nodeById.get(id)!;
    return {
      ...node,
      id: idMap.get(id)!,
      position: { x: node.position.x + 300, y: node.position.y },
      selected: false,
      data: cloneCampaignNodeData(node, idMap),
    };
  });
  const copiedEdges: SequenceEdge[] = [];
  const copyEdge = (edge: SequenceEdge) => {
    const source = idMap.get(edge.source)!;
    const target = idMap.get(edge.target) ?? edge.target;
    copiedEdges.push({
      ...JSON.parse(JSON.stringify(edge)),
      id: `edge-${source}-${edge.id}`,
      source,
      target,
      selected: false,
    });
  };
  for (const id of branchIds) {
    const node = nodeById.get(id)!;
    if (node.type === "goTo") {
      const targetId = (node.data as { targetNodeId?: string } | null)?.targetNodeId;
      if (!targetId || !nodeById.has(targetId)) continue;
      // Runtime follows targetNodeId, so stale stored outgoing edges are omitted.
      const route = edges.find(edge => edge.source === id && edge.target === targetId)
        ?? createEdge(id, targetId, "default", "Go To");
      copyEdge(route);
    } else {
      for (const edge of edges) {
        if (edge.source === id && branchIds.has(edge.target)) copyEdge(edge);
      }
    }
  }
  return { nodes: copiedNodes, edges: copiedEdges, idMap };
}

// Initial state factory
function createInitialState(
  existingCampaign?: Partial<CampaignBuilderState>,
): CampaignBuilderState {
  const startNode = createStartNode();

  return {
    name: existingCampaign?.name || "",
    description: existingCampaign?.description || "",
    leadListIds: existingCampaign?.leadListIds || [],
    exclusionListIds: existingCampaign?.exclusionListIds || [],
    excludeOtherCampaigns: existingCampaign?.excludeOtherCampaigns ?? true,
    excludeSameSender: existingCampaign?.excludeSameSender ?? true,
    autoEnrollNewMembers: existingCampaign?.autoEnrollNewMembers ?? false,
    enrollFilterCriteria: existingCampaign?.enrollFilterCriteria ?? {},
    icpProductId: existingCampaign?.icpProductId || "",
    minIcpScore: existingCampaign?.minIcpScore ?? null,
    entryTriggers: normalizeEntryRules(existingCampaign?.entryTriggers),
    // Legacy LinkedIn-only field
    senderAccountIds: existingCampaign?.senderAccountIds || [],
    // Multi-channel fields
    senderAccounts: existingCampaign?.senderAccounts || {},
    campaignType: existingCampaign?.campaignType || "linkedin_only",
    primaryChannel: existingCampaign?.primaryChannel || "linkedin",
    channelFallbackEnabled: existingCampaign?.channelFallbackEnabled ?? false,
    fallbackOrder: existingCampaign?.fallbackOrder || DEFAULT_FALLBACK_ORDER,
    // Sequence
    sequenceNodes: existingCampaign?.sequenceNodes?.length
      ? normalizeCampaignNodes(existingCampaign.sequenceNodes)
      : [startNode],
    sequenceEdges: existingCampaign?.sequenceEdges || [],
    selectedNodeId: null,
    // Behavior settings
    stopOnReply: existingCampaign?.stopOnReply ?? true, // Default to true
    // Smart Settings
    campaignSettings: {
      ...DEFAULT_CAMPAIGN_POWER_SETTINGS,
      ...existingCampaign?.campaignSettings,
    },
    rateSettings: {
      ...DEFAULT_CAMPAIGN_RATE_SETTINGS,
      ...existingCampaign?.rateSettings,
    },
    autopilotConfig: {
      enabled: false,
      require_approval: true,
      max_auto_replies: 3,
      ...existingCampaign?.autopilotConfig,
      rules: existingCampaign?.autopilotConfig?.rules ?? [],
    },
    agentProfileId: existingCampaign?.agentProfileId ?? null,
  };
}

/**
 * Hook for managing campaign builder state
 *
 * `campaignId` (editing an existing campaign) lets the hook see the second way
 * leads enter a campaign: a lead list whose processing setup routes its approved
 * leads here. That inflow satisfies the "needs a lead source" requirement, so a
 * pipeline-fed campaign validates without a directly attached list.
 */
export function useCampaignBuilder(
  initialData?: Partial<CampaignBuilderState>,
  options?: { campaignId?: string; initialStep?: WizardStep },
) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(
    options?.initialStep ?? "name",
  );
  const [state, setState] = useState<CampaignBuilderState>(() =>
    createInitialState(initialData),
  );

  const { data: pipelineInflows } = useEnrollmentInflows(
    "linkedin_campaign",
    options?.campaignId,
  );
  // Only an ENABLED route counts — a dormant one delivers nothing.
  const hasPipelineInflow = activeInflowListIds(pipelineInflows).size > 0;

  // Get current step index
  const currentStepIndex = WIZARD_STEPS.indexOf(currentStep);

  // Navigation
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);

  const goToNextStep = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < WIZARD_STEPS.length) {
      setCurrentStep(WIZARD_STEPS[nextIndex]);
    }
  }, [currentStepIndex]);

  const goToPreviousStep = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(WIZARD_STEPS[prevIndex]);
    }
  }, [currentStepIndex]);

  const canGoNext = currentStepIndex < WIZARD_STEPS.length - 1;
  const canGoPrevious = currentStepIndex > 0;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === WIZARD_STEPS.length - 1;

  // ── Undo history for sequence changes ──
  // Stores snapshots of { sequenceNodes, sequenceEdges } before each mutation.
  const MAX_UNDO_HISTORY = 50;
  const undoStackRef = useRef<
    { nodes: SequenceNode[]; edges: SequenceEdge[] }[]
  >([]);

  // Wrap setState to snapshot sequence state before the mutation
  const setStateWithUndo = useCallback(
    (updater: (prev: CampaignBuilderState) => CampaignBuilderState) => {
      setState((prev) => {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(MAX_UNDO_HISTORY - 1)),
          { nodes: prev.sequenceNodes, edges: prev.sequenceEdges },
        ];
        return updater(prev);
      });
    },
    [],
  );

  const undo = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return;
    setState((prev) => ({
      ...prev,
      sequenceNodes: snapshot.nodes,
      sequenceEdges: snapshot.edges,
      selectedNodeId: null,
    }));
  }, []);

  const canUndo = undoStackRef.current.length > 0;

  // State updates
  const updateField = useCallback(
    <K extends keyof CampaignBuilderState>(
      field: K,
      value: CampaignBuilderState[K],
    ) => {
      setState((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const updateFields = useCallback((updates: Partial<CampaignBuilderState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Sequence manipulation
  const addNode = useCallback(
    (type: SequenceNodeType, afterNodeId?: string) => {
      let newNode: SequenceNode;

      setStateWithUndo((prev) => {
        const position = calculateNextPosition(prev.sequenceNodes, afterNodeId);
        newNode = createNode(type, position);

        const updates: Partial<CampaignBuilderState> = {
          sequenceNodes: [...prev.sequenceNodes, newNode],
          selectedNodeId: newNode.id,
        };

        // Auto-connect to previous node in the same state transition
        if (afterNodeId) {
          const afterNode = prev.sequenceNodes.find(
            (n) => n.id === afterNodeId,
          );
          const sourceHandles = afterNode ? getNodeSourceHandles(afterNode) : ["default"];
          if (sourceHandles && sourceHandles.length > 0) {
            const edge = createEdge(afterNodeId, newNode.id, sourceHandles[0]);
            updates.sequenceEdges = [...prev.sequenceEdges, edge];
          }
        }

        return { ...prev, ...updates };
      });

      return newNode!;
    },
    [setStateWithUndo],
  );

  // Add a node at a specific position and connect it to a source node/handle
  const addNodeAtPosition = useCallback(
    (
      type: SequenceNodeType,
      position: { x: number; y: number },
      connectFrom?: { nodeId: string; handleId?: string },
    ) => {
      let newNode: SequenceNode;

      setStateWithUndo((prev) => {
        let finalPosition = position;

        // When connecting from a source node, place the new node directly below it
        // instead of at the raw cursor position (which often ends up to the right)
        if (connectFrom) {
          const sourceNode = prev.sequenceNodes.find(
            (n) => n.id === connectFrom.nodeId,
          );
          if (sourceNode) {
            finalPosition = {
              x: sourceNode.position.x,
              y: sourceNode.position.y + 150,
            };
          }
        }

        newNode = createNode(type, finalPosition);

        const newEdges: ReturnType<typeof createEdge>[] = [];
        if (connectFrom) {
          newEdges.push(
            createEdge(connectFrom.nodeId, newNode.id, connectFrom.handleId),
          );
        }

        return {
          ...prev,
          sequenceNodes: [...prev.sequenceNodes, newNode],
          sequenceEdges: [...prev.sequenceEdges, ...newEdges],
          selectedNodeId: newNode.id,
        };
      });

      return newNode!;
    },
    [setStateWithUndo],
  );

  // Insert a step on an existing connection: source -> new -> old target.
  // The downstream step hangs off the new step's first outcome.
  const insertNodeOnEdge = useCallback(
    (type: SequenceNodeType, edgeId: string) => {
      setStateWithUndo((prev) => {
        const edge = prev.sequenceEdges.find((e) => e.id === edgeId);
        const source = edge && prev.sequenceNodes.find((n) => n.id === edge.source);
        const target = edge && prev.sequenceNodes.find((n) => n.id === edge.target);
        if (!edge || !source || !target || source.type === "goTo") return prev;

        const newNode = createNode(type, {
          x: source.position.x,
          y: (source.position.y + target.position.y) / 2,
        });
        const outHandle = getNodeSourceHandles(newNode)[0];
        const newEdges = [
          createEdge(source.id, newNode.id, edge.sourceHandle || "default", edge.label as string | undefined),
          ...(outHandle && type !== "goTo" ? [createEdge(newNode.id, target.id, outHandle)] : []),
        ];

        return {
          ...prev,
          sequenceNodes: [...prev.sequenceNodes, newNode],
          sequenceEdges: [...prev.sequenceEdges.filter((e) => e.id !== edgeId), ...newEdges],
          selectedNodeId: newNode.id,
        };
      });
    },
    [setStateWithUndo],
  );

  const updateNode = useCallback(
    (nodeId: string, data: Partial<SequenceNode["data"]>) => {
      setState((prev) => {
        const sequenceNodes = prev.sequenceNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...data } }
            : node,
        );
        // Route by Channel's branches follow its channels: drop the edge of a removed channel.
        const updated = sequenceNodes.find((node) => node.id === nodeId);
        const sequenceEdges = updated?.type === "routeByChannel"
          ? prev.sequenceEdges.filter((edge) =>
            edge.source !== nodeId || getNodeSourceHandles(updated).includes(edge.sourceHandle || "default"))
          : prev.sequenceEdges;
        return { ...prev, sequenceNodes, sequenceEdges };
      });
    },
    [],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      // Don't allow removing start node
      const node = state.sequenceNodes.find((n) => n.id === nodeId);
      if (node?.type === "start") return;

      setStateWithUndo((prev) => {
        const incoming = prev.sequenceEdges.filter((e) => e.target === nodeId);
        const outgoing = prev.sequenceEdges.filter((e) => e.source === nodeId);
        const sequenceEdges = prev.sequenceEdges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        );
        // A single in / single out step leaves a gap when removed: bridge it so
        // the steps after it stay reachable. Go To links point at a node, not a
        // chain, so they are not bridged.
        const inSource = incoming.length === 1
          && prev.sequenceNodes.find((n) => n.id === incoming[0].source);
        if (node?.type !== "goTo" && inSource && inSource.type !== "goTo" && outgoing.length === 1
          && outgoing[0].target !== inSource.id) {
          const bridge = createEdge(inSource.id, outgoing[0].target, incoming[0].sourceHandle || "default",
            incoming[0].label as string | undefined);
          if (!sequenceEdges.some((e) => e.id === bridge.id)) sequenceEdges.push(bridge);
        }
        return {
          ...prev,
          sequenceNodes: prev.sequenceNodes.filter((n) => n.id !== nodeId),
          sequenceEdges,
          selectedNodeId:
            prev.selectedNodeId === nodeId ? null : prev.selectedNodeId,
        };
      });
    },
    [state.sequenceNodes, setStateWithUndo],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const node = state.sequenceNodes.find((n) => n.id === nodeId);
      if (!node || node.type === "start") return;

      const newId = `node-${crypto.randomUUID().slice(0, 8)}`;
      const newNode: SequenceNode = {
        ...node,
        id: newId,
        position: { x: node.position.x + 30, y: node.position.y + 30 },
        selected: false,
        data: cloneCampaignNodeData(node),
      };

      setStateWithUndo((prev) => ({
        ...prev,
        sequenceNodes: [...prev.sequenceNodes, newNode],
        selectedNodeId: newId,
      }));
    },
    [state.sequenceNodes, setStateWithUndo],
  );

  // Duplicate a node and all its downstream descendants (the whole branch)
  const duplicateBranch = useCallback(
    (rootNodeId: string) => {
      setStateWithUndo((prev) => {
        const copy = cloneCampaignBranchGraph(prev.sequenceNodes, prev.sequenceEdges, rootNodeId);
        if (!copy) return prev;
        const { nodes: newNodes, edges: newEdges, idMap } = copy;

        // Find the parent node that connects INTO the root of this branch
        const parentEdge = prev.sequenceEdges.find(
          (e) => e.target === rootNodeId && !idMap.has(e.source)
            && prev.sequenceNodes.find(node => node.id === e.source)?.type !== "goTo",
        );

        // Connect the cloned branch root to the parent's free source handle
        if (parentEdge) {
          const parentNode = prev.sequenceNodes.find(
            (n) => n.id === parentEdge.source,
          );
          if (parentNode) {
            const sourceHandles = getNodeSourceHandles(parentNode);
            // Find which handles are already connected
            const usedHandles = new Set(
              prev.sequenceEdges
                .filter((e) => e.source === parentNode.id)
                .map((e) => e.sourceHandle || "default"),
            );
            // Pick the first free handle
            const freeHandle = sourceHandles.find((h) => !usedHandles.has(h));
            if (freeHandle) {
              newEdges.push(
                {
                  ...JSON.parse(JSON.stringify(parentEdge)),
                  ...createEdge(parentNode.id, idMap.get(rootNodeId)!, freeHandle),
                  targetHandle: parentEdge.targetHandle,
                  selected: false,
                },
              );
            }
          }
        }

        return {
          ...prev,
          sequenceNodes: [...prev.sequenceNodes, ...newNodes],
          sequenceEdges: [...prev.sequenceEdges, ...newEdges],
          selectedNodeId: idMap.get(rootNodeId) || prev.selectedNodeId,
        };
      });
    },
    [setStateWithUndo],
  );

  const selectNode = useCallback((nodeId: string | null) => {
    setState((prev) => ({ ...prev, selectedNodeId: nodeId }));
  }, []);

  const updateNodePosition = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      setState((prev) => ({
        ...prev,
        sequenceNodes: prev.sequenceNodes.map((node) =>
          node.id === nodeId ? { ...node, position } : node,
        ),
      }));
    },
    [],
  );

  // Edge manipulation
  const addEdge = useCallback(
    (source: string, target: string, sourceHandle?: string, label?: string) => {
      const edge = createEdge(source, target, sourceHandle, label);
      setState((prev) => ({
        ...prev,
        sequenceEdges: [...prev.sequenceEdges, edge],
      }));
      return edge;
    },
    [],
  );

  const removeEdge = useCallback((edgeId: string) => {
    setState((prev) => ({
      ...prev,
      sequenceEdges: prev.sequenceEdges.filter((e) => e.id !== edgeId),
    }));
  }, []);

  const setEdges = useCallback((edges: SequenceEdge[]) => {
    setState((prev) => ({ ...prev, sequenceEdges: edges }));
  }, []);

  const setNodes = useCallback((nodes: SequenceNode[]) => {
    setState((prev) => ({ ...prev, sequenceNodes: nodes }));
  }, []);

  // Get selected node
  const selectedNode = useMemo(
    () =>
      state.selectedNodeId
        ? state.sequenceNodes.find((n) => n.id === state.selectedNodeId)
        : null,
    [state.selectedNodeId, state.sequenceNodes],
  );

  // Validation
  const validation = useMemo<CampaignValidationResult>(() => {
    const campaignData: CampaignData = {
      name: state.name,
      description: state.description,
      leadListIds: state.leadListIds,
      exclusionListIds: state.exclusionListIds,
      excludeOtherCampaigns: state.excludeOtherCampaigns,
      excludeSameSender: state.excludeSameSender,
      entryTriggers: state.entryTriggers,
      // Legacy field
      senderAccountIds: state.senderAccountIds,
      // Multi-channel fields
      senderAccounts: state.senderAccounts,
      campaignType: state.campaignType,
      primaryChannel: state.primaryChannel,
      channelFallbackEnabled: state.channelFallbackEnabled,
      fallbackOrder: state.fallbackOrder,
      // Sequence
      sequenceNodes: state.sequenceNodes,
      sequenceEdges: state.sequenceEdges,
    };
    return validateCampaign(campaignData, { hasPipelineInflow });
  }, [state, hasPipelineInflow]);

  // Check if specific step is valid
  const isStepValid = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case "name":
          return validation.steps.name.valid;
        case "leads":
          return validation.steps.leads.valid;
        case "triggers":
          return validation.steps.triggers.valid;
        case "senders":
          return validation.steps.senders.valid;
        case "sequence":
          return validation.steps.sequence.valid;
        case "settings":
          return true; // Settings step is always valid (all fields have defaults)
        case "review":
          return validation.valid;
        default:
          return false;
      }
    },
    [validation],
  );

  // Get data for saving
  const getCampaignData = useCallback(
    () => ({
      name: state.name,
      description: state.description || null,
      lead_list_ids: state.leadListIds,
      exclusion_list_ids: state.exclusionListIds,
      exclude_other_campaigns: state.excludeOtherCampaigns,
      exclude_same_sender: state.excludeSameSender,
      auto_enroll_new_members: state.autoEnrollNewMembers,
      enroll_filter_criteria: state.enrollFilterCriteria ?? {},
      sender_account_ids: state.senderAccountIds,
      sequence_nodes: state.sequenceNodes,
      sequence_edges: state.sequenceEdges,
      stop_on_reply: state.stopOnReply,
      campaign_settings: state.campaignSettings,
      rate_settings: state.rateSettings,
      autopilot_config: state.autopilotConfig,
      agent_profile_id: state.agentProfileId,
      icp_product_id: state.icpProductId || null,
      min_icp_score: state.minIcpScore,
      entry_triggers: state.entryTriggers,
      // Multi-channel fields
      campaign_type: state.campaignType,
      sender_accounts: state.senderAccounts,
      primary_channel: state.primaryChannel,
      channel_fallback_enabled: state.channelFallbackEnabled,
      fallback_order: state.fallbackOrder,
    }),
    [state],
  );

  // Reset state
  const reset = useCallback(() => {
    undoStackRef.current = [];
    setState(createInitialState());
    setCurrentStep("name");
  }, []);

  // Load existing campaign data
  const loadCampaign = useCallback((data: Partial<CampaignBuilderState>) => {
    undoStackRef.current = [];
    setState(createInitialState(data));
    // Preserve the user's current wizard step when reloading campaign data.
    // This prevents "Save Draft" (which typically triggers a refetch) from bouncing
    // the UI back to step 1 while the user is editing later steps.
  }, []);

  return {
    // Current state
    state,
    currentStep,
    currentStepIndex,

    // Navigation
    goToStep,
    goToNextStep,
    goToPreviousStep,
    canGoNext,
    canGoPrevious,
    isFirstStep,
    isLastStep,

    // State updates
    updateField,
    updateFields,

    // Sequence manipulation
    addNode,
    addNodeAtPosition,
    insertNodeOnEdge,
    updateNode,
    removeNode,
    duplicateNode,
    duplicateBranch,
    selectNode,
    updateNodePosition,
    selectedNode,
    undo,
    canUndo,

    // Edge manipulation
    addEdge,
    removeEdge,
    setEdges,
    setNodes,

    // Validation
    validation,
    isStepValid,

    // Data
    getCampaignData,
    reset,
    loadCampaign,
  };
}

export type CampaignBuilderReturn = ReturnType<typeof useCampaignBuilder>;
