// Message variable definitions for campaign messages
// Variables can be inserted into messages and will be replaced with actual contact data

export type VariableCategory = 'contact' | 'ai_analysis' | 'signal' | 'sender' | 'deliverable' | 'generated_email' | 'custom';

export interface MessageVariable {
  key: string;
  label: string;
  field: string;
  sender?: boolean;
  description?: string;
  category?: VariableCategory;
  aiField?: string; // Path in enrichment_data (e.g., 'primary_need', 'company_priorities.0')
  signalField?: string; // Key in crm_contacts.discovery_metadata (e.g., 'signal_outreach_context')
  requiresEnrichment?: boolean;
  requiresSignal?: boolean;
}

// AI Enrichment data structure from analyze-company function
export interface EnrichmentData {
  company_tagline?: string;
  company_niche?: string;
  company_offering?: string;
  company_target?: string;
  company_verbiage?: string[];
  company_priorities?: string[];
  primary_need?: string;
  primary_need_reasoning?: string;
  primary_need_evidence?: string;
  primary_need_confidence?: 'low' | 'medium' | 'high';
  cold_email_angle?: string;
  selected_outcome?: string;
  growth_signals?: {
    signal: string;
    evidence: string;
    interpretation: string;
    confidence: 'low' | 'medium' | 'high';
    email_usability: 'strong' | 'medium' | 'dont_use';
    safe_use: string;
  }[];
  latest_funding_round?: string;
  funding_amount?: string;
  company_tone?: 'formal' | 'casual' | 'technical' | 'friendly';
  recent_linkedin_posts?: Array<{
    text: string;
    date: string;
    engagement: number;
  }>;
  linkedin_topics?: string[];
  best_post_hook?: string;
  analyzed_at?: string;
  // ICP qualification fields (analyze-company's icp_score section)
  estimated_company_size?: 'Small (1-50)' | 'Mid-Market (51-500)' | 'Enterprise (500+)' | 'Unknown';
  revenue_model?: 'SaaS' | 'Services' | 'Product' | 'Marketplace' | 'Hybrid' | 'Unknown';
}

export const MESSAGE_VARIABLES: MessageVariable[] = [
  { key: '{{first_name}}', label: 'First name', field: 'first_name', description: "Contact's first name", category: 'contact' },
  { key: '{{last_name}}', label: 'Last name', field: 'last_name', description: "Contact's last name", category: 'contact' },
  { key: '{{full_name}}', label: 'Full name', field: 'full_name', description: "Contact's full name", category: 'contact' },
  { key: '{{position}}', label: 'Position', field: 'job_title', description: "Contact's job title", category: 'contact' },
  { key: '{{company}}', label: 'Company', field: 'company', description: "Contact's company name", category: 'contact' },
  { key: '{{location}}', label: 'Location', field: 'location', description: "Contact's location", category: 'contact' },
  { key: '{{industry}}', label: 'Industry', field: 'industry', description: "Contact's industry", category: 'contact' },
  { key: '{{linkedin_bio}}', label: 'LinkedIn Bio', field: 'linkedin_bio', description: "Contact's LinkedIn bio", category: 'contact' },
  { key: '{{home_page_text}}', label: 'Home Page Text', field: 'home_page_text', description: "Contact's company home page text", category: 'contact' },
  { key: '{{sender_name}}', label: 'Sender name', field: 'account_name', sender: true, description: "Your sender account name", category: 'sender' },
  { key: '{{sender_first_name}}', label: 'Sender first name', field: 'first_name', sender: true, description: "Your sender first name", category: 'sender' },
  { key: '{{sender_last_name}}', label: 'Sender last name', field: 'last_name', sender: true, description: "Your sender last name", category: 'sender' },
];

