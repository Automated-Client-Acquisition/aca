/**
 * OpenAI Image Provider (Responses API)
 *
 * Multiturn image generation via OpenAI's Responses API (/v1/responses) using
 * the `image_generation` tool. This is the path GPT-5.5 uses for images.
 *
 * Native multiturn: each call after the first passes `previous_response_id`,
 * so the model retains the full conversation — including images it already
 * generated. That keeps character, style, and composition consistent across
 * carousel slides without manually re-feeding prior images.
 *
 * Flow:
 *   slide 1: generate(prompt)                         -> { base64, responseId }
 *   slide N: generate(prompt, { previousResponseId })  -> { base64, responseId }
 *
 * The caller threads responseId from each slide into the next.
 */

import { BaseProvider, ProviderFactory, retryWithBackoff } from './BaseProvider.ts';
import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-5.5';

export const OPENAI_IMAGE_MODELS = {
  GPT_5_5: 'gpt-5.5',
} as const;

// The image_generation tool accepts a `size` knob. Map semantic aspect ratios
// onto the supported sizes.
const ASPECT_RATIO_SIZE: Record<string, '1024x1024' | '1024x1536' | '1536x1024' | 'auto'> = {
  '1:1': '1024x1024',
  square: '1024x1024',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
  portrait: '1024x1536',
  '16:9': '1536x1024',
  '4:3': '1536x1024',
  landscape: '1536x1024',
};

export type OpenAIImageQuality = 'low' | 'medium' | 'high' | 'auto';
export type OpenAIImageBackground = 'transparent' | 'opaque' | 'auto';
export type OpenAIImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
  /** Responses API id — pass as previousResponseId on the next slide. */
  responseId?: string;
}

export interface OpenAIImageOptions {
  aspectRatio?: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  quality?: OpenAIImageQuality;
  background?: OpenAIImageBackground;
  outputFormat?: OpenAIImageOutputFormat;
  /** Thread native multiturn state from the previous slide. */
  previousResponseId?: string;
  /**
   * Reference/input images (e.g. a brand logo) passed to the image_generation
   * tool as `input_image` parts. Plain HTTPS URLs or data URLs. When present,
   * `input` is sent as a structured user message instead of a bare string.
   */
  referenceImages?: string[];
}

interface ResponsesApiOutput {
  type: string;
  result?: string;            // base64 image (image_generation_call)
  status?: string;
}

