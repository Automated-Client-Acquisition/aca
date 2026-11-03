/**
 * Shared HTTP helpers: polite rate limiting, bounded retry, timeouts.
 *
 * Every Phase 1 source is a free public API whose goodwill we depend on. SEC in
 * particular publishes a hard rule — declare who you are in User-Agent and stay
 * under 10 requests/second — and enforces it by IP-banning offenders. A ban
 * would take out funding AND M&A collection at once, so the limiter here is not
 * politeness theatre, it is the thing keeping the source available.
 */

export class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private readonly minIntervalMs: number;
  private lastAt = 0;

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  /** Serialises callers and spaces them out. Await before each request. */
  async acquire(): Promise<void> {
    const run = this.queue.then(async () => {
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastAt = Date.now();
    });
    // Keep the chain alive even if a caller downstream rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  limiter?: RateLimiter;
  signal?: AbortSignal;
  /** Treat 404 as an empty result rather than an error. ATS boards get
   *  deactivated by their owners all the time; that is normal, not a fault. */
  allow404?: boolean;
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string, readonly body: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

/**
 * Fetch with retry on transient failures only.
 *
 * 4xx (other than 429) is not retried — a malformed request or a board that no
 * longer exists will fail identically forever, and retrying it just burns the
 * run's budget and delays every source behind it.
 */
export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response | null> {
  const {
    headers = {},
    method = 'GET',
    body: requestBody,
    timeoutMs = 30_000,
    retries = 3,
    limiter,
    signal,
    allow404 = false,
  } = opts;

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) return null;
    if (limiter) await limiter.acquire();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onOuterAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const resp = await fetch(url, { method, body: requestBody, headers, signal: ctrl.signal });

      if (resp.status === 404 && allow404) return null;
      if (resp.ok) return resp;

      const retryable = resp.status === 429 || resp.status >= 500;
      const responseBody = await resp.text().catch(() => '');
      if (!retryable) throw new HttpError(resp.status, url, responseBody);

      lastErr = new HttpError(resp.status, url, responseBody);
      // Honour Retry-After when the server tells us; otherwise back off
      // exponentially. 429 from SEC means we are already over the line.
      const retryAfter = Number(resp.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 2 ** attempt * 1000);
      if (attempt < retries) await sleep(backoff);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(Math.min(30_000, 2 ** attempt * 1000));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`fetch failed for ${url}`);
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const resp = await fetchWithRetry(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
  });
  if (!resp) return null;
  try {
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const resp = await fetchWithRetry(url, opts);
  if (!resp) return null;
  return resp.text();
}
