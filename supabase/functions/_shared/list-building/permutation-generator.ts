/**
 * ACA List Building Engine — Permutation Generator
 *
 * Deterministically expands a parsed name + domain into a tiered list of
 * candidate email addresses. Tiers map to verification priority:
 *   T1: most common corporate patterns (~80% hit rate)
 *   T2: punctuation / concatenation variants
 *   T3: middle-initial variants + enumerated suffixes
 *   T4: role inboxes (activate for small companies)
 *   T5: hyphen / accent / compound-last special cases
 *
 * Spec: ACA_List_Building_Engine_Spec v1.0, section 5.4.
 */

import type { ParsedName, Permutation, PermutationTier } from './types.ts';

export interface PermutationOptions {
  /** Company headcount signal. <10 unlocks tier-4 role patterns. */
  companySize?: number;
  /** Force tier-4 role patterns regardless of company size. */
  includeRoles?: boolean;
  /** Short-circuit to a single pattern (used after pattern-cache hit). */
  forcePattern?: string;
  /** Cap pipeline at this tier for latency-sensitive runs. */
  maxTiers?: PermutationTier;
  /**
   * Per-domain bias hints (Discovery Layer §9.3). Reranks within each tier
   * without changing which patterns are tested. Higher-bias permutations get
   * verified first; tier ordering between tiers is preserved.
   */
  mxProvider?: 'google' | 'microsoft' | 'other';
  /** Top-level domain (lowercased, e.g. 'com', 'de', 'fr', 'gov', 'jp'). */
  tld?: string;
  /** Free-text industry hint (e.g. 'law', 'consulting', 'finance', 'tech', 'saas'). */
  industry?: string;
}

const ROLE_INBOXES = ['info', 'contact', 'hello', 'ceo', 'sales', 'admin'];

interface PatternSpec {
  tier: PermutationTier;
  pattern: string;
  build: (n: Normalized) => string | null;
}

interface Normalized {
  first: string;
  last: string | null;
  middle: string | null;
  firstInitial: string;
  middleInitial: string;
  first3: string;
  /** Hyphen-collapsed last name, e.g. "smith-jones" -> "smithjones" */
  lastCompound: string | null;
  /** Last name with hyphen preserved */
  lastHyphen: string | null;
}

function normalize(name: ParsedName): Normalized {
  const first = name.first;
  const last = name.last;
  const middle = name.middle;
  return {
    first,
    last,
    middle,
    firstInitial: first.slice(0, 1),
    middleInitial: middle ? middle.slice(0, 1) : '',
    first3: first.slice(0, 3),
    lastCompound: last ? last.replace(/-/g, '') : null,
    lastHyphen: last && last.includes('-') ? last : null,
  };
}

