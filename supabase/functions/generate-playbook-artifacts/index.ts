// ============================================================================
// generate-playbook-artifacts
// ----------------------------------------------------------------------------
// Token-gated, public. Replaces the placeholder rows seeded by
// provision-playbook-workspace with real, high-quality, in-the-user's-voice
// content. Each artifact gets a focused LLM call that knows about the user's
// website, ICP, niche, goal, and pains.
//
// Critical correctness rules baked in here:
//   * Each gen function FIRST looks up the specific placeholder row id and
//     THEN updates BY ID. Never `.update().eq().order().limit(1)` because
//     Postgres ignores the order/limit on UPDATE and silently overwrites
//     every matching row.
//   * Schema is verified once at write time - every column referenced here
//     actually exists in the live tables.
//   * Tasks that have no real backing table (the legacy `leadmagnet`) are
//     dropped rather than no-op'd, so the wizard's progress is honest.
//   * Sonnet is used for the high-stakes generations (ICP, sequence, agent,
//     strategy). Haiku stays for the cheaper structured pieces (content plan,
//     blueprint, audit) to keep total wall-clock under 90 seconds.
// ============================================================================

import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { verifyProvisioningToken } from "../_shared/provisioning-token.ts";
import { fetchLinkedInProfile, profileForPrompt } from "../_shared/linkedin-profile-fetch.ts";
import { playbookLinkedInBlueprintName } from "../_shared/playbook-linkedin-blueprint.ts";
import { APP_URL, OPS_ALERT_EMAIL, PUBLIC_SITE_URL, fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL_DEEP = "anthropic/claude-sonnet-4.5";   // high-stakes outputs
const MODEL_FAST = "anthropic/claude-haiku-4.5";    // structured, cheaper

interface Payload {
  provisioningToken: string;
}

interface IcpRow {
  id: string;
  name: string;
  summary: string;
  industry?: string;
  roles?: string;
  pains: string[];
  desires: string[];
  objections: string[];
  language?: string;
  label?: string;
  role?: "primary_buyer" | "secondary_buyer";
}

interface JobContext {
  jobId: string;
  orgId: string;
  niche?: string;
  outcome?: string;
  playbookSlug?: string;
  fullName?: string;
  email?: string;
  icps: IcpRow[];
  website?: string;
  linkedinUrl?: string;
  biggestNeed?: string;
  whatTried?: string;
  goal?: string;
  scrapedSite?: string;
}

async function callLLM(openrouterKey: string, prompt: string, opts: { model?: string; maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const model = opts.model || MODEL_DEEP;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": PUBLIC_SITE_URL,
      "X-Title": "ACA Onboarding Artifact Generator",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You output strict JSON when asked, or clean prose otherwise. Never wrap output in markdown fences. Match the seller's voice - be specific, never use 'leverage', 'unlock', 'unleash', 'game-changing', 'next-level', 'revolutionary', or any AI-speak. Never use an em dash or an en dash - use a plain hyphen, a comma, or a full stop instead; em dashes read as AI-written and this copy goes out to real prospects. Quote real things from their site when you can." },
        { role: "user", content: prompt },
      ],
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens || 2000,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content || "";
}

function safeParseJSON<T = unknown>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { return null; }
}

function icpToString(icp: IcpRow): string {
  return `Label: ${icp.label || icp.name}
Industry: ${icp.industry || "unspecified"}
Roles: ${icp.roles || ""}
Summary: ${icp.summary || ""}
Key pains: ${(icp.pains || []).slice(0, 5).join(" | ")}
Key desires: ${(icp.desires || []).slice(0, 4).join(" | ")}
Language style: ${icp.language || ""}`;
}

// Atomic - does the read-modify-write as one Postgres statement (see
// migration 20260909141000) instead of JS read-then-write, so concurrent
// tasks finishing close together can't clobber each other's status update.
async function markTask(supabase: SupabaseClient<any>, jobId: string, key: string, status: string) {
  const { error } = await supabase.rpc("update_provisioning_task_status", {
    p_job_id: jobId,
    p_task_key: key,
    p_status: status,
  });
  if (error) {
    console.error(`[generate-playbook-artifacts] markTask(${key}, ${status}) failed:`, error);
  }
}

// ─── Website scrape ────────────────────────────────────────────────────────
async function fetchWebsiteText(url: string): Promise<string> {
  if (!url) return "";
  // A slow / blocking customer homepage used to hang the entire onboarding
  // job (no timeout → 60s+ before the Edge runtime killed the request, by
  // which time the browser had already given up). Cap at 8s, fall back to
  // empty scrape so downstream LLMs still run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(normalized, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ACA-Onboarding/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Pull meta description + title separately so the LLM has hooks.
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                   || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
    const title = titleMatch?.[1]?.trim() || "";
    const desc = descMatch?.[1]?.trim() || "";
    const body = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 7000);
    return [title ? `# ${title}` : "", desc ? `> ${desc}` : "", body].filter(Boolean).join("\n\n");
  } catch (e) {
    console.warn("[fetchWebsiteText] failed:", e);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Context loader ────────────────────────────────────────────────────────
async function loadContext(supabase: SupabaseClient<any>, jobId: string, orgId: string): Promise<JobContext> {
  const { data: job } = await supabase
    .from("provisioning_jobs")
    .select("playbook_slug, lead_id")
    .eq("id", jobId)
    .maybeSingle();

  let lead: Record<string, unknown> | null = null;
  if (job?.lead_id) {
    const { data: l } = await supabase
      .from("playbook_leads")
      .select("full_name, email, niche, outcome, website, linkedin_url, biggest_need, what_tried")
      .eq("id", job.lead_id)
      .maybeSingle();
    lead = l;
  }

  // ICPs already in the org. May only be the placeholder we inserted at provision.
  const { data: rows } = await supabase
    .from("library_icps")
    .select("id, name, summary, pain_points, desires, objections, language_style, target_title_keywords, tags")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  const icps: IcpRow[] = (rows || []).map((r) => {
    const tags = (r.tags as string[]) || [];
    const labelTag = tags.find((t) => t.startsWith("label:"));
    const role: "primary_buyer" | "secondary_buyer" =
      tags.includes("secondary_buyer") ? "secondary_buyer" : "primary_buyer";
    return {
      id: r.id as string,
      name: (r.name as string) || "",
      summary: (r.summary as string) || "",
      roles: ((r.target_title_keywords as string[]) || []).join(", "),
      pains: (r.pain_points as string[]) || [],
      desires: (r.desires as string[]) || [],
      objections: (r.objections as string[]) || [],
      language: (r.language_style as string) || "",
      label: labelTag ? labelTag.replace("label:", "") : (role === "secondary_buyer" ? "Secondary buyer" : "Primary buyer"),
      role,
    };
  });

  const website = lead?.website as string | undefined;
  const scrapedSite = website ? await fetchWebsiteText(website) : "";

  return {
    jobId,
    orgId,
    niche: lead?.niche as string | undefined,
    outcome: lead?.outcome as string | undefined,
    playbookSlug: job?.playbook_slug as string | undefined,
    fullName: lead?.full_name as string | undefined,
    email: lead?.email as string | undefined,
    icps,
    website,
    linkedinUrl: lead?.linkedin_url as string | undefined,
    biggestNeed: lead?.biggest_need as string | undefined,
    whatTried: lead?.what_tried as string | undefined,
    goal: lead?.outcome as string | undefined,
    scrapedSite,
  };
}

// ─── Helpers to fetch the latest placeholder row id ────────────────────────
async function latestRowId(supabase: SupabaseClient<any>, table: string, orgId: string, extra?: Record<string, unknown>): Promise<string | null> {
  let q = supabase.from(table).select("id").eq("organization_id", orgId);
  if (extra) for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.id as string) || null;
}