// AI Analysis variables from enrichment_data
export const AI_MESSAGE_VARIABLES: MessageVariable[] = [
  // Core AI Analysis
  {
    key: '{{ai_primary_need}}',
    label: 'Primary Need',
    field: 'ai_primary_need',
    aiField: 'primary_need',
    category: 'ai_analysis',
    description: 'What they need most (AI-analyzed)',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_primary_need_reason}}',
    label: 'Need Reasoning',
    field: 'ai_primary_need_reason',
    aiField: 'primary_need_reasoning',
    category: 'ai_analysis',
    description: 'Why this need fits them',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_primary_need_evidence}}',
    label: 'Need Evidence',
    field: 'ai_primary_need_evidence',
    aiField: 'primary_need_evidence',
    category: 'ai_analysis',
    description: 'The observed fact the need hypothesis is grounded in',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_primary_need_confidence}}',
    label: 'Need Confidence',
    field: 'ai_primary_need_confidence',
    aiField: 'primary_need_confidence',
    category: 'ai_analysis',
    description: 'How directly the evidence supports the need (low/medium/high)',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_cold_email_angle}}',
    label: 'Cold-Email Angle',
    field: 'ai_cold_email_angle',
    aiField: 'cold_email_angle',
    category: 'ai_analysis',
    description: 'AI writer guidance on what\'s safe to ask/reference (and what not to imply) - an instruction, not send-ready copy. Dropping it directly into a hand-written template will insert that instruction text literally.',
    requiresEnrichment: true,
  },
  // Company Info
  {
    key: '{{ai_company_niche}}',
    label: 'Company Niche',
    field: 'ai_company_niche',
    aiField: 'company_niche',
    category: 'ai_analysis',
    description: 'Specific niche (e.g., AI-powered HR software)',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_company_offering}}',
    label: 'Company Offering',
    field: 'ai_company_offering',
    aiField: 'company_offering',
    category: 'ai_analysis',
    description: 'What they sell',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_company_target}}',
    label: 'Company Target',
    field: 'ai_company_target',
    aiField: 'company_target',
    category: 'ai_analysis',
    description: 'Who their customers are',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_company_tagline}}',
    label: 'Company Tagline',
    field: 'ai_company_tagline',
    aiField: 'company_tagline',
    category: 'ai_analysis',
    description: 'Their value proposition',
    requiresEnrichment: true,
  },
  // LinkedIn Insights
  {
    key: '{{ai_best_hook}}',
    label: 'Best Hook',
    field: 'ai_best_hook',
    aiField: 'best_post_hook',
    category: 'ai_analysis',
    description: 'Icebreaker from their LinkedIn',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_linkedin_topic_1}}',
    label: 'LinkedIn Topic',
    field: 'ai_linkedin_topic_1',
    aiField: 'linkedin_topics.0',
    category: 'ai_analysis',
    description: 'Topic they post about',
    requiresEnrichment: true,
  },
  // Growth Signals
  {
    key: '{{ai_priority_1}}',
    label: 'Priority',
    field: 'ai_priority_1',
    aiField: 'company_priorities.0',
    category: 'ai_analysis',
    description: 'Their top priority',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_growth_signal_1}}',
    label: 'Growth Signal',
    field: 'ai_growth_signal_1',
    aiField: 'growth_signals.0.signal',
    category: 'ai_analysis',
    description: 'Top growth signal',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_latest_funding}}',
    label: 'Latest Funding',
    field: 'ai_latest_funding',
    aiField: 'latest_funding_round',
    category: 'ai_analysis',
    description: 'Series X info',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_funding_amount}}',
    label: 'Funding Amount',
    field: 'ai_funding_amount',
    aiField: 'funding_amount',
    category: 'ai_analysis',
    description: 'Dollar amount raised',
    requiresEnrichment: true,
  },
  // ICP Qualification
  {
    key: '{{ai_company_size}}',
    label: 'Company Size',
    field: 'ai_company_size',
    aiField: 'estimated_company_size',
    category: 'ai_analysis',
    description: 'Estimated headcount band (Small/Mid-Market/Enterprise)',
    requiresEnrichment: true,
  },
  {
    key: '{{ai_revenue_model}}',
    label: 'Revenue Model',
    field: 'ai_revenue_model',
    aiField: 'revenue_model',
    category: 'ai_analysis',
    description: 'How they make money (SaaS/Services/Product/Marketplace/Hybrid)',
    requiresEnrichment: true,
  },
];

