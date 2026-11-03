/**
 * §9.5 — Given one verified email + the matched person's name, deterministically
 * infer the email pattern. Returns a pattern key compatible with
 * permutation-generator.ts and a confidence score per the spec table.
 */

import type { ParsedName } from './types.ts';

export interface InferredPattern {
  pattern: string | null;     // e.g. 'firstname.lastname', or null when fuzzy/custom
  confidence: number;         // 0-100
  is_custom: boolean;         // true when no pattern matched and we cached the literal mapping
}

interface PatternProbe {
  key: string;
  build: (n: { first: string; last: string | null; firstInitial: string; middleInitial: string }) => string | null;
}

const PROBES: PatternProbe[] = [
  { key: 'firstname.lastname', build: (n) => (n.last ? `${n.first}.${n.last}` : null) },
  { key: 'f.lastname', build: (n) => (n.last ? `${n.firstInitial}.${n.last}` : null) },
  { key: 'firstname', build: (n) => n.first },
  { key: 'flastname', build: (n) => (n.last ? `${n.firstInitial}${n.last}` : null) },
  { key: 'lastname.firstname', build: (n) => (n.last ? `${n.last}.${n.first}` : null) },
  { key: 'lastname', build: (n) => n.last },
  { key: 'firstnamelastname', build: (n) => (n.last ? `${n.first}${n.last}` : null) },
  { key: 'firstname_lastname', build: (n) => (n.last ? `${n.first}_${n.last}` : null) },
  { key: 'f_lastname', build: (n) => (n.last ? `${n.firstInitial}_${n.last}` : null) },
  { key: 'lastname_firstname', build: (n) => (n.last ? `${n.last}_${n.first}` : null) },
  { key: 'lastnameF', build: (n) => (n.last ? `${n.last}${n.firstInitial}` : null) },
  { key: 'lastname.f', build: (n) => (n.last ? `${n.last}.${n.firstInitial}` : null) },
  { key: 'firstname-lastname', build: (n) => (n.last ? `${n.first}-${n.last}` : null) },
  { key: 'firstname.m.lastname', build: (n) => (n.last && n.middleInitial ? `${n.first}.${n.middleInitial}.${n.last}` : null) },
  { key: 'f.m.lastname', build: (n) => (n.last && n.middleInitial ? `${n.firstInitial}.${n.middleInitial}.${n.last}` : null) },
];

function ascii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function inferPatternFromEmail(
  email: string,
  parsed: ParsedName,
  sampleSize = 1,
): InferredPattern {
  const at = email.indexOf('@');
  if (at <= 0) return { pattern: null, confidence: 0, is_custom: true };
  const local = email.slice(0, at).toLowerCase();

  const n = {
    first: parsed.first.toLowerCase(),
    last: parsed.last ? parsed.last.toLowerCase() : null,
    firstInitial: parsed.first.slice(0, 1).toLowerCase(),
    middleInitial: parsed.middle ? parsed.middle.slice(0, 1).toLowerCase() : '',
  };

  // Exact pattern match
  for (const probe of PROBES) {
    const candidate = probe.build(n);
    if (!candidate) continue;
    if (candidate.toLowerCase() === local) {
      const confidence = sampleSize >= 3 ? 90 : sampleSize === 2 ? 85 : 95;
      return { pattern: probe.key, confidence, is_custom: false };
    }
  }

  // Fuzzy match: ASCII-folded + punctuation-collapsed equality
  const localFolded = ascii(local);
  for (const probe of PROBES) {
    const candidate = probe.build(n);
    if (!candidate) continue;
    if (ascii(candidate) === localFolded) {
      return { pattern: probe.key, confidence: 70, is_custom: false };
    }
  }

  // Substring containment (both first and last appear in local part)
  if (n.last && local.includes(n.first) && local.includes(n.last)) {
    if (local === `${n.first}${n.last}`) return { pattern: 'firstnamelastname', confidence: 80, is_custom: false };
    return { pattern: null, confidence: 0, is_custom: true };
  }

  return { pattern: null, confidence: 0, is_custom: true };
}
