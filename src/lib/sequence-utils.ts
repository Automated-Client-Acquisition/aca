import type { Node, Edge, XYPosition } from '@xyflow/react';
import { DEFAULT_LLM_MODEL } from '@/lib/llm-models';

// Channel type for multi-channel support
export type ChannelType = 'linkedin' | 'email' | 'whatsapp' | 'instagram' | 'telegram' | 'sms' | 'messenger' | 'twitter' | 'any';

// Node types available in the sequence builder
export type SequenceNodeType =
  // Terminal nodes
  | 'start'
  | 'end'

  // Control nodes (channel-agnostic)
  | 'delay'
  | 'switchChannel'
  | 'goTo'
  | 'conditionChannelAvailable'
  | 'routeByChannel'
  | 'conditionReplyReceived'
  | 'conditionIntent'
  | 'handoffToAgent'

  // LinkedIn nodes
  | 'connectionRequest'
  | 'message'
  | 'inmail'
  | 'viewProfile'
  | 'follow'
  | 'likePost'
  | 'warmupEngagement'
  | 'conditionConnection'
  | 'conditionOpenProfile'

  // Email nodes (direct send via SMTP mailboxes)
  | 'email'
  | 'conditionEmailOpened'
  | 'conditionEmailClicked'

  // WhatsApp nodes
  | 'whatsappMessage'
  | 'whatsappCheckNumber'

  // Instagram nodes
  | 'instagramDm'
  | 'instagramFollow'
  | 'instagramLikePost'

  // Telegram nodes
  | 'telegramMessage'

  // SMS nodes (Twilio senders)
  | 'smsMessage'

  // WhatsApp Business template (Twilio senders)
  | 'whatsappTemplate'

  // Calendar nodes
  | 'scheduleMeeting'

  // Email Tool Handoff nodes (push to external email tools)
  | 'sendToSmartlead'
  | 'sendToInstantly'
  | 'sendToLeadConnector'
  | 'sendToZapMail'

  // Enrichment nodes
  | 'findEmail'
  | 'analyzeContact'
  | 'generateEmails'
  | 'verifyEmail'
  | 'conditionEnriched'
  | 'conditionAnalyzed'
  | 'conditionIcpScore'

  // Routing nodes
  | 'addToList'

  // Notion nodes
  | 'createNotionPage';

// Message mode: manual (static template) or prompt (AI-generated at execution time)
export type MessageMode = 'manual' | 'prompt';

// Node data structures
export interface BaseNodeData {
  label?: string;
  customLabel?: string;
  /** Whether to continue to next node on failure instead of blocking the campaign */
  continueOnFailure?: boolean;
}

export interface StartNodeData extends BaseNodeData {
  // No additional data for start node
}