// ----------------------------------------------------------------------------
// Pattern table — order matters, tier asc then pattern index asc.
// ----------------------------------------------------------------------------
const PATTERNS: PatternSpec[] = [
  // -------- Tier 1: bread & butter --------
  { tier: 1, pattern: 'firstname.lastname', build: (n) => (n.last ? `${n.first}.${n.last}` : null) },
  { tier: 1, pattern: 'f.lastname', build: (n) => (n.last ? `${n.firstInitial}.${n.last}` : null) },
  { tier: 1, pattern: 'firstname', build: (n) => n.first },
  { tier: 1, pattern: 'flastname', build: (n) => (n.last ? `${n.firstInitial}${n.last}` : null) },
  { tier: 1, pattern: 'lastname.firstname', build: (n) => (n.last ? `${n.last}.${n.first}` : null) },
  { tier: 1, pattern: 'lastname', build: (n) => n.last },

  // -------- Tier 2: concat / underscore / hyphen variants --------
  { tier: 2, pattern: 'firstnamelastname', build: (n) => (n.last ? `${n.first}${n.last}` : null) },
  { tier: 2, pattern: 'firstname_lastname', build: (n) => (n.last ? `${n.first}_${n.last}` : null) },
  { tier: 2, pattern: 'f_lastname', build: (n) => (n.last ? `${n.firstInitial}_${n.last}` : null) },
  { tier: 2, pattern: 'lastname_firstname', build: (n) => (n.last ? `${n.last}_${n.first}` : null) },
  { tier: 2, pattern: 'lastnameF', build: (n) => (n.last ? `${n.last}${n.firstInitial}` : null) },
  { tier: 2, pattern: 'lastname.f', build: (n) => (n.last ? `${n.last}.${n.firstInitial}` : null) },
  { tier: 2, pattern: 'firstname-lastname', build: (n) => (n.last ? `${n.first}-${n.last}` : null) },
  { tier: 2, pattern: '3char.lastname', build: (n) => (n.last && n.first3.length === 3 ? `${n.first3}.${n.last}` : null) },

  // -------- Tier 3: middle initial / enumerated --------
  { tier: 3, pattern: 'firstname.m.lastname', build: (n) => (n.last && n.middleInitial ? `${n.first}.${n.middleInitial}.${n.last}` : null) },
  { tier: 3, pattern: 'f.m.lastname', build: (n) => (n.last && n.middleInitial ? `${n.firstInitial}.${n.middleInitial}.${n.last}` : null) },
  { tier: 3, pattern: 'firstnamemiddlelastname', build: (n) => (n.last && n.middle ? `${n.first}${n.middle}${n.last}` : null) },
  { tier: 3, pattern: 'fml', build: (n) => (n.last && n.middleInitial ? `${n.firstInitial}${n.middleInitial}${n.last.slice(0, 1)}` : null) },
  { tier: 3, pattern: 'firstname.lastname1', build: (n) => (n.last ? `${n.first}.${n.last}1` : null) },
  { tier: 3, pattern: 'firstname.lastname2', build: (n) => (n.last ? `${n.first}.${n.last}2` : null) },
  { tier: 3, pattern: 'f.lastnameN', build: (n) => (n.last ? `${n.firstInitial}.${n.last}1` : null) },
];

// ----------------------------------------------------------------------------
// §9.3 Per-domain pattern bias
// Returns a numeric boost for a given pattern given the available hints.
// Higher boost = test sooner within the same tier.
// ----------------------------------------------------------------------------
function biasScore(
  pattern: string,
  opts: Pick<PermutationOptions, 'mxProvider' | 'tld' | 'industry' | 'companySize'>,
): number {
  let score = 0;
  const { mxProvider, tld, industry, companySize } = opts;

  // ESP defaults
  if (mxProvider === 'google') {
    if (pattern === 'firstname' || pattern === 'firstname.lastname') score += 10;
  } else if (mxProvider === 'microsoft') {
    if (pattern === 'firstname.lastname') score += 15;
  }

  // TLD conventions
  switch (tld) {
    case 'gov':
      if (pattern === 'firstname.lastname' || pattern === 'firstname.m.lastname') score += 12;
      break;
    case 'edu':
      if (pattern === 'flastname' || pattern === 'lastname') score += 8;
      break;
    case 'de':
    case 'at':
    case 'ch':
      if (pattern === 'firstname.lastname' || pattern === 'lastname') score += 7;
      break;
    case 'fr':
      if (pattern === 'firstname.lastname' || pattern === 'f.lastname') score += 7;
      break;
    case 'jp':
    case 'kr':
    case 'cn':
      if (pattern === 'lastname.firstname' || pattern === 'lastnameF') score += 7;
      break;
    default:
      break;
  }

  // Industry hints (free-text — match by substring)
  const ind = (industry || '').toLowerCase();
  if (/(law|legal|consulting|finance|wealth|advisory|banking)/.test(ind)) {
    if (pattern === 'lastname' || pattern === 'flastname') score += 6;
  } else if (/(tech|saas|startup|software|ai|engineering)/.test(ind)) {
    if (pattern === 'firstname' || pattern === 'firstname.lastname') score += 6;
  }

  // Company size
  if (typeof companySize === 'number') {
    if (companySize > 1000) {
      if (pattern === 'flastname' || pattern === 'firstname.lastname') score += 5;
    } else if (companySize < 20) {
      if (pattern === 'firstname') score += 8;
    }
  }

  return score;
}

// Tier 4 roles are not name-dependent; emitted separately.
function tier4RolePermutations(domain: string): Permutation[] {
  return ROLE_INBOXES.map((role) => ({
    email: `${role}@${domain}`,
    local_part: role,
    pattern: `role_${role}`,
    tier: 4 as PermutationTier,
  }));
}

