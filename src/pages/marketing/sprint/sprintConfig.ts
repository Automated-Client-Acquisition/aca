// Central config for the $27 First Client Machine Sprint funnel.
// Prices shown on pages MUST match the Stripe prices wired in
// supabase/functions/create-sprint-checkout - change them together.

export const SPRINT = {
  // Next cohort. Update monthly (or wire to a DB row later).
  startLabel: "Monday, July 13",
  doorsCloseLabel: "Sunday night, July 12",
  seatsLabel: "100 builders",

  price: 27,
  renewalPrice: 67, // ACA Xtreme monthly after the included 30 days

  bumps: {
    recordings: { price: 17, label: "Lifetime Sprint Recordings" },
    shield: { price: 27, label: "The Deliverability Shield" },
    maps: { price: 37, label: "The Maps Lead Machine" },
  },

  oto1: { price: 147, downsellLabel: "3 payments of $57" },
  oto2: { price: 97, seats: 15 },
} as const;

// Offer B (A/B test vs the Sprint): the Money Agent Kit - instant-access
// product, broader avatar ("build agents that make money, the easy way",
// B2B + B2C), same continuity (30 days included, renews $67/mo).
export const KIT = {
  price: 27,
  renewalPrice: 67,
  bumps: {
    scripts: { price: 17, label: "The First Client Scripts" },
    shield: { price: 27, label: "The Deliverability Shield" },
    all3: { price: 37, label: "The Other Two Agents" },
  },
  oto1: { price: 147, downsellLabel: "3 payments of $57" },
  oto2: { price: 97, seats: 20 },
} as const;

// Offer C (second cold front door, DIFFERENT avatar than the Kit - faceless
// YouTube / content creators, not local-lead agencies): the Faceless Channel
// Kit. Pre-picks the YouTube Automation Agent; same $27 + $67/mo continuity so
// the whole ladder/checkout stays identical, bumps re-themed to content.
export const STUDIO = {
  price: 27,
  renewalPrice: 67,
  bumps: {
    titles: { price: 17, label: "The Viral Title & Thumbnail Pack" },
    shield: { price: 27, label: "The Monetization Shield" },
    content2: { price: 37, label: "The Other Two Content Agents" },
  },
  oto1: { price: 147, downsellLabel: "3 payments of $57" },
  oto2: { price: 97, seats: 20 },
} as const;

// Offer D (third cold front door, DIFFERENT avatar again - B2B founders,
// consultants and agencies who want warm pipeline for their OWN business,
// not an opportunity to sell leads): the Buying Signals Kit at /radar.
// Pre-picks the Buying Signals Agent; same $27 + $67/mo continuity.
export const RADAR = {
  price: 27,
  renewalPrice: 67,
  bumps: {
    scripts: { price: 17, label: "The Signal Scripts" },
    shield: { price: 27, label: "The Deliverability Shield" },
    duo: { price: 37, label: "The Other Two Outbound Agents" },
  },
  oto1: { price: 147, downsellLabel: "3 payments of $57" },
  oto2: { price: 97, seats: 20 },
} as const;

// Where the order form posts to create a Stripe Checkout session.
export const CHECKOUT_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-sprint-checkout`;

// One-click OTOs come later; v1 uses Stripe Payment Links you create in the
// dashboard and paste here. Empty string hides the buy button (decline path
// still works) so the funnel can ship before the links exist.
export const OTO1_PAYMENT_LINK = "";
export const OTO1_DOWNSELL_PAYMENT_LINK = "";
export const OTO2_PAYMENT_LINK = "";

export const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";
