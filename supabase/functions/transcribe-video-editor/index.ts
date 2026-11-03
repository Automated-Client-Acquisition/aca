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

function parseWhisperOutput(output: any): { transcript: string; word_timestamps: { word: string; start: number; end: number }[] } {
  let word_timestamps: { word: string; start: number; end: number }[] = [];

  if (output?.segments && Array.isArray(output.segments)) {
    for (const segment of output.segments) {
      if (segment.words && Array.isArray(segment.words)) {
        for (const w of segment.words) {
          word_timestamps.push({
            word: (w.word || w.text || "").trim(),
            start: w.start,
            end: w.end,
          });
        }
      }
    }
  }

  // Fallback: segment-level if no word-level data
  if (word_timestamps.length === 0 && output?.segments) {
    word_timestamps = output.segments.map((s: any) => ({
      word: (s.text || "").trim(),
      start: s.start,
      end: s.end,
    }));
  }

  const transcript = output?.transcription
    || word_timestamps.map((w) => w.word).join(" ").trim()
    || "";

  return { transcript, word_timestamps };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { video_url, organization_id } = body;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!video_url) {
      return new Response(
        JSON.stringify({ error: "video_url is required" }),
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

    // Get Replicate API key
    const { data: apiKeys } = await supabase
      .from("api_keys")
      .select("key_encrypted")
      .eq("organization_id", organization_id)
      .eq("provider", "replicate")
      .limit(1);

    if (!apiKeys || apiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No Replicate API key found. Add one in Settings - API Keys." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const encryptionKey = Deno.env.get("ENCRYPTION_KEY")!;
    const replicateKey = await decryptApiKey(apiKeys[0].key_encrypted, encryptionKey);

    // ── Start Whisper prediction ─────────────────────────────────
    console.log(`Starting Whisper transcription for: ${video_url.slice(0, 80)}...`);

    const startResp = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: "8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e",
          input: {
            audio: video_url,
            model: "large-v3",
            language: "en",
            translate: false,
            transcription: "plain text",
            word_timestamps: true,
          },
        }),
      }
    );

    if (!startResp.ok) {
      const errorText = await startResp.text();
      console.error("Replicate error:", errorText);
      return new Response(
        JSON.stringify({ error: `Failed to start transcription: ${errorText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prediction = await startResp.json();
    console.log(`Prediction started: ${prediction.id}`);

    // ── Wait for completion (poll server-side) ───────────────────
    const POLL_INTERVAL = 3000;
    const MAX_WAIT = 120_000; // 2 minutes
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const pollResp = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { Authorization: `Bearer ${replicateKey}` } }
      );

      if (!pollResp.ok) {
        console.error(`Poll failed: ${pollResp.status}`);
        continue;
      }

      const result = await pollResp.json();
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`Poll ${elapsed}s: status=${result.status}`);

      if (result.status === "succeeded") {
        const { transcript, word_timestamps } = parseWhisperOutput(result.output);
        console.log(`Transcription complete: ${word_timestamps.length} words, ${transcript.length} chars`);

        return new Response(
          JSON.stringify({ status: "succeeded", transcript, word_timestamps }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (result.status === "failed" || result.status === "canceled") {
        return new Response(
          JSON.stringify({ status: "failed", error: result.error || "Transcription failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Timeout
    return new Response(
      JSON.stringify({ status: "failed", error: "Transcription timed out after 2 minutes" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("transcribe-video-editor error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
