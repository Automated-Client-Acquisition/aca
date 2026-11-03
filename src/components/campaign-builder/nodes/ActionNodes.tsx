import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Eye, UserCheck, ThumbsUp, Flag, Sparkles } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type {
  ViewProfileNodeData,
  FollowNodeData,
  LikePostNodeData,
  EndNodeData,
  WarmupEngagementNodeData,
} from "@/lib/sequence-utils";

// View Profile Node
type ViewProfileNodeProps = NodeProps<{ data: ViewProfileNodeData }>;

function ViewProfileNodeComponent({ data, selected }: ViewProfileNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as ViewProfileNodeData;
  return (
    <BaseNode
      icon={<Eye className="h-3.5 w-3.5" />}
      label="View Profile"
      customLabel={nodeData.customLabel}
      sublabel="Trigger profile view"
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const ViewProfileNode = memo(ViewProfileNodeComponent);

// Follow Node
type FollowNodeProps = NodeProps<{ data: FollowNodeData }>;

function FollowNodeComponent({ data, selected }: FollowNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as FollowNodeData;
  return (
    <BaseNode
      icon={<UserCheck className="h-3.5 w-3.5" />}
      label="Follow"
      customLabel={nodeData.customLabel}
      sublabel="Follow the user"
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const FollowNode = memo(FollowNodeComponent);

// Like Post Node
type LikePostNodeProps = NodeProps<{ data: LikePostNodeData }>;

function LikePostNodeComponent({ data, selected }: LikePostNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as LikePostNodeData;
  const likeCount = nodeData.likeCount || 1;

  return (
    <BaseNode
      icon={<ThumbsUp className="h-3.5 w-3.5" />}
      label="Like Post"
      customLabel={nodeData.customLabel}
      sublabel={`Like ${likeCount} post${likeCount !== 1 ? "s" : ""}`}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const LikePostNode = memo(LikePostNodeComponent);

// Warmup Engagement Node
type WarmupEngagementNodeProps = NodeProps<{ data: WarmupEngagementNodeData }>;

function WarmupEngagementNodeComponent({ data, selected }: WarmupEngagementNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as WarmupEngagementNodeData;
  const engagementType = nodeData.engagementType || 'reaction';
  const postCount = nodeData.postCount || 1;

  const getEngagementLabel = () => {
    if (engagementType === 'both') return 'React & Comment';
    if (engagementType === 'comment') return 'Comment on post';
    return 'React to post';
  };

  return (
    <BaseNode
      icon={<Sparkles className="h-3.5 w-3.5" />}
      label="Warm-up"
      customLabel={nodeData.customLabel}
      sublabel={`${getEngagementLabel()} (${postCount})`}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const WarmupEngagementNode = memo(WarmupEngagementNodeComponent);

// End Node
type EndNodeProps = NodeProps<{ data: EndNodeData }>;

function EndNodeComponent({ data, selected }: EndNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as EndNodeData;
  return (
    <BaseNode
      icon={<Flag className="h-3.5 w-3.5" />}
      label="End"
      customLabel={nodeData.customLabel}
      sublabel="Sequence complete"
      category="terminal"
      selected={selected}
      handles={{ source: [], target: true }}
      validation={validation}
    />
  );
}

export const EndNode = memo(EndNodeComponent);
