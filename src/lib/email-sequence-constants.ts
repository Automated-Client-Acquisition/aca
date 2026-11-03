// Shared constants for email sequence generation UI
// Used by GenerateEmailSequenceDialog and GenerateAndSendDialog

// Variable categories for insertion UI — aligned with workflow-utils.ts {{variable}} names
export const VARIABLE_CATEGORIES = [
  {
    label: 'Contact',
    variables: [
      { name: 'first_name', label: 'First Name' },
      { name: 'last_name', label: 'Last Name' },
      { name: 'company', label: 'Company' },
      { name: 'job_title', label: 'Job Title' },
      { name: 'primary_email', label: 'Email' },
      { name: 'city', label: 'City' },
      { name: 'country', label: 'Country' },
    ],
  },
  {
    label: 'Enrichment',
    variables: [
      { name: 'ai_primary_need', label: 'Primary Need' },
      { name: 'ai_primary_need_reason', label: 'Need Reasoning' },
      { name: 'ai_company_niche', label: 'Company Niche' },
      { name: 'ai_company_offering', label: 'Company Offering' },
      { name: 'ai_company_target', label: 'Their Customers' },
      { name: 'ai_company_tagline', label: 'Tagline' },
      { name: 'ai_best_hook', label: 'Best Hook' },
      { name: 'ai_linkedin_topic_1', label: 'LinkedIn Topic' },
      { name: 'ai_priority_1', label: 'Top Priority' },
      { name: 'ai_growth_signal_1', label: 'Growth Signal' },
    ],
  },
  {
    label: 'Product',
    variables: [
      { name: 'product_name', label: 'Product Name' },
      { name: 'product_description', label: 'Product Description' },
      { name: 'product_features', label: 'Features' },
      { name: 'product_benefits', label: 'Key Benefits' },
      { name: 'ai_selected_outcome', label: 'Selected Outcome' },
    ],
  },
  {
    label: 'Deliverables',
    variables: [
      { name: 'notion_preview_url', label: 'Notion Preview URL' },
    ],
  },
  {
    label: 'Generated Emails',
    variables: [
      { name: 'email_subject_1', label: 'Email 1 Subject' },
      { name: 'email_body_1', label: 'Email 1 Body' },
      { name: 'email_subject_2', label: 'Email 2 Subject' },
      { name: 'email_body_2', label: 'Email 2 Body' },
      { name: 'email_subject_3', label: 'Email 3 Subject' },
      { name: 'email_body_3', label: 'Email 3 Body' },
      { name: 'email_subject_4', label: 'Email 4 Subject' },
      { name: 'email_body_4', label: 'Email 4 Body' },
      { name: 'email_subject_5', label: 'Email 5 Subject' },
      { name: 'email_body_5', label: 'Email 5 Body' },
    ],
  },
] as const;

export type VariableCategory = (typeof VARIABLE_CATEGORIES)[number];

