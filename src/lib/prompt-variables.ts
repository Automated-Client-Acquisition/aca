/**
 * Plain-language catalog of the {{variables}} generation resolves, and an
 * analyzer that labels every token in a prompt so "Edit as prompt" can show
 * pills instead of mustache syntax and flag names nothing will fill.
 * Source of truth for what resolves: supabase/functions/_shared/prompt-resolver.ts
 * and _shared/blueprint-variables.ts.
 */

export type VariableGroup = "Topic" | "AI angle" | "Brand" | "Audience" | "Product" | "Person" | "Date" | "Video";

export interface VariableInfo {
  token: string; // what goes inside {{ }}
  label: string;
  group: VariableGroup;
}

export const VARIABLE_CATALOG: VariableInfo[] = [
  { token: "topic", label: "Topic", group: "Topic" },
  { token: "idea_text", label: "Topic notes", group: "Topic" },
  { token: "ai_hook", label: "Hook", group: "AI angle" },
  { token: "ai_hooks", label: "All hooks", group: "AI angle" },
  { token: "ai_talking_points", label: "Talking points", group: "AI angle" },
  { token: "ai_talking_points_list", label: "Talking points (one line)", group: "AI angle" },
  { token: "ai_guidelines", label: "Idea guidelines", group: "Topic" },
  { token: "ai_cta", label: "Call to action", group: "AI angle" },
  { token: "ai_script_structure", label: "Script structure", group: "AI angle" },
  { token: "ai_engagement_drivers", label: "Engagement drivers", group: "AI angle" },
  { token: "brand.name", label: "Brand name", group: "Brand" },
  { token: "brand.tone", label: "Brand tone", group: "Brand" },
  { token: "brand.style_guidelines", label: "Style rules", group: "Brand" },
  { token: "brand.description", label: "Brand description", group: "Brand" },
  { token: "brand.visual_style_description", label: "Brand look", group: "Brand" },
  { token: "icp.name", label: "Audience", group: "Audience" },
  { token: "icp.description", label: "Who they are", group: "Audience" },
  { token: "icp.pain_points", label: "Audience pains", group: "Audience" },
  { token: "icp.desires", label: "Audience goals", group: "Audience" },
  { token: "icp.language_style", label: "How they talk", group: "Audience" },
  { token: "icp.objections", label: "Objections", group: "Audience" },
  { token: "product.name", label: "Product name", group: "Product" },
  { token: "product.description", label: "Product description", group: "Product" },
  { token: "product.key_benefits", label: "Key benefits", group: "Product" },
  { token: "product.features", label: "Features", group: "Product" },
  { token: "character.name", label: "Person's name", group: "Person" },
  { token: "character.speaking_style", label: "Speaking style", group: "Person" },
  { token: "character.visual_style", label: "Person's look", group: "Person" },
  { token: "current_date", label: "Today's date", group: "Date" },
  { token: "current_month", label: "Current month", group: "Date" },
  { token: "current_year", label: "Current year", group: "Date" },
  { token: "video_duration", label: "Video length (s)", group: "Video" },
];

const BY_TOKEN = new Map(VARIABLE_CATALOG.map((v) => [v.token, v]));

const LIBRARY_PREFIX_GROUP: Record<string, VariableGroup> = {
  brand: "Brand",
  icp: "Audience",
  product: "Product",
  character: "Person",
};

/** Old or table-style prefixes that still resolve but read badly; suggest the short one. */
const PREFIX_ALIASES: Record<string, string> = {
  brand_voice: "brand",
  library_brand_voices: "brand",
  library_icps: "icp",
  library_products: "product",
  library_characters: "character",
};

/** Plain variables the resolver fills besides the catalog. */
const OTHER_KNOWN = new Set([
  "idea", "title", "context", "idea_context",
  "ai_hook_type", "ai_hooks_list", "ai_cta_type", "ai_cta_placement", "ai_ctas", "ai_ctas_list", "ai_talking_point",
  "ai_script_opening", "ai_script_body", "ai_script_climax", "ai_script_closing", "ai_engagement_drivers_list",
  "ai_guardrails", "ai_avoid",
  "current_month_short", "current_month_number", "current_quarter",
  "video_duration_minutes", "scene_count", "scene_duration",
]);

export type TokenKind = "variable" | "section_open" | "section_else" | "section_close";

export interface PromptToken {
  start: number;
  end: number;
  raw: string;
  kind: TokenKind;
  /** Variable path without markers, e.g. "brand.tone". */
  path: string;
  label: string;
  group: VariableGroup | null;
  status: "ok" | "alias" | "unknown";
  /** For aliases: the path to use instead. */
  suggestion?: string;
}

function describe(path: string): Pick<PromptToken, "label" | "group" | "status" | "suggestion"> {
  const clean = path.replace(/^\?/, "");
  const known = BY_TOKEN.get(clean);
  if (known) return { label: known.label, group: known.group, status: "ok" };
  const dot = clean.indexOf(".");
  if (dot > 0) {
    const prefix = clean.slice(0, dot);
    const field = clean.slice(dot + 1);
    const alias = PREFIX_ALIASES[prefix];
    if (alias) {
      const suggestion = `${alias}.${field}`;
      return {
        label: BY_TOKEN.get(suggestion)?.label ?? field.replace(/_/g, " "),
        group: LIBRARY_PREFIX_GROUP[alias],
        status: "alias",
        suggestion,
      };
    }
    if (LIBRARY_PREFIX_GROUP[prefix]) {
      return { label: field.replace(/_/g, " "), group: LIBRARY_PREFIX_GROUP[prefix], status: "ok" };
    }
    return { label: clean, group: null, status: "unknown" };
  }
  if (OTHER_KNOWN.has(clean)) {
    return { label: clean.replace(/^ai_/, "").replace(/_/g, " "), group: clean.startsWith("ai_") ? "AI angle" : "Topic", status: "ok" };
  }
  if (LIBRARY_PREFIX_GROUP[clean]) return { label: clean, group: LIBRARY_PREFIX_GROUP[clean], status: "ok" };
  return { label: clean, group: null, status: "unknown" };
}

export function analyzePrompt(prompt: string): PromptToken[] {
  const tokens: PromptToken[] = [];
  for (const m of prompt.matchAll(/\{\{\s*([#^/]?)\s*([^}]+?)\s*\}\}/g)) {
    const marker = m[1];
    const path = m[2].trim();
    const kind: TokenKind = marker === "#" ? "section_open" : marker === "^" ? "section_else" : marker === "/" ? "section_close" : "variable";
    tokens.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], kind, path, ...describe(path) });
  }
  return tokens;
}

/** Tokens that won't resolve as written, deduplicated by path. */
export function promptProblems(prompt: string): PromptToken[] {
  const seen = new Set<string>();
  return analyzePrompt(prompt).filter((t) => {
    if (t.kind === "section_close" || t.status === "ok" || seen.has(t.path)) return false;
    seen.add(t.path);
    return true;
  });
}

export function replaceVariable(prompt: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return prompt.replace(new RegExp(`\\{\\{(\\s*[#^/?]?\\s*)${escaped}(\\s*)\\}\\}`, "g"), `{{$1${to}$2}}`);
}
