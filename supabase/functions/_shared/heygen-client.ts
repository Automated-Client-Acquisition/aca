/**
 * HeyGen API Client
 *
 * Centralized client for HeyGen API interactions.
 * HeyGen provides AI avatar video generation with built-in TTS.
 *
 * Base URL: https://api.heygen.com
 * Auth: X-API-KEY header
 */

const HEYGEN_BASE_URL = 'https://api.heygen.com';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HeyGenAvatar {
  avatar_id: string;
  name: string;
  gender?: string;
  language?: string;
  preview_image_url?: string;
  preview_video_url?: string;
  default_voice_id?: string;
  avatar_type: 'public' | 'private' | 'talking_photo';
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  gender?: string;
  language?: string;
  preview_audio?: string;
}

export interface HeyGenTemplate {
  template_id: string;
  name: string;
  thumbnail_image_url?: string;
  aspect_ratio?: string;
}

export interface HeyGenTemplateVariable {
  name: string;
  type: 'text' | 'image' | 'voice';
  properties: Record<string, any>;
}

export interface HeyGenTemplateDetails {
  version?: string;
  variables: Record<string, HeyGenTemplateVariable>;
  scenes: Array<{
    id: string;
    script?: string;
    variables?: Array<{ name: string; type: string }>;
  }>;
}

export interface HeyGenVideoInput {
  character: {
    type: 'avatar';
    avatar_id: string;
    avatar_style?: string;
  };
  voice: {
    type: 'text';
    input_text: string;
    voice_id: string;
  };
  background?: {
    type: 'color' | 'image' | 'video';
    color?: string;
    url?: string;
    image_asset_id?: string;
    video_asset_id?: string;
    play_style?: string;
  };
}

export interface GenerateVideoParams {
  video_inputs: HeyGenVideoInput[];
  dimension?: { width: number; height: number };
  callback_id?: string;
  test?: boolean;
  caption?: boolean;
  title?: string;
}

export interface HeyGenWebhookEndpoint {
  endpoint_id: string;
  url: string;
  status: string;
  events: string[];
  secret: string;
  created_at: string;
}

// ─── Error Handling ──────────────────────────────────────────────────────────

export interface HeyGenErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

export function parseHeyGenError(error: any): HeyGenErrorInfo {
  const message = error?.message || error?.error?.message || error?.msg || String(error);

  if (message.includes('401') || message.includes('Unauthorized') || message.includes('Invalid API')) {
    return { code: 'AUTHENTICATION_FAILED', message: 'Invalid HeyGen API key', retryable: false };
  }
  if (message.includes('429') || message.includes('rate limit') || message.includes('Too many')) {
    return { code: 'RATE_LIMITED', message: 'HeyGen rate limit reached. Try again later.', retryable: true };
  }
  if (message.includes('402') || message.includes('insufficient') || message.includes('credits')) {
    return { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient HeyGen credits', retryable: false };
  }
  if (message.includes('404') || message.includes('not found')) {
    return { code: 'NOT_FOUND', message: 'HeyGen resource not found', retryable: false };
  }
  if (message.includes('500') || message.includes('Internal')) {
    return { code: 'SERVER_ERROR', message: 'HeyGen server error. Try again later.', retryable: true };
  }

  return { code: 'UNKNOWN', message, retryable: false };
}

// ─── API Request Helper ──────────────────────────────────────────────────────

async function heygenRequest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${HEYGEN_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'X-Api-Key': apiKey,
    'Accept': 'application/json',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorBody: any;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { message: `HTTP ${response.status}: ${response.statusText}` };
    }
    throw new Error(errorBody?.error?.message || errorBody?.message || errorBody?.msg || `HeyGen API error: ${response.status}`);
  }

  return await response.json() as T;
}

// ─── Avatar APIs ─────────────────────────────────────────────────────────────

/**
 * List available avatars (public + private/custom + talking photos)
 * HeyGen v2 returns { data: { avatars: [...], talking_photos: [...] } }
 * Public avatars use `avatar_name`, talking photos use `talking_photo_name`.
 * We normalize all into a unified HeyGenAvatar shape.
 */
export async function listAvatars(apiKey: string): Promise<HeyGenAvatar[]> {
  const res = await heygenRequest<any>(apiKey, 'GET', '/v2/avatars');

  // Log raw keys for debugging
  const dataKeys = res.data ? Object.keys(res.data) : Object.keys(res);
  console.log(`HeyGen /v2/avatars response keys: ${dataKeys.join(', ')}`);

  const rawAvatars = res.data?.avatars || res.avatars || [];
  const rawTalkingPhotos = res.data?.talking_photos || res.talking_photos || [];

  console.log(`HeyGen avatars: ${rawAvatars.length} avatars, ${rawTalkingPhotos.length} talking photos`);
  if (rawAvatars.length > 0) {
    console.log(`Sample avatar keys: ${Object.keys(rawAvatars[0]).join(', ')}`);
  }
  if (rawTalkingPhotos.length > 0) {
    console.log(`Sample talking_photo keys: ${Object.keys(rawTalkingPhotos[0]).join(', ')}`);
  }

  const avatars: HeyGenAvatar[] = rawAvatars.map((a: any) => ({
    avatar_id: a.avatar_id,
    name: a.avatar_name || a.name || a.avatar_id,
    gender: a.gender,
    language: a.language,
    preview_image_url: a.preview_image_url,
    preview_video_url: a.preview_video_url,
    default_voice_id: a.default_voice_id || a.voice_id || undefined,
    avatar_type: (a.is_public === false || a.type === 'private') ? 'private' as const : 'public' as const,
  }));

  const talkingPhotos: HeyGenAvatar[] = rawTalkingPhotos.map((tp: any) => ({
    avatar_id: tp.talking_photo_id || tp.id,
    name: tp.talking_photo_name || tp.name || tp.talking_photo_id || 'Photo Avatar',
    gender: tp.gender,
    language: tp.language,
    preview_image_url: tp.preview_image_url || tp.image_url,
    preview_video_url: tp.preview_video_url,
    default_voice_id: tp.default_voice_id || tp.voice_id || undefined,
    avatar_type: 'talking_photo' as const,
  }));

  return [...avatars, ...talkingPhotos];
}

