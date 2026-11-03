/**
 * Custom Handler: B-Roll Stage
 *
 * Enriches the director's shot list with B-roll cutaway clips.
 * Runs after the director stage and before composition.
 *
 * For each shot that has `b_roll_keywords` (set by the director), this handler:
 * - bRollStyle 'stock': searches Pexels for matching stock video clips
 * - bRollStyle 'ai_generated': generates an image via OpenRouterImageProvider
 *
 * Results are uploaded to Supabase Storage and inserted as `b_roll_cutaway`
 * entries in the shot list between the relevant shots.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { PexelsProvider } from '../../providers/PexelsProvider.ts';
import { OpenRouterImageProvider, DEFAULT_OPENROUTER_IMAGE_MODEL } from '../../providers/OpenRouterImageProvider.ts';

// Max B-roll clips to fetch per video to avoid excessive API calls
const MAX_BROLL_CLIPS = 6;

// Concurrency for B-roll fetching
const BROLL_CONCURRENCY = 3;

interface DirectorShot {
  duration: number;
  layout: string;
  screenshot_index: number | null;
  narration: string;
  b_roll_keywords?: string[];
  [key: string]: any;
}

interface BRollClip {
  url: string;
  duration: number;
  source: 'pexels' | 'ai_generated';
  keywords: string[];
  thumbnail?: string;
  pexels_id?: number;
}

/**
 * Execute the B-roll stage.
 * Processes the director's shot list to fetch/generate B-roll media.
 */
export async function executeBRollStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[BRollHandler] Starting B-roll stage');

  // 1. Get the director's output — supports both shots[] (presenter) and segments[] (video_remix)
  const directorOutput = context.previousStageOutputs?.director;
  const isSegmentMode = Array.isArray(directorOutput?.segments) && directorOutput.segments.length > 0;
  const isShotMode = Array.isArray(directorOutput?.shots) && directorOutput.shots.length > 0;

  if (!isSegmentMode && !isShotMode) {
    console.warn('[BRollHandler] No shots or segments in director output — passing through unchanged');
    return { content: directorOutput || {}, status: 'completed' };
  }

  // Delegate to segment-mode processing for video_remix pipeline
  if (isSegmentMode) {
    return processSegmentBRoll(context, directorOutput);
  }

  const shots: DirectorShot[] = directorOutput.shots;
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const videoConfig = rawParams.video_config || rawConfig.video_config || {};
  const presenterConfig = rawParams.presenter_config || rawConfig.presenter_config || {};

  // 2. Get B-roll style preference
  const bRollStyle: 'stock' | 'ai_generated' =
    videoConfig.bRollStyle || videoConfig.b_roll_style ||
    presenterConfig.bRollStyle ||
    presenterConfig.b_roll_style ||
    'stock';

  // Resolve orientation for search
  const orientation: 'portrait' | 'landscape' =
    context.outputConfig?.aspectRatio === '16:9' ? 'landscape' : 'portrait';

  console.log('[BRollHandler] Config:', {
    bRollStyle,
    orientation,
    totalShots: shots.length,
    shotsWithKeywords: shots.filter((s) => s.b_roll_keywords?.length).length,
  });

  // 3. Collect all shots that need B-roll
  const bRollTasks: Array<{
    shotIndex: number;
    keywords: string[];
  }> = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (shot.b_roll_keywords && shot.b_roll_keywords.length > 0) {
      bRollTasks.push({
        shotIndex: i,
        keywords: shot.b_roll_keywords,
      });
    }
  }

  // Limit total B-roll clips
  const tasksToProcess = bRollTasks.slice(0, MAX_BROLL_CLIPS);

  if (tasksToProcess.length === 0) {
    console.log('[BRollHandler] No shots have b_roll_keywords, passing through director output');
    return {
      content: directorOutput,
      status: 'completed',
    };
  }

  console.log(`[BRollHandler] Processing ${tasksToProcess.length} B-roll clips (style: ${bRollStyle})`);

  // 4. Fetch/generate B-roll clips with concurrency limit
  const bRollResults: Map<number, BRollClip> = new Map();

  const processBatch = async (batch: typeof tasksToProcess) => {
    await Promise.all(
      batch.map(async (task) => {
        try {
          const query = task.keywords.join(' ');
          let clip: BRollClip;

          if (bRollStyle === 'stock') {
            clip = await fetchStockBRoll(query, orientation, context);
          } else {
            clip = await generateAiBRoll(query, orientation, context);
          }

          bRollResults.set(task.shotIndex, clip);
          console.log(`[BRollHandler] Got B-roll for shot ${task.shotIndex}: ${clip.source}`);
        } catch (error) {
          // Non-fatal: log and skip this B-roll clip
          console.warn(`[BRollHandler] Failed to get B-roll for shot ${task.shotIndex}:`, error);
        }
      })
    );
  };

  // Process in batches for concurrency control
  for (let i = 0; i < tasksToProcess.length; i += BROLL_CONCURRENCY) {
    const batch = tasksToProcess.slice(i, i + BROLL_CONCURRENCY);
    await processBatch(batch);
  }

  // 5. Build the enriched shot list with B-roll cutaways inserted
  const enrichedShots: any[] = [];
  const bRollClips: BRollClip[] = [];

  for (let i = 0; i < shots.length; i++) {
    enrichedShots.push(shots[i]);

    const bRollClip = bRollResults.get(i);
    if (bRollClip) {
      bRollClips.push(bRollClip);

      // Insert a B-roll cutaway shot after the current shot
      enrichedShots.push({
        duration: Math.min(bRollClip.duration, 3),
        layout: 'b_roll_cutaway',
        screenshot_index: null,
        screenshot_description: null,
        b_roll_url: bRollClip.url,
        b_roll_source: bRollClip.source,
        b_roll_keywords: bRollClip.keywords,
        b_roll_thumbnail: bRollClip.thumbnail,
        narration: '', // B-roll plays under continuing narration from previous shot
        caption_emphasis: [],
        caption_style: null,
        highlight: null,
        text_overlay: null,
        text_style: null,
        transition_in: 'cut_hard',
        sound_effect: null,
        camera: {
          move: 'ken_burns_slow',
          target_element: null,
          start_scale: null,
          end_scale: null,
        },
      });
    }
  }

  console.log('[BRollHandler] Complete:', {
    originalShots: shots.length,
    bRollClipsAdded: bRollClips.length,
    enrichedShots: enrichedShots.length,
  });

  // 6. Build parallel structure for UI: b_roll_by_shot[originalShotIndex].clips
  const bRollByShot: Record<number, { clips: BRollClip[] }> = {};
  for (const [shotIndex, clip] of bRollResults) {
    bRollByShot[shotIndex] = { clips: [clip] };
  }

  // 7. Return the enriched director output
  return {
    content: {
      ...directorOutput,
      shots: enrichedShots,
      shot_count: enrichedShots.length,
      total_duration: enrichedShots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0),
      b_roll_clips: bRollClips,
      b_roll_style: bRollStyle,
      b_roll_by_shot: bRollByShot,
    },
    status: 'completed',
  };
}

