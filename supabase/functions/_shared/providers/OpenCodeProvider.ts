/**
 * OpenCode Go Provider
 *
 * Handles text generation via the OpenCode Go API (https://opencode.ai).
 * OpenAI-compatible chat/completions on a subscription dollar allowance.
 *
 * Every request MUST carry:
 * - `x-opencode-session` — stable per-org session id; without it the API
 *   returns 400 MissingSessionID
 * - an explicit `User-Agent` — Cloudflare 403s the default Deno one
 *
 * Model ids are OpenCode-native (e.g. `deepseek-v4.1-flash`) — the
 * `opencode:` prefix is stripped upstream by llm-client before the id
 * reaches this provider.
 */

import { BaseProvider, retryWithBackoff } from './BaseProvider.ts';
import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';
import { normalizeDashes } from '../sanitize-ai-output.ts';

// OpenCode Go base URL (OpenAI-compatible /chat/completions)
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// Published off-peak per-1M-token pricing for the main Go-tier models; used
// only for cost accounting (the actual bill is the subscription's dollar
// allowance). Peak hours (01:00-04:00 & 06:00-10:00 UTC, weekdays) double it.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-v4.1-flash': { input: 0.15, output: 0.60 },
  'deepseek-v4-pro': { input: 0.66, output: 1.98 },
  'deepseek-v4-flash': { input: 0.15, output: 0.60 },
  'deepseek-flash': { input: 0.15, output: 0.60 },
};

// Content can be a plain string or an array of content parts (vision/multimodal)
type OpencodeContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

interface OpencodeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpencodeContentPart[];
}

interface OpencodeResponse {
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
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export class OpenCodeProvider extends BaseProvider {
  private sessionId: string;

  constructor(
    apiKey: string,
    options?: {
      baseUrl?: string;
      sessionId?: string;
    }
  ) {
    super(apiKey, {
      baseUrl: options?.baseUrl || OPENCODE_GO_BASE_URL,
    });
    this.sessionId = options?.sessionId || 'aca-default';
  }

  getProviderName(): string {
    return 'OpenCode';
  }

  isAsync(): boolean {
    return false; // OpenCode Go chat completions are synchronous
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    this.validateRequest(request, ['prompt', 'model']);
    this.logRequest(request);

    return retryWithBackoff(
      async () => {
        const messages: OpencodeMessage[] = [];

        if (request.systemPrompt) {
          messages.push({ role: 'system', content: request.systemPrompt });
        }

        // Build user message — multimodal (images + text) or plain text
        if (request.images && request.images.length > 0) {
          const contentParts: OpencodeContentPart[] = [
            { type: 'text' as const, text: request.prompt },
            ...request.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: img.url, detail: img.detail },
            })),
          ];
          messages.push({ role: 'user', content: contentParts });
        } else {
          messages.push({ role: 'user', content: request.prompt });
        }

        const body: Record<string, any> = {
          model: request.model,
          messages,
        };

        // Optional parameters
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
        // Reasoning is billed as output tokens on OpenCode Go and dominates
        // the bill on judgment-free generation stages; off unless asked for.
        if (request.config.reasoningEffort !== undefined) {
          body.reasoning_effort = request.config.reasoningEffort;
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'x-opencode-session': this.sessionId,
            'User-Agent': 'ACA/1.0',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`OpenCode API error ${response.status}: ${errorBody}`);
        }

        const result: OpencodeResponse = await response.json();

        let content = result.choices?.[0]?.message?.content || '';
        content = this.cleanTextOutput(content);

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
      { maxRetries: 3, operationName: 'OpenCode text generation' }
    );
  }

  /**
   * Clean up AI-generated text output (mirrors OpenRouterProvider).
   */
  private cleanTextOutput(text: string): string {
    if (!text) return '';

    let cleaned = normalizeDashes(text)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    cleaned = cleaned
      .replace(/^(Here's|Here is|Sure|Okay|Of course)[,:]?\s*/i, '')
      .replace(/^(I've created|I have created|I'll create)[^.]*\.\s*/i, '');

    return cleaned;
  }

  /**
   * Approximate cost from usage and published off-peak pricing. The real
   * bill is the subscription's monthly dollar allowance — this is for
   * per-job accounting only.
   */
  private calculateCost(
    usage: OpencodeResponse['usage'] | undefined,
    model: string
  ): number {
    if (!usage) return 0;

    const pricing = MODEL_PRICING[model] || { input: 0, output: 0 };
    const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.input;
    const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }
}

export default OpenCodeProvider;