interface ResponsesApiResponse {
  id: string;
  model: string;
  status: string;
  output?: ResponsesApiOutput[];
  error?: { message?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAIImageProvider extends BaseProvider {
  constructor(apiKey: string, options?: { baseUrl?: string }) {
    super(apiKey, {
      baseUrl: options?.baseUrl || 'https://api.openai.com/v1',
    });
  }

  getProviderName(): string {
    return 'OpenAIImage';
  }

  isAsync(): boolean {
    return false;
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    this.validateRequest(request, ['prompt']);
    this.logRequest(request);

    const model = request.model || DEFAULT_OPENAI_IMAGE_MODEL;
    const opts = this.optionsFromRequest(request);
    const image = await this.generate(request.prompt, model, opts);

    const response: ProviderResponse = {
      content: image,
      model,
      status: 'completed',
    };
    this.logResponse({
      ...response,
      content: `[ImageData: base64, ${image.width}x${image.height}, responseId=${image.responseId}]`,
    });
    return response;
  }

  /**
   * Check the requested image model against the models this API key can really
   * access (GET /v1/models). If a `gpt-image-*` model isn't available, fall back
   * to the newest one that is, so a stale/optimistic blueprint setting doesn't
   * hard-fail. Best-effort: any lookup failure leaves the requested model alone.
   */
  private async resolveAvailableModel(requested: string): Promise<string> {
    if (!requested.startsWith('gpt-image')) return requested;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return requested;
      const ids: string[] = ((await res.json()).data || []).map((m: { id: string }) => m.id);
      if (ids.includes(requested)) return requested;
      const fallback = ids
        .filter((id) => /^gpt-image-[\d.]+$/.test(id))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
      console.warn(
        `[OpenAIImage] Model "${requested}" not available to this key. ` +
        `${fallback ? `Using "${fallback}".` : 'No gpt-image model found; trying as requested.'}`,
      );
      return fallback || requested;
    } catch {
      return requested;
    }
  }

  /**
   * Generate one image via the Responses API image_generation tool.
   *
   * For the first slide, omit previousResponseId. For subsequent slides, pass
   * the responseId returned by the previous call — the model then has the full
   * prior context (text + generated images) and stays visually consistent.
   */
  async generate(
    prompt: string,
    model: string = DEFAULT_OPENAI_IMAGE_MODEL,
    options: OpenAIImageOptions = {},
  ): Promise<GeneratedImage> {
    const size = this.resolveSize(options);
    model = await this.resolveAvailableModel(model);

    // `gpt-image-*` are image models, not Responses API models: they go in the
    // image_generation tool's `model`, with the default mainline model orchestrating.
    const isImageOnlyModel = model.startsWith('gpt-image');
    const responsesModel = isImageOnlyModel ? DEFAULT_OPENAI_IMAGE_MODEL : model;

    const imageTool: Record<string, unknown> = { type: 'image_generation' };
    if (isImageOnlyModel) imageTool.model = model;
    if (size !== 'auto') imageTool.size = size;
    if (options.quality && options.quality !== 'auto') imageTool.quality = options.quality;
    if (options.background && options.background !== 'auto') imageTool.background = options.background;
    if (options.outputFormat) imageTool.output_format = options.outputFormat;

    // With reference images, send a structured user message (input_text +
    // input_image parts) so the image_generation tool can use them; otherwise a
    // bare prompt string (unchanged legacy behavior). previous_response_id works
    // alongside either form.
    const refs = (options.referenceImages || []).filter(Boolean);
    const body: Record<string, unknown> = {
      model: responsesModel,
      input: refs.length > 0
        ? [{
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...refs.map((url) => ({ type: 'input_image', image_url: url })),
            ],
          }]
        : prompt,
      tools: [imageTool],
      // Force the tool call. On auto, the orchestrating model can finish with
      // only reasoning/text (no image_generation_call), which retries can't fix.
      tool_choice: { type: 'image_generation' },
    };
    if (options.previousResponseId) {
      body.previous_response_id = options.previousResponseId;
    }

    return retryWithBackoff(
      async () => {
        const res = await fetch(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`OpenAI Responses API error ${res.status}: ${errBody}`);
        }
        const data = (await res.json()) as ResponsesApiResponse;
        return this.extractImage(data, size, options.outputFormat || 'png');
      },
      { maxRetries: 3, operationName: 'OpenAI Responses image generation' },
    );
  }

  /**
   * Upload a base64 image to Supabase Storage and return the public URL.
   */
  static async uploadBase64ToStorage(
    supabase: any,
    base64: string,
    fileName: string,
    mimeType = 'image/png',
    bucket = 'content-media',
  ): Promise<string> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { error } = await supabase.storage.from(bucket).upload(fileName, bytes, {
      contentType: mimeType,
      upsert: true,
    });
    if (error) {
      throw new Error(`Failed to upload generated image: ${error.message}`);
    }
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return publicUrl;
  }

  private optionsFromRequest(request: ProviderRequest): OpenAIImageOptions {
    const cfg = request.config || {};
    return {
      aspectRatio: cfg.aspectRatio,
      size: cfg.size,
      quality: cfg.quality,
      background: cfg.background,
      outputFormat: cfg.outputFormat,
      previousResponseId: cfg.previousResponseId,
    };
  }

  private resolveSize(options: OpenAIImageOptions): '1024x1024' | '1024x1536' | '1536x1024' | 'auto' {
    if (options.size) return options.size;
    if (options.aspectRatio && ASPECT_RATIO_SIZE[options.aspectRatio]) {
      return ASPECT_RATIO_SIZE[options.aspectRatio];
    }
    return '1024x1024';
  }

  private extractImage(
    data: ResponsesApiResponse,
    size: string,
    requestedFormat: OpenAIImageOutputFormat,
  ): GeneratedImage {
    if (data.error?.message) {
      throw new Error(`OpenAI Responses API returned error: ${data.error.message}`);
    }
    const imageCall = (data.output || []).find(
      (o) => o.type === 'image_generation_call' && o.result,
    );
    const b64 = imageCall?.result;
    if (!b64) {
      // The raw JSON opens with ~500 chars of envelope metadata, so summarize the
      // parts that explain the miss: output item types, any refusal/text, status.
      const outputTypes = (data.output || []).map((o) => `${o.type}${o.status ? `:${o.status}` : ''}`);
      const text = (data.output || [])
        .flatMap((o: any) => (Array.isArray(o.content) ? o.content : []))
        .map((c: any) => c?.text || c?.refusal)
        .filter(Boolean)
        .join(' ')
        .substring(0, 300);
      throw new Error(
        `OpenAI Responses API returned no image (status=${data.status}, output=[${outputTypes.join(', ')}]` +
        `${(data as any).incomplete_details ? `, incomplete=${JSON.stringify((data as any).incomplete_details)}` : ''}` +
        `${text ? `, text="${text}"` : ''})`,
      );
    }
    const [w, h] = size === 'auto' ? [undefined, undefined] : size.split('x').map((n) => parseInt(n, 10));
    const mime = requestedFormat === 'jpeg'
      ? 'image/jpeg'
      : requestedFormat === 'webp'
        ? 'image/webp'
        : 'image/png';
    return { base64: b64, mimeType: mime, width: w, height: h, responseId: data.id };
  }
}

ProviderFactory.register('openai_image', OpenAIImageProvider);

export default OpenAIImageProvider;
