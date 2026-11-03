/**
 * Unipile API v2 REST client.
 *
 * No DSN and no per-org host: every v2 call goes to UNIPILE_V2_BASE_URL with an X-API-KEY header.
 * Account-scoped routes carry the account id in the path: /v2/{account_id}/chats.
 *
 * Retry rules, because a retry must never repeat a write the provider already accepted:
 * - 429 (`api/too_many_requests`, `provider/too_many_requests`) is retried for every method. Unipile
 *   rejected the call before the provider saw it.
 * - 5xx and network failures are retried for GET only.
 * - A Retry-After longer than maxRetryAfterSeconds throws at once, so the caller can reschedule.
 *
 * @see docs/planning/unipile-v2-reference.md sections 1.2, 1.8 and 1.9
 */

import { UnipileApiError, unipileErrorFromResponse, unipileNetworkError } from './errors.ts';

/** Fixed v2 host. There is no per-org DSN. */
export const UNIPILE_V2_BASE_URL = 'https://api.unipile.com/v2';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type UnipileHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type UnipileQueryValue = string | number | boolean | null | undefined;

export interface UnipileV2ClientOptions {
  /** Decrypted API key, sent as X-API-KEY. Never logged, never copied into an error. */
  apiKey: string;
  /** Replaceable for tests. Defaults to the global fetch. */
  fetch?: FetchLike;
  /** Per attempt. Default 20 s. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  maxRetries?: number;
  /** A Retry-After longer than this throws instead of waiting. Default 30 s. */
  maxRetryAfterSeconds?: number;
  /** Backoff used when Unipile sends no Retry-After. Doubles per attempt. Default 500 ms. */
  retryBaseDelayMs?: number;
}

export interface UnipileRequestOptions {
  query?: Record<string, UnipileQueryValue>;
  body?: unknown;
  /** Adds `Cache-Control: no-cache`. GETs are cached for 1 hour by default, so pollers must set this. */
  noCache?: boolean;
  signal?: AbortSignal;
}

/** Account-scoped path: accountPath('acc_1', '/chats') returns '/acc_1/chats'. */
export function accountPath(accountId: string, path: string): string {
  assertPath(path);
  return `/${encodeURIComponent(accountId)}${path}`;
}

export class UnipileV2Client {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: UnipileV2ClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 30;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  }

  get<T>(path: string, options?: UnipileRequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: UnipileRequestOptions): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  patch<T>(path: string, options?: UnipileRequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, options);
  }

  delete<T>(path: string, options?: UnipileRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(
    method: UnipileHttpMethod,
    path: string,
    options: UnipileRequestOptions = {},
  ): Promise<T> {
    const url = buildUrl(path, options.query);
    const headers = this.buildHeaders(options);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    for (let attempt = 0; ; attempt++) {
      const retriesLeft = attempt < this.maxRetries;
      let response: Response;

      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: this.attemptSignal(options.signal),
        });
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        const error = unipileNetworkError(cause);
        if (method !== 'GET' || !retriesLeft) throw error;
        await sleep(this.backoffMs(attempt));
        continue;
      }

      if (response.ok) return readSuccessBody<T>(response);

      const error = unipileErrorFromResponse(response.status, response.headers, await response.text());
      if (!retriesLeft || !isRetryable(method, error)) throw error;
      if (error.retryAfterSeconds !== null && error.retryAfterSeconds > this.maxRetryAfterSeconds) {
        throw error;
      }
      await sleep(error.retryAfterSeconds !== null
        ? error.retryAfterSeconds * 1000
        : this.backoffMs(attempt));
    }
  }

  private buildHeaders(options: UnipileRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      Accept: 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.noCache) headers['Cache-Control'] = 'no-cache';
    return headers;
  }

  private attemptSignal(callerSignal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  }

  private backoffMs(attempt: number): number {
    return this.retryBaseDelayMs * 2 ** attempt;
  }
}

function isRetryable(method: UnipileHttpMethod, error: UnipileApiError): boolean {
  if (error.code === 'RATE_LIMITED') return true;
  return method === 'GET' && error.code === 'PROVIDER_ERROR';
}

async function readSuccessBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (response.status === 204 || text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UnipileApiError({
      code: 'INVALID_RESPONSE',
      status: response.status,
      reqId: response.headers.get('x-request-id'),
      message: 'Unipile returned a body that is not JSON',
    });
  }
}

function buildUrl(path: string, query: Record<string, UnipileQueryValue> = {}): string {
  assertPath(path);
  const url = new URL(`${UNIPILE_V2_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function assertPath(path: string): void {
  if (!path.startsWith('/')) throw new Error(`Unipile v2 path must start with "/": ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
