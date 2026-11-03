import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess, isServiceRoleRequest } from "../_shared/org-access.ts";
import { authenticateRequest, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encryptionKeyHex = Deno.env.get("ENCRYPTION_KEY");
  if (!encryptionKeyHex) throw new Error("ENCRYPTION_KEY not configured");
  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
  );
  const encryptedData = Uint8Array.from(atob(encryptedKey), (c: string) => c.charCodeAt(0));
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// Map aspect ratio to Pexels orientation parameter
function getOrientation(aspectRatio?: string): string | null {
  switch (aspectRatio) {
    case "portrait":
    case "9:16":
      return "portrait";
    case "landscape":
    case "16:9":
      return "landscape";
    case "square":
    case "1:1":
      return "square";
    default:
      // No orientation filter — return all results
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, type = "videos", per_page = 20, aspect_ratio, organization_id } = await req.json();

    // Every search spends a stock-media API key, and the music path decrypts the
    // named org's key with the service-role client, so require a signed-in caller
    // who can access that org when one is named (an anon-key JWT is not enough).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    try {
      if (organization_id) {
        await assertOrgAccess(req, supabase, organization_id);
      } else if (!isServiceRoleRequest(req)) {
        await authenticateRequest(req, supabase);
      }
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    if (!query) {
      return new Response(
        JSON.stringify({ error: "query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Music search via Pixabay ──────────────────────────────────────
    if (type === "music") {
      // Try org-specific key first, then env var
      let pixabayKey: string | null = null;
      if (organization_id) {
        const { data } = await supabase
          .from("api_keys")
          .select("key_encrypted")
          .eq("organization_id", organization_id)
          .eq("provider", "pixabay")
          .maybeSingle();
        if (data?.key_encrypted) {
          try {
            pixabayKey = await decryptApiKey(data.key_encrypted);
          } catch (e) {
            console.error("Failed to decrypt Pixabay key:", e);
          }
        }
      }
      if (!pixabayKey) pixabayKey = Deno.env.get("PIXABAY_API_KEY") || null;

      if (!pixabayKey) {
        return new Response(
          JSON.stringify({ error: "Pixabay API key not configured. Add it in Settings - API Keys." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const musicUrl = `https://pixabay.com/api/music/?key=${pixabayKey}&q=${encodeURIComponent(query)}&per_page=${per_page}`;
      console.log(`Searching Pixabay music: q=${query}`);
      const musicResp = await fetch(musicUrl);

      if (!musicResp.ok) {
        throw new Error(`Pixabay music API error: ${musicResp.status}`);
      }

      const musicData = await musicResp.json();
      const results = (musicData.hits || []).map((t: any) => ({
        id: String(t.id),
        title: t.title || t.tags?.split(",")[0]?.trim() || "Untitled",
        url: t.audio,
        duration: t.duration,
        tags: t.tags,
        user: t.user,
      }));

      console.log(`Found ${results.length} music results for "${query}"`);
      return new Response(
        JSON.stringify({ results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Video/Photo search via Pexels ─────────────────────────────────
    const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY");
    if (!PEXELS_API_KEY) {
      return new Response(
        JSON.stringify({ error: "PEXELS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orientation = getOrientation(aspect_ratio);
    const orientationParam = orientation ? `&orientation=${orientation}` : "";

    const endpoint = type === "photos"
      ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${per_page}${orientationParam}`
      : `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${per_page}${orientationParam}`;

    console.log(`Searching Pexels: ${endpoint}`);

    const response = await fetch(endpoint, {
      headers: { Authorization: PEXELS_API_KEY },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Pexels API error: ${response.status}`, errorText);
      throw new Error(`Pexels API error: ${response.status}`);
    }

    const data = await response.json();

    let results;
    if (type === "photos") {
      results = (data.photos || []).map((photo: any) => ({
        id: String(photo.id),
        url: photo.src.large2x || photo.src.large || photo.src.original,
        thumbnail_url: photo.src.medium || photo.src.small,
        width: photo.width,
        height: photo.height,
      }));
    } else {
      results = (data.videos || []).map((video: any) => {
        const files = video.video_files || [];
        const best = files
          .filter((f: any) => f.quality === "hd" || f.quality === "sd")
          .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0]
          || files.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];

        const thumbnail = video.video_pictures?.[0]?.picture || video.image;

        return {
          id: String(video.id),
          url: best?.link || "",
          thumbnail_url: thumbnail,
          duration: video.duration,
          width: best?.width || video.width,
          height: best?.height || video.height,
        };
      }).filter((v: any) => v.url);
    }

    console.log(`Found ${results.length} ${type} results for "${query}"`);

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("search-stock-media error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
