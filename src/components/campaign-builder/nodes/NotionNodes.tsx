import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { CreateNotionPageNodeData } from "@/lib/sequence-utils";
import { NOTION_BLUEPRINTS } from "@/lib/email-sequence-constants";

// Create Notion Page Node
type CreateNotionPageNodeProps = NodeProps<{ data: CreateNotionPageNodeData }>;

function getBlueprintSublabel(blueprintIds: string[] | undefined): string {
  if (!blueprintIds || blueprintIds.length === 0) return "Configure page";
  const names = blueprintIds
    .map((id) => NOTION_BLUEPRINTS.find((b) => b.id === id)?.name)
    .filter(Boolean);
  if (names.length === 0) return "Configure page";
  if (names.length === 1) return names[0]!;
  return `${names.length} blueprints`;
}

function CreateNotionPageNodeComponent({ data, selected }: CreateNotionPageNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as CreateNotionPageNodeData;

  return (
    <BaseNode
      icon={<FileText className="h-3.5 w-3.5" />}
      label="Create Notion Page"
      customLabel={nodeData.customLabel}
      sublabel={getBlueprintSublabel(nodeData.blueprintIds)}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="any"
      variant="notion"
      validation={validation}
    />
  );
}

export const CreateNotionPageNode = memo(CreateNotionPageNodeComponent);
