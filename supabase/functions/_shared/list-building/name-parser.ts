/**
 * ACA List Building Engine — Name Parser
 *
 * Normalizes human names into a ParsedName structure used downstream by the
 * permutation generator and SMTP verifier. Extends the enrichment module's
 * parseName() with flag detection (hyphen/accent/single/has_middle) and a
 * nickname lookup table covering the 50 most common Anglo given names.
 *
 * Spec: ACA_List_Building_Engine_Spec v1.0, section 5.3.
 */

import type { ParsedName, NameFlags } from './types.ts';
import { parseName as enrichmentParseName } from '../enrichment/index.ts';

// ----------------------------------------------------------------------------
// Nickname map — lowercase canonical -> list of common short forms / variants
// ----------------------------------------------------------------------------
// Kept deliberately tight: only widely-recognized diminutives. Downstream the
// generator will emit `firstname.lastname` and `firstname` permutations for
// every entry so inflation on rare nicknames has a real cost.
const NICKNAMES: Record<string, string[]> = {
  william: ['bill', 'will', 'billy', 'willy'],
  robert: ['rob', 'bob', 'bobby', 'robbie'],
  michael: ['mike', 'mikey', 'mick'],
  james: ['jim', 'jimmy', 'jamie'],
  elizabeth: ['liz', 'beth', 'lisa', 'eliza', 'betty'],
  richard: ['rick', 'dick', 'rich', 'richie'],
  thomas: ['tom', 'tommy'],
  joseph: ['joe', 'joey'],
  charles: ['chuck', 'charlie', 'chaz'],
  christopher: ['chris', 'topher'],
  daniel: ['dan', 'danny'],
  david: ['dave', 'davey'],
  matthew: ['matt', 'matty'],
  andrew: ['andy', 'drew'],
  anthony: ['tony', 'ant'],
  alexander: ['alex', 'al', 'xander'],
  nicholas: ['nick', 'nicky'],
  patrick: ['pat', 'paddy'],
  samuel: ['sam', 'sammy'],
  benjamin: ['ben', 'benny', 'benji'],
  jonathan: ['jon', 'jonny'],
  nathaniel: ['nate', 'nat'],
  edward: ['ed', 'eddie', 'ted', 'ned'],
  frederick: ['fred', 'freddy', 'rick'],
  gregory: ['greg', 'gregg'],
  kenneth: ['ken', 'kenny'],
  lawrence: ['larry', 'lawrie'],
  raymond: ['ray'],
  ronald: ['ron', 'ronnie'],
  stephen: ['steve', 'stevie'],
  steven: ['steve', 'stevie'],
  timothy: ['tim', 'timmy'],
  vincent: ['vince', 'vinny'],
  walter: ['walt', 'wally'],
  albert: ['al', 'bert'],
  arthur: ['art', 'artie'],
  bernard: ['bernie', 'bern'],
  douglas: ['doug', 'dougie'],
  francis: ['frank', 'fran', 'frankie'],
  harold: ['harry', 'hal'],
  henry: ['hank', 'harry'],
  howard: ['howie', 'howe'],
  jeffrey: ['jeff', 'jefferson'],
  leonard: ['leon', 'lenny', 'len'],
  martin: ['marty', 'mart'],
  peter: ['pete', 'petey'],
  phillip: ['phil', 'philly'],
  philip: ['phil', 'philly'],
  russell: ['russ', 'rusty'],
  theodore: ['ted', 'teddy', 'theo'],
  victor: ['vic', 'vick'],
  wallace: ['wally', 'wal'],
  rebecca: ['becky', 'becca'],
  jennifer: ['jen', 'jenny', 'jenn'],
  katherine: ['kate', 'kathy', 'katie', 'kat'],
  catherine: ['cath', 'cathy', 'kate', 'katie'],
  margaret: ['maggie', 'meg', 'peggy'],
  patricia: ['pat', 'patty', 'tricia'],
  deborah: ['deb', 'debbie'],
  barbara: ['barb', 'babs'],
  susan: ['sue', 'susie'],
  eugene: ['gene'],
};

// ----------------------------------------------------------------------------
// Normalization
// ----------------------------------------------------------------------------

/**
 * Lowercase, strip diacritics (NFD), remove apostrophes/commas/periods,
 * collapse inner whitespace. Result is ASCII-safe for SMTP local parts.
 */
function normalizeToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacritics
    .toLowerCase()
    .replace(/['’`,.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAccent(s: string): boolean {
  // Any char outside basic ASCII letters/space/hyphen counts as accented.
  return /[^\x00-\x7f]/.test(s);
}

function hasHyphen(s: string): boolean {
  return s.includes('-');
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export interface ParseOptions {
  /** Pre-split input, e.g. Apollo sometimes ships first/last separately. */
  first?: string;
  last?: string;
  middle?: string;
}

/**
 * Parse a contact name into first/middle/last with normalization and flags.
 *
 * Handles:
 *   - "John Smith"           -> first=john last=smith
 *   - "Smith-Jones, Marie"   -> "Last, First" comma form
 *   - "François Müller"      -> accent flag, normalized francois muller
 *   - "Madonna"              -> single_name flag
 *   - "Dr. Jean-Claude Van Damme" -> honorific stripped, hyphen flag, middle
 */
export function parseContactName(
  fullName: string,
  alreadySplit?: ParseOptions
): ParsedName {
  // ------------------------------------------------------------------ raw
  let firstRaw = (alreadySplit?.first ?? '').trim();
  let middleRaw = (alreadySplit?.middle ?? '').trim();
  let lastRaw = (alreadySplit?.last ?? '').trim();

  if (!firstRaw && !lastRaw) {
    // Work from fullName
    let cleaned = (fullName || '').trim();

    // Strip common honorifics at start
    cleaned = cleaned.replace(
      /^(mr|mrs|ms|miss|dr|prof|sir|madam|mx|rev)\.?\s+/i,
      ''
    );
    // Strip trailing suffixes (Jr, Sr, II, III, PhD, MD)
    cleaned = cleaned.replace(
      /[,\s]+(jr|sr|ii|iii|iv|phd|md|esq)\.?$/i,
      ''
    );

    if (cleaned.includes(',')) {
      // "Last, First [Middle]" form
      const [lastPart, rest] = cleaned.split(',', 2).map((s) => s.trim());
      lastRaw = lastPart;
      const restParts = rest ? rest.split(/\s+/) : [];
      firstRaw = restParts[0] || '';
      middleRaw = restParts.slice(1).join(' ');
    } else {
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        firstRaw = '';
      } else if (parts.length === 1) {
        firstRaw = parts[0];
      } else if (parts.length === 2) {
        firstRaw = parts[0];
        lastRaw = parts[1];
      } else {
        // 3+: first, middle(s), last. Treat everything between as middle.
        firstRaw = parts[0];
        lastRaw = parts[parts.length - 1];
        middleRaw = parts.slice(1, -1).join(' ');
      }
    }
  }

  // ---------------------------------------------------------------- flags
  // Flags consider the RAW tokens so hyphens/accents survive normalization.
  const composite = `${firstRaw} ${middleRaw} ${lastRaw}`;
  const flags: NameFlags = {
    hyphen: hasHyphen(firstRaw) || hasHyphen(lastRaw),
    accent: hasAccent(composite),
    single_name: !lastRaw,
    has_middle: !!middleRaw,
    nickname_variants: [],
  };

  // ---------------------------------------------------------- normalized
  const first = normalizeToken(firstRaw);
  const middle = middleRaw ? normalizeToken(middleRaw) : null;
  const last = lastRaw ? normalizeToken(lastRaw) : null;

  // ----------------------------------------------------------- nicknames
  // Try canonical lookup first, then reverse lookup (e.g. "Bill" -> William).
  if (first && NICKNAMES[first]) {
    flags.nickname_variants = [...NICKNAMES[first]];
  } else if (first) {
    for (const [canonical, variants] of Object.entries(NICKNAMES)) {
      if (variants.includes(first)) {
        flags.nickname_variants = [canonical, ...variants.filter((v) => v !== first)];
        break;
      }
    }
  }

  return {
    first,
    last,
    middle,
    first_raw: firstRaw,
    last_raw: lastRaw || null,
    flags,
  };
}

/**
 * Back-compat helper: wraps the enrichment parseName() with our normalization.
 * Useful when you already have a first/last pair from a provider payload.
 */
export function parseFromPair(firstName: string, lastName: string): ParsedName {
  return parseContactName('', { first: firstName, last: lastName });
}

/** Exposed for tests / downstream lookups. */
export function getNicknameMap(): Readonly<Record<string, readonly string[]>> {
  return NICKNAMES;
}

// Silence unused-import warning in builds that tree-shake aggressively.
void enrichmentParseName;
