import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Calendar } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { ScheduleMeetingNodeData } from "@/lib/sequence-utils";

// Trigger condition labels
const TRIGGER_LABELS: Record<string, string> = {
  positive_reply: "On positive reply",
  any_reply: "On any reply",
  manual: "Manual trigger",
};

// Conference provider labels
const PROVIDER_LABELS: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  none: "No video call",
};

// Schedule Meeting Node
type ScheduleMeetingNodeProps = NodeProps<{ data: ScheduleMeetingNodeData }>;

function ScheduleMeetingNodeComponent({ data, selected }: ScheduleMeetingNodeProps) {
  const validation = (data as any)?.__validation;
  const nodeData = data as unknown as ScheduleMeetingNodeData;
  const triggerLabel = TRIGGER_LABELS[nodeData.triggerCondition] || "Select trigger";
  const duration = nodeData.durationMinutes || 30;
  const provider = PROVIDER_LABELS[nodeData.conferenceProvider] || "";

  const sublabelParts = [triggerLabel];
  if (duration) {
    sublabelParts.push(`${duration} min`);
  }
  if (provider && nodeData.conferenceProvider !== "none") {
    sublabelParts.push(provider);
  }

  return (
    <BaseNode
      icon={<Calendar className="h-3.5 w-3.5" />}
      label="Schedule Meeting"
      customLabel={nodeData.customLabel}
      sublabel={sublabelParts.join(" · ")}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      validation={validation}
    />
  );
}

export const ScheduleMeetingNode = memo(ScheduleMeetingNodeComponent);
