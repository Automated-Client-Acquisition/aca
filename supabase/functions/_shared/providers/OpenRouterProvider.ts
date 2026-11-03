/**
 * OpenRouter Provider
 *
 * Handles text generation via OpenRouter API.
 * Supports various models: GPT-4, Claude, Gemini, Llama, etc.
 */

import { BaseProvider, ProviderFactory, retryWithBackoff } from './BaseProvider.ts';
import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';
import { normalizeDashes } from '../sanitize-ai-output.ts';

// Model pricing per 1K tokens (approximate)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'google/gemini-3-flash-preview': { input: 0.0000005, output: 0.000003 },
  'google/gemini-flash-1.5': { input: 0.000075, output: 0.0003 },
  'anthropic/claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'anthropic/claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'meta-llama/llama-3.1-70b-instruct': { input: 0.00052, output: 0.00075 },
  'qwen/qwen-2.5-72b-instruct': { input: 0.00035, output: 0.0004 },
};

// Content can be a plain string or an array of content parts (for vision/multimodal)
type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenRouterContentPart[];
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * A max_tokens above the model's output ceiling comes back as HTTP 400. The
 * budget to retry with: the ceiling the error names, or undefined (send none)
 * when it mentions max_tokens without a number. null = the 400 is about
 * something else. Same parsing as execute-stage's streamOpenRouterCompletion.
 */
export function retryMaxTokensFor400(errorBody: string): number | undefined | null {
  if (!/max_tokens/i.test(errorBody)) return null;
  const ceiling = Number(errorBody.match(/at most (\d+)\s+(?:completion\s+)?tokens/i)?.[1] || 0);
  return ceiling > 0 ? ceiling : undefined;
}

export class OpenRouterProvider extends BaseProvider {
  private referer: string;
  private appTitle: string;

  constructor(
    apiKey: string,
    options?: {
      baseUrl?: string;
      webhookUrl?: string;
      referer?: string;
      appTitle?: string;
    }
  ) {
    super(apiKey, {
      baseUrl: options?.baseUrl || 'https://openrouter.ai/api/v1',
      webhookUrl: options?.webhookUrl,
    });
    this.referer = options?.referer || Deno.env.get('SUPABASE_URL') || '';
    this.appTitle = options?.appTitle || 'ContentAI Studio';
  }

  getProviderName(): string {
    return 'OpenRouter';
  }

  isAsync(): boolean {
    return false; // OpenRouter is synchronous
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    this.validateRequest(request, ['prompt', 'model']);
    this.logRequest(request);

    return retryWithBackoff(
      async () => {
        const messages: OpenRouterMessage[] = [];

        // Add system prompt if provided
        if (request.systemPrompt) {
          messages.push({ role: 'system', content: request.systemPrompt });
        }

        // Build user message — multimodal (images + text) or plain text
        if (request.images && request.images.length > 0) {
          // Text prompt first, then images (per OpenRouter docs)
          const contentParts: OpenRouterContentPart[] = [
            { type: 'text' as const, text: request.prompt },
            ...request.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: img.url },
            })),
          ];
          messages.push({ role: 'user', content: contentParts });
          console.log(`[OpenRouterProvider] Multimodal request with ${request.images.length} images, first URL: ${request.images[0]?.url?.substring(0, 100)}`);
        } else {
          messages.push({ role: 'user', content: request.prompt });
        }

        const body: Record<string, any> = {
          model: request.model,
          messages,
        };

        // Add optional parameters
        if (request.config.temperature !== undefined) {
          body.temperature = request.config.temperature;
        }
        if (request.config.maxTokens !== undefined) {
          body.max_tokens = request.config.maxTokens;
        }
        if (request.config.topP !== undefined) {
          body.top_p = request.config.topP;
        }
        if (request.config.responseFormat !== undefined) {
          body.response_format = request.config.responseFormat;
        }

        const send = (payload: Record<string, any>) => fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.referer,
            'X-Title': this.appTitle,
          },
          body: JSON.stringify(payload),
        });

        let response = await send(body);

        if (!response.ok && response.status === 400 && body.max_tokens !== undefined) {
          const errorBody = await response.text();
          const budget = retryMaxTokensFor400(errorBody);
          if (budget === null) {
            throw new Error(`OpenRouter API error 400: ${errorBody}`);
          }
          console.warn(`[OpenRouterProvider] ${request.model} rejected max_tokens=${body.max_tokens}; retrying with ${budget ?? 'the provider default'}`);
          const retryBody = { ...body };
          if (budget === undefined) delete retryBody.max_tokens;
          else retryBody.max_tokens = budget;
          response = await send(retryBody);
        }

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
        }

        const result: OpenRouterResponse = await response.json();

        // Extract content
        let content = result.choices?.[0]?.message?.content || '';

        // Apply text cleanup
        content = this.cleanTextOutput(content);

        // Calculate cost
        const cost = this.calculateCost(result.usage, request.model);

        const providerResponse: ProviderResponse = {
          content,
          model: result.model || request.model,
          usage: result.usage
            ? {
                inputTokens: result.usage.prompt_tokens,
                outputTokens: result.usage.completion_tokens,
                totalTokens: result.usage.total_tokens,
              }
            : undefined,
          cost,
          status: 'completed',
          finishReason: result.choices?.[0]?.finish_reason ?? undefined,
        };

        this.logResponse(providerResponse);
        return providerResponse;
      },
      { maxRetries: 3, operationName: 'OpenRouter text generation' }
    );
  }

  /**
   * Clean up AI-generated text output.
   */
  private cleanTextOutput(text: string): string {
    if (!text) return '';

    // Fix common AI typography issues
    let cleaned = normalizeDashes(text)
      // Fix curly quotes to straight quotes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      // Fix ellipsis
      .replace(/\u2026/g, '...')
      // Remove excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Remove common AI artifacts
    cleaned = cleaned
      .replace(/^(Here's|Here is|Sure|Okay|Of course)[,:]?\s*/i, '')
      .replace(/^(I've created|I have created|I'll create)[^.]*\.\s*/i, '');

    return cleaned;
  }

  /**
   * Calculate cost based on usage and model.
   */
  private calculateCost(
    usage: OpenRouterResponse['usage'] | undefined,
    model: string
  ): number {
    if (!usage) return 0;

    // Find pricing for model (or default to zero)
    const pricing = MODEL_PRICING[model] || { input: 0, output: 0 };

    const inputCost = (usage.prompt_tokens / 1000) * pricing.input;
    const outputCost = (usage.completion_tokens / 1000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Parse JSON from text response (handles markdown code blocks).
   */
  static parseJsonResponse(text: string): any {
    // Try direct parse first
    try {
      return JSON.parse(text);
    } catch {
      // Try extracting from markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // Continue to other methods
        }
      }

      // Try finding JSON array or object
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch {
          // Continue
        }
      }

      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          // Continue
        }
      }

      throw new Error('Could not parse JSON from response');
    }
  }
}

// Register with factory
ProviderFactory.register('openrouter', OpenRouterProvider);

export default OpenRouterProvider;
