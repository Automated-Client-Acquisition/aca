/**
 * OpenRouter Rate Limiter
 *
 * Wraps OpenRouter API calls with a PostgreSQL-based per-org rate limiter.
 * Uses advisory locks to serialize concurrent callers for the same org,
 * preventing 429 rate limit errors from OpenRouter.
 *
 * Fail-open: if the rate limiter RPC fails, the request proceeds without limiting.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

interface RateLimitSlot {
  acquired: boolean;
  current_count: number;
  max_allowed: number;
  retry_after_ms: number;
}

interface RateLimitedFetchOptions {
  supabase: SupabaseClient;
  organizationId: string;
  url: string;
  init: RequestInit;
  maxRetries?: number;           // How many times to retry on rate limit (default: 3)
  retryDelayMs?: number;         // Base delay between retries in ms (default: 2000)
  maxRequestsPerMinute?: number; // Per-org limit (default: 60)
  maxResponseRetries?: number;   // Retries when OpenRouter itself returns 429/5xx (default: 4)
}

// HTTP statuses worth retrying: upstream rate limit + transient server errors.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Parse a Retry-After header (seconds or HTTP-date) into ms, capped. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  return null;
}

/**
 * Make a rate-limited fetch to OpenRouter.
 *
 * 1. Acquires a slot via RPC (atomic, serialized per-org via advisory lock)
 * 2. If slot acquired, makes the fetch call
 * 3. If over limit, waits and retries up to maxRetries times
 * 4. Fail-open: if RPC fails or retries exhausted, proceeds without limiting
 */
export async function rateLimitedFetch(
  options: RateLimitedFetchOptions
): Promise<Response> {
  const {
    supabase,
    organizationId,
    url,
    init,
    maxRetries = 3,
    retryDelayMs = 2000,
    maxRequestsPerMinute = 60,
    maxResponseRetries = 4,
  } = options;

  // Acquire a per-org slot (serialized via advisory lock). Fails open.
  const acquireSlot = async (): Promise<void> => {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const { data, error } = await supabase.rpc('acquire_openrouter_slot', {
        p_organization_id: organizationId,
        p_max_requests: maxRequestsPerMinute,
      });

      if (error) {
        console.warn(`[Rate Limiter] RPC error (attempt ${attempt}), proceeding without rate limit:`, error.message);
        return; // Fail open
      }

      const result = (Array.isArray(data) ? data[0] : data) as RateLimitSlot;
      if (!result) {
        console.warn(`[Rate Limiter] No result from RPC, proceeding without rate limit`);
        return; // Fail open
      }

      if (result.acquired) {
        if (attempt > 1) {
          console.log(`[Rate Limiter] Slot acquired after ${attempt - 1} wait(s). Org ${organizationId}: ${result.current_count}/${result.max_allowed}`);
        }
        return;
      }

      console.warn(
        `[Rate Limiter] Org ${organizationId}: ${result.current_count}/${result.max_allowed} requests in window. ` +
        `Retry after ${result.retry_after_ms}ms (attempt ${attempt}/${maxRetries + 1})`
      );

      if (attempt <= maxRetries) {
        const delay = Math.max(result.retry_after_ms, retryDelayMs * attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    console.warn(`[Rate Limiter] Proceeding without rate limit for org ${organizationId}`);
  };

  // Make the request, retrying when OpenRouter itself returns a 429 or 5xx
  // (e.g. a :free model that's "temporarily rate-limited upstream"). Each
  // retry re-acquires a slot so we keep honoring the per-org limit.
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= maxResponseRetries; attempt++) {
    await acquireSlot();
    const response = await fetch(url, init);

    if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxResponseRetries) {
      return response;
    }

    // Drain the body so the connection can be reused, then back off.
    lastResponse = response;
    await response.body?.cancel().catch(() => {});

    const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
    // Exponential backoff with jitter, floored by Retry-After when provided.
    const backoff = retryDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
    const delay = Math.min(Math.max(retryAfter ?? 0, backoff), 60_000);
    console.warn(
      `[Rate Limiter] OpenRouter returned ${response.status} for org ${organizationId}; ` +
      `retrying in ${delay}ms (attempt ${attempt + 1}/${maxResponseRetries})`
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Should be unreachable, but return the last response as a safety net.
  return lastResponse ?? fetch(url, init);
}
