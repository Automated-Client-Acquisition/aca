import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { renderAllSlides } from "../_shared/carousel-slide-renderer.ts";
import type { SlideContent, CarouselStyle, RenderOptions } from "../_shared/carousel-slide-renderer.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * render-carousel-standalone: Renders branded carousel slides from structured text.
 *
 * Standalone endpoint for AI agents to create carousel images without the full
 * blueprint/pipeline system. Uses Satori + resvg-wasm for server-side rendering.
 *
 * Returns an array of public image URLs for each rendered slide.
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      organization_id,
      slides: rawSlides,
      template = 'classic',
      brand_voice_id,
      custom_palette,
      aspect_ratio = 'square',
      author_name,
      author_handle,
    } = body;

    if (!organization_id) {
      throw new Error('organization_id is required');
    }

    // The service-role client reads that org's brand voice and writes to storage,
    // so the caller must be able to access the org named in the body (a valid
    // anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }
    if (!rawSlides || !Array.isArray(rawSlides) || rawSlides.length === 0) {
      throw new Error('slides is required (array of {heading, body, type?})');
    }

    // Build slide content from input
    const slideContent: SlideContent[] = rawSlides.map((s: any, i: number) => ({
      slide_number: i + 1,
      type: s.type || (i === 0 ? 'cover' : i === rawSlides.length - 1 ? 'cta' : 'content'),
      headline: s.heading || s.headline || '',
      body: s.body || '',
    }));

    // Resolve palette from brand voice if provided
    let palette = custom_palette || {};
    if (brand_voice_id && !custom_palette) {
      const { data: brandVoice } = await supabase
        .from('library_brand_voices')
        .select('color_palette, visual_template, fonts')
        .eq('id', brand_voice_id)
        .eq('organization_id', organization_id)
        .single();

      if (brandVoice?.color_palette) {
        palette = brandVoice.color_palette;
      }
    }

    // Build carousel style
    const style: CarouselStyle = {
      palette,
      template,
    };

    // Determine dimensions from aspect ratio
    const dimensions: Record<string, { width: number; height: number }> = {
      'square': { width: 1080, height: 1080 },
      'portrait': { width: 1080, height: 1350 },
      'story': { width: 1080, height: 1920 },
    };
    const dim = dimensions[aspect_ratio] || dimensions['square'];

    const renderOptions: RenderOptions = {
      width: dim.width,
      height: dim.height,
      authorName: author_name,
      authorHandle: author_handle,
    };

    // Render all slides
    console.log(`[render-carousel-standalone] Rendering ${slideContent.length} slides (template: ${template}, aspect: ${aspect_ratio})`);
    const rendered = await renderAllSlides(slideContent, style, renderOptions);

    // Upload all PNGs to Supabase storage
    const resultSlides: Array<{ slide_number: number; url: string }> = [];
    const batchId = crypto.randomUUID().slice(0, 8);

    for (const { slide_number, png } of rendered) {
      const fileName = `carousel_agent_${batchId}_slide_${slide_number}_${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('content-media')
        .upload(fileName, png, { contentType: 'image/png', upsert: true });

      if (uploadError) {
        console.error(`[render-carousel-standalone] Failed to upload slide ${slide_number}:`, uploadError);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
      console.log(`[render-carousel-standalone] Slide ${slide_number} uploaded (${png.length} bytes): ${publicUrl}`);

      resultSlides.push({ slide_number, url: publicUrl });
    }

    return new Response(
      JSON.stringify({
        success: true,
        slides: resultSlides,
        total_slides: resultSlides.length,
        template,
        aspect_ratio,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[render-carousel-standalone] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
