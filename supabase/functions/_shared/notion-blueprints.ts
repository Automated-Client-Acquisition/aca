/**
 * Notion Document Blueprint Definitions
 *
 * Each blueprint defines the structure, visual design, and data requirements
 * for a specific type of consulting-grade Notion deliverable.
 */

export interface BlueprintSectionInfo {
  title: string;
  description: string;
  blockTypes: string[];
}

export interface NotionBlueprint {
  id: string;
  name: string;
  description: string;
  icon: string;
  requiredFields: string[];
  optionalFields: string[];
  sections: BlueprintSectionInfo[];
  /** Block types used prominently (shown as badges in UI) */
  blockTypeTags: string[];
}

export const NOTION_BLUEPRINTS: NotionBlueprint[] = [
  {
    id: 'strategic-growth',
    name: 'Strategic Growth Analysis',
    description: 'Maps their business to growth opportunities through your product domain expertise',
    icon: '📈',
    requiredFields: ['company_niche', 'company_offering', 'company_target', 'primary_need'],
    optionalFields: ['company_priorities', 'growth_signals', 'linkedin_employee_count', 'linkedin_employee_growth_6mo', 'recent_linkedin_posts', 'company_tone', 'company_verbiage', 'selected_outcome'],
    blockTypeTags: ['Table', 'Toggles', 'Columns', 'Callouts'],
    sections: [
      { title: 'Hero Header', description: 'Company name + domain-specific insight', blockTypes: ['heading_1', 'callout'] },
      { title: 'Business Snapshot', description: 'Side-by-side stat cards and company overview', blockTypes: ['column_list', 'callout', 'paragraph'] },
      { title: 'Where the Growth Is', description: 'Domain-expert observations with benchmarks', blockTypes: ['heading_2', 'numbered_list_item', 'callout'] },
      { title: 'Opportunity Map', description: 'Table: Strategy → Opportunity → Impact', blockTypes: ['heading_2', 'table'] },
      { title: 'What This Could Look Like', description: 'Projected results and milestones', blockTypes: ['heading_2', 'toggle'] },
      { title: 'Biggest Lever', description: 'Highest-impact opportunity identified', blockTypes: ['callout'] },
      { title: 'Next Step', description: 'Meeting invitation to discuss execution', blockTypes: ['quote', 'paragraph'] },
    ],
  },
  {
    id: 'competitive-landscape',
    name: 'Competitive Landscape Brief',
    description: 'Analyzes their market position through your domain lens — gaps and opportunities',
    icon: '🏆',
    requiredFields: ['company_niche', 'company_offering'],
    optionalFields: ['outbound_signals', 'sales_tools_detected', 'linkedin_topics', 'best_post_hook', 'growth_signals', 'hiring_sales_roles', 'sales_roles_open', 'company_target', 'primary_need', 'company_priorities'],
    blockTypeTags: ['Table', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Title', description: 'Professional header with domain-specific market context', blockTypes: ['heading_1', 'paragraph'] },
      { title: 'Where You Stand', description: 'Domain-specific positioning assessment', blockTypes: ['callout', 'bulleted_list_item'] },
      { title: 'What Leaders Do', description: 'Domain benchmark comparison table', blockTypes: ['heading_2', 'table'] },
      { title: 'Gaps That Matter', description: 'Deep analysis with business impact', blockTypes: ['heading_2', 'toggle'] },
      { title: 'The Path Forward', description: 'Strategic recommendations', blockTypes: ['heading_2', 'numbered_list_item', 'callout'] },
      { title: 'Bottom Line', description: 'Synthesized opportunity', blockTypes: ['quote'] },
    ],
  },
  {
    id: 'roi-projection',
    name: 'ROI Projection & Impact Model',
    description: 'Numbers-focused analysis with domain-specific projections and value drivers',
    icon: '💰',
    requiredFields: ['primary_need', 'company_niche'],
    optionalFields: ['linkedin_employee_count', 'estimated_company_size', 'linkedin_employee_growth_6mo', 'latest_funding_round', 'funding_amount', 'company_priorities', 'revenue_model', 'selected_outcome', 'company_target'],
    blockTypeTags: ['Table', 'Columns', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Title + Context', description: 'Data-oriented header with domain framing', blockTypes: ['heading_1', 'callout'] },
      { title: 'Where You Are', description: 'Current state with domain benchmarks', blockTypes: ['heading_2', 'paragraph', 'bulleted_list_item'] },
      { title: 'The Numbers', description: 'Domain-specific metric projections', blockTypes: ['heading_2', 'table'] },
      { title: 'Value Drivers', description: 'What drives these projections', blockTypes: ['heading_2', 'toggle'] },
      { title: 'Implementation Overview', description: 'High-level phases and milestones', blockTypes: ['heading_2', 'column_list'] },
      { title: 'Assumptions', description: 'Honest methodology that builds trust', blockTypes: ['heading_3', 'callout'] },
      { title: 'Next Step', description: 'Invitation to refine with real numbers', blockTypes: ['quote', 'paragraph'] },
    ],
  },
  {
    id: 'quick-win-playbook',
    name: 'Opportunity Playbook',
    description: 'Three high-impact opportunities with potential sizing — drives meeting bookings',
    icon: '⚡',
    requiredFields: ['company_niche', 'company_offering'],
    optionalFields: ['company_priorities', 'primary_need', 'linkedin_topics', 'best_post_hook', 'company_tone', 'company_target', 'growth_signals'],
    blockTypeTags: ['Callouts', 'Toggles', 'Table'],
    sections: [
      { title: 'Title', description: 'Opportunity-focused header', blockTypes: ['heading_1', 'paragraph'] },
      { title: 'Opportunity 1', description: 'Analysis + benchmarks + "Why This Works"', blockTypes: ['heading_2', 'callout', 'bulleted_list_item', 'toggle'] },
      { title: 'Opportunity 2', description: 'Different angle, same depth', blockTypes: ['heading_2', 'callout', 'bulleted_list_item', 'toggle'] },
      { title: 'Opportunity 3', description: 'Most advanced insight', blockTypes: ['heading_2', 'callout', 'bulleted_list_item', 'toggle'] },
      { title: 'Compounding Effect', description: 'Individual → combined impact table', blockTypes: ['heading_2', 'table'] },
      { title: 'Highest Leverage', description: 'The move that matters most', blockTypes: ['callout'] },
    ],
  },
  {
    id: 'linkedin-intelligence',
    name: 'LinkedIn Intelligence Report',
    description: 'Analyzes their LinkedIn presence through your domain lens — gaps and opportunities',
    icon: '🔍',
    requiredFields: ['recent_linkedin_posts', 'linkedin_topics'],
    optionalFields: ['best_post_hook', 'company_tone', 'company_niche', 'primary_need', 'company_offering', 'company_target'],
    blockTypeTags: ['Table', 'Quote', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Title', description: 'LinkedIn-themed header with domain callout', blockTypes: ['heading_1', 'callout'] },
      { title: 'Content at a Glance', description: 'Posts table with domain-expert analysis', blockTypes: ['heading_2', 'table'] },
      { title: 'Themes & Patterns', description: 'Domain-lens pattern recognition', blockTypes: ['heading_2', 'bulleted_list_item'] },
      { title: 'Best Hook', description: 'Their top hook + why it works', blockTypes: ['quote', 'paragraph'] },
      { title: 'Content-to-Results Gap', description: 'Where content meets business opportunity', blockTypes: ['heading_2', 'toggle'] },
      { title: 'The Opportunity', description: 'Bridge from content to domain-specific results', blockTypes: ['callout'] },
    ],
  },
  {
    id: 'outbound-audit',
    name: 'Readiness Audit',
    description: 'Domain-expert diagnostic of their current state with gap and opportunity analysis',
    icon: '🎯',
    requiredFields: ['has_outbound_motion'],
    optionalFields: ['outbound_signals', 'sales_tools_detected', 'hiring_sales_roles', 'sales_roles_open', 'estimated_company_size', 'linkedin_employee_growth_6mo', 'primary_need', 'company_niche', 'company_offering'],
    blockTypeTags: ['Table', 'Columns', 'Callouts', 'Toggles'],
    sections: [
      { title: 'Title', description: 'Domain-specific audit header', blockTypes: ['heading_1', 'paragraph'] },
      { title: 'Current Signals', description: 'Domain-expert signal assessment table', blockTypes: ['heading_2', 'table'] },
      { title: 'The Diagnostic', description: 'Strengths, gaps, and critical issues', blockTypes: ['heading_2', 'callout'] },
      { title: 'Maturity Scorecard', description: 'Strengths / Gaps / Opportunities', blockTypes: ['heading_2', 'column_list', 'bulleted_list_item'] },
      { title: 'Closing the Gaps', description: 'What results look like when gaps are addressed', blockTypes: ['heading_2', 'toggle'] },
      { title: 'The Verdict', description: 'Confident assessment and next step', blockTypes: ['quote'] },
    ],
  },
  {
    id: 'content-strategy',
    name: 'Content Strategy Blueprint',
    description: 'Maps their content landscape to a domain-specific strategy with pillars, distribution plan, and content-to-revenue bridge',
    icon: '📝',
    requiredFields: ['company_niche', 'company_offering', 'company_target'],
    optionalFields: ['recent_linkedin_posts', 'linkedin_topics', 'best_post_hook', 'company_tone', 'company_verbiage', 'primary_need', 'company_priorities', 'growth_signals'],
    blockTypeTags: ['Table', 'Columns', 'Toggles', 'Callouts'],
    sections: [
      { title: 'Hero Header', description: 'Company name + content opportunity framing', blockTypes: ['heading_1', 'callout'] },
      { title: 'Content Landscape', description: 'Current state assessment and market context', blockTypes: ['heading_2', 'paragraph', 'callout'] },
      { title: 'Content Pillars', description: 'Domain-specific themes mapped to business goals', blockTypes: ['heading_2', 'table', 'toggle'] },
      { title: 'Distribution Strategy', description: 'Channel-by-channel plan with prioritization', blockTypes: ['heading_2', 'column_list', 'callout'] },
      { title: 'Content-to-Revenue Bridge', description: 'How content converts to pipeline and revenue', blockTypes: ['heading_2', 'table', 'toggle'] },
      { title: 'Quick-Start Roadmap', description: '90-day phased execution plan', blockTypes: ['heading_2', 'numbered_list_item', 'callout'] },
      { title: 'Next Step', description: 'Strategy session invitation', blockTypes: ['quote', 'paragraph'] },
    ],
  },
  {
    id: 'custom',
    name: 'Custom Document',
    description: 'Write your own prompt — AI generates a rich document using all available block types',
    icon: '✏️',
    requiredFields: [],
    optionalFields: [],
    blockTypeTags: ['AI-Determined'],
    sections: [
      { title: 'AI-Determined', description: 'Structure guided by your prompt, using rich Notion formatting', blockTypes: ['heading_1', 'callout', 'table', 'toggle', 'quote'] },
    ],
  },
];

