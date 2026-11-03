import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { outputId, predictionIds } = await req.json();
    
    if (!outputId || !predictionIds?.length) {
      throw new Error("outputId and predictionIds required");
    }

    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) {
      throw new Error("REPLICATE_API_TOKEN not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the output
    const { data: output, error: fetchError } = await supabase
      .from("content_outputs")
      .select("stage_data, organization_id")
      .eq("id", outputId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!output) {
      return new Response(
        JSON.stringify({ error: "Output not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, output.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    const stageData = output.stage_data || {};
    const clips = stageData.clips?.clips || [];

    // Fetch each prediction
    for (const predictionId of predictionIds) {
      console.log(`Fetching prediction ${predictionId}...`);
      
      const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch ${predictionId}:`, response.status);
        continue;
      }

      const prediction = await response.json();
      console.log(`Prediction ${predictionId} status:`, prediction.status);

      if (prediction.status === "succeeded" && prediction.output) {
        const videoUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        
        // Find the clip by prediction_id
        const clipIndex = clips.findIndex((c: any) => c.prediction_id === predictionId);
        
        if (clipIndex !== -1) {
          clips[clipIndex] = {
            ...clips[clipIndex],
            status: "pending",
            video_url: videoUrl,
            completed_at: new Date().toISOString(),
            metrics: prediction.metrics,
          };
          console.log(`Updated clip ${clips[clipIndex].scene_number} with video URL`);
        }
      }
    }

    // Update the output
    const { error: updateError } = await supabase
      .from("content_outputs")
      .update({
        stage_data: {
          ...stageData,
          clips: {
            ...stageData.clips,
            clips,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", outputId);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ success: true, clipsUpdated: clips.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});