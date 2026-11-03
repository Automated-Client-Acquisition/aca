/**
 * Single source of truth for the Advanced Filters field set.
 *
 * The same panel (src/components/contacts/AdvancedFilters.tsx) is rendered on
 * /people and on lead-list detail, but the filtering runs through two engines:
 *   - /people + smart lists → applyContactFilters (src/hooks/crm/useContacts.ts)
 *   - static lead lists     → buildRpcFilters (src/hooks/useLeadListMembers.ts)
 *                             + the filter_lead_list_members SQL RPC
 *
 * Every key added here MUST be wired into BOTH engines. Each engine keeps an
 * exhaustive `satisfies Record<keyof EnrichmentFilters, ...>` checklist that
 * fails the build when a key is added here but not acknowledged there.
 */

export type EmailQuality = 'clean' | 'risky' | 'failed' | 'unverified';

/** Raw classification some providers (e.g. MoltSets) return with the email —
 *  not a verification/deliverability signal, just how the address is typed. */
export type EmailType = 'business' | 'personal';

export interface EnrichmentFilters {
  industries?: string[];
  /** @deprecated Exact legacy enrichment_data.company.size labels. */
  companySizes?: string[];
  minEmployeeCount?: number;
  maxEmployeeCount?: number;
  seniorities?: string[];
  departments?: string[];
  technologies?: string[];
  emailVerified?: boolean;
  /** Multi-select email-quality filter. Each value maps to a combination of
   *  email_verification_status + email_is_* booleans on crm_contacts. */
  emailQuality?: EmailQuality[];
  minEmailConfidence?: number;
  emailType?: EmailType;
  countries?: string[];
  cities?: string[];
  hasEnrichmentData?: boolean;
  // ICP Score filters (per-product)
  icpProductId?: string;
  minIcpScore?: number;
  maxIcpScore?: number;
  // Decision-Maker Score filters (per-product, requires icpProductId)
  minDmScore?: number;
  maxDmScore?: number;
  // Enrichment-based qualification filters
  isB2b?: boolean;
  revenueModels?: string[];
  hasOutboundMotion?: boolean;
  hiringSalesRoles?: boolean;
  // Website tech & ad-signal filters (from detected_technologies)
  runsAds?: boolean;
  detectedTechnologies?: string[];
  /** true = must have ALL selected (AND); false/undefined = has ANY (OR) */
  detectedTechMatchAll?: boolean;
  /** must NOT have any of these detected technologies */
  excludedTechnologies?: string[];
  // Custom-question score filters: each requires the question to be answered with
  // score >= minScore. Multiple conditions are AND-combined.
  customQuestions?: Array<{ question: string; minScore?: number }>;
  // Org custom field filters (crm_custom_field_defs / crm_contacts.custom_fields).
  // Multiple conditions are AND-combined.
  customFieldConditions?: Array<{
    fieldKey: string;
    operator: 'equals' | 'contains' | 'has_value' | 'is_empty';
    value?: string;
  }>;
  // Notion filter
  hasNotionUrl?: boolean;
  // Has email filter
  hasEmail?: boolean;
  // SEG firewall filter
  segFirewall?: 'behind' | 'clear' | 'unchecked';
  // AI analysis status filter.
  // 'no_data' is a virtual status: contacts scraped but with no usable analysis —
  // either analysis failed, or they have no analyzable source (no website + no LinkedIn).
  aiAnalysisStatus?: 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed' | 'no_data';
}
