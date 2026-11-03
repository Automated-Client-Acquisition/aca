import { memo, useContext } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Play, Users } from "lucide-react";
import {
  BaseNode,
  type NodeValidation,
} from "@/components/campaign-builder/nodes/BaseNode";
import { CampaignAudienceContext, CampaignEntryContext } from "@/components/campaign-builder/CampaignEntryContext";
import type { StartNodeData } from "@/lib/sequence-utils";

type StartNodeProps = NodeProps<Node<StartNodeData & Record<string, unknown>>>;

function StartNodeComponent({ data, selected }: StartNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data;
  const count = useContext(CampaignEntryContext).filter(
    (rule) => rule.enabled,
  ).length;
  const audience = useContext(CampaignAudienceContext);
  const total = audience.reduce((sum, list) => sum + list.count, 0).toLocaleString();
  const triggers = count ? ` · ${count} trigger${count === 1 ? "" : "s"}` : "";
  // With lead lists attached, Start reads as the audience: "Lead list / Name · 640".
  const sublabel = audience.length === 1
    ? `${audience[0].name} · ${total}${triggers}`
    : audience.length > 1
      ? `${audience.length} lists · ${total}${triggers}`
      : undefined;
  return (
    <BaseNode
      icon={audience.length ? <Users className="h-4 w-4" /> : <Play className="h-3.5 w-3.5" />}
      label={
        audience.length
          ? audience.length === 1 ? "Lead list" : "Lead lists"
          : count
            ? `Start · ${count} entry trigger${count === 1 ? "" : "s"}`
            : "Campaign Start"
      }
      sublabel={sublabel}
      customLabel={nodeData.customLabel}
      category="terminal"
      selected={selected}
      handles={{ source: ["default"], target: false }}
      validation={validation}
    />
  );
}

export const StartNode = memo(StartNodeComponent);
