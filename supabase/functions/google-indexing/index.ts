import { corsHeaders } from "../_shared/cors.ts";
import { PUBLIC_SITE_HOST } from "../_shared/site-config.ts";

// Google Indexing API edge function
// Uses Web Crypto (Deno native) for RS256 JWT signing — no Node.js deps required
// Store GOOGLE_SERVICE_ACCOUNT_JSON as a Supabase secret

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str).buffer);
}

async function createSignedJWT(
  clientEmail: string,
  privateKeyPem: string,
  scope: string
): Promise<string> {
  // Clean the PEM key
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const signatureB64 = base64urlEncode(signature);
  return `${signingInput}.${signatureB64}`;
}

async function getAccessToken(
  clientEmail: string,
  privateKeyPem: string
): Promise<string> {
  const jwt = await createSignedJWT(
    clientEmail,
    privateKeyPem,
    "https://www.googleapis.com/auth/indexing"
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Allowed URL hosts. Calls without a service role key are restricted to
// these hosts so the function can be called from the autoblog routine
// without distributing the service role key, while still preventing abuse.
const PUBLIC_ALLOWED_HOSTS = [PUBLIC_SITE_HOST, PUBLIC_SITE_HOST.replace(/^www\./, "")];

function isAllowedPublicUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return PUBLIC_ALLOWED_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, type = "URL_UPDATED" } = await req.json() as {
      url: string;
      type?: "URL_UPDATED" | "URL_DELETED";
    };

    if (!url) {
      return new Response(
        JSON.stringify({ error: "Missing url parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Two auth modes:
    //   1. Service role key in Authorization header → can index any URL
    //   2. No service role key → URL must be on the public host whitelist
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const hasServiceRole =
      !!authHeader && !!serviceRoleKey && authHeader.includes(serviceRoleKey);

    if (!hasServiceRole && !isAllowedPublicUrl(url)) {
      return new Response(
        JSON.stringify({
          error: "URL not allowed without service role auth",
          allowedHosts: PUBLIC_ALLOWED_HOSTS,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load service account credentials. Accept either env name for backwards
    // compatibility with the older notify-google-indexing function.
    const serviceAccountJson =
      Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
      Deno.env.get("GOOGLE_INDEXING_SERVICE_ACCOUNT");
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({
          error: "Service account JSON not configured",
          hint: "Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_INDEXING_SERVICE_ACCOUNT in Supabase secrets",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceAccount = JSON.parse(serviceAccountJson);
    const accessToken = await getAccessToken(
      serviceAccount.client_email,
      serviceAccount.private_key
    );

    // Submit URL to Google Indexing API
    const indexingResponse = await fetch(
      "https://indexing.googleapis.com/v3/urlNotifications:publish",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, type }),
      }
    );

    const result = await indexingResponse.json();

    if (!indexingResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Indexing API error", details: result }),
        { status: indexingResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, url, type, result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
