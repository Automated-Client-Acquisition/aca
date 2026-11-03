// ============================================================================
// create-billing-portal
// ----------------------------------------------------------------------------
// Authenticated. The currently-signed-in user (verified via Authorization
// header) requests a Stripe customer-portal session for their organization's
// stripe_customer_id. Returns a one-time URL the frontend redirects to.
//
// Used by /settings → Billing tab to let paying users manage card, plan,
// invoices, or cancel - all in Stripe's hosted portal.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import Stripe from "npm:stripe@^17.0.0";
import { APP_URL, hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  organizationId: string;
  returnUrl?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const hostedOnly = hostedOnlyResponse("Billing", corsHeaders);
  if (hostedOnly) return hostedOnly;

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body: Payload = await req.json();
    if (!body.organizationId) return json({ error: "organizationId required" }, 400);

    // Verify the caller is a member of the org.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authorization header required" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: member } = await svc
      .from("users")
      .select("organization_id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!member || member.organization_id !== body.organizationId) {
      return json({ error: "Not a member of this organization" }, 403);
    }

    const { data: org } = await svc
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", body.organizationId)
      .maybeSingle();
    if (!org?.stripe_customer_id) {
      return json({ error: "No Stripe customer on file. Add a card first." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe not configured" }, 500);

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-09-30.acacia" });

    const origin = req.headers.get("origin") || APP_URL;
    const returnUrl = body.returnUrl || `${origin}/settings?tab=billing`;

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id as string,
      return_url: returnUrl,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[create-billing-portal] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
