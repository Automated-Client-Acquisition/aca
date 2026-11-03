// ============================================================================
// linkedin-profile-fetch.ts
// ----------------------------------------------------------------------------
// Robust LinkedIn-profile fetcher used by the onboarding audit task and any
// downstream component that wants public profile data without requiring the
// user to have already connected their own Unipile/Apify accounts.
//
// Strategy:
//   1. Try Unipile (only works if the org already has unipile_accounts).
//   2. Fall back to harvestapi~linkedin-profile-scraper via the platform
//      APIFY_TOKEN env var (lets us audit on day-0 signup).
//   3. Return null if both fail - caller decides whether to skip or retry.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

export interface NormalizedProfile {
  source: "unipile" | "apify";
  url: string;
  full_name?: string;
  headline?: string;
  about?: string;
  location?: string;
  current_position?: string;
  current_company?: string;
  experience?: Array<{ title?: string; company?: string; duration?: string; description?: string }>;
  posts?: Array<{ text?: string; engagement?: number }>;
  has_banner?: boolean;
  has_photo?: boolean;
  follower_count?: number;
  connection_count?: number;
  raw?: Record<string, unknown>;
}

const HARVEST_ACTOR = "harvestapi~linkedin-profile-scraper";
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${HARVEST_ACTOR}/run-sync-get-dataset-items`;

/**
 * Try Unipile first (zero cost, instant if connected), then Apify (~15s,
 * costs a few cents per profile via the platform token).
 *
 * `orgId` is used to look up a per-org Apify token before falling back to
 * the platform one. Pass `null` to skip the per-org lookup.
 */
export async function fetchLinkedInProfile(
  supabase: SupabaseClient,
  linkedinUrl: string,
  orgId: string | null,
): Promise<NormalizedProfile | null> {
  if (!linkedinUrl) return null;

  // ── 1. Unipile ───────────────────────────────────────────────────────────
  if (orgId) {
    try {
      const { data, error } = await supabase.functions.invoke("unipile-fetch-profile", {
        body: { linkedinUrl, organizationId: orgId },
      });
      if (!error && data && typeof data === "object" && !(data as { error?: unknown }).error) {
        const u = data as Record<string, unknown>;
        return {
          source: "unipile",
          url: linkedinUrl,
          full_name: u.full_name as string | undefined,
          headline: u.headline as string | undefined,
          about: (u.summary || u.about) as string | undefined,
          location: u.location as string | undefined,
          current_position: u.current_position as string | undefined,
          current_company: u.current_company as string | undefined,
          experience: (u.experience as NormalizedProfile["experience"]) || undefined,
          posts: (u.posts as NormalizedProfile["posts"]) || undefined,
          has_banner: !!u.banner_url,
          has_photo: !!u.profile_picture_url,
          follower_count: u.followers as number | undefined,
          connection_count: u.connections as number | undefined,
          raw: u,
        };
      }
    } catch (e) {
      console.warn("[linkedin-profile-fetch] Unipile failed (non-fatal):", e);
    }
  }

  // ── 2. Apify harvestapi ─────────────────────────────────────────────────
  const apifyToken = await resolveApifyToken(supabase, orgId);
  if (!apifyToken) return null;

  try {
    const res = await fetch(`${RUN_SYNC_URL}?token=${encodeURIComponent(apifyToken)}&format=json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: [linkedinUrl],
        profileScraperMode: "Profile details no email ($4 per 1k)",
        maxItems: 1,
      }),
      // 60s ceiling on the sync call - harvestapi typically returns in 10-20s.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn("[linkedin-profile-fetch] Apify run failed:", res.status, await res.text());
      return null;
    }
    const items = await res.json() as Array<Record<string, unknown>>;
    const row = items?.[0];
    if (!row || row.error) return null;

    // harvestapi returns: firstName, lastName, headline, summary/about, location,
    // experience[], posts[], publicIdentifier, profilePicture, etc.
    const fullName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim()
                  || (row.fullName as string | undefined);
    return {
      source: "apify",
      url: linkedinUrl,
      full_name: fullName || undefined,
      headline: row.headline as string | undefined,
      about: (row.about || row.summary) as string | undefined,
      location: (row.location || row.locationName) as string | undefined,
      current_position: (row.position || row.currentPosition) as string | undefined,
      current_company: (row.companyName || row.currentCompany) as string | undefined,
      experience: (row.experience as NormalizedProfile["experience"]) || undefined,
      posts: (row.posts as NormalizedProfile["posts"]) || undefined,
      has_banner: !!row.backgroundImage || !!row.coverImage,
      has_photo: !!row.profilePicture || !!row.photoUrl,
      follower_count: row.followers as number | undefined,
      connection_count: row.connections as number | undefined,
      raw: row,
    };
  } catch (e) {
    console.warn("[linkedin-profile-fetch] Apify error:", e);
    return null;
  }
}

