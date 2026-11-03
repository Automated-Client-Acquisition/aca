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
    const { text, voice_id, model_id, organization_id, with_timestamps } = await req.json();

    if (!text || !organization_id) {
      return new Response(
        JSON.stringify({ error: "text and organization_id are required" }),
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

    const selectedVoice = voice_id || "EXAVITQu4vr4xnSDxMaL"; // Default: Rachel

    // Validate voice_id looks like an ElevenLabs UUID (not a short name like "rachel")
    if (selectedVoice.length < 10) {
      return new Response(
        JSON.stringify({ error: `Invalid voice_id "${selectedVoice}". Please select a voice from the list.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const modelId = model_id || "eleven_multilingual_v2";

    console.log(`[video-editor-tts] Generating TTS: voice=${selectedVoice}, chars=${text.length}, timestamps=${!!with_timestamps}`);

    // Use with-timestamps endpoint if requested (provides word-level alignment)
    const endpoint = with_timestamps
      ? `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}/with-timestamps`
      : `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        output_format: "mp3_44100_128",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[video-editor-tts] ElevenLabs error (${response.status}):`, errorBody);

      // Parse known error types for user-friendly messages
      let userMessage = `ElevenLabs API error ${response.status}: ${errorBody}`;
      try {
        const parsed = JSON.parse(errorBody);
        const detail = parsed.detail;
        if (typeof detail === "object" && detail !== null) {
          if (detail.status === "detected_unusual_activity" || (detail.message || "").includes("unusual activity")) {
            userMessage = "ElevenLabs free tier blocked: Your account has been flagged. Please upgrade to a paid plan.";
          } else if (detail.status === "quota_exceeded" || (detail.message || "").includes("quota")) {
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

    let audioBase64: string;
    let wordTimestamps: { word: string; start: number; end: number }[] | undefined;

    if (with_timestamps) {
      // With-timestamps endpoint returns JSON with audio + alignment
      const data = await response.json();
      audioBase64 = data.audio_base64;

      // Convert character-level alignment to word-level timestamps
      if (data.alignment) {
        const chars = data.alignment.characters || [];
        const starts = data.alignment.character_start_times_seconds || [];
        const ends = data.alignment.character_end_times_seconds || [];

        wordTimestamps = [];
        let currentWord = "";
        let wordStart = 0;
        let wordEnd = 0;

        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];
          if (char === " " || i === chars.length - 1) {
            if (i === chars.length - 1 && char !== " ") {
              currentWord += char;
              wordEnd = ends[i] || wordEnd;
            }
            if (currentWord.trim()) {
              wordTimestamps.push({
                word: currentWord.trim(),
                start: wordStart,
                end: wordEnd,
              });
            }
            currentWord = "";
            wordStart = starts[i + 1] || 0;
          } else {
            if (!currentWord) wordStart = starts[i] || 0;
            currentWord += char;
            wordEnd = ends[i] || wordEnd;
          }
        }
      }
    } else {
      // Standard endpoint returns raw audio bytes
      const audioBuffer = await response.arrayBuffer();
      audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
    }

    // Decode base64 to binary for storage upload
    const audioBinary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));

    // Upload to Supabase Storage
    const fileName = `video-editor/${organization_id}/tts_${Date.now()}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("content-media")
      .upload(fileName, audioBinary, { contentType: "audio/mpeg" });

    if (uploadError) {
      console.error("[video-editor-tts] Upload failed:", uploadError);
      return new Response(
        JSON.stringify({ error: `Failed to upload audio: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("content-media").getPublicUrl(fileName);

    // Estimate duration from character count (~15 chars/second)
    const duration = Math.ceil(text.length / 15);

    console.log(`[video-editor-tts] Complete: ${text.length} chars, ~${duration}s, ${wordTimestamps?.length || 0} words`);

    return new Response(
      JSON.stringify({
        audio_url: publicUrl,
        duration,
        character_count: text.length,
        word_timestamps: wordTimestamps || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[video-editor-tts] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
