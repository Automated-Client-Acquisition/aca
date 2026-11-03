/**
 * OpenRouter's Video API (async jobs) for Video Studio.
 *
 *   POST /api/v1/videos            -> 202 { id: "gen-vid-...", status: "pending" }
 *   GET  /api/v1/videos/{id}       -> status, unsigned_urls / urls, usage { cost, is_byok }
 *   GET  /api/v1/videos/{id}/content?index=0  (needs the API key, NOT presigned)
 *   GET  /api/v1/videos/models     -> per-model durations, ratios, frame support
 *
 * Every call is a `video_generations` row. Submission records the job id and a
 * per-row callback secret; the `openrouter-video-webhook` (on OpenRouter's
 * callback) and `openrouter-video-poll` (cron fallback) both end in
 * `finalizeVideoGeneration`, which claims the row so only one of them downloads
 * the file and persists it to the org's storage.
 *
 * Keys are the org's own OpenRouter key (`api_keys`, provider 'openrouter',
 * parent inheritance via resolveApiKey). We never fall back to a platform key.
 */

import { resolveApiKey } from './resolve-api-key.ts';
import { decryptApiKey } from './llm-client.ts';
import { resolveStorageCredentials, uploadBlobToStorage } from './byok-storage.ts';

export const OPENROUTER_VIDEOS_URL = 'https://openrouter.ai/api/v1/videos';

const MODELS_TTL_MS = 60 * 60 * 1000;
const CLAIM_MS = 5 * 60 * 1000;
/** A job still not terminal this long after submit is given up on. */
export const VIDEO_JOB_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const FALLBACK_BUCKET = 'content-media';

export type VideoGenerationKind = 'frame' | 'clip' | 'edit' | 'avatar' | 'extend' | 'upscale' | 'identity';
export type VideoJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
const TERMINAL: VideoJobStatus[] = ['completed', 'failed', 'cancelled', 'expired'];

type MediaPart =
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'audio_url'; audio_url: { url: string } };

export interface VideoRequest {
  model: string;
  prompt?: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  size?: string;
  generate_audio?: boolean;
  seed?: number;
  frame_images?: Array<{ type: 'image_url'; image_url: { url: string }; frame_type: 'first_frame' | 'last_frame' }>;
  input_references?: MediaPart[];
  previous_job_id?: string;
  upscale_factor?: number;
  session_id?: string;
}

export interface VideoModel {
  id: string;
  supported_resolutions: string[] | null;
  supported_aspect_ratios: string[] | null;
  supported_durations: number[] | null;
  supported_frame_images: string[] | null;
  generate_audio: boolean | null;
  pricing_skus: Record<string, string> | null;
}

export interface VideoJob {
  id: string;
  status: VideoJobStatus | string;
  unsigned_urls?: string[];
  urls?: string[];
  usage?: { cost?: number; is_byok?: boolean };
  error?: string;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/** The org's decrypted OpenRouter key, or null when none is set. */
export async function resolveOpenRouterKey(supabase: any, organizationId: string): Promise<string | null> {
  const resolved = await resolveApiKey(supabase, organizationId, 'openrouter');
  if (!resolved) return null;
  return await decryptApiKey(resolved.key_encrypted);
}

// ─── Model capabilities ──────────────────────────────────────────────────────

let modelsCache: { at: number; models: VideoModel[] } | null = null;

export async function listVideoModels(): Promise<VideoModel[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
  const res = await fetch(`${OPENROUTER_VIDEOS_URL}/models`);
  if (!res.ok) throw new Error(`OpenRouter video models: ${res.status}`);
  const body = await res.json();
  const models: VideoModel[] = (body?.data ?? body ?? []).map((m: any) => ({
    id: m.id,
    supported_resolutions: m.supported_resolutions ?? null,
    supported_aspect_ratios: m.supported_aspect_ratios ?? null,
    supported_durations: m.supported_durations ?? null,
    supported_frame_images: m.supported_frame_images ?? null,
    generate_audio: m.generate_audio ?? null,
    pricing_skus: m.pricing_skus ?? null,
  }));
  modelsCache = { at: Date.now(), models };
  return models;
}

export async function getVideoModel(id: string): Promise<VideoModel | null> {
  return (await listVideoModels()).find((m) => m.id === id) ?? null;
}

/**
 * Problems that would make OpenRouter reject the request, checked against the
 * model's published capabilities. A null capability list means "not declared",
 * which we don't block on.
 */
export function validateVideoRequest(req: VideoRequest, model: VideoModel): string[] {
  const errors: string[] = [];
  if (req.duration != null && model.supported_durations && !model.supported_durations.includes(req.duration)) {
    errors.push(`${model.id} takes durations ${model.supported_durations.join(', ')}s, not ${req.duration}s`);
  }
  if (req.aspect_ratio && model.supported_aspect_ratios && !model.supported_aspect_ratios.includes(req.aspect_ratio)) {
    errors.push(`${model.id} takes aspect ratios ${model.supported_aspect_ratios.join(', ')}, not ${req.aspect_ratio}`);
  }
  if (req.resolution && model.supported_resolutions && !model.supported_resolutions.includes(req.resolution)) {
    errors.push(`${model.id} takes resolutions ${model.supported_resolutions.join(', ')}, not ${req.resolution}`);
  }
  for (const f of req.frame_images ?? []) {
    if (!model.supported_frame_images?.includes(f.frame_type)) {
      errors.push(`${model.id} does not accept a ${f.frame_type}`);
    }
  }
  return errors;
}

// ─── Raw API calls ───────────────────────────────────────────────────────────

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.error || j?.message || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

export class OpenRouterVideoError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function createVideoJob(
  apiKey: string,
  req: VideoRequest,
  callbackUrl?: string,
): Promise<VideoJob> {
  const res = await fetch(OPENROUTER_VIDEOS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(callbackUrl ? { ...req, callback_url: callbackUrl } : req),
  });
  if (!res.ok) throw new OpenRouterVideoError(await readError(res), res.status);
  return await res.json();
}