/**
 * Select the best blueprint based on available enrichment data.
 */
export function selectBestBlueprint(enrichment: Record<string, unknown>): string {
  const posts = enrichment.recent_linkedin_posts as unknown[] | undefined;
  const outboundSignals = enrichment.outbound_signals as string[] | undefined;
  const salesTools = enrichment.sales_tools_detected as string[] | undefined;
  const hasOutbound = enrichment.has_outbound_motion;
  const employeeCount = enrichment.linkedin_employee_count as number | undefined;
  const revenueModel = enrichment.revenue_model as string | undefined;
  const priorities = enrichment.company_priorities as string[] | undefined;
  const growthSignals = enrichment.growth_signals as unknown[] | undefined;
  const icpScore = enrichment.icp_score as number | undefined;

  // LinkedIn Intelligence Report — if we have 3+ posts
  if (posts && posts.length >= 3) return 'linkedin-intelligence';

  // Outbound Readiness Audit — if strong outbound signals
  if (hasOutbound && ((outboundSignals?.length || 0) >= 2 || (salesTools?.length || 0) >= 2)) {
    return 'outbound-audit';
  }

  // ROI Projection — if we have company metrics
  if (employeeCount && revenueModel) return 'roi-projection';

  // Competitive Landscape — if we have positioning data
  if (priorities?.length && (growthSignals?.length || 0) >= 2) return 'competitive-landscape';

  // Quick-Win Playbook — moderate ICP score
  if (icpScore && icpScore < 80 && icpScore >= 60) return 'quick-win-playbook';

  // Default
  return 'strategic-growth';
}

export function getBlueprintById(id: string): NotionBlueprint | undefined {
  return NOTION_BLUEPRINTS.find((bp) => bp.id === id);
}
