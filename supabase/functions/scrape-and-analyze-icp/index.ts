/**
 * Scrape & Analyze ICP — generate a `library_icps` row from two anchors:
 *   1. Website URL (what the user sells) → crawl4ai
 *   2. LinkedIn profile URL (one ideal customer) → harvestapi
 *
 * SSE streaming mirrors `scrape-and-analyze-product` for UI parity. Falls
 * back gracefully if the LinkedIn scrape fails (sparse profile, no Apify
 * token) — produces a website-only ICP rather than erroring out.
 *
 * Output: a flat JSON object that maps 1:1 to library_icps columns. The
 * caller (useScrapeAndCreateIcp) does the actual INSERT so RLS sees the
 * authenticated user, not service-role.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient , type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import OpenRouterProvider from '../_shared/providers/OpenRouterProvider.ts';
import { fetchChatCompletions, isOllamaModel } from '../_shared/llm-client.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APIFY_PROFILE_ACTOR = 'harvestapi~linkedin-profile-scraper';
const APIFY_RUN_TIMEOUT_MS = 90_000;
const APIFY_POLL_INTERVAL_MS = 4_000;

// ----------------------------------------------------------------------------
// Website scraper — crawl4ai with basic-fetch fallback. Mirrors
// scrape-and-analyze-product so we keep one shape across edge functions.
// ----------------------------------------------------------------------------
async function fetchWebsiteText(url: string): Promise<string | null> {
  const crawlerBaseUrl = Deno.env.get('CRAWLER_BASE_URL');

  if (crawlerBaseUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      const response = await fetch(`${crawlerBaseUrl}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [url],
          crawler_config: {
            type: 'CrawlerRunConfig',
            params: { cache_mode: 'bypass', word_count_threshold: 50, delay_before_return_html: 2.0 },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const result = await response.json();
        const md = result?.results?.[0]?.markdown?.raw_markdown;
        if (md && md.length >= 50) return md.substring(0, 50000);
      }
    } catch (err) {
      console.log('crawl4ai failed, falling back to basic fetch:', err);
    }
  }

  // Fallback: plain fetch (works for static sites without bot protection)
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!r.ok) return null;
    const html = await r.text();
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return text.replace(/\s+/g, ' ').trim().substring(0, 50000);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// LinkedIn profile scraper — harvestapi async kickoff + poll. Same pattern as
// list-building-dm-scraper but for a single profile.
// ----------------------------------------------------------------------------
interface LinkedInProfileSummary {
  fullName?: string;
  headline?: string;
  position?: string;
  location?: string;
  about?: string;
  currentCompany?: string;
  industry?: string;
  experienceTitles?: string[];
  rawSnippet?: string; // first 4 KB of the JSON for debugging
}

async function fetchLinkedinProfile(
  apifyToken: string,
  profileUrl: string,
): Promise<LinkedInProfileSummary | null> {
  try {
    const startResp = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_PROFILE_ACTOR}/runs?token=${apifyToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The actor accepts profileUrls or profileScraperMode depending on
        // version; passing both shapes is harmless and covers drift.
        body: JSON.stringify({
          profileUrls: [profileUrl],
          maxItems: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!startResp.ok) {
      console.log('harvestapi profile kickoff failed:', startResp.status);
      return null;
    }
    const startJson = await startResp.json();
    const runId = startJson?.data?.id as string | undefined;
    const datasetId = startJson?.data?.defaultDatasetId as string | undefined;
    if (!runId || !datasetId) return null;

    // Poll until terminal state.
    const deadline = Date.now() + APIFY_RUN_TIMEOUT_MS;
    let finalStatus = 'RUNNING';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS));
      const sr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!sr.ok) continue;
      const sj = await sr.json();
      finalStatus = (sj?.data?.status as string) ?? 'UNKNOWN';
      if (['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(finalStatus)) break;
    }
    if (finalStatus !== 'SUCCEEDED') {
      console.log('harvestapi profile run terminal:', finalStatus);
      return null;
    }

    const dsResp = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json&clean=true&limit=1`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!dsResp.ok) return null;
    const items = await dsResp.json();
    const item = Array.isArray(items) ? items[0] : null;
    if (!item) return null;

    // Defensive field extraction — actor versions vary; we accept multiple
    // shapes and fall back to a raw snippet so the AI prompt sees something
    // useful even if our keys drifted.
    const first = item.firstName ?? '';
    const last = item.lastName ?? '';
    const fullName = item.fullName ?? `${first} ${last}`.trim();
    const currentPos = Array.isArray(item.currentPosition) ? item.currentPosition[0] : null;
    const experience = Array.isArray(item.experience) ? item.experience : [];

    return {
      fullName,
      headline: item.headline ?? null,
      position: currentPos?.position ?? currentPos?.title ?? null,
      location: item.location ?? currentPos?.location ?? null,
      about: item.about ?? item.summary ?? null,
      currentCompany: currentPos?.companyName ?? null,
      industry: item.industry ?? currentPos?.industries ?? null,
      experienceTitles: experience.slice(0, 5).map((e: { position?: string; title?: string }) =>
        e.position ?? e.title ?? '',
      ).filter(Boolean),
      rawSnippet: JSON.stringify(item).slice(0, 4000),
    };
  } catch (err) {
    console.error('linkedin profile fetch failed:', err);
    return null;
  }
}

async function getApifyToken(supabase: SupabaseClient<any>, orgId: string): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', orgId)
    .eq('provider', 'apify')
    .eq('is_valid', true)
    .maybeSingle();
  if (!data) return null;
  return decryptApiKey((data as { key_encrypted: string }).key_encrypted, encryptionKey);
}

// ----------------------------------------------------------------------------
// AI prompt
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an expert B2B audience strategist building an Ideal Customer Profile (ICP) for a SaaS product.

You are given two anchors:
1. **What the user sells** — text scraped from their product/company website.
2. **Who the user wants to reach** — a real LinkedIn profile that represents their ideal customer (this may be sparse if the profile is private).

Synthesize them into a structured ICP that will be used for cold outreach scoring.

Return ONLY a valid JSON object with this exact flat shape:

{
  "name": "Short label, max 60 chars (e.g. 'B2B SaaS marketing leaders at 10-200 person companies')",
  "summary": "1-2 sentence elevator pitch describing the ideal buyer",
  "description": "3-5 sentences expanding on who this person is, what they do, what they care about",
  "pain_points": ["3-7 specific problems this buyer faces"],
  "desires": ["3-7 outcomes/aspirations they want"],
  "objections": ["2-5 likely reasons they'd push back on outreach"],
  "language_style": "1 phrase (e.g. 'direct, jargon-free, ROI-focused' or 'casual, story-driven')",
  "tags": ["3-7 short keyword tags"],
  "target_locations": ["0-5 target geographies as free text — countries, regions, or cities (e.g. 'United States', 'DACH', 'London'). Leave empty if the source gives no clear geographic focus"],
  "target_seniorities": ["pick from: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry"],
  "target_departments": ["pick from: sales, marketing, engineering, operations, finance, hr, customer_success, product, legal, executive"],
  "target_title_keywords": ["3-7 title keywords e.g. 'Head of Growth', 'CMO', 'VP Marketing'"],
  "decision_maker_notes": "1-2 sentences on how to identify decision-makers vs gatekeepers in this segment"
}

RULES:
- Use the exact enum values listed for target_seniorities and target_departments — anything else will be rejected.
- If the LinkedIn profile data is sparse (private/empty), say so in decision_maker_notes and rely more heavily on the website.
- Do not invent specific numbers (revenue, funding) — those go in tags as ranges if relevant.
- Be specific about WHO this person is, not generic "modern professionals". Aim for the kind of detail a sales rep would use to qualify a lead.
- Return ONLY the JSON object, no markdown formatting, no commentary.`;

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const { websiteUrl, linkedinProfileUrl } = await req.json();
    if (!websiteUrl || typeof websiteUrl !== 'string') {
      throw new Error('websiteUrl is required');
    }
    if (!linkedinProfileUrl || typeof linkedinProfileUrl !== 'string') {
      throw new Error('linkedinProfileUrl is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error('Unauthorized');

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();
    const orgId = userData?.active_organization_id || userData?.organization_id;
    if (!orgId) throw new Error('No organization context');

    // Resolve OpenRouter key (required) and Apify key (optional — LinkedIn
    // step degrades gracefully if missing).
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('Encryption key not configured');

    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', orgId)
      .maybeSingle();
    const defaultModel = (orgSettings as { default_llm_model?: string } | null)?.default_llm_model
      || 'anthropic/claude-3.5-sonnet';

    const { data: openRouterRow } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .maybeSingle();
    if (!openRouterRow && !isOllamaModel(defaultModel)) throw new Error('OpenRouter API key not configured');
    const openRouterKey = openRouterRow
      ? await decryptApiKey((openRouterRow as { key_encrypted: string }).key_encrypted, encryptionKey)
      : undefined;

    const apifyToken = await getApifyToken(supabase, orgId);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Step 1 — website
          sendEvent({ status: 'fetching_website', message: 'Reading your website…' });
          const websiteText = await fetchWebsiteText(websiteUrl);
          if (!websiteText) {
            throw new Error(
              'Could not read the website. Try a simpler URL (homepage, about page) or check it loads in an incognito tab.',
            );
          }

          // Step 2 — LinkedIn (optional)
          sendEvent({ status: 'fetching_linkedin', message: 'Reading the LinkedIn profile…' });
          let profile: LinkedInProfileSummary | null = null;
          if (apifyToken) {
            profile = await fetchLinkedinProfile(apifyToken, linkedinProfileUrl);
          }

          if (!profile) {
            sendEvent({
              status: 'fetching_linkedin',
              message: 'LinkedIn unavailable — building ICP from website only.',
            });
          }

          // Step 3 — AI synthesis
          sendEvent({ status: 'analyzing', message: 'Synthesising your ICP with AI…' });

          const userPrompt = `WEBSITE URL: ${websiteUrl}

WEBSITE CONTENT (truncated):
${websiteText}

---

LINKEDIN PROFILE URL: ${linkedinProfileUrl}

LINKEDIN PROFILE DATA:
${profile
  ? JSON.stringify({
      fullName: profile.fullName,
      headline: profile.headline,
      currentTitle: profile.position,
      currentCompany: profile.currentCompany,
      location: profile.location,
      about: profile.about,
      industry: profile.industry,
      experienceTitles: profile.experienceTitles,
    }, null, 2)
  : '(LinkedIn data unavailable — base the ICP primarily on the website. In decision_maker_notes, acknowledge that no example profile was provided.)'}

Now generate the ICP JSON.`;

          const aiResponse = await fetchChatCompletions({
            model: defaultModel,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.6,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
          }, {
            openRouterApiKey: openRouterKey,
            supabase,
            organizationId: orgId,
            referer: supabaseUrl,
          });

          if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            let detail = errorText.slice(0, 300);
            try {
              const parsed = JSON.parse(errorText);
              detail = parsed?.error?.message || parsed?.message || detail;
            } catch { /* keep raw */ }
            throw new Error(`AI analysis failed (${aiResponse.status}): ${detail}`);
          }

          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content;
          if (!content) throw new Error('No content in AI response');

          let icpData;
          try {
            icpData = OpenRouterProvider.parseJsonResponse(content);
          } catch (e) {
            console.error('Failed to parse AI ICP response:', e);
            console.error('AI response (first 500):', content?.slice(0, 500));
            throw new Error('Failed to parse ICP data — try again or adjust the URLs.');
          }

          // Defensive enum filtering — the AI MAY drift past the allowed
          // values; clamp to the AddICPDialog enums so the row is consistent
          // with the manual-creation path.
          const ALLOWED_SENIORITY = new Set([
            'owner', 'founder', 'c_suite', 'partner', 'vp', 'head',
            'director', 'manager', 'senior', 'entry',
          ]);
          const ALLOWED_DEPT = new Set([
            'sales', 'marketing', 'engineering', 'operations', 'finance',
            'hr', 'customer_success', 'product', 'legal', 'executive',
          ]);
          if (Array.isArray(icpData.target_seniorities)) {
            icpData.target_seniorities = icpData.target_seniorities.filter((s: string) =>
              ALLOWED_SENIORITY.has(String(s).toLowerCase()),
            );
          }
          if (Array.isArray(icpData.target_departments)) {
            icpData.target_departments = icpData.target_departments.filter((s: string) =>
              ALLOWED_DEPT.has(String(s).toLowerCase()),
            );
          }

          sendEvent({ status: 'complete', message: 'ICP generated', data: icpData });
        } catch (error) {
          console.error('scrape-and-analyze-icp error:', error);
          sendEvent({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
