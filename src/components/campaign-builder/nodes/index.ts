// Base
export { BaseNode } from "./BaseNode";

// Terminal & Control
export { StartNode } from "./StartNode";
export { DelayNode } from "./DelayNode";

// LinkedIn nodes
export { ConnectionRequestNode } from "./ConnectionRequestNode";
export { MessageNode } from "./MessageNode";
export { InMailNode } from "./InMailNode";
export { ConditionConnectionNode, ConditionOpenProfileNode, ConditionIntentNode } from "./ConditionNode";
export { ViewProfileNode, FollowNode, LikePostNode, WarmupEngagementNode, EndNode } from "./ActionNodes";

// Control nodes
export { ConditionReplyReceivedNode, SwitchChannelNode, ConditionChannelAvailableNode, RouteByChannelNode, GoToNode } from "./ControlNodes";

// Multi-channel nodes
export { WhatsAppMessageNode, WhatsAppCheckNumberNode } from "./WhatsAppNodes";
export { InstagramDmNode, InstagramFollowNode, InstagramLikePostNode } from "./InstagramNodes";
export { TelegramMessageNode } from "./TelegramNodes";
export { SmsMessageNode } from "./SmsNodes";
export { WhatsAppTemplateNode } from "./WhatsAppTemplateNodes";
export { EmailNode, ConditionEmailOpenedNode, ConditionEmailClickedNode } from "./EmailNodes";
export { ScheduleMeetingNode } from "./CalendarNodes";

// Integration/Handoff nodes (email tool handoffs after LinkedIn outreach)
export { SendToSmartleadNode, SendToInstantlyNode, SendToLeadConnectorNode, SendToZapMailNode, FindEmailNode, AnalyzeContactNode, ConditionEnrichedNode, ConditionAnalyzedNode, VerifyEmailNode, ConditionIcpScoreNode, AddToListNode, HandoffToAgentNode } from "./IntegrationNodes";

// Notion nodes
export { CreateNotionPageNode } from "./NotionNodes";

export { GenerateEmailsNode } from "@/components/campaign-builder/nodes/GenerateEmailsNode";

// Fallback for removed/unknown node types
export { UnknownNode } from "./UnknownNode";
