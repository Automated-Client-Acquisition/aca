/**
 * BaseProvider - Abstract interface for AI provider implementations.
 *
 * All providers (OpenRouter, Replicate, ElevenLabs) implement this interface.
 * This enables uniform handling of different AI services in the execution engine.
 */

import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';

/**
 * Abstract base class for AI providers.
 *
 * Implementations must provide:
 * - execute(): Send request to the provider and return response
 * - isAsync(): Whether the provider uses webhooks for completion
 * - getProviderName(): Human-readable provider name
 */
export abstract class BaseProvider {
  protected apiKey: string;
  protected baseUrl: string;
  protected webhookUrl?: string;

  constructor(apiKey: string, options?: { baseUrl?: string; webhookUrl?: string }) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl || '';
    this.webhookUrl = options?.webhookUrl;
  }

  /**
   * Execute a request to the provider.
   *
   * For sync providers (OpenRouter, ElevenLabs): Returns completed response.
   * For async providers (Replicate): Returns response with predictionId, status='pending'.
   */
  abstract execute(request: ProviderRequest): Promise<ProviderResponse>;

  /**
   * Whether this provider is async (uses webhooks for completion).
   *
   * Async providers:
   * - Return immediately with a predictionId
   * - Send results via webhook when complete
   *
   * Sync providers:
   * - Block until the result is ready
   * - Return the complete response
   */
  abstract isAsync(): boolean;

  /**
   * Get the provider name for logging/debugging.
   */
  abstract getProviderName(): string;

  /**
   * Check the status of an async prediction.
   * Only implemented by async providers.
   */
  async checkStatus(_predictionId: string): Promise<ProviderResponse> {
    throw new Error(`${this.getProviderName()} does not support status checks`);
  }

  /**
   * Cancel an async prediction.
   * Only implemented by async providers.
   */
  async cancel(_predictionId: string): Promise<void> {
    throw new Error(`${this.getProviderName()} does not support cancellation`);
  }

  /**
   * Validate that required fields are present in the request.
   */
  protected validateRequest(request: ProviderRequest, requiredFields: string[]): void {
    for (const field of requiredFields) {
      const value = request[field as keyof ProviderRequest];
      if (value === undefined || value === null || value === '') {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  /**
   * Log request details (redacting sensitive data).
   */
  protected logRequest(request: ProviderRequest): void {
    console.log(`[${this.getProviderName()}] Request:`, {
      model: request.model,
      promptLength: request.prompt?.length || 0,
      systemPromptLength: request.systemPrompt?.length || 0,
      referenceImageCount: request.referenceImages?.length || 0,
      config: request.config,
    });
  }

  /**
   * Log response details.
   */
  protected logResponse(response: ProviderResponse): void {
    console.log(`[${this.getProviderName()}] Response:`, {
      model: response.model,
      status: response.status,
      predictionId: response.predictionId,
      cost: response.cost,
      usage: response.usage,
      contentType: typeof response.content,
      contentLength:
        typeof response.content === 'string'
          ? response.content.length
          : Array.isArray(response.content)
          ? response.content.length
          : 'object',
    });
  }
}

/**
 * Provider factory for creating provider instances.
 */
export class ProviderFactory {
  private static providers: Map<string, new (apiKey: string, options?: any) => BaseProvider> =
    new Map();

  /**
   * Register a provider class.
   */
  static register(
    name: string,
    providerClass: new (apiKey: string, options?: any) => BaseProvider
  ): void {
    this.providers.set(name, providerClass);
  }

  /**
   * Create a provider instance.
   */
  static create(
    name: string,
    apiKey: string,
    options?: { baseUrl?: string; webhookUrl?: string }
  ): BaseProvider {
    const ProviderClass = this.providers.get(name);
    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${name}. Available: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    return new ProviderClass(apiKey, options);
  }

  /**
   * Check if a provider is registered.
   */
  static has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get list of available providers.
   */
  static getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

/**
 * Retry helper for provider requests.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    operationName = 'operation',
  } = options;

  let lastError: Error | null = null;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on permanent errors (auth/quota issues, or a deterministically
      // invalid input that will fail identically on every attempt)
      if (
        lastError.message.includes('Invalid API key') ||
        lastError.message.includes('Authentication') ||
        lastError.message.includes('quota exceeded') ||
        lastError.message.includes('does not represent a valid image')
      ) {
        throw lastError;
      }

      // Check for rate limit errors - these ARE retryable but with longer delays
      const isRateLimitError =
        lastError.message.includes('429') ||
        lastError.message.toLowerCase().includes('rate limit') ||
        lastError.message.toLowerCase().includes('too many requests');

      // Check for service unavailability errors (e.g. E003 "high demand") - retryable with longer delays
      const isServiceUnavailableError =
        lastError.message.includes('E003') ||
        lastError.message.includes('503') ||
        lastError.message.toLowerCase().includes('high demand') ||
        lastError.message.toLowerCase().includes('currently unavailable') ||
        lastError.message.toLowerCase().includes('service unavailable');

      if (attempt < maxRetries) {
        // Use longer delays for transient service issues
        const effectiveDelay = isServiceUnavailableError
          ? Math.max(delay, 10000) // 10s minimum for service unavailability
          : isRateLimitError
            ? Math.max(delay, 5000) // 5s minimum for rate limits
            : delay;
        const errorType = isServiceUnavailableError ? '(Service unavailable - using longer delay) ' : isRateLimitError ? '(Rate limit - using longer delay) ' : '';
        console.warn(
          `[${operationName}] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}. ${errorType}Retrying in ${effectiveDelay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
        delay = Math.min(delay * backoffFactor, maxDelay);
      }
    }
  }

  throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
}

/**
 * Cost calculation helper.
 */
export function calculateCost(
  usage: { inputTokens?: number; outputTokens?: number },
  pricing: { inputPer1k: number; outputPer1k: number }
): number {
  const inputCost = ((usage.inputTokens || 0) / 1000) * pricing.inputPer1k;
  const outputCost = ((usage.outputTokens || 0) / 1000) * pricing.outputPer1k;
  return inputCost + outputCost;
}