// Buying-signal variables, from crm_contacts.discovery_metadata (written by the
// signal packs and by external signal agents like Hermes via create_contact).
//
// NOTE the two key conventions inside discovery_metadata — they are NOT uniform,
// and the send-time resolvers read the exact keys below. The event itself uses
// bare `signal_*` keys; the company/person block uses `ai_signal_*` keys. Writing
// `company_website` instead of `ai_signal_company_website` resolves to empty.
export const SIGNAL_MESSAGE_VARIABLES: MessageVariable[] = [
  {
    key: '{{ai_signal_type}}',
    label: 'Signal Type',
    field: 'ai_signal_type',
    signalField: 'signal_type',
    category: 'signal',
    description: 'e.g. funding, hiring, tech_stack_change',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_date}}',
    label: 'Signal Date',
    field: 'ai_signal_date',
    signalField: 'signal_date',
    category: 'signal',
    description: 'When the signal fired (YYYY-MM-DD)',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_detail}}',
    label: 'Signal Detail',
    field: 'ai_signal_detail',
    signalField: 'signal_detail',
    category: 'signal',
    description: 'The fact itself, e.g. "Etched raises $300M Series C"',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_context}}',
    label: 'Signal Context',
    field: 'ai_signal_context',
    signalField: 'signal_outreach_context',
    category: 'signal',
    description: 'Why this signal matters for outreach — the best one to open with',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_source_url}}',
    label: 'Signal Source URL',
    field: 'ai_signal_source_url',
    signalField: 'signal_source_url',
    category: 'signal',
    description: 'Evidence link for the signal',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_amount}}',
    label: 'Signal Amount',
    field: 'ai_signal_amount',
    signalField: 'ai_signal_amount',
    category: 'signal',
    description: 'Amount raised, on funding signals',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_investors}}',
    label: 'Investors',
    field: 'ai_signal_investors',
    signalField: 'ai_signal_investors',
    category: 'signal',
    description: 'Investors named in the round',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_person}}',
    label: 'Signal Person',
    field: 'ai_signal_person',
    signalField: 'ai_signal_person',
    category: 'signal',
    description: 'Person named in the signal',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_new_role}}',
    label: 'New Role',
    field: 'ai_signal_new_role',
    signalField: 'ai_signal_new_role',
    category: 'signal',
    description: 'New role, on job-change signals',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_company_website}}',
    label: 'Signal Company Website',
    field: 'ai_signal_company_website',
    signalField: 'ai_signal_company_website',
    category: 'signal',
    description: "The signal company's website",
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_company_linkedin}}',
    label: 'Signal Company LinkedIn',
    field: 'ai_signal_company_linkedin',
    signalField: 'ai_signal_company_linkedin',
    category: 'signal',
    description: "The signal company's LinkedIn URL",
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_company_industry}}',
    label: 'Signal Company Industry',
    field: 'ai_signal_company_industry',
    signalField: 'ai_signal_company_industry',
    category: 'signal',
    description: "The signal company's industry",
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_company_size}}',
    label: 'Signal Company Size',
    field: 'ai_signal_company_size',
    signalField: 'ai_signal_company_size',
    category: 'signal',
    description: 'Headcount band, e.g. "11-50"',
    requiresSignal: true,
  },
  {
    key: '{{ai_signal_revenue}}',
    label: 'Signal Company Revenue',
    field: 'ai_signal_revenue',
    signalField: 'ai_signal_revenue',
    category: 'signal',
    description: 'Revenue band, e.g. "Above $50M"',
    requiresSignal: true,
  },
];

// Deliverable variables (e.g., generated Notion pages)
export const DELIVERABLE_MESSAGE_VARIABLES: MessageVariable[] = [
  {
    key: '{{notion_preview_url}}',
    label: 'Notion Preview URL',
    field: 'notion_preview_url',
    category: 'deliverable',
    description: 'Link to personalized Notion document',
  },
];

// Generated email content variables (from generateEmails node)
export const GENERATED_EMAIL_VARIABLES: MessageVariable[] = [
  { key: '{{email_subject_1}}', label: 'Email 1 Subject', field: 'email_subject_1', category: 'generated_email', description: 'AI-generated subject for email 1' },
  { key: '{{email_body_1}}', label: 'Email 1 Body', field: 'email_body_1', category: 'generated_email', description: 'AI-generated body for email 1' },
  { key: '{{email_subject_2}}', label: 'Email 2 Subject', field: 'email_subject_2', category: 'generated_email', description: 'AI-generated subject for email 2' },
  { key: '{{email_body_2}}', label: 'Email 2 Body', field: 'email_body_2', category: 'generated_email', description: 'AI-generated body for email 2' },
  { key: '{{email_subject_3}}', label: 'Email 3 Subject', field: 'email_subject_3', category: 'generated_email', description: 'AI-generated subject for email 3' },
  { key: '{{email_body_3}}', label: 'Email 3 Body', field: 'email_body_3', category: 'generated_email', description: 'AI-generated body for email 3' },
  { key: '{{email_subject_4}}', label: 'Email 4 Subject', field: 'email_subject_4', category: 'generated_email', description: 'AI-generated subject for email 4' },
  { key: '{{email_body_4}}', label: 'Email 4 Body', field: 'email_body_4', category: 'generated_email', description: 'AI-generated body for email 4' },
  { key: '{{email_subject_5}}', label: 'Email 5 Subject', field: 'email_subject_5', category: 'generated_email', description: 'AI-generated subject for email 5' },
  { key: '{{email_body_5}}', label: 'Email 5 Body', field: 'email_body_5', category: 'generated_email', description: 'AI-generated body for email 5' },
];

