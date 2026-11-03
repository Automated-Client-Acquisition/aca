/**
 * SDR Title Classifier
 *
 * Pure regex-based job title tier classification for the AI SDR system.
 * No LLM calls - fast, deterministic, zero token cost.
 *
 * Tier 0 = Not a fit (VP Eng, CTO, CISO, COO, etc.) - skip queue
 * Tier 1 = Revenue/Marketing decision-makers - personalized outreach, priority 1
 * Tier 2 = Executive buyers (CEO, Founder, etc.) - standard automation, priority 5
 *
 * Unknown titles default to Tier 2 (standard automation, don't skip).
 */

export type SdrTier = 0 | 1 | 2;

export interface TierResult {
  tier: SdrTier;
  leadScore: number;
  tag: string;
  priority: number;
}

// Tier 0: Not a fit for a sales/marketing product. Skip entirely.
const TIER_0_PATTERNS = [
  /\b(CTO|Chief Technology Officer)\b/i,
  /\b(CISO|Chief Information Security Officer)\b/i,
  /\b(COO|Chief Operating Officer)\b/i,
  /\b(CFO|Chief Financial Officer)\b/i,
  /\bVP\s+(of\s+)?(Engineering|Technology|Product|Finance|Legal|HR|People|Operations)\b/i,
  /\bHead\s+of\s+(Engineering|Technology|Product|Finance|Legal|HR|People|Operations)\b/i,
  /\bDirector\s+(of\s+)?(Engineering|Technology|Product|Finance|Legal|HR)\b/i,
  /\bBrand Partner\b/i,
  /\bTax Partner\b/i,
  /\bAccountant\b/i,
  /\bLawyer\b/i,
  /\bAttorney\b/i,
  /\bCounsel\b/i,
  /\bCompliance\b/i,
  /\bRecruiter\b/i,
  /\bTalent\b/i,
  /\bDeveloper\b/i,
  /\bEngineer\b/i,
  /\bDesigner\b/i,
];

// Tier 1: Revenue and marketing decision-makers. Highest fit — personalized outreach.
const TIER_1_PATTERNS = [
  /\b(CRO|Chief Revenue Officer)\b/i,
  /\b(CMO|Chief Marketing Officer)\b/i,
  /\bVP\s+(of\s+)?Sales\b/i,
  /\bVP\s+(of\s+)?Marketing\b/i,
  /\bVP\s+(of\s+)?Revenue\b/i,
  /\bVP\s+(of\s+)?Growth\b/i,
  /\bHead\s+of\s+Sales\b/i,
  /\bHead\s+of\s+Marketing\b/i,
  /\bHead\s+of\s+Growth\b/i,
  /\bHead\s+of\s+Revenue\b/i,
  /\bHead\s+of\s+Demand(\s+Gen(eration)?)?\b/i,
  /\bSales\s+Director\b/i,
  /\bMarketing\s+Director\b/i,
  /\bDirector\s+(of\s+)?Sales\b/i,
  /\bDirector\s+(of\s+)?Marketing\b/i,
  /\bDirector\s+(of\s+)?Revenue\b/i,
  /\bDirector\s+(of\s+)?Growth\b/i,
  /\bDirector\s+(of\s+)?Demand(\s+Gen(eration)?)?\b/i,
  /\b(EVP|SVP)\s+(of\s+)?Sales\b/i,
  /\b(EVP|SVP)\s+(of\s+)?Marketing\b/i,
  /\b(EVP|SVP)\s+(of\s+)?Revenue\b/i,
  /\bChief\s+Growth\s+Officer\b/i,
  /\bGrowth\s+Lead\b/i,
  /\bRevenue\s+Lead\b/i,
];

// Tier 2: C-suite buyers and founders. High fit — standard automation.
const TIER_2_PATTERNS = [
  /\b(CEO|Chief Executive Officer)\b/i,
  /\bCo-?Founder\b/i,
  /\bFounder\b/i,
  /\bOwner\b/i,
  /\bPresident\b/i,
  /\b(MD|Managing Director)\b/i,
  /\bGeneral\s+Manager\b/i,
  /\bManaging\s+Partner\b/i,
  /\bPrincipal\b/i,
];

/**
 * Classify a job title into an SDR tier.
 * Order: Tier 0 wins if any exclusion matches, then Tier 1, then Tier 2, then default Tier 2.
 */
export function classifySdrTier(jobTitle: string | null): TierResult {
  if (!jobTitle || jobTitle.trim() === '') {
    return { tier: 2, leadScore: 45, tag: 'sdr_tier_2', priority: 5 };
  }

  if (TIER_0_PATTERNS.some(p => p.test(jobTitle))) {
    return { tier: 0, leadScore: 10, tag: 'sdr_tier_0', priority: 10 };
  }

  if (TIER_1_PATTERNS.some(p => p.test(jobTitle))) {
    return { tier: 1, leadScore: 85, tag: 'sdr_tier_1', priority: 1 };
  }

  if (TIER_2_PATTERNS.some(p => p.test(jobTitle))) {
    return { tier: 2, leadScore: 65, tag: 'sdr_tier_2', priority: 5 };
  }

  // Unknown title: treat as Tier 2 so they get standard automation
  return { tier: 2, leadScore: 45, tag: 'sdr_tier_2', priority: 5 };
}
