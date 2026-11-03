import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Mail, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignInMailCopyPreview } from "@/lib/campaign-node-preview";
import type { InMailNodeData } from "@/lib/sequence-utils";

type InMailNodeProps = NodeProps<
  Node<InMailNodeData & Record<string, unknown>>
>;

function InMailNodeComponent({ data, selected }: InMailNodeProps) {
  const preview = campaignInMailCopyPreview(data);
  const validation = data.__validation as NodeValidation | undefined;
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <Mail className="h-4 w-4" />
        )
      }
      label="Send InMail"
      customLabel={data.customLabel || data.label}
      sublabel={preview.needsPrimaryMessage ? "Saved variation · Needs primary message" : preview.summary}
      category="action"
      channel="linkedin"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={preview.needsPrimaryMessage ? { errors: [...(validation?.errors || []), "Choose a primary message before sending this InMail."], warnings: validation?.warnings || [] } : validation}
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

export const InMailNode = memo(InMailNodeComponent);
