// ============================================================================
// provision-playbook-workspace
// ----------------------------------------------------------------------------
// Public endpoint (no auth). Provisions a brand-new ACA workspace from a
// playbook lead-gen submission:
//   1. Insert/lookup playbook_leads row
//   2. Create auth user via admin.createUser → DB trigger handle_new_user
//      auto-creates organization + users + organization_members rows
//   3. Resolve the new organization_id from public.users
//   4. Update the org name to something nicer than "Cedric's Workspace"
//   5. Insert seed artifact rows (ICP, sequence, blueprint, agent, strategy)
//      tagged provisioning_status: 'pending' so Batch 2 can replace them
//   6. Insert provisioning_jobs row with HMAC-signed token
//   7. Return { jobId, organizationId, provisioningToken, taskKeys }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { signProvisioningToken } from "../_shared/provisioning-token.ts";
import { SUPPORT_EMAIL } from "../_shared/site-config.ts";
import { addContactToResendAudience } from "../_shared/resend-audience.ts";
import { playbookLinkedInBlueprintFields, playbookLinkedInBlueprintName } from "../_shared/playbook-linkedin-blueprint.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ICPInput {
  name?: string;
  summary?: string;
  industry?: string;
  roles?: string;
  size?: string;
  pains?: string[];
  desires?: string[];
  objections?: string[];
  language?: string;
}

interface ProvisionPayload {
  // Lead data
  leadId?: string; // optional - if already submitted via submit-playbook-lead
  fullName?: string;
  email: string;
  website?: string;
  linkedinUrl?: string;
  biggestNeed?: string;
  whatTried?: string;
  revenue?: string;
  teamSize?: string;
  playbookSlug?: string;
  niche?: string;
  outcome?: string;
  // Generic onboarding extras (from /get-started)
  goal?: string;
  painPoints?: string[];
  source?: string;
  /** First-touch UTMs / click ids captured on the landing page. */
  attribution?: Record<string, unknown>;
  // ICP from wizard
  icp?: ICPInput;
}

const TASK_KEYS = [
  "account",
  "icp",
  "product",
  "knowledge",
  "audit",
  "sequence",
  "blueprint",
  "campaign",
  "content_plan",
  "agent",
  "strategy",
];

// The old [^\s@]+@[^\s@]+\.[^\s@]+ happily accepted "dean@example.co.uk/" -
// a pasted URL fragment. Supabase then refused to create the user and the
// visitor got a generic "Failed to create account"; one real prospect retried
// five times in three minutes and never got in. Restrict the local and domain
// parts to characters an address can actually contain.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function isValidEmail(email: string): boolean {
  const e = email.trim();
  return e.length <= 254 && EMAIL_RE.test(e);
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "") + "Aa1!";
}

function workspaceName(payload: ProvisionPayload): string {
  if (payload.fullName) {
    const first = payload.fullName.split(" ")[0];
    return `${first}'s workspace`;
  }
  return `${payload.email.split("@")[0]}'s workspace`;
}

