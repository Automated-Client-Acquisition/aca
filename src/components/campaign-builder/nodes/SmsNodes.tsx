import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { MessageSquareText, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type { SmsMessageNodeData } from "@/lib/sequence-utils";

// SMS Message Node (sent from the org's Twilio senders)
type SmsMessageNodeProps = NodeProps<
  Node<SmsMessageNodeData & Record<string, unknown>>
>;

function SmsMessageNodeComponent({ data, selected }: SmsMessageNodeProps) {
  const preview = campaignNodeCopyPreview(data);
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <MessageSquareText className="h-4 w-4" />
        )
      }
      label="Send SMS"
      customLabel={data.customLabel || data.label}
      sublabel={preview.summary}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="sms"
      validation={data.__validation as NodeValidation | undefined}
    >
      {preview.content && (
        <NodeCopyPreview content={preview.content} isPrompt={preview.isPrompt} />
      )}
    </BaseNode>
  );
}

export const SmsMessageNode = memo(SmsMessageNodeComponent);
