import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 200; // Google Indexing API limit per batch

// Generate a signed JWT for Google service account auth
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };

  // Build JWT header.payload
  const header = { alg: "RS256", typ: "JWT" };
  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const unsigned = `${encode(header)}.${encode(payload)}`;

  // Import the RSA private key
  const pemBody = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsigned}.${sigB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to get Google access token: ${err}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Submit a single URL to Google Indexing API
async function notifyUrl(
  accessToken: string,
  url: string,
  type: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED"
): Promise<{ url: string; success: boolean; error?: string }> {
  try {
    const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, type }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { url, success: false, error: `HTTP ${res.status}: ${err}` };
    }

    return { url, success: true };
  } catch (e) {
    return { url, success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const serviceAccountJson = Deno.env.get("GOOGLE_INDEXING_SERVICE_ACCOUNT");
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ success: false, error: "GOOGLE_INDEXING_SERVICE_ACCOUNT secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const urls: string[] = body.urls;
    const type: "URL_UPDATED" | "URL_DELETED" = body.type ?? "URL_UPDATED";

    if (!Array.isArray(urls) || urls.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "urls must be a non-empty array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get access token once
    const accessToken = await getGoogleAccessToken(serviceAccountJson);

    // Process in batches of 200 (Google's limit)
    const results: { url: string; success: boolean; error?: string }[] = [];
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((url) => notifyUrl(accessToken, url, type))
      );
      results.push(...batchResults);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    return new Response(
      JSON.stringify({
        success: true,
        submitted: succeeded,
        failed: failed.length,
        errors: failed.length > 0 ? failed : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("notify-google-indexing error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
