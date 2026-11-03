import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { renderVideo, warmUp, cancelRender } from './render.js';
import { uploadRenderedVideo, cleanupTempFile } from './storage.js';
import type { RenderInput } from './types.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// Track active renders to prevent overload
let activeRenders = 0;
const MAX_CONCURRENT = 1;

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    active_renders: activeRenders,
    max_concurrent: MAX_CONCURRENT,
  });
});

/**
 * POST /cancel — Cancel an in-progress render
 */
app.post('/cancel', (req, res) => {
  const { output_id } = req.body;
  if (!output_id) {
    return res.status(400).json({ error: 'output_id is required' });
  }

  const cancelled = cancelRender(output_id);
  res.json({ cancelled, output_id });
});

/**
 * POST /render — Render a video using Remotion
 *
 * Synchronous: holds the HTTP connection open until the render completes.
 * This keeps Fly.io from auto-stopping the machine mid-render.
 * Returns the final video URL on success.
 */
app.post('/render', async (req, res) => {
  const data: RenderInput = req.body;

  if (!data.output_id || (!data.clips?.length && !data.remotion_code?.trim())) {
    return res.status(400).json({ error: 'output_id and either clips or remotion_code are required' });
  }

  if (activeRenders >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server busy, retry later' });
  }

  activeRenders++;
  const startTime = Date.now();
  let lastProgressUpdate = 0;

  try {
    console.log(`[/render] Starting render for ${data.output_id} (${data.clips?.length ?? 0} clips, ${data.aspect_ratio})`);

    const supabase = createClient(data.supabase_url, data.supabase_key);

    // Render video with progress updates piped to Supabase
    const outputPath = await renderVideo(data, async (progress) => {
      // Throttle Supabase updates to every 3 seconds
      const now = Date.now();
      if (now - lastProgressUpdate < 3000) return;
      lastProgressUpdate = now;

      const pct = Math.round(progress.progress * 100);
      console.log(`[/render] Progress: ${pct}% (${progress.renderedFrames}/${progress.totalFrames} frames)`);

      // Update progress on video_projects (non-blocking)
      supabase.from('video_projects').update({
        render_progress: progress.progress,
      }).eq('id', data.output_id).then(() => {});

      // Update progress on content_outputs (non-blocking)
      supabase.from('content_outputs')
        .select('stage_data')
        .eq('id', data.output_id)
        .maybeSingle()
        .then(({ data: output }) => {
          if (!output) return;
          const stageData = output.stage_data || {};
          supabase.from('content_outputs').update({
            stage_data: {
              ...stageData,
              final: {
                ...stageData.final,
                progress: progress.progress,
                rendered_frames: progress.renderedFrames,
                total_frames: progress.totalFrames,
              },
            },
          }).eq('id', data.output_id).then(() => {});
        });
    });

    // Upload to storage
    const storagePath = `videos/${data.organization_id}/${data.output_id}/final_${Date.now()}.mp4`;

    const { url: videoUrl } = await uploadRenderedVideo(
      supabase,
      data.organization_id,
      outputPath,
      storagePath,
      data.encryption_key,
    );

    // Update video_projects if this render was triggered from the video editor
    const { data: videoProject } = await supabase
      .from('video_projects')
      .select('id')
      .eq('id', data.output_id)
      .maybeSingle();

    if (videoProject) {
      await supabase.from('video_projects').update({
        status: 'completed',
        output_url: videoUrl,
        render_error: null,
        render_progress: 1,
      }).eq('id', data.output_id);
    }

    // Update content_output if this render was triggered from the content pipeline
    const { data: freshOutput } = await supabase
      .from('content_outputs')
      .select('stage_data, status')
      .eq('id', data.output_id)
      .maybeSingle();

    if (freshOutput) {
      const stageData = freshOutput.stage_data || {};

      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          final: {
            ...stageData.final,
            url: videoUrl,
            video_url: videoUrl,
            status: 'completed',
            completed_at: new Date().toISOString(),
            renderer: 'remotion',
            render_time_ms: Date.now() - startTime,
          },
        },
      }).eq('id', data.output_id);

      // Only transition to review if still in generating state
      if (freshOutput.status === 'generating') {
        await supabase.from('content_outputs').update({
          status: 'review',
        }).eq('id', data.output_id);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[/render] Complete: ${data.output_id} -> ${videoUrl} (${elapsed}s)`);

    // Cleanup temp file
    await cleanupTempFile(outputPath);

    // Return the result synchronously - keeps Fly machine alive for the full render
    res.json({
      success: true,
      output_id: data.output_id,
      url: videoUrl,
      render_time_ms: Date.now() - startTime,
    });

  } catch (error: any) {
    console.error(`[/render] Failed: ${data.output_id}`, error);

    // Update error status
    try {
      const supabase = createClient(data.supabase_url, data.supabase_key);

      // Update video_projects if applicable
      await supabase.from('video_projects').update({
        status: 'failed',
        render_error: error.message,
        render_progress: null,
      }).eq('id', data.output_id);

      // Update content_outputs if applicable
      const { data: freshOutput } = await supabase
        .from('content_outputs')
        .select('stage_data')
        .eq('id', data.output_id)
        .maybeSingle();

      if (freshOutput) {
        const stageData = freshOutput.stage_data || {};
        await supabase.from('content_outputs').update({
          stage_data: {
            ...stageData,
            final: {
              ...stageData.final,
              status: 'failed',
              error: error.message,
              failed_at: new Date().toISOString(),
            },
          },
        }).eq('id', data.output_id);
      }
    } catch (updateErr) {
      console.error('[/render] Failed to update error status:', updateErr);
    }

    res.status(500).json({
      success: false,
      output_id: data.output_id,
      error: error.message,
    });
  } finally {
    activeRenders--;
  }
});

app.listen(PORT, () => {
  console.log(`Video renderer listening on port ${PORT}`);
  // Pre-warm bundle + browser so first render is fast
  warmUp().catch((err) => console.warn('[warmup] Failed:', err.message));
});