// ─── GENERATORS ────────────────────────────────────────────────────────────

async function genICP(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const id = await latestRowId(supabase, "library_icps", ctx.orgId);
  if (!id) throw new Error("No ICP placeholder row");

  const scrapeBlock = ctx.scrapedSite
    ? `## Their homepage\n${ctx.scrapedSite.slice(0, 4000)}`
    : `## (No homepage scrape available - infer from their goal + niche)`;

  const prompt = `You are profiling the IDEAL BUYER for a seller. Be specific - give me a real human, not a persona template.

## Seller
Name: ${ctx.fullName || "the founder"}
Website: ${ctx.website || "(none)"}
What they want: ${ctx.goal || ctx.outcome || "grow"}
What's broken for them right now: ${ctx.biggestNeed || "(unknown)"}

${scrapeBlock}

## Output - strict JSON, no fences, no commentary
{
  "name": "<a vivid name + role, e.g. 'Marcus the Series A CMO' or 'Sarah the bootstrapped agency owner'>",
  "summary": "<2-3 sentences profiling this person: who they are, what they do, the situation they're in. Specific.>",
  "industry": "<one short phrase>",
  "roles": "<comma-separated job titles to target on LinkedIn, e.g. 'Head of Marketing, VP Growth, CMO'>",
  "pain_points": ["<pain 1 in their words - quote them>", "<pain 2>", "<pain 3>", "<pain 4>", "<pain 5>"],
  "desires": ["<what they really want, outcome-language>", "<desire 2>", "<desire 3>", "<desire 4>"],
  "objections": ["<what they'd push back on>", "<objection 2>", "<objection 3>"],
  "language_style": "<2-3 sentence note: how this person talks, what phrases they use, what they hate hearing>"
}`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_DEEP, maxTokens: 1800 });
  const parsed = safeParseJSON<{
    name?: string; summary?: string; industry?: string; roles?: string;
    pain_points?: string[]; desires?: string[]; objections?: string[]; language_style?: string;
  }>(out);
  if (!parsed?.name) throw new Error("ICP generation returned no name");

  await supabase.from("library_icps").update({
    name: parsed.name,
    summary: parsed.summary || null,
    description: parsed.summary || null,
    pain_points: parsed.pain_points || [],
    desires: parsed.desires || [],
    objections: parsed.objections || [],
    language_style: parsed.language_style || null,
    target_title_keywords: (parsed.roles || "").split(",").map((s) => s.trim()).filter(Boolean),
    tags: ["from_playbook", "onboarding", ctx.playbookSlug].filter(Boolean) as string[],
  }).eq("id", id);

  // Refresh ICP in ctx so downstream tasks (sequence, agent, etc) use the
  // real profile instead of the placeholder.
  ctx.icps = [{
    id,
    name: parsed.name,
    summary: parsed.summary || "",
    industry: parsed.industry,
    roles: parsed.roles,
    pains: parsed.pain_points || [],
    desires: parsed.desires || [],
    objections: parsed.objections || [],
    language: parsed.language_style,
    label: "Primary buyer",
    role: "primary_buyer",
  }];
}

async function genProduct(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const id = await latestRowId(supabase, "library_products", ctx.orgId);
  if (!id) return; // no placeholder, skip

  const scrapeBlock = ctx.scrapedSite
    ? `## Scraped from ${ctx.website}\n${ctx.scrapedSite.slice(0, 5000)}`
    : `## No site scrape available - infer from niche + goal\nNiche: ${ctx.niche}\nGoal: ${ctx.goal}`;

  const prompt = `Extract the seller's OWN product/service in their own words. Don't generalize. Don't describe what ACA does - describe what THEY sell.

${scrapeBlock}

## Output - strict JSON only
{
  "name": "<exact product/service name from the site, e.g. 'Acquist OÜ' or 'The Audit Engine'>",
  "description": "<3-4 sentence pitch as if the seller wrote it, in their voice, with their specific positioning>",
  "category": "<one-word category, e.g. 'Agency', 'SaaS', 'Coaching', 'Course'>",
  "features": ["<feature 1, specific to their offer>", "<feature 2>", "<feature 3>", "<feature 4>", "<feature 5>"],
  "key_benefits": ["<the outcome they help customers achieve>", "<benefit 2>", "<benefit 3>"]
}

If the scrape is empty / generic, write a thoughtful placeholder description that says explicitly 'we couldn't fully scrape your site - please edit this with your real positioning' and use the niche as the name fallback. Never invent customers, prices, or testimonials.`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_FAST, maxTokens: 1400 });
  const parsed = safeParseJSON<{
    name?: string; description?: string; category?: string; features?: string[]; key_benefits?: string[];
  }>(out);
  if (!parsed?.name) throw new Error("Product generation failed");

  await supabase.from("library_products").update({
    name: parsed.name,
    description: parsed.description || null,
    category: parsed.category || null,
    features: parsed.features || null,
    key_benefits: parsed.key_benefits || null,
  }).eq("id", id);
}

async function genKnowledge(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const { data: row } = await supabase
    .from("library_strategy_documents")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("document_type", "knowledge")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.id) return;

  const scrapeBlock = ctx.scrapedSite
    ? `## Scraped from ${ctx.website}\n${ctx.scrapedSite.slice(0, 4500)}`
    : "## No site scrape";

  const prompt = `Write 3 knowledge-base sections the seller's AI reply agent will read before responding to prospects. Concrete, specific to this seller. No generic boilerplate.

## Seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
Their main goal: ${ctx.outcome || "growth"}
What hurts most: ${ctx.biggestNeed || "(unknown)"}

${scrapeBlock}

## Output: markdown only, exactly these three H2 sections:

## Offer summary
<180-250 words: what they sell, who for, the headline price/structure if visible, what makes their positioning different. Quote real phrases from the site.>

## Voice & tone
<120-180 words: their actual writing style - formal/casual, signature phrases they use, words they avoid. What they sound like in a sales call vs in marketing copy.>

## Social proof
<100-150 words: real proof signals visible on the site (case studies, names, numbers, logos, awards). If none are visible, say so plainly: "No proof yet - agent must NEVER invent stats, customer names, or testimonials.">`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_DEEP, maxTokens: 1800 });
  if (!out || out.length < 200) throw new Error("Knowledge generation too short");

  await supabase.from("library_strategy_documents").update({
    name: "Knowledge base · core",
    content: out.trim(),
    tags: ["onboarding", "knowledge"],
  }).eq("id", row.id);
}

