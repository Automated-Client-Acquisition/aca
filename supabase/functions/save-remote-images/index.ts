// Copies remote images (scraped creator posts, pasted links) into the
// `library-images` bucket and returns permanent public URLs.
//
// Why server-side: Instagram/TikTok/LinkedIn/X CDN URLs are signed and expire
// within days, and they don't send CORS headers, so the browser can neither
// keep the link nor fetch the bytes itself. The caller then creates the
// library_images row with its own session, so RLS still owns org scoping.
//
// Files land under `<user.id>/...`, matching the bucket's per-user folder
// convention used by AddLibraryImageDialog uploads.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_URLS = 20;
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const FETCH_TIMEOUT_MS = 20_000;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Reject anything that isn't a public http(s) hostname: no IP literals, no
// localhost/internal names. Keeps this from being used to probe internal hosts.
function validateUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return null;
  }
  return u;
}

async function fetchImage(url: URL): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some CDNs (Instagram, LinkedIn) 403 requests without a browser UA
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      },
    });
    if (!resp.ok) throw new Error(`Source returned HTTP ${resp.status}`);

    // Redirects must also land on a public host
    if (resp.url && !validateUrl(resp.url)) throw new Error("Redirected to a disallowed host");

    const contentType = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error(`Not an image (${contentType || "unknown type"})`);
    }

    const declared = Number(resp.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("Image is larger than 15 MB");

    const bytes = await resp.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error("Image is larger than 15 MB");
    if (bytes.byteLength === 0) throw new Error("Image is empty");

    return { bytes, contentType };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timed out fetching image");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization header" }, 401);

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  let urls: unknown;
  try {
    ({ urls } = await req.json());
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => typeof u === "string")) {
    return json({ error: "urls must be a non-empty array of strings" }, 400);
  }
  if (urls.length > MAX_URLS) return json({ error: `At most ${MAX_URLS} URLs per request` }, 400);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const results = await Promise.all(
    (urls as string[]).map(async (sourceUrl) => {
      const parsed = validateUrl(sourceUrl);
      if (!parsed) return { sourceUrl, error: "Invalid or disallowed URL" };

      try {
        const { bytes, contentType } = await fetchImage(parsed);
        const ext = EXT_BY_TYPE[contentType] ?? "jpg";
        const path = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from("library-images")
          .upload(path, bytes, { contentType, upsert: false });
        if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

        const { data } = supabaseAdmin.storage.from("library-images").getPublicUrl(path);
        return { sourceUrl, url: data.publicUrl };
      } catch (err) {
        console.error(`[save-remote-images] ${parsed.hostname}:`, err);
        return { sourceUrl, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return json({ results });
});
