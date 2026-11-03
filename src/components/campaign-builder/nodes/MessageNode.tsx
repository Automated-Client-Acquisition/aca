import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { MessageSquare, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type { MessageNodeData } from "@/lib/sequence-utils";

type MessageNodeProps = NodeProps<
  Node<MessageNodeData & Record<string, unknown>>
>;

function MessageNodeComponent({ data, selected }: MessageNodeProps) {
  const preview = campaignNodeCopyPreview(data);
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )
      }
      label="Send Message"
      customLabel={data.customLabel || data.label}
      sublabel={preview.summary}
      category="action"
      channel="linkedin"
      selected={selected}
      handles={{ source: ["default"], target: true }}
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

export const MessageNode = memo(MessageNodeComponent);
