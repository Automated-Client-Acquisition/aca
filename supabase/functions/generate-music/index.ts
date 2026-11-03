import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
  );
  const encryptedData = Uint8Array.from(atob(encryptedKey), (c: string) => c.charCodeAt(0));
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const { prompt, duration_ms, organization_id } = await req.json();

    if (!prompt || !organization_id) {
      return new Response(
        JSON.stringify({ error: "prompt and organization_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // The service-role client spends whatever org's key the body names, so the
    // caller must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Get ElevenLabs API key for this organization
    const { data: apiKeys } = await supabase
      .from("api_keys")
      .select("key_encrypted")
      .eq("organization_id", organization_id)
      .eq("provider", "elevenlabs")
      .limit(1);

    if (!apiKeys || apiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No ElevenLabs API key found. Add one in Settings > API Keys." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const encryptionKey = Deno.env.get("ENCRYPTION_KEY")!;
    const elevenLabsKey = await decryptApiKey(apiKeys[0].key_encrypted, encryptionKey);

    const targetDurationMs = duration_ms ?? 30000;

    console.log(`[generate-music] Generating: "${prompt.substring(0, 60)}", duration=${targetDurationMs}ms`);

    const response = await fetch("https://api.elevenlabs.io/v1/music/generate", {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        duration_ms: targetDurationMs,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[generate-music] ElevenLabs error (${response.status}):`, errorBody);

      let userMessage = `ElevenLabs API error ${response.status}: ${errorBody}`;
      try {
        const parsed = JSON.parse(errorBody);
        const detail = parsed.detail;
        if (typeof detail === "object" && detail !== null) {
          if (detail.status === "quota_exceeded" || (detail.message || "").includes("quota")) {
            userMessage = "ElevenLabs quota exceeded. Please upgrade your plan.";
          } else if (response.status === 401) {
            userMessage = "ElevenLabs authentication failed. Check your API key in Settings > API Keys.";
          } else {
            userMessage = `ElevenLabs error: ${detail.message || errorBody}`;
          }
        } else if (typeof detail === "string") {
          userMessage = `ElevenLabs error: ${detail}`;
        }
      } catch {
        // Keep fallback message
      }

      return new Response(
        JSON.stringify({ error: userMessage }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Music generation returns raw audio bytes
    const audioBuffer = await response.arrayBuffer();

    // Upload to Supabase Storage
    const fileName = `video-editor/${organization_id}/music_ai_${Date.now()}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("content-media")
      .upload(fileName, audioBuffer, { contentType: "audio/mpeg" });

    if (uploadError) {
      console.error("[generate-music] Upload failed:", uploadError);
      return new Response(
        JSON.stringify({ error: `Failed to upload audio: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("content-media").getPublicUrl(fileName);

    const durationSeconds = Math.round(targetDurationMs / 1000);
    const title = prompt.length > 40 ? prompt.substring(0, 37) + "..." : prompt;

    console.log(`[generate-music] Complete: "${title}", ${durationSeconds}s`);

    return new Response(
      JSON.stringify({
        audio_url: publicUrl,
        duration: durationSeconds,
        title,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[generate-music] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
