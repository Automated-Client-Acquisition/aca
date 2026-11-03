// Creates the Stripe Checkout session for the $27 front-end funnels.
// Three offers share this function:
//   offer "sprint" (default) — the 5-Day Build Sprint (/sprint)
//   offer "kit"              — the Money Agent Kit (/kit)
//   offer "studio"           — the Faceless Channel Kit (/studio)
//
// One session carries the whole front-end order:
//   - <OFFER>_TICKET_PRICE_ID  $27 one-time
//   - BUMP_*_PRICE_ID          selected order bumps, one-time
//   - MEMBERSHIP_PRICE_ID      $67/mo recurring with a 30-day trial
// Stripe charges the one-time items immediately; the subscription starts
// billing when the trial ends — which is exactly the offer on the page
// ("$X once today, renews at $67/mo after 30 days").
//
// Required secrets: STRIPE_SECRET_KEY, MEMBERSHIP_PRICE_ID, SITE_URL, and per
// offer: SPRINT_TICKET_PRICE_ID + BUMP_RECORDINGS/SHIELD/MAPS_PRICE_ID, or
// KIT_TICKET_PRICE_ID + BUMP_SCRIPTS/SHIELD/ALL3_PRICE_ID, or
// STUDIO_TICKET_PRICE_ID + BUMP_TITLES/SHIELD/CONTENT2_PRICE_ID.

import Stripe from "npm:stripe@^17";
import { PUBLIC_SITE_URL, hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OFFERS: Record<
  string,
  { ticketEnv: string; bumpEnv: Record<string, string>; successPath: string; cancelPath: string }
> = {
  sprint: {
    ticketEnv: "SPRINT_TICKET_PRICE_ID",
    bumpEnv: {
      recordings: "BUMP_RECORDINGS_PRICE_ID",
      shield: "BUMP_SHIELD_PRICE_ID",
      maps: "BUMP_MAPS_PRICE_ID",
    },
    successPath: "/sprint/vault",
    cancelPath: "/sprint/order",
  },
  kit: {
    ticketEnv: "KIT_TICKET_PRICE_ID",
    bumpEnv: {
      scripts: "BUMP_SCRIPTS_PRICE_ID",
      shield: "BUMP_SHIELD_PRICE_ID",
      all3: "BUMP_ALL3_PRICE_ID",
    },
    successPath: "/kit/vault",
    cancelPath: "/kit/order",
  },
  studio: {
    ticketEnv: "STUDIO_TICKET_PRICE_ID",
    bumpEnv: {
      titles: "BUMP_TITLES_PRICE_ID",
      shield: "BUMP_SHIELD_PRICE_ID",
      content2: "BUMP_CONTENT2_PRICE_ID",
    },
    successPath: "/studio/vault",
    cancelPath: "/studio/order",
  },
  radar: {
    ticketEnv: "RADAR_TICKET_PRICE_ID",
    bumpEnv: {
      scripts: "BUMP_SIGNAL_SCRIPTS_PRICE_ID",
      shield: "BUMP_SHIELD_PRICE_ID",
      duo: "BUMP_OUTBOUND_DUO_PRICE_ID",
    },
    successPath: "/radar/vault",
    cancelPath: "/radar/order",
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const hostedOnly = hostedOnlyResponse("Checkout", corsHeaders);
  if (hostedOnly) return hostedOnly;

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { email?: string; bumps?: string[]; offer?: string; agent?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const offerKey = payload.offer && OFFERS[payload.offer] ? payload.offer : "sprint";
  const offer = OFFERS[offerKey];

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const ticketPrice = Deno.env.get(offer.ticketEnv);
  const membershipPrice = Deno.env.get("MEMBERSHIP_PRICE_ID");
  const siteUrl = Deno.env.get("SITE_URL") || PUBLIC_SITE_URL;

  if (!stripeKey || !ticketPrice || !membershipPrice) {
    return json({ error: "Checkout is not configured yet — missing Stripe secrets." }, 503);
  }

  const email = (payload.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "A valid email is required" }, 400);
  }

  const bumps = Array.isArray(payload.bumps) ? payload.bumps : [];
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: membershipPrice, quantity: 1 },
    { price: ticketPrice, quantity: 1 },
  ];
  for (const key of bumps) {
    const envKey = offer.bumpEnv[key];
    const priceId = envKey ? Deno.env.get(envKey) : undefined;
    if (!priceId) return json({ error: `Unknown or unconfigured bump: ${key}` }, 400);
    lineItems.push({ price: priceId, quantity: 1 });
  }

  // agent = which agent a Kit buyer picked (fulfillment reads it from metadata)
  const metadata = {
    funnel: offerKey,
    bumps: bumps.join(","),
    agent: (payload.agent || "").slice(0, 40),
  };

  const stripe = new Stripe(stripeKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: lineItems,
      subscription_data: { trial_period_days: 30, metadata },
      allow_promotion_codes: false,
      success_url: `${siteUrl}${offer.successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${offer.cancelPath}`,
      metadata,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error("create-sprint-checkout error:", err);
    const message = err instanceof Error ? err.message : "Stripe error";
    return json({ error: message }, 500);
  }
});
