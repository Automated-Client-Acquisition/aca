// ============================================================================
// network-billing-setup
// ----------------------------------------------------------------------------
// Signed-in org owner/admin saves a card for ACA Network usage billing
// (tenants, later per-mailbox services). Returns a Stripe Checkout URL in
// setup mode: nothing is charged here. stripe-webhook handles
// checkout.session.completed with metadata.source = 'network_billing', makes
// the card the customer's default and stamps
// organizations.network_billing_ready_at.
//
// Reuses the org's existing Stripe customer when it has one (hosted orgs
// already do), so hosted and network billing land on the same customer.
//
// Session JWT only: an API token must not be able to start a card flow.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import Stripe from "npm:stripe@^17.0.0";
import { APP_URL, hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const hostedOnly = hostedOnlyResponse("ACA Network billing", corsHeaders);
  if (hostedOnly) return hostedOnly;

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authorization header required" }, 401);
    if (authHeader.replace(/^Bearer\s+/i, "").startsWith("aca_")) {
      return json({ error: "Sign in to the web app to add a card." }, 403);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
    const user = userData.user;

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userRow } = await svc
      .from("users")
      .select("organization_id, active_organization_id, impersonating_organization_id")
      .eq("id", user.id)
      .maybeSingle();
    // Same order as get_user_organization_id(), which request_network_access uses.
    const organizationId = userRow?.impersonating_organization_id ||
      userRow?.active_organization_id || userRow?.organization_id;
    if (!organizationId) return json({ error: "No active organization" }, 403);

    // get_user_org_role returns 'super_admin' for ACA staff instead of their org role.
    const { data: role } = await svc.rpc("get_user_org_role", {
      p_user_id: user.id,
      p_organization_id: organizationId,
    });
    if (!["owner", "admin", "super_admin"].includes(String(role ?? ""))) {
      return json({ error: "Only an organization owner or admin can add a billing card" }, 403);
    }

    const { data: org } = await svc
      .from("organizations")
      .select("id, name, stripe_customer_id, network_status")
      .eq("id", organizationId)
      .maybeSingle();
    if (!org) return json({ error: "Organization not found" }, 404);
    if (!["pending", "approved"].includes(org.network_status)) {
      return json({ error: "Apply for ACA Network access before adding a card." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe not configured" }, 500);
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-09-30.acacia" });

    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: org.name ?? undefined,
        metadata: { organization_id: org.id },
      });
      customerId = customer.id;
      const { error: saveErr } = await svc
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", org.id);
      if (saveErr) throw new Error(`Failed to save Stripe customer: ${saveErr.message}`);
    }

    const origin = req.headers.get("origin") || APP_URL;
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      currency: "usd",
      payment_method_types: ["card"],
      metadata: { source: "network_billing", organization_id: org.id },
      setup_intent_data: { metadata: { source: "network_billing", organization_id: org.id } },
      success_url: `${origin}/settings?tab=network&billing=saved`,
      cancel_url: `${origin}/settings?tab=network`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[network-billing-setup] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
