/**
 * Name and domain normalisation for company identity resolution.
 *
 * These functions decide when two strings are "the same company", which makes
 * them the highest-stakes code in the engine. Over-normalising silently merges
 * distinct businesses and attributes one company's funding round to another —
 * a mistake that already happened once on the public signals page
 * (same-name companies collapsed onto one card until a domain gate was added).
 * So the rule here is: strip only what is unambiguously noise, and let the
 * caller apply a stricter gate on top.
 */

/**
 * Legal-form suffixes. Deliberately limited to actual incorporation forms.
 *
 * Words like "group", "holdings", "partners" and "ventures" are NOT stripped:
 * they distinguish real, separate entities ("Acme" vs "Acme Holdings" are
 * routinely different companies with different buying authority), and removing
 * them is exactly how a resolver starts merging things it shouldn't.
 */
const LEGAL_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co',
  'limited', 'ltd', 'llc', 'lp', 'llp', 'pllc', 'plc', 'pc',
  'gmbh', 'ag', 'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'ab', 'as', 'oy', 'pty',
];

const SUFFIX_RE = new RegExp(`\\b(${LEGAL_SUFFIXES.join('|')})\\b\\.?\\s*$`, 'i');

/**
 * Lowercase, drop punctuation, strip trailing legal forms, collapse whitespace.
 * Applied repeatedly so "Acme Holdings, Inc. Ltd" reduces cleanly.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // A name can carry more than one suffix ("Foo Inc. Ltd").
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX_RE, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Bare registrable host: no protocol, no www, no path, lowercase. */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith('http://') && !s.startsWith('https://')) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    // Reject bare TLDs and obvious junk.
    if (!host.includes('.') || host.split('.').some((p) => p.length === 0)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Hosts that belong to the ATS vendor, never to the hiring company. */
const ATS_VENDOR_HOSTS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com',
  'smartrecruiters.com', 'recruitee.com', 'myworkdayjobs.com', 'bamboohr.com',
];

/**
 * Pull the employer's own domain out of a job-board URL.
 *
 * A board hosted at https://stripe.com/jobs hands us stripe.com for free — the
 * single cheapest resolution there is. A board at jobs.ashbyhq.com/ramp tells
 * us nothing about the employer, so we return null rather than resolving every
 * Ashby customer to ashbyhq.com.
 */
export function domainFromBoardUrl(boardUrl: string | null | undefined): string | null {
  const host = normalizeDomain(boardUrl);
  if (!host) return null;
  if (ATS_VENDOR_HOSTS.some((v) => host === v || host.endsWith(`.${v}`))) return null;
  return host;
}

/**
 * Equality gate for a candidate match. Exact normalized equality, nothing else.
 *
 * This was briefly more permissive — a prefix match at a word boundary, so
 * "stripe" would match "stripe payments". The very first live batch showed why
 * that is wrong: SEC Form D filed by **Sugarfina Corp** (Las Vegas, NV) matched
 * **"Sugarfina Australia"** (sugarfina.com.au, 2 employees), because
 * "sugarfina australia".startsWith("sugarfina "). Those are different legal
 * entities, and the engine would have credited the US parent's funding round to
 * an overseas franchisee, then emailed them about it.
 *
 * Every loosening of this rule admits the same class of bug: "Acme" vs
 * "Acme Germany", "Acme Holdings", "Acme Labs". A blocklist of qualifier words
 * would be an endless game of catch-up. Since the caller scans ALL ranked
 * candidates rather than just the top hit, exact matching still finds the right
 * record whenever the provider holds it — it simply refuses to invent one when
 * the provider doesn't.
 *
 * The asymmetry that justifies the strictness: an unresolved company costs one
 * lead, and a wrongly-resolved one costs the credibility of everything we send.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  return na === nb;
}
