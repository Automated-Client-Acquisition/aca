import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { Zap, Send, ArrowRight, Search, Sparkles, Mail, Brain, GitBranch, MailCheck, Target, ListPlus, Bot } from "lucide-react";
import { BaseNode, type NodeValidation } from "@/components/campaign-builder/nodes/BaseNode";
import { NodeCopyPreview } from "@/components/campaign-builder/nodes/NodeCopyPreview";
import { campaignNodeCopyPreview } from "@/lib/campaign-node-preview";
import type { SendToEmailToolNodeData, FindEmailNodeData, AnalyzeContactNodeData, ConditionEnrichedNodeData, ConditionAnalyzedNodeData, VerifyEmailNodeData, ConditionIcpScoreNodeData, AddToListNodeData, HandoffToAgentNodeData } from "@/lib/sequence-utils";

// Helper to build sublabel for email tool nodes
function getEmailToolSublabel(nodeData: SendToEmailToolNodeData, requiresCampaign: boolean): string {
  const isPromptMode = nodeData.messageMode === "prompt";
  const hasConfig = requiresCampaign
    ? nodeData.connectionId && nodeData.externalCampaignId
    : true; // LeadConnector doesn't require campaign selection

  if (!hasConfig) return "Configure handoff";

  if (isPromptMode) {
    const hasPrompt = nodeData.prompt && nodeData.prompt.trim().length > 0;
    const reviewTag = nodeData.requireReview !== false ? " · Review" : "";
    if (hasPrompt) return `AI · ${nodeData.emailCount || 3} emails${reviewTag}`;
    return "AI · No prompt";
  }

  const hasEmail = nodeData.emailSubject && nodeData.emailBody;
  return hasEmail ? "Manual email" : "Configure handoff";
}

// Send to Smartlead Node
type SendToSmartleadNodeProps = NodeProps<Node<SendToEmailToolNodeData & Record<string, unknown>>>;

