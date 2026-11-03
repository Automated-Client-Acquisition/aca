// ============================================================================
// sandbox-build
// ----------------------------------------------------------------------------
// Public, anonymous. Takes a website URL (+ optional LinkedIn), scrapes the
// homepage, and returns a real generated preview of what the workspace would
// look like - ICP, product, audit, sequence step 1, blueprint themes.
//
// No DB writes for the visitor. No auth. No user creation. Just a 15-20s
// pure-LLM preview the /sandbox page can animate.
//
// Cache hits are served from a sandbox_cache table keyed on a SHA-256 of
// the normalized website URL, with a 24h TTL. Second visitor to the same
// domain pays no LLM cost.
//
// Rate limit: per IP via sandbox_rate_limit table, 5 builds / hour.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import { fetchLinkedInProfile, profileForPrompt } from "../_shared/linkedin-profile-fetch.ts";
import { PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL_DEEP = "anthropic/claude-sonnet-4.5";
const MODEL_FAST = "anthropic/claude-haiku-4.5";

const CACHE_TTL_HOURS = 24;
const RATE_LIMIT_PER_HOUR = 5;

interface Payload {
  website: string;
  linkedinUrl?: string;
}

interface SandboxOutput {
  website: string;
  scrapedTitle: string;
  scrapedDescription: string;
  founderName: string;
  icp: {
    name: string; summary: string; industry: string; roles: string;
    pains: string[]; desires: string[]; language: string;
  };
  product: {
    name: string; description: string; category: string; features: string[];
  };
  audit: {
    overall: number; headline_score: number; about_score: number; banner_score: number; activity_score: number;
    headline_rewrite: string; about_rewrite: string; summary: string;
    recommendations: string[];
  } | null;
  sequence: {
    name: string;
    steps: Array<{ step: number; channel: string; delay_days: number; subject?: string; body: string }>;
  };
  blueprint: {
    name: string;
    themes: Array<{ theme: string; frequency: string; hook_pattern: string; example_post: string }>;
  };
  agentPreview: { name: string; toneTraits: string[] };
  strategyOpener: string;
  cached: boolean;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeUrl(u: string): string {
  return u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/^www\./, "");
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callLLM(openrouterKey: string, prompt: string, model: string, maxTokens = 1800, temperature = 0.65): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": PUBLIC_SITE_URL,
      "X-Title": "ACA Sandbox Build",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You output strict JSON when asked. Never wrap in fences. Never use 'leverage', 'unlock', 'unleash', 'game-changing', 'next-level', 'revolutionary', or AI-speak. Be specific to THIS seller's site." },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j?.choices?.[0]?.message?.content || "";
}

function parseJSON<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { return null; }
}