/**
 * Process B-roll for segment-based director output (video_remix pipeline).
 * Inserts b_roll segments after segments that have b_roll_keywords.
 */
async function processSegmentBRoll(
  context: ExecutionContext,
  directorOutput: any,
): Promise<StageResult> {
  const segments: any[] = directorOutput.segments;
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const remixConfig = rawParams.remix_config || rawConfig.remix_config || {};

  const bRollStyle: 'stock' | 'ai_generated' =
    remixConfig.bRollStyle || remixConfig.b_roll_style || 'stock';
  const orientation: 'portrait' | 'landscape' =
    context.outputConfig?.aspectRatio === '16:9' ? 'landscape' : 'portrait';

  // Collect segments with b_roll_keywords
  const bRollTasks: Array<{ segIndex: number; keywords: string[] }> = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.b_roll_keywords && seg.b_roll_keywords.length > 0) {
      bRollTasks.push({ segIndex: i, keywords: seg.b_roll_keywords });
    }
  }

  const tasksToProcess = bRollTasks.slice(0, MAX_BROLL_CLIPS);

  if (tasksToProcess.length === 0) {
    console.log('[BRollHandler] No segments have b_roll_keywords, passing through');
    return { content: directorOutput, status: 'completed' };
  }

  console.log(`[BRollHandler] Processing ${tasksToProcess.length} segment B-roll clips (style: ${bRollStyle})`);

  // Fetch/generate B-roll clips
  const bRollResults: Map<number, BRollClip> = new Map();

  for (let i = 0; i < tasksToProcess.length; i += BROLL_CONCURRENCY) {
    const batch = tasksToProcess.slice(i, i + BROLL_CONCURRENCY);
    await Promise.all(
      batch.map(async (task) => {
        try {
          const query = task.keywords.join(' ');
          const clip = bRollStyle === 'stock'
            ? await fetchStockBRoll(query, orientation, context)
            : await generateAiBRoll(query, orientation, context);
          bRollResults.set(task.segIndex, clip);
        } catch (error) {
          console.warn(`[BRollHandler] Failed B-roll for segment ${task.segIndex}:`, error);
        }
      })
    );
  }

  // Build enriched segment list with B-roll segments inserted
  const enrichedSegments: any[] = [];
  const bRollClips: BRollClip[] = [];
  let bRollIdx = 0;

  for (let i = 0; i < segments.length; i++) {
    enrichedSegments.push(segments[i]);

    const clip = bRollResults.get(i);
    if (clip) {
      bRollClips.push(clip);
      bRollIdx++;
      enrichedSegments.push({
        id: `broll_${String(bRollIdx).padStart(3, '0')}`,
        type: 'b_roll',
        source_start: 0,
        source_end: 0,
        speed: 1,
        duration: Math.min(clip.duration, 3),
        transition_in: 'cut_hard',
        narration: '',
        caption_emphasis: [],
        broll_src: clip.url,
        broll_type: clip.source === 'pexels' ? 'video' : 'image',
        b_roll_keywords: clip.keywords,
        sound_effect: null,
        camera: { move: 'ken_burns_slow', target_element: null },
      });
    }
  }

  console.log('[BRollHandler] Segment B-roll complete:', {
    originalSegments: segments.length,
    bRollAdded: bRollClips.length,
    enrichedSegments: enrichedSegments.length,
  });

  return {
    content: {
      ...directorOutput,
      segments: enrichedSegments,
      segment_count: enrichedSegments.length,
      total_duration: enrichedSegments.reduce((sum: number, s: any) => sum + (s.duration || 0), 0),
      b_roll_clips: bRollClips,
      b_roll_style: bRollStyle,
    },
    status: 'completed',
  };
}