// Combined list of all variables
export const ALL_MESSAGE_VARIABLES: MessageVariable[] = [...MESSAGE_VARIABLES, ...AI_MESSAGE_VARIABLES, ...SIGNAL_MESSAGE_VARIABLES, ...DELIVERABLE_MESSAGE_VARIABLES, ...GENERATED_EMAIL_VARIABLES];

export interface Contact {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  company?: string | null;
  location?: string | null;
  industry?: string | null;
  linkedin_bio?: string | null;
  home_page_text?: string | null;
  enrichment_data?: EnrichmentData | null;
  discovery_metadata?: Record<string, unknown> | null;
  custom_fields?: Record<string, unknown> | null;
  [key: string]: string | null | undefined | EnrichmentData | Record<string, unknown>;
}

export interface SenderAccount {
  account_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  [key: string]: string | null | undefined;
}

// Helper to access nested properties like 'company_priorities.0'
function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let value: unknown = obj;

  for (const part of parts) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      const index = parseInt(part, 10);
      value = value[index];
    } else if (typeof value === 'object') {
      value = (value as Record<string, unknown>)[part];
    } else {
      return '';
    }
  }

  return typeof value === 'string' ? value : '';
}

/**
 * Parse a message template and replace variables with actual values, then
 * resolve spintax.
 *
 * Spintax resolves here rather than in callers so that interpolating without
 * spinning is not expressible — the same reason substituteVariables() in the
 * Fly worker and replaceTemplateVariables() in workflow-utils.ts fold it in.
 * A caller that skipped it shipped raw {a|b|c} to production once already.
 */
export function parseMessage(
  template: string,
  contact: Contact,
  sender?: SenderAccount,
  customFieldDefaults?: Record<string, string>
): string {
  let result = template;

  // Process standard contact/sender variables
  MESSAGE_VARIABLES.forEach((v) => {
    const value = v.sender ? sender?.[v.field] : contact?.[v.field];
    const stringValue = typeof value === 'string' ? value : '';
    result = result.replace(new RegExp(escapeRegExp(v.key), 'g'), stringValue);
  });

  // Process AI variables from enrichment_data
  AI_MESSAGE_VARIABLES.forEach((v) => {
    if (v.aiField && contact?.enrichment_data) {
      const value = getNestedValue(contact.enrichment_data as Record<string, unknown>, v.aiField);
      result = result.replace(new RegExp(escapeRegExp(v.key), 'g'), value);
    } else {
      // Remove unfilled AI variables
      result = result.replace(new RegExp(escapeRegExp(v.key), 'g'), '');
    }
  });

  // Process buying-signal variables from discovery_metadata. Mirrors the
  // send-time mapping in campaign-processor / the Fly sequence-sender: unfilled
  // signal variables resolve to '' rather than staying as a raw tag.
  SIGNAL_MESSAGE_VARIABLES.forEach((v) => {
    const raw = v.signalField ? contact?.discovery_metadata?.[v.signalField] : undefined;
    const stringValue = raw === null || raw === undefined ? '' : String(raw);
    result = result.replace(new RegExp(escapeRegExp(v.key), 'g'), stringValue);
  });

  // Process deliverable variables (direct fields on contact)
  DELIVERABLE_MESSAGE_VARIABLES.forEach((v) => {
    const value = contact?.[v.field];
    const stringValue = typeof value === 'string' ? value : '';
    result = result.replace(new RegExp(escapeRegExp(v.key), 'g'), stringValue);
  });

  // Process generated email variables (direct fields on contact, populated from generated_data)
  GENERATED_EMAIL_VARIABLES.forEach((v) => {
    const value = contact?.[v.field];
    const stringValue = typeof value === 'string' ? value : '';
    result = result.replace(new RegExp(escapeRegExp(v.key), 'g'), stringValue);
  });

  // Process org custom fields ({{custom_<field_key>}}): the contact's own
  // value wins when present (real callers like MessageGeneratorDialog pass a
  // real contact); otherwise fall back to the org-level placeholder default
  // (Settings > Custom Fields), mirroring the send-time fallback. A field
  // with neither stays as the raw {{custom_...}} tag — same "needs a value
  // or default" signal used everywhere else custom variables are previewed.
  const contactCustomFields = contact?.custom_fields;
  const customKeys = new Set([
    ...Object.keys(contactCustomFields || {}),
    ...Object.keys(customFieldDefaults || {}),
  ]);
  for (const key of customKeys) {
    const contactValue = contactCustomFields?.[key];
    const value = contactValue != null && contactValue !== ''
      ? String(contactValue)
      : customFieldDefaults?.[key];
    if (value !== undefined) {
      result = result.replace(new RegExp(escapeRegExp(`{{custom_${key}}}`), 'g'), value);
    }
  }

  // Resolve spintax {a|b|c} last, after all variables are interpolated, so a
  // variable's own value can itself contain spintax. Mirrors workflow-utils.ts.
  return resolveSpintax(result);
}

