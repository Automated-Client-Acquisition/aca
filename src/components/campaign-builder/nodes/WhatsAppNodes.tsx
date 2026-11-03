import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { MessageCircle, Phone, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type {
  WhatsAppMessageNodeData,
  WhatsAppCheckNumberNodeData,
} from "@/lib/sequence-utils";

// WhatsApp Message Node
type WhatsAppMessageNodeProps = NodeProps<
  Node<WhatsAppMessageNodeData & Record<string, unknown>>
>;

function WhatsAppMessageNodeComponent({
  data,
  selected,
}: WhatsAppMessageNodeProps) {
  const preview = campaignNodeCopyPreview(data);
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <MessageCircle className="h-4 w-4" />
        )
      }
      label="Send WhatsApp"
      customLabel={data.customLabel || data.label}
      sublabel={preview.summary}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="whatsapp"
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

export const WhatsAppMessageNode = memo(WhatsAppMessageNodeComponent);

// WhatsApp Check Number Node (Condition)
type WhatsAppCheckNumberNodeProps = NodeProps<
  Node<WhatsAppCheckNumberNodeData & Record<string, unknown>>
>;

function WhatsAppCheckNumberNodeComponent({
  data,
  selected,
}: WhatsAppCheckNumberNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as WhatsAppCheckNumberNodeData;
  return (
    <BaseNode
      icon={<Phone className="h-3.5 w-3.5" />}
      label="Check WhatsApp Number"
      customLabel={nodeData.customLabel}
      sublabel="Verify number registered"
      category="condition"
      selected={selected}
      handles={{ source: ["hasWhatsapp", "noWhatsapp"], target: true }}
      channel="whatsapp"
      validation={validation}
    />
  );
}

export const WhatsAppCheckNumberNode = memo(WhatsAppCheckNumberNodeComponent);