async function genAudit(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  if (!ctx.linkedinUrl) return;
  const id = await latestRowId(supabase, "linkedin_audits", ctx.orgId);
  if (!id) return;

  // Try Unipile (instant if connected) → Apify (platform token) → graceful skip.
  const profile = await fetchLinkedInProfile(supabase, ctx.linkedinUrl, ctx.orgId);

  if (!profile) {
    // Couldn't fetch - mark the audit row as 'skipped' with a clear note so
    // the user understands why it's empty and what to do about it.
    await supabase.from("linkedin_audits").update({
      status: "skipped",
      summary: "We couldn't pull your LinkedIn profile right now. Connect your LinkedIn account from settings and we'll run the audit live - usually in under 30 seconds.",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return;
  }

  const profileBlock = `## Profile data (via ${profile.source})\n${profileForPrompt(profile)}`;

  const targetIcp = ctx.icps[0];
  const prompt = `Audit this LinkedIn profile for a seller trying to land their ideal buyer. Score each dimension 0-10. Give a concrete headline + About rewrite they can paste in.

## The seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
Buyer they want to reach: ${targetIcp?.name || targetIcp?.label || "primary buyer"}
Outcome they sell: ${ctx.outcome || ctx.goal || "growth"}

${profileBlock}

## Output - strict JSON only
{
  "headline_score": <0-10>,
  "about_score": <0-10>,
  "banner_score": <0-10>,
  "activity_score": <0-10>,
  "overall_score": <0-10>,
  "headline_rewrite": "<220-char LinkedIn headline that signals the ICP outcome. No emojis unless their existing voice has them.>",
  "about_rewrite": "<1200-1500 char About section. Hook in line 1. Story in middle. Clear CTA at end. Use the seller's actual voice.>",
  "recommendations": [
    "<rec 1: most important first>",
    "<rec 2>",
    "<rec 3>",
    "<rec 4>",
    "<rec 5>"
  ],
  "summary": "<3-4 sentences: where the profile stands today and what to fix first to land more meetings.>"
}`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_FAST, maxTokens: 2400 });
  const parsed = safeParseJSON<{
    headline_score?: number; about_score?: number; banner_score?: number; activity_score?: number; overall_score?: number;
    headline_rewrite?: string; about_rewrite?: string; recommendations?: string[]; summary?: string;
  }>(out);
  if (!parsed) throw new Error("Audit generation failed: non-JSON response");
  // Insist on at least some real content - otherwise the row stays
  // 'pending' and the user gets a clear "we couldn't audit that URL" state.
  if (!parsed.about_rewrite || !parsed.headline_rewrite || parsed.overall_score == null) {
    throw new Error("Audit generation returned empty fields (probable inaccessible profile)");
  }

  const { error: updErr } = await supabase.from("linkedin_audits").update({
    profile_snapshot: (profile.raw || {}) as Record<string, unknown>,
    headline_score: parsed.headline_score ?? null,
    about_score: parsed.about_score ?? null,
    banner_score: parsed.banner_score ?? null,
    activity_score: parsed.activity_score ?? null,
    overall_score: parsed.overall_score,
    headline_rewrite: parsed.headline_rewrite,
    about_rewrite: parsed.about_rewrite,
    recommendations: parsed.recommendations || [],
    summary: parsed.summary ?? null,
    status: "done",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (updErr) throw new Error(`Audit DB update failed: ${updErr.message}`);
}

async function genSequence(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const id = await latestRowId(supabase, "email_sequences", ctx.orgId);
  if (!id) return;
  if (ctx.icps.length === 0) throw new Error("No ICP to target");

  const icp = ctx.icps[0];
  const prompt = `Write a 5-touch outbound sequence (email + LinkedIn). Mix channels for breakthrough. Make it sound like a human who actually understands the buyer's pain.

## Seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
What they sell: ${ctx.outcome || "growth"}

## Buyer (target)
${icpToString(icp)}

## Rules
- Subject lines: 4-6 words, lowercase, conversational. NEVER use "Quick question", "Following up", or anything corporate.
- Bodies: 60-110 words each. Personal voice. ONE clear ask per message. No "Hope you're well".
- Use ${icp.label || "their"} actual pain language ("nobody replies", "stuck at $X", etc.) - not abstract pain.
- Touch 1 must reference something specific that signals you researched THEM (placeholder: "{specific_signal}").

## Output - strict JSON only
{
  "name": "<sequence name including the ICP label>",
  "steps": [
    { "step": 1, "channel": "email",    "delay_days": 0, "subject": "<sharp subject>", "body": "<email 1 - opens with the signal>" },
    { "step": 2, "channel": "linkedin", "delay_days": 2, "body": "<connection request msg, max 280 chars, no link>" },
    { "step": 3, "channel": "email",    "delay_days": 4, "subject": "<follow-up subject>", "body": "<email 2 - reframe with one specific proof angle>" },
    { "step": 4, "channel": "linkedin", "delay_days": 6, "body": "<post-connection DM, 500-600 chars, light + direct>" },
    { "step": 5, "channel": "email",    "delay_days": 9, "subject": "<break-up subject>", "body": "<final email - soft close, gives them an out>" }
  ]
}`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_DEEP, maxTokens: 2800 });
  const parsed = safeParseJSON<{ name?: string; steps?: unknown[] }>(out);
  if (!parsed?.steps?.length) throw new Error("Sequence generation returned no steps");

  await supabase.from("email_sequences").update({
    name: parsed.name || `${icp.label} · 5-touch sequence`,
    steps: parsed.steps,
    status: "draft",
  }).eq("id", id);
}

