/**
 * Curated bare-metal hosting providers for BYO email infrastructure.
 *
 * Each entry includes:
 *   - The minimum spec config we recommend for cold email
 *   - Port 25 default state and what to do if it isn't open
 *   - BGP / BYOIP support level for users bringing their own /24 from IPXO etc.
 *   - Affiliate URL — replace the placeholder ID per provider once the
 *     affiliate program is signed up. The query parameter scheme below
 *     matches each provider's documented referral system.
 *
 * To add a provider: add to BYO_HOSTING_PROVIDERS, run an audit pass on the
 * BYO connect wizard's PROVIDERS list to mirror it, and document any
 * provider-specific quirks in the PtrSetupHint config too.
 */

import type { ByoProviderHint } from "@/types/email";

export type BgpSupport = "native" | "byoip-rewrite" | "vrack" | "request" | "none";
export type Port25Default = "open" | "request" | "blocked";

export interface ByoHostingProvider {
  id: ByoProviderHint;
  name: string;
  region: "EU" | "US" | "Global";
  startingPriceEur: number;
  recommendedSku: string;
  port25: Port25Default;
  bgpSupport: BgpSupport;
  /** Public-facing URL with affiliate / referral parameter applied at render time */
  affiliateBaseUrl: string;
  /**
   * Affiliate ID env-var or hardcoded (set per-deploy). The actual ID value
   * lives in `import.meta.env.VITE_AFFILIATE_<PROVIDER>` so each customer or
   * white-label tenant can override it without forking the codebase.
   */
  affiliateParam: string;
  bestFor: string[];
  notes: string;
  /** Human-readable rendering of monthly cost expectation. */
  costNote: string;
}

/**
 * Resolve the affiliate-tracked URL for a provider. The actual affiliate ID
 * comes from a build-time env var (e.g. VITE_AFFILIATE_OVH). When the env
 * var is missing we fall back to the bare URL so we don't break the link
 * when affiliate IDs aren't yet configured.
 */
export function getAffiliateUrl(provider: ByoHostingProvider): string {
  const envKey = `VITE_AFFILIATE_${provider.id.toUpperCase().replace(/-/g, "_")}`;
  // deno-lint-ignore no-explicit-any
  const id = (import.meta as any).env?.[envKey] as string | undefined;
  if (!id) return provider.affiliateBaseUrl;
  const sep = provider.affiliateBaseUrl.includes("?") ? "&" : "?";
  return `${provider.affiliateBaseUrl}${sep}${provider.affiliateParam}=${encodeURIComponent(id)}`;
}

export const BYO_HOSTING_PROVIDERS: ByoHostingProvider[] = [
  {
    id: "other",
    name: "Worldstream",
    region: "EU",
    startingPriceEur: 33,
    recommendedSku: "Server Deals — entry config (32GB+ RAM, NVMe)",
    port25: "open",
    bgpSupport: "byoip-rewrite",
    affiliateBaseUrl: "https://www.worldstream.com/dedicated-servers/server-deals",
    affiliateParam: "ref",
    bestFor: ["Cold email at scale", "BYOIP via IPXO", "Mail-friendly host"],
    notes:
      "Standard mail-ops choice. Port 25 open by default. Brings your own /24 in via their network announcement (no BGP knowledge required).",
    costNote: "From €33/mo + €10/mo BYOIP service fee",
  },
  {
    id: "ovh",
    name: "OVH (Rise / Eco)",
    region: "EU",
    startingPriceEur: 40,
    recommendedSku: "Rise-2 — AMD Ryzen 7700 / 64GB / 2x512GB NVMe",
    port25: "open",
    bgpSupport: "vrack",
    affiliateBaseUrl: "https://eco.ovhcloud.com/en/rise/",
    affiliateParam: "rid",
    bestFor: ["Larger configs at competitive price", "EU coverage", "OVH ecosystem"],
    notes:
      "Port 25 open by default on bare metal. BGP via vRack (additional config). Larger vendor — slower support but very stable.",
    costNote: "From €40/mo (€42 for Rise-2)",
  },
  {
    id: "hetzner",
    name: "Hetzner Dedicated",
    region: "EU",
    startingPriceEur: 45,
    recommendedSku: "EX44 — Intel i5-13500 / 64GB / 2x512GB NVMe",
    port25: "request",
    bgpSupport: "request",
    affiliateBaseUrl: "https://www.hetzner.com/dedicated-rootserver",
    affiliateParam: "ref",
    bestFor: ["Cheapest reliable EU provider", "Solid reputation IP space"],
    notes:
      "Cheapest option but port 25 requires a support ticket on activation (usually 12-24h to confirm). BGP available on dedicated servers via support.",
    costNote: "From €45/mo + €39 setup",
  },
  {
    id: "other",
    name: "FDC Servers",
    region: "US",
    startingPriceEur: 50,
    recommendedSku: "Entry bare metal — Chicago or Ashburn DC",
    port25: "open",
    bgpSupport: "native",
    affiliateBaseUrl: "https://www.fdcservers.net/dedicated-servers",
    affiliateParam: "ref",
    bestFor: ["US-region IPs", "BGP-friendly", "Mail-tolerant abuse policy"],
    notes:
      "US bare metal with port 25 open by default. Native BGP support. Recommended when sending to US recipients with US-allocated /24.",
    costNote: "From $55/mo",
  },
  {
    id: "other",
    name: "Hivelocity",
    region: "US",
    startingPriceEur: 65,
    recommendedSku: "Bare metal — Tampa, NYC, or LAX",
    port25: "open",
    bgpSupport: "native",
    affiliateBaseUrl: "https://www.hivelocity.net/dedicated-servers/",
    affiliateParam: "ref",
    bestFor: ["US-region IPs", "Premium peering", "Enterprise SLA"],
    notes:
      "US bare metal, port 25 open. Better peering than FDC for premium use. More expensive.",
    costNote: "From $70/mo",
  },
  {
    id: "other",
    name: "Leaseweb",
    region: "Global",
    startingPriceEur: 50,
    recommendedSku: "Dedicated — NL/US/DE datacenter",
    port25: "open",
    bgpSupport: "native",
    affiliateBaseUrl: "https://www.leaseweb.com/dedicated-servers",
    affiliateParam: "ref",
    bestFor: ["Multi-region", "Global presence", "Mail-friendly"],
    notes:
      "Solid global mail-friendly host. Port 25 open. Native BGP. Slightly slower provisioning than Worldstream.",
    costNote: "From €50/mo",
  },
];

