import { MessageSquare, Mail, Database, FileText, Sparkles, ListPlus } from "lucide-react";
import { NODE_TYPE_CONFIGS, type SequenceNodeType, type SequenceNode } from "@/lib/sequence-utils";
import { NODE_ICONS, EMAIL_TOOL_TYPES, getFilteredNodeGroups, getEmailToolColorClass } from "@/lib/node-menu-shared";

interface NodeTypeMenuContentProps {
  existingNodes: SequenceNode[];
  onAddNode: (type: SequenceNodeType) => void;
  /** Types that make no sense in this spot (e.g. End when inserting mid-sequence). */
  excludeTypes?: SequenceNodeType[];
}

function renderItem(
  type: SequenceNodeType,
  onAddNode: (type: SequenceNodeType) => void,
  colorClass?: string
) {
  const config = NODE_TYPE_CONFIGS[type];
  const Icon = NODE_ICONS[type] || MessageSquare;
  return (
    <button
      key={type}
      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
      onClick={() => onAddNode(type)}
    >
      <Icon className={`h-4 w-4 shrink-0 ${colorClass || ""}`} />
      <span className="truncate">{config.label}</span>
    </button>
  );
}

function renderSection(
  label: string,
  items: SequenceNodeType[],
  onAddNode: (type: SequenceNodeType) => void,
  labelIcon?: typeof Sparkles,
  colorClass?: string
) {
  if (items.length === 0) return null;
  const LabelIcon = labelIcon;
  return (
    <div>
      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground flex items-center gap-1">
        {LabelIcon && <LabelIcon className="h-3 w-3" />}
        {label}
      </div>
      {items.map((type) => {
        let itemColor = colorClass;
        if (!itemColor && EMAIL_TOOL_TYPES.includes(type)) {
          itemColor = getEmailToolColorClass(type);
        }
        return renderItem(type, onAddNode, itemColor);
      })}
    </div>
  );
}

export function NodeTypeMenuContent({
  existingNodes,
  onAddNode,
  excludeTypes,
}: NodeTypeMenuContentProps) {
  const allGroups = getFilteredNodeGroups(existingNodes);
  const groups = excludeTypes?.length
    ? Object.fromEntries(Object.entries(allGroups).map(([key, items]) =>
      [key, items.filter(type => !excludeTypes.includes(type))])) as typeof allGroups
    : allGroups;

  return (
    <div className="space-y-1">
      {renderSection("LinkedIn Actions", groups.linkedInActions, onAddNode, undefined, "text-blue-600")}
      {renderSection("LinkedIn Conditions", groups.linkedInConditions, onAddNode)}
      {renderSection("Email", groups.emailActions, onAddNode, Mail, "text-red-500")}
      {renderSection("Email Conditions", groups.emailConditions, onAddNode, undefined, "text-red-500")}
      {renderSection("Channel Actions", groups.channelActions, onAddNode)}
      {renderSection("Channel Conditions", groups.channelConditions, onAddNode)}
      {renderSection("Enrichment", groups.enrichmentNodes, onAddNode, Database, "text-violet-500")}
      {renderSection("Enrichment Conditions", groups.enrichmentConditions, onAddNode, undefined, "text-violet-500")}
      {renderSection("Routing", groups.routingNodes, onAddNode, ListPlus, "text-emerald-600")}
      {renderSection("Notion", groups.notionNodes, onAddNode, FileText, "text-neutral-600")}
      {renderSection("Email Tools", groups.emailToolNodes, onAddNode, Sparkles)}
      {renderSection("Control", groups.controlNodes, onAddNode)}
      {renderSection("Terminal", groups.terminalNodes, onAddNode)}
    </div>
  );
}
