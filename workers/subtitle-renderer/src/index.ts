import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createClient } from '@supabase/supabase-js';
import { getCaptionStyle } from './caption-style-templates.js';
import { generateASS } from './ass-generator.js';

const PORT = parseInt(process.env.PORT || '8080');
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let activeJobs = 0;

interface RenderRequest {
  output_id: string;
  template_id?: string;
}

/**
 * Run ffprobe to get video dimensions
 */
function getVideoDimensions(filePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'v:0',
      filePath,
    ], (error, stdout) => {
      if (error) return reject(error);
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        if (!stream) return reject(new Error('No video stream found'));
        resolve({
          width: parseInt(stream.width),
          height: parseInt(stream.height),
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Run FFmpeg to burn in ASS subtitles
 */
function burnSubtitles(inputPath: string, assPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', `ass=${assPath}`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'copy',
      outputPath,
    ], { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        console.error('FFmpeg stderr:', stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

/**
 * Download a file from URL to a local path
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error('No response body');

  const fileStream = fs.createWriteStream(destPath);
  // @ts-ignore — Node.js Readable.fromWeb compatibility
  const { Readable } = await import('node:stream');
  const readable = Readable.fromWeb(response.body as any);
  await pipeline(readable, fileStream);
}

/**
 * Upload a file to Supabase storage
 */
async function uploadToStorage(filePath: string, orgId: string, outputId: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const storagePath = `${orgId}/videos/${outputId}_subtitled_${Date.now()}.mp4`;

  const { error } = await supabase.storage
    .from('content-media')
    .upload(storagePath, fileBuffer, {
      contentType: 'video/mp4',
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('content-media')
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

/**
 * Main render handler
 */
async function handleRender(body: RenderRequest): Promise<{ success: boolean; video_url?: string; error?: string }> {
  const { output_id, template_id } = body;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-'));

  try {
    activeJobs++;
    console.log(`🎬 Starting subtitle render for output ${output_id} (active: ${activeJobs})`);

    // 1. Fetch output data
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('id, organization_id, stage_data, generation_params')
      .eq('id', output_id)
      .single();

    if (fetchError || !output) {
      throw new Error(`Output not found: ${fetchError?.message}`);
    }

    const stageData = output.stage_data || {};
    const transcription = stageData.subtitle_transcription;

    if (!transcription?.words || transcription.words.length === 0) {
      throw new Error('No transcription data found');
    }

    const videoUrl = stageData.final?.video_url;
    if (!videoUrl) {
      throw new Error('No video URL in final stage');
    }

    // 2. Get template
    const resolvedTemplateId = template_id || 'clean_white';
    const template = getCaptionStyle(resolvedTemplateId);
    console.log(`   Template: ${template.name} (${template.animationStyle})`);

    // 3. Download video
    const inputPath = path.join(tmpDir, 'input.mp4');
    console.log(`   Downloading video...`);
    await downloadFile(videoUrl, inputPath);

    // 4. Get video dimensions
    const { width, height } = await getVideoDimensions(inputPath);
    console.log(`   Video dimensions: ${width}x${height}`);

    // 5. Generate ASS file
    const assContent = generateASS(transcription.words, template, width, height);
    const assPath = path.join(tmpDir, 'subtitles.ass');
    fs.writeFileSync(assPath, assContent, 'utf-8');
    console.log(`   Generated ASS file (${assContent.length} bytes)`);

    // 6. Burn subtitles with FFmpeg
    const outputPath = path.join(tmpDir, 'output.mp4');
    console.log(`   Burning subtitles with FFmpeg...`);
    await burnSubtitles(inputPath, assPath, outputPath);

    // 7. Upload to storage
    console.log(`   Uploading result...`);
    const resultUrl = await uploadToStorage(outputPath, output.organization_id, output_id);
    console.log(`   Uploaded: ${resultUrl}`);

    // 8. Update database
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        final: {
          ...stageData.final,
          original_video_url: stageData.final.original_video_url || stageData.final.video_url,
          video_url: resultUrl,
          url: resultUrl,
        },
        subtitle_render: {
          status: 'completed',
          video_url: resultUrl,
          source_video_url: videoUrl,
          template_id: resolvedTemplateId,
          completed_at: new Date().toISOString(),
        },
      },
    }).eq('id', output_id);

    console.log(`✅ Subtitle render complete for ${output_id}`);
    return { success: true, video_url: resultUrl };

  } catch (error: any) {
    console.error(`❌ Subtitle render failed for ${output_id}:`, error.message);

    // Update status to failed
    try {
      const { data: freshOutput } = await supabase
        .from('content_outputs')
        .select('stage_data')
        .eq('id', output_id)
        .single();

      if (freshOutput) {
        await supabase.from('content_outputs').update({
          stage_data: {
            ...freshOutput.stage_data,
            subtitle_render: {
              ...(freshOutput.stage_data?.subtitle_render || {}),
              status: 'failed',
              error: error.message,
              failed_at: new Date().toISOString(),
            },
          },
        }).eq('id', output_id);
      }
    } catch (dbError) {
      console.error('Failed to update error status:', dbError);
    }

    return { success: false, error: error.message };
  } finally {
    activeJobs--;
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeJobs,
      uptime: process.uptime(),
    }));
    return;
  }

  // Render endpoint
  if (url.pathname === '/render' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed: RenderRequest = JSON.parse(body);
        if (!parsed.output_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'output_id required' }));
          return;
        }

        // Respond immediately (fire-and-forget pattern)
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true, output_id: parsed.output_id }));

        // Process in background
        await handleRender(parsed);
      } catch (e: any) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🎬 Subtitle renderer worker listening on port ${PORT}`);
});