/**
 * Pick a provider by region. Returns the cheapest mail-friendly recommendation
 * for the requested region, or Worldstream as a global default.
 */
export function recommendByRegion(region: "EU" | "US" | "Global"): ByoHostingProvider {
  if (region === "US") {
    return BYO_HOSTING_PROVIDERS.find((p) => p.name === "FDC Servers") ?? BYO_HOSTING_PROVIDERS[0];
  }
  return BYO_HOSTING_PROVIDERS.find((p) => p.name === "Worldstream") ?? BYO_HOSTING_PROVIDERS[0];
}

export type BgpProvider = "ipxo" | "interlir" | "prefixbroker" | "heficed";

export interface BgpProviderInfo {
  id: BgpProvider;
  name: string;
  pricePerIpUsd: { min: number; max: number };
  monthlyForSlash24Usd: { min: number; max: number };
  termCommitment: "monthly" | "annual" | "multi-year";
  affiliateBaseUrl: string;
  affiliateParam: string;
  notes: string;
}

export const BGP_PROVIDERS: BgpProviderInfo[] = [
  {
    id: "ipxo",
    name: "IPXO",
    pricePerIpUsd: { min: 0.4, max: 0.6 },
    monthlyForSlash24Usd: { min: 100, max: 150 },
    termCommitment: "monthly",
    affiliateBaseUrl: "https://www.ipxo.com/marketplace/",
    affiliateParam: "ref",
    notes: "Largest marketplace. 97%+ auto-resolved abuse handling. Month-to-month leases.",
  },
  {
    id: "interlir",
    name: "InterLIR",
    pricePerIpUsd: { min: 0.3, max: 0.6 },
    monthlyForSlash24Usd: { min: 75, max: 150 },
    termCommitment: "monthly",
    affiliateBaseUrl: "https://interlir.com/",
    affiliateParam: "ref",
    notes: "Transparent clean-vs-dirty pricing. EU legal framework, RIPE-focused.",
  },
  {
    id: "prefixbroker",
    name: "Prefix Broker",
    pricePerIpUsd: { min: 0.5, max: 0.5 },
    monthlyForSlash24Usd: { min: 130, max: 130 },
    termCommitment: "multi-year",
    affiliateBaseUrl: "https://www.prefixbroker.com/lease-ipv4/",
    affiliateParam: "ref",
    notes: "Two-year minimum. Compliance-heavy. Good for established operations.",
  },
  {
    id: "heficed",
    name: "Heficed",
    pricePerIpUsd: { min: 0.4, max: 0.6 },
    monthlyForSlash24Usd: { min: 100, max: 150 },
    termCommitment: "monthly",
    affiliateBaseUrl: "https://www.heficed.com/",
    affiliateParam: "ref",
    notes: "Bundled with infrastructure across 9 locations. 15-20% holder fees.",
  },
];

export function getBgpAffiliateUrl(provider: BgpProviderInfo): string {
  const envKey = `VITE_AFFILIATE_${provider.id.toUpperCase()}`;
  // deno-lint-ignore no-explicit-any
  const id = (import.meta as any).env?.[envKey] as string | undefined;
  if (!id) return provider.affiliateBaseUrl;
  const sep = provider.affiliateBaseUrl.includes("?") ? "&" : "?";
  return `${provider.affiliateBaseUrl}${sep}${provider.affiliateParam}=${encodeURIComponent(id)}`;
}
