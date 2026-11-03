import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { persistExternalUrl, resolveStorageCredentials } from "../_shared/byok-storage.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { project_id } = await req.json();

    if (!project_id) {
      return new Response(
        JSON.stringify({ error: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rendererUrl = Deno.env.get("VIDEO_RENDERER_URL");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch project
    const { data: project, error: fetchError } = await supabase
      .from("video_projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (fetchError || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, project.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Update status to rendering
    await supabase
      .from("video_projects")
      .update({ status: "rendering", render_error: null })
      .eq("id", project_id);

    // Transform ALL scenes to ClipData format for the renderer (video, image, and color)
    const scenes = (project.scenes || []).sort((a: any, b: any) => a.order - b.order);
    const clips = scenes.map((s: any, i: number) => ({
      scene_number: i,
      media_type: s.media?.type || "color",
      url: s.media?.type === "color"
        ? (s.media?.url || "#1a1a2e")
        : (s.media?.url || ""),
      duration: s.duration || 5,
      text: s.text?.content
        ? {
            content: s.text.content,
            position: s.text.position || "bottom",
            fontSize: s.text.fontSize || 48,
            color: s.text.color || "#FFFFFF",
            backgroundColor: s.text.backgroundColor,
          }
        : undefined,
      transition: s.transition || "fade",
    }));

    // ── Persist external media to BYOK storage ──────────────────────────
    // External URLs (Replicate, Pexels, etc.) can expire or lack CORS headers.
    // Download them to the org's permanent storage before sending to the renderer.
    const orgId = project.organization_id;
    let storagePublicUrl: string | undefined;
    try {
      const { raw } = await resolveStorageCredentials(supabase, orgId);
      storagePublicUrl = raw.public_url;
    } catch {
      // No BYOK credentials - URLs will pass through unchanged.
      // This is fine for Supabase Storage URLs which already have CORS.
      console.log("No BYOK storage credentials found - skipping media persistence");
    }

    const persist = (url: string | undefined, type: 'video' | 'image' | 'audio') =>
      url ? persistExternalUrl(supabase, orgId, url, type, project_id, supabaseUrl, storagePublicUrl) : Promise.resolve(url);

    // Persist all media URLs in parallel
    const [persistedClips, persistedAudioUrl, persistedMusicUrl, persistedSfx] = await Promise.all([
      // Video and image clips (color scenes have no external URL to persist)
      Promise.all(clips.map(async (clip: any) => {
        if (clip.media_type === 'video' || clip.media_type === 'image') {
          return { ...clip, url: await persist(clip.url, clip.media_type) };
        }
        return clip;
      })),
      // Voiceover audio
      persist(project.voiceover?.url, 'audio'),
      // Background music
      persist(project.music?.url, 'audio'),
      // Sound effects
      Promise.all((project.sound_effects || []).map(async (sfx: any) => ({
        ...sfx,
        url: await persist(sfx.url, 'audio'),
      }))),
    ]);

    // Build render input with persisted URLs
    const settings = project.settings || {};
    const renderInput: Record<string, unknown> = {
      output_id: project_id,
      organization_id: orgId,
      clips: persistedClips,
      audio_url: persistedAudioUrl,
      word_timestamps: project.voiceover?.word_timestamps,
      aspect_ratio: settings.aspect_ratio || "portrait",
      resolution: settings.resolution,
      fps: settings.fps,
      caption_style: settings.caption_style || "none",
      brand: settings.brand,
      background_music_url: persistedMusicUrl,
      background_music_volume: project.music?.volume,
      sound_effects: persistedSfx,
      supabase_url: supabaseUrl,
      supabase_key: supabaseKey,
      encryption_key: Deno.env.get("ENCRYPTION_KEY"),
    };

    // Include remotion_code for dynamic composition rendering
    if (project.remotion_code?.trim()) {
      renderInput.remotion_code = project.remotion_code;
    }

    if (!rendererUrl) {
      // No renderer configured — mark as failed
      await supabase
        .from("video_projects")
        .update({
          status: "failed",
          render_error: "VIDEO_RENDERER_URL not configured",
        })
        .eq("id", project_id);

      return new Response(
        JSON.stringify({ error: "Renderer not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send to renderer (synchronous - waits for render to complete)
    // The renderer holds the connection open, which keeps the Fly.io machine alive
    const renderResponse = await fetch(`${rendererUrl}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(renderInput),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 min timeout
    });

    const renderResult = await renderResponse.json();

    if (!renderResponse.ok || !renderResult.success) {
      const errMsg = renderResult.error || `Renderer returned ${renderResponse.status}`;
      await supabase
        .from("video_projects")
        .update({
          status: "failed",
          render_error: errMsg,
        })
        .eq("id", project_id);

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        message: "Render complete",
        project_id,
        url: renderResult.url,
        render_time_ms: renderResult.render_time_ms,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("render-video-project error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