function rolesToArray(roles?: string): string[] {
  if (!roles) return [];
  return roles.split(/[,;]/).map((r) => r.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: ProvisionPayload = await req.json();

    if (!body.email || !isValidEmail(body.email)) {
      return new Response(
        JSON.stringify({ error: "That email address doesn't look right - check for a stray space or slash." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rate limit before anything is created. This endpoint is unauthenticated
    // and every accepted call mints an auth user, an org and ~11 LLM calls -
    // real money. Fine at a trickle of organic signups; an open door once ads
    // point public attention at the URL.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";
    const emailKey = body.email.trim().toLowerCase();
    const limits: Array<{ key: string; limit: number; windowSeconds: number }> = [
      { key: `ip:${ip}`, limit: 5, windowSeconds: 3600 },        // 5/hour per IP
      { key: `email:${emailKey}`, limit: 3, windowSeconds: 3600 }, // 3/hour per address
    ];
    for (const l of limits) {
      // Fail OPEN on an error here: a rate-limiter outage must never stop
      // legitimate signups, which is the thing we are paying for clicks to get.
      const { data: allowed, error: rlErr } = await supabase.rpc("check_provisioning_rate_limit", {
        p_key: l.key,
        p_limit: l.limit,
        p_window_seconds: l.windowSeconds,
      });
      if (rlErr) {
        console.warn("[provision] rate limit check failed, allowing:", rlErr.message);
        continue;
      }
      if (allowed === false) {
        console.warn(`[provision] rate limited ${l.key}`);
        return new Response(
          JSON.stringify({ error: `Too many workspaces from here in the last hour. Try again shortly, or email ${Deno.env.get("LEAD_NOTIFY_EMAIL") || SUPPORT_EMAIL}.` }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 1. Lead row - reuse if leadId passed, else create
    let leadId: string;
    if (body.leadId) {
      leadId = body.leadId;
    } else {
      const { data: lead, error: leadErr } = await supabase
        .from("playbook_leads")
        .insert({
          full_name: body.fullName,
          email: body.email,
          website: body.website,
          linkedin_url: body.linkedinUrl,
          biggest_need: body.biggestNeed || (body.painPoints?.length ? body.painPoints.join(" | ") : undefined),
          what_tried: body.whatTried,
          revenue: body.revenue,
          team_size: body.teamSize,
          playbook_slug: body.playbookSlug,
          niche: body.niche,
          outcome: body.outcome || body.goal,
          source: body.source || "playbook_provisioning",
          attribution: body.attribution ?? null,
        })
        .select("id")
        .single();
      if (leadErr || !lead) {
        console.error("[provision] lead insert failed:", leadErr);
        return new Response(
          JSON.stringify({ error: "Failed to record lead" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      leadId = lead.id;
    }

    // 2. Look up existing auth user by email - branch the flow.
    let userId: string;
    let orgId: string | null = null;
    let returningUser = false;

    const { data: existingUserRow } = await supabase
      .from("users")
      .select("id, organization_id")
      .eq("email", body.email)
      .maybeSingle();

    if (existingUserRow?.id) {
      // Returning user - reuse account + org
      returningUser = true;
      userId = existingUserRow.id;
      orgId = existingUserRow.organization_id ?? null;

      if (!orgId) {
        // Edge case: user exists but somehow has no org. Bail with a clear message.
        return new Response(
          JSON.stringify({ error: "Your account exists but has no workspace. Please contact support." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Backfill subscription state for returning users who never got it
      // (created before the no-card trial flow shipped, or who landed via
      // /get-started but already had an org).
      const { data: existingOrg } = await supabase
        .from("organizations")
        .select("subscription_status, trial_ends_at")
        .eq("id", orgId)
        .maybeSingle();
      if (!existingOrg?.subscription_status && !existingOrg?.trial_ends_at) {
        // Same rule as the new-org path: paid traffic buys, everyone else trials.
        const paidTraffic = (body.attribution as { paid?: boolean } | undefined)?.paid === true;
        await supabase
          .from("organizations")
          .update({
            subscription_status: "trialing",
            trial_ends_at: paidTraffic
              ? new Date().toISOString()
              : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq("id", orgId);
      }
    } else {
      // New user - let the handle_new_user trigger create org + users + org_members.
      const tempPassword = randomPassword();
      const { data: authResult, error: authErr } = await supabase.auth.admin.createUser({
        email: body.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: body.fullName,
          signup_source: "playbook_onboarding",
          playbook_slug: body.playbookSlug,
        },
      });

      if (authErr || !authResult?.user) {
        console.error("[provision] createUser failed:", authErr);
        return new Response(
          JSON.stringify({ error: "Failed to create account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = authResult.user.id;

      // Resolve the new org_id from public.users (retry for replication lag).
      for (let i = 0; i < 5; i++) {
        const { data: u } = await supabase
          .from("users")
          .select("organization_id")
          .eq("id", userId)
          .maybeSingle();
        if (u?.organization_id) {
          orgId = u.organization_id;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      if (!orgId) {
        console.error("[provision] org not auto-created for user", userId);
        return new Response(
          JSON.stringify({ error: "Workspace creation lagged - please try again" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update the new org with a nicer name, source tag, and a trial window.
      //
      // Organic and community signups get 3 days to experience the value
      // before any card ask. Traffic we PAID for gets no trial: the wizard
      // shows them their ICP, their lead list and their sequence, and then
      // asks for the card. Setting trial_ends_at to now (rather than leaving
      // it null) means ProtectedRoute's existing expired-trial gate is the
      // backstop if they navigate straight into the app without checking out -
      // a null status would have handed them the product for free.
      const paidTraffic = (body.attribution as { paid?: boolean } | undefined)?.paid === true;
      const trialEndsAt = paidTraffic
        ? new Date().toISOString()
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("organizations")
        .update({
          name: workspaceName(body),
          subscription_status: "trialing",
          trial_ends_at: trialEndsAt,
          settings: {
            provisioned_from_playbook: body.playbookSlug,
            provisioned_at: new Date().toISOString(),
          },
        })
        .eq("id", orgId);
    }

    // 5. Insert seed artifact rows. Each is tagged so Batch 2 can replace.
    const tasksDone: Record<string, string> = { account: "done" };

    // 5a. ICP
    try {
      const icp = body.icp || {};
      const { error } = await supabase.from("library_icps").insert({
        organization_id: orgId,
        name: icp.name || `Ideal buyer · ${body.niche || "your niche"}`,
        summary: icp.summary || `From the ${body.playbookSlug || "playbook"}.`,
        description: icp.summary,
        pain_points: icp.pains || [],
        desires: icp.desires || [],
        objections: icp.objections || [],
        language_style: icp.language,
        target_title_keywords: rolesToArray(icp.roles),
        tags: ["from_playbook", body.playbookSlug].filter(Boolean) as string[],
      });
      if (error) throw error;
      tasksDone.icp = "done";
    } catch (e) {
      console.error("[provision] icp insert failed:", e);
      tasksDone.icp = "failed";
    }

    // 5b. Email sequence placeholder - no `description` column on this table.
    try {
      const { error } = await supabase.from("email_sequences").insert({
        organization_id: orgId,
        name: `${body.niche || "Outbound"} · starter sequence`,
        status: "draft",
        steps: [],
      });
      if (error) throw error;
      tasksDone.sequence = "done";
    } catch (e) {
      console.error("[provision] sequence insert failed (non-fatal):", e);
      tasksDone.sequence = "skipped";
    }

    // 5c. Content blueprint - runnable from day one (LinkedIn Post starter);
    // generate-playbook-artifacts later renames it and adds themes.
    try {
      const { error } = await supabase.from("blueprints").insert({
        organization_id: orgId,
        name: playbookLinkedInBlueprintName(body.niche),
        description: "Daily LinkedIn post · 3 themes · auto-publishes when approved.",
        ...playbookLinkedInBlueprintFields(),
      });
      if (error) throw error;
      tasksDone.blueprint = "done";
    } catch (e) {
      console.error("[provision] blueprint insert failed (non-fatal):", e);
      tasksDone.blueprint = "skipped";
    }

    // 5e. AI agent profile placeholder
    try {
      const { error } = await supabase.from("ai_agent_profiles").insert({
        organization_id: orgId,
        name: "Your AI agent",
        description: "Drafts replies, qualifies prospects, escalates to you.",
        is_default: true,
        config: { use_tone_profile: true } as Record<string, unknown>,
      });
      if (error) throw error;
      tasksDone.agent = "done";
    } catch (e) {
      console.error("[provision] agent insert failed (non-fatal):", e);
      tasksDone.agent = "skipped";
    }

    // 5f. Strategy doc placeholder
    try {
      const { error } = await supabase.from("library_strategy_documents").insert({
        organization_id: orgId,
        name: `${body.outcome || body.goal || "60-day plan"} · strategy doc`,
        document_type: "strategy",
        content: `Auto-generated from your ${body.playbookSlug || "playbook"}. Replace this with your real plan once you've reviewed.`,
      });
      if (error) throw error;
      tasksDone.strategy = "done";
    } catch (e) {
      console.error("[provision] strategy insert failed (non-fatal):", e);
      tasksDone.strategy = "skipped";
    }

    // 5g. Product placeholder (library_products) ----------------------------
    try {
      const { error } = await supabase.from("library_products").insert({
        organization_id: orgId,
        name: body.website ? body.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : `${body.fullName?.split(" ")[0] || "Your"} offer`,
        description: `Auto-extracted from ${body.website || "your inputs"}. Will be replaced after onboarding scrape.`,
      });
      if (error) throw error;
      tasksDone.product = "done";
    } catch (e) {
      console.warn("[provision] product insert skipped:", e);
      tasksDone.product = "skipped";
    }

    // 5h. Knowledge entries placeholder (library_strategy_documents tagged) -
    try {
      const { error } = await supabase.from("library_strategy_documents").insert({
        organization_id: orgId,
        name: "Knowledge base · seed",
        document_type: "knowledge",
        content: "Pending - knowledge entries (offer, voice, social proof) will be generated from your website.",
        tags: ["onboarding", "knowledge"],
      });
      if (error) throw error;
      tasksDone.knowledge = "done";
    } catch (e) {
      console.warn("[provision] knowledge insert skipped:", e);
      tasksDone.knowledge = "skipped";
    }

    // 5i. LinkedIn audit placeholder ----------------------------------------
    if (body.linkedinUrl) {
      try {
        const { error } = await supabase.from("linkedin_audits").insert({
          organization_id: orgId,
          linkedin_url: body.linkedinUrl,
          status: "pending",
        });
        if (error) throw error;
        tasksDone.audit = "done";
      } catch (e) {
        console.warn("[provision] audit insert skipped:", e);
        tasksDone.audit = "skipped";
      }
    } else {
      tasksDone.audit = "skipped";
    }

    // 5j. Content plan placeholder (library_strategy_documents) -------------
    try {
      const { error } = await supabase.from("library_strategy_documents").insert({
        organization_id: orgId,
        name: "30-day content plan",
        document_type: "content_plan",
        content: "Pending - 3-theme × 30-day calendar will be generated from your ICP + goal.",
        tags: ["onboarding", "content_plan"],
      });
      if (error) throw error;
      tasksDone.content_plan = "done";
    } catch (e) {
      console.warn("[provision] content_plan insert skipped:", e);
      tasksDone.content_plan = "skipped";
    }

    // 5k. LinkedIn campaign placeholder -------------------------------------
    try {
      const { error } = await supabase.from("linkedin_campaigns").insert({
        organization_id: orgId,
        name: `${body.niche || body.goal || "Outbound"} · LinkedIn campaign`,
        description: "Auto-built from your sequence. Connect → wait 2d → DM → wait 3d → switch to email.",
        status: "draft",
        sequence_nodes: [],
        sequence_edges: [],
      });
      if (error) throw error;
      tasksDone.campaign = "done";
    } catch (e) {
      console.warn("[provision] campaign insert skipped:", e);
      tasksDone.campaign = "skipped";
    }

    // 6. Insert provisioning_jobs row - first reserve the id so we can sign a token
    const jobId = crypto.randomUUID();
    const provisioningToken = await signProvisioningToken(jobId, orgId);

    // Reset artifact tasks to "pending" - generate-playbook-artifacts will
    // run real LLM generation during the wizard's build step and flip these
    // to "done" as it goes. Only `account` stays "done" up front.
    for (const k of [
      "icp",
      "product",
      "knowledge",
      "audit",
      "sequence",
      "blueprint",
      "campaign",
      "content_plan",
      "agent",
      "strategy",
    ]) {
      if (tasksDone[k] === "done") tasksDone[k] = "pending";
    }
    const status = "running";

    const { error: jobErr } = await supabase.from("provisioning_jobs").insert({
      id: jobId,
      lead_id: leadId,
      user_id: userId,
      organization_id: orgId,
      playbook_slug: body.playbookSlug,
      status,
      current_task: "queued",
      tasks_done: tasksDone,
      provisioning_token: provisioningToken,
    });

    if (jobErr) {
      console.error("[provision] job insert failed:", jobErr);
      return new Response(
        JSON.stringify({ error: "Failed to record provisioning job" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Update lead with org_id
    await supabase
      .from("playbook_leads")
      .update({ organization_id: orgId })
      .eq("id", leadId);

    // 7. Stamp attribution on the org too. The lead carries it for reporting,
    //    but access rules (paid traffic pays up front, organic keeps the trial)
    //    are evaluated against the organization, so it needs to live here as
    //    well. Never overwrite an existing value - first touch wins.
    if (body.attribution) {
      try {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("attribution")
          .eq("id", orgId)
          .maybeSingle();
        if (!orgRow?.attribution) {
          await supabase.from("organizations").update({ attribution: body.attribution }).eq("id", orgId);
        }
      } catch (e) {
        console.warn("[provision] attribution stamp skipped:", e);
      }
    }

    // 7a. The /get-started wizard IS onboarding for these users - it is the
    //     canonical path for anyone arriving from the marketing site. Mark the
    //     org onboarded so ProtectedRoute drops them straight on /campaigns
    //     after magic-link sign-in instead of bouncing them into the in-app
    //     /onboarding wizard, which is a content-persona flow and the wrong
    //     product for someone who just signed up to book meetings.
    //     /onboarding remains canonical only for direct /auth signups.
    try {
      await supabase
        .from("organization_settings")
        .upsert({
          organization_id: orgId,
          onboarding_completed: true,
          onboarding_step: "success",
          setup_completed: true,
        }, { onConflict: "organization_id" });
    } catch (e) {
      console.warn("[provision] organization_settings upsert skipped:", e);
    }

    // 7b. Detect existing API keys so the wizard can skip those steps.
    const { data: existingKeys } = await supabase
      .from("api_keys")
      .select("provider")
      .eq("organization_id", orgId);
    const existingProviders = (existingKeys || []).map((k) => k.provider);

    // 8. Best-effort: add to Resend audience. Idempotent - if submit-playbook-lead
    //    already added them this is a no-op (Resend returns 409 on dupes).
    addContactToResendAudience({
      email: body.email,
      fullName: body.fullName,
      metadata: { leadId, organizationId: orgId, playbookSlug: body.playbookSlug },
    }).catch((e) =>
      console.error("[provision] audience add failed:", e)
    );

    return new Response(
      JSON.stringify({
        jobId,
        organizationId: orgId,
        provisioningToken,
        userId,
        taskKeys: TASK_KEYS,
        tasksDone,
        returningUser,
        existingProviders,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[provision] uncaught error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