async function genBlueprint(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const id = await latestRowId(supabase, "blueprints", ctx.orgId);
  if (!id) return;

  const icp = ctx.icps[0];
  const prompt = `Design a daily LinkedIn content cadence for the seller below. 3 themes, each with a hook pattern + an example post.

## Seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
Outcome: ${ctx.outcome || "growth"}
Voice: ${icp?.language || "professional but human"}

## Buyer reading this
${icp ? icpToString(icp) : "(no ICP)"}

## Output - strict JSON only
{
  "name": "<blueprint name>",
  "themes": [
    {
      "theme": "<3-5 word theme label>",
      "frequency": "<e.g. 'Mon, Wed'>",
      "hook_pattern": "<the opening-line formula in 1 sentence>",
      "example_post": "<150-220 word example post in the seller's voice - DON'T use emojis unless natural. Real specifics, no AI slop.>"
    },
    { "theme": "<...>", "frequency": "<...>", "hook_pattern": "<...>", "example_post": "<...>" },
    { "theme": "<...>", "frequency": "<...>", "hook_pattern": "<...>", "example_post": "<...>" }
  ],
  "publishing_rhythm": "<2-sentence guidance on how to actually ship this every week without burning out>"
}`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_FAST, maxTokens: 2400 });
  const parsed = safeParseJSON<{ name?: string; themes?: unknown[]; publishing_rhythm?: string }>(out);
  if (!parsed?.themes?.length) throw new Error("Blueprint generation returned no themes");

  // blueprints table: use `structure` (jsonb), not `config` (which doesn't
  // exist). `description` IS a real column, keep using it. Merge into
  // structure rather than replace it: structure.slots (set at provision) is
  // what /create fills in when running the blueprint.
  const { data: current } = await supabase.from("blueprints").select("structure").eq("id", id).maybeSingle();
  await supabase.from("blueprints").update({
    name: parsed.name || playbookLinkedInBlueprintName(ctx.niche),
    description: parsed.publishing_rhythm || "3-theme weekly cadence. Auto-publishes when approved.",
    structure: {
      ...((current?.structure as Record<string, unknown>) || {}),
      themes: parsed.themes,
      publishing_rhythm: parsed.publishing_rhythm,
    } as Record<string, unknown>,
  }).eq("id", id);
}

async function genContentPlan(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const { data: row } = await supabase
    .from("library_strategy_documents")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("document_type", "content_plan")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.id) return;

  const icp = ctx.icps[0];
  const prompt = `Write a 30-day LinkedIn content plan as Markdown. 3 themes, rotating across weekdays.

## Seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
Goal: ${ctx.outcome || ctx.goal || "book sales calls"}

## Buyer
${icp ? icpToString(icp) : "(no ICP)"}

## Output - Markdown only, exactly this shape:
# 30-day content plan

## Themes
1. **<theme A name>** - <why it pulls the ICP>
2. **<theme B>** - <...>
3. **<theme C>** - <...>

## Calendar
| Day | Theme | Post angle |
|-----|-------|------------|
| 1   | A     | <specific angle, 1 line>  |
| 2   | B     | <...> |
... (all 30 days, rest day every 7th)

## Hook formulas to recycle
- <pattern 1, with example>
- <pattern 2, with example>
- <pattern 3, with example>`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_FAST, maxTokens: 3200 });
  if (!out || out.length < 300) throw new Error("Content plan too short");

  await supabase.from("library_strategy_documents").update({
    name: "30-day content plan",
    content: out.trim(),
    tags: ["onboarding", "content_plan"],
  }).eq("id", row.id);
}

async function genCampaign(supabase: SupabaseClient<any>, ctx: JobContext) {
  const id = await latestRowId(supabase, "linkedin_campaigns", ctx.orgId);
  if (!id) return;

  // Mirror the email_sequences linkedin steps into a xyflow graph.
  const { data: seq } = await supabase
    .from("email_sequences")
    .select("steps")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const steps = (seq?.steps as Array<Record<string, unknown>>) || [];
  const liSteps = steps.filter((s) => (s.channel as string) === "linkedin");

  const nodes: Array<Record<string, unknown>> = [
    { id: "n_start",   type: "start",              position: { x: 0, y: 0 },   data: { label: "Start" } },
    { id: "n_connect", type: "connectionRequest",  position: { x: 0, y: 120 }, data: { message: (liSteps[0]?.body as string) || "Hi - saw your work in our space, would love to connect." } },
    { id: "n_wait1",   type: "delay",              position: { x: 0, y: 240 }, data: { days: 2 } },
    { id: "n_msg1",    type: "message",            position: { x: 0, y: 360 }, data: { message: (liSteps[1]?.body as string) || "Thanks for connecting! Quick reason I reached out…" } },
    { id: "n_wait2",   type: "delay",              position: { x: 0, y: 480 }, data: { days: 3 } },
    { id: "n_msg2",    type: "message",            position: { x: 0, y: 600 }, data: { message: "Following up - happy to share the framework if useful." } },
    { id: "n_switch",  type: "switchChannel",      position: { x: 0, y: 720 }, data: { to: "email" } },
    { id: "n_end",     type: "end",                position: { x: 0, y: 840 }, data: {} },
  ];
  const edges: Array<Record<string, unknown>> = [
    { id: "e1", source: "n_start",   target: "n_connect" },
    { id: "e2", source: "n_connect", target: "n_wait1" },
    { id: "e3", source: "n_wait1",   target: "n_msg1" },
    { id: "e4", source: "n_msg1",    target: "n_wait2" },
    { id: "e5", source: "n_wait2",   target: "n_msg2" },
    { id: "e6", source: "n_msg2",    target: "n_switch" },
    { id: "e7", source: "n_switch",  target: "n_end" },
  ];

  await supabase.from("linkedin_campaigns").update({
    name: `${ctx.niche || ctx.goal || "Outbound"} · LinkedIn campaign`,
    description: "Connect → 2d wait → DM → 3d wait → DM → switch to email. Edit before activating.",
    sequence_nodes: nodes,
    sequence_edges: edges,
  }).eq("id", id);
}

async function genAgent(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const id = await latestRowId(supabase, "ai_agent_profiles", ctx.orgId);
  if (!id) return;

  const icp = ctx.icps[0];
  const prompt = `Write the system prompt + tone profile for an AI reply agent that sounds like the seller. The agent qualifies inbound replies (from outbound + inbound) and drafts responses in the inbox.

## Seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
Outcome they sell: ${ctx.outcome || "growth"}
Voice notes: ${icp?.language || "professional + human"}

## Buyer
${icp ? icpToString(icp) : "(no ICP)"}

## Output - strict JSON only
{
  "name": "<agent name like '${ctx.fullName?.split(" ")[0] || "Founder"}'s Reply Agent'>",
  "description": "<one-line role description>",
  "system_prompt": "<400-600 word system prompt the LLM will follow on every reply. Cover: identity, when to qualify, when to escalate, never-do list, signature phrases.>",
  "tone_traits": ["<trait 1>", "<trait 2>", "<trait 3>", "<trait 4>"],
  "escalation_triggers": [
    "<trigger 1 - what makes the agent hand off to the human>",
    "<trigger 2>",
    "<trigger 3>",
    "<trigger 4>"
  ],
  "never_say": ["<bad phrase 1>", "<bad phrase 2>", "<bad phrase 3>"]
}`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_DEEP, maxTokens: 2400 });
  const parsed = safeParseJSON<{
    name?: string; description?: string; system_prompt?: string;
    tone_traits?: string[]; escalation_triggers?: string[]; never_say?: string[];
  }>(out);
  if (!parsed?.system_prompt) throw new Error("Agent generation failed");

  await supabase.from("ai_agent_profiles").update({
    name: parsed.name || `${ctx.fullName?.split(" ")[0] || "Your"} Reply Agent`,
    description: parsed.description || "Drafts replies, qualifies prospects, escalates to you.",
    // Write the canonical AutopilotConfig shape the engine + UI consume
    // (enabled / rules / conversation_goal / system_instructions / escalation_rules)
    // while preserving the playbook-specific fields (system_prompt, tone_traits, ...)
    // for reference. Default to drafting-for-approval - require_approval stays true,
    // so nothing auto-sends until the seller flips the toggle in the agent settings.
    config: {
      enabled: true,
      require_approval: true,
      max_auto_replies: 10,
      max_conversation_turns: 10,
      use_tone_profile: true,
      conversation_goal: `Qualify the reply and move ${ctx.fullName?.split(" ")[0] || "the seller"}'s genuine prospects toward booking a call.`,
      system_instructions: parsed.system_prompt,
      rules: [
        { intent: "interested", action: "auto_reply" },
        { intent: "neutral", action: "auto_reply" },
        { intent: "not_interested", action: "auto_reply" },
        { intent: "out_of_office", action: "auto_followup_after_return" },
        { intent: "meeting_booked", action: "auto_reply" },
      ],
      escalation_rules: [
        { condition: "explicit_request" },
        { condition: "max_turns" },
        { condition: "custom_keyword", keywords: ["cancel", "refund", "lawsuit", "legal", "complaint"] },
      ],
      // Playbook-specific reference fields (not consumed by the engine directly)
      system_prompt: parsed.system_prompt,
      tone_traits: parsed.tone_traits || [],
      escalation_triggers: parsed.escalation_triggers || [],
      never_say: parsed.never_say || [],
    } as Record<string, unknown>,
  }).eq("id", id);
}

