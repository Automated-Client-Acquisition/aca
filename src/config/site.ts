/**
 * Public addresses of this ACA install, for the frontend.
 *
 * Set with VITE_* variables at build time. The defaults are ACA Cloud's own
 * addresses, so ACA Cloud builds unchanged with none of them set; a
 * self-hosted install sets them to its own domains. The edge functions read
 * the same settings in supabase/functions/_shared/site-config.ts.
 */

const env = import.meta.env;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * True on a self-hosted install (VITE_ACA_SELF_HOSTED=true). Hides what only
 * exists on ACA Cloud: billing, the trial, plan quotas, the Skool community
 * and the ACA Network settings tab (a self-hosted install reaches the network
 * with an API key instead). The edge functions read ACA_SELF_HOSTED.
 */
export const SELF_HOSTED = (env.VITE_ACA_SELF_HOSTED as string | undefined) === "true";

/** This install's Supabase project (already required by the Supabase client). */
export const SUPABASE_URL = trimSlash((env.VITE_SUPABASE_URL as string | undefined) ?? "");

/** Edge functions base, e.g. for webhook and OAuth callback URLs users paste elsewhere. */
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

/** The public website: canonical URLs, structured data, sitemap submission. */
export const PUBLIC_SITE_URL = trimSlash(
  (env.VITE_PUBLIC_SITE_URL as string | undefined) || "https://www.automatedclientacquisition.com",
);

/** The public REST API host (/v1). */
export const API_URL = trimSlash(
  (env.VITE_API_URL as string | undefined) || "https://api.automatedclientacquisition.com",
);

/** MCP server URL for clients that authenticate with an API key. */
export const MCP_SERVER_URL =
  (env.VITE_MCP_SERVER_URL as string | undefined) || `${PUBLIC_SITE_URL}/api/mcp`;

export const SUPPORT_EMAIL =
  (env.VITE_SUPPORT_EMAIL as string | undefined) || "support@automatedclientacquisition.com";

export const BILLING_EMAIL =
  (env.VITE_BILLING_EMAIL as string | undefined) || "billing@automatedclientacquisition.com";

/**
 * Public storage that hosts ACA's shared assets: starter-pack character
 * images and the sound effects library. It defaults to ACA Cloud's public
 * buckets, which any install can load from; point it elsewhere to self-host
 * the files too.
 */
export const ACA_ASSETS_URL = trimSlash(
  (env.VITE_ACA_ASSETS_URL as string | undefined) ||
    "https://neqyerjlcrxjsgkhxalx.supabase.co/storage/v1/object/public",
);
