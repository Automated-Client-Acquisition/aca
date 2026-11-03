import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";
import { decryptApiKey } from "../_shared/llm-client.ts";
import { resolveApiKey } from "../_shared/resolve-api-key.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // No app or cron caller remains; only internal service-role calls may run it.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  try {
    const {
      input,
      input_type = "script",
      aspect_ratio = "portrait",
      caption_style = "hormozi",
      organization_id,
      user_id,
    } = await req.json();

    if (!input || !organization_id || !user_id) {
      return new Response(
        JSON.stringify({ error: "input, organization_id, and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // The org's own keys first, then the platform's.
    const orgOpenRouter = await resolveApiKey(supabase, organization_id, "openrouter");
    const openrouterKey = orgOpenRouter
      ? await decryptApiKey(orgOpenRouter.key_encrypted)
      : Deno.env.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      return new Response(
        JSON.stringify({ error: "No OpenRouter API key. Add one in Settings > API Keys." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const orgPexels = await resolveApiKey(supabase, organization_id, "pexels");
    const pexelsKey = orgPexels
      ? await decryptApiKey(orgPexels.key_encrypted)
      : Deno.env.get("PEXELS_API_KEY");

    // Step 1: Generate scene breakdown via LLM
    let script = input;
    if (input_type === "prompt") {
      // Generate full script from prompt
      const scriptRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-4",
          messages: [
            {
              role: "system",
              content: "You are a professional video script writer. Write short, engaging scripts for social media videos. Write only the script text, no stage directions.",
            },
            {
              role: "user",
              content: `Write a 30-60 second video script about: ${input}`,
            },
          ],
        }),
      });
      const scriptData = await scriptRes.json();
      script = scriptData.choices?.[0]?.message?.content || input;
    }

    // Step 2: Break script into scenes with visual descriptions
    const sceneRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4",
        messages: [
          {
            role: "system",
            content: `You break video scripts into scenes. Return a JSON array of scenes.
Each scene: {"narration": "text spoken during scene", "visual": "short search query for stock footage", "duration": 5}
Keep scenes 3-7 seconds each. Return ONLY the JSON array.`,
          },
          {
            role: "user",
            content: script,
          },
        ],
      }),
    });
    const sceneData = await sceneRes.json();
    const sceneText = sceneData.choices?.[0]?.message?.content || "[]";

    let sceneBreakdown;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = sceneText.match(/\[[\s\S]*\]/);
      sceneBreakdown = JSON.parse(jsonMatch ? jsonMatch[0] : sceneText);
    } catch {
      sceneBreakdown = [
        { narration: script, visual: "abstract technology", duration: 10 },
      ];
    }

    // Step 3: Search stock footage for each scene
    const scenes = [];
    for (let i = 0; i < sceneBreakdown.length; i++) {
      const scene = sceneBreakdown[i];
      let mediaUrl = "";
      let thumbnailUrl = "";

      if (pexelsKey) {
        try {
          const pexelsRes = await fetch(
            `https://api.pexels.com/videos/search?query=${encodeURIComponent(scene.visual)}&per_page=3&orientation=portrait`,
            { headers: { Authorization: pexelsKey } }
          );
          const pexelsData = await pexelsRes.json();
          const video = pexelsData.videos?.[0];
          if (video) {
            const best = video.video_files
              ?.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))?.[0];
            mediaUrl = best?.link || "";
            thumbnailUrl = video.video_pictures?.[0]?.picture || video.image || "";
          }
        } catch (err) {
          console.error("Pexels search failed for scene", i, err);
        }
      }

      scenes.push({
        id: `scene_${Date.now()}_${i}`,
        order: i,
        duration: scene.duration || 5,
        media: {
          type: mediaUrl ? "video" : "color",
          url: mediaUrl || "#1a1a2e",
          thumbnail_url: thumbnailUrl,
          source: mediaUrl ? "stock" : "uploaded",
        },
        text: scene.narration
          ? {
              content: scene.narration,
              position: "bottom",
              fontSize: 36,
              color: "#FFFFFF",
            }
          : undefined,
        transition: "fade",
      });
    }

    // Step 4: Create video project
    const { data: project, error } = await supabase
      .from("video_projects")
      .insert({
        organization_id,
        user_id,
        title: input_type === "prompt" ? input.slice(0, 60) : "Generated Video",
        scenes,
        settings: { aspect_ratio, caption_style },
        status: "draft",
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ project_id: project.id, scenes_count: scenes.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("auto-generate-video error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