async function genStrategy(supabase: SupabaseClient<any>, ctx: JobContext, openrouterKey: string) {
  const { data: row } = await supabase
    .from("library_strategy_documents")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("document_type", "strategy")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.id) return;

  const icp = ctx.icps[0];
  const prompt = `Write a 60-day go-to-market strategy doc for the seller. Specific, opinionated, action-led. Markdown.

## Seller
Name: ${ctx.fullName || "the founder"}
Niche: ${ctx.niche || "B2B services"}
Outcome in 60 days: ${ctx.outcome || "first 10 customers"}
What they tried: ${ctx.whatTried || "(unspecified)"}
What's broken: ${ctx.biggestNeed || "(unspecified)"}

## Buyer
${icp ? icpToString(icp) : "(no ICP)"}

## Output - Markdown only, exact structure:
# 60-day plan: ${ctx.outcome || "your goal"}

## The bet
<2-3 sentences: what this plan is wagering on, why now, what success looks like at day 60.>

## Days 1-14: Foundation
- <bullet>
- ...

## Days 15-30: First contact
- <bullets with specific channels + target counts>

## Days 31-45: Conversion
- <bullets focused on signal-to-meeting>

## Days 46-60: Compound
- <bullets - what they should be feeding back into the system>

## Daily rhythm
<3-5 bullets describing the 90-min daily commitment>

## What to kill if it isn't working
<3 leading indicators with specific thresholds: "If by day 14 reply rate is under X%, kill Y.">`;

  const out = await callLLM(openrouterKey, prompt, { model: MODEL_DEEP, maxTokens: 3200 });
  if (!out || out.length < 400) throw new Error("Strategy generation too short");

  await supabase.from("library_strategy_documents").update({
    name: `${ctx.outcome || "60-day plan"} · strategy`,
    content: out.trim(),
    tags: ["onboarding", "strategy"],
  }).eq("id", row.id);
}

// ─── Starter lead list ─────────────────────────────────────────────────────
// Everything above this point produces strategy. This produces PROSPECTS -
// the difference between handing someone a plan and handing them a machine.
// We pull live buying signals from the public Signals feed, have the model
// pick the ones that actually fit the ICP we just wrote, and materialise them
// as a real lead list so the user lands in a workspace that already has
// someone to talk to.
const STARTER_LIST_SIZE = 25;
// Pool is wide because only ~40% of fresh signals have a known decision-maker,
// and a company without one is a target, not a prospect.
const SIGNAL_POOL_SIZE = 250;

interface SignalRow {
  id: string;
  company_name: string;
  domain: string | null;
  country: string | null;
  location: string | null;
  signal_type: string;
  title: string | null;
  summary: string | null;
  why_it_matters: string | null;
  company_linkedin_url: string | null;
  signal_date: string | null;
}