// Email prompt presets
export const PROMPT_PRESETS = [
  {
    name: 'Insight-Led Outreach',
    description: 'Lead with observations about their business, not a pitch',
    template: `Write an insight-led email sequence for {{first_name}} at {{company}}.

Open with a specific observation about their business in {{ai_company_niche}}.
Their primary need is {{ai_primary_need}}. Their customers are {{ai_company_target}}.

Rules:
- Email 1: Pure curiosity + observation. NO pitch. Just an interesting insight about their space and a genuine question.
- Email 2: Share a genuinely useful insight related to {{ai_priority_1}}. Soft mention of how you could help.
- Email 3+: Shorter, more direct. Reference the previous emails naturally.
- Every email ends with a question, never a CTA button or "book a call" link.
- Write as a knowledgeable peer, not a vendor. Never say "we help", "our solution", or "we provide".
- Use their language: {{ai_company_verbiage}}.`,
  },
  {
    name: 'Deliverable Preview',
    description: 'Lead with a personalized Notion strategy doc as a gift',
    template: `Write a 3-step cold email sequence for {{first_name}} at {{company}}.
Context:

Their need: {{ai_primary_need}}
Their niche: {{ai_company_niche}}
Their top priority: {{ai_priority_1}}
Their language/terminology: {{ai_company_verbiage}}
We sell: {{product_name}} — {{product_description}}
Best outcome we deliver: {{ai_selected_outcome}}

IMPORTANT: Every email must tie back to {{product_name}} and the outcome we deliver. Do NOT invent or imply services we don't offer. Stay strictly on the outcome: {{ai_selected_outcome}}.

Sequence structure:
Email 1 — Cold open + gift (lead with value)

Subject: lowercase, specific to {{company}}, under 6 words.
Open with a sharp observation about {{company}} that proves you did research. Reference something specific about their market position, hiring model, or growth signals — not a generic compliment.
State that you put together a strategy for {{company}} tied to the outcome we deliver. One sentence, no hype.
Describe what the doc covers in ONE concrete sentence tied to {{ai_primary_need}}. Make it specific enough that they know it's not a generic lead magnet.
CTA: Worth a 5-minute conversation to understand if there's a fit?
Close with: "Either way, the doc is yours."
Maximum 6 sentences. No sign-off fluff.
Do NOT write a PS or include a link — the strategy doc link ({{notion_preview_url}}) is appended automatically after the email body.

Email 2 — Follow up on the doc (reply to Email 1 thread)

Subject: re: [Email 1 subject]
The strategy doc was already sent in Email 1. Reference it in ONE short sentence and ask if they've had a chance to look at it. Do NOT offer to send it again. Do NOT guilt-trip or say "just following up."
Add ONE new specific insight about {{ai_company_niche}} that connects to what the doc covers and ties back to the outcome we deliver. Something a domain expert would know, not a salesperson.
Resurface the CTA: Worth a 5-minute conversation to understand if there's a fit?
Maximum 5 sentences.

Email 3 — New angle + soft close (reply to same thread)

Subject: re: [Email 1 subject]
Do NOT open with "following up" or "circling back."
Lead with ONE new insight, stat, or angle about their niche ({{ai_company_niche}}) that they'd find genuinely interesting — something a domain expert would know. This insight MUST connect back to the outcome we deliver, not a different service.
Connect it back to the outcome: {{ai_selected_outcome}}.
Close with ONE of these CTAs (rotate, don't always pick the same): "Would it be worth a quick conversation?" / "Open to a quick chat about this?" / "Any interest in exploring this further?"
Maximum 5 sentences.

Style rules:
- Write as a domain expert in {{ai_company_niche}} who happens to have a solution — NOT as a salesperson.
- Use their terminology: {{ai_company_verbiage}}.
- Tone: direct, peer-to-peer, no filler words, no corporate speak.
- Never use words like "synergy," "leverage," "touch base," "circle back," "just wanted to," "I hope this finds you well."
- No bullet points in the emails. No bold text in the emails.
- Every sentence must earn its place — if it doesn't move the conversation forward, cut it.
- Each email MUST start with "Hi {{first_name}}," and contain no text before or after the message body.
- No signature blocks — end on the last sentence.`,
  },
  {
    name: 'Peer Conversation',
    description: 'Conversational, question-heavy, zero pitch language',
    template: `Write a conversational email sequence for {{first_name}} at {{company}}.

Their world: {{ai_company_niche}}, selling {{ai_company_offering}} to {{ai_company_target}}.
Their top priority: {{ai_priority_1}}.

Rules:
- Every email reads like a message from a smart peer in their industry, NOT a sales email.
- Open each email with an observation or question, never with "I" or anything about yourself.
- BANNED phrases: "we help", "our solution", "I wanted to reach out", "I hope this finds you", "we provide", "our platform".
- Each email introduces ONE idea. No bullet lists of features or benefits.
- End every email with a genuine question that shows you understand their business.
- Progressively get more casual and shorter.
- Mirror their tone: {{ai_company_tone}}.`,
  },
  {
    name: 'Pain-Point Outreach',
    description: 'Reference their specific need and offer a solution',
    template: `Write a cold email sequence for {{first_name}} at {{company}}.
Their primary need is: {{ai_primary_need}}.
Reference their niche ({{ai_company_niche}}) and what they sell ({{ai_company_offering}}).
Use a consultative, non-salesy tone. End each email with a question, not a hard CTA.
Keep emails under 5 sentences. Write as a peer, not a vendor.`,
  },
  {
    name: 'Value-First',
    description: 'Lead with insights and offer resources',
    template: `Write a value-first email sequence for {{first_name}} at {{company}}.
Lead with insights about {{ai_company_niche}} and how {{ai_primary_need}} impacts companies like theirs.
Offer a relevant insight or resource in each email. End with an open question to start a conversation.
Tone: friendly and helpful, not pushy. Reference their priorities: {{ai_priority_1}}.`,
  },
  {
    name: 'Social Proof',
    description: 'Lead with case studies and results',
    template: `Write a social proof driven sequence for {{first_name}} at {{company}}.
Their need: {{ai_primary_need}}. Their target customers: {{ai_company_target}}.
Reference relevant success stories or results for similar companies in {{ai_company_niche}}.
End with an invitation to see a demo. Tone: confident but not arrogant.`,
  },
  {
    name: 'Product Domain Expert',
    description: 'Position as a domain expert using product intelligence',
    template: `Write an expert outreach sequence for {{first_name}} at {{company}}.

Context about their business:
- Niche: {{ai_company_niche}}, selling {{ai_company_offering}} to {{ai_company_target}}
- Primary need: {{ai_primary_need}}
- Top priority: {{ai_priority_1}}

Our domain: {{product_name}} — {{product_description}}
Best outcome for them: {{ai_selected_outcome}}

Rules:
- Write as a knowledgeable practitioner in the {{product_name}} domain, NOT as a vendor.
- Email 1: Share a specific observation about how {{company}} could benefit from better practices in this domain. Ask a genuine question.
- Email 2: Drop a domain-specific insight related to {{ai_priority_1}}. Connect it to outcomes companies like theirs achieve.
- Email 3+: Different angles — competitive dynamics, industry benchmarks, or a relevant case reference.
- BANNED: "we help", "our solution", "we provide", "our platform".
- Use their language: {{ai_company_verbiage}}.
- Mirror their tone: {{ai_company_tone}}.`,
  },
  {
    name: 'Breakup / Re-engagement',
    description: 'Short, permission-based check-in',
    template: `Write a short re-engagement sequence for {{first_name}} at {{company}}.
We previously reached out about {{ai_primary_need}}. Be concise and permission-based.
Email 1: Quick check-in with a new angle. Email 2: Graceful close with an easy out.
Tone: casual and respectful of their time.`,
  },
] as const;