/**
 * Create a photo avatar group from an uploaded image
 */
export async function createPhotoAvatarGroup(
  apiKey: string,
  name: string,
  imageKey: string
): Promise<{ group_id: string; status: string }> {
  const res = await heygenRequest<{ data: { group_id: string; status: string } }>(
    apiKey, 'POST', '/v2/photo_avatar/avatar_group/create',
    { name, image_key: imageKey }
  );
  return res.data;
}

/**
 * Upload an image asset to HeyGen (for avatar creation)
 * Returns the image_key to use with createPhotoAvatarGroup
 */
export async function uploadAsset(
  apiKey: string,
  imageUrl: string
): Promise<string> {
  // Download the image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image from ${imageUrl}`);
  }
  const imageBlob = await imageResponse.blob();

  // Upload to HeyGen
  const formData = new FormData();
  formData.append('file', imageBlob, 'avatar.jpg');

  const response = await fetch(`${HEYGEN_BASE_URL}/v1/asset`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload asset to HeyGen: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.image_key || data.data?.asset_id;
}

/**
 * Check avatar training status (fallback for webhook)
 */
export async function getAvatarTrainingStatus(
  apiKey: string,
  groupId: string
): Promise<{ status: string; progress?: number }> {
  const res = await heygenRequest<{ data: { status: string; progress?: number } }>(
    apiKey, 'GET', `/v2/photo_avatar/avatar_group/training_status?group_id=${groupId}`
  );
  return res.data;
}

// ─── Voice APIs ──────────────────────────────────────────────────────────────

/**
 * List available voices
 * HeyGen v2 may return { data: { voices: [...] } } or { voices: [...] }
 */
export async function listVoices(apiKey: string): Promise<HeyGenVoice[]> {
  const res = await heygenRequest<any>(apiKey, 'GET', '/v2/voices');
  return res.data?.voices || res.voices || [];
}

// ─── Video Generation APIs ──────────────────────────────────────────────────

/**
 * Generate an avatar video (multi-scene supported)
 * Returns video_id for tracking via webhook
 */
export async function generateVideo(
  apiKey: string,
  params: GenerateVideoParams
): Promise<{ video_id: string }> {
  const res = await heygenRequest<{ data: { video_id: string } }>(
    apiKey, 'POST', '/v2/video/generate',
    params as unknown as Record<string, unknown>
  );
  return res.data;
}

// ─── Template APIs ───────────────────────────────────────────────────────────

/**
 * List available templates
 * HeyGen v2 may return { data: { templates: [...] } } or { templates: [...] }
 */
export async function listTemplates(apiKey: string): Promise<HeyGenTemplate[]> {
  const res = await heygenRequest<any>(apiKey, 'GET', '/v2/templates');
  return res.data?.templates || res.templates || [];
}

/**
 * Get template details (variables, scenes)
 */
export async function getTemplateDetails(
  apiKey: string,
  templateId: string
): Promise<HeyGenTemplateDetails> {
  const res = await heygenRequest<{ data: HeyGenTemplateDetails }>(
    apiKey, 'GET', `/v3/template/${templateId}`
  );
  return res.data;
}

/**
 * Generate video from template with variable values
 */
export async function generateFromTemplate(
  apiKey: string,
  templateId: string,
  variables: Record<string, { name: string; type: string; properties: Record<string, any> }>,
  options?: { callback_id?: string; title?: string; caption?: boolean; test?: boolean }
): Promise<{ video_id: string }> {
  const res = await heygenRequest<{ data: { video_id: string } }>(
    apiKey, 'POST', `/v2/template/${templateId}/generate`,
    {
      variables,
      callback_id: options?.callback_id,
      title: options?.title,
      caption: options?.caption,
      test: options?.test,
    }
  );
  return res.data;
}

// ─── Webhook APIs ────────────────────────────────────────────────────────────

/**
 * Register a webhook endpoint with HeyGen
 * Called automatically when API key is validated
 */
export async function registerWebhook(
  apiKey: string,
  url: string,
  events: string[]
): Promise<HeyGenWebhookEndpoint> {
  const res = await heygenRequest<{ data: HeyGenWebhookEndpoint }>(
    apiKey, 'POST', '/v1/webhook/endpoint.add',
    { url, events }
  );
  return res.data;
}

/**
 * Validate a HeyGen API key by listing avatars
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await listAvatars(apiKey);
    return true;
  } catch {
    return false;
  }
}
