/**
 * Decision-Maker Fit Scoring Utility
 *
 * Pure TypeScript, no API calls. Computes a rule-based score (0-100)
 * based on the contact's job title, seniority, and department
 * against an ICP's decision-maker targeting criteria.
 */

export interface DecisionMakerInput {
  jobTitle: string | null;
  seniority: string | null;
  department: string | null;
}

export interface DecisionMakerCriteria {
  targetSeniorities: string[];
  targetDepartments: string[];
  targetTitleKeywords: string[];
}

export interface DecisionMakerResult {
  score: number;
  reasoning: string;
  matchedSignals: string[];
}

// Seniority hierarchy (highest authority to lowest)
const SENIORITY_HIERARCHY: string[] = [
  'owner',
  'founder',
  'c_suite',
  'partner',
  'vp',
  'head',
  'director',
  'manager',
  'senior',
  'entry',
  'training',
];

// Department adjacency — related departments that partially match
const DEPARTMENT_ADJACENCY: Record<string, string[]> = {
  sales: ['business_development', 'customer_success', 'revenue', 'partnerships'],
  marketing: ['growth', 'communications', 'brand', 'content'],
  engineering: ['product', 'technology', 'it', 'data'],
  operations: ['finance', 'administration', 'supply_chain'],
  finance: ['operations', 'accounting'],
  hr: ['people', 'talent', 'recruiting'],
  customer_success: ['sales', 'support', 'account_management'],
  product: ['engineering', 'design', 'ux'],
  executive: ['c_suite', 'leadership', 'management'],
  legal: ['compliance', 'risk'],
};

// Common title patterns that map to seniority levels
const TITLE_SENIORITY_MAP: Array<{ pattern: RegExp; seniority: string }> = [
  { pattern: /\b(ceo|cto|cfo|cmo|coo|cro|ciso|cpo|chief)\b/i, seniority: 'c_suite' },
  { pattern: /\bfounder\b/i, seniority: 'founder' },
  { pattern: /\bco-?founder\b/i, seniority: 'founder' },
  { pattern: /\bowner\b/i, seniority: 'owner' },
  { pattern: /\bpartner\b/i, seniority: 'partner' },
  { pattern: /\b(vp|vice\s*president)\b/i, seniority: 'vp' },
  { pattern: /\bhead\s+of\b/i, seniority: 'head' },
  { pattern: /\bdirector\b/i, seniority: 'director' },
  { pattern: /\bmanager\b/i, seniority: 'manager' },
  { pattern: /\bsenior\b/i, seniority: 'senior' },
  { pattern: /\b(intern|trainee|apprentice|junior|associate)\b/i, seniority: 'entry' },
];

/**
 * Normalize a seniority string to the standard hierarchy key.
 * Handles both Apollo-style values and free-text.
 */
function normalizeSeniority(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/[-\s]+/g, '_');
  // Direct match
  if (SENIORITY_HIERARCHY.includes(lower)) return lower;
  // Aliases
  if (lower === 'c-suite' || lower === 'c_level' || lower === 'csuite') return 'c_suite';
  if (lower === 'vice_president') return 'vp';
  if (lower === 'individual_contributor') return 'senior';
  if (lower === 'intern') return 'entry';
  return lower;
}

/**
 * Infer seniority from a job title when explicit seniority data is missing.
 */
function inferSeniorityFromTitle(title: string): string | null {
  for (const { pattern, seniority } of TITLE_SENIORITY_MAP) {
    if (pattern.test(title)) return seniority;
  }
  return null;
}

/**
 * Get the index of a seniority in the hierarchy.
 * Returns -1 if not found.
 */
function seniorityIndex(seniority: string): number {
  return SENIORITY_HIERARCHY.indexOf(normalizeSeniority(seniority));
}

/**
 * Compute the Decision-Maker Fit score.
 *
 * Returns null if no criteria are defined on the ICP.
 * Returns { score: 50, reasoning: "Insufficient data" } if contact has no enrichment data.
 */
