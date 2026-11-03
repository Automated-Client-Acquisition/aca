/**
 * Transcripts for scraped content (research_content).
 *
 *   YouTube   captions arrive inline in raw_data.subtitles (plaintext) — free.
 *   TikTok    captions are a WebVTT link in raw_data.videoMeta.subtitleLinks
 *             on TikTok's CDN. The link is signed and expires, so it is fetched
 *             right after the scrape. The actor runs with shouldDownloadVideos
 *             off, so there is no video to fall back to Whisper with.
 *   Instagram reels have no captions; raw_data.videoUrl (signed, expires in
 *             days) goes to Whisper on Replicate with the org's own key. The
 *             result lands via scraped-transcript-webhook.
 *   X/LinkedIn are text posts — the post body *is* the content, no transcript.
 *
 * Called inline by apify-webhook after each scrape, and by
 * transcribe-scraped-content for manual retries.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { resolveApiKey } from './resolve-api-key.ts';
import { decryptApiKey } from './llm-client.ts';

// openai/whisper large-v3 — same version transcribe-video-editor uses
const WHISPER_VERSION = '8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e';
// Reels are short; this bounds Replicate spend on an occasional long IG video.
const MAX_WHISPER_SECONDS = 20 * 60;
const PREVIEW_CHARS = 500;

export const TRANSCRIBABLE_PLATFORMS = ['youtube', 'youtube-shorts', 'tiktok', 'instagram'];

export interface TranscriptRow {
  id: string;
  organization_id: string;
  platform: string;
  raw_data: any;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_status: string | null;
}

export type TranscriptOutcome = 'completed' | 'processing' | 'unavailable' | 'failed' | 'skipped';

/** Pick the full caption text from a YouTube scraper item (English track first). */
export function youtubeSubtitlesText(subtitles: unknown): string | null {
  if (typeof subtitles === 'string') return subtitles.trim() || null;
  if (!Array.isArray(subtitles)) return null;
  const withText = subtitles.filter((s: any) => typeof s?.plaintext === 'string' && s.plaintext.trim());
  const en = withText.find((s: any) => String(s.language || '').toLowerCase().startsWith('en'));
  const pick = (en || withText[0]) as any;
  return pick ? pick.plaintext.trim() : null;
}

/** WebVTT → plain text: drop header, cue ids, timings, markup, repeated lines. */
export function vttToText(vtt: string): string {
  const out: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT' || /^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (/^\d+$/.test(line) || line.includes('-->')) continue;
    const text = line.replace(/<[^>]+>/g, '').trim();
    if (text && text !== out[out.length - 1]) out.push(text);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function transcriptFields(text: string, source: 'subtitles' | 'whisper') {
  return {
    transcript: text,
    transcript_preview: text.slice(0, PREVIEW_CHARS),
    transcript_status: 'completed',
    transcript_source: source,
    transcript_error: null,
    transcript_prediction_id: null,
  };
}

async function markRow(supabase: SupabaseClient, id: string, fields: Record<string, unknown>) {
  const { error } = await supabase.from('research_content').update(fields).eq('id', id);
  if (error) console.error(`[scraped-transcript] update ${id} failed:`, error.message);
}

async function fetchTikTokCaptions(rawData: any): Promise<string | null> {
  const links: any[] = rawData?.videoMeta?.subtitleLinks || [];
  const ordered = [
    ...links.filter((l) => String(l?.language || '').toLowerCase().startsWith('en')),
    ...links.filter((l) => !String(l?.language || '').toLowerCase().startsWith('en')),
  ];
  for (const link of ordered) {
    const url = link?.downloadLink || link?.tiktokLink;
    if (!url) continue;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) continue;
      const text = vttToText(await resp.text());
      if (text) return text;
    } catch (err) {
      console.warn('[scraped-transcript] TikTok caption fetch failed:', String(err));
    }
  }
  return null;
}

function instagramVideoUrl(rawData: any): string | null {
  const url = rawData?.videoUrl;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

async function startWhisper(
  supabase: SupabaseClient,
  row: TranscriptRow,
  videoUrl: string,
  replicateKey: string,
): Promise<TranscriptOutcome> {
  const resp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${replicateKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: WHISPER_VERSION,
      input: {
        audio: videoUrl,
        model: 'large-v3',
        transcription: 'plain text',
        translate: false,
      },
      webhook: `${Deno.env.get('SUPABASE_URL')}/functions/v1/scraped-transcript-webhook`,
      webhook_events_filter: ['completed'],
    }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    await markRow(supabase, row.id, {
      transcript_status: 'failed',
      transcript_error: `Replicate ${resp.status}: ${detail}`,
      transcript_prediction_id: null,
    });
    return 'failed';
  }
  const prediction = await resp.json();
  await markRow(supabase, row.id, {
    transcript_status: 'processing',
    transcript_error: null,
    transcript_prediction_id: prediction.id,
  });
  return 'processing';
}

