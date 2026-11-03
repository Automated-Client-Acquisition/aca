import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * submit-content: Standalone content submission for AI agents.
 *
 * Creates a content_output directly (bypasses blueprint/pipeline) and optionally
 * publishes to GHL accounts immediately or on schedule.
 *
 * Called by MCP tools or directly via HTTP.
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
      title,
      caption,
      pipeline_type = 'social_media_post',
      images = [],
      idea_id,
      publish_to,
      schedule_for,
      immediate = false,
      saved_content_ids = [],
    } = body;

    // verify_jwt=false and everything below runs with the service key (including the
    // push-to-ghl call), so the caller must be allowed to act on organization_id.
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    if (!organization_id) {
      throw new Error('organization_id is required');
    }
    if (!caption && images.length === 0 && saved_content_ids.length === 0) {
      throw new Error('At least one of caption, images, or saved_content_ids is required');
    }

    // push-to-ghl reads the linked idea's title with the service key, so it must be this org's.
    if (idea_id) {
      const { data: idea } = await supabase
        .from('content_ideas')
        .select('id')
        .eq('id', idea_id)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (!idea) {
        throw new Error('idea_id not found in this organization');
      }
    }

    // Build stage_data to match what process-publish-queue expects
    const stageData: Record<string, any> = {};
    const outputData: Record<string, any> = {
      title: title || '',
      caption: caption || '',
    };

    // Resolve saved content items if provided (fetch URLs from library)
    let resolvedImages = [...images];
    if (saved_content_ids.length > 0) {
      const { data: savedItems, error: savedError } = await supabase
        .from('library_saved_content')
        .select('id, content_type, content, tags')
        .eq('organization_id', organization_id)
        .in('id', saved_content_ids);

      if (savedError) {
        console.error('[submit-content] Failed to fetch saved content:', savedError.message);
      } else if (savedItems) {
        for (const item of savedItems) {
          if (item.content_type === 'image' && item.content?.url) {
            resolvedImages.push(item.content.url);
          } else if (item.content_type === 'video' && item.content?.url) {
            outputData.video_url = item.content.url;
          }
        }
        // Increment usage counts
        for (const item of savedItems) {
          await supabase
            .from('library_saved_content')
            .update({ usage_count: (item as any).usage_count ? (item as any).usage_count + 1 : 1, updated_at: new Date().toISOString() })
            .eq('id', item.id);
        }
      }
    }

    // Build stage_data based on pipeline type
    switch (pipeline_type) {
      case 'social_media_post':
        stageData.caption = { text: caption || '', status: 'complete' };
        if (resolvedImages.length > 0) {
          stageData.image = { url: resolvedImages[0], status: 'complete' };
        }
        break;

      case 'instagram_carousel':
        stageData.caption = { text: caption || '', status: 'complete' };
        stageData.carousel_slides = {
          slides: resolvedImages.map((url, i) => ({
            slide_number: i + 1,
            image_url: url,
            status: 'complete',
          })),
          status: 'complete',
        };
        break;

      case 'tweet':
        stageData.caption = { text: caption || '', status: 'complete' };
        if (resolvedImages.length > 0) {
          stageData.image = { url: resolvedImages[0], status: 'complete' };
        }
        break;

      case 'rich_article':
        stageData.article = { text: caption || '', status: 'complete' };
        break;

      case 'video_script':
        stageData.script = { text: caption || '', status: 'complete' };
        if (outputData.video_url) {
          stageData.final = { video_url: outputData.video_url, status: 'complete' };
        }
        break;

      default:
        stageData.caption = { text: caption || '', status: 'complete' };
        break;
    }

    // Create content_output row directly (bypasses pipeline)
    const { data: output, error: insertError } = await supabase
      .from('content_outputs')
      .insert({
        organization_id,
        idea_id: idea_id || null,
        type: 'text',
        pipeline: pipeline_type,
        status: 'approved', // Agent content is pre-approved (ready to publish)
        source: 'agent',
        data: outputData,
        stage_data: stageData,
        generation_params: {
          source: 'agent_submission',
          submitted_at: new Date().toISOString(),
          image_count: resolvedImages.length,
          saved_content_ids: saved_content_ids.length > 0 ? saved_content_ids : undefined,
        },
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[submit-content] Failed to create content_output:', insertError.message);
      throw new Error(`Failed to create content: ${insertError.message}`);
    }

    const outputId = output.id;
    let status = 'stored';
    const publishQueueIds: string[] = [];

    // Publish if requested
    if (publish_to && Array.isArray(publish_to) && publish_to.length > 0) {
      const publishBody: Record<string, any> = {
        contentOutputIds: [outputId],
        platforms: publish_to,
        organizationId: organization_id,
      };
      if (schedule_for) {
        publishBody.scheduleDate = schedule_for;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/push-to-ghl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(publishBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[submit-content] push-to-ghl failed:', response.status, errorText);
        // Don't throw — content is stored, publishing just failed
        status = 'stored_publish_failed';
      } else {
        const publishData = await response.json();
        if (publishData.success) {
          status = schedule_for ? 'scheduled' : 'published';
          if (publishData.results) {
            for (const r of publishData.results) {
              if (r.id) publishQueueIds.push(r.id);
            }
          }
        } else {
          status = 'stored_publish_failed';
          console.error('[submit-content] push-to-ghl returned error:', publishData.error);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        output_id: outputId,
        status,
        publish_queue_ids: publishQueueIds,
        images_attached: resolvedImages.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[submit-content] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