async function resolveApifyToken(
  supabase: SupabaseClient,
  orgId: string | null,
): Promise<string | null> {
  // Per-org token first (paid users who connected their own Apify).
  if (orgId) {
    const encryptionKey = Deno.env.get("ENCRYPTION_KEY");
    if (encryptionKey) {
      try {
        const { data } = await supabase
          .from("api_keys")
          .select("key_encrypted")
          .eq("organization_id", orgId)
          .eq("provider", "apify")
          .eq("is_valid", true)
          .maybeSingle();
        if (data?.key_encrypted) {
          const { decryptApiKey } = await import("./apify-leads-utils.ts");
          return decryptApiKey((data as { key_encrypted: string }).key_encrypted, encryptionKey);
        }
      } catch (e) {
        console.warn("[resolveApifyToken] per-org lookup failed:", e);
      }
    }
  }
  // Platform token - used for onboarding-time audits before the user pays.
  return Deno.env.get("APIFY_TOKEN") || Deno.env.get("APIFY_API_TOKEN") || null;
}

/**
 * Compact, prompt-ready summary of a profile that gives the LLM enough to
 * audit without dumping the full raw JSON.
 */
export function profileForPrompt(p: NormalizedProfile): string {
  const lines: string[] = [];
  if (p.full_name)        lines.push(`Name: ${p.full_name}`);
  if (p.headline)         lines.push(`Headline: ${p.headline}`);
  if (p.current_position || p.current_company) {
    lines.push(`Current role: ${[p.current_position, p.current_company].filter(Boolean).join(" @ ")}`);
  }
  if (p.location)         lines.push(`Location: ${p.location}`);
  if (typeof p.follower_count === "number")   lines.push(`Followers: ${p.follower_count}`);
  if (typeof p.connection_count === "number") lines.push(`Connections: ${p.connection_count}`);
  lines.push(`Has banner image: ${p.has_banner ? "yes" : "NO (missing)"}`);
  lines.push(`Has profile photo: ${p.has_photo ? "yes" : "NO (missing)"}`);
  if (p.about) {
    const trimmed = p.about.length > 1200 ? p.about.slice(0, 1200) + "…" : p.about;
    lines.push(`\nAbout section:\n${trimmed}`);
  } else {
    lines.push(`\nAbout section: EMPTY`);
  }
  if (p.experience?.length) {
    const top = p.experience.slice(0, 4).map((e) =>
      `- ${[e.title, e.company].filter(Boolean).join(" @ ")}${e.duration ? ` (${e.duration})` : ""}`
    ).join("\n");
    lines.push(`\nRecent experience:\n${top}`);
  }
  if (p.posts?.length) {
    const recent = p.posts.slice(0, 3).map((post, i) => {
      const txt = (post.text || "").slice(0, 280);
      return `Post ${i + 1}: ${txt}${post.engagement ? ` (engagement: ${post.engagement})` : ""}`;
    }).join("\n");
    lines.push(`\nRecent posts:\n${recent}`);
  } else {
    lines.push(`\nRecent posts: NONE visible`);
  }
  return lines.join("\n");
}