interface SignalPerson {
  company_key: string;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  seniority_rank: number | null;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// public_signal_people is scraped for a public teaser, so it carries noise a
// prospect list can't: media accounts with headline-as-title ("Your daily byte
// of technology"), advisors who don't hold a budget, and people whose headline
// names a different employer than the signal company. A wrong name in a cold
// email is worse than a missing one, so be strict and take fewer.
const DECISION_MAKER_TITLE = /\b(founder|co-?founder|ceo|cto|coo|cfo|cro|cmo|chief|owner|president|partner|vp|vice president|head of|director|managing)\b/i;
const NOT_A_BUYER = /\b(advisor|advisory|board member|board of|intern|student|assistant|freelance|content creator)\b/i;

function isUsableDecisionMaker(p: SignalPerson, companyName: string): boolean {
  const title = (p.title || "").trim();
  if (!title || title.length > 90) return false;          // headline, not a title
  if (!DECISION_MAKER_TITLE.test(title)) return false;
  if (NOT_A_BUYER.test(title)) return false;
  if (!p.full_name || p.full_name.trim().split(/\s+/).length < 2) return false;
  // Headline naming a different employer => the company match is wrong.
  const at = title.match(/(?:@|\bat\b)\s+([A-Za-z0-9&.\- ]{2,40})/i);
  if (at) {
    const claimed = at[1].trim().toLowerCase();
    const actual = companyName.toLowerCase();
    if (!claimed.includes(actual) && !actual.includes(claimed.split(/\s+/)[0])) return false;
  }
  return true;
}

async function genStarterLeads(
  supabase: SupabaseClient<any>,
  ctx: JobContext,
  openrouterKey: string,
) {
  const icp = ctx.icps[0];

  // Fresh, published, verified-ish signals only. Recency matters more than
  // anything here - a funding round from 6 weeks ago is not "in-market".
  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
  const { data: pool } = await supabase
    .from("public_signals")
    .select("id, company_name, domain, country, location, signal_type, title, summary, why_it_matters, company_linkedin_url, signal_date")
    .eq("published", true)
    .gte("signal_date", since)
    .order("signal_date", { ascending: false })
    .limit(SIGNAL_POOL_SIZE);

  const allCandidates = (pool || []) as SignalRow[];
  if (!allCandidates.length) throw new Error("No fresh public signals to build a starter list from");

  // A company is not a prospect. The sequence needs a person with an email and
  // the LinkedIn campaign needs a person's profile, so only companies where we
  // already know a decision-maker can go in the list - the rest are a target
  // list the user still can't send to. public_signal_people is populated from
  // our own account for the public /signals teaser, so this costs nothing.
  const companyKeys = [...new Set(allCandidates.map((s) => s.company_name.toLowerCase()))];
  const { data: peopleRows } = await supabase
    .from("public_signal_people")
    .select("company_key, full_name, title, linkedin_url, seniority_rank")
    .in("company_key", companyKeys);

  const companyNameByKey = new Map(allCandidates.map((s) => [s.company_name.toLowerCase(), s.company_name]));
  const bestPersonByKey = new Map<string, SignalPerson>();
  for (const p of (peopleRows || []) as SignalPerson[]) {
    if (!p.linkedin_url) continue;
    if (!isUsableDecisionMaker(p, companyNameByKey.get(p.company_key) || "")) continue;
    const cur = bestPersonByKey.get(p.company_key);
    // Lower seniority_rank = more senior. Nulls sort last.
    const rank = p.seniority_rank ?? 999;
    if (!cur || rank < (cur.seniority_rank ?? 999)) bestPersonByKey.set(p.company_key, p);
  }

  const candidates = allCandidates.filter((s) => bestPersonByKey.has(s.company_name.toLowerCase()));
  if (!candidates.length) throw new Error("No fresh signals with a known decision-maker");

  // Ask the model to rank for THIS buyer. Cheap model, tiny payload - this is
  // a relevance filter, not a writing task. Falls back to plain recency so a
  // model hiccup still leaves the user with prospects.
  let chosen: SignalRow[] = [];
  try {
    const menu = candidates.map((s, i) => {
      const p = bestPersonByKey.get(s.company_name.toLowerCase());
      return `${i}. ${s.company_name} | ${s.signal_type} | ${s.country || s.location || "?"} | contact: ${p?.full_name}${p?.title ? ` (${p.title})` : ""} | ${(s.title || s.summary || "").slice(0, 110)}`;
    }).join("\n");

    const prompt = `Pick the ${STARTER_LIST_SIZE} companies from this list that best match the buyer profile below. These are live buying signals - the seller is about to do outreach to them.

## The buyer we are targeting
${icpToString(icp)}

## What the seller sells
${ctx.scrapedSite ? ctx.scrapedSite.slice(0, 1200) : ctx.niche || "B2B services"}

## Candidates
${menu}

Return STRICT JSON only, no prose:
{"picks":[{"i":<index>,"why":"<one short line on why this company is worth contacting now>"}]}

Rules:
- Exactly ${STARTER_LIST_SIZE} picks if there are that many plausible ones, fewer only if the list genuinely can't support it.
- Prefer companies where the signal implies budget or urgency for what this seller sells.
- Never pick the same company twice.`;

    const out = await callLLM(openrouterKey, prompt, { model: MODEL_FAST, maxTokens: 1400, temperature: 0.3 });
    const parsed = safeParseJSON<{ picks?: Array<{ i: number; why?: string }> }>(out);
    const seen = new Set<string>();
    for (const p of parsed?.picks || []) {
      const s = candidates[p.i];
      if (!s || seen.has(s.company_name.toLowerCase())) continue;
      seen.add(s.company_name.toLowerCase());
      chosen.push({ ...s, why_it_matters: p.why || s.why_it_matters });
      if (chosen.length >= STARTER_LIST_SIZE) break;
    }
  } catch (e) {
    console.warn("[generate-playbook-artifacts] signal ranking failed, falling back to recency:", e);
  }

  if (chosen.length < 5) {
    const seen = new Set(chosen.map((c) => c.company_name.toLowerCase()));
    for (const s of candidates) {
      if (seen.has(s.company_name.toLowerCase())) continue;
      seen.add(s.company_name.toLowerCase());
      chosen.push(s);
      if (chosen.length >= STARTER_LIST_SIZE) break;
    }
  }

  // Don't re-add people the org already has.
  const personUrls = chosen
    .map((s) => bestPersonByKey.get(s.company_name.toLowerCase())?.linkedin_url)
    .filter(Boolean) as string[];
  const { data: existing } = personUrls.length
    ? await supabase
        .from("crm_contacts")
        .select("id, linkedin_url")
        .eq("organization_id", ctx.orgId)
        .in("linkedin_url", personUrls)
    : { data: [] };
  const existingByUrl = new Map(
    ((existing || []) as Array<{ id: string; linkedin_url: string | null }>)
      .filter((r) => r.linkedin_url)
      .map((r) => [r.linkedin_url!, r.id])
  );

  // NB: company_name / linkedin_url / full_name on crm_contacts are GENERATED
  // columns. Write the underlying company / primary_linkedin_url / first_name +
  // last_name instead - the generated ones reject any non-DEFAULT value.
  const toInsert = chosen
    .map((s) => ({ s, p: bestPersonByKey.get(s.company_name.toLowerCase())! }))
    .filter(({ p }) => p.linkedin_url && !existingByUrl.has(p.linkedin_url))
    .map(({ s, p }) => {
      const { first, last } = splitName(p.full_name);
      return {
        organization_id: ctx.orgId,
        display_name: p.full_name,
        first_name: first,
        last_name: last,
        job_title: p.title,
        company: s.company_name,
        company_website: s.domain ? `https://${s.domain.replace(/^https?:\/\//, "")}` : null,
        primary_linkedin_url: p.linkedin_url,
        country: s.country,
        source: "signals_starter_list",
        status: "active",
        tags: ["in-market", `signal:${s.signal_type}`, "starter-list"],
      };
    });

  if (toInsert.length) {
    const { data, error } = await supabase
      .from("crm_contacts")
      .insert(toInsert)
      .select("id, linkedin_url");
    if (error) throw error;
    for (const r of (data || []) as Array<{ id: string; linkedin_url: string | null }>) {
      if (r.linkedin_url) existingByUrl.set(r.linkedin_url, r.id);
    }
  }

  // Pair each contact back to the signal it came from, so the "why now" note
  // on the list member is the reason for THAT company - not whichever signal
  // happened to share an array index.
  const members = chosen
    .map((s) => {
      const p = bestPersonByKey.get(s.company_name.toLowerCase());
      const contactId = p?.linkedin_url ? existingByUrl.get(p.linkedin_url) : undefined;
      return { contactId, signal: s, person: p };
    })
    .filter((m): m is { contactId: string; signal: SignalRow; person: SignalPerson } => !!m.contactId);
  if (!members.length) throw new Error("Starter list produced no contacts");

  const { data: list, error: listErr } = await supabase
    .from("lead_lists")
    .insert({
      organization_id: ctx.orgId,
      name: "In-market buyers · starter list",
      description: `${members.length} decision-makers at companies showing buying signals in the last 45 days, matched to ${icp.name}. Emails are being found and verified automatically - this list is a starting point, not a ceiling.`,
      source_type: "signal",
      source_config: { built_by: "onboarding", signal_ids: chosen.map((s) => s.id) },
      // Leave at 0 - trg_update_lead_list_count_insert maintains this. Seeding
      // it here as well double-counted the list (25 members reported as 50).
      lead_count: 0,
      status: "active",
    })
    .select("id")
    .single();
  if (listErr) throw listErr;
  const listId = (list as { id: string }).id;

  // Auto-enrich the list, but ONLY if this org can actually enrich. Email
  // discovery is per-org (api_keys), and a brand-new trial org has no provider
  // connected - queueing 25 items against a provider that cannot run just
  // retries forever and dirties the queue. Every contact already carries a
  // personal LinkedIn URL, so the list is usable on the LinkedIn path from
  // minute one either way; email fills in once a provider is connected.
  const EMAIL_PROVIDERS = ["moltsets", "apollo", "hunter", "prospeo"];
  const { data: keys } = await supabase
    .from("api_keys")
    .select("provider")
    .eq("organization_id", ctx.orgId)
    .eq("is_valid", true)
    .in("provider", EMAIL_PROVIDERS);
  const provider = ((keys || []) as Array<{ provider: string }>)
    .map((k) => k.provider)
    .sort((a, b) => EMAIL_PROVIDERS.indexOf(a) - EMAIL_PROVIDERS.indexOf(b))[0];

  if (provider) {
    // Policy BEFORE members: trg_enqueue_lead_list_processing_item only queues
    // a contact if an enabled policy already exists for the list, so creating
    // it afterwards would leave every row sitting there unenriched.
    //
    // Find the email, verify it, and stop. Deliberately no destination and no
    // sequence_id: enroll would start cold-emailing strangers on the user's
    // behalf before they have ever seen the list. Making the list sendable is
    // our job; deciding to send is theirs.
    const { error: policyErr } = await supabase
      .from("lead_list_processing_policies")
      .insert({
        organization_id: ctx.orgId,
        lead_list_id: listId,
        enabled: true,
        analyze_icp: false,
        find_email: true,
        email_provider: provider,
        email_provider_chain: [provider],
        verify_email: true,
        verification_provider: "mailtester_ninja",
        verification_provider_chain: ["mailtester_ninja"],
        require_valid_email: false,
        verify_when: "always",
        stage_order: ["icp", "find_email", "verify_email", "enroll"],
        sequence_id: null,
        // 'none', not null - the column is NOT NULL and this is the value that
        // means "enrich, then stop and wait for a human".
        approved_destination_type: "none",
        approved_destination_id: null,
      });
    if (policyErr) throw policyErr;
  }

  const { error: memberErr } = await supabase
    .from("lead_list_members")
    .insert(members.map((m) => ({
      list_id: listId,
      contact_id: m.contactId,
      source_data: {
        signal_type: m.signal.signal_type,
        why: m.signal.why_it_matters,
        contact_title: m.person.title,
        source: "public_signals",
      },
    })));
  if (memberErr) throw memberErr;
}

// ─── Completion email ──────────────────────────────────────────────────────
// The only thing that told the lead their playbook was ready used to be the
// success screen's promise itself - nothing backed it. This sends the actual
// delivery once generation finishes: a magic sign-in link plus a short,
// real summary of what got built. Guarded by an atomic UPDATE so a retried
// invocation of the same job (see isHandled() above) can't send it twice.
async function sendCompletionEmail(supabase: SupabaseClient<any>, jobId: string, ctx: JobContext) {
  if (!ctx.email) {
    console.warn("[generate-playbook-artifacts] no lead email on job, skipping delivery email", jobId);
    return;
  }

  const { data: claimed, error: claimErr } = await supabase
    .from("provisioning_jobs")
    .update({ delivery_sent_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("delivery_sent_at", null)
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.error("[generate-playbook-artifacts] delivery_sent_at claim failed:", claimErr);
    return;
  }
  if (!claimed) {
    // Another invocation already claimed (or already sent) this job's email.
    return;
  }

  try {
    const baseUrl =
      Deno.env.get("APP_BASE_URL") ||
      Deno.env.get("PUBLIC_APP_URL") ||
      Deno.env.get("APP_URL") ||
      Deno.env.get("SITE_URL") ||
      APP_URL;

    // Deep-link straight to the actual deliverable, not a generic landing
    // page. /jobs is the content-generation queue (unrelated) and doesn't
    // even read ?onboarded=1 - it was the wrong "post-onboarding" redirect
    // even before this email existed. The prospect list is the most
    // concrete, immediately-useful thing generated, so land there.
    const listId = await latestRowId(supabase, "lead_lists", ctx.orgId);
    const redirectPath = listId ? `/leads/lists/${listId}` : `/jobs`;
    const redirectTo = `${baseUrl}${redirectPath}?onboarded=1&jobId=${jobId}`;

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: ctx.email,
      options: { redirectTo },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`generateLink failed: ${linkErr?.message || "no action_link"}`);
    }
    const magicLink = linkData.properties.action_link as string;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.log("[generate-playbook-artifacts] no RESEND_API_KEY, skipping delivery email to", ctx.email);
      return;
    }
    const from = Deno.env.get("LEAD_NOTIFY_FROM") || fromAddress("noreply");
    const founderEmail = Deno.env.get("LEAD_NOTIFY_EMAIL") || OPS_ALERT_EMAIL;
    const first = (ctx.fullName || "").trim().split(" ")[0];
    const icp = ctx.icps[0];

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F2EEE6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2EEE6;padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #C9C2AE;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <img src="${PUBLIC_SITE_URL}/logo.svg" alt="ACA" width="120" height="45" style="display:block;height:45px;width:auto;border:0;outline:none;" />
        </td></tr>
        <tr><td style="padding:22px 32px 0;">
          <div style="font:600 13px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.12em;text-transform:uppercase;color:#D4361A;">Your playbook is ready</div>
          <div style="font:600 27px/1.25 Georgia,'Times New Roman',serif;color:#15140F;margin-top:10px;">${first ? `${escapeHtmlLocal(first)}, it's built.` : "It's built."}</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0;">
          <div style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6B6759;">
            Your buyer profile, outbound sequence, 60-day plan, and a starter list of in-market prospects are live in your workspace - not a static doc, an actual system.
          </div>
        </td></tr>
        ${icp?.name ? `<tr><td style="padding:22px 32px 0;">
          <div style="border:1px solid #C9C2AE;border-radius:10px;padding:16px 18px;background:#FBFAF6;">
            <div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.1em;text-transform:uppercase;color:#6B6759;margin-bottom:6px;">Your buyer</div>
            <div style="font:600 16px/1.4 Georgia,serif;color:#15140F;">${escapeHtmlLocal(icp.name)}</div>
          </div>
        </td></tr>` : ""}
        <tr><td style="padding:26px 32px 6px;">
          <a href="${escapeHtmlLocal(magicLink)}" style="display:inline-block;background:#D4361A;color:#fff;font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:8px;text-decoration:none;">${listId ? "See your prospect list" : "Open your workspace"} &#8594;</a>
        </td></tr>
        <tr><td style="padding:22px 32px 26px;background:#FBFAF6;border-top:1px solid #C9C2AE;">
          <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6B6759;">
            No password needed, this link signs you in directly. Questions? Just reply, it reaches me personally.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [ctx.email],
        subject: first ? `${first}, your playbook is ready` : "Your playbook is ready",
        html,
        reply_to: founderEmail,
      }),
    });
    if (!res.ok) {
      console.error(`[generate-playbook-artifacts] delivery email send failed ${res.status}:`, await res.text());
    }
  } catch (e) {
    console.error("[generate-playbook-artifacts] sendCompletionEmail error:", e);
  }
}