async function fetchSite(url: string): Promise<{ title: string; description: string; body: string }> {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(normalized, {
      headers: { "User-Agent": "Mozilla/5.0 ACA-Sandbox", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { title: "", description: "", body: "" };
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "";
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
              || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] || "";
    const body = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ").trim().slice(0, 6000);
    return { title, description: desc, body };
  } catch {
    return { title: "", description: "", body: "" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body: Payload = await req.json();
    if (!body.website) return json({ error: "website required" }, 400);
    const normalizedUrl = normalizeUrl(body.website);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}/.test(normalizedUrl)) return json({ error: "invalid url" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Rate limit by client IP ─────────────────────────────────────────────
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("sandbox_rate_limit")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .gte("created_at", since);
      if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
        return json({ error: `Rate limit reached (${RATE_LIMIT_PER_HOUR}/hour). Try /get-started for the real thing.` }, 429);
      }
      await supabase.from("sandbox_rate_limit").insert({ ip, website: normalizedUrl });
    }

    // ── Cache lookup ───────────────────────────────────────────────────────
    const cacheKey = await sha256(normalizedUrl + (body.linkedinUrl ? "|" + body.linkedinUrl : ""));
    const ttlCutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    const { data: hit } = await supabase
      .from("sandbox_cache")
      .select("payload, created_at")
      .eq("cache_key", cacheKey)
      .gte("created_at", ttlCutoff)
      .maybeSingle();
    if (hit?.payload) {
      const cached = hit.payload as SandboxOutput;
      return json({ ...cached, cached: true });
    }

    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openrouterKey) return json({ error: "OPENROUTER_API_KEY not configured" }, 500);

    // ── Scrape ─────────────────────────────────────────────────────────────
    const scraped = await fetchSite(normalizedUrl);
    const founderName = "the founder"; // we don't try to infer - would be wrong too often
    const siteBlock = `## Scraped from ${normalizedUrl}\nTitle: ${scraped.title}\nDescription: ${scraped.description}\nBody: ${scraped.body.slice(0, 4500)}`;

    // ── Parallel generation ────────────────────────────────────────────────
    // First we need ICP (so other prompts can target it). Then everything
    // else in parallel using the ICP context.

    const icpPrompt = `You are profiling the ideal buyer for the seller below. Give me a real human, not a persona template.

${siteBlock}

## Output - strict JSON only, no fences
{
  "name": "<vivid name + role, e.g. 'Élise the scaling SaaS CFO' or 'Marcus the over-it agency founder'>",
  "summary": "<2-3 sentences profiling this person: who they are, situation, real specifics>",
  "industry": "<one short phrase>",
  "roles": "<comma-separated job titles to target on LinkedIn>",
  "pains": ["<5 pains in their own words, quoted>"],
  "desires": ["<4 desires, outcome-language>"],
  "language": "<2-3 sentence note: how this person actually talks, what phrases they hate>"
}`;

    const icpRaw = await callLLM(openrouterKey, icpPrompt, MODEL_DEEP, 1500, 0.6);
    const icp = parseJSON<SandboxOutput["icp"]>(icpRaw);
    if (!icp?.name) return json({ error: "Could not profile your buyer - site scrape too thin. Try a more content-rich page." }, 500);

    const icpString = `Buyer: ${icp.name}\nSummary: ${icp.summary}\nKey pains: ${(icp.pains || []).slice(0, 4).join(" | ")}`;

    // Rest in parallel.
    const productPrompt = `Extract the seller's product in their own words.

${siteBlock}

## Output - strict JSON
{
  "name": "<exact product name>",
  "description": "<3-4 sentence pitch in their voice>",
  "category": "<one-word category>",
  "features": ["<5 specific features>"]
}`;

    const sequencePrompt = `Write the FIRST email of a 5-touch outbound sequence for this seller targeting their buyer.

## Buyer
${icpString}

## Seller
${siteBlock.slice(0, 1500)}

## Output - strict JSON
{
  "subject": "<sharp, lowercase, 4-6 words, conversational, NEVER 'Quick question' or 'Following up'>",
  "body": "<60-110 words, personal voice, ONE clear ask, opens with a SPECIFIC signal that references something concrete about the buyer (use {{specific_signal}} placeholder for the one variable the user fills in per prospect)>"
}`;

    const blueprintPrompt = `Design 3 weekly LinkedIn content themes for this seller. Each with a hook pattern + a real example post.

## Buyer
${icpString}

## Seller
${siteBlock.slice(0, 1500)}

## Output - strict JSON
{
  "themes": [
    { "theme": "<3-5 word label>", "frequency": "<e.g. 'Mon, Thu'>", "hook_pattern": "<the opening formula>", "example_post": "<150-220 word example post in seller's voice - specific numbers, no AI-slop, no emojis unless natural>" },
    { "theme": "<...>", "frequency": "<...>", "hook_pattern": "<...>", "example_post": "<...>" },
    { "theme": "<...>", "frequency": "<...>", "hook_pattern": "<...>", "example_post": "<...>" }
  ]
}`;

    // LinkedIn audit only if URL provided.
    const auditTask = (async () => {
      if (!body.linkedinUrl) return null;
      const profile = await fetchLinkedInProfile(supabase, body.linkedinUrl, null);
      if (!profile) return null;
      const auditPrompt = `Audit this LinkedIn profile for landing the buyer below. Score 0-10 per dimension. Give paste-ready rewrites.

## Buyer
${icpString}

## Profile
${profileForPrompt(profile)}

## Output - strict JSON
{
  "overall": <0-10>, "headline_score": <0-10>, "about_score": <0-10>, "banner_score": <0-10>, "activity_score": <0-10>,
  "headline_rewrite": "<220-char headline signaling buyer outcome>",
  "about_rewrite": "<1000-1400 char About section, hook-first, in seller's voice>",
  "summary": "<3-4 sentence summary of state of profile + what to fix first>",
  "recommendations": ["<5 ordered recs>"]
}`;
      const out = await callLLM(openrouterKey, auditPrompt, MODEL_FAST, 2200, 0.6);
      return parseJSON<SandboxOutput["audit"]>(out);
    })();

    const [productRaw, sequenceRaw, blueprintRaw, audit] = await Promise.all([
      callLLM(openrouterKey, productPrompt, MODEL_FAST, 1200, 0.5),
      callLLM(openrouterKey, sequencePrompt, MODEL_DEEP, 900, 0.7),
      callLLM(openrouterKey, blueprintPrompt, MODEL_FAST, 2200, 0.7),
      auditTask,
    ]);

    const product = parseJSON<SandboxOutput["product"]>(productRaw);
    const seqStep1 = parseJSON<{ subject?: string; body?: string }>(sequenceRaw);
    const blueprintJson = parseJSON<{ themes?: SandboxOutput["blueprint"]["themes"] }>(blueprintRaw);

    const output: SandboxOutput = {
      website: normalizedUrl,
      scrapedTitle: scraped.title,
      scrapedDescription: scraped.description,
      founderName,
      icp,
      product: product || {
        name: scraped.title || normalizedUrl,
        description: scraped.description || "Auto-extracted - edit me when you sign up.",
        category: "Service",
        features: [],
      },
      audit,
      sequence: {
        name: `${icp.name.split(" ")[0]} · sequence`,
        steps: seqStep1?.body ? [{
          step: 1, channel: "email", delay_days: 0,
          subject: seqStep1.subject || "quick context",
          body: seqStep1.body,
        }] : [],
      },
      blueprint: {
        name: `${normalizedUrl} · daily LinkedIn`,
        themes: blueprintJson?.themes || [],
      },
      agentPreview: {
        name: `Your reply agent`,
        toneTraits: ["Specific", "Numbers-driven", "Anti-fluff", "Opinionated"],
      },
      strategyOpener: `# 60-day plan\n\n## The bet\nYour ideal buyer (${icp.name}) is searchable on LinkedIn but ignoring generic outreach. Success at day 60 = 10+ qualified calls with people who match the profile above. We get there by speaking their pain in their language and showing up in the same feeds they read every morning.`,
      cached: false,
    };

    // Cache (24h TTL). Use upsert in case of race.
    await supabase.from("sandbox_cache").upsert({
      cache_key: cacheKey,
      website: normalizedUrl,
      payload: output,
      created_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });

    return json(output);
  } catch (e) {
    console.error("[sandbox-build] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
