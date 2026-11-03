import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Instagram, UserPlus, Heart, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type {
  InstagramDmNodeData,
  InstagramFollowNodeData,
  InstagramLikePostNodeData,
} from "@/lib/sequence-utils";

// Instagram DM Node
type InstagramDmNodeProps = NodeProps<
  Node<InstagramDmNodeData & Record<string, unknown>>
>;

function InstagramDmNodeComponent({ data, selected }: InstagramDmNodeProps) {
  const preview = campaignNodeCopyPreview(data);
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <Instagram className="h-4 w-4" />
        )
      }
      label="Send Instagram DM"
      customLabel={data.customLabel || data.label}
      sublabel={preview.summary}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="instagram"
      validation={data.__validation as NodeValidation | undefined}
    >
      {(preview.content || preview.subject) && (
        <NodeCopyPreview
          content={preview.content}
          subject={preview.subject}
          isPrompt={preview.isPrompt}
        />
      )}
    </BaseNode>
  );
}

export const InstagramDmNode = memo(InstagramDmNodeComponent);

// Instagram Follow Node
type InstagramFollowNodeProps = NodeProps<
  Node<InstagramFollowNodeData & Record<string, unknown>>
>;

function InstagramFollowNodeComponent({
  data,
  selected,
}: InstagramFollowNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as InstagramFollowNodeData;
  return (
    <BaseNode
      icon={<UserPlus className="h-3.5 w-3.5" />}
      label="Follow on Instagram"
      customLabel={nodeData.customLabel}
      sublabel="Follow user's profile"
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="instagram"
      validation={validation}
    />
  );
}

export const InstagramFollowNode = memo(InstagramFollowNodeComponent);

// Instagram Like Post Node
type InstagramLikePostNodeProps = NodeProps<
  Node<InstagramLikePostNodeData & Record<string, unknown>>
>;

function InstagramLikePostNodeComponent({
  data,
  selected,
}: InstagramLikePostNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as InstagramLikePostNodeData;
  const likeCount = nodeData.likeCount || 1;

  return (
    <BaseNode
      icon={<Heart className="h-3.5 w-3.5" />}
      label="Like Instagram Post"
      customLabel={nodeData.customLabel}
      sublabel={`Like ${likeCount} post${likeCount !== 1 ? "s" : ""}`}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="instagram"
      validation={validation}
    />
  );
}

export const InstagramLikePostNode = memo(InstagramLikePostNodeComponent);
