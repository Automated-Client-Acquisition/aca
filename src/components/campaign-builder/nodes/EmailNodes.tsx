import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Mail, MailOpen, MousePointerClick, Sparkles } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type {
  EmailNodeData,
  ConditionEmailOpenedNodeData,
  ConditionEmailClickedNodeData,
} from "@/lib/sequence-utils";

// Email Node
type EmailNodeProps = NodeProps<Node<EmailNodeData & Record<string, unknown>>>;

function EmailNodeComponent({ data, selected }: EmailNodeProps) {
  const preview = campaignNodeCopyPreview(data);
  return (
    <BaseNode
      icon={
        preview.isPrompt ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <Mail className="h-4 w-4" />
        )
      }
      label="Send Email"
      customLabel={data.customLabel || data.label}
      sublabel={preview.summary}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="email"
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

export const EmailNode = memo(EmailNodeComponent);

// Condition: Email Opened Node
type ConditionEmailOpenedNodeProps = NodeProps<
  Node<ConditionEmailOpenedNodeData & Record<string, unknown>>
>;

function ConditionEmailOpenedNodeComponent({
  data,
  selected,
}: ConditionEmailOpenedNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionEmailOpenedNodeData;
  return (
    <BaseNode
      icon={<MailOpen className="h-3.5 w-3.5" />}
      label="If Email Opened"
      customLabel={nodeData.customLabel}
      sublabel={`Within ${nodeData.withinDays || 7} days`}
      category="condition"
      selected={selected}
      handles={{ source: ["opened", "notOpened"], target: true }}
      channel="email"
      validation={validation}
    />
  );
}

export const ConditionEmailOpenedNode = memo(ConditionEmailOpenedNodeComponent);

// Condition: Email Clicked Node
type ConditionEmailClickedNodeProps = NodeProps<
  Node<ConditionEmailClickedNodeData & Record<string, unknown>>
>;

function ConditionEmailClickedNodeComponent({
  data,
  selected,
}: ConditionEmailClickedNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionEmailClickedNodeData;
  return (
    <BaseNode
      icon={<MousePointerClick className="h-3.5 w-3.5" />}
      label="If Link Clicked"
      customLabel={nodeData.customLabel}
      sublabel={`Within ${nodeData.withinDays || 7} days`}
      category="condition"
      selected={selected}
      handles={{ source: ["clicked", "notClicked"], target: true }}
      channel="email"
      validation={validation}
    />
  );
}

export const ConditionEmailClickedNode = memo(
  ConditionEmailClickedNodeComponent,
);