// Sample enrichment data for preview
export const SAMPLE_ENRICHMENT_DATA: EnrichmentData = {
  primary_need: 'may be looking to grow demo requests from HR directors at mid-market companies',
  primary_need_reasoning: 'They sell HR software and are expanding their sales team',
  primary_need_evidence: 'Careers page lists 3 open SDR roles and the site copy targets "HR leaders at growing companies"',
  primary_need_confidence: 'medium',
  cold_email_angle: 'Ask whether demo request volume has kept pace with the team\'s growth. Do not imply this is a current problem or that hiring is failing to keep up.',
  company_niche: 'AI-powered employee engagement platform',
  company_offering: 'Employee pulse surveys, recognition tools, and analytics',
  company_target: 'HR leaders at companies with 200-2000 employees',
  company_tagline: 'Boost retention with real-time employee insights',
  company_tone: 'friendly',
  company_verbiage: ['employee engagement', 'retention', 'culture analytics'],
  company_priorities: ['Expanding enterprise sales', 'Launching new analytics module'],
  growth_signals: [
    {
      signal: 'Raised Series B',
      evidence: 'Press release on their site dated last quarter',
      interpretation: 'Likely has budget for new tooling',
      confidence: 'high',
      email_usability: 'strong',
      safe_use: 'Reference the funding round if relevant. Do not claim it was raised specifically to fund hiring or this initiative.',
    },
    {
      signal: 'Hiring 15 sales reps',
      evidence: 'Careers page lists 15 open sales roles',
      interpretation: 'Expanding go-to-market team, may need supporting tools',
      confidence: 'medium',
      email_usability: 'strong',
      safe_use: 'Reference the hiring push if relevant. Do not claim they lack the tools to support it.',
    },
  ],
  latest_funding_round: 'Series B',
  funding_amount: '$25M',
  linkedin_topics: ['employee retention', 'workplace culture', 'HR tech'],
  best_post_hook: 'Your recent post about the hidden costs of turnover really resonated',
};

// Sample discovery_metadata for preview. Keys match the exact shape the
// send-time resolvers read (bare `signal_*` for the event, `ai_signal_*` for the
// company/person block).
export const SAMPLE_DISCOVERY_METADATA: Record<string, unknown> = {
  signal_type: 'funding',
  signal_date: '2026-07-23',
  signal_detail: 'CulturePulse raises $25M Series B',
  signal_outreach_context: 'CulturePulse just raised $25M and is hiring 15 sales reps — headcount is about to outrun their onboarding process',
  signal_source_url: 'https://techcrunch.com/culturepulse-series-b',
  ai_signal_amount: '$25M',
  ai_signal_investors: 'Accel, Bessemer',
  ai_signal_person: 'John Doe',
  ai_signal_new_role: 'VP of People',
  ai_signal_company_website: 'https://culturepulse.com',
  ai_signal_company_linkedin: 'https://linkedin.com/company/culturepulse',
  ai_signal_company_industry: 'Information Technology',
  ai_signal_company_size: '51-200',
  ai_signal_revenue: 'Above $10M',
};