// Tier 5 hyphen / accent / compound specials.
function tier5Specials(n: Normalized, flags: ParsedName['flags']): PatternSpec[] {
  const specs: PatternSpec[] = [];
  if (flags.hyphen && n.lastHyphen) {
    specs.push({
      tier: 5,
      pattern: 'firstname.hyphen-last',
      build: (nn) => (nn.lastHyphen ? `${nn.first}.${nn.lastHyphen}` : null),
    });
    specs.push({
      tier: 5,
      pattern: 'f.hyphen-last',
      build: (nn) => (nn.lastHyphen ? `${nn.firstInitial}.${nn.lastHyphen}` : null),
    });
  }
  if ((flags.hyphen || flags.accent) && n.lastCompound) {
    specs.push({
      tier: 5,
      pattern: 'firstname.compoundlast',
      build: (nn) => (nn.lastCompound ? `${nn.first}.${nn.lastCompound}` : null),
    });
  }
  return specs;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function generatePermutations(
  name: ParsedName,
  domain: string,
  opts: PermutationOptions = {}
): Permutation[] {
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain || !name.first) return [];

  const n = normalize(name);
  const maxTier: PermutationTier = opts.maxTiers ?? 5;
  const seen = new Set<string>();
  const out: Permutation[] = [];

  const push = (tier: PermutationTier, pattern: string, local: string | null) => {
    if (!local) return;
    const clean = local.toLowerCase().replace(/[^a-z0-9._+-]/g, '');
    if (!clean) return;
    const email = `${clean}@${cleanDomain}`;
    if (seen.has(email)) return;
    seen.add(email);
    out.push({ email, local_part: clean, pattern, tier });
  };

  // ---------- forcePattern short-circuit ----------
  if (opts.forcePattern) {
    const spec = PATTERNS.find((p) => p.pattern === opts.forcePattern);
    if (spec) {
      push(spec.tier, spec.pattern, spec.build(n));
    } else if (opts.forcePattern.startsWith('role_')) {
      const role = opts.forcePattern.slice(5);
      push(4, opts.forcePattern, role);
    }
    return out;
  }

  // ---------- tiers 1-3 ----------
  for (const spec of PATTERNS) {
    if (spec.tier > maxTier) break;
    push(spec.tier, spec.pattern, spec.build(n));
  }

  // ---------- nickname tier-1 variants ----------
  // Emit `nickname.lastname` and `nickname` with _nickname suffix so the
  // cache can tell nickname hits from canonical ones.
  if (maxTier >= 1 && name.flags.nickname_variants.length > 0) {
    for (const nick of name.flags.nickname_variants) {
      const nickNorm = nick.toLowerCase();
      if (n.last) push(1, 'firstname.lastname_nickname', `${nickNorm}.${n.last}`);
      push(1, 'firstname_nickname', nickNorm);
    }
  }

  // ---------- tier 4 roles ----------
  const rolesOn =
    maxTier >= 4 &&
    (opts.includeRoles === true ||
      (typeof opts.companySize === 'number' && opts.companySize < 10));
  if (rolesOn) {
    for (const p of tier4RolePermutations(cleanDomain)) {
      if (!seen.has(p.email)) {
        seen.add(p.email);
        out.push(p);
      }
    }
  }

  // ---------- tier 5 specials ----------
  if (maxTier >= 5 && (name.flags.hyphen || name.flags.accent)) {
    for (const spec of tier5Specials(n, name.flags)) {
      push(spec.tier, spec.pattern, spec.build(n));
    }
  }

  // §9.3 — within-tier reranking by domain bias.
  // Stable sort: tier asc, then bias desc, then original index asc.
  if (opts.mxProvider || opts.tld || opts.industry || typeof opts.companySize === 'number') {
    const indexed = out.map((p, i) => ({ p, i, bias: biasScore(p.pattern, opts) }));
    indexed.sort((a, b) => {
      if (a.p.tier !== b.p.tier) return a.p.tier - b.p.tier;
      if (a.bias !== b.bias) return b.bias - a.bias;
      return a.i - b.i;
    });
    return indexed.map((x) => x.p);
  }

  return out;
}