function SendToSmartleadNodeComponent({ data, selected }: SendToSmartleadNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as SendToEmailToolNodeData;
  const isPromptMode = nodeData.messageMode === "prompt";
  const preview = campaignNodeCopyPreview(nodeData);

  return (
    <BaseNode
      icon={isPromptMode ? <Sparkles className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
      label="Send to Smartlead"
      customLabel={nodeData.customLabel}
      sublabel={getEmailToolSublabel(nodeData, true)}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="email"
      variant="smartlead"
      validation={validation}
    >
      {(preview.content || preview.subject) && <NodeCopyPreview content={preview.content} subject={preview.subject} isPrompt={preview.isPrompt} />}
    </BaseNode>
  );
}

export const SendToSmartleadNode = memo(SendToSmartleadNodeComponent);

// Send to Instantly Node
type SendToInstantlyNodeProps = NodeProps<Node<SendToEmailToolNodeData & Record<string, unknown>>>;

function SendToInstantlyNodeComponent({ data, selected }: SendToInstantlyNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as SendToEmailToolNodeData;
  const isPromptMode = nodeData.messageMode === "prompt";
  const preview = campaignNodeCopyPreview(nodeData);

  return (
    <BaseNode
      icon={isPromptMode ? <Sparkles className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
      label="Send to Instantly"
      customLabel={nodeData.customLabel}
      sublabel={getEmailToolSublabel(nodeData, true)}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="email"
      variant="instantly"
      validation={validation}
    >
      {(preview.content || preview.subject) && <NodeCopyPreview content={preview.content} subject={preview.subject} isPrompt={preview.isPrompt} />}
    </BaseNode>
  );
}

export const SendToInstantlyNode = memo(SendToInstantlyNodeComponent);

// Send to LeadConnector Node
type SendToLeadConnectorNodeProps = NodeProps<Node<SendToEmailToolNodeData & Record<string, unknown>>>;

function SendToLeadConnectorNodeComponent({ data, selected }: SendToLeadConnectorNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as SendToEmailToolNodeData;
  const isPromptMode = nodeData.messageMode === "prompt";
  const preview = campaignNodeCopyPreview(nodeData);

  return (
    <BaseNode
      icon={isPromptMode ? <Sparkles className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
      label="Send to LeadConnector"
      customLabel={nodeData.customLabel}
      sublabel={getEmailToolSublabel(nodeData, false)}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="email"
      variant="leadconnector"
      validation={validation}
    >
      {(preview.content || preview.subject) && <NodeCopyPreview content={preview.content} subject={preview.subject} isPrompt={preview.isPrompt} />}
    </BaseNode>
  );
}

export const SendToLeadConnectorNode = memo(SendToLeadConnectorNodeComponent);

// Send to ZapMail Node (Internal Email Engine)
type SendToZapMailNodeProps = NodeProps<Node<SendToEmailToolNodeData & Record<string, unknown>>>;

function SendToZapMailNodeComponent({ data, selected }: SendToZapMailNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as SendToEmailToolNodeData;
  const isPromptMode = nodeData.messageMode === "prompt";
  const isExistingMode = nodeData.enrollmentMode === "existing";
  const preview = campaignNodeCopyPreview(nodeData);

  let sublabel: string;
  if (isExistingMode) {
    sublabel = nodeData.existingSequenceName || (nodeData.existingSequenceId ? "Sequence selected" : "Select sequence");
  } else if (!isPromptMode) {
    // Manual mode — always 1 email
    const hasEmail = nodeData.emailSubject && nodeData.emailBody;
    sublabel = hasEmail ? "New · 1 email" : "Configure email";
  } else {
    sublabel = getEmailToolSublabel(nodeData, false);
  }

  return (
    <BaseNode
      icon={isPromptMode && !isExistingMode ? <Sparkles className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
      label="Enroll in Sequence"
      customLabel={nodeData.customLabel}
      sublabel={sublabel}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="email"
      variant="zapmail"
      validation={validation}
    >
      {!isExistingMode && (preview.content || preview.subject) && <NodeCopyPreview content={preview.content} subject={preview.subject} isPrompt={preview.isPrompt} />}
    </BaseNode>
  );
}

export const SendToZapMailNode = memo(SendToZapMailNodeComponent);

// Find Email Node (Enrichment)
type FindEmailNodeProps = NodeProps<Node<FindEmailNodeData & Record<string, unknown>>>;

const PROVIDER_LABELS: Record<string, string> = {
  auto: "Auto (use priority)",
  apollo: "Apollo.io",
  prospeo: "Prospeo",
  moltsets: "MoltSets",
  quickenrich: "QuickEnrich",
};

function FindEmailNodeComponent({ data, selected }: FindEmailNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as FindEmailNodeData;
  const providerLabel = PROVIDER_LABELS[nodeData.provider] || "Auto";

  return (
    <BaseNode
      icon={<Search className="h-3.5 w-3.5" />}
      label="Find Email"
      customLabel={nodeData.customLabel}
      sublabel={providerLabel}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="any"
      variant="enrichment"
      validation={validation}
    />
  );
}

export const FindEmailNode = memo(FindEmailNodeComponent);

// Analyze Contact Node (Enrichment)
type AnalyzeContactNodeProps = NodeProps<Node<AnalyzeContactNodeData & Record<string, unknown>>>;

function AnalyzeContactNodeComponent({ data, selected }: AnalyzeContactNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as AnalyzeContactNodeData;
  const skipLabel = nodeData.skipIfAlreadyEnriched !== false ? "Skip enriched" : "Always run";

  return (
    <BaseNode
      icon={<Brain className="h-3.5 w-3.5" />}
      label="Analyze Contact"
      customLabel={nodeData.customLabel}
      sublabel={skipLabel}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="any"
      variant="enrichment"
      validation={validation}
    />
  );
}

export const AnalyzeContactNode = memo(AnalyzeContactNodeComponent);

// Condition: If Enriched
type ConditionEnrichedNodeProps = NodeProps<Node<ConditionEnrichedNodeData & Record<string, unknown>>>;

function ConditionEnrichedNodeComponent({ data, selected }: ConditionEnrichedNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionEnrichedNodeData;
  return (
    <BaseNode
      icon={<GitBranch className="h-3.5 w-3.5" />}
      label="If Enriched"
      customLabel={nodeData.customLabel}
      sublabel="Has AI analysis data?"
      category="condition"
      selected={selected}
      handles={{ source: ["enriched", "notEnriched"], target: true }}
      channel="any"
      validation={validation}
    />
  );
}

export const ConditionEnrichedNode = memo(ConditionEnrichedNodeComponent);

// Condition: If Analyzed
type ConditionAnalyzedNodeProps = NodeProps<Node<ConditionAnalyzedNodeData & Record<string, unknown>>>;

function ConditionAnalyzedNodeComponent({ data, selected }: ConditionAnalyzedNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionAnalyzedNodeData;
  return (
    <BaseNode
      icon={<Brain className="h-3.5 w-3.5" />}
      label="If Analyzed"
      customLabel={nodeData.customLabel}
      sublabel="Was analyzed in this campaign?"
      category="condition"
      selected={selected}
      handles={{ source: ["analyzed", "notAnalyzed"], target: true }}
      channel="any"
      validation={validation}
    />
  );
}

export const ConditionAnalyzedNode = memo(ConditionAnalyzedNodeComponent);

// Verify Email Node (Enrichment action + gate)
const VERIFY_PROVIDER_LABELS: Record<string, string> = {
  lite: "Lite (free)",
  apify_million_verifier: "Full (SMTP)",
  mailtester_ninja: "Mailtester Ninja",
};

type VerifyEmailNodeProps = NodeProps<Node<VerifyEmailNodeData & Record<string, unknown>>>;

function VerifyEmailNodeComponent({ data, selected }: VerifyEmailNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as VerifyEmailNodeData;
  const providerLabel = VERIFY_PROVIDER_LABELS[nodeData.provider] || "Mailtester Ninja";
  return (
    <BaseNode
      icon={<MailCheck className="h-3.5 w-3.5" />}
      label="Verify Email"
      customLabel={nodeData.customLabel}
      sublabel={providerLabel}
      category="action"
      selected={selected}
      handles={{ source: ["clean", "risky", "failed"], target: true }}
      channel="any"
      variant="enrichment"
      validation={validation}
    />
  );
}

export const VerifyEmailNode = memo(VerifyEmailNodeComponent);

// Condition: If ICP Score (gate)
type ConditionIcpScoreNodeProps = NodeProps<Node<ConditionIcpScoreNodeData & Record<string, unknown>>>;

function ConditionIcpScoreNodeComponent({ data, selected }: ConditionIcpScoreNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as ConditionIcpScoreNodeData;
  const scoreLabel = nodeData.scoreType === "dm" ? "DM" : "ICP";
  return (
    <BaseNode
      icon={<Target className="h-3.5 w-3.5" />}
      label={`If ${scoreLabel} Score`}
      customLabel={nodeData.customLabel}
      sublabel={`≥ ${nodeData.minScore ?? 50}`}
      category="condition"
      selected={selected}
      handles={{ source: ["pass", "fail"], target: true }}
      channel="any"
      validation={validation}
    />
  );
}

export const ConditionIcpScoreNode = memo(ConditionIcpScoreNodeComponent);

// Add to List Node (Routing action)
type AddToListNodeProps = NodeProps<Node<AddToListNodeData & Record<string, unknown>>>;

function AddToListNodeComponent({ data, selected }: AddToListNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as AddToListNodeData;
  return (
    <BaseNode
      icon={<ListPlus className="h-3.5 w-3.5" />}
      label="Add to List"
      customLabel={nodeData.customLabel}
      sublabel={nodeData.listId ? "Target list set" : "No list selected"}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="any"
      variant="enrichment"
      validation={validation}
    />
  );
}

export const AddToListNode = memo(AddToListNodeComponent);

// Hand off to AI Agent
type HandoffToAgentNodeProps = NodeProps<Node<HandoffToAgentNodeData & Record<string, unknown>>>;

function HandoffToAgentNodeComponent({ data, selected }: HandoffToAgentNodeProps) {
  const validation = data.__validation as NodeValidation | undefined;
  const nodeData = data as unknown as HandoffToAgentNodeData;
  const sublabel = nodeData.agentProfileId
    ? (nodeData.exitAfterHandoff !== false ? "Custom agent · Exits" : "Custom agent")
    : (nodeData.exitAfterHandoff !== false ? "Campaign agent · Exits" : "Campaign agent");
  return (
    <BaseNode
      icon={<Bot className="h-3.5 w-3.5" />}
      label="Hand off to AI Agent"
      customLabel={nodeData.customLabel}
      sublabel={sublabel}
      category="action"
      selected={selected}
      handles={{ source: ["default"], target: true }}
      channel="any"
      variant="enrichment"
      validation={validation}
    />
  );
}

export const HandoffToAgentNode = memo(HandoffToAgentNodeComponent);
