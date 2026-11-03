import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Clock } from "lucide-react";
import { BaseNode, type NodeValidation } from "@/components/campaign-builder/nodes/BaseNode";
import type { DelayNodeData } from "@/lib/sequence-utils";

type DelayNodeProps = NodeProps<Node<DelayNodeData & Record<string, unknown>>>;

function DelayNodeComponent({ data, selected }: DelayNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as DelayNodeData;
  const days = nodeData.days || 0;
  const hours = nodeData.hours || 0;
  const minutes = nodeData.minutes || 0;

  const formatDelay = () => {
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
    if (minutes > 0) parts.push(`${minutes} min`);
    return parts.length > 0 ? parts.join(" ") : "No delay";
  };

  return (
    <BaseNode
      icon={<Clock className="h-3.5 w-3.5" />}
      label="Wait"
      customLabel={nodeData.customLabel}
      sublabel={formatDelay()}
      category="control"
      appearance="compact"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const DelayNode = memo(DelayNodeComponent);
