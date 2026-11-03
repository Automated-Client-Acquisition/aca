// ============================================================================
// request-workspace-magic-link
// ----------------------------------------------------------------------------
// Public endpoint. Verifies a provisioning_token, then mints a magic-link
// for the just-provisioned user so they land in the app authenticated.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { verifyProvisioningToken } from "../_shared/provisioning-token.ts";
import { APP_URL } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MagicLinkPayload {
  provisioningToken: string;
  redirectTo?: string;
  /** Caller's window.location.origin, used to build the default deep link
   * when redirectTo isn't explicitly provided. */
  origin?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: MagicLinkPayload = await req.json();
    if (!body.provisioningToken) {
      return new Response(
        JSON.stringify({ error: "provisioningToken required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload;
    try {
      payload = await verifyProvisioningToken(body.provisioningToken);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up the user from the provisioning_jobs row
    const { data: job, error: jobErr } = await supabase
      .from("provisioning_jobs")
      .select("user_id, organization_id")
      .eq("id", payload.jobId)
      .maybeSingle();

    if (jobErr || !job?.user_id) {
      return new Response(
        JSON.stringify({ error: "Provisioning job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("email")
      .eq("id", job.user_id)
      .maybeSingle();

    if (!userRow?.email) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fall back through the URL conventions already used in this codebase.
    // Prefer the caller's own origin (works for localhost dev too) over the
    // env defaults, which only make sense for production.
    const baseUrl =
      body.origin ||
      Deno.env.get("APP_BASE_URL") ||
      Deno.env.get("PUBLIC_APP_URL") ||
      Deno.env.get("APP_URL") ||
      Deno.env.get("SITE_URL") ||
      APP_URL;

    // Deep-link to the actual deliverable instead of a generic page - /jobs
    // is the unrelated content-generation queue and never read ?onboarded=1.
    // Prefer the prospect list this job built; fall back to /jobs only if
    // there isn't one (e.g. no linkedinUrl/website meant it couldn't build one).
    let redirectTo = body.redirectTo;
    if (!redirectTo) {
      const { data: list } = await supabase
        .from("lead_lists")
        .select("id")
        .eq("organization_id", job.organization_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      redirectTo = list?.id
        ? `${baseUrl}/leads/lists/${list.id}?onboarded=1`
        : `${baseUrl}/jobs?onboarded=1`;
    }

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: userRow.email,
      options: { redirectTo },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      console.error("[magic-link] generateLink failed:", linkErr);
      return new Response(
        JSON.stringify({ error: "Failed to create magic link" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ url: linkData.properties.action_link }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[magic-link] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
