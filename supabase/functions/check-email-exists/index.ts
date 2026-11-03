// ============================================================================
// check-email-exists
// ----------------------------------------------------------------------------
// Anonymous, public. Given an email, returns whether a user already exists,
// and (if so) their first name + workspace name. Used by the /get-started
// wizard so we can show a "welcome back, sign in instead?" fork at the
// email step before the user commits to running provisioning a second time.
//
// Returns the same shape whether the user exists or not (no enumeration risk
// beyond what the existing signup flow already exposes - and any email
// previously used for ACA support, marketing, or playbook signup is already
// trivially discoverable via the auth/magic-link surface).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@^2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  email: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: Payload = await req.json();
    if (!body.email || !isValidEmail(body.email)) {
      return json({ exists: false });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: user } = await supabase
      .from("users")
      .select("id, full_name, organization_id")
      .eq("email", body.email.trim().toLowerCase())
      .maybeSingle();

    if (!user?.id) return json({ exists: false });

    let orgName: string | null = null;
    if (user.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", user.organization_id)
        .maybeSingle();
      orgName = (org?.name as string) || null;
    }

    const firstName = ((user.full_name as string) || "").split(" ")[0] || null;
    return json({ exists: true, firstName, orgName });
  } catch (e) {
    console.error("[check-email-exists] error:", e);
    return json({ exists: false });
  }
});
