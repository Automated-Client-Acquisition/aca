// ============================================================================
// sic-catalog.ts
// ----------------------------------------------------------------------------
// Loads the SEC's official Standard Industrial Classification list (444 codes,
// scraped from https://www.sec.gov/search-filings/standard-industrial-
// classification-sic-code-list).
//
// Used as ground truth when resolving a free-text niche to SIC codes — pass
// the canonical list to the LLM so it can only choose from valid codes
// instead of hallucinating ones that don't exist.
// ============================================================================

import sicData from "./data/sic-codes.json" with { type: "json" };

export interface SicCode {
  code: string;     // 4-digit zero-padded
  office: string;   // SEC review office (industry grouping)
  title: string;    // canonical industry name
}

export const SIC_CODES: SicCode[] = sicData as SicCode[];

// Set of valid codes for O(1) validation. Anything not in here is a
// hallucination and must be rejected.
export const VALID_SIC_CODE_SET = new Set(SIC_CODES.map((s) => s.code));

export function isValidSicCode(code: string): boolean {
  return VALID_SIC_CODE_SET.has(code.trim().padStart(4, "0"));
}

/** Filter LLM-output codes down to ones that actually exist in the SEC list. */
export function sanitizeSicCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of codes) {
    const c = String(raw).trim().padStart(4, "0");
    if (VALID_SIC_CODE_SET.has(c) && !seen.has(c)) {
      seen.add(c);
      result.push(c);
    }
  }
  return result;
}

/** Compact text representation for LLM context. ~12KB total. */
export function sicCatalogAsLlmContext(): string {
  return SIC_CODES
    .map((s) => `${s.code}\t${s.title}`)
    .join("\n");
}
