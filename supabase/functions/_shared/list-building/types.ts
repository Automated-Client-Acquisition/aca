/**
 * ACA List Building Engine — shared I/O contracts.
 * Spec: ACA_List_Building_Engine_Spec v1.0 (April 2026).
 */

export type FitLabel = 'Strong' | 'Good' | 'Weak' | 'Disqualify';
export type LbJobStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type LbStage = 'discovery' | 'dm' | 'pattern' | 'smtp' | 'icp';
export type VerificationStatus =
  | 'verified' | 'not_found' | 'catch_all' | 'retry' | 'failed' | 'skipped';

export interface DiscoveredCompany {
  company_name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  employee_signal?: string | null;
  employee_count_estimate?: number | null;
  source: 'google_maps' | 'google_search' | 'directory' | 'linkedin' | 'whois';
  raw_html_snippet?: string | null;
}

export interface NameFlags {
  hyphen: boolean;
  accent: boolean;
  single_name: boolean;
  has_middle: boolean;
  nickname_variants: string[];  // e.g. ["bill","will"] for William
}

export interface ParsedName {
  first: string;            // normalized lowercase, ascii
  last: string | null;
  middle: string | null;
  first_raw: string;
  last_raw: string | null;
  flags: NameFlags;
}

export interface DMCandidate {
  first_name: string;
  last_name?: string | null;
  middle_name?: string | null;
  title?: string | null;
  seniority_score?: number | null;    // 1-10
  linkedin_url?: string | null;
  source_page?: string | null;
  reasoning?: string;
  confidence?: number;                // 0-100
}

export type PermutationTier = 1 | 2 | 3 | 4 | 5;

export interface Permutation {
  email: string;
  local_part: string;
  pattern: string;        // e.g. "firstname.lastname"
  tier: PermutationTier;
}

export interface PatternCacheRecord {
  domain: string;
  pattern: string | null;
  tier: PermutationTier | null;
  confidence: number;      // 0-100
  sample_size: number;
  catch_all: boolean;
  mx_valid: boolean;
  negative_result: boolean;
  last_verified_at: string | null;
  expires_at: string | null;
  // Discovery Layer extensions (§9.3, §9.6, §9.10)
  mx_provider?: string | null;          // 'google'|'microsoft'|'other'
  multi_pattern?: boolean;              // true when domain uses >1 pattern
  known_patterns?: string[];            // for multi_pattern domains
  bounce_count?: number;
  hard_bounce_window_30d?: number;
  last_discovery_at?: string | null;
  discovery_exhausted?: boolean;
}

export interface DomainAlias {
  primary_domain: string;
  alias_domain: string;
  relationship: 'subsidiary' | 'redirect' | 'rebranding' | 'regional' | 'acquisition' | 'manual';
  discovered_via: 'whois' | 'mx' | 'website_link' | 'press_release' | 'manual';
}

export interface VerificationResult {
  email: string;
  status: VerificationStatus;
  smtp_response_code: number | null;
  catch_all: boolean;
  proxy_id?: string | null;
  attempts: number;
  error?: string;
}

export interface IcpScoreBreakdown {
  industry: number;  // /25
  size: number;      // /20
  geo: number;       // /15
  seniority: number; // /20
  type: number;      // /20
}

export interface EnrichedLeadOutput {
  company: DiscoveredCompany;
  dm: DMCandidate;
  verified_email: string;
  email_status: 'verified' | 'catch_all';
  icp_score: number;
  fit_label: FitLabel;
  score_breakdown: IcpScoreBreakdown;
  reasoning: string;
}
