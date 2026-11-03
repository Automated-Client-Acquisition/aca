import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { CircleAlert } from "lucide-react";
import { BaseNode } from "./BaseNode";

function UnknownNodeComponent({ data, selected, type }: NodeProps) {
  return (
    <BaseNode
      icon={<CircleAlert className="h-3.5 w-3.5" />}
      label="Removed Step"
      sublabel={`Type "${type}" is no longer available`}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={{ errors: ["This node type has been removed. Delete this node."], warnings: [] }}
    />
  );
}

export const UnknownNode = memo(UnknownNodeComponent);