function escapeHtmlLocal(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── HANDLER ───────────────────────────────────────────────────────────────
const ARTIFACT_KEYS = [
  "icp", "product", "knowledge", "audit", "sequence",
  "blueprint", "campaign", "content_plan", "agent", "strategy", "leads",
];

async function runJob(
  supabase: SupabaseClient<any>,
  jobId: string,
  orgId: string,
  openrouterKey: string,
  alreadyDone: Record<string, string>,
) {
  // A task counts as already handled if a PRIOR invocation of this job marked
  // it done/skipped. Re-running a "done" task on every retry doesn't just
  // waste LLM spend - genStarterLeads has no dedup against an existing list,
  // so every redundant retry minted a brand new duplicate "starter list" with
  // the same 25 prospects. Real incident, cleaned up by hand once already.
  const isHandled = (key: string) => alreadyDone[key] === "done" || alreadyDone[key] === "skipped";

  try {
    const ctx = await loadContext(supabase, jobId, orgId);

    // ICP must run first - every downstream artifact reads ctx.icps[0]. If
    // ICP stays as the placeholder, sequences/blueprint/agent/strategy come
    // out generic. Sequential, ~10s. Skipped on retry if a prior run already
    // finished it - loadContext() above already pulled the real ICP off the
    // DB into ctx.icps, so downstream tasks still see real data.
    if (!isHandled("icp")) {
      try {
        await markTask(supabase, jobId, "icp", "running");
        await genICP(supabase, ctx, openrouterKey);
        await markTask(supabase, jobId, "icp", "done");
      } catch (e) {
        console.error("[generate-playbook-artifacts] icp failed:", e);
        await markTask(supabase, jobId, "icp", "failed");
      }
    }

    // Everything else runs concurrently. Total wall-clock is the slowest
    // single task (~17s for strategy) instead of the sum (~90s). Comfortably
    // beats the 150s function timeout.
    type Task = { key: string; fn: () => Promise<void>; skipIf?: () => boolean };
    const parallelTasks: Task[] = [
      { key: "product",      fn: () => genProduct(supabase, ctx, openrouterKey) },
      { key: "knowledge",    fn: () => genKnowledge(supabase, ctx, openrouterKey) },
      { key: "audit",        fn: () => genAudit(supabase, ctx, openrouterKey), skipIf: () => !ctx.linkedinUrl },
      { key: "sequence",     fn: () => genSequence(supabase, ctx, openrouterKey) },
      { key: "blueprint",    fn: () => genBlueprint(supabase, ctx, openrouterKey) },
      { key: "content_plan", fn: () => genContentPlan(supabase, ctx, openrouterKey) },
      { key: "agent",        fn: () => genAgent(supabase, ctx, openrouterKey) },
      { key: "strategy",     fn: () => genStrategy(supabase, ctx, openrouterKey) },
      { key: "leads",        fn: () => genStarterLeads(supabase, ctx, openrouterKey) },
    ];

    await Promise.all(parallelTasks.map(async (t) => {
      if (isHandled(t.key)) return;
      if (t.skipIf?.()) {
        await markTask(supabase, jobId, t.key, "skipped");
        return;
      }
      await markTask(supabase, jobId, t.key, "running");
      try {
        await t.fn();
        await markTask(supabase, jobId, t.key, "done");
      } catch (e) {
        console.error(`[generate-playbook-artifacts] ${t.key} failed:`, e);
        await markTask(supabase, jobId, t.key, "failed");
      }
    }));

    // Campaign runs LAST - it mirrors the sequence steps into a xyflow
    // graph, so it must wait for genSequence above to finish.
    if (!isHandled("campaign")) {
      try {
        await markTask(supabase, jobId, "campaign", "running");
        await genCampaign(supabase, ctx);
        await markTask(supabase, jobId, "campaign", "done");
      } catch (e) {
        console.error("[generate-playbook-artifacts] campaign failed:", e);
        await markTask(supabase, jobId, "campaign", "failed");
      }
    }

    await supabase
      .from("provisioning_jobs")
      .update({ status: "done", current_task: "done", completed_at: new Date().toISOString() })
      .eq("id", jobId);

    await sendCompletionEmail(supabase, jobId, ctx);
  } catch (e) {
    console.error("[generate-playbook-artifacts] runJob uncaught:", e);
    await supabase
      .from("provisioning_jobs")
      .update({ error: e instanceof Error ? e.message : String(e) })
      .eq("id", jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: Payload = await req.json();
    if (!body.provisioningToken) {
      return new Response(JSON.stringify({ error: "provisioningToken required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let payload;
    try {
      payload = await verifyProvisioningToken(body.provisioningToken);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Idempotence guard - both fast-return for already-done jobs AND
    // already-running guard so a retry from the wizard doesn't kick a second
    // parallel run that would race on the same placeholder rows.
    const { data: existing } = await supabase
      .from("provisioning_jobs")
      .select("tasks_done, current_task")
      .eq("id", payload.jobId)
      .maybeSingle();
    const done = (existing?.tasks_done || {}) as Record<string, string>;
    if (ARTIFACT_KEYS.every((k) => done[k] === "done" || done[k] === "skipped")) {
      return new Response(JSON.stringify({ ok: true, alreadyDone: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // If ICP is already running and was touched recently, another invocation
    // is in flight - don't double-fire.
    if (done.icp === "running" && existing?.current_task && existing.current_task !== "queued") {
      return new Response(JSON.stringify({ ok: true, alreadyRunning: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Snapshot which tasks a PRIOR invocation already finished, before we
    // reset the rest to "running" - runJob uses this to skip re-doing work
    // instead of redundantly regenerating (and re-spending on) everything.
    const alreadyDone = { ...done };
    for (const k of ARTIFACT_KEYS) {
      if (done[k] !== "done" && done[k] !== "skipped") done[k] = "running";
    }
    await supabase.from("provisioning_jobs").update({ tasks_done: done, current_task: "icp" }).eq("id", payload.jobId);

    // Run the actual work in the background so the wizard's invoke() returns
    // immediately. Without this the browser holds the request open for ~60s
    // and any cold start / network blip silently aborts the whole job
    // (previously left users stuck on "Profiling your buyer" forever).
    const jobPromise = runJob(supabase, payload.jobId, payload.organizationId, openrouterKey, alreadyDone);
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(jobPromise);
    } else {
      // Local dev fallback - just don't await.
      jobPromise.catch((e) => console.error("[generate-playbook-artifacts] bg job failed:", e));
    }

    return new Response(JSON.stringify({ ok: true, started: true }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[generate-playbook-artifacts] uncaught:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
