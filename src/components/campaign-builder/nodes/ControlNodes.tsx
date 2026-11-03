import { memo, useContext } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { MessageSquareReply, ArrowRightLeft, GitBranch, CornerDownLeft, Split } from "lucide-react";
import { BaseNode, type NodeValidation } from "./BaseNode";
import { CampaignEntryContext } from "@/components/campaign-builder/CampaignEntryContext";
import {
  NODE_TYPE_CONFIGS,
  CONTACT_CHECK_OPTIONS,
  ROUTE_CHANNEL_OPTIONS,
  getNodeSourceHandles,
  resolveContactCheck,
  routeChannels,
  type ConditionReplyReceivedNodeData,
  type SwitchChannelNodeData,
  type ConditionChannelAvailableNodeData,
  type RouteByChannelNodeData,
  type GoToNodeData,
  type SequenceNodeType,
} from "@/lib/sequence-utils";

// Condition: Reply Received Node (useful for LinkedIn campaigns to check if prospect replied)
type ConditionReplyReceivedNodeProps = NodeProps<{ data: ConditionReplyReceivedNodeData }>;

function ConditionReplyReceivedNodeComponent({ data, selected }: ConditionReplyReceivedNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as ConditionReplyReceivedNodeData;
  const days = nodeData.withinDays || 7;

  return (
    <BaseNode
      icon={<MessageSquareReply className="h-3.5 w-3.5" />}
      label="If Reply Received"
      customLabel={nodeData.customLabel}
      sublabel={`Within ${days} days`}
      category="condition"
      selected={selected}
      handles={{ source: ["replied", "noReply"], target: true }}
      validation={validation}
    />
  );
}

export const ConditionReplyReceivedNode = memo(ConditionReplyReceivedNodeComponent);

// Switch Channel Node
type SwitchChannelNodeProps = NodeProps<{ data: SwitchChannelNodeData }>;

function SwitchChannelNodeComponent({ data, selected }: SwitchChannelNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as SwitchChannelNodeData;
  const target = nodeData.targetChannel || "email";

  return (
    <BaseNode
      icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
      label="Switch Channel"
      customLabel={nodeData.customLabel}
      sublabel={`Switch to ${target}`}
      category="control"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const SwitchChannelNode = memo(SwitchChannelNodeComponent);

// Condition: Channel Available Node
type ConditionChannelAvailableNodeProps = NodeProps<{ data: ConditionChannelAvailableNodeData }>;

function ConditionChannelAvailableNodeComponent({ data, selected }: ConditionChannelAvailableNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as ConditionChannelAvailableNodeData;
  const entryTriggers = useContext(CampaignEntryContext);
  const check = resolveContactCheck(nodeData);
  const checkLabel = CONTACT_CHECK_OPTIONS.find((o) => o.value === check)?.label;
  const channelLabel = ROUTE_CHANNEL_OPTIONS.find((o) => o.value === nodeData.channel)?.label;
  const triggerName = nodeData.triggerId
    ? entryTriggers.find((rule) => rule.id === nodeData.triggerId)?.name ?? "a removed trigger"
    : "any trigger";
  const sublabel = check === "senderConnected" ? `${channelLabel ?? "Channel"} sender connected`
    : check === "enteredOnChannel" ? `Came in on ${channelLabel ?? "a channel"}`
    : check === "enteredViaTrigger" ? `Came in through ${triggerName}`
    : checkLabel ?? `Check ${nodeData.channel || "email"}`;

  return (
    <BaseNode
      icon={<GitBranch className="h-3.5 w-3.5" />}
      label="If Channel Available"
      customLabel={nodeData.customLabel}
      sublabel={sublabel}
      category="condition"
      selected={selected}
      handles={{ source: ["available", "notAvailable"], target: true }}
      validation={validation}
    />
  );
}

export const ConditionChannelAvailableNode = memo(ConditionChannelAvailableNodeComponent);

// Route by Channel: one branch per channel in priority order, plus "No channel"
type RouteByChannelNodeProps = NodeProps<Node<RouteByChannelNodeData & Record<string, unknown>>>;

function RouteByChannelNodeComponent({ data, selected }: RouteByChannelNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as RouteByChannelNodeData;
  const order = routeChannels(nodeData)
    .map((channel) => ROUTE_CHANNEL_OPTIONS.find((o) => o.value === channel)?.label)
    .join(" → ");

  return (
    <BaseNode
      icon={<Split className="h-3.5 w-3.5" />}
      label="Route by Channel"
      customLabel={nodeData.customLabel}
      sublabel={order
        ? `First reachable: ${nodeData.entryChannelFirst ? "their channel, then " : ""}${order}`
        : "No channels picked"}
      category="condition"
      selected={selected}
      handles={{ source: getNodeSourceHandles({ type: "routeByChannel", data: nodeData }), target: true }}
      validation={validation}
    />
  );
}

export const RouteByChannelNode = memo(RouteByChannelNodeComponent);

// Go To Node — jumps to another node in the sequence
type GoToNodeProps = NodeProps<{ data: GoToNodeData }>;

function GoToNodeComponent({ data, selected }: GoToNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as GoToNodeData;

  let sublabel = "Drag to connect →";
  if (nodeData.targetNodeId) {
    const allNodes = (data as any)?.__allNodes as Array<{ id: string; type: string; data: { customLabel?: string } }> | undefined;
    if (allNodes) {
      const targetNode = allNodes.find((n) => n.id === nodeData.targetNodeId);
      if (targetNode) {
        const config = NODE_TYPE_CONFIGS[targetNode.type as SequenceNodeType];
        sublabel = `→ ${targetNode.data?.customLabel || config?.label || targetNode.type}`;
      } else {
        sublabel = "Target not found";
      }
    }
  }

  return (
    <BaseNode
      icon={<CornerDownLeft className="h-3.5 w-3.5" />}
      label="Go To"
      customLabel={nodeData.customLabel}
      sublabel={sublabel}
      category="control"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const GoToNode = memo(GoToNodeComponent);