/**
 * Preview a message with sample data
 */
export function previewMessage(template: string, customFieldDefaults?: Record<string, string>): string {
  const sampleContact: Contact = {
    first_name: 'John',
    last_name: 'Doe',
    full_name: 'John Doe',
    job_title: 'VP of People',
    company: 'CulturePulse',
    location: 'San Francisco, CA',
    industry: 'HR Technology',
    enrichment_data: SAMPLE_ENRICHMENT_DATA,
    discovery_metadata: SAMPLE_DISCOVERY_METADATA,
    // Sample generated email content
    email_subject_1: 'quick thought on employee retention at CulturePulse',
    email_body_1: 'Hi John, I noticed CulturePulse is expanding its analytics module. Companies in your space often struggle with linking engagement data to actual retention outcomes. Curious how you\'re approaching that?',
    email_subject_2: 're: quick thought on employee retention at CulturePulse',
    email_body_2: 'Hi John, wanted to share something relevant — we\'ve seen HR tech companies reduce churn by 23% when they combine pulse survey data with predictive models. Would it be worth a quick chat about how this could apply to your analytics roadmap?',
    email_subject_3: 're: quick thought on employee retention at CulturePulse',
    email_body_3: 'Hi John, one more angle — your competitor just launched a retention prediction feature. Given your Series B and hiring push, this might be the right time to get ahead. Open to exploring this further?',
    email_subject_4: '',
    email_body_4: '',
    email_subject_5: '',
    email_body_5: '',
  };

  const sampleSender: SenderAccount = {
    account_name: 'Jane Smith',
    first_name: 'Jane',
    last_name: 'Smith',
  };

  return parseMessage(template, sampleContact, sampleSender, customFieldDefaults);
}

/**
 * Resolve flat spintax: `{a|b|c}` -> one of the branches, chosen uniformly.
 *
 * Single-brace variables like `{firstName}` (no `|`) are left alone.
 *
 * Deliberately duplicated, not shared. Three runtimes need this (Vite here,
 * Deno in supabase/functions/_shared/workflow-utils.ts, Node in
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

/**
 * Check if a message contains spintax groups `{a|b|c}`.
 */
export function hasSpintax(message: string): boolean {
  return /\{[^{}]*\|[^{}]*\}/.test(message);
}

/**
 * Count characters in a message (after variable expansion with average lengths)
 */