export function computeDecisionMakerScore(
  input: DecisionMakerInput,
  criteria: DecisionMakerCriteria,
): DecisionMakerResult | null {
  const { targetSeniorities, targetDepartments, targetTitleKeywords } = criteria;

  // No criteria defined → cannot score
  if (
    targetSeniorities.length === 0 &&
    targetDepartments.length === 0 &&
    targetTitleKeywords.length === 0
  ) {
    return null;
  }

  const { jobTitle, seniority, department } = input;
  const matchedSignals: string[] = [];
  const reasons: string[] = [];

  // No data at all → insufficient
  if (!jobTitle && !seniority && !department) {
    return {
      score: 50,
      reasoning: 'Insufficient data to evaluate decision-maker fit',
      matchedSignals: [],
    };
  }

  let points = 0;

  // Resolve effective seniority (from enrichment or inferred from title)
  const effectiveSeniority = seniority
    ? normalizeSeniority(seniority)
    : jobTitle
      ? inferSeniorityFromTitle(jobTitle)
      : null;

  // ── Seniority scoring ──
  if (targetSeniorities.length > 0 && effectiveSeniority) {
    const contactIdx = seniorityIndex(effectiveSeniority);
    const normalizedTargets = targetSeniorities.map(normalizeSeniority);

    // Check exact match
    if (normalizedTargets.includes(effectiveSeniority)) {
      points += 40;
      matchedSignals.push(`Seniority match: ${effectiveSeniority}`);
      reasons.push(`Seniority "${effectiveSeniority}" matches target`);
    } else if (contactIdx >= 0) {
      // Check adjacency (within 1 level)
      const isAdjacent = normalizedTargets.some(target => {
        const targetIdx = seniorityIndex(target);
        return targetIdx >= 0 && Math.abs(contactIdx - targetIdx) === 1;
      });

      if (isAdjacent) {
        points += 25;
        matchedSignals.push(`Seniority adjacent: ${effectiveSeniority}`);
        reasons.push(`Seniority "${effectiveSeniority}" is close to target level`);
      } else {
        // Has seniority data but doesn't match
        points -= 10;
        reasons.push(`Seniority "${effectiveSeniority}" doesn't match target ${normalizedTargets.join('/')}`);
      }
    }

    // Floor for known non-decision-makers
    if (['entry', 'training'].includes(effectiveSeniority)) {
      points = Math.min(points, 15);
      reasons.push('Entry/training-level contacts are unlikely decision makers');
    }
  }

  // ── Department scoring ──
  if (targetDepartments.length > 0 && department) {
    const normalizedDept = department.toLowerCase().trim().replace(/[-\s]+/g, '_');
    const normalizedTargets = targetDepartments.map(d => d.toLowerCase().trim().replace(/[-\s]+/g, '_'));

    if (normalizedTargets.includes(normalizedDept)) {
      points += 30;
      matchedSignals.push(`Department match: ${department}`);
      reasons.push(`Department "${department}" matches target`);
    } else {
      // Check adjacency
      const isAdjacent = normalizedTargets.some(target =>
        DEPARTMENT_ADJACENCY[target]?.includes(normalizedDept) ||
        DEPARTMENT_ADJACENCY[normalizedDept]?.includes(target)
      );

      if (isAdjacent) {
        points += 15;
        matchedSignals.push(`Related department: ${department}`);
        reasons.push(`Department "${department}" is related to target`);
      }
    }
  }

  // ── Title keyword scoring ──
  if (targetTitleKeywords.length > 0 && jobTitle) {
    const titleLower = jobTitle.toLowerCase();
    let keywordMatches = 0;

    for (const keyword of targetTitleKeywords) {
      if (titleLower.includes(keyword.toLowerCase())) {
        keywordMatches++;
        matchedSignals.push(`Title keyword: "${keyword}"`);
      }
    }

    if (keywordMatches > 0) {
      const keywordPoints = Math.min(keywordMatches * 20, 40);
      points += keywordPoints;
      reasons.push(`${keywordMatches} title keyword${keywordMatches > 1 ? 's' : ''} matched`);
    }
  }

  // Clamp to 0-100
  const score = Math.max(0, Math.min(100, points));

  return {
    score,
    reasoning: reasons.length > 0 ? reasons.join('. ') + '.' : 'No matching signals found.',
    matchedSignals,
  };
}

/**
 * Generic seniority-based DM score when no ICP targeting criteria are defined.
 * Uses only seniority level to estimate decision-maker likelihood.
 * Returns null if no person data is available.
 */
const GENERIC_SENIORITY_SCORES: Record<string, number> = {
  owner: 95,
  founder: 95,
  c_suite: 90,
  partner: 85,
  vp: 80,
  head: 75,
  director: 70,
  manager: 55,
  senior: 35,
  entry: 15,
  training: 10,
};

export function computeGenericDecisionMakerScore(
  input: DecisionMakerInput,
): DecisionMakerResult | null {
  const { jobTitle, seniority, department } = input;

  if (!jobTitle && !seniority && !department) {
    return null;
  }

  const effectiveSeniority = seniority
    ? normalizeSeniority(seniority)
    : jobTitle
      ? inferSeniorityFromTitle(jobTitle)
      : null;

  if (!effectiveSeniority) {
    return {
      score: 50,
      reasoning: 'Has job data but seniority could not be determined from title.',
      matchedSignals: [],
    };
  }

  const score = GENERIC_SENIORITY_SCORES[effectiveSeniority] ?? 50;
  const label = effectiveSeniority.replace(/_/g, ' ');

  return {
    score,
    reasoning: `${label}-level contact — ${score >= 70 ? 'likely' : score >= 50 ? 'possible' : 'unlikely'} decision maker based on seniority.`,
    matchedSignals: [`Seniority: ${label}`],
  };
}
