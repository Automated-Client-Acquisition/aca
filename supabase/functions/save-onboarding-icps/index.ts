// ============================================================================
// save-onboarding-icps
// ----------------------------------------------------------------------------
// Public endpoint (gated by provisioningToken). Persists the user's edited
// ICPs from the wizard's ICP step into library_icps. Replaces any prior
// from_playbook ICPs so re-saves are idempotent.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { verifyProvisioningToken } from "../_shared/provisioning-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IcpInput {
  name?: string;
  summary?: string;
  industry?: string;
  roles?: string;
  size?: string;
  pains?: string[];
  desires?: string[];
  objections?: string[];
  language?: string;
  label?: string;
  role?: "primary_buyer" | "secondary_buyer";
  audience_type?: "b2b_clients" | "b2b_professionals";
}

function rolesToArray(s?: string): string[] {
  if (!s) return [];
  return s.split(/[,;]/).map((r) => r.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { provisioningToken, icps, fitWarning } = await req.json() as {
      provisioningToken: string;
      icps: IcpInput[];
      fitWarning?: { level: string; reason: string } | null;
    };

    if (!provisioningToken) {
      return new Response(JSON.stringify({ error: "provisioningToken required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Array.isArray(icps) || icps.length === 0) {
      return new Response(JSON.stringify({ error: "icps required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let payload;
    try { payload = await verifyProvisioningToken(provisioningToken); }
    catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Idempotent: drop prior playbook-tagged ICPs, then insert the new set.
    await supabase
      .from("library_icps")
      .delete()
      .eq("organization_id", payload.organizationId)
      .contains("tags", ["from_playbook"]);

    const rows = icps.slice(0, 2).map((icp, i) => {
      const isPrimary = (icp.role ?? (i === 0 ? "primary_buyer" : "secondary_buyer")) === "primary_buyer";
      return {
        organization_id: payload.organizationId,
        name: icp.name || (isPrimary ? "Primary buyer" : "Secondary buyer"),
        summary: icp.summary || "",
        description: icp.summary || "",
        pain_points: icp.pains || [],
        desires: icp.desires || [],
        objections: icp.objections || [],
        language_style: icp.language || null,
        target_title_keywords: rolesToArray(icp.roles),
        is_default: isPrimary,
        tags: [
          "from_playbook",
          isPrimary ? "primary_buyer" : "secondary_buyer",
          `audience:${icp.audience_type || "b2b_clients"}`,
          icp.label ? `label:${icp.label}` : null,
        ].filter(Boolean) as string[],
      };
    });

    const { data: inserted, error } = await supabase
      .from("library_icps")
      .insert(rows)
      .select("id");

    if (error) {
      console.error("[save-onboarding-icps] insert failed:", error);
      return new Response(JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Stash fit_warning on the job row so generate-playbook-artifacts can read it.
    if (fitWarning) {
      const { data: cur } = await supabase
        .from("provisioning_jobs")
        .select("tasks_done")
        .eq("id", payload.jobId)
        .maybeSingle();
      const td = (cur?.tasks_done || {}) as Record<string, unknown>;
      td.fit_warning = fitWarning;
      await supabase.from("provisioning_jobs").update({ tasks_done: td }).eq("id", payload.jobId);
    }

    return new Response(JSON.stringify({ ok: true, count: inserted?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[save-onboarding-icps] uncaught:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
