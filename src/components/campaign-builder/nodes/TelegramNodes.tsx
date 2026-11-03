import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Send, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type { TelegramMessageNodeData } from "@/lib/sequence-utils";

// Telegram Message Node
type TelegramMessageNodeProps = NodeProps<
  Node<TelegramMessageNodeData & Record<string, unknown>>
>;

function TelegramMessageNodeComponent({
  data,
  selected,
}: TelegramMessageNodeProps) {
  const preview = campaignNodeCopyPreview(data);
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <Send className="h-4 w-4" />
        )
      }
      label="Send Telegram"
      customLabel={data.customLabel || data.label}
      sublabel={preview.summary}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="telegram"
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

export const TelegramMessageNode = memo(TelegramMessageNodeComponent);
