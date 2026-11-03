/**
 * Workflow Traversal Utilities
 *
 * Helper functions for navigating React Flow campaign sequences.
 * Used by campaign-processor and campaign-connection-checker edge functions.
 */

// ============================================================================
// Types
// ============================================================================

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // 'accepted', 'notAccepted', 'default', etc.
  targetHandle?: string;
}

export type NodeType =
  | 'start'
  | 'connectionRequest'
  | 'message'
  | 'inmail'
  | 'delay'
  | 'condition'
  | 'conditionConnection'
  | 'conditionOpenProfile'
  | 'conditionChannelAvailable'
  | 'routeByChannel'
  | 'conditionReplyReceived'
  | 'conditionEmailOpened'
  | 'conditionEmailClicked'
  | 'viewProfile'
  | 'follow'
  | 'likePost'
  | 'warmupEngagement'
  | 'email'
  | 'findEmail'
  | 'analyzeContact'
  | 'generateEmails'
  | 'verifyEmail'
  | 'conditionEnriched'
  | 'conditionAnalyzed'
  | 'conditionIcpScore'
  | 'addToList'
  | 'whatsappMessage'
  | 'whatsappCheckNumber'
  | 'instagramDm'
  | 'instagramFollow'
  | 'instagramLikePost'
  | 'telegramMessage'
  | 'smsMessage'
  | 'whatsappTemplate'
  | 'switchChannel'
  | 'goTo'
  | 'scheduleMeeting'
  | 'sendToSmartlead'
  | 'sendToInstantly'
  | 'sendToLeadConnector'
  | 'sendToZapMail'
  | 'createNotionPage'
  | 'end';

export interface ActionResult {
  success: boolean;
  externalId?: string;
  error?: string;
  retryable?: boolean;
}

// ============================================================================
// Node Navigation
// ============================================================================

/**
 * Find the start node in a workflow
 */
export function findStartNode(nodes: WorkflowNode[]): WorkflowNode | null {
  return nodes.find((n) => n.type === 'start') || null;
}

/**
 * Find a node by its ID
 */
export function findNodeById(
  nodeId: string,
  nodes: WorkflowNode[]
): WorkflowNode | null {
  return nodes.find((n) => n.id === nodeId) || null;
}

/**
 * Get all outgoing edges from a node
 */