export interface ConnectionRequestNodeData extends BaseNodeData {
  message: string;
  messageVariations: string[];
  withdrawAfterDays: number;
  fallbackMessage?: string;
  // AI prompt mode fields
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

export interface MessageNodeData extends BaseNodeData {
  message: string;
  messageVariations: string[];
  // AI prompt mode fields
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

export interface InMailNodeData extends BaseNodeData {
  subject: string;
  message: string;
  messageVariations: { subject: string; message: string }[];
  // AI prompt mode fields (subject stays manual, only body uses prompt)
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

export interface DelayNodeData extends BaseNodeData {
  days: number;
  hours: number;
  minutes?: number;
}

export interface ConditionNodeData extends BaseNodeData {
  withinDays?: number;
}

export interface ViewProfileNodeData extends BaseNodeData {
  // No additional data
}

export interface FollowNodeData extends BaseNodeData {
  // No additional data
}

export interface LikePostNodeData extends BaseNodeData {
  likeCount: number; // How many recent posts to like (1-3)
}

export type WarmupReactionType = 'like' | 'celebrate' | 'support' | 'love' | 'insightful' | 'funny';

export interface WarmupEngagementNodeData extends BaseNodeData {
  /** Type of engagement: react to post, comment on post, or both */
  engagementType: 'reaction' | 'comment' | 'both';
  /** Reaction type to use (if engagementType includes reaction) */
  reactionType: WarmupReactionType;
  /** Comment templates (if engagementType includes comment) */
  commentTemplates: string[];
  /** Number of posts to engage with (1-3) */
  postCount: number;
  /** Whether to only engage with posts that have high engagement (more visible) */
  preferHighEngagement: boolean;
  /** Minimum days since last engagement before engaging again */
  cooldownDays: number;
}

export interface EndNodeData extends BaseNodeData {
  // No additional data
}

// ============================================================================
// NEW MULTI-CHANNEL NODE DATA INTERFACES
// ============================================================================

// Control nodes
export interface SwitchChannelNodeData extends BaseNodeData {
  targetChannel: ChannelType;
  fallbackChannel?: ChannelType;
}

export interface GoToNodeData extends BaseNodeData {
  targetNodeId?: string;
}

// What an "If Channel Available" node checks. Mirrors
// supabase/functions/_shared/contact-checks.ts, which runs them.
export type ContactCheck =
  | 'linkedinUrl'
  | 'linkedinOnUnipile'
  | 'linkedinConnected'
  | 'email'
  | 'instagram'
  | 'instagramOnUnipile'
  | 'phone'
  | 'whatsappRegistered'
  | 'smsMobile'
  | 'telegram'
  | 'senderConnected'
  | 'enteredViaTrigger'
  | 'enteredOnChannel';

export interface ConditionChannelAvailableNodeData extends BaseNodeData {
  /** Absent on nodes saved before checks existed; `channel` decides then (see resolveContactCheck). */
  check?: ContactCheck;
  /** The channel for "Sender connected" and "Came in on a channel". On older nodes, the channel being checked. */
  channel: ChannelType;
  /** "Came in through a trigger": the campaign entry rule id. Empty means any trigger. */
  triggerId?: string;
  checkRegistration?: boolean; // Older WhatsApp nodes: check the number is registered
}

export type RouteChannel = 'linkedin' | 'email' | 'instagram' | 'whatsapp' | 'telegram' | 'sms';

export interface RouteByChannelNodeData extends BaseNodeData {
  /** Channels in priority order. Each lead goes down the first one it can be reached on. */
  channels: RouteChannel[];
  /** Skip channels the campaign has no sender on, and wait while that sender is disconnected (default on). */
  requireSender?: boolean;
  /** Confirm LinkedIn, Instagram and WhatsApp on Unipile instead of trusting the stored URL, handle or number. */
  verifyOnUnipile?: boolean;
  /** For leads a trigger brought in, try the channel they reached out on first (when listed). */
  entryChannelFirst?: boolean;
}

export interface ContactCheckOption {
  value: ContactCheck;
  label: string;
  description: string;
  /** contact: stored data. unipile: asks Unipile through a sender. entry: how a trigger brought the lead in. */
  group: 'contact' | 'unipile' | 'entry';
}

export const CONTACT_CHECK_OPTIONS: ContactCheckOption[] = [
  { value: 'linkedinUrl', group: 'contact', label: 'Has a LinkedIn URL', description: 'A LinkedIn profile URL or resolved LinkedIn profile is on the contact.' },
  { value: 'email', group: 'contact', label: 'Has an email', description: 'An email address is on the contact.' },
  { value: 'instagram', group: 'contact', label: 'Has an Instagram handle', description: "The contact's Instagram field, an instagram custom field, or a resolved Instagram profile." },
  { value: 'phone', group: 'contact', label: 'Has a phone number', description: 'Any phone number is on the contact.' },
  { value: 'telegram', group: 'contact', label: 'Has Telegram', description: 'A Telegram account is linked to the contact.' },
  { value: 'smsMobile', group: 'contact', label: 'Can receive SMS', description: 'The contact has a mobile number with a known country (landlines and unusable numbers fail).' },
  { value: 'linkedinOnUnipile', group: 'unipile', label: 'LinkedIn profile found', description: 'Looks the LinkedIn URL up through your LinkedIn sender. Catches dead or mistyped URLs.' },
  { value: 'linkedinConnected', group: 'unipile', label: 'Already connected on LinkedIn', description: "Lead is a 1st-degree connection of the LinkedIn sender, so you can skip the connection request." },
  { value: 'instagramOnUnipile', group: 'unipile', label: 'Instagram profile found', description: 'Looks the Instagram handle up through your Instagram sender.' },
  { value: 'whatsappRegistered', group: 'unipile', label: 'On WhatsApp', description: 'The number is registered on WhatsApp. Needs the number with its country code (+44...).' },
  { value: 'senderConnected', group: 'unipile', label: 'Sender connected', description: 'The campaign has a connected account on a channel right now.' },
  { value: 'enteredViaTrigger', group: 'entry', label: 'Came in through a trigger', description: 'A campaign trigger brought the lead in: any trigger, or the one you pick.' },
  { value: 'enteredOnChannel', group: 'entry', label: 'Came in on a channel', description: 'A trigger brought the lead in from a message, comment or invitation on this channel.' },
];

export const ROUTE_CHANNEL_OPTIONS: { value: RouteChannel; label: string; reach: string }[] = [
  { value: 'linkedin', label: 'LinkedIn', reach: 'has a LinkedIn URL' },
  { value: 'email', label: 'Email', reach: 'has an email' },
  { value: 'instagram', label: 'Instagram', reach: 'has an Instagram handle' },
  { value: 'whatsapp', label: 'WhatsApp', reach: 'has a phone number with its country code' },
  { value: 'telegram', label: 'Telegram', reach: 'has a linked Telegram account' },
  { value: 'sms', label: 'SMS', reach: 'has a mobile number (needs a Twilio SMS sender)' },
];

/** Channels a "Sender connected" check or a Route by Channel sender rule can look at. */
export const SENDER_CHECK_CHANNELS: RouteChannel[] = ['linkedin', 'instagram', 'whatsapp', 'telegram'];

/** The check an "If Channel Available" node runs, including nodes saved before checks existed. */
export function resolveContactCheck(data: Partial<ConditionChannelAvailableNodeData>): ContactCheck | null {
  if (data.check && CONTACT_CHECK_OPTIONS.some((o) => o.value === data.check)) return data.check;
  switch (data.channel ?? 'email') {
    case 'linkedin': return 'linkedinUrl';
    case 'email': return 'email';
    case 'instagram': return 'instagram';
    case 'whatsapp': return data.checkRegistration ? 'whatsappRegistered' : 'phone';
    case 'telegram': return 'telegram';
    default: return null;
  }
}

/** Route by Channel's channels in priority order: known channels only, each once. */
export function routeChannels(data: Partial<RouteByChannelNodeData>): RouteChannel[] {
  const known = new Set(ROUTE_CHANNEL_OPTIONS.map((o) => o.value));
  return [...new Set((data.channels ?? []).filter((c) => known.has(c)))];
}

/** A node's source handles. Route by Channel's follow its channels; other types' are fixed. */
export function getNodeSourceHandles(node: { type?: string; data?: unknown }): string[] {
  if (node.type === 'routeByChannel') {
    return [...routeChannels((node.data ?? {}) as Partial<RouteByChannelNodeData>), 'none'];
  }
  return NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.handles.source ?? [];
}

export interface ConditionReplyReceivedNodeData extends BaseNodeData {
  withinDays?: number; // Check for reply within X days
}

// LLM-powered intent classifier. Reads the lead's latest inbound reply and
// branches on the detected intent (reusing the backend reply-classifier taxonomy).
export interface ConditionIntentNodeData extends BaseNodeData {
  /** How many days back to look for an inbound reply (default 14) */
  withinDays?: number;
  /** Optional OpenRouter model override for classification (default: fast text model) */
  model?: string;
}

// Hands the lead's conversation off to the AI agent so subsequent replies are
// handled automatically per the agent profile's rules.
export interface HandoffToAgentNodeData extends BaseNodeData {
  /** Agent profile to assign. null/undefined = inherit the campaign's Smart Settings agent */
  agentProfileId?: string | null;
  /** If true, mark the lead handed_off and exit the sequence (default true) */
  exitAfterHandoff?: boolean;
}

// WhatsApp nodes
export interface WhatsAppMessageNodeData extends BaseNodeData {
  message: string;
  messageVariations: string[];
  includeMedia?: boolean;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'document';
  // AI prompt mode fields
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

export interface WhatsAppCheckNumberNodeData extends BaseNodeData {
  // No additional data - branches on registration status
}

// Instagram nodes
export interface InstagramDmNodeData extends BaseNodeData {
  message: string;
  messageVariations: string[];
  includeMedia?: boolean;
  mediaUrl?: string;
  // AI prompt mode fields
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

export interface InstagramFollowNodeData extends BaseNodeData {
  // No additional data
}

export interface InstagramLikePostNodeData extends BaseNodeData {
  likeCount: number; // How many recent posts to like (1-3)
}

// Telegram nodes
export interface WhatsAppTemplateNodeData extends BaseNodeData {
  /** whatsapp_templates.id (approved by Meta) */
  templateId?: string;
  /** Kept for the node's label on the canvas */
  templateName?: string;
}

export interface SmsMessageNodeData extends BaseNodeData {
  message: string;
  messageVariations: string[];
  // AI prompt mode fields
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
}

export interface TelegramMessageNodeData extends BaseNodeData {
  message: string;
  messageVariations: string[];
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  // AI prompt mode fields
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

// Calendar nodes
export interface ScheduleMeetingNodeData extends BaseNodeData {
  titleTemplate: string;           // e.g., "Intro call with {contact_name}"
  durationMinutes: number;          // 15, 30, 45, 60
  conferenceProvider: 'google_meet' | 'zoom' | 'teams' | 'none';
  bodyTemplate?: string;            // Meeting agenda/description
  triggerCondition: 'positive_reply' | 'any_reply' | 'manual';
  templateId?: string;              // Link to meeting_templates
}

// ============================================================================
// EMAIL TOOL HANDOFF NODE DATA INTERFACES
// Push leads to external email tools (Smartlead, Instantly, LeadConnector)
// ============================================================================

export type EmailToolType = 'smartlead' | 'instantly' | 'leadconnector';

// ============================================================================
// ENRICHMENT NODE DATA INTERFACES
// Find email addresses using enrichment providers
// ============================================================================

export type EnrichmentProviderType = 'apollo' | 'prospeo' | 'moltsets' | 'quickenrich';

export interface FindEmailNodeData extends BaseNodeData {
  /** Specific provider to use, or 'auto' to use priority order from settings */
  provider: EnrichmentProviderType | 'auto';
  /** Whether to skip if contact already has an email */
  skipIfHasEmail: boolean;
  /** Whether to accept catch-all emails (emails that accept any address at the domain) */
  acceptCatchAll: boolean;
  /** Whether to run an additional email validation layer (e.g., verify deliverability) */
  validateEmail: boolean;
  /** Whether to continue sequence if enrichment fails */
  continueOnFailure: boolean;
}

export interface AnalyzeContactNodeData extends BaseNodeData {
  /** Skip analysis if contact already has enrichment_data */
  skipIfAlreadyEnriched: boolean;
  /** Whether to continue sequence if analysis fails */
  continueOnFailure: boolean;
  /** OpenRouter model ID for AI analysis (default: x-ai/grok-4.1-fast) */
  model?: string;
  /** Product ID to tailor analysis pain points and ICP matching */
  productId?: string;
}

export interface GenerateEmailsNodeData extends BaseNodeData {
  /** Number of emails to generate (1-7) */
  emailCount: number;
  /** Always prompt mode for AI generation */
  messageMode: 'prompt';
  /** AI prompt template for email generation */
  prompt: string;
  /** A/B test prompt variations */
  promptVariations?: string[];
  /** OpenRouter model ID */
  llmModel?: string;
  /** LLM temperature (0-2) */
  llmTemperature?: number;
  /** Skip generation if generated_data already exists on this lead */
  skipIfAlreadyGenerated: boolean;
}

export interface ConditionEnrichedNodeData extends BaseNodeData {
  // No additional data — checks if enrichment_data exists on contact
}

export interface ConditionAnalyzedNodeData extends BaseNodeData {
  // No additional data — checks if analyzeContact action ran in this campaign
}

export type VerifyEmailProvider = 'lite' | 'apify_million_verifier' | 'mailtester_ninja';

export interface VerifyEmailNodeData extends BaseNodeData {
  /** Which verification provider to use */
  provider: VerifyEmailProvider;
  /** Skip if the contact's email was already verified recently */
  skipIfAlreadyVerified: boolean;
  /** Whether to continue sequence if verification fails to run */
  continueOnFailure: boolean;
}

export interface ConditionIcpScoreNodeData extends BaseNodeData {
  /** Which score to gate on: company ICP fit, or decision-maker (right person) fit. */
  scoreType?: 'icp' | 'dm';
  /** Product to score against. Falls back to the campaign's icp_product_id. */
  productId?: string;
  /** Minimum score required to take the "pass" branch (0-100) */
  minScore: number;
}

export interface AddToListNodeData extends BaseNodeData {
  /** Target lead list to add the contact to */
  listId?: string;
}

// ============================================================================
// NOTION NODE DATA INTERFACES
// Generate personalized Notion pages during campaign execution
// ============================================================================

export interface CreateNotionPageNodeData extends BaseNodeData {
  /** ID of the Notion tool connection (email_tool_connections record) */
  connectionId?: string;
  /** Notion database ID to create the page in */
  databaseId?: string;
  /** Product ID for blueprint context (enrichment + domain expertise) */
  productId?: string;
  /** Which blueprint(s) to use for page generation */
  blueprintIds: string[];
  /** Custom prompt text (used when 'custom' blueprint is selected) */
  customPrompt?: string;
  /** Minimum ICP score to generate page (0 = always generate) */
  icpThreshold: number;
  /** Whether to continue the sequence if page generation fails */
  continueOnFailure: boolean;
  /** Optional AI model override */
  model?: string;
}

export interface SendToEmailToolNodeData extends BaseNodeData {
  /** ID of the email_tool_connections record (or ghl_oauth_tokens for leadconnector) */
  connectionId?: string;
  /** Campaign/Workflow ID in the external tool */
  externalCampaignId?: string;
  /** For LeadConnector: workflow ID to add contact to */
  externalWorkflowId?: string;
  /** Email subject line (supports template variables like {{firstName}}) - used in manual mode */
  emailSubject: string;
  /** Email body content (supports template variables) - used in manual mode */
  emailBody: string;
  /** If true, lead is marked as 'handed_off' and exits the sequence */
  exitAfterHandoff: boolean;
  // AI prompt mode fields (same pattern as ConnectionRequestNodeData)
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
  /** Number of emails in the AI-generated sequence (2-7) */
  emailCount?: number;
  /** When true and messageMode === 'prompt', save generated sequences for review before pushing */
  requireReview?: boolean;
  /** Enrollment mode: 'new' creates a fresh sequence, 'existing' adds to an existing one */
  enrollmentMode?: 'new' | 'existing';
  /** ID of an existing email_sequences record to enroll into (only when enrollmentMode === 'existing') */
  existingSequenceId?: string;
  /** Display name of the selected existing sequence (for node sublabel) */
  existingSequenceName?: string;
  /** Auto-populated by campaign processor: sequence ID from the first lead's creation in "Create New" mode */
  _resolvedSequenceId?: string;
}

// Email (direct send via SMTP mailboxes)
export interface EmailNodeData extends BaseNodeData {
  subject: string;
  subjectVariations: string[];
  body: string;
  bodyVariations: string[];
  trackOpens?: boolean;
  trackClicks?: boolean;
  mailboxId?: string;
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
}

export interface ConditionEmailOpenedNodeData extends BaseNodeData { withinDays?: number }

export interface ConditionEmailClickedNodeData extends BaseNodeData { withinDays?: number }

export type SequenceNodeData =
  // Terminal
  | StartNodeData
  | EndNodeData
  // Control
  | DelayNodeData
  | SwitchChannelNodeData
  | GoToNodeData
  | ConditionChannelAvailableNodeData
  | RouteByChannelNodeData
  | ConditionReplyReceivedNodeData
  | ConditionIntentNodeData
  | HandoffToAgentNodeData
  // LinkedIn
  | ConnectionRequestNodeData
  | MessageNodeData
  | InMailNodeData
  | ConditionNodeData
  | ViewProfileNodeData
  | FollowNodeData
  | LikePostNodeData
  | WarmupEngagementNodeData
  // Email (direct SMTP)
  | EmailNodeData
  | ConditionEmailOpenedNodeData
  | ConditionEmailClickedNodeData
  // WhatsApp
  | WhatsAppMessageNodeData
  | WhatsAppCheckNumberNodeData
  // Instagram
  | InstagramDmNodeData
  | InstagramFollowNodeData
  | InstagramLikePostNodeData
  // Telegram
  | TelegramMessageNodeData
  | SmsMessageNodeData
  | WhatsAppTemplateNodeData
  // Calendar
  | ScheduleMeetingNodeData
  // Email Tool Handoffs
  | SendToEmailToolNodeData
  // Enrichment
  | FindEmailNodeData
  | AnalyzeContactNodeData
  | GenerateEmailsNodeData
  | VerifyEmailNodeData
  | ConditionEnrichedNodeData
  | ConditionAnalyzedNodeData
  | ConditionIcpScoreNodeData
  // Routing
  | AddToListNodeData
  // Notion
  | CreateNotionPageNodeData;

export type SequenceNode = Node<SequenceNodeData, SequenceNodeType>;
export type SequenceEdge = Edge;

// Node type configuration
export interface NodeTypeConfig {
  type: SequenceNodeType;
  label: string;
  description: string;
  icon: string;
  category: 'action' | 'control' | 'condition' | 'terminal';
  channel: ChannelType; // Which channel this node operates on ('any' for control nodes)
  maxCount?: number; // Some nodes can only appear once
  requiresConnection?: boolean; // Some actions require being connected first
  requiresIdentity?: ChannelType; // Required contact identity (e.g., email for email nodes)
  handles: {
    source: string[];
    target: boolean;
  };
}

export const NODE_TYPE_CONFIGS: Record<SequenceNodeType, NodeTypeConfig> = {
  // ============================================================================
  // TERMINAL NODES
  // ============================================================================
  start: {
    type: 'start',
    label: 'Campaign Start',
    description: 'Entry point for the campaign sequence',
    icon: 'Play',
    category: 'terminal',
    channel: 'any',
    maxCount: 1,
    handles: { source: ['default'], target: false },
  },
  end: {
    type: 'end',
    label: 'End',
    description: 'End of sequence',
    icon: 'Flag',
    category: 'terminal',
    channel: 'any',
    handles: { source: [], target: true },
  },

  // ============================================================================
  // CONTROL NODES (Channel-Agnostic)
  // ============================================================================
  delay: {
    type: 'delay',
    label: 'Wait / Delay',
    description: 'Wait for a specified time before next action',
    icon: 'Clock',
    category: 'control',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },
  switchChannel: {
    type: 'switchChannel',
    label: 'Switch Channel',
    description: 'Switch to a different communication channel',
    icon: 'ArrowRightLeft',
    category: 'control',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },
  goTo: {
    type: 'goTo',
    label: 'Go To',
    description: 'Jump to another node in the sequence (branch merging or retry loops)',
    icon: 'CornerDownLeft',
    category: 'control',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },
  conditionChannelAvailable: {
    type: 'conditionChannelAvailable',
    label: 'If Channel Available',
    description: 'Branch on a LinkedIn URL, email, Instagram, phone, or a Unipile check',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'any',
    handles: { source: ['available', 'notAvailable'], target: true },
  },
  routeByChannel: {
    type: 'routeByChannel',
    label: 'Route by Channel',
    description: 'Send each lead down the first channel it can be reached on',
    icon: 'Split',
    category: 'condition',
    channel: 'any',
    // The real handles follow node.data.channels: use getNodeSourceHandles(node).
    handles: { source: ['linkedin', 'email', 'none'], target: true },
  },
  conditionReplyReceived: {
    type: 'conditionReplyReceived',
    label: 'If Reply Received',
    description: 'Check if contact has replied (any channel)',
    icon: 'MessageSquareReply',
    category: 'condition',
    channel: 'any',
    handles: { source: ['replied', 'noReply'], target: true },
  },
  conditionIntent: {
    type: 'conditionIntent',
    label: 'Check Reply Intent',
    description: 'AI reads the latest reply and branches on its intent (interested, objection, etc.)',
    icon: 'Brain',
    category: 'condition',
    channel: 'any',
    handles: {
      // Maps 1:1 to LeadIntent from _shared/reply-classifier.ts.
      // unsubscribe/do_not_contact collapse into not_interested for readability.
      source: ['interested', 'meeting_booked', 'not_interested', 'out_of_office', 'auto_reply', 'neutral', 'no_reply'],
      target: true,
    },
  },
  handoffToAgent: {
    type: 'handoffToAgent',
    label: 'Hand off to AI Agent',
    description: 'Let the AI agent take over and respond to this lead\'s replies automatically',
    icon: 'Bot',
    category: 'action',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // LINKEDIN NODES
  // ============================================================================
  connectionRequest: {
    type: 'connectionRequest',
    label: 'Send Connection Request',
    description: 'Send a LinkedIn connection request with optional message',
    icon: 'UserPlus',
    category: 'action',
    channel: 'linkedin',
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },
  message: {
    type: 'message',
    label: 'Send LinkedIn Message',
    description: 'Send a direct message to connected contacts',
    icon: 'MessageSquare',
    category: 'action',
    channel: 'linkedin',
    requiresConnection: true,
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },
  inmail: {
    type: 'inmail',
    label: 'Send InMail',
    description: 'Send an InMail (premium feature)',
    icon: 'Linkedin',
    category: 'action',
    channel: 'linkedin',
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },
  conditionConnection: {
    type: 'conditionConnection',
    label: 'If Connection',
    description: 'Branch based on whether connection was accepted',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'linkedin',
    handles: { source: ['accepted', 'notAccepted'], target: true },
  },
  conditionOpenProfile: {
    type: 'conditionOpenProfile',
    label: 'If Open Profile',
    description: 'Branch based on whether LinkedIn profile is open',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'linkedin',
    handles: { source: ['open', 'closed'], target: true },
  },
  viewProfile: {
    type: 'viewProfile',
    label: 'View Profile',
    description: "Trigger a profile view (they'll see you visited)",
    icon: 'Eye',
    category: 'action',
    channel: 'linkedin',
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },
  follow: {
    type: 'follow',
    label: 'Follow on LinkedIn',
    description: 'Follow the user on LinkedIn',
    icon: 'UserCheck',
    category: 'action',
    channel: 'linkedin',
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },
  likePost: {
    type: 'likePost',
    label: 'Like LinkedIn Post',
    description: 'Like one or more recent posts',
    icon: 'ThumbsUp',
    category: 'action',
    channel: 'linkedin',
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },
  warmupEngagement: {
    type: 'warmupEngagement',
    label: 'Warm-up Engagement',
    description: 'React to or comment on posts to warm up before outreach',
    icon: 'Sparkles',
    category: 'action',
    channel: 'linkedin',
    requiresIdentity: 'linkedin',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // EMAIL NODES (direct send via SMTP mailboxes)
  // ============================================================================
  email: {
    type: 'email',
    label: 'Send Email',
    description: 'Send an email via your connected SMTP mailbox',
    icon: 'Mail',
    category: 'action',
    channel: 'email',
    requiresIdentity: 'email',
    handles: { source: ['default'], target: true },
  },
  conditionEmailOpened: {
    type: 'conditionEmailOpened',
    label: 'If Email Opened',
    description: 'Branch based on whether the email was opened',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'email',
    handles: { source: ['opened', 'notOpened'], target: true },
  },
  conditionEmailClicked: {
    type: 'conditionEmailClicked',
    label: 'If Email Clicked',
    description: 'Branch based on whether a link was clicked',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'email',
    handles: { source: ['clicked', 'notClicked'], target: true },
  },

  // ============================================================================
  // WHATSAPP NODES
  // ============================================================================
  whatsappMessage: {
    type: 'whatsappMessage',
    label: 'Send WhatsApp',
    description: 'Send a WhatsApp message',
    icon: 'MessageCircle',
    category: 'action',
    channel: 'whatsapp',
    requiresIdentity: 'whatsapp',
    handles: { source: ['default'], target: true },
  },
  whatsappCheckNumber: {
    type: 'whatsappCheckNumber',
    label: 'Check WhatsApp Number',
    description: 'Check if phone number has WhatsApp',
    icon: 'PhoneCall',
    category: 'condition',
    channel: 'whatsapp',
    handles: { source: ['hasWhatsapp', 'noWhatsapp'], target: true },
  },

  // ============================================================================
  // INSTAGRAM NODES
  // ============================================================================
  instagramDm: {
    type: 'instagramDm',
    label: 'Send Instagram DM',
    description: 'Send an Instagram direct message',
    icon: 'Instagram',
    category: 'action',
    channel: 'instagram',
    requiresIdentity: 'instagram',
    handles: { source: ['default'], target: true },
  },
  instagramFollow: {
    type: 'instagramFollow',
    label: 'Follow on Instagram',
    description: 'Follow the user on Instagram',
    icon: 'UserPlus',
    category: 'action',
    channel: 'instagram',
    requiresIdentity: 'instagram',
    handles: { source: ['default'], target: true },
  },
  instagramLikePost: {
    type: 'instagramLikePost',
    label: 'Like Instagram Post',
    description: 'Like recent posts on Instagram',
    icon: 'Heart',
    category: 'action',
    channel: 'instagram',
    requiresIdentity: 'instagram',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // TELEGRAM NODES
  // ============================================================================
  telegramMessage: {
    type: 'telegramMessage',
    label: 'Send Telegram',
    description: 'Send a Telegram message',
    icon: 'Send',
    category: 'action',
    channel: 'telegram',
    requiresIdentity: 'telegram',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // WHATSAPP BUSINESS (Twilio) NODES
  // ============================================================================
  whatsappTemplate: {
    type: 'whatsappTemplate',
    label: 'Send WhatsApp Template',
    description: 'Start a WhatsApp Business conversation with a Meta-approved template',
    icon: 'FileText',
    category: 'action',
    channel: 'whatsapp',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // SMS NODES
  // ============================================================================
  smsMessage: {
    type: 'smsMessage',
    label: 'Send SMS',
    description: 'Send a text message from your Twilio numbers',
    icon: 'MessageSquareText',
    category: 'action',
    channel: 'sms',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // CALENDAR NODES
  // ============================================================================
  scheduleMeeting: {
    type: 'scheduleMeeting',
    label: 'Schedule Meeting',
    description: 'Schedule a meeting when lead replies positively',
    icon: 'Calendar',
    category: 'action',
    channel: 'any',
    requiresIdentity: 'email', // Need email for calendar invite
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // EMAIL TOOL HANDOFF NODES
  // Push leads with personalized emails to external email tools
  // ============================================================================
  sendToSmartlead: {
    type: 'sendToSmartlead',
    label: 'Send to Smartlead',
    description: 'Push lead with personalized email to Smartlead campaign',
    icon: 'Zap',
    category: 'action',
    channel: 'any', // Not channel-specific - handoff action
    requiresIdentity: 'email', // Need email address to push to Smartlead
    handles: { source: ['default'], target: true },
  },
  sendToInstantly: {
    type: 'sendToInstantly',
    label: 'Send to Instantly',
    description: 'Push lead with personalized email to Instantly campaign',
    icon: 'Zap',
    category: 'action',
    channel: 'any',
    requiresIdentity: 'email',
    handles: { source: ['default'], target: true },
  },
  sendToLeadConnector: {
    type: 'sendToLeadConnector',
    label: 'Send to LeadConnector',
    description: 'Push lead with personalized email to LeadConnector/GoHighLevel',
    icon: 'Zap',
    category: 'action',
    channel: 'any',
    requiresIdentity: 'email',
    handles: { source: ['default'], target: true },
  },
  sendToZapMail: {
    type: 'sendToZapMail',
    label: 'Enroll in Email Sequence',
    description: 'Enroll lead in an email sequence via your connected mailboxes',
    icon: 'Mail',
    category: 'action',
    channel: 'any',
    requiresIdentity: 'email',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // ENRICHMENT NODES
  // Find contact information and analyze contacts for personalization
  // ============================================================================
  findEmail: {
    type: 'findEmail',
    label: 'Find Email',
    description: 'Find email address using enrichment providers (Apollo, Prospeo, MoltSets)',
    icon: 'Search',
    category: 'action',
    channel: 'any',
    requiresIdentity: 'linkedin', // Need LinkedIn profile to find email
    handles: { source: ['default'], target: true },
  },
  analyzeContact: {
    type: 'analyzeContact',
    label: 'Analyze Contact',
    description: 'AI-analyze contact for personalization (company, needs, hooks)',
    icon: 'Brain',
    category: 'action',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },
  generateEmails: {
    type: 'generateEmails',
    label: 'Generate Emails',
    description: 'AI-generate personalized email content for use in downstream nodes',
    icon: 'MailPlus',
    category: 'action',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },
  conditionEnriched: {
    type: 'conditionEnriched',
    label: 'If Enriched',
    description: 'Check if contact has AI analysis data for personalization',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'any',
    handles: { source: ['enriched', 'notEnriched'], target: true },
  },
  conditionAnalyzed: {
    type: 'conditionAnalyzed',
    label: 'If Analyzed',
    description: 'Check if Analyze Contact action ran successfully in this campaign',
    icon: 'GitBranch',
    category: 'condition',
    channel: 'any',
    handles: { source: ['analyzed', 'notAnalyzed'], target: true },
  },
  verifyEmail: {
    type: 'verifyEmail',
    label: 'Verify Email',
    description: 'Verify email deliverability, then branch on the result',
    icon: 'MailCheck',
    category: 'action',
    channel: 'any',
    requiresIdentity: 'email',
    handles: { source: ['clean', 'risky', 'failed'], target: true },
  },
  conditionIcpScore: {
    type: 'conditionIcpScore',
    label: 'If ICP Score',
    description: 'Branch on whether the contact\'s ICP fit score meets a threshold',
    icon: 'Target',
    category: 'condition',
    channel: 'any',
    handles: { source: ['pass', 'fail'], target: true },
  },
  addToList: {
    type: 'addToList',
    label: 'Add to List',
    description: 'Add the contact to another lead list',
    icon: 'ListPlus',
    category: 'action',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },

  // ============================================================================
  // NOTION NODES
  // Generate personalized Notion pages during campaign execution
  // ============================================================================
  createNotionPage: {
    type: 'createNotionPage',
    label: 'Create Notion Page',
    description: 'Generate a personalized Notion preview page for this contact',
    icon: 'FileText',
    category: 'action',
    channel: 'any',
    handles: { source: ['default'], target: true },
  },
};

// Default node data factory
export function createDefaultNodeData(type: SequenceNodeType): SequenceNodeData {
  switch (type) {
    // Terminal nodes
    case 'start':
    case 'end':
      return {};

    // Control nodes
    case 'delay':
      return {
        days: 1,
        hours: 0,
      };
    case 'switchChannel':
      return {
        targetChannel: 'email',
      };
    case 'goTo':
      return {
        targetNodeId: undefined,
      };
    case 'conditionChannelAvailable':
      return {
        check: 'linkedinUrl',
        channel: 'linkedin',
      };
    case 'routeByChannel':
      return {
        channels: ['linkedin', 'email'],
        requireSender: true,
        verifyOnUnipile: false,
      };
    case 'conditionReplyReceived':
      return {
        withinDays: 7,
      };
    case 'conditionIntent':
      return {
        withinDays: 14,
        model: undefined,
      };
    case 'handoffToAgent':
      return {
        agentProfileId: null,
        exitAfterHandoff: true,
      };

    // LinkedIn nodes
    case 'connectionRequest':
      return {
        message: '',
        messageVariations: [],
        withdrawAfterDays: 14,
      };
    case 'message':
      return {
        message: '',
        messageVariations: [],
      };
    case 'inmail':
      return {
        subject: '',
        message: '',
        messageVariations: [],
      };
    case 'conditionConnection':
      return { withinDays: 14 };
    case 'conditionOpenProfile':
      return {};
    case 'viewProfile':
    case 'follow':
      return { continueOnFailure: true };
    case 'likePost':
      return {
        likeCount: 1,
      };
    case 'warmupEngagement':
      return {
        engagementType: 'reaction',
        reactionType: 'like',
        commentTemplates: [],
        postCount: 1,
        preferHighEngagement: true,
        cooldownDays: 7,
      };

    // Email nodes
    case 'email':
      return {
        subject: '',
        subjectVariations: [],
        body: '',
        bodyVariations: [],
        trackOpens: true,
        trackClicks: true,
      };
    case 'conditionEmailOpened':
    case 'conditionEmailClicked':
      return { withinDays: 7 };

    // WhatsApp nodes
    case 'whatsappMessage':
      return {
        message: '',
        messageVariations: [],
        includeMedia: false,
      };
    case 'whatsappCheckNumber':
      return {};

    // Instagram nodes
    case 'instagramDm':
      return {
        message: '',
        messageVariations: [],
        includeMedia: false,
      };
    case 'instagramFollow':
      return { continueOnFailure: true };
    case 'instagramLikePost':
      return {
        likeCount: 1,
      };

    // Telegram nodes
    case 'telegramMessage':
      return {
        message: '',
        messageVariations: [],
      };

    // SMS nodes
    case 'smsMessage':
      return {
        message: '',
        messageVariations: [],
      };

    // WhatsApp Business template
    case 'whatsappTemplate':
      return {};

    // Calendar nodes
    case 'scheduleMeeting':
      return {
        titleTemplate: 'Call with {contact_name}',
        durationMinutes: 30,
        conferenceProvider: 'google_meet',
        bodyTemplate: '',
        triggerCondition: 'positive_reply',
      };

    // Email Tool Handoff nodes
    case 'sendToSmartlead':
    case 'sendToInstantly':
    case 'sendToLeadConnector':
      return {
        connectionId: undefined,
        externalCampaignId: undefined,
        externalWorkflowId: undefined,
        emailSubject: '',
        emailBody: '',
        exitAfterHandoff: true,
        emailCount: 3,
        requireReview: true,
      };

    case 'sendToZapMail':
      return {
        emailSubject: '',
        emailBody: '',
        exitAfterHandoff: true,
        emailCount: 3,
        requireReview: true,
        enrollmentMode: 'new',
      };

    // Enrichment nodes
    case 'findEmail':
      return {
        provider: 'auto',
        skipIfHasEmail: true,
        acceptCatchAll: false,
        validateEmail: true,
        continueOnFailure: true,
      };
    case 'analyzeContact':
      return {
        skipIfAlreadyEnriched: true,
        continueOnFailure: true,
        model: DEFAULT_LLM_MODEL,
        productId: undefined,
      };
    case 'generateEmails':
      return {
        emailCount: 3,
        messageMode: 'prompt',
        prompt: '',
        skipIfAlreadyGenerated: true,
      };
    case 'conditionEnriched':
    case 'conditionAnalyzed':
      return {};
    case 'verifyEmail':
      return {
        provider: 'mailtester_ninja',
        skipIfAlreadyVerified: true,
        continueOnFailure: true,
      };
    case 'conditionIcpScore':
      return {
        scoreType: 'icp',
        productId: undefined,
        minScore: 50,
      };

    // Routing nodes
    case 'addToList':
      return {
        listId: undefined,
      };

    // Notion nodes
    case 'createNotionPage':
      return {
        blueprintIds: ['strategic-growth'],
        icpThreshold: 0,
        continueOnFailure: true,
      };

    default:
      return {};
  }
}

// Create a new node
export function createNode(
  type: SequenceNodeType,
  position: XYPosition,
  id?: string
): SequenceNode {
  return {
    id: id || `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    position,
    data: createDefaultNodeData(type),
  };
}

// Create default start node
export function createStartNode(): SequenceNode {
  return createNode('start', { x: 250, y: 50 }, 'start');
}

// Create an edge
export function createEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  label?: string
): SequenceEdge {
  return {
    id: `edge-${source}-${target}-${sourceHandle || 'default'}`,
    source,
    target,
    sourceHandle: sourceHandle || 'default',
    label,
    type: 'sequenceEdge',
  };
}

// Get available node types for adding (based on what's already in sequence and available channels)
export function getAvailableNodeTypes(
  existingNodes: SequenceNode[],
  availableChannels?: ChannelType[]
): SequenceNodeType[] {
  const nodeCounts = existingNodes.reduce((acc, node) => {
    const type = node.type as SequenceNodeType;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<SequenceNodeType, number>);

  return (Object.keys(NODE_TYPE_CONFIGS) as SequenceNodeType[]).filter((type) => {
    const config = NODE_TYPE_CONFIGS[type];

    // Filter out nodes that have reached max count
    if (config.maxCount && nodeCounts[type] >= config.maxCount) {
      return false;
    }

    // Don't show start in the add menu
    if (type === 'start') {
      return false;
    }

    // If available channels are specified, filter by channel
    if (availableChannels && availableChannels.length > 0) {
      // Always include 'any' channel nodes (control nodes)
      if (config.channel === 'any') {
        return true;
      }
      // Only include channel-specific nodes if that channel is available
      return availableChannels.includes(config.channel);
    }

    return true;
  });
}

// Get node types grouped by channel (for UI grouping)
export function getNodeTypesByChannel(
  existingNodes: SequenceNode[],
  availableChannels?: ChannelType[]
): Record<ChannelType | 'control' | 'terminal', SequenceNodeType[]> {
  const availableTypes = getAvailableNodeTypes(existingNodes, availableChannels);

  const grouped: Record<ChannelType | 'control' | 'terminal', SequenceNodeType[]> = {
    any: [],
    linkedin: [],
    email: [],
    whatsapp: [],
    instagram: [],
    telegram: [],
    sms: [],
    control: [],
    terminal: [],
  };

  availableTypes.forEach((type) => {
    const config = NODE_TYPE_CONFIGS[type];
    if (config.category === 'terminal') {
      grouped.terminal.push(type);
    } else if (config.category === 'control' || config.channel === 'any') {
      grouped.control.push(type);
    } else {
      grouped[config.channel].push(type);
    }
  });

  return grouped;
}

// Get the channel for a node type
export function getNodeChannel(type: SequenceNodeType): ChannelType {
  return NODE_TYPE_CONFIGS[type]?.channel || 'any';
}

// Calculate next position for a new node
export function calculateNextPosition(
  existingNodes: SequenceNode[],
  afterNodeId?: string
): XYPosition {
  if (afterNodeId) {
    const afterNode = existingNodes.find((n) => n.id === afterNodeId);
    if (afterNode) {
      return {
        x: afterNode.position.x,
        y: afterNode.position.y + 150,
      };
    }
  }

  // Default: find the bottom-most node and add below it
  const bottomNode = existingNodes.reduce(
    (bottom, node) =>
      node.position.y > bottom.position.y ? node : bottom,
    existingNodes[0] || { position: { x: 250, y: 0 } }
  );

  return {
    x: bottomNode.position.x,
    y: bottomNode.position.y + 150,
  };
}

// Validate sequence
export interface SequenceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSequence(
  nodes: SequenceNode[],
  edges: SequenceEdge[]
): SequenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for start node
  const startNodes = nodes.filter((n) => n.type === 'start');
  if (startNodes.length === 0) {
    errors.push('Sequence must have a start node');
  } else if (startNodes.length > 1) {
    errors.push('Sequence can only have one start node');
  }

  // Check that start node has outgoing edge
  if (startNodes.length === 1) {
    const startEdge = edges.find((e) => e.source === startNodes[0].id);
    if (!startEdge) {
      errors.push('Start node must be connected to at least one action');
    }
  }

  // Check for orphaned nodes (no incoming edges except start)
  nodes.forEach((node) => {
    if (node.type !== 'start') {
      const hasIncoming = edges.some((e) => e.target === node.id);
      if (!hasIncoming) {
        warnings.push(`Node "${(NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label ?? node.type)}" is not connected`);
      }
    }
  });

  // Validate Go To nodes
  nodes.forEach((node) => {
    if (node.type === 'goTo') {
      const data = node.data as GoToNodeData;
      if (!data.targetNodeId) {
        errors.push('Go To node must have a target node selected');
      } else if (data.targetNodeId === node.id) {
        errors.push('Go To node cannot target itself');
      } else if (!nodes.find((n) => n.id === data.targetNodeId)) {
        errors.push('Go To node references a target that no longer exists');
      }
    }
  });

  // Detect cycles via DFS from start node.
  // Includes Go To jumps as virtual edges in the adjacency map.
  // Cycles are allowed (warning) since Go To enables intentional retry loops,
  // but the runtime enforces a max-visit limit per node to prevent infinite loops.
  if (startNodes.length === 1) {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const targets = adjacency.get(edge.source) || [];
      targets.push(edge.target);
      adjacency.set(edge.source, targets);
    }
    // Add Go To jumps as virtual edges
    for (const node of nodes) {
      if (node.type === 'goTo') {
        const data = node.data as GoToNodeData;
        if (data.targetNodeId) {
          const targets = adjacency.get(node.id) || [];
          targets.push(data.targetNodeId);
          adjacency.set(node.id, targets);
        }
      }
    }
    const path = new Set<string>();
    const visited = new Set<string>();
    let hasCycle = false;

    function dfs(nodeId: string) {
      if (hasCycle) return;
      if (path.has(nodeId)) {
        hasCycle = true;
        return;
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      path.add(nodeId);
      for (const neighbor of adjacency.get(nodeId) || []) {
        dfs(neighbor);
      }
      path.delete(nodeId);
    }

    dfs(startNodes[0].id);
    if (hasCycle) {
      warnings.push('Sequence contains a loop — ensure a delay or exit condition prevents infinite execution');
    }
  }

  // Check that every branching node has all of its outcome branches wired.
  // A "branching node" is any node with more than one source handle
  // (conditions like If ICP Score / If Replied, and multi-outcome actions like
  // Verify Email → clean/risky/failed). Derived from NODE_TYPE_CONFIGS rather
  // than a hand-maintained list so new condition types are covered automatically
  // — the old hardcoded list had silently drifted and omitted conditionIcpScore
  // and verifyEmail, which is how a campaign shipped that filtered out ~all leads
  // at an unwired ICP branch with no surfaced warning.
  nodes.forEach((node) => {
    const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
    const handles = getNodeSourceHandles(node);
    if (!config || handles.length <= 1) return;
    const outgoingEdges = edges.filter((e) => e.source === node.id);
    handles.forEach((handle) => {
      if (!outgoingEdges.some((e) => e.sourceHandle === handle)) {
        warnings.push(
          `"${config.label}" has an unconnected "${handle}" branch — leads that reach it are filtered out (no path is configured for that outcome)`
        );
      }
    });
  });

  // Check If-ICP-Score nodes have a product to score against. Without one the
  // runtime "fails closed" and routes EVERY lead to the fail branch, so an ICP
  // gate with no product silently kills the whole campaign. A product may come
  // from the node itself or be inherited from an Analyze Contact step in the
  // same sequence (the processor falls back to it) — require at least one source.
  const analyzeProductAvailable = nodes.some(
    (n) => n.type === 'analyzeContact' && !!(n.data as { productId?: string })?.productId
  );
  nodes.forEach((node) => {
    if (node.type !== 'conditionIcpScore') return;
    const nodeProductId = (node.data as { productId?: string })?.productId;
    if (!nodeProductId && !analyzeProductAvailable) {
      errors.push(
        'An "If ICP Score" step has no product selected, and no "Analyze Contact" step provides one — every lead would be filtered out. Select a product on the ICP step.'
      );
    }
  });

  // Warn if the sequence never actually contacts the lead. A sequence made only
  // of enrichment/condition steps (e.g. analyze → ICP → find email) processes
  // leads but sends nothing, which reads as "near-zero throughput, no errors".
  const outreachNodeTypes = new Set<SequenceNodeType>([
    'connectionRequest', 'message', 'inmail', 'email',
    'whatsappMessage', 'instagramDm', 'telegramMessage', 'smsMessage', 'whatsappTemplate',
    'sendToSmartlead', 'sendToInstantly', 'sendToLeadConnector', 'sendToZapMail',
  ]);
  const hasOutreachNode = nodes.some((n) => outreachNodeTypes.has(n.type as SequenceNodeType));
  if (!hasOutreachNode && nodes.some((n) => n.type !== 'start' && n.type !== 'end')) {
    warnings.push(
      'This sequence has no message, connection request, or email step — leads will be processed but never contacted'
    );
  }

  // Check connection request/message nodes have content
  nodes.forEach((node) => {
    if (node.type === 'connectionRequest') {
      const data = node.data as ConnectionRequestNodeData;
      const isPromptMode = data.messageMode === 'prompt';
      if (isPromptMode) {
        if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          warnings.push('Connection request has no AI prompt (will be sent without note)');
        }
      } else if (!data.message && data.messageVariations.length === 0) {
        warnings.push('Connection request has no message (will be sent without note)');
      }
    }
    if (node.type === 'message') {
      const data = node.data as MessageNodeData;
      const isPromptMode = data.messageMode === 'prompt';
      if (isPromptMode) {
        if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          errors.push('Message node must have an AI prompt');
        }
      } else if (!data.message && data.messageVariations.length === 0) {
        errors.push('Message node must have content');
      }
    }
    if (node.type === 'inmail') {
      const data = node.data as InMailNodeData;
      const isPromptMode = data.messageMode === 'prompt';
      if (!data.subject) {
        errors.push('InMail node must have a subject');
      }
      if (isPromptMode) {
        if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          errors.push('InMail node must have an AI prompt');
        }
      } else if (!data.message) {
        errors.push('InMail node must have a message');
      }
    }
    if (node.type === 'email') {
      const data = node.data as EmailNodeData;
      const isPromptMode = data.messageMode === 'prompt';
      if (!data.subject) {
        errors.push('Email node must have a subject');
      }
      if (isPromptMode) {
        if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          errors.push('Email node must have an AI prompt');
        }
      } else if (!data.body && (!data.bodyVariations || data.bodyVariations.length === 0)) {
        errors.push('Email node must have a body');
      }
    }
    if (node.type === 'whatsappTemplate' && !(node.data as WhatsAppTemplateNodeData).templateId) {
      errors.push('WhatsApp template node must have a template selected');
    }
    // Validate multi-channel message nodes in prompt mode
    const multiChannelMessageTypes = ['whatsappMessage', 'instagramDm', 'telegramMessage', 'smsMessage'];
    if (multiChannelMessageTypes.includes(node.type)) {
      const data = node.data as { message?: string; messageVariations?: string[]; messageMode?: MessageMode; prompt?: string; promptVariations?: string[] };
      const isPromptMode = data.messageMode === 'prompt';
      if (isPromptMode) {
        if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          errors.push(`${NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type} node must have an AI prompt`);
        }
      } else if (!data.message && (!data.messageVariations || data.messageVariations.length === 0)) {
        errors.push(`${NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type} node must have content`);
      }
    }
    // Validate email tool handoff nodes
    const emailToolNodeTypes = ['sendToSmartlead', 'sendToInstantly', 'sendToLeadConnector', 'sendToZapMail'];
    if (emailToolNodeTypes.includes(node.type)) {
      const data = node.data as SendToEmailToolNodeData;
      // sendToZapMail in "existing" mode: needs sequence selected + prompt if template
      if (node.type === 'sendToZapMail' && data.enrollmentMode === 'existing') {
        if (!data.existingSequenceId) {
          errors.push(`${NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type} must select an existing email sequence`);
        }
        // Template sequences require an AI prompt to generate per-lead content
        if (data.messageMode === 'prompt' && !data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          errors.push(`${NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type} must have an AI prompt for personalized sequences`);
        }
      } else {
        const isPromptMode = data.messageMode === 'prompt';
        if (isPromptMode) {
          if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
            errors.push(`${NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type} must have an AI prompt`);
          }
        } else {
          if (!data.emailSubject || !data.emailBody) {
            errors.push(`${NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label || node.type} must have an email subject and body`);
          }
        }
      }
    }
    // Validate schedule meeting nodes
    if (node.type === 'scheduleMeeting') {
      const data = node.data as ScheduleMeetingNodeData;
      if (!data.titleTemplate) {
        errors.push('Schedule Meeting must have a title template');
      }
      if (!data.durationMinutes || data.durationMinutes < 1) {
        errors.push('Schedule Meeting must have a valid duration');
      }
    }
    // Validate Notion page nodes
    if (node.type === 'createNotionPage') {
      const data = node.data as CreateNotionPageNodeData;
      if (!data.connectionId) {
        errors.push('Create Notion Page must have a Notion connection selected');
      }
      if (!data.databaseId) {
        errors.push('Create Notion Page must have a Notion database selected');
      }
      if (!data.blueprintIds || data.blueprintIds.length === 0) {
        errors.push('Create Notion Page must have at least one blueprint selected');
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Per-node validation for showing inline error/warning badges
export function validateNode(
  node: SequenceNode,
  edges: SequenceEdge[]
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeType = node.type as SequenceNodeType;

  // Orphaned check (non-start node with no incoming edges)
  if (nodeType !== 'start') {
    const hasIncoming = edges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      warnings.push('Not connected to the sequence');
    }
  }

  // Start node must have outgoing edge
  if (nodeType === 'start') {
    const hasOutgoing = edges.some((e) => e.source === node.id);
    if (!hasOutgoing) {
      errors.push('Must be connected to at least one action');
    }
  }

  // Condition nodes missing branches
  const conditionNodeTypes: SequenceNodeType[] = [
    'conditionConnection', 'conditionOpenProfile',
    'conditionChannelAvailable', 'routeByChannel', 'conditionReplyReceived',
    'conditionEmailOpened', 'conditionEmailClicked',
    'whatsappCheckNumber', 'conditionEnriched', 'conditionAnalyzed',
  ];
  if (conditionNodeTypes.includes(nodeType)) {
    const outgoingEdges = edges.filter((e) => e.source === node.id);
    getNodeSourceHandles(node).forEach((handle) => {
      if (!outgoingEdges.some((e) => e.sourceHandle === handle)) {
        const label = handle === 'notAccepted' ? 'Not Accepted'
          : handle === 'noReply' ? 'No Reply'
          : handle === 'notAvailable' ? 'Not Available'
          : handle === 'noWhatsapp' ? 'No WhatsApp'
          : handle === 'none' ? 'No channel'
          : ROUTE_CHANNEL_OPTIONS.find((o) => o.value === handle)?.label
            ?? handle.charAt(0).toUpperCase() + handle.slice(1);
        warnings.push(`Missing "${label}" branch`);
      }
    });
  }

  if (nodeType === 'routeByChannel' && routeChannels(node.data as RouteByChannelNodeData).length === 0) {
    errors.push('Pick at least one channel to route to');
  }

  if (nodeType === 'conditionChannelAvailable') {
    const data = node.data as ConditionChannelAvailableNodeData;
    const check = resolveContactCheck(data);
    if (check === 'senderConnected' && !SENDER_CHECK_CHANNELS.includes(data.channel as RouteChannel)) {
      errors.push('Pick the channel whose sender to check');
    }
    if (check === 'enteredOnChannel' && !ROUTE_CHANNEL_OPTIONS.some((o) => o.value === data.channel)) {
      errors.push('Pick the channel leads came in on');
    }
  }

  // Content validation for message-type nodes
  if (nodeType === 'connectionRequest') {
    const data = node.data as ConnectionRequestNodeData;
    const isPromptMode = data.messageMode === 'prompt';
    if (isPromptMode) {
      if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
        warnings.push('No AI prompt (will be sent without note)');
      }
    } else if (!data.message && data.messageVariations.length === 0) {
      warnings.push('No message (will be sent without note)');
    }
  }

  if (nodeType === 'message') {
    const data = node.data as MessageNodeData;
    const isPromptMode = data.messageMode === 'prompt';
    if (isPromptMode) {
      if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
        errors.push('Must have an AI prompt');
      }
    } else if (!data.message && data.messageVariations.length === 0) {
      errors.push('Must have message content');
    }
  }

  if (nodeType === 'inmail') {
    const data = node.data as InMailNodeData;
    if (!data.subject) {
      errors.push('Must have a subject');
    }
    const isPromptMode = data.messageMode === 'prompt';
    if (isPromptMode) {
      if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
        errors.push('Must have an AI prompt');
      }
    } else if (!data.message) {
      errors.push('Must have a message');
    }
  }

  if (nodeType === 'email') {
    const data = node.data as EmailNodeData;
    if (!data.subject) {
      errors.push('Must have a subject');
    }
    const isPromptMode = data.messageMode === 'prompt';
    if (isPromptMode) {
      if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
        errors.push('Must have an AI prompt');
      }
    } else if (!data.body && (!data.bodyVariations || data.bodyVariations.length === 0)) {
      errors.push('Must have a body');
    }
  }

  // Multi-channel message nodes
  const multiChannelMessageTypes: SequenceNodeType[] = ['whatsappMessage', 'instagramDm', 'telegramMessage', 'smsMessage'];
  if (multiChannelMessageTypes.includes(nodeType)) {
    const data = node.data as { message?: string; messageVariations?: string[]; messageMode?: MessageMode; prompt?: string; promptVariations?: string[] };
    const isPromptMode = data.messageMode === 'prompt';
    if (isPromptMode) {
      if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
        errors.push('Must have an AI prompt');
      }
    } else if (!data.message && (!data.messageVariations || data.messageVariations.length === 0)) {
      errors.push('Must have message content');
    }
  }

  if (nodeType === 'whatsappTemplate' && !(node.data as WhatsAppTemplateNodeData).templateId) {
    errors.push('Pick an approved WhatsApp template');
  }

  // Email tool handoff nodes
  const emailToolNodeTypes: SequenceNodeType[] = ['sendToSmartlead', 'sendToInstantly', 'sendToLeadConnector', 'sendToZapMail'];
  if (emailToolNodeTypes.includes(nodeType)) {
    const data = node.data as SendToEmailToolNodeData;
    // sendToZapMail in "existing" mode: needs sequence selected + prompt if template
    if (nodeType === 'sendToZapMail' && data.enrollmentMode === 'existing') {
      if (!data.existingSequenceId) {
        errors.push('Must select an existing email sequence');
      }
      if (data.messageMode === 'prompt' && !data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
        errors.push('Must have an AI prompt for personalized sequences');
      }
    } else {
      const isPromptMode = data.messageMode === 'prompt';
      if (isPromptMode) {
        if (!data.prompt && (!data.promptVariations || data.promptVariations.length === 0)) {
          errors.push('Must have an AI prompt');
        }
      } else {
        if (!data.emailSubject || !data.emailBody) {
          errors.push('Must have email subject and body');
        }
      }
    }
  }

  // Notion page nodes
  if (nodeType === 'createNotionPage') {
    const data = node.data as CreateNotionPageNodeData;
    if (!data.connectionId) {
      errors.push('Must select a Notion connection');
    }
    if (!data.databaseId) {
      errors.push('Must select a Notion database');
    }
    if (!data.blueprintIds || data.blueprintIds.length === 0) {
      errors.push('Must select at least one blueprint');
    }
  }

  return { errors, warnings };
}

// Calculate total delay in a path (for estimation)
export function calculatePathDelay(nodes: SequenceNode[]): {
  minDays: number;
  maxDays: number;
} {
  let totalHours = 0;

  nodes.forEach((node) => {
    if (node.type === 'delay') {
      const data = node.data as DelayNodeData;
      totalHours += data.days * 24 + data.hours + (data.minutes || 0) / 60;
    }
  });

  return {
    minDays: Math.floor(totalHours / 24),
    maxDays: Math.ceil(totalHours / 24),
  };
}

// Get node statistics
export function getSequenceStats(
  nodes: SequenceNode[]
): {
  totalNodes: number;
  actionCount: number;
  delayDays: number;
  hasABTesting: boolean;
} {
  const actionCount = nodes.filter((n) => {
    const config = NODE_TYPE_CONFIGS[n.type as SequenceNodeType];
    return config?.category === 'action';
  }).length;

  const delay = calculatePathDelay(nodes);

  const hasABTesting = nodes.some((n) => {
    if (n.type === 'connectionRequest') {
      return (n.data as ConnectionRequestNodeData).messageVariations.length > 0;
    }
    if (n.type === 'message') {
      return (n.data as MessageNodeData).messageVariations.length > 0;
    }
    return false;
  });

  return {
    totalNodes: nodes.length,
    actionCount,
    delayDays: delay.maxDays,
    hasABTesting,
  };
}

// A lead whose status is "completed" but whose error_message starts with this
// prefix didn't finish the sequence — it exited via a condition branch that has
// no outgoing edge (e.g. an email verified "risky" with only the "clean" branch
// wired). The campaign-processor stamps this message (describeFilteredExit);
// keep the prefix in sync with that function.
const FILTERED_OUT_PREFIX = "Filtered out at ";

/** True when a lead was filtered out at a dead-end condition branch. */
export function isFilteredOut(errorMessage?: string | null): boolean {
  return !!errorMessage && errorMessage.startsWith(FILTERED_OUT_PREFIX);
}

/** The human-readable filter reason (the full stamped message), or null. */
export function getFilteredOutReason(errorMessage?: string | null): string | null {
  return isFilteredOut(errorMessage) ? errorMessage!.trim() : null;
}

// Traverse the sequence graph from start to end, producing an ordered array
// of nodes representing the execution path. At condition nodes (branches),
// determines which branch to follow based on action logs or current node position.
export function getOrderedExecutionPath(
  nodes: SequenceNode[],
  edges: SequenceEdge[],
  options?: {
    actionLogNodeIds?: Set<string>;
    currentNodeId?: string | null;
  }
): SequenceNode[] {
  const { actionLogNodeIds, currentNodeId } = options || {};

  // Build lookup maps
  const nodeMap = new Map<string, SequenceNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Build adjacency: source -> [{ handle, targetId }]
  const adjacency = new Map<string, { handle: string; targetId: string }[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source) || [];
    list.push({ handle: (edge.sourceHandle as string) || 'default', targetId: edge.target });
    adjacency.set(edge.source, list);
  }

  const startNode = nodes.find(n => n.type === 'start');
  if (!startNode) return [];

  // Collect all reachable node IDs from a given starting node (BFS)
  function getReachableNodeIds(fromNodeId: string): Set<string> {
    const reachable = new Set<string>();
    const stack = [fromNodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const { targetId } of adjacency.get(id) || []) {
        if (!reachable.has(targetId)) stack.push(targetId);
      }
      const node = nodeMap.get(id);
      if (node?.type === 'goTo') {
        const goToTarget = (node.data as GoToNodeData).targetNodeId;
        if (goToTarget && !reachable.has(goToTarget)) {
          stack.push(goToTarget);
        }
      }
    }
    return reachable;
  }

  // Pick which branch to follow at a condition node
  function pickBranchTarget(nodeId: string, nodeType: SequenceNodeType): string | null {
    const outs = adjacency.get(nodeId) || [];
    if (outs.length === 0) return null;
    if (outs.length === 1) return outs[0].targetId;

    const handleOrder = getNodeSourceHandles({ type: nodeType, data: nodeMap.get(nodeId)?.data });

    // Prioritize currentNodeId — it reflects the live state (handles reverts/re-routing)
    if (currentNodeId) {
      for (const handle of handleOrder) {
        const branchEdge = outs.find(o => o.handle === handle);
        if (!branchEdge) continue;
        const reachable = getReachableNodeIds(branchEdge.targetId);
        if (reachable.has(currentNodeId)) return branchEdge.targetId;
      }
    }

    // Fall back to action log evidence (historical path)
    if (actionLogNodeIds && actionLogNodeIds.size > 0) {
      for (const handle of handleOrder) {
        const branchEdge = outs.find(o => o.handle === handle);
        if (!branchEdge) continue;
        const reachable = getReachableNodeIds(branchEdge.targetId);
        for (const logNodeId of actionLogNodeIds) {
          if (reachable.has(logNodeId)) return branchEdge.targetId;
        }
      }
    }

    // Default: follow first handle's branch
    const firstHandle = handleOrder[0];
    const defaultEdge = outs.find(o => o.handle === firstHandle) || outs[0];
    return defaultEdge.targetId;
  }

  // Walk the graph
  const result: SequenceNode[] = [];
  const visited = new Set<string>();
  let currentId: string | null = startNode.id;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const current = nodeMap.get(currentId);
    if (!current) break;

    if (current.type !== 'start' && current.type !== 'end') {
      result.push(current);
    }

    if (current.type === 'end') break;

    // GoTo nodes: follow the jump target (visited set prevents infinite loops)
    if (current.type === 'goTo') {
      const goToTarget = (current.data as GoToNodeData).targetNodeId;
      currentId = goToTarget || null;
      continue;
    }

    const nodeType = current.type as SequenceNodeType;
    const isBranching = getNodeSourceHandles(current).length > 1;

    if (isBranching) {
      currentId = pickBranchTarget(current.id, nodeType);
    } else {
      const outs = adjacency.get(current.id) || [];
      const defaultEdge = outs.find(o => o.handle === 'default' || !o.handle) || outs[0];
      currentId = defaultEdge?.targetId || null;
    }
  }

  return result;
}

/** "@jane.doe", "jane.doe" or "https://www.instagram.com/jane.doe/" → "jane.doe". Mirrors _shared/contact-checks.ts. */
export function instagramUsername(value: string | null | undefined): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const fromUrl = raw.match(/instagram\.com\/([^/?#\s]+)/i)?.[1];
  const handle = (fromUrl ?? raw).replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}
