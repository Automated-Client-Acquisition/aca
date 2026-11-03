/**
 * Public addresses of this ACA install, in one place.
 *
 * Every value can be set per deployment (Supabase → Edge Functions → Secrets).
 * The defaults are ACA Cloud's own addresses, so ACA Cloud runs unchanged with
 * none of them set; a self-hosted install sets them to its own domains.
 *
 * Production (2026-11-02) sets APP_URL (the apex domain) but none of the other
 * variables below, so the defaults are what it uses for those.
 */

function env(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Where users open the app: links in emails, OAuth and checkout redirects. */
export const APP_URL = trimSlash(env("APP_URL") ?? "https://automatedclientacquisition.com");

/**
 * The public website: canonical URLs, SEO, email footers, the logo in emails.
 * Kept separate from APP_URL because ACA Cloud's site is on www while APP_URL
 * is the apex.
 */
export const PUBLIC_SITE_URL = trimSlash(
  env("PUBLIC_SITE_URL") ?? "https://www.automatedclientacquisition.com",
);

/** PUBLIC_SITE_URL's host, e.g. www.automatedclientacquisition.com. */
export const PUBLIC_SITE_HOST = new URL(PUBLIC_SITE_URL).host;

/** The host to show people in email footers, without "www.". */
export const PUBLIC_SITE_DISPLAY = PUBLIC_SITE_HOST.replace(/^www\./, "");

/** Remote MCP server (OAuth clients such as Claude and Cursor connect here). */
export const MCP_URL = trimSlash(env("MCP_URL") ?? "https://mcp.automatedclientacquisition.com");

/**
 * Domain transactional email is sent from. It must be verified with the email
 * provider (Resend): an unverified sender fails with a status code, not an
 * exception, so a wrong value here fails quietly.
 */
export const EMAIL_FROM_DOMAIN = env("EMAIL_FROM_DOMAIN") ?? "notifications.automatedclientacquisition.com";

/** Product name shown as the sender of system email. */
export const BRAND_NAME = env("BRAND_NAME") ?? "ACA";

/** Where users write for help. */
export const SUPPORT_EMAIL = env("SUPPORT_EMAIL") ?? "support@automatedclientacquisition.com";

/** The team address that owns infrastructure orders (e.g. Pax8 tenant orders). */
export const OPS_EMAIL = env("OPS_EMAIL") ?? "team@automatedclientacquisition.com";

/**
 * ACA's own organization: the public signals feed, website leads and shared
 * image assets. Unset on a self-hosted install, where those ACA-only features
 * have no org to write to. ACA Cloud is at Supabase's 100-secret limit, so it
 * keeps the value in SITE_LEAD_ORG_ID, which already holds the same id.
 */
export const HOUSE_ORG_ID = env("ACA_HOUSE_ORG_ID") ?? env("SITE_LEAD_ORG_ID") ?? "";

/** Where operator notices go: health alerts, in-app feedback, forwarded contact@ mail. */
export const OPS_ALERT_EMAIL = env("OPS_ALERT_EMAIL") ?? OPS_EMAIL;

/** Host serving unsubscribe and tracking links when an org has no verified tracking domain. */
export const TRACKING_HOST = env("UNSUBSCRIBE_FALLBACK_HOST") ?? "t.automatedclientacquisition.com";

/**
 * True on a self-hosted install (ACA_SELF_HOSTED=true). Switches off what only
 * works against ACA Cloud's own accounts: Stripe billing, Pax8 tenant ordering
 * and the Skool community. The frontend reads VITE_ACA_SELF_HOSTED.
 */
export const SELF_HOSTED = env("ACA_SELF_HOSTED") === "true";

/**
 * For functions that only make sense on ACA Cloud: a clear 404 on a
 * self-hosted install instead of a failure on a missing Stripe or Skool key.
 * Returns null on ACA Cloud, so callers do `if (r) return r;`.
 */
export function hostedOnlyResponse(feature: string, headers: Record<string, string> = {}): Response | null {
  if (!SELF_HOSTED) return null;
  return new Response(
    JSON.stringify({ error: `${feature} is only available on ACA Cloud, not on a self-hosted install.` }),
    { status: 404, headers: { ...headers, "Content-Type": "application/json" } },
  );
}

/**
 * A setting with no sensible default (worker URLs and the like). Read where it
 * is used rather than at module load, so one missing value fails the call that
 * needs it with a clear message instead of taking the whole function down.
 */
export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not set. Add it under Supabase → Edge Functions → Secrets.`);
  return value;
}

/** The lead pool query worker (Fly app aca-lead-pool-query on ACA Cloud). */
export function poolQueryWorkerUrl(): string {
  return trimSlash(requireEnv("POOL_QUERY_WORKER_URL"));
}

/** "BRAND <local@EMAIL_FROM_DOMAIN>", e.g. fromAddress("team") → "ACA <team@notifications.…>". */
export function fromAddress(localPart: string, displayName: string = BRAND_NAME): string {
  return `${displayName} <${localPart}@${EMAIL_FROM_DOMAIN}>`;
}