export async function getVideoJob(apiKey: string, jobId: string): Promise<VideoJob> {
  const res = await fetch(`${OPENROUTER_VIDEOS_URL}/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new OpenRouterVideoError(await readError(res), res.status);
  return await res.json();
}

/** The finished file. Prefers a signed `urls` entry, else the keyed content endpoint. */
export async function downloadVideoOutput(apiKey: string, job: VideoJob, index = 0): Promise<Blob> {
  const signed = job.urls?.[index];
  const res = signed
    ? await fetch(signed)
    : await fetch(`${OPENROUTER_VIDEOS_URL}/${encodeURIComponent(job.id)}/content?index=${index}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
  if (!res.ok) throw new OpenRouterVideoError(`Download failed: ${await readError(res)}`, res.status);
  return await res.blob();
}

// ─── Callback secret ─────────────────────────────────────────────────────────

/**
 * The signing secret for OpenRouter webhooks belongs to each org's own
 * OpenRouter workspace, which we don't hold, so we can't check
 * X-OpenRouter-Signature. Instead each row gets a random token in its
 * callback URL; only its sha256 is stored.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare of two hex strings of equal length. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Submit ──────────────────────────────────────────────────────────────────

export interface SubmitVideoGenerationParams {
  organizationId: string;
  createdBy?: string | null;
  kind: VideoGenerationKind;
  request: VideoRequest;
  storyId?: string | null;
  blockId?: string | null;
  shotId?: string | null;
  characterId?: string | null;
  /** Skip the capability check (e.g. edit/upscale models that declare nothing). */
  skipValidation?: boolean;
}

export type SubmitVideoGenerationResult =
  | { ok: true; generationId: string; jobId: string }
  | { ok: false; generationId?: string; error: string; status?: number };

/**
 * Insert the ledger row, submit the job with a callback URL, record the job id.
 * A failed submit leaves the row `failed` with the provider's message, so the
 * UI can show why (402 = out of OpenRouter credit).
 */