export type PromptPreset = (typeof PROMPT_PRESETS)[number];

// Notion document blueprint definitions (frontend-friendly)
// The actual AI prompts live server-side in _shared/notion-blueprint-prompts.ts
export interface NotionBlueprintDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  blockTypeTags: string[];
  sections: Array<{ title: string; description: string }>;
}

export const NOTION_BLUEPRINTS: NotionBlueprintDef[] = [
  {
    id: 'strategic-growth',
    name: 'Strategic Growth Analysis',
    description: 'Maps their business to growth opportunities through your product domain expertise',
    icon: '📈',
    blockTypeTags: ['Table', 'Toggles', 'Columns', 'Callouts'],
    sections: [
      { title: 'Hero Header', description: 'Company name + domain-specific insight' },
      { title: 'Business Snapshot', description: 'Side-by-side stat cards and overview' },
      { title: 'Where the Growth Is', description: 'Domain-expert observations with benchmarks' },
      { title: 'Opportunity Map', description: 'Table: Strategy → Opportunity → Impact' },
      { title: 'Outcome Scenarios', description: 'Projected results and milestones' },
      { title: 'Biggest Lever', description: 'Highest-impact opportunity identified' },
      { title: 'Next Step', description: 'Meeting invitation to discuss execution' },
    ],
  },
  {
    id: 'competitive-landscape',
    name: 'Competitive Landscape Brief',
    description: 'Analyzes their market position through your domain lens — gaps and opportunities',
    icon: '🏆',
    blockTypeTags: ['Table', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Where You Stand', description: 'Domain-specific positioning assessment' },
      { title: 'What Leaders Do', description: 'Domain benchmark comparison table' },
      { title: 'Gaps That Matter', description: 'Deep analysis with business impact' },
      { title: 'The Path Forward', description: 'Strategic recommendations' },
      { title: 'Bottom Line', description: 'Synthesized opportunity' },
    ],
  },
  {
    id: 'roi-projection',
    name: 'ROI Projection & Impact Model',
    description: 'Numbers-focused analysis with domain-specific projections and value drivers',
    icon: '💰',
    blockTypeTags: ['Table', 'Columns', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Where You Are', description: 'Current state with domain benchmarks' },
      { title: 'The Numbers', description: 'Domain-specific metric projections' },
      { title: 'Value Drivers', description: 'What drives these projections' },
      { title: 'Implementation Overview', description: 'High-level phases and milestones' },
      { title: 'Assumptions', description: 'Honest methodology that builds trust' },
    ],
  },
  {
    id: 'quick-win-playbook',
    name: 'Opportunity Playbook',
    description: 'Three high-impact opportunities with potential sizing — drives meeting bookings',
    icon: '⚡',
    blockTypeTags: ['Callouts', 'Toggles', 'Table'],
    sections: [
      { title: 'Opportunities 1-3', description: 'Each with analysis + "Why This Works"' },
      { title: 'Compounding Effect', description: 'Individual → combined impact table' },
      { title: 'Highest Leverage', description: 'The move that matters most' },
    ],
  },
  {
    id: 'linkedin-intelligence',
    name: 'LinkedIn Intelligence Report',
    description: 'Analyzes their LinkedIn presence through your domain lens — gaps and opportunities',
    icon: '🔍',
    blockTypeTags: ['Table', 'Quote', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Content at a Glance', description: 'Posts table with domain-expert analysis' },
      { title: 'Themes & Patterns', description: 'Domain-lens pattern recognition' },
      { title: 'Best Hook', description: 'Their top hook + why it works' },
      { title: 'Content-to-Results Gap', description: 'Where content meets business opportunity' },
    ],
  },
  {
    id: 'outbound-audit',
    name: 'Readiness Audit',
    description: 'Domain-expert diagnostic of their current state with gap and opportunity analysis',
    icon: '🎯',
    blockTypeTags: ['Table', 'Columns', 'Callouts', 'Toggles'],
    sections: [
      { title: 'Current Signals', description: 'Domain-expert signal assessment' },
      { title: 'The Diagnostic', description: 'Strengths, gaps, and critical issues' },
      { title: 'Maturity Scorecard', description: 'Strengths / Gaps / Opportunities' },
      { title: 'Closing the Gaps', description: 'What results look like' },
    ],
  },
  {
    id: 'content-strategy',
    name: 'Content Strategy Blueprint',
    description: 'Maps their content landscape to a domain-specific strategy with pillars, distribution plan, and content-to-revenue bridge',
    icon: '📝',
    blockTypeTags: ['Table', 'Columns', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Content Landscape', description: 'Current state and market context' },
      { title: 'Content Pillars', description: 'Domain themes mapped to business goals' },
      { title: 'Distribution Strategy', description: 'Channel plan with prioritization' },
      { title: 'Content-to-Revenue Bridge', description: 'How content converts to pipeline' },
      { title: '90-Day Roadmap', description: 'Phased quick-start plan' },
    ],
  },
  {
    id: 'complete-playbook',
    name: 'Complete Playbook',
    description: 'A complete strategic playbook to achieve their primary need through your product domain expertise',
    icon: '📘',
    blockTypeTags: ['Table', 'Columns', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Hero Header', description: 'How to Get X in Y Without Z' },
      { title: 'The Destination', description: 'Where they need to be and why now' },
      { title: 'What We Can See', description: 'Observable signals from their site and social' },
      { title: 'The Playbook Framework', description: 'Strategic framework overview' },
      { title: 'Play 1-4', description: 'Phased strategic plays with key levers' },
      { title: 'Success Metrics', description: 'How to measure progress' },
      { title: 'What We Bring', description: 'Why we are the execution partner' },
      { title: 'Next Step', description: 'Meeting invitation to build the execution plan' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom Document',
    description: 'Write your own prompt — AI generates a rich document with all block types',
    icon: '✏️',
    blockTypeTags: ['AI-Determined'],
    sections: [
      { title: 'Your Structure', description: 'AI follows your prompt with rich formatting' },
    ],
  },
];

/**
 * Select the best blueprint based on available enrichment data.
 * Returns the blueprint ID.
 */
export function selectBestNotionBlueprint(enrichment: Record<string, unknown>): string {
  const posts = enrichment.recent_linkedin_posts as unknown[] | undefined;
  const outboundSignals = enrichment.outbound_signals as string[] | undefined;
  const salesTools = enrichment.sales_tools_detected as string[] | undefined;
  const hasOutbound = enrichment.has_outbound_motion;
  const employeeCount = enrichment.linkedin_employee_count as number | undefined;
  const revenueModel = enrichment.revenue_model as string | undefined;
  const priorities = enrichment.company_priorities as string[] | undefined;
  const growthSignals = enrichment.growth_signals as unknown[] | undefined;
  const icpScore = enrichment.icp_score as number | undefined;

  if (posts && posts.length >= 3) return 'linkedin-intelligence';
  if (hasOutbound && ((outboundSignals?.length || 0) >= 2 || (salesTools?.length || 0) >= 2)) return 'outbound-audit';
  if (employeeCount && revenueModel) return 'roi-projection';
  if (priorities?.length && (growthSignals?.length || 0) >= 2) return 'competitive-landscape';
  if (icpScore && icpScore >= 80 && enrichment.primary_need) return 'complete-playbook';
  if (icpScore && icpScore < 80 && icpScore >= 60) return 'quick-win-playbook';
  return 'strategic-growth';
}