/**
 * Transcribe the given rows where possible. Rows that already have a transcript
 * (or are in flight) are skipped unless `force` is set.
 */
export async function transcribeScrapedContent(
  supabase: SupabaseClient,
  rows: TranscriptRow[],
  opts: { force?: boolean } = {},
): Promise<Record<string, TranscriptOutcome>> {
  const results: Record<string, TranscriptOutcome> = {};
  const replicateKeys = new Map<string, string | null>();

  const replicateKeyFor = async (orgId: string): Promise<string | null> => {
    if (!replicateKeys.has(orgId)) {
      const resolved = await resolveApiKey(supabase, orgId, 'replicate');
      replicateKeys.set(orgId, resolved ? await decryptApiKey(resolved.key_encrypted) : null);
    }
    return replicateKeys.get(orgId)!;
  };

  // Small concurrency: TikTok caption fetches are quick, Whisper starts are one POST each.
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      results[row.id] = await transcribeOne(row).catch(async (err) => {
        console.error(`[scraped-transcript] ${row!.id}:`, err);
        await markRow(supabase, row!.id, { transcript_status: 'failed', transcript_error: String(err).slice(0, 300) });
        return 'failed' as const;
      });
    }
  };

  const transcribeOne = async (row: TranscriptRow): Promise<TranscriptOutcome> => {
    if (!TRANSCRIBABLE_PLATFORMS.includes(row.platform)) return 'skipped';
    if (!opts.force && (row.transcript || row.transcript_status === 'processing')) return 'skipped';

    if (row.platform === 'youtube' || row.platform === 'youtube-shorts') {
      const text = youtubeSubtitlesText(row.raw_data?.subtitles);
      if (text) {
        await markRow(supabase, row.id, transcriptFields(text, 'subtitles'));
        return 'completed';
      }
      await markRow(supabase, row.id, { transcript_status: 'unavailable', transcript_error: 'Video has no captions' });
      return 'unavailable';
    }

    if (row.platform === 'tiktok') {
      const text = await fetchTikTokCaptions(row.raw_data);
      if (text) {
        await markRow(supabase, row.id, transcriptFields(text, 'subtitles'));
        return 'completed';
      }
      await markRow(supabase, row.id, {
        transcript_status: 'unavailable',
        transcript_error: 'No captions on this TikTok (or the caption link expired)',
      });
      return 'unavailable';
    }

    // instagram
    const videoUrl = instagramVideoUrl(row.raw_data);
    if (!videoUrl) return 'skipped'; // image / carousel post — nothing spoken
    const duration = row.duration_seconds ?? Number(row.raw_data?.videoDuration || 0);
    if (duration > MAX_WHISPER_SECONDS) {
      await markRow(supabase, row.id, { transcript_status: 'unavailable', transcript_error: 'Video longer than 20 minutes' });
      return 'unavailable';
    }
    const replicateKey = await replicateKeyFor(row.organization_id);
    if (!replicateKey) {
      await markRow(supabase, row.id, {
        transcript_status: 'unavailable',
        transcript_error: 'Add a Replicate API key in Settings to transcribe Instagram videos',
      });
      return 'unavailable';
    }
    return await startWhisper(supabase, row, videoUrl, replicateKey);
  };

  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, worker));
  return results;
}

/** Save a finished Whisper prediction onto its row. */
export async function applyWhisperResult(
  supabase: SupabaseClient,
  rowId: string,
  prediction: { status: string; output?: any; error?: unknown },
) {
  if (prediction.status === 'succeeded') {
    const text = String(prediction.output?.transcription || '').trim();
    if (text) {
      await markRow(supabase, rowId, transcriptFields(text, 'whisper'));
    } else {
      await markRow(supabase, rowId, {
        transcript_status: 'unavailable',
        transcript_error: 'No speech detected',
        transcript_prediction_id: null,
      });
    }
    return;
  }
  await markRow(supabase, rowId, {
    transcript_status: 'failed',
    transcript_error: String(prediction.error || `Whisper ${prediction.status}`).slice(0, 300),
    transcript_prediction_id: null,
  });
}
