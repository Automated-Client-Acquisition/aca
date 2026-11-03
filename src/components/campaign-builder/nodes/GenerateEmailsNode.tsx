import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { MailPlus } from "lucide-react";
import { BaseNode, type NodeValidation } from "@/components/campaign-builder/nodes/BaseNode";
import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type { GenerateEmailsNodeData } from "@/lib/sequence-utils";

function GenerateEmailsNodeComponent({ data, selected }: NodeProps<Node<GenerateEmailsNodeData & Record<string, unknown>>>) {
  const preview = campaignNodeCopyPreview(data);
  const count = data.emailCount || 3;
  return (
    <BaseNode
      icon={<MailPlus className="h-4 w-4" />}
      label="Generate Emails"
      customLabel={data.customLabel || data.label}
      sublabel={preview.content ? `AI · ${count} ${count === 1 ? "email" : "emails"}` : "Add an AI prompt"}
      category="action"
      channel="email"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={data.__validation as NodeValidation | undefined}
    >
      {preview.content && <NodeCopyPreview content={preview.content} isPrompt />}
    </BaseNode>
  );
}

export const GenerateEmailsNode = memo(GenerateEmailsNodeComponent);