/**
 * Fetch a stock video clip from Pexels for the given keywords.
 */
async function fetchStockBRoll(
  query: string,
  orientation: 'portrait' | 'landscape',
  context: ExecutionContext
): Promise<BRollClip> {
  const pexelsKey = context.apiKeys?.pexels;
  if (!pexelsKey) {
    throw new Error('Pexels API key not configured. Add it in Settings → API Keys.');
  }

  const videos = await PexelsProvider.searchVideos(query, pexelsKey, {
    orientation,
    perPage: 3,
    minDuration: 3,
    maxDuration: 15,
  });

  if (videos.length === 0) {
    throw new Error(`No Pexels videos found for query: "${query}"`);
  }

  // Pick the first result and best file variant
  const video = videos[0];
  const bestFile = PexelsProvider.pickBestFile(video, orientation);

  if (!bestFile) {
    throw new Error(`No suitable MP4 file found in Pexels video ${video.id}`);
  }

  // Download and upload to Supabase Storage
  const storagePath = `${context.organizationId}/${context.outputId}/b-roll-${video.id}.mp4`;
  const uploadedUrl = await PexelsProvider.downloadAndUpload(bestFile.link, storagePath);

  return {
    url: uploadedUrl,
    duration: video.duration,
    source: 'pexels',
    keywords: query.split(' '),
    thumbnail: video.image,
    pexels_id: video.id,
  };
}

/**
 * Generate an AI image for B-roll using OpenRouterImageProvider.
 */
async function generateAiBRoll(
  query: string,
  orientation: 'portrait' | 'landscape',
  context: ExecutionContext
): Promise<BRollClip> {
  const apiKey = context.apiKeys?.openrouter;
  if (!apiKey) {
    throw new Error('OpenRouter API key required for AI-generated B-roll');
  }

  const imageProvider = new OpenRouterImageProvider(apiKey);
  const aspectRatio = orientation === 'portrait' ? '9:16' : '16:9';

  const prompt = `Cinematic B-roll footage: ${query}. High quality, professional video production style, smooth motion, subtle lighting.`;

  const response = await imageProvider.execute({
    prompt,
    model: context.modelConfig?.imageLlm?.modelId || DEFAULT_OPENROUTER_IMAGE_MODEL,
    config: {
      aspectRatio,
    },
  });

  // Upload the generated image to Supabase Storage
  const imageData = response.content;
  if (!imageData?.base64) {
    throw new Error('OpenRouter image generation returned no image data');
  }

  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const fileName = `${context.organizationId}/${context.outputId}/b-roll-ai-${Date.now()}.png`;
  const imageBuffer = Uint8Array.from(atob(imageData.base64), (c) => c.charCodeAt(0));

  let uploadError: any;
  ({ error: uploadError } = await supabase.storage
    .from('b-roll')
    .upload(fileName, imageBuffer, {
      contentType: imageData.mimeType || 'image/png',
      upsert: true,
    }));

  if (uploadError && (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket'))) {
    console.log('[BRollHandler] b-roll bucket not found — creating it');
    await supabase.storage.createBucket('b-roll', { public: true });
    ({ error: uploadError } = await supabase.storage
      .from('b-roll')
      .upload(fileName, imageBuffer, {
        contentType: imageData.mimeType || 'image/png',
        upsert: true,
      }));
  }

  if (uploadError) {
    throw new Error(`Failed to upload AI B-roll image: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from('b-roll')
    .getPublicUrl(fileName);

  return {
    url: publicUrl,
    duration: 3, // Static image shown for 3 seconds with camera movement
    source: 'ai_generated',
    keywords: query.split(' '),
  };
}

export default executeBRollStage;
