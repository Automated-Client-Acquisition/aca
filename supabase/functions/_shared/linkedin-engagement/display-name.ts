/**
 * Split a LinkedIn display name into first/last for personalization.
 *
 * Unipile's reaction/comment payloads carry only a decorated display string
 * ("Frank Monteleone, CHRE", "🌮 Scott Craig Porter") — never a first/last
 * pair — so engagement-sourced contacts land with NULL first_name and break
 * {{first_name}} in sequences. This recovers the pair from the display string.
 *
 * Deliberately NOT reusing the other two parsers:
 *   - list-building/name-parser.ts lowercases and strips accents (it feeds SMTP
 *     local-part permutations), so it would render "Hi eric".
 *   - enrichment/parseName() splits on whitespace only, so credentials survive
 *     into last_name ("Monteleone, CHRE").
 * It also inverts one rule: on LinkedIn a comma introduces credentials
 * ("Ravi Kiron, PhD, MBA"), it is never the "Last, First" form name-parser
 * assumes. Casing and accents are preserved verbatim — this value is rendered
 * to a human, not normalized for matching.
 *
 * Best-effort by design: first_name is what personalization needs and the first
 * token is it in almost every case; last_name is the remainder. Anything with
 * no recoverable given name returns nulls rather than a guess, because a wrong
 * first name is worse in an email than a missing one (the template falls back).
 */

/** Trailing tokens that are credentials or roles, never surnames. */
const TRAILING_NOISE = new Set([
  // credentials
  'md', 'phd', 'mba', 'cfa', 'cpa', 'esq', 'jd', 'rn', 'dds', 'dvm', 'csm',
  'mpa', 'msc', 'bsc', 'ba', 'ma', 'fca', 'cfei', 'rfc', 'mib', 'scmp', 'pmp',
  'cissp', 'cfp', 'pe', 'aia', 'lmft', 'lcsw', 'mph', 'edd', 'psyd', 'bfp',
  'hons', 'cma', 'cia', 'chre', 'cpm', 'clu', 'chfc',
  // roles
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'founder', 'cofounder',
  'co-founder', 'president', 'director', 'coach', 'author', 'expert',
  'consultant', 'speaker', 'investor', 'advisor', 'mentor',
]);

/** Generational suffixes — dropped from last_name, never a given name. */
const GENERATIONAL = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const HONORIFIC = /^(mr|mrs|ms|miss|dr|prof|sir|madam|mx|rev|fr|capt|lt|col)\.?\s+/i;

/**
 * Strip decoration LinkedIn users add to their name field, leaving only the
 * human name. Non-Latin scripts survive; only pictographs and flags are cut.
 */
export function cleanDisplayName(raw: string): string {
  let s = (raw || '').trim();

  // Bracketed asides: nicknames, CJK transliterations, "(acting)". Full-width
  // and square forms show up as often as round ones. Runs first so a comma or
  // separator *inside* an aside can't strand its opening bracket.
  s = s.replace(/[([{（［][^)\]}）］]*[)\]}）］]/g, ' ');

  // A comma or a separator introduces credentials or a headline — cut there.
  s = s.split(',')[0];
  s = s.split(/\s+[-–—|•·/]\s+/)[0];

  // Keep only what a name is made of. Stated positively rather than as a
  // blocklist of emoji ranges, so anything decorative — pictographs, flags,
  // bullets, quote marks around an inline nickname, digits — is gone in one
  // pass, while accented and non-Latin letters survive. The quote marks go but
  // the nickname stays: Agwu "AG" Ukwa is how that person writes their name.
  s = s.replace(/[^\p{L}\s.'’-]/gu, '');

  // Collapse whitespace and strip edge punctuation BEFORE the honorific match:
  // decoration is often glued to the title ("💫Dr. Sirisha K."), which would
  // otherwise defeat the leading anchor and leave first_name = "Dr.".
  // A trailing period survives so truncated surnames stay natural ("Aaron C.").
  s = s.replace(/\s+/g, ' ').replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, '').trim();
  s = s.replace(HONORIFIC, '');

  return s;
}

export interface SplitName {
  firstName: string | null;
  lastName: string | null;
}

/**
 * Split a decorated LinkedIn display name into a first/last pair.
 *
 * A single surviving token yields no name: those are overwhelmingly brand
 * accounts ("GojiberryAI", "sending.ac") rather than mononymous people, and
 * "Hi GojiberryAI" is a worse outcome than the template's own fallback.
 */
export function splitDisplayName(raw: string): SplitName {
  const cleaned = cleanDisplayName(raw);
  if (!cleaned) return { firstName: null, lastName: null };

  let tokens = cleaned.split(/\s+/).filter(Boolean);

  // Drop trailing credential/role/generational tokens, but never eat the
  // whole name — the first token is always a candidate given name.
  while (tokens.length > 1) {
    const tail = tokens[tokens.length - 1].replace(/[.®™]/g, '').toLowerCase();
    // A lone letter is an abbreviated surname, not noise. LinkedIn truncates
    // surnames constantly ("Varshaa V."), and "V"/"I" would otherwise collide
    // with the Roman-numeral suffixes and collapse the name to one token.
    if (tail.length < 2) break;
    if (TRAILING_NOISE.has(tail) || GENERATIONAL.has(tail)) tokens.pop();
    else break;
  }

  if (tokens.length < 2) return { firstName: null, lastName: null };

  const [firstName, ...rest] = tokens;
  return { firstName, lastName: rest.join(' ') };
}
