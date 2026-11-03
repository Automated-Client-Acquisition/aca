// Imports an image from an external URL (e.g. Replicate's temp signed URLs)
// into ACA's storage + library_saved_content table. Returns a permanent URL.
//
// Used by the autoblog cloud routine, which generates hero images on Replicate
// but cannot fetch the temp URL bytes from its sandbox network. This function
// fetches server-side (no sandbox), persists the image, and returns the
// permanent URL the routine writes into the post's coverImage field.
//
// No JWT required — the function is gated by:
//   1. Source URL host whitelist (Replicate domains only)
//   2. Content-Type validation (must be image/*)
//   3. Size limit (10 MB)
//
// This means anyone who knows the URL can call it, but they can only persist
// an image that already exists on Replicate's CDN. Acceptable trade-off for
// not needing auth in the routine.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ACA's main organization (Acquist OÜ) — autoblog hero images land here
const ACA_ORG_ID = HOUSE_ORG_ID;

// Allow any subdomain of these roots. Replicate has many CDN hostnames
// (replicate.delivery, pbxt.replicate.delivery, tjzk.replicate.delivery,
// replicate.com, and they keep adding more). Match the apex domain.
const ALLOWED_DOMAIN_ROOTS = [
  "replicate.delivery",
  "replicate.com",
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

interface RequestBody {
  sourceUrl: string;
  slug: string;
  name?: string;
  description?: string;
  tags?: string[];
}

function isAllowedHost(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    return ALLOWED_DOMAIN_ROOTS.some(
      (root) => host === root || host.endsWith(`.${root}`),
    );
  } catch {
    return false;
  }
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function sanitizeSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { sourceUrl, slug, name, description, tags } = body;

  if (!sourceUrl || !slug) {
    return new Response(JSON.stringify({ error: "sourceUrl and slug are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isAllowedHost(sourceUrl)) {
    return new Response(
      JSON.stringify({
        error: "sourceUrl host not allowed",
        rejectedHost: extractHost(sourceUrl),
        sourceUrl,
        allowedDomainRoots: ALLOWED_DOMAIN_ROOTS,
        hint: "Function accepts any subdomain of these roots. Add to ALLOWED_DOMAIN_ROOTS if Replicate started serving from a new apex.",
      }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const cleanSlug = sanitizeSlug(slug);
  if (!cleanSlug) {
    return new Response(JSON.stringify({ error: "slug produced empty value after sanitization" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Fetch the image from the source URL
  let imageResp: Response;
  try {
    imageResp = await fetch(sourceUrl);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch sourceUrl", detail: String(err) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!imageResp.ok) {
    return new Response(
      JSON.stringify({
        error: "Source URL returned non-2xx",
        status: imageResp.status,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const contentType = imageResp.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return new Response(
      JSON.stringify({ error: "Source is not an image", contentType }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const arrayBuffer = await imageResp.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return new Response(
      JSON.stringify({ error: "Image too large", bytes: arrayBuffer.byteLength, max: MAX_BYTES }),
      { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2. Upload to Supabase storage (content-media/blog-hero/<slug>.jpeg)
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpeg";
  const storagePath = `blog-hero/${cleanSlug}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("content-media")
    .upload(storagePath, arrayBuffer, {
      contentType,
      upsert: true, // re-runs of the routine for the same slug overwrite the file
    });

  if (uploadError) {
    return new Response(
      JSON.stringify({ error: "Storage upload failed", detail: uploadError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: publicData } = supabase.storage.from("content-media").getPublicUrl(storagePath);
  const permanentUrl = publicData.publicUrl;

  // 3. Insert into library_saved_content
  const savedRow = {
    organization_id: ACA_ORG_ID,
    name: name ?? `Blog hero: ${cleanSlug}`,
    description: description ?? `Auto-imported by autoblog routine for /blog/${cleanSlug}`,
    content_type: "image",
    content: {
      url: permanentUrl,
      storage_path: storagePath,
      content_type: contentType,
      bytes: arrayBuffer.byteLength,
      source_url: sourceUrl,
      generated_by: "autoblog-routine",
      slug: cleanSlug,
    },
    tags: tags && tags.length > 0 ? tags : ["blog-hero", "autoblog"],
    is_favorite: false,
  };

  const { data: insertData, error: insertError } = await supabase
    .from("library_saved_content")
    .insert(savedRow)
    .select("id")
    .single();

  if (insertError) {
    return new Response(
      JSON.stringify({
        error: "library_saved_content insert failed",
        detail: insertError.message,
        // image is already uploaded, return URL anyway so caller can use it
        permanentUrl,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      permanentUrl,
      savedContentId: insertData.id,
      storagePath,
      bytes: arrayBuffer.byteLength,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
