// ============================================================================
// li-score-and-draft
// ============================================================================
//
// Takes a LinkedIn post from li_post_inbox, scores it for engagement potential,
// drafts a comment in Cedric's helpful-expert voice, decides Lane A/B/C, and
// either auto-queues for posting (Lane A) or posts a Slack approval message
// (Lane B/C).
//
// Invocation:
//   POST { post_id: "<uuid>" }
//
// Apify pipeline drops new posts into li_post_inbox and calls this function for
// each one. Can also be re-invoked manually to re-score a post.
//
// Voice rules baked into the prompt:
//   - Helpful expert positioning, no contrarian edges
//   - No em dashes (Cedric's hard rule)
//   - 60-100 words per comment, no "great post" energy, no emoji clouds
//   - ACA references only when contextually honest, never pushy
//   - Specific over abstract: numbers, examples, named people where natural
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { normalizeDashes } from "../_shared/sanitize-ai-output.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface PostRow {
  id: string;
  post_url: string;
  post_urn: string | null;
  author_handle: string;
  author_display_name: string | null;
  author_tier: 0 | 1 | 2 | 3;
  post_text: string;
  reactions: number;
  comments_count: number;
  post_published_at: string | null;
  reactions_per_minute: number | null;
  surfaced_via: string;
}

type Archetype =
  | "framework_drop"
  | "specific_example"
  | "counter_evidence"
  | "sharpening_question"
  | "resource_pointer"
  | "relatable_insider";

interface DraftResult {
  archetype: Archetype;
  comment: string;
  confidence: number;
  has_aca_reference: boolean;
  has_specific_claim: boolean;
}

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

/**
 * Score 0-1 for whether this post is worth engaging with.
 * Higher score = better lift-per-comment.
 */