export async function submitVideoGeneration(
  supabase: any,
  p: SubmitVideoGenerationParams,
): Promise<SubmitVideoGenerationResult> {
  const apiKey = await resolveOpenRouterKey(supabase, p.organizationId);
  if (!apiKey) return { ok: false, error: 'Add an OpenRouter API key in Settings to generate video.' };

  if (!p.skipValidation) {
    const model = await getVideoModel(p.request.model);
    if (!model) return { ok: false, error: `Unknown OpenRouter video model: ${p.request.model}` };
    const problems = validateVideoRequest(p.request, model);
    if (problems.length) return { ok: false, error: problems.join('; ') };
  }

  const token = randomToken();
  const { data: row, error: insertError } = await supabase
    .from('video_generations')
    .insert({
      organization_id: p.organizationId,
      created_by: p.createdBy ?? null,
      kind: p.kind,
      model: p.request.model,
      request: p.request,
      story_id: p.storyId ?? null,
      block_id: p.blockId ?? null,
      shot_id: p.shotId ?? null,
      character_id: p.characterId ?? null,
      callback_token_hash: await sha256Hex(token),
      status: 'queued',
    })
    .select('id')
    .single();
  if (insertError || !row) return { ok: false, error: `Could not record generation: ${insertError?.message}` };

  const callbackUrl =
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/openrouter-video-webhook?g=${row.id}&t=${token}`;
  const request = { ...p.request, session_id: p.request.session_id ?? p.storyId ?? undefined };

  try {
    const job = await createVideoJob(apiKey, request, callbackUrl);
    await supabase
      .from('video_generations')
      .update({
        openrouter_job_id: job.id,
        // Anything but 'pending' (including an instant terminal status) goes to
        // in_progress so finalize reads the real result through the same path.
        status: job.status === 'pending' ? 'pending' : 'in_progress',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return { ok: true, generationId: row.id, jobId: job.id };
  } catch (err) {
    const status = err instanceof OpenRouterVideoError ? err.status : undefined;
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('video_generations')
      .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
      .eq('id', row.id);
    return { ok: false, generationId: row.id, error: message, status };
  }
}

// ─── Finalize (webhook + poller) ─────────────────────────────────────────────

async function persistOutput(supabase: any, organizationId: string, generationId: string, blob: Blob): Promise<string> {
  const contentType = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'video/mp4';
  const extension = contentType.includes('webm') ? 'webm' : 'mp4';

  let hasByok = true;
  try {
    await resolveStorageCredentials(supabase, organizationId);
  } catch {
    hasByok = false;
  }
  if (hasByok) {
    return await uploadBlobToStorage(supabase, organizationId, blob, 'video', generationId, extension, contentType);
  }

  const path = `video-studio/${organizationId}/${generationId}.${extension}`;
  const { error } = await supabase.storage
    .from(FALLBACK_BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return supabase.storage.from(FALLBACK_BUCKET).getPublicUrl(path).data.publicUrl;
}

export type FinalizeOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'still_running'
  | 'claimed_elsewhere'
  | 'already_done'
  | 'not_found';

/**
 * Bring one row up to date with OpenRouter. Safe to call from both the webhook
 * and the poller at once: the row is claimed with a short lease, and a row
 * that is already terminal is left alone.
 */
export async function finalizeVideoGeneration(supabase: any, generationId: string): Promise<FinalizeOutcome> {
  const now = new Date();
  const { data: claimed } = await supabase
    .from('video_generations')
    .update({ claimed_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
    .eq('id', generationId)
    .in('status', ['pending', 'in_progress'])
    .or(`claimed_until.is.null,claimed_until.lt.${now.toISOString()}`)
    .select('id, organization_id, openrouter_job_id, submitted_at, poll_attempts')
    .maybeSingle();

  if (!claimed) {
    const { data: row } = await supabase
      .from('video_generations')
      .select('status')
      .eq('id', generationId)
      .maybeSingle();
    if (!row) return 'not_found';
    return TERMINAL.includes(row.status) ? 'already_done' : 'claimed_elsewhere';
  }

  const release = (fields: Record<string, unknown>) =>
    supabase.from('video_generations').update({ claimed_until: null, ...fields }).eq('id', generationId);

  const tooOld = claimed.submitted_at
    && now.getTime() - new Date(claimed.submitted_at).getTime() > VIDEO_JOB_MAX_AGE_MS;

  try {
    const apiKey = await resolveOpenRouterKey(supabase, claimed.organization_id);
    if (!apiKey) throw new Error('OpenRouter key was removed before the job finished');
    if (!claimed.openrouter_job_id) throw new Error('No OpenRouter job id recorded');

    const job = await getVideoJob(apiKey, claimed.openrouter_job_id);
    const polled = { last_polled_at: now.toISOString(), poll_attempts: (claimed.poll_attempts ?? 0) + 1 };

    if (job.status === 'completed') {
      const blob = await downloadVideoOutput(apiKey, job);
      const outputUrl = await persistOutput(supabase, claimed.organization_id, generationId, blob);
      await release({
        ...polled,
        status: 'completed',
        output_url: outputUrl,
        cost: job.usage?.cost ?? null,
        is_byok: job.usage?.is_byok ?? null,
        error: null,
        completed_at: now.toISOString(),
      });
      return 'completed';
    }

    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
      await release({
        ...polled,
        status: job.status,
        error: job.error ?? `OpenRouter job ${job.status}`,
        cost: job.usage?.cost ?? null,
        completed_at: now.toISOString(),
      });
      return job.status;
    }

    if (tooOld) {
      await release({ ...polled, status: 'expired', error: 'Gave up after 2h without a result', completed_at: now.toISOString() });
      return 'expired';
    }

    await release({ ...polled, status: job.status === 'pending' ? 'pending' : 'in_progress' });
    return 'still_running';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A 404 on the job, or a run past the max age, won't recover; anything
    // else (network, 5xx, storage hiccup) is retried by the next poll.
    const fatal = tooOld || (err instanceof OpenRouterVideoError && err.status === 404);
    await release(
      fatal
        ? { status: 'failed', error: message, completed_at: now.toISOString(), last_polled_at: now.toISOString() }
        : { error: message, last_polled_at: now.toISOString(), poll_attempts: (claimed.poll_attempts ?? 0) + 1 },
    );
    return fatal ? 'failed' : 'still_running';
  }
}
