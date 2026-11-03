// ============================================================================
// create-trial-checkout
// ----------------------------------------------------------------------------
// Creates a Stripe Checkout session for the operator plan with a 3-day free
// trial. Card is collected up front so trial-to-paid converts automatically.
//
// Gated by the HMAC provisioning token issued by provision-playbook-workspace
// so the page can call this anonymously right after onboarding without
// exposing the service role key.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import Stripe from "npm:stripe@^17.0.0";
import { verifyProvisioningToken } from "../_shared/provisioning-token.ts";
import { APP_URL, hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  // Path 1: anonymous onboarding flow (kept for backwards compat - unused
  // now that card collection moved in-app, but the endpoint still accepts it).
  provisioningToken?: string;
  // Path 2: authenticated in-app flow (from the trial banner). The caller
  // is a logged-in member of organizationId; we verify membership before
  // creating the Stripe Checkout session.
  organizationId?: string;
  plan: "monthly" | "yearly";
  successUrl?: string;
  cancelUrl?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const hostedOnly = hostedOnlyResponse("Checkout", corsHeaders);
  if (hostedOnly) return hostedOnly;


  try {
    const body: Payload = await req.json();
    if (body.plan !== "monthly" && body.plan !== "yearly") {
      return json({ error: "plan must be 'monthly' or 'yearly'" }, 400);
    }

    // Resolve the organization either from a provisioning token (anonymous
    // onboarding flow) or from a logged-in user with org membership.
    let organizationId: string;
    if (body.provisioningToken) {
      try {
        const payload = await verifyProvisioningToken(body.provisioningToken);
        organizationId = payload.organizationId;
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Invalid token" }, 401);
      }
    } else if (body.organizationId) {
      // Auth path. The user must be a member of organizationId.
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Authorization header required" }, 401);

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

      // Service-role lookup of membership.
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
      organizationId = body.organizationId;
    } else {
      return json({ error: "Either provisioningToken or organizationId required" }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const monthlyPrice = Deno.env.get("STRIPE_PRICE_OPERATOR_MONTHLY");
    const yearlyPrice = Deno.env.get("STRIPE_PRICE_OPERATOR_YEARLY");
    if (!stripeKey) return json({ error: "Stripe not configured" }, 500);
    if (!monthlyPrice || !yearlyPrice) return json({ error: "Stripe price IDs not configured" }, 500);

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-09-30.acacia" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, stripe_customer_id, attribution")
      .eq("id", organizationId)
      .maybeSingle();
    if (!org) return json({ error: "Organization not found" }, 404);

    // Everyone gets 3 days. The difference for traffic we paid for is that
    // they must put a card down to start it, at the point where the wizard has
    // just shown them their ICP, their prospects and their sequence. $67 up
    // front was too big an ask of a stranger arriving from an ad.
    //
    // Derived from the ORG, never from the request body - a client-supplied
    // trial length would let anyone grant themselves one.
    const isPaidTraffic = (org.attribution as { paid?: boolean } | null)?.paid === true;
    const trialDays = 3;

    // Optional paid trial. Set STRIPE_PRICE_TRIAL_FEE to a ONE-TIME $1 price
    // and the trial becomes "$1 today, $67 in 3 days" instead of free-with-card.
    // A token charge validates the card and filters tyre-kickers, which a $0
    // authorisation does not. Absent the env var we simply run the free trial -
    // the copy is driven off the same flag, so it can never promise a $1 charge
    // that Stripe is not actually taking.
    const trialFeePrice = Deno.env.get("STRIPE_PRICE_TRIAL_FEE");

    // Look up the email from any member so Stripe can prefill it.
    const { data: member } = await supabase
      .from("users")
      .select("email")
      .eq("organization_id", org.id)
      .limit(1)
      .maybeSingle();

    const priceId = body.plan === "monthly" ? monthlyPrice : yearlyPrice;
    const planTier = body.plan === "monthly" ? "operator_monthly" : "operator_yearly";

    const origin = req.headers.get("origin") || APP_URL;
    const successUrl = body.successUrl || `${origin}/get-started?step=ready&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = body.cancelUrl || `${origin}/get-started?step=billing&canceled=1`;

    // Two shapes of 3-day trial:
    //
    //   free  - trial_period_days, nothing charged today, $67 on day 3.
    //   $1    - no trial_period_days. Instead the billing cycle is anchored 3
    //           days out with proration off, so the recurring charge starts
    //           then, and the one-time fee rides on the invoice Stripe raises
    //           immediately. That is what actually takes $1 today; a trial with
    //           an added invoice item would defer the fee to the trial's end.
    const anchor = Math.floor((Date.now() + trialDays * 24 * 3600 * 1000) / 1000);
    const lineItems = trialFeePrice
      ? [{ price: priceId, quantity: 1 }, { price: trialFeePrice, quantity: 1 }]
      : [{ price: priceId, quantity: 1 }];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: lineItems,
      subscription_data: {
        ...(trialFeePrice
          ? { billing_cycle_anchor: anchor, proration_behavior: "none" }
          : { trial_period_days: trialDays }),
        metadata: {
          organization_id: org.id,
          plan_tier: planTier,
          source: isPaidTraffic ? "onboarding_paid_traffic" : "onboarding",
          trial_shape: trialFeePrice ? "paid_1_dollar" : "free_card_required",
        },
      },
      customer: org.stripe_customer_id || undefined,
      customer_email: org.stripe_customer_id ? undefined : member?.email,
      payment_method_collection: "always",
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organization_id: org.id,
        plan_tier: planTier,
        source: "onboarding",
      },
    });

    return json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("[create-trial-checkout] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
