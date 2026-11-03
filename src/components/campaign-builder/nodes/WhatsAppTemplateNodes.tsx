import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { FileText } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import type { WhatsAppTemplateNodeData } from "@/lib/sequence-utils";

// WhatsApp Business template node (sent from the org's Twilio WhatsApp senders)
type WhatsAppTemplateNodeProps = NodeProps<
  Node<WhatsAppTemplateNodeData & Record<string, unknown>>
>;

function WhatsAppTemplateNodeComponent({ data, selected }: WhatsAppTemplateNodeProps) {
  const { data: templates = [] } = useWhatsAppTemplates();
  const template = templates.find((t) => t.id === data.templateId);
  const name = template?.name || data.templateName;
  return (
    <BaseNode
      icon={<FileText className="h-4 w-4" />}
      label="Send WhatsApp Template"
      customLabel={data.customLabel || data.label}
      sublabel={name ? `Template: ${name}` : "No template selected"}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="whatsapp"
      validation={data.__validation as NodeValidation | undefined}
    >
      {template?.body && <NodeCopyPreview content={template.body} />}
    </BaseNode>
  );
}

export const WhatsAppTemplateNode = memo(WhatsAppTemplateNodeComponent);
