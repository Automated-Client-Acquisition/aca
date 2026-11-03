import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ASPECT_RATIO_MAP: Record<string, string> = {
  landscape: "16:9",
  portrait: "9:16",
  square: "1:1",
  "16:9": "16:9",
  "9:16": "9:16",
  "1:1": "1:1",
};

const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux-schnell";

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encryptionKeyHex = Deno.env.get("ENCRYPTION_KEY");
  if (!encryptionKeyHex) throw new Error("ENCRYPTION_KEY not configured");

  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );
  const encryptedData = Uint8Array.from(atob(encryptedKey), (c) =>
    c.charCodeAt(0)
  );
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

async function getReplicateKey(
  supabase: any,
  organizationId: string
): Promise<string> {
  const { data: apiKeys, error } = await supabase
    .from("api_keys")
    .select("key_encrypted")
    .eq("organization_id", organizationId)
    .eq("provider", "replicate")
    .limit(1);

  if (error || !apiKeys?.length) {
    throw new Error(
      "Replicate API key not configured. Add your key in Settings → API Keys."
    );
  }

  return decryptApiKey(apiKeys[0].key_encrypted);
}

async function generateImage(
  replicateKey: string,
  prompt: string,
  aspectRatio: string
): Promise<{ url: string }> {
  const apiEndpoint = `https://api.replicate.com/v1/models/${DEFAULT_IMAGE_MODEL}/predictions`;

  const response = await fetch(apiEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateKey}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: ASPECT_RATIO_MAP[aspectRatio] || aspectRatio || "16:9",
        num_outputs: 1,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Replicate API error: ${response.status} - ${errorText}`);
  }

  const prediction = await response.json();

  // flux-schnell with Prefer: wait returns completed prediction
  if (prediction.status === "succeeded" && prediction.output) {
    const imageUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
    return { url: imageUrl };
  }

  // If not completed yet, poll for result
  const predictionId = prediction.id;
  const pollUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;
  const maxAttempts = 60;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const pollResponse = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${replicateKey}` },
    });

    if (!pollResponse.ok) continue;

    const pollData = await pollResponse.json();

    if (pollData.status === "succeeded" && pollData.output) {
      const imageUrl = Array.isArray(pollData.output)
        ? pollData.output[0]
        : pollData.output;
      return { url: imageUrl };
    }

    if (pollData.status === "failed" || pollData.status === "canceled") {
      throw new Error(
        `Image generation ${pollData.status}: ${pollData.error || "Unknown error"}`
      );
    }
  }

  throw new Error("Image generation timed out");
}

async function generateVideo(
  replicateKey: string,
  prompt: string,
  aspectRatio: string
): Promise<{ url: string; thumbnail_url?: string }> {
  // Use minimax/video-01-live for fast video generation
  const modelId = "minimax/video-01-live";
  const apiEndpoint = `https://api.replicate.com/v1/models/${modelId}/predictions`;

  const response = await fetch(apiEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=120",
    },
    body: JSON.stringify({
      input: {
        prompt,
        prompt_optimizer: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Replicate API error: ${response.status} - ${errorText}`);
  }

  const prediction = await response.json();

  if (prediction.status === "succeeded" && prediction.output) {
    const videoUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
    return { url: videoUrl };
  }

  // Poll for result (video takes longer)
  const predictionId = prediction.id;
  const pollUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const pollResponse = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${replicateKey}` },
    });

    if (!pollResponse.ok) continue;

    const pollData = await pollResponse.json();

    if (pollData.status === "succeeded" && pollData.output) {
      const videoUrl = Array.isArray(pollData.output)
        ? pollData.output[0]
        : pollData.output;
      return { url: videoUrl };
    }

    if (pollData.status === "failed" || pollData.status === "canceled") {
      throw new Error(
        `Video generation ${pollData.status}: ${pollData.error || "Unknown error"}`
      );
    }
  }

  throw new Error("Video generation timed out");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { type, prompt, aspect_ratio, organization_id } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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

    const replicateKey = await getReplicateKey(supabase, organization_id);

    if (type === "video") {
      const result = await generateVideo(
        replicateKey,
        prompt,
        aspect_ratio || "portrait"
      );
      return new Response(JSON.stringify({ video_url: result.url, thumbnail_url: result.thumbnail_url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const result = await generateImage(
        replicateKey,
        prompt,
        aspect_ratio || "portrait"
      );
      return new Response(JSON.stringify({ image_url: result.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error: any) {
    console.error("editor-generate-media error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