function scorePost(post: PostRow): number {
  let score = 0;

  // Author tier weight: trending (Tier 0) and top voices (Tier 1) dominate
  const tierWeight: Record<number, number> = { 0: 0.35, 1: 0.30, 2: 0.20, 3: 0.10 };
  score += tierWeight[post.author_tier] ?? 0.1;

  // Engagement velocity: reactions per minute matters more than absolute count
  if (post.reactions_per_minute) {
    if (post.reactions_per_minute > 5) score += 0.25;
    else if (post.reactions_per_minute > 2) score += 0.15;
    else if (post.reactions_per_minute > 1) score += 0.10;
  } else if (post.reactions > 50) {
    score += 0.10;
  }

  // Freshness: sweet spot is 20 min to 4 hours
  if (post.post_published_at) {
    const ageMin =
      (Date.now() - new Date(post.post_published_at).getTime()) / 60_000;
    if (ageMin < 20) score += 0.05;          // a bit too early, comments still empty
    else if (ageMin < 180) score += 0.25;    // sweet spot
    else if (ageMin < 360) score += 0.10;    // still in window
    // > 6 hours, window is closing
  }

  // Comment density: if there are already 100+ comments, our voice gets buried
  if (post.comments_count < 30) score += 0.10;
  else if (post.comments_count < 80) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

// ----------------------------------------------------------------------------
// Draft generation via OpenRouter
// ----------------------------------------------------------------------------

const VOICE_PROMPT = `You are drafting a LinkedIn comment for Cedric Seguela. He runs ACA (Automated Client Acquisition), a SaaS platform that helps B2B agencies and founders book qualified sales calls through automated outbound across LinkedIn, email, WhatsApp, and Instagram.

Cedric's positioning is HELPFUL EXPERT. Not contrarian. Not data-flexing. Generous, substantive, frameworks over hot takes. He speaks as someone who runs the operation, not as a commentator on it.

VOICE RULES (hard constraints):
- No em dashes anywhere. Use commas, periods, parentheses, or sentence breaks instead.
- 60-100 words. Tight.
- No "Great post!" / "Love this!" / "Spot on!" opening lines.
- No emoji clouds. Single emoji at most, only if the post itself uses emojis casually.
- No hashtag walls.
- Specific over abstract: numbers, examples, named real people where natural.
- Never claim authority you can't back. If you'd need data Cedric doesn't have, change the angle.
- ACA references must be EARNED, not inserted. Don't pitch. Don't say "DM me" or include links. At most, the comment can mention "the agency clients we work with" or similar phrasing that hints at ACA's existence without naming it.

ARCHETYPES (pick the one that best fits the post):
- framework_drop: small framework or principle that answers the post's implicit question
- specific_example: a concrete experience with numbers, "we saw X go from Y to Z when we tried W"
- counter_evidence: polite, data-backed disagreement, "mostly agree, but in our data..."
- sharpening_question: a question that exposes the next layer of the topic
- resource_pointer: name 1-3 real people or tools that solve what the OP is asking about
- relatable_insider: light humor, in-group recognition, lower-temperature

OUTPUT FORMAT (strict JSON, no markdown):
{
  "archetype": "<one of the six>",
  "comment": "<the comment text, 60-100 words>",
  "confidence": <0.0-1.0, how confident you are this comment will land>,
  "has_aca_reference": <true if the comment references "agency clients we work with" or similar, false otherwise>,
  "has_specific_claim": <true if the comment includes a number, named person, or specific outcome that would need verification>
}`;

async function generateDraft(post: PostRow): Promise<DraftResult> {
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterKey) throw new Error("OPENROUTER_API_KEY not configured");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const userPrompt = `Post by ${post.author_display_name ?? post.author_handle} (${post.reactions} reactions, ${post.comments_count} comments):

${post.post_text}

Draft a comment following the voice rules. Return strict JSON only.`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": supabaseUrl,
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages: [
        { role: "system", content: VOICE_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 500,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenRouter error ${resp.status}: ${txt}`);
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content");

  const parsed = JSON.parse(content) as DraftResult;

  // Post-validation: strip any em dashes the model snuck in. Uses the shared
  // rule so this matches every other outbound path (a blanket comma left
  // "It works , try it" and comma splices behind).
  parsed.comment = normalizeDashes(parsed.comment);

  return parsed;
}

// ----------------------------------------------------------------------------
// Lane decision
// ----------------------------------------------------------------------------

type Lane = "A" | "B" | "C";

function decideLane(post: PostRow, draft: DraftResult): Lane {
  // Lane C: anything sensitive that warrants careful human review without time pressure
  if (post.author_tier === 3) return "C";              // prospect, warmth play
  if (draft.has_specific_claim) return "B";            // specific numbers need a glance
  if (draft.has_aca_reference) return "B";             // any ACA mention needs approval
  if (draft.archetype === "specific_example") return "B"; // by archetype rules

  // Lane A: only the safest archetypes from Tier 0/1, high confidence, no risk flags
  const safeArchetypes: Archetype[] = [
    "relatable_insider",
    "sharpening_question",
    "framework_drop",
  ];
  if (
    safeArchetypes.includes(draft.archetype) &&
    draft.confidence >= 0.85 &&
    (post.author_tier === 0 || post.author_tier === 1)
  ) {
    return "A";
  }

  return "B";
}

// ----------------------------------------------------------------------------
// Slack posting (Lane B/C)
// ----------------------------------------------------------------------------

async function postSlackApprovalMessage(
  post: PostRow,
  draft: DraftResult,
  lane: Lane,
  score: number,
): Promise<{ channel_id: string; message_ts: string }> {
  const botToken = Deno.env.get("SLACK_BOT_TOKEN");
  const channelId = Deno.env.get("LI_ENGAGEMENT_SLACK_CHANNEL_ID") ?? "C0B3LEN08TD";
  if (!botToken) throw new Error("SLACK_BOT_TOKEN not configured");

  const truncatedPost = post.post_text.length > 600
    ? post.post_text.slice(0, 600) + "..."
    : post.post_text;

  const text = `:fire: *Lane ${lane} item* — Tier ${post.author_tier}, score ${score.toFixed(2)}

*Author:* ${post.author_display_name ?? post.author_handle}
*Reactions:* ${post.reactions} | *Comments:* ${post.comments_count}
*Archetype:* ${draft.archetype}
*Surfaced via:* ${post.surfaced_via}
*Post URL:* ${post.post_url}

*Post:*
> ${truncatedPost.replace(/\n/g, "\n> ")}

*Draft comment:*
> ${draft.comment.replace(/\n/g, "\n> ")}

*Reply* :white_check_mark: to post, :x: to skip, :pencil2: + your edit, :alarm_clock: to defer.`;

  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text, mrkdwn: true }),
  });

  const json = await resp.json();
  if (!json.ok) throw new Error(`Slack postMessage failed: ${json.error}`);

  return { channel_id: channelId, message_ts: json.ts };
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  // Its pipeline tables no longer exist and nothing calls it; service-role key only.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { post_id } = await req.json();
    if (!post_id) {
      return new Response(
        JSON.stringify({ error: "post_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load the post
    const { data: post, error: postErr } = await supabase
      .from("li_post_inbox")
      .select("*")
      .eq("id", post_id)
      .single();

    if (postErr || !post) {
      return new Response(
        JSON.stringify({ error: "post not found", details: postErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Dedup: do we already have a comment_job for this post?
    const { data: existing } = await supabase
      .from("comment_jobs")
      .select("id, status")
      .eq("post_url", post.post_url)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "job already exists", job_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Score
    const score = scorePost(post as PostRow);
    if (score < 0.4) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "score below threshold", score }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Draft
    const draft = await generateDraft(post as PostRow);

    // Decide lane
    const lane = decideLane(post as PostRow, draft);

    // Build the comment_jobs row
    const jobRow: Record<string, unknown> = {
      inbox_post_id: post.id,
      post_url: post.post_url,
      post_urn: post.post_urn,
      author_handle: post.author_handle,
      author_tier: post.author_tier,
      archetype: draft.archetype,
      draft_comment: draft.comment,
      lane,
      confidence: draft.confidence,
    };

    if (lane === "A") {
      // Auto-queue for posting, no Slack approval gate
      jobRow.status = "pending";
    } else {
      // Lane B/C: post Slack approval message, store the message_ts
      const slack = await postSlackApprovalMessage(post as PostRow, draft, lane, score);
      jobRow.status = "awaiting_approval";
      jobRow.slack_channel_id = slack.channel_id;
      jobRow.slack_message_ts = slack.message_ts;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("comment_jobs")
      .insert(jobRow)
      .select()
      .single();

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: inserted.id,
        lane,
        score,
        archetype: draft.archetype,
        confidence: draft.confidence,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("li-score-and-draft error:", err);
    return new Response(
      JSON.stringify({ error: String((err as Error).message ?? err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