export function getOutgoingEdges(
  nodeId: string,
  edges: WorkflowEdge[]
): WorkflowEdge[] {
  return edges
    .filter((e) => e.source === nodeId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Get all incoming edges to a node
 */
export function getIncomingEdges(
  nodeId: string,
  edges: WorkflowEdge[]
): WorkflowEdge[] {
  return edges.filter((e) => e.target === nodeId);
}

/**
 * Get the next node based on current position and optional condition
 *
 * @param currentNodeId - Current node ID
 * @param nodes - All nodes in the workflow
 * @param edges - All edges in the workflow
 * @param condition - Optional condition for branching (e.g., 'accepted', 'not_accepted')
 * @returns The next node or null if terminal
 */
export function getNextNode(
  currentNodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  condition?: string
): WorkflowNode | null {
  const outgoing = getOutgoingEdges(currentNodeId, edges);

  if (outgoing.length === 0) {
    return null;
  }

  // If condition is specified, find edge matching that condition
  if (condition) {
    // Try exact match first
    let conditionalEdge = outgoing.find(
      (e) => e.sourceHandle === condition || e.sourceHandle === `${condition}-handle`
    );
    // Fallback: try camelCase version of snake_case input (e.g. not_accepted → notAccepted)
    if (!conditionalEdge) {
      const camel = condition.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
      conditionalEdge = outgoing.find(
        (e) => e.sourceHandle === camel || e.sourceHandle === `${camel}-handle`
      );
    }
    if (conditionalEdge) {
      return findNodeById(conditionalEdge.target, nodes);
    }

    // A branching outcome with no matching edge must only fall through to an
    // EXPLICIT default/no-handle edge. If the outcome's handle is left
    // unconnected, the journey ENDS on this branch — we must not divert the lead
    // down an unrelated named branch. (e.g. a 'risky'/'failed' verifyEmail result
    // must not fall through to the lone 'clean' → sendToZapMail edge, which would
    // silently defeat the verification gate.)
    if (condition !== 'default') {
      const fallbackEdge = outgoing.find(
        (e) => e.sourceHandle === 'default' || !e.sourceHandle
      );
      if (fallbackEdge) {
        return findNodeById(fallbackEdge.target, nodes);
      }
      console.warn(
        `[workflow-utils] getNextNode: outcome '${condition}' from node ${currentNodeId} ` +
        `has no matching edge and no default edge. ` +
        `Available handles: [${outgoing.map(e => e.sourceHandle || '(none)').join(', ')}]. ` +
        `Ending the journey on this branch.`
      );
      return null;
    }
  }

  // Linear flow: single outgoing edge, no ambiguity
  if (outgoing.length === 1) {
    return findNodeById(outgoing[0].target, nodes);
  }

  // Multiple edges: prefer explicit 'default' handle or edges without a handle
  const defaultEdge = outgoing.find(
    (e) => e.sourceHandle === 'default' || !e.sourceHandle
  );
  if (defaultEdge) {
    return findNodeById(defaultEdge.target, nodes);
  }

  // Last resort: take first edge (deterministic due to sort in getOutgoingEdges)
  console.warn(
    `[workflow-utils] getNextNode: ambiguous edge selection for node ${currentNodeId}: ` +
    `${outgoing.length} edges, no default handle. Taking first edge.`
  );
  return findNodeById(outgoing[0].target, nodes);
}

/**
 * Check if a node is terminal (end node or no outgoing edges)
 */
export function isTerminalNode(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): boolean {
  const node = findNodeById(nodeId, nodes);
  if (!node) return true;
  if (node.type === 'end') return true;

  return getOutgoingEdges(nodeId, edges).length === 0;
}

/**
 * Check if a node requires an action (vs being a control flow node)
 */
export function isActionNode(node: WorkflowNode): boolean {
  const actionTypes: NodeType[] = [
    // LinkedIn
    'connectionRequest',
    'message',
    'inmail',
    'viewProfile',
    'follow',
    'likePost',
    'warmupEngagement',
    // Email
    'email',
    // WhatsApp
    'whatsappMessage',
    // Instagram
    'instagramDm',
    'instagramFollow',
    'instagramLikePost',
    // Telegram
    'telegramMessage',
    // SMS (Twilio senders)
    'smsMessage',
    // WhatsApp Business template (Twilio senders)
    'whatsappTemplate',
    // Calendar
    'scheduleMeeting',
    // Enrichment
    'findEmail',
    'analyzeContact',
    'generateEmails',
    // Routing
    'addToList',
    // Email Tool Handoffs
    'sendToSmartlead',
    'sendToInstantly',
    'sendToLeadConnector',
    'sendToZapMail',
    // Notion
    'createNotionPage',
  ];
  return actionTypes.includes(node.type as NodeType);
}

/**
 * Check if a node requires a connected Unipile sender account to execute.
 *
 * Only real channel-send actions need a live sender (LinkedIn/email/WhatsApp/etc.).
 * Internal enrichment (analyzeContact, generateEmails, findEmail, verifyEmail),
 * control nodes, and external-tool handoffs (sendToZapMail/Smartlead/Instantly/
 * LeadConnector — which use their own API keys) do NOT. Gating the sender
 * requirement on this prevents internal-only steps from being frozen as
 * `sender_disconnected` when no LinkedIn/email account is connected.
 */
export function nodeRequiresSenderAccount(node: WorkflowNode): boolean {
  const senderTypes: NodeType[] = [
    // LinkedIn
    'connectionRequest',
    'message',
    'inmail',
    'viewProfile',
    'follow',
    'likePost',
    'warmupEngagement',
    // Email (sent via a connected mailbox)
    'email',
    // WhatsApp
    'whatsappMessage',
    // Instagram
    'instagramDm',
    'instagramFollow',
    'instagramLikePost',
    // Telegram
    'telegramMessage',
    // (smsMessage sends from Twilio messaging_senders, not a Unipile account)
    // Calendar
    'scheduleMeeting',
  ];
  return senderTypes.includes(node.type as NodeType);
}

/**
 * Check if a node is a delay node
 */
export function isDelayNode(node: WorkflowNode): boolean {
  return node.type === 'delay';
}

/**
 * Check if a node is a condition node (branching)
 */
export function isConditionNode(node: WorkflowNode): boolean {
  const conditionTypes: string[] = [
    'condition',
    'conditionConnection',
    'conditionOpenProfile',
    'conditionChannelAvailable',
    'routeByChannel',
    'conditionReplyReceived',
    'conditionEmailOpened',
    'conditionEmailClicked',
    'conditionEnriched',
    'conditionAnalyzed',
    'conditionIcpScore',
    'verifyEmail',
    'whatsappCheckNumber',
    'switchChannel',
  ];
  return conditionTypes.includes(node.type);
}

/**
 * Get the waiting duration for a time-bounded condition node (in ms).
 * Returns null if the condition should evaluate instantly (no withinDays configured).
 */
export function getConditionWaitDuration(node: WorkflowNode): number | null {
  const waitableTypes = [
    'conditionConnection',
    'conditionReplyReceived',
    'conditionEmailOpened',
    'conditionEmailClicked',
  ];
  if (!waitableTypes.includes(node.type)) return null;

  const withinDays = node.data.withinDays as number | undefined;
  if (!withinDays || withinDays <= 0) return null;

  return withinDays * 24 * 60 * 60 * 1000;
}

/**
 * Check if a lead should still wait at a condition node.
 * Returns true if within the waiting period, false if timeout expired.
 */
export function shouldWaitAtCondition(
  conditionEnteredAt: string | null,
  waitDurationMs: number,
): boolean {
  if (!conditionEnteredAt) return false;
  const elapsed = Date.now() - new Date(conditionEnteredAt).getTime();
  return elapsed < waitDurationMs;
}

/**
 * Check if a node should be processed instantly in a loop (no external API calls).
 * Instant nodes: conditions (without withinDays), goTo, switchChannel, start, end, zero-delay.
 * Non-instant (blocking) nodes: action nodes, non-zero delays, conditions with withinDays.
 */
export function isInstantNode(node: WorkflowNode, skipDelays?: boolean): boolean {
  if (isConditionNode(node)) {
    // Conditions with a waiting period are NOT instant
    return getConditionWaitDuration(node) === null;
  }
  if (node.type === 'goTo') return true;
  if (node.type === 'start') return true;
  if (node.type === 'end') return true;
  if (isDelayNode(node)) {
    if (skipDelays) return true;
    return getDelayDuration(node) === 0;
  }
  return false;
}

// ============================================================================
// Node Data Extraction
// ============================================================================

/**
 * Get message content from a message/inmail node
 * Supports A/B testing variations
 */
export function getMessageContent(
  node: WorkflowNode,
  variationIndex = 0
): string {
  const data = node.data;

  // Check for A/B test variations
  const variations = data.variations as string[] | undefined;
  if (variations && variations.length > 0) {
    const idx = variationIndex % variations.length;
    return variations[idx] || '';
  }

  // Single message
  return (data.message as string) || (data.content as string) || '';
}

/**
 * Get prompt content from a node, supporting A/B test prompt variations.
 * Used for AI prompt mode where the prompt is sent to an LLM at execution time.
 */
export function getPromptContent(
  node: WorkflowNode,
  variationIndex = 0
): string {
  const data = node.data;

  const promptVariations = data.promptVariations as string[] | undefined;
  if (promptVariations && promptVariations.length > 0) {
    const idx = variationIndex % promptVariations.length;
    return promptVariations[idx] || '';
  }

  return (data.prompt as string) || '';
}

/**
 * Check if a node is configured for AI prompt mode
 */
export function isPromptMode(node: WorkflowNode): boolean {
  return (node.data.messageMode as string) === 'prompt';
}

/**
 * Get delay duration from a delay node (in milliseconds)
 */
export function getDelayDuration(node: WorkflowNode): number {
  const data = node.data;

  // Support days/hours/minutes format from campaign builder UI
  if (typeof data.days === 'number' || typeof data.hours === 'number' || typeof data.minutes === 'number') {
    const days = (data.days as number) || 0;
    const hours = (data.hours as number) || 0;
    const minutes = (data.minutes as number) || 0;
    return days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
  }

  // Legacy value/unit format
  const value = (data.value as number) || (data.delay as number) || 1;
  const unit = (data.unit as string) || (data.delayUnit as string) || 'hours';

  const multipliers: Record<string, number> = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || multipliers.hours);
}

/**
 * Get connection request message from a connectionRequest node
 */
export function getConnectionRequestMessage(
  node: WorkflowNode,
  variationIndex = 0
): string | undefined {
  const data = node.data;

  // Check for A/B test variations
  const variations = data.messageVariations as string[] | undefined;
  if (variations && variations.length > 0) {
    const idx = variationIndex % variations.length;
    return variations[idx] || undefined;
  }

  // Single message (optional)
  const message = (data.message as string) || (data.note as string);
  return message || undefined;
}

/**
 * Get auto-withdraw settings from a connectionRequest node
 */
export function getAutoWithdrawSettings(node: WorkflowNode): {
  enabled: boolean;
  afterDays: number;
} {
  const data = node.data;
  const afterDays = (data.withdrawAfterDays as number) || 7;

  // Auto-withdraw is enabled if explicitly set OR if withdrawAfterDays is configured
  // (the UI sets withdrawAfterDays without setting autoWithdraw explicitly)
  const enabled = (data.autoWithdraw as boolean) ?? (data.withdrawAfterDays !== undefined);

  return {
    enabled,
    afterDays,
  };
}

/**
 * Get the condition type from a condition node
 */
export function getConditionType(node: WorkflowNode): string {
  const data = node.data;
  return (data.conditionType as string) || (data.type as string) || 'connection_accepted';
}

// ============================================================================
// Template Variable Replacement
// ============================================================================

export interface TemplateContext {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  company?: string;
  jobTitle?: string;
  headline?: string;
  // Declared explicitly like the fields above; without these they fell through
  // to the index signature and read back as string | Record | undefined.
  location?: string;
  industry?: string;
  linkedinBio?: string;
  homePageText?: string;
  // Sender identity (from sending account / mailbox display name)
  senderName?: string;
  senderFirstName?: string;
  senderLastName?: string;
  customField1?: string;
  customField2?: string;
  // AI Analysis fields from enrichment_data
  aiPrimaryNeed?: string;
  aiPrimaryNeedReason?: string;
  aiPrimaryNeedEvidence?: string;
  aiPrimaryNeedConfidence?: string;
  aiColdEmailAngle?: string;
  aiCompanyNiche?: string;
  aiCompanyOffering?: string;
  aiCompanyTarget?: string;
  aiCompanyTagline?: string;
  aiBestHook?: string;
  aiLinkedInTopic1?: string;
  aiPriority1?: string;
  aiGrowthSignal1?: string;
  aiLatestFunding?: string;
  aiFundingAmount?: string;
  // Discovery Layer signal context (from crm_contacts.discovery_metadata)
  aiSignalType?: string;
  aiSignalDate?: string;
  aiSignalDetail?: string;
  aiSignalContext?: string;
  aiSignalSourceUrl?: string;
  aiSignalCompanyWebsite?: string;
  aiSignalCompanyLinkedin?: string;
  aiSignalCompanyIndustry?: string;
  aiSignalCompanySize?: string;
  aiSignalRevenue?: string;
  aiSignalPerson?: string;
  aiSignalNewRole?: string;
  aiSignalAmount?: string;
  aiSignalInvestors?: string;
  aiSignalConfidence?: string;
  aiPackSource?: string;
  aiDirectoryEvidenceUrl?: string;
  aiEmailConfidence?: string;
  aiPracticeSignal1?: string;
  // Hiring-specific signal fields (also exposed to templates)
  aiSignalRoleLocation?: string;
  aiSignalSeniority?: string;
  aiSignalEmploymentType?: string;
  aiSignalNumApplicants?: string;
  // Deliverable URLs
  notionPreviewUrl?: string;
  // Generated email content (from generateEmails node)
  emailSubject1?: string;
  emailBody1?: string;
  emailSubject2?: string;
  emailBody2?: string;
  emailSubject3?: string;
  emailBody3?: string;
  emailSubject4?: string;
  emailBody4?: string;
  emailSubject5?: string;
  emailBody5?: string;
  emailSubject6?: string;
  emailBody6?: string;
  emailSubject7?: string;
  emailBody7?: string;
  // Org custom fields (crm_custom_field_defs / crm_contacts.custom_fields), resolved
  // via {{custom_<field_key>}}. contactCustomFields holds the lead's own values;
  // customFieldDefaults holds the org-level placeholder used when a lead has none.
  contactCustomFields?: Record<string, string>;
  customFieldDefaults?: Record<string, string>;
  [key: string]: string | Record<string, string> | undefined;
}

/**
 * Replace template variables in message content
 *
 * Supported variables:
 * - {firstName}, {first_name}, {{first_name}}
 * - {lastName}, {last_name}, {{last_name}}
 * - {fullName}, {full_name}, {name}, {{full_name}}
 * - {company}, {{company}}
 * - {jobTitle}, {job_title}, {title}, {{position}}
 * - {headline}
 * - {{sender_name}}, {{sender_first_name}}, {{sender_last_name}} (from the sending account)
 * - {custom1}, {custom2}, etc.
 * - AI Analysis variables: {{ai_primary_need}}, {{ai_company_niche}}, etc.
 */
/** Dynamic context lookups (`context[\`customField${i}\`]`) come back as
 * string | Record<string, string> | undefined via the index signature. Only a
 * string is substitutable: passing a Record to String.replace stringifies it to
 * "[object Object]", which would then be sent to a prospect. Treat anything
 * non-string as absent. */
function asText(value: string | Record<string, string> | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function replaceTemplateVariables(
  template: string,
  context: TemplateContext
): string {
  let result = template;

  // First name
  const firstName = context.firstName || 'there';
  result = result.replace(/\{\{first_name\}\}/gi, firstName);
  result = result.replace(/\{firstName\}/gi, firstName);
  result = result.replace(/\{first_name\}/gi, firstName);

  // Last name
  const lastName = context.lastName || '';
  result = result.replace(/\{\{last_name\}\}/gi, lastName);
  result = result.replace(/\{lastName\}/gi, lastName);
  result = result.replace(/\{last_name\}/gi, lastName);

  // Full name
  const fullName = context.fullName || `${firstName} ${lastName}`.trim() || 'there';
  result = result.replace(/\{\{full_name\}\}/gi, fullName);
  result = result.replace(/\{fullName\}/gi, fullName);
  result = result.replace(/\{full_name\}/gi, fullName);
  result = result.replace(/\{name\}/gi, firstName); // {name} defaults to first name

  // Company
  const company = context.company || '';
  result = result.replace(/\{\{company\}\}/gi, company);
  result = result.replace(/\{company\}/gi, company);

  // Job title / Position
  const jobTitle = context.jobTitle || '';
  result = result.replace(/\{\{position\}\}/gi, jobTitle);
  result = result.replace(/\{jobTitle\}/gi, jobTitle);
  result = result.replace(/\{job_title\}/gi, jobTitle);
  result = result.replace(/\{title\}/gi, jobTitle);

  // Location
  const location = context.location || '';
  result = result.replace(/\{\{location\}\}/gi, location);
  result = result.replace(/\{location\}/gi, location);

  // Industry
  const industry = context.industry || '';
  result = result.replace(/\{\{industry\}\}/gi, industry);
  result = result.replace(/\{industry\}/gi, industry);

  // Headline
  const headline = context.headline || '';
  result = result.replace(/\{\{headline\}\}/gi, headline);
  result = result.replace(/\{headline\}/gi, headline);

  // LinkedIn bio
  const linkedinBio = context.linkedinBio || '';
  result = result.replace(/\{\{linkedin_bio\}\}/gi, linkedinBio);
  result = result.replace(/\{linkedin_bio\}/gi, linkedinBio);

  // Home page text
  const homePageText = context.homePageText || '';
  result = result.replace(/\{\{home_page_text\}\}/gi, homePageText);
  result = result.replace(/\{home_page_text\}/gi, homePageText);

  // Sender variables
  const senderName = context.senderName || '';
  result = result.replace(/\{\{sender_name\}\}/gi, senderName);
  result = result.replace(/\{sender_name\}/gi, senderName);

  const senderFirstName = context.senderFirstName || '';
  result = result.replace(/\{\{sender_first_name\}\}/gi, senderFirstName);
  result = result.replace(/\{sender_first_name\}/gi, senderFirstName);

  const senderLastName = context.senderLastName || '';
  result = result.replace(/\{\{sender_last_name\}\}/gi, senderLastName);
  result = result.replace(/\{sender_last_name\}/gi, senderLastName);

  // Custom fields
  for (let i = 1; i <= 10; i++) {
    const customValue = asText(context[`customField${i}`]);
    result = result.replace(new RegExp(`\\{custom${i}\\}`, 'gi'), customValue);
  }

  // ============================================================================
  // AI Analysis Variables (from enrichment_data)
  // ============================================================================

  // Primary need (THE key variable for outreach)
  const aiPrimaryNeed = context.aiPrimaryNeed || '';
  result = result.replace(/\{\{ai_primary_need\}\}/gi, aiPrimaryNeed);
  result = result.replace(/\{ai_primary_need\}/gi, aiPrimaryNeed);

  // Primary need reasoning
  const aiPrimaryNeedReason = context.aiPrimaryNeedReason || '';
  result = result.replace(/\{\{ai_primary_need_reason\}\}/gi, aiPrimaryNeedReason);
  result = result.replace(/\{ai_primary_need_reason\}/gi, aiPrimaryNeedReason);

  // Primary need evidence (the observed fact the hypothesis is grounded in)
  const aiPrimaryNeedEvidence = context.aiPrimaryNeedEvidence || '';
  result = result.replace(/\{\{ai_primary_need_evidence\}\}/gi, aiPrimaryNeedEvidence);
  result = result.replace(/\{ai_primary_need_evidence\}/gi, aiPrimaryNeedEvidence);

  // Primary need confidence (low/medium/high)
  const aiPrimaryNeedConfidence = context.aiPrimaryNeedConfidence || '';
  result = result.replace(/\{\{ai_primary_need_confidence\}\}/gi, aiPrimaryNeedConfidence);
  result = result.replace(/\{ai_primary_need_confidence\}/gi, aiPrimaryNeedConfidence);

  // Safe cold-email angle
  const aiColdEmailAngle = context.aiColdEmailAngle || '';
  result = result.replace(/\{\{ai_cold_email_angle\}\}/gi, aiColdEmailAngle);
  result = result.replace(/\{ai_cold_email_angle\}/gi, aiColdEmailAngle);

  // Company niche
  const aiCompanyNiche = context.aiCompanyNiche || '';
  result = result.replace(/\{\{ai_company_niche\}\}/gi, aiCompanyNiche);
  result = result.replace(/\{ai_company_niche\}/gi, aiCompanyNiche);

  // Company offering
  const aiCompanyOffering = context.aiCompanyOffering || '';
  result = result.replace(/\{\{ai_company_offering\}\}/gi, aiCompanyOffering);
  result = result.replace(/\{ai_company_offering\}/gi, aiCompanyOffering);

  // Company target
  const aiCompanyTarget = context.aiCompanyTarget || '';
  result = result.replace(/\{\{ai_company_target\}\}/gi, aiCompanyTarget);
  result = result.replace(/\{ai_company_target\}/gi, aiCompanyTarget);

  // Company tagline
  const aiCompanyTagline = context.aiCompanyTagline || '';
  result = result.replace(/\{\{ai_company_tagline\}\}/gi, aiCompanyTagline);
  result = result.replace(/\{ai_company_tagline\}/gi, aiCompanyTagline);

  // Best hook (LinkedIn icebreaker)
  const aiBestHook = context.aiBestHook || '';
  result = result.replace(/\{\{ai_best_hook\}\}/gi, aiBestHook);
  result = result.replace(/\{ai_best_hook\}/gi, aiBestHook);

  // LinkedIn topic
  const aiLinkedInTopic1 = context.aiLinkedInTopic1 || '';
  result = result.replace(/\{\{ai_linkedin_topic_1\}\}/gi, aiLinkedInTopic1);
  result = result.replace(/\{ai_linkedin_topic_1\}/gi, aiLinkedInTopic1);

  // Priority
  const aiPriority1 = context.aiPriority1 || '';
  result = result.replace(/\{\{ai_priority_1\}\}/gi, aiPriority1);
  result = result.replace(/\{ai_priority_1\}/gi, aiPriority1);

  // Growth signal
  const aiGrowthSignal1 = context.aiGrowthSignal1 || '';
  result = result.replace(/\{\{ai_growth_signal_1\}\}/gi, aiGrowthSignal1);
  result = result.replace(/\{ai_growth_signal_1\}/gi, aiGrowthSignal1);

  // Latest funding
  const aiLatestFunding = context.aiLatestFunding || '';
  result = result.replace(/\{\{ai_latest_funding\}\}/gi, aiLatestFunding);
  result = result.replace(/\{ai_latest_funding\}/gi, aiLatestFunding);

  // Funding amount
  const aiFundingAmount = context.aiFundingAmount || '';
  result = result.replace(/\{\{ai_funding_amount\}\}/gi, aiFundingAmount);
  result = result.replace(/\{ai_funding_amount\}/gi, aiFundingAmount);

  // ============================================================================
  // Discovery Layer Signal Variables (from crm_contacts.discovery_metadata)
  // ============================================================================

  // Signal type (e.g. 'just_funded', 'aggressive_hiring', 'tech_stack_change')
  const aiSignalType = context.aiSignalType || '';
  result = result.replace(/\{\{ai_signal_type\}\}/gi, aiSignalType);
  result = result.replace(/\{ai_signal_type\}/gi, aiSignalType);

  // Signal date (YYYY-MM-DD)
  const aiSignalDate = context.aiSignalDate || '';
  result = result.replace(/\{\{ai_signal_date\}\}/gi, aiSignalDate);
  result = result.replace(/\{ai_signal_date\}/gi, aiSignalDate);

  // Signal detail (e.g. 'Series B, $30M, Sequoia-led')
  const aiSignalDetail = context.aiSignalDetail || '';
  result = result.replace(/\{\{ai_signal_detail\}\}/gi, aiSignalDetail);
  result = result.replace(/\{ai_signal_detail\}/gi, aiSignalDetail);

  const aiSignalContext = context.aiSignalContext || '';
  result = result.replace(/\{\{ai_signal_context\}\}/gi, aiSignalContext);
  result = result.replace(/\{ai_signal_context\}/gi, aiSignalContext);

  const aiSignalSourceUrl = context.aiSignalSourceUrl || '';
  result = result.replace(/\{\{ai_signal_source_url\}\}/gi, aiSignalSourceUrl);
  result = result.replace(/\{ai_signal_source_url\}/gi, aiSignalSourceUrl);

  const aiSignalCompanyWebsite = context.aiSignalCompanyWebsite || '';
  result = result.replace(/\{\{ai_signal_company_website\}\}/gi, aiSignalCompanyWebsite);
  result = result.replace(/\{ai_signal_company_website\}/gi, aiSignalCompanyWebsite);

  const aiSignalCompanyLinkedin = context.aiSignalCompanyLinkedin || '';
  result = result.replace(/\{\{ai_signal_company_linkedin\}\}/gi, aiSignalCompanyLinkedin);
  result = result.replace(/\{ai_signal_company_linkedin\}/gi, aiSignalCompanyLinkedin);

  const aiSignalCompanyIndustry = context.aiSignalCompanyIndustry || '';
  result = result.replace(/\{\{ai_signal_company_industry\}\}/gi, aiSignalCompanyIndustry);
  result = result.replace(/\{ai_signal_company_industry\}/gi, aiSignalCompanyIndustry);

  const aiSignalCompanySize = context.aiSignalCompanySize || '';
  result = result.replace(/\{\{ai_signal_company_size\}\}/gi, aiSignalCompanySize);
  result = result.replace(/\{ai_signal_company_size\}/gi, aiSignalCompanySize);

  const aiSignalRevenue = context.aiSignalRevenue || '';
  result = result.replace(/\{\{ai_signal_revenue\}\}/gi, aiSignalRevenue);
  result = result.replace(/\{ai_signal_revenue\}/gi, aiSignalRevenue);

  const aiSignalPerson = context.aiSignalPerson || '';
  result = result.replace(/\{\{ai_signal_person\}\}/gi, aiSignalPerson);
  result = result.replace(/\{ai_signal_person\}/gi, aiSignalPerson);

  const aiSignalNewRole = context.aiSignalNewRole || '';
  result = result.replace(/\{\{ai_signal_new_role\}\}/gi, aiSignalNewRole);
  result = result.replace(/\{ai_signal_new_role\}/gi, aiSignalNewRole);

  const aiSignalAmount = context.aiSignalAmount || '';
  result = result.replace(/\{\{ai_signal_amount\}\}/gi, aiSignalAmount);
  result = result.replace(/\{ai_signal_amount\}/gi, aiSignalAmount);

  const aiSignalInvestors = context.aiSignalInvestors || '';
  result = result.replace(/\{\{ai_signal_investors\}\}/gi, aiSignalInvestors);
  result = result.replace(/\{ai_signal_investors\}/gi, aiSignalInvestors);

  const aiSignalConfidence = context.aiSignalConfidence || '';
  result = result.replace(/\{\{ai_signal_confidence\}\}/gi, aiSignalConfidence);
  result = result.replace(/\{ai_signal_confidence\}/gi, aiSignalConfidence);

  // Pack source label (e.g. 'Just-Funded SaaS Pack', 'M&A Advisory Pack')
  const aiPackSource = context.aiPackSource || '';
  result = result.replace(/\{\{ai_pack_source\}\}/gi, aiPackSource);
  result = result.replace(/\{ai_pack_source\}/gi, aiPackSource);

  // Directory evidence URL (Trade / Pro Services packs)
  const aiDirectoryEvidenceUrl = context.aiDirectoryEvidenceUrl || '';
  result = result.replace(/\{\{ai_directory_evidence_url\}\}/gi, aiDirectoryEvidenceUrl);
  result = result.replace(/\{ai_directory_evidence_url\}/gi, aiDirectoryEvidenceUrl);

  // Email confidence (0-100, from Discovery email path)
  const aiEmailConfidence = context.aiEmailConfidence || '';
  result = result.replace(/\{\{ai_email_confidence\}\}/gi, aiEmailConfidence);
  result = result.replace(/\{ai_email_confidence\}/gi, aiEmailConfidence);

  // Practice signal (Pro Services pack — recent deal, named win, etc.)
  const aiPracticeSignal1 = context.aiPracticeSignal1 || '';
  result = result.replace(/\{\{ai_practice_signal_1\}\}/gi, aiPracticeSignal1);
  result = result.replace(/\{ai_practice_signal_1\}/gi, aiPracticeSignal1);

  // Hiring-specific extras (Aggressive Hiring pack)
  const aiSignalRoleLocation = context.aiSignalRoleLocation || '';
  result = result.replace(/\{\{ai_signal_role_location\}\}/gi, aiSignalRoleLocation);
  result = result.replace(/\{ai_signal_role_location\}/gi, aiSignalRoleLocation);

  const aiSignalSeniority = context.aiSignalSeniority || '';
  result = result.replace(/\{\{ai_signal_seniority\}\}/gi, aiSignalSeniority);
  result = result.replace(/\{ai_signal_seniority\}/gi, aiSignalSeniority);

  const aiSignalEmploymentType = context.aiSignalEmploymentType || '';
  result = result.replace(/\{\{ai_signal_employment_type\}\}/gi, aiSignalEmploymentType);
  result = result.replace(/\{ai_signal_employment_type\}/gi, aiSignalEmploymentType);

  const aiSignalNumApplicants = context.aiSignalNumApplicants || '';
  result = result.replace(/\{\{ai_signal_num_applicants\}\}/gi, aiSignalNumApplicants);
  result = result.replace(/\{ai_signal_num_applicants\}/gi, aiSignalNumApplicants);

  // ============================================================================
  // Deliverable URLs
  // ============================================================================

  const notionPreviewUrl = context.notionPreviewUrl || '';
  result = result.replace(/\{\{notion_preview_url\}\}/gi, notionPreviewUrl);
  result = result.replace(/\{notion_preview_url\}/gi, notionPreviewUrl);

  // ============================================================================
  // Generated Email Content (from generateEmails node)
  // ============================================================================

  for (let i = 1; i <= 7; i++) {
    const subject = asText(context[`emailSubject${i}`]);
    result = result.replace(new RegExp(`\\{\\{email_subject_${i}\\}\\}`, 'gi'), subject);
    result = result.replace(new RegExp(`\\{email_subject_${i}\\}`, 'gi'), subject);

    const body = asText(context[`emailBody${i}`]);
    result = result.replace(new RegExp(`\\{\\{email_body_${i}\\}\\}`, 'gi'), body);
    result = result.replace(new RegExp(`\\{email_body_${i}\\}`, 'gi'), body);
  }

  // ============================================================================
  // Org Custom Fields (crm_custom_field_defs / crm_contacts.custom_fields)
  // ============================================================================
  // Resolution order: lead's own value -> org-level placeholder default -> ''.
  // Legacy {custom1}..{custom10} above stay untouched; this handles the
  // {{custom_<field_key>}} tokens used by CSV import, the variable picker, and
  // the Settings > Custom Fields manager.
  result = result.replace(/\{\{\s*custom_(\w+)\s*\}\}/gi, (_match, key) => {
    const leadValue = context.contactCustomFields?.[key];
    if (leadValue !== undefined && leadValue !== null && leadValue !== '') return leadValue;
    const defaultValue = context.customFieldDefaults?.[key];
    return defaultValue ?? '';
  });

  // Resolve spintax {a|b|c} last, after all variables are interpolated.
  // This way a variable expansion can itself contain spintax if needed.
  result = resolveSpintax(result);

  return result;
}

/**
 * Resolve flat spintax: `{a|b|c}` -> one of the branches, chosen uniformly.
 *
 * Only matches groups with no nested braces and at least one `|`, so single-brace
 * variables like `{firstName}` are left alone. Empty branches are allowed
 * (`{|hello}` can resolve to ""). Returns the input unchanged if no spintax found.
 *
 * Deliberately duplicated, not shared. Three runtimes need this (Deno here,
 * Vite in src/lib/message-variables.ts, Node in
 * workers/sequence-sender/src/index.ts) and the Fly worker's Docker build
 * context is its own directory, so no repo-root module is importable by all
 * three without reworking the build. Eight dependency-free lines are not worth
 * that. Keep the three copies byte-identical; call them only from the
 * substitution functions above, never directly from a caller.
 */
export function resolveSpintax(text: string): string {
  if (!text || text.indexOf('|') === -1) return text;
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group: string) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

// ============================================================================
// Business Hours Checking
// ============================================================================

export interface BusinessHoursConfig {
  enabled: boolean;
  timezone: string;
  startHour: number; // 0-23
  endHour: number; // 0-23
  workDays: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
}

/**
 * Check if current time is within business hours
 */
export function isWithinBusinessHours(config: BusinessHoursConfig): boolean {
  if (!config.enabled) {
    return true;
  }

  // Get current time in the specified timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone || 'UTC',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  const weekdayPart = parts.find((p) => p.type === 'weekday');

  if (!hourPart || !weekdayPart) {
    return true; // Default to allowing if we can't determine
  }

  const currentHour = parseInt(hourPart.value, 10);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const currentDay = weekdayMap[weekdayPart.value] ?? 1;

  // Check if it's a work day
  const workDays = config.workDays || [1, 2, 3, 4, 5]; // Default Mon-Fri
  if (!workDays.includes(currentDay)) {
    return false;
  }

  // Check if within hours
  const startHour = config.startHour ?? 9;
  const endHour = config.endHour ?? 17;

  return currentHour >= startHour && currentHour < endHour;
}

/**
 * Convert a startHour in a given timezone to a proper UTC Date on `baseDate`.
 * Uses the probe+offset technique: set UTC hours, check what local time that is,
 * then adjust so local time matches the desired startHour.
 */
function toTimezoneAwareUTC(baseDate: Date, startHour: number, timezone: string): Date {
  const target = new Date(baseDate);
  target.setUTCHours(startHour, 0, 0, 0);

  const probeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const probeParts = probeFormatter.formatToParts(target);
  const probeHour = parseInt(probeParts.find((p) => p.type === 'hour')?.value || '0', 10);
  const probeMinute = parseInt(probeParts.find((p) => p.type === 'minute')?.value || '0', 10);
  const offsetMinutes = (probeHour * 60 + probeMinute) - (startHour * 60);
  target.setTime(target.getTime() - offsetMinutes * 60 * 1000);

  return target;
}

/**
 * Calculate next business hours start time (timezone-aware)
 */
export function getNextBusinessHoursStart(config: BusinessHoursConfig): Date {
  const now = new Date();

  // If not enabled, return now
  if (!config.enabled) {
    return now;
  }

  const workDays = config.workDays || [1, 2, 3, 4, 5];
  const startHour = config.startHour ?? 9;
  const timezone = config.timezone || 'UTC';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // Try each day for the next 7 days
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const checkDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    // Get day of week in target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const weekdayPart = formatter.formatToParts(checkDate).find((p) => p.type === 'weekday');
    const dayOfWeek = weekdayMap[weekdayPart?.value || 'Mon'] ?? 1;

    if (workDays.includes(dayOfWeek)) {
      // Convert startHour in org timezone to UTC
      const targetDate = toTimezoneAwareUTC(checkDate, startHour, timezone);

      // If it's today and we haven't passed start hour, use today
      if (dayOffset === 0 && targetDate > now) {
        return targetDate;
      }

      // Otherwise use this day if it's in the future
      if (dayOffset > 0) {
        return targetDate;
      }
    }
  }

  // Fallback: return tomorrow at start hour (timezone-aware)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return toTimezoneAwareUTC(tomorrow, startHour, timezone);
}

// ============================================================================
// Sender Selection
// ============================================================================

/**
 * Select a sender account for a lead (round-robin distribution)
 *
 * @param senderAccountIds - Array of available sender account IDs
 * @param leadIndex - Index of the lead (for distribution)
 * @returns Selected sender account ID
 */
export function selectSenderAccount(
  senderAccountIds: string[],
  leadIndex: number
): string | null {
  if (!senderAccountIds || senderAccountIds.length === 0) {
    return null;
  }

  // Round-robin selection
  const index = leadIndex % senderAccountIds.length;
  return senderAccountIds[index];
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Calculate exponential backoff delay
 *
 * @param retryCount - Number of retries so far
 * @param baseDelayMs - Base delay in milliseconds (default 60000 = 1 minute)
 * @param maxDelayMs - Maximum delay in milliseconds (default 3600000 = 1 hour)
 * @returns Delay in milliseconds before next retry
 */
export function calculateBackoffDelay(
  retryCount: number,
  baseDelayMs = 60000,
  maxDelayMs = 3600000
): number {
  // 2^retryCount * baseDelay, capped at maxDelay
  const delay = Math.min(Math.pow(2, retryCount) * baseDelayMs, maxDelayMs);

  // Add some jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);

  return Math.round(delay + jitter);
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(errorCode: string): boolean {
  const retryableCodes = [
    'RATE_LIMITED',
    'NETWORK_ERROR',
    'PROVIDER_ERROR',
    'TIMEOUT',
  ];
  return retryableCodes.includes(errorCode);
}

/**
 * Maximum retry attempts before marking as failed
 */
export const MAX_RETRY_COUNT = 3;
