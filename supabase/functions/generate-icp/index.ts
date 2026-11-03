// ============================================================================
// generate-icp
// ----------------------------------------------------------------------------
// Public endpoint. Generates an AI-personalized ICP profile from a playbook
// lead's context (form answers + scraped website text). Uses ACA's OpenRouter
// key — "first build is on us" — so the user can land in the wizard with a
// real, editable buyer profile before they've added their own key.
//
// Cost guardrail: capped at 3 regenerations per lead via icp_regen_count.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  leadId?: string;
  fullName?: string;
  website?: string;
  linkedinUrl?: string;
  niche?: string;
  outcome?: string;
  biggestNeed?: string;
  whatTried?: string;
}

interface ICPResult {
  name: string;
  summary: string;
  industry: string;
  roles: string;
  size: string;
  pains: string[];
  desires: string[];
  objections: string[];
  language: string;
  role: "primary_buyer" | "secondary_buyer";
  audience_type: "b2b_clients" | "b2b_professionals";
  label: string; // human label e.g. "Clients" / "Candidates" / "Buyers" / "Sellers"
}

interface FitWarning {
  level: "soft" | "strong";
  reason: string;
}

interface GenerationResult {
  icps: ICPResult[];
  fit_warning: FitWarning | null;
}

const MAX_REGENS = 3;
const MODEL = "anthropic/claude-haiku-4.5";

