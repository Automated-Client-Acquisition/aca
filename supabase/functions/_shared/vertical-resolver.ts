// ============================================================================
// vertical-resolver.ts
// ----------------------------------------------------------------------------
// Translates a niche string ("HVAC", "law firms", "find me solar installers")
// into a structured query body the lead-pool worker understands.
//
// Two-tier resolution:
//   1. Static curated library (vertical-definitions.ts) — fast, no LLM call.
//   2. LLM fallback grounded in the SEC SIC catalog — handles arbitrary
//      free-text niches without hallucinating SIC codes that don't exist.
//      Output is sanitized against VALID_SIC_CODE_SET before use.
// ============================================================================

import {
  findVertical,
  type MatchCombinator,
  type VerticalDefinition,
} from "./vertical-definitions.ts";
import {
  sanitizeSicCodes,
  sicCatalogAsLlmContext,
} from "./sic-catalog.ts";

export interface ResolvedVertical {
  source: "static" | "llm";
  slug: string;
  label: string;
  sic_codes: string[];
  keywords: string[];
  match: MatchCombinator | "industry_only";
  industry_exact?: string;
  // True iff every code in sic_codes is in the SEC list. Always true for
  // static; LLM responses are sanitized before being returned.
  validated: boolean;
}

function defToResolved(def: VerticalDefinition): ResolvedVertical {
  return {
    source: "static",
    slug: def.slug,
    label: def.label,
    sic_codes: def.sic_codes,
    keywords: def.keywords,
    match: def.match,
    industry_exact: def.industry_exact,
    validated: true,
  };
}

export function resolveStatic(query: string): ResolvedVertical | null {
  const def = findVertical(query);
  return def ? defToResolved(def) : null;
}

// ---------------------------------------------------------------------------
// LLM fallback. Default model: Claude Haiku via OpenRouter (cheap, fast,
// strict instruction following). We pass the full SEC SIC catalog (~12KB)
// as system context and ask for JSON output.
// ---------------------------------------------------------------------------

interface LlmResolveArgs {
  query: string;
  apiKey: string;
  model?: string;          // default: anthropic/claude-haiku-4.5
  apiBase?: string;        // default: https://openrouter.ai/api/v1
}

export async function resolveLlm(args: LlmResolveArgs): Promise<ResolvedVertical> {
  const model = args.model ?? "anthropic/claude-haiku-4.5";
  const apiBase = args.apiBase ?? "https://openrouter.ai/api/v1";

  const systemPrompt =
    "You translate B2B niche descriptions into structured lead-pool queries.\n" +
    "You will be given the canonical SEC Standard Industrial Classification (SIC) " +
    "code list. CHOOSE ONLY FROM THIS LIST — never invent codes. Each line is\n" +
    "<4-digit-code>\\t<industry title>. If a niche maps to multiple codes (e.g.\n" +
    "HVAC spans wholesale, manufacturing, service, and contractor codes), include\n" +
    "ALL relevant ones, ordered by relevance.\n\n" +
    "Output schema (JSON only, no prose):\n" +
    "{\n" +
    "  \"label\": \"Human-readable name\",\n" +
    "  \"sic_codes\": [\"NNNN\", ...],\n" +
    "  \"keywords\": [\"word\", ...],   // 2-6 short tokens for company/title text match\n" +
    "  \"match\": \"and\" | \"or\" | \"sic_only\" | \"keyword_only\",\n" +
    "  \"reasoning\": \"one sentence on why this match strategy\"\n" +
    "}\n\n" +
    "Match strategy guide:\n" +
    "- sic_only: niche has 1-3 clean SIC codes covering >95% of companies.\n" +
    "- and: SIC list is decent but keyword filter adds precision.\n" +
    "- or: SIC classification is fragmented in real data; need keyword fallback\n" +
    "  to capture companies with mismatched SIC tags.\n" +
    "- keyword_only: no useful SIC mapping exists for this niche.\n\n" +
    "SIC catalog:\n" +
    sicCatalogAsLlmContext();

  const userPrompt = `Niche: ${args.query}`;

  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`LLM call failed: ${resp.status} ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM returned non-string content");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}`);
  }

  // ---- Sanitize ----------------------------------------------------------
  // Guarantee no hallucinated SIC codes leak through, regardless of model.
  const rawCodes = Array.isArray(parsed.sic_codes) ? (parsed.sic_codes as unknown[]).map(String) : [];
  const validCodes = sanitizeSicCodes(rawCodes);
  const keywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map((k) => String(k).trim()).filter(Boolean)
    : [];

  const matchRaw = String(parsed.match ?? "or");
  const match: MatchCombinator =
    matchRaw === "and" || matchRaw === "or" || matchRaw === "sic_only" || matchRaw === "keyword_only"
      ? matchRaw
      : "or";

  // If LLM gave 0 valid SICs, downgrade to keyword_only — better than
  // returning a query with no selectivity.
  const finalMatch: MatchCombinator =
    validCodes.length === 0 && keywords.length > 0 ? "keyword_only" : match;

  return {
    source: "llm",
    slug: args.query.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_"),
    label: String(parsed.label ?? args.query),
    sic_codes: validCodes,
    keywords,
    match: finalMatch,
    validated: true,
  };
}

/**
 * Resolve a niche to a structured query. Tries static library first, falls
 * back to LLM. Returns null only if both fail (e.g. LLM disabled and no
 * static match).
 */
export async function resolveVertical(args: {
  query: string;
  llmApiKey?: string;
  llmModel?: string;
}): Promise<ResolvedVertical | null> {
  const staticHit = resolveStatic(args.query);
  if (staticHit) return staticHit;
  if (!args.llmApiKey) return null;
  return await resolveLlm({
    query: args.query,
    apiKey: args.llmApiKey,
    model: args.llmModel,
  });
}

/**
 * Translate a resolved vertical into the SearchBody fields the lead-pool
 * worker understands (sic_code_in + keyword + match_combinator). The worker
 * is the consumer — see scripts/pool-query-worker/server.ts.
 */
export function resolvedToSearchBody(r: ResolvedVertical): {
  sic_code_in?: string[];
  keyword?: string;
  industry_exact?: string;
  match_combinator?: "and" | "or";
} {
  const out: ReturnType<typeof resolvedToSearchBody> = {};
  // industry_only short-circuits everything else: a single Apollo industry
  // slug is the highest-precision filter we have.
  if (r.match === "industry_only" && r.industry_exact) {
    out.industry_exact = r.industry_exact;
    return out;
  }
  const useSic = r.match !== "keyword_only" && r.sic_codes.length > 0;
  const useKw = r.match !== "sic_only" && r.keywords.length > 0;
  if (useSic) out.sic_code_in = r.sic_codes;
  if (useKw) out.keyword = r.keywords.join(", ");
  if (useSic && useKw) {
    out.match_combinator = r.match === "or" ? "or" : "and";
  }
  return out;
}
