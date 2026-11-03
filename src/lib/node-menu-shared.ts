import {
  UserPlus,
  MessageSquare,
  Mail,
  MailOpen,
  MousePointerClick,
  MessageCircle,
  Instagram,
  Send,
  Clock,
  GitBranch,
  Eye,
  Phone,
  UserCheck,
  ThumbsUp,
  Heart,
  Calendar,
  ArrowRightLeft,
  Flag,
  Zap,
  ArrowRight,
  Sparkles,
  Search,
  FileText,
  Plus,
  Brain,
  CornerDownLeft,
  MailPlus,
  MailCheck,
  Target,
  ListPlus,
  Bot,
  Split,
  MessageSquareText,
} from "lucide-react";
import {
  NODE_TYPE_CONFIGS,
  getAvailableNodeTypes,
  type SequenceNodeType,
  type SequenceNode,
} from "@/lib/sequence-utils";

export const NODE_ICONS: Partial<Record<SequenceNodeType, typeof Plus>> = {
  start: Plus,
  end: Flag,
  delay: Clock,
  switchChannel: ArrowRightLeft,
  conditionReplyReceived: MessageSquare,
  conditionIntent: Brain,
  handoffToAgent: Bot,
  conditionChannelAvailable: GitBranch,
  routeByChannel: Split,
  connectionRequest: UserPlus,
  message: MessageSquare,
  inmail: Mail,
  viewProfile: Eye,
  follow: UserCheck,
  likePost: ThumbsUp,
  warmupEngagement: Sparkles,
  conditionConnection: GitBranch,
  conditionOpenProfile: GitBranch,
  whatsappMessage: MessageCircle,
  whatsappCheckNumber: Phone,
  instagramDm: Instagram,
  instagramFollow: UserPlus,
  instagramLikePost: Heart,
  telegramMessage: Send,
  smsMessage: MessageSquareText,
  whatsappTemplate: FileText,
  scheduleMeeting: Calendar,
  sendToSmartlead: Zap,
  sendToInstantly: Zap,
  sendToLeadConnector: ArrowRight,
  sendToZapMail: Mail,
  email: Mail,
  conditionEmailOpened: MailOpen,
  conditionEmailClicked: MousePointerClick,
  findEmail: Search,
  analyzeContact: Brain,
  generateEmails: MailPlus,
  verifyEmail: MailCheck,
  conditionEnriched: GitBranch,
  conditionAnalyzed: Brain,
  conditionIcpScore: Target,
  addToList: ListPlus,
  createNotionPage: FileText,
  goTo: CornerDownLeft,
};

export const LINKEDIN_ACTION_TYPES: SequenceNodeType[] = [
  "connectionRequest",
  "message",
  "inmail",
  "viewProfile",
  "follow",
  "likePost",
  "warmupEngagement",
];

export const LINKEDIN_CONDITION_TYPES: SequenceNodeType[] = [
  "conditionConnection",
  "conditionOpenProfile",
];

export const CHANNEL_ACTION_TYPES: SequenceNodeType[] = [
  "whatsappMessage",
  "instagramDm",
  "instagramFollow",
  "instagramLikePost",
  "telegramMessage",
  "smsMessage",
  "whatsappTemplate",
  "scheduleMeeting",
];

export const CHANNEL_CONDITION_TYPES: SequenceNodeType[] = [
  "conditionReplyReceived",
  "conditionIntent",
  "conditionChannelAvailable",
  "routeByChannel",
  "whatsappCheckNumber",
];

export const CONTROL_TYPES: SequenceNodeType[] = ["delay", "switchChannel", "goTo"];

export const EMAIL_TOOL_TYPES: SequenceNodeType[] = [
  "sendToSmartlead",
  "sendToInstantly",
  "sendToLeadConnector",
  "sendToZapMail",
];

export const EMAIL_ACTION_TYPES: SequenceNodeType[] = ["email"];

export const EMAIL_CONDITION_TYPES: SequenceNodeType[] = [
  "conditionEmailOpened",
  "conditionEmailClicked",
];

export const ENRICHMENT_TYPES: SequenceNodeType[] = ["findEmail", "analyzeContact", "generateEmails", "verifyEmail"];

export const ENRICHMENT_CONDITION_TYPES: SequenceNodeType[] = ["conditionEnriched", "conditionAnalyzed", "conditionIcpScore"];

export const ROUTING_TYPES: SequenceNodeType[] = ["addToList", "handoffToAgent"];

export const NOTION_TYPES: SequenceNodeType[] = ["createNotionPage"];

export interface FilteredNodeGroups {
  linkedInActions: SequenceNodeType[];
  linkedInConditions: SequenceNodeType[];
  emailActions: SequenceNodeType[];
  emailConditions: SequenceNodeType[];
  channelActions: SequenceNodeType[];
  channelConditions: SequenceNodeType[];
  controlNodes: SequenceNodeType[];
  emailToolNodes: SequenceNodeType[];
  enrichmentNodes: SequenceNodeType[];
  enrichmentConditions: SequenceNodeType[];
  routingNodes: SequenceNodeType[];
  notionNodes: SequenceNodeType[];
  terminalNodes: SequenceNodeType[];
}

export function getFilteredNodeGroups(existingNodes: SequenceNode[]): FilteredNodeGroups {
  const availableTypes = getAvailableNodeTypes(existingNodes);
  return {
    linkedInActions: LINKEDIN_ACTION_TYPES.filter((t) => availableTypes.includes(t)),
    linkedInConditions: LINKEDIN_CONDITION_TYPES.filter((t) => availableTypes.includes(t)),
    emailActions: EMAIL_ACTION_TYPES.filter((t) => availableTypes.includes(t)),
    emailConditions: EMAIL_CONDITION_TYPES.filter((t) => availableTypes.includes(t)),
    channelActions: CHANNEL_ACTION_TYPES.filter((t) => availableTypes.includes(t)),
    channelConditions: CHANNEL_CONDITION_TYPES.filter((t) => availableTypes.includes(t)),
    controlNodes: CONTROL_TYPES.filter((t) => availableTypes.includes(t)),
    emailToolNodes: EMAIL_TOOL_TYPES.filter((t) => availableTypes.includes(t)),
    enrichmentNodes: ENRICHMENT_TYPES.filter((t) => availableTypes.includes(t)),
    enrichmentConditions: ENRICHMENT_CONDITION_TYPES.filter((t) => availableTypes.includes(t)),
    routingNodes: ROUTING_TYPES.filter((t) => availableTypes.includes(t)),
    notionNodes: NOTION_TYPES.filter((t) => availableTypes.includes(t)),
    terminalNodes: availableTypes.filter(
      (t) => NODE_TYPE_CONFIGS[t].category === "terminal" && t !== "start"
    ),
  };
}

export function getEmailToolColorClass(type: SequenceNodeType): string {
  if (type === "sendToSmartlead") return "text-blue-500";
  if (type === "sendToInstantly") return "text-orange-500";
  if (type === "sendToZapMail") return "text-emerald-600";
  return "text-emerald-500";
}