async function fetchSiteText(url: string): Promise<string> {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(u, {
      headers: { "User-Agent": `ACA-ICP-Bot/1.0 (+${PUBLIC_SITE_URL})` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.slice(0, 2400);
  } catch (e) {
    console.warn("[generate-icp] site fetch failed:", e);
    return "";
  }
}

function buildPrompt(payload: Payload, siteText: string): string {
  return `You are an expert B2B ICP strategist working for ACA — a B2B outbound platform (LinkedIn, email, WhatsApp). Your job: build sharp, opinionated ICP profiles based on the seller's context.

## Seller context
- Name: ${payload.fullName || "(not given)"}
- Website: ${payload.website || "(none)"}
- LinkedIn: ${payload.linkedinUrl || "(none)"}
- Niche they sell into: ${payload.niche || "(unspecified)"}
- Outcome they deliver: ${payload.outcome || "(unspecified)"}
- Their biggest current blocker: ${payload.biggestNeed || "(unspecified)"}
- What they've tried already: ${payload.whatTried || "(unspecified)"}

## Website body excerpt (first ~2k chars, may be empty)
${siteText || "(no site text available)"}

## Audience classification (critical)
Each ICP must be classified by audience_type:
- "b2b_clients" — companies as buyers (highest fit for ACA)
- "b2b_professionals" — individuals targeted *as professionals* via LinkedIn/work email at scale (recruiters reaching candidates, consultants reaching execs, med-device sellers reaching doctors). Still served by ACA — same channels.

DO NOT generate ICPs for B2C consumers (homeowners, retail shoppers, dating, hobbyists). ACA cannot serve those.

## Two-sided check
Some businesses must reach two distinct buyer types to function. Examples:
- Recruiters → clients (companies hiring) AND candidates (professionals)
- B2B marketplaces → buyers AND sellers, both companies
- B2B trainers/coaches → buyers (managers) AND sometimes a referrer audience
- M&A advisors → sellers AND acquirers

If the business is genuinely two-sided AND both sides are B2B-reachable, generate 2 ICPs (primary + secondary). If only one side is B2B-reachable, generate just that one.

## Fit warning
If the seller's site/niche looks consumer-facing (real-estate agent, dentist, restaurant, personal trainer, dating coach, etc.), still generate the BEST B2B-reachable ICP you can imagine for them (e.g. for a dentist: dental offices buying tech; for a fitness coach: corporate wellness programs) BUT also output a fit_warning telling them ACA is built for B2B and might not match their actual buyers.

Confidence guidance:
- "soft" — site is ambiguous (could be B2B or B2C)
- "strong" — site is clearly consumer-facing
- null — clearly B2B, no warning needed

## Output (strict JSON, no markdown, no commentary)
{
  "icps": [
    {
      "role": "primary_buyer",
      "audience_type": "b2b_clients" | "b2b_professionals",
      "label": "<short noun, e.g. 'Clients', 'Candidates', 'Buyers', 'Sellers'>",
      "name": "<short label, e.g. 'Mid-market staffing agencies'>",
      "summary": "<2-3 sentences>",
      "industry": "<vertical>",
      "roles": "<comma-separated job titles>",
      "size": "<one of: '< 50 employees', '50–500 employees', '500–5k employees', '5k+ employees'>",
      "pains": ["<4-6 specific pains with numbers/details>"],
      "desires": ["<3-5 specific desired outcomes>"],
      "objections": ["<2-4 real objections>"],
      "language": "<2-3 sentences on tone/vocabulary the writer agent should use>"
    }
    /* OPTIONALLY a second object with role: "secondary_buyer" if the business is genuinely two-sided B2B */
  ],
  "fit_warning": null | { "level": "soft" | "strong", "reason": "<one sentence why ACA might not be the right fit>" }
}`;
}

function normalizeICP(raw: Record<string, unknown>, fallbackRole: "primary_buyer" | "secondary_buyer"): ICPResult | null {
  if (typeof raw.name !== "string" || !Array.isArray(raw.pains)) return null;
  const role = (raw.role === "secondary_buyer" ? "secondary_buyer" : fallbackRole) as ICPResult["role"];
  const audience = (raw.audience_type === "b2b_professionals" ? "b2b_professionals" : "b2b_clients") as ICPResult["audience_type"];
  return {
    role,
    audience_type: audience,
    label: String(raw.label || (role === "secondary_buyer" ? "Secondary buyer" : "Primary buyer")),
    name: String(raw.name),
    summary: String(raw.summary || ""),
    industry: String(raw.industry || ""),
    roles: String(raw.roles || ""),
    size: String(raw.size || "50–500 employees"),
    pains: (raw.pains as unknown[] || []).map(String).filter(Boolean),
    desires: (raw.desires as unknown[] || []).map(String).filter(Boolean),
    objections: (raw.objections as unknown[] || []).map(String).filter(Boolean),
    language: String(raw.language || ""),
  };
}

function safeParse(text: string): GenerationResult | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const rawIcps = Array.isArray(obj.icps) ? obj.icps as Record<string, unknown>[] : [];
    const icps = rawIcps
      .slice(0, 2)
      .map((r, i) => normalizeICP(r, i === 0 ? "primary_buyer" : "secondary_buyer"))
      .filter((x): x is ICPResult => !!x);
    if (icps.length === 0) return null;

    let warning: FitWarning | null = null;
    const rawW = obj.fit_warning as Record<string, unknown> | null | undefined;
    if (rawW && typeof rawW === "object") {
      const level = rawW.level === "strong" ? "strong" : "soft";
      const reason = String(rawW.reason || "ACA is built for B2B businesses.");
      warning = { level, reason };
    }
    return { icps, fit_warning: warning };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: Payload = await req.json();
    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      return new Response(
        JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rate limit: cap regens per lead
    if (body.leadId) {
      const { data: lead } = await supabase
        .from("playbook_leads")
        .select("icp_regen_count, icp_generated")
        .eq("id", body.leadId)
        .maybeSingle();
      if (lead?.icp_regen_count != null && lead.icp_regen_count >= MAX_REGENS) {
        if (lead.icp_generated) {
          // Cached payloads might be in the legacy { icp: {...} } shape; normalize.
          const cached = lead.icp_generated as Record<string, unknown>;
          const out = Array.isArray(cached.icps)
            ? cached
            : { icps: [cached], fit_warning: null };
          return new Response(
            JSON.stringify({ ...out, cached: true, capped: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ error: "ICP regeneration limit reached" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const siteText = body.website ? await fetchSiteText(body.website) : "";
    const prompt = buildPrompt(body, siteText);

    const llmRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": PUBLIC_SITE_URL,
        "X-Title": "ACA Playbook ICP Generator",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You output strict JSON only. No markdown, no prose outside the JSON object." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 1400,
      }),
    });

    if (!llmRes.ok) {
      const text = await llmRes.text();
      console.error(`[generate-icp] OpenRouter ${llmRes.status}: ${text}`);
      return new Response(
        JSON.stringify({ error: "ICP generation failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const llmJson = await llmRes.json();
    const content = llmJson?.choices?.[0]?.message?.content || "";
    const result = safeParse(content);

    if (!result) {
      console.error("[generate-icp] failed to parse model output:", content.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Model returned malformed JSON" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.leadId) {
      const { data: cur } = await supabase
        .from("playbook_leads")
        .select("icp_regen_count")
        .eq("id", body.leadId)
        .maybeSingle();
      const nextCount = (cur?.icp_regen_count ?? 0) + 1;
      await supabase
        .from("playbook_leads")
        .update({ icp_regen_count: nextCount, icp_generated: result })
        .eq("id", body.leadId);
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[generate-icp] uncaught:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
