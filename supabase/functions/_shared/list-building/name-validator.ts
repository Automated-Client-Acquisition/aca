/**
 * Decision-maker name validator.
 *
 * Background: until 2026-05-03 the DM scraper accepted whatever string the
 * Playwright crawler pulled out of a company's "team" page. That meant
 * marketing phrases like "Future-Ready Platform" or single-token brand
 * descriptors like "Solutions" got written into lb_decision_makers as if
 * they were people. Once we shifted to LinkedIn-employee scraping the noise
 * profile changed (LinkedIn returns mostly real people) but a few classes
 * of garbage still slip through: company-name reflections, "Founder Mode",
 * "The Team", non-Latin display strings, etc.
 *
 * This validator is the gate. If `isPlausibleHumanName(first, last)`
 * returns false, the candidate is dropped before insert.
 */

/**
 * First-name buzzword stop list. Strict: a candidate whose first_name
 * (lowercased, stripped of punctuation) matches any of these is rejected.
 *
 * We deliberately do NOT include real-but-rare first names that overlap
 * with common nouns (e.g. "Iris", "Hope", "April") — these are people.
 *
 * Rule of thumb when adding: a token belongs here only if it appears as a
 * marketing label or job-function noun more often than as a first name in
 * the populations we target (English/Latin/CJK).
 */
const BUZZWORD_STOP_LIST = new Set<string>([
  "future",
  "future-ready",
  "ready",
  "enterprise",
  "solutions",
  "solution",
  "platform",
  "platforms",
  "ai",
  "smart",
  "tech",
  "technology",
  "technologies",
  "digital",
  "global",
  "plus",
  "the",
  "team",
  "company",
  "co",
  "inc",
  "ltd",
  "llc",
  "founder",
  "founders",
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "coo",
  "cro",
  "vp",
  "head",
  "chief",
  "director",
  "manager",
  "owner",
  "president",
  "leadership",
  "advisor",
  "advisors",
  "board",
  "investor",
  "investors",
  "client",
  "clients",
  "customer",
  "customers",
  "partner",
  "partners",
  "people",
  "person",
  "user",
  "users",
  "info",
  "contact",
  "contacts",
  "support",
  "sales",
  "marketing",
  "growth",
  "hr",
  "engineering",
  "product",
  "strategy",
  "operations",
  "finance",
  "legal",
  "design",
  "research",
  "analytics",
  "data",
  "insights",
  "innovation",
  "startup",
  "agency",
  "studio",
  "labs",
  "lab",
  "ventures",
  "capital",
  "consulting",
  "services",
  "service",
  "group",
  "holdings",
  "corp",
  "corporation",
  "international",
  "worldwide",
  "online",
  "media",
  "press",
  "news",
  "blog",
  "podcast",
  "all",
  "more",
  "see",
  "show",
  "view",
  "learn",
  "join",
  "apply",
  "click",
  "open",
  "read",
  "watch",
  "menu",
  "search",
  "home",
  "about",
  "careers",
  "jobs",
  "work",
  "case",
  "study",
  "studies",
  "demo",
  "free",
  "trial",
  "pricing",
  "login",
  "signup",
  "signin",
  "register",
  "subscribe",
  "newsletter",
  "stories",
]);

/**
 * Strip common decoration from a name token: bullet points, surrounding
 * punctuation, zero-width chars, multiple spaces. Lowercases for the
 * stop-list check.
 */
function normalize(token: string): string {
  return token
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if the token contains at least N letters (handles non-Latin scripts —
 * Cyrillic, CJK, Arabic, Hebrew, Devanagari etc. all count via \p{L}).
 */
function hasMinLetters(token: string, n: number): boolean {
  const letters = token.match(/\p{L}/gu) ?? [];
  return letters.length >= n;
}

/**
 * True if the input looks like a plausible human name.
 *
 * Rules (first_name):
 *   - At least 2 letters
 *   - Not in BUZZWORD_STOP_LIST
 *   - Has at least one lowercase letter (rejects "FUTURE-READY", "CEO")
 *     unless the name is in a non-cased script (CJK has no case)
 *   - Does not contain digits
 *
 * Rules (last_name, when present — last_name is allowed to be null/empty):
 *   - At least 1 letter
 *   - Not in BUZZWORD_STOP_LIST (rejects "Mariia Solutions")
 *   - Does not contain digits
 *
 * Cross-check (when company_name is supplied):
 *   - The full name must not be a substring of the company name. Catches
 *     e.g. "Future-Ready Platform" when the company name contains those
 *     words. Substring match is case-insensitive, on the lowercased
 *     normalized strings.
 */
export function isPlausibleHumanName(
  first: string | null | undefined,
  last: string | null | undefined,
  companyName?: string | null,
): boolean {
  const f = normalize(first ?? "");
  const l = normalize(last ?? "");

  if (!f) return false;
  if (!hasMinLetters(f, 2)) return false;
  if (/\d/.test(f)) return false;
  if (BUZZWORD_STOP_LIST.has(f)) return false;

  // Reject if all-uppercase Latin (no lowercase letters) AND uses Latin script.
  // Skip the uppercase check for non-Latin scripts (CJK, Hebrew, Arabic, etc.
  // have no case concept).
  const hasLatinUpper = /[A-Z]/.test(first ?? "");
  const hasLatinLower = /[a-z]/.test(first ?? "");
  if (hasLatinUpper && !hasLatinLower) return false;

  if (l) {
    if (/\d/.test(l)) return false;
    if (BUZZWORD_STOP_LIST.has(l)) return false;
  }

  // Company-name cross-check: reject if the name is contained in the
  // company name (this catches "Future-Ready Platform" at a company
  // called "Future-Ready Platform Inc.").
  if (companyName) {
    const company = normalize(companyName);
    const candidate = (l ? `${f} ${l}` : f).trim();
    if (candidate && company.includes(candidate)) return false;
  }

  return true;
}
