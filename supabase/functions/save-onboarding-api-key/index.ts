// ============================================================================
// save-onboarding-api-key
// ----------------------------------------------------------------------------
// Public endpoint. Pre-auth API key save during the playbook onboarding flow.
// Verifies a provisioning_token, validates the key against the provider's
// API, encrypts it, and writes to public.api_keys scoped to the org from
// the token. Mirrors the validate-api-key validation logic for openrouter
// and apify (the only two we collect during onboarding).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { verifyProvisioningToken } from "../_shared/provisioning-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SaveKeyPayload {
  provisioningToken: string;
  provider: "openrouter" | "apify";
  apiKey: string;
}

async function encryptApiKey(apiKey: string, encryptionKeyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(apiKey)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function validateOpenRouter(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { valid: false, error: "Invalid OpenRouter key" };
    return { valid: true };
  } catch {
    return { valid: false, error: "Could not reach OpenRouter" };
  }
}

async function validateApify(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { valid: false, error: "Invalid Apify token" };
    return { valid: true };
  } catch {
    return { valid: false, error: "Could not reach Apify" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: SaveKeyPayload = await req.json();
    if (!body.provisioningToken || !body.provider || !body.apiKey) {
      return new Response(
        JSON.stringify({ error: "provisioningToken, provider, and apiKey are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.provider !== "openrouter" && body.provider !== "apify") {
      return new Response(
        JSON.stringify({ error: "Provider must be openrouter or apify" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload;
    try {
      payload = await verifyProvisioningToken(body.provisioningToken);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate the key against the provider
    const validation =
      body.provider === "openrouter"
        ? await validateOpenRouter(body.apiKey)
        : await validateApify(body.apiKey);

    if (!validation.valid) {
      return new Response(
        JSON.stringify({ valid: false, error: validation.error || "Invalid key" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Encrypt
    const encryptionKey = Deno.env.get("ENCRYPTION_KEY");
    if (!encryptionKey) {
      console.error("[save-onboarding-api-key] ENCRYPTION_KEY not set");
      return new Response(
        JSON.stringify({ error: "Server misconfiguration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const encrypted = await encryptApiKey(body.apiKey, encryptionKey);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const keyHint = body.apiKey.slice(-4).padStart(Math.min(body.apiKey.length, 12), "•");

    // Upsert: one (org, provider) record max
    const { error: upsertErr } = await supabase
      .from("api_keys")
      .upsert(
        {
          organization_id: payload.organizationId,
          provider: body.provider,
          key_encrypted: encrypted,
          key_hint: keyHint,
          is_valid: true,
        },
        { onConflict: "organization_id,provider" }
      );

    if (upsertErr) {
      console.error("[save-onboarding-api-key] upsert failed:", upsertErr);
      return new Response(
        JSON.stringify({ error: "Failed to save key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ valid: true, provider: body.provider }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[save-onboarding-api-key] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