export function estimateMessageLength(template: string): {
  min: number;
  max: number;
  template: number;
} {
  // Average lengths for variables
  const avgLengths: Record<string, number> = {
    '{{first_name}}': 6,
    '{{last_name}}': 7,
    '{{full_name}}': 14,
    '{{position}}': 15,
    '{{company}}': 12,
    '{{location}}': 18,
    '{{industry}}': 12,
    '{{sender_name}}': 12,
    '{{sender_first_name}}': 6,
    '{{sender_last_name}}': 7,
    // AI variables (typically longer content)
    '{{ai_primary_need}}': 50,
    '{{ai_primary_need_reason}}': 60,
    '{{ai_primary_need_evidence}}': 60,
    '{{ai_primary_need_confidence}}': 6,
    '{{ai_cold_email_angle}}': 55,
    '{{ai_company_niche}}': 30,
    '{{ai_company_offering}}': 40,
    '{{ai_company_target}}': 35,
    '{{ai_company_tagline}}': 40,
    '{{ai_best_hook}}': 60,
    '{{ai_linkedin_topic_1}}': 20,
    '{{ai_priority_1}}': 30,
    '{{ai_growth_signal_1}}': 25,
    '{{ai_latest_funding}}': 10,
    '{{ai_funding_amount}}': 8,
    // Buying-signal variables (context is a full sentence and runs long)
    '{{ai_signal_type}}': 10,
    '{{ai_signal_date}}': 10,
    '{{ai_signal_detail}}': 45,
    '{{ai_signal_context}}': 120,
    '{{ai_signal_source_url}}': 50,
    '{{ai_signal_amount}}': 8,
    '{{ai_signal_investors}}': 25,
    '{{ai_signal_person}}': 14,
    '{{ai_signal_new_role}}': 20,
    '{{ai_signal_company_website}}': 25,
    '{{ai_signal_company_linkedin}}': 45,
    '{{ai_signal_company_industry}}': 22,
    '{{ai_signal_company_size}}': 8,
    '{{ai_signal_revenue}}': 12,
    // Generated email variables (longer content)
    '{{email_subject_1}}': 40,
    '{{email_body_1}}': 300,
    '{{email_subject_2}}': 40,
    '{{email_body_2}}': 250,
    '{{email_subject_3}}': 40,
    '{{email_body_3}}': 200,
    '{{email_subject_4}}': 40,
    '{{email_body_4}}': 200,
    '{{email_subject_5}}': 40,
    '{{email_body_5}}': 200,
  };

  let minLength = template.length;
  let maxLength = template.length;

  ALL_MESSAGE_VARIABLES.forEach((v) => {
    const count = (template.match(new RegExp(escapeRegExp(v.key), 'g')) || []).length;
    if (count > 0) {
      // Remove variable length, add estimated length
      minLength = minLength - v.key.length * count + 3 * count; // min 3 chars
      maxLength = maxLength - v.key.length * count + (avgLengths[v.key] || 30) * 2 * count;
    }
  });

  // Spintax: replace each `{a|b|c}` group's length with shortest branch (min) /
  // longest branch (max), since only one branch survives at send.
  const spintaxRe = /\{([^{}]*\|[^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = spintaxRe.exec(template)) !== null) {
    const groupLength = match[0].length;
    const branches = match[1].split('|').map((b) => b.length);
    const shortest = Math.min(...branches);
    const longest = Math.max(...branches);
    minLength = minLength - groupLength + shortest;
    maxLength = maxLength - groupLength + longest;
  }

  return {
    min: Math.max(0, minLength),
    max: maxLength,
    template: template.length,
  };
}

/**
 * Check if a message contains any variables
 */
export function hasVariables(message: string): boolean {
  return ALL_MESSAGE_VARIABLES.some((v) => message.includes(v.key));
}

/**
 * Check if a message contains any AI variables
 */
export function hasAIVariables(message: string): boolean {
  return AI_MESSAGE_VARIABLES.some((v) => message.includes(v.key));
}

/**
 * Extract all variables used in a message
 */
export function extractVariables(message: string): MessageVariable[] {
  return ALL_MESSAGE_VARIABLES.filter((v) => message.includes(v.key));
}

/**
 * Extract AI variables used in a message
 */
export function extractAIVariables(message: string): MessageVariable[] {
  return AI_MESSAGE_VARIABLES.filter((v) => message.includes(v.key));
}

/**
 * Validate that all required fields are available for a contact
 */
export function validateContactForMessage(
  message: string,
  contact: Contact
): { valid: boolean; missingFields: string[]; missingAIFields: string[]; missingSignalFields: string[] } {
  const variables = extractVariables(message);
  const missingFields: string[] = [];
  const missingAIFields: string[] = [];
  const missingSignalFields: string[] = [];

  variables.forEach((v) => {
    if (v.sender) return;

    if (v.requiresSignal && v.signalField) {
      // Signal variables live in discovery_metadata, not on the contact row
      const value = contact.discovery_metadata?.[v.signalField];
      if (value === null || value === undefined || value === '') {
        missingSignalFields.push(v.label);
      }
    } else if (v.requiresEnrichment && v.aiField) {
      // Check enrichment_data for AI variables
      if (!contact.enrichment_data) {
        missingAIFields.push(v.label);
      } else {
        const value = getNestedValue(contact.enrichment_data as Record<string, unknown>, v.aiField);
        if (!value) {
          missingAIFields.push(v.label);
        }
      }
    } else {
      // Check regular contact fields
      const value = contact[v.field];
      if (!value || typeof value !== 'string') {
        missingFields.push(v.label);
      }
    }
  });

  return {
    valid: missingFields.length === 0 && missingAIFields.length === 0 && missingSignalFields.length === 0,
    missingFields,
    missingAIFields,
    missingSignalFields,
  };
}

// Helper to escape special regex characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// LinkedIn character limits
export const CHARACTER_LIMITS = {
  connectionRequest: 300,
  message: 8000,
  inmail: 1900,
  inmailSubject: 200,
} as const;

/**
 * Check if message exceeds character limit
 */
export function isWithinLimit(
  message: string,
  type: keyof typeof CHARACTER_LIMITS
): boolean {
  const estimate = estimateMessageLength(message);
  return estimate.max <= CHARACTER_LIMITS[type];
}
