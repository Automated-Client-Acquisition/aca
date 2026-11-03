import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { GitBranch, Brain } from "lucide-react";
import { BaseNode, type NodeValidation } from "@/components/campaign-builder/nodes/BaseNode";
import type { ConditionNodeData, ConditionIntentNodeData } from "@/lib/sequence-utils";

// Connection condition
type ConditionConnectionNodeProps = NodeProps<Node<ConditionNodeData & Record<string, unknown>>>;

function ConditionConnectionNodeComponent({ data, selected }: ConditionConnectionNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionNodeData;
  return (
    <BaseNode
      icon={<GitBranch className="h-3.5 w-3.5" />}
      label="If Connection"
      customLabel={nodeData.customLabel}
      sublabel={`Within ${nodeData.withinDays || 14} days`}
      category="condition"
      selected={selected}
      handles={{ source: ["accepted", "notAccepted"], target: true }}
      validation={validation}
    />
  );
}

export const ConditionConnectionNode = memo(ConditionConnectionNodeComponent);

// Open profile condition
type ConditionOpenProfileNodeProps = NodeProps<Node<ConditionNodeData & Record<string, unknown>>>;

function ConditionOpenProfileNodeComponent({ data, selected }: ConditionOpenProfileNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionNodeData;
  return (
    <BaseNode
      icon={<GitBranch className="h-3.5 w-3.5" />}
      label="If Open Profile"
      customLabel={nodeData.customLabel}
      sublabel="Branch on profile type"
      category="condition"
      selected={selected}
      handles={{ source: ["open", "closed"], target: true }}
      validation={validation}
    />
  );
}

export const ConditionOpenProfileNode = memo(ConditionOpenProfileNodeComponent);

// Reply-intent condition (LLM-powered)
type ConditionIntentNodeProps = NodeProps<Node<ConditionIntentNodeData & Record<string, unknown>>>;

function ConditionIntentNodeComponent({ data, selected }: ConditionIntentNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionIntentNodeData;
  return (
    <BaseNode
      icon={<Brain className="h-3.5 w-3.5" />}
      label="Check Reply Intent"
      customLabel={nodeData.customLabel}
      sublabel={`Replies from the last ${nodeData.withinDays || 14} days`}
      category="condition"
      selected={selected}
      handles={{
        source: [
          "interested",
          "meeting_booked",
          "not_interested",
          "out_of_office",
          "auto_reply",
          "neutral",
          "no_reply",
        ],
        target: true,
      }}
      validation={validation}
    />
  );
}

export const ConditionIntentNode = memo(ConditionIntentNodeComponent);
