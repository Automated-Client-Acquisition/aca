// ============================================================================
// get-provisioning-status
// ----------------------------------------------------------------------------
// Public endpoint (gated by provisioningToken). Returns the live state of a
// provisioning job for the wizard's build-step polling.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { verifyProvisioningToken } from "../_shared/provisioning-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { provisioningToken } = await req.json();
    if (!provisioningToken) {
      return new Response(
        JSON.stringify({ error: "provisioningToken required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload;
    try {
      payload = await verifyProvisioningToken(provisioningToken);
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

    const { data: job } = await supabase
      .from("provisioning_jobs")
      .select("status, current_task, tasks_done, error")
      .eq("id", payload.jobId)
      .maybeSingle();

    if (!job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Live previews for the build screen. These have to be served from here
    // rather than read from the browser: the visitor is still anonymous at this
    // point, and RLS on library_icps / linkedin_audits / lead_lists correctly
    // refuses anon reads - so the wizard's teasers silently rendered nothing.
    const done = (job.tasks_done || {}) as Record<string, string>;
    const orgId = payload.organizationId;
    const preview: Record<string, unknown> = {};

    if (done.icp === "done") {
      const { data: icp } = await supabase
        .from("library_icps")
        .select("name, summary")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (icp) preview.icp = { name: icp.name, summary: icp.summary };
    }

    if (done.audit === "done") {
      const { data: audit } = await supabase
        .from("linkedin_audits")
        .select("overall_score, headline_rewrite")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (audit) preview.audit = { overall: audit.overall_score ?? null, headline: audit.headline_rewrite ?? null };
    }

    if (done.leads === "done") {
      const { data: list } = await supabase
        .from("lead_lists")
        .select("id, lead_count")
        .eq("organization_id", orgId)
        .eq("source_type", "signal")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (list) {
        const { data: members } = await supabase
          .from("lead_list_members")
          .select("crm_contacts(company_name)")
          .eq("list_id", (list as { id: string }).id)
          .limit(3);
        preview.leads = {
          count: (list as { lead_count: number | null }).lead_count ?? 0,
          companies: (members || [])
            .map((m) => (m as { crm_contacts?: { company_name?: string } }).crm_contacts?.company_name)
            .filter(Boolean),
        };
      }
    }

    // Checkout terms come from the server so the button can never promise a
    // charge Stripe isn't taking. The wizard renders whatever this says.
    const checkout = {
      trialDays: 3,
      // Mirrors create-trial-checkout: a one-time fee price turns the free
      // card-required trial into a real $1 charge today.
      paidTrial: !!Deno.env.get("STRIPE_PRICE_TRIAL_FEE"),
      monthlyPrice: 67,
    };

    return new Response(
      JSON.stringify({ ...job, preview, checkout }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[get-provisioning-status] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
