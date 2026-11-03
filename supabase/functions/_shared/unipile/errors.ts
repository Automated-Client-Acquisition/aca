/**
 * Unipile v2 error model.
 *
 * v2 answers failures with an RFC 7807 body: { object: "Error", status, type, title, detail?, req_id }.
 * `type` is "<thrower>/<info>": `api` is Unipile, `provider` is forwarded from LinkedIn, Instagram, etc.
 * `code` is our stable vocabulary, so callers never switch on raw type strings.
 *
 * @see docs/planning/unipile-v2-reference.md sections 1.7 and 1.8
 */

export type UnipileErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'DISCONNECTED_ACCOUNT'
  | 'ACCOUNT_MISMATCH'
  | 'ACTION_REQUIRED'
  | 'FORBIDDEN'
  | 'UNIPILE_SUBSCRIPTION_INACTIVE'
  | 'ACCOUNT_LIMIT_REACHED'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

const CODE_BY_TYPE: Record<string, UnipileErrorCode> = {
  'api/missing_authorization': 'AUTHENTICATION_FAILED',
  'api/expired_authorization': 'AUTHENTICATION_FAILED',
  'api/invalid_auth_format': 'AUTHENTICATION_FAILED',
  // Seen on the live host for a wrong key. Not in the reference's error table.
  'api/invalid_credentials': 'AUTHENTICATION_FAILED',
  'api/proxy_auth_error': 'AUTHENTICATION_FAILED',
  'provider/invalid_credentials': 'AUTHENTICATION_FAILED',
  // The account needs to be reconnected. Replaces v1's errors/disconnected_account.
  'provider/invalid_authorization': 'DISCONNECTED_ACCOUNT',
  'provider/account_mismatch': 'ACCOUNT_MISMATCH',
  'api/account_restricted': 'ACTION_REQUIRED',
  'provider/unknown_authentication_context': 'ACTION_REQUIRED',
  'api/insufficient_permissions': 'FORBIDDEN',
  'provider/insufficient_permissions': 'FORBIDDEN',
  'api/inactive_subscription': 'UNIPILE_SUBSCRIPTION_INACTIVE',
  'api/already_exists': 'ALREADY_EXISTS',
  'api/account_limit_reached': 'ACCOUNT_LIMIT_REACHED',
  'api/too_many_requests': 'RATE_LIMITED',
  'provider/too_many_requests': 'RATE_LIMITED',
  'api/not_implemented': 'NOT_IMPLEMENTED',
};

const TRANSIENT_CODES: ReadonlySet<UnipileErrorCode> = new Set([
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'NETWORK_ERROR',
  'TIMEOUT',
]);

function codeForStatus(status: number): UnipileErrorCode {
  if (status === 401) return 'AUTHENTICATION_FAILED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 501) return 'NOT_IMPLEMENTED';
  if (status >= 500) return 'PROVIDER_ERROR';
  if (status >= 400) return 'VALIDATION_ERROR';
  return 'UNKNOWN';
}

export interface UnipileApiErrorInit {
  code: UnipileErrorCode;
  message: string;
  status?: number | null;
  type?: string | null;
  reqId?: string | null;
  retryAfterSeconds?: number | null;
}

export class UnipileApiError extends Error {
  readonly code: UnipileErrorCode;
  /** HTTP status. Null for network failures and bodies that never arrived. */
  readonly status: number | null;
  /** RFC 7807 `type`, e.g. `api/too_many_requests`. Null when the body was not an RFC 7807 error. */
  readonly type: string | null;
  /** Unipile `req_id`. Quote it when reporting a problem to Unipile. */
  readonly reqId: string | null;
  /** From Retry-After, or x-ratelimit-reset, when Unipile sent one. */
  readonly retryAfterSeconds: number | null;
  /** Transient. Whether a given call may be retried depends on its method (see v2-client.ts). */
  readonly retryable: boolean;

  constructor(init: UnipileApiErrorInit) {
    super(init.message);
    this.name = 'UnipileApiError';
    this.code = init.code;
    this.status = init.status ?? null;
    this.type = init.type ?? null;
    this.reqId = init.reqId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.retryable = TRANSIENT_CODES.has(init.code);
  }
}

export function isUnipileApiError(error: unknown): error is UnipileApiError {
  return error instanceof UnipileApiError;
}

/** Reads Retry-After (seconds), falling back to x-ratelimit-reset. Returns null for HTTP dates or absent headers. */
export function parseRetryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('retry-after') ?? headers.get('x-ratelimit-reset');
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function parseErrorBody(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Builds the error for a non-2xx response. Works for RFC 7807 bodies and for plain-text proxy errors. */
export function unipileErrorFromResponse(
  status: number,
  headers: Headers,
  bodyText: string,
): UnipileApiError {
  const body = parseErrorBody(bodyText);
  const type = typeof body?.type === 'string' ? body.type : null;
  const title = typeof body?.title === 'string' ? body.title : null;
  const detail = typeof body?.detail === 'string' ? body.detail : null;
  const reqId = typeof body?.req_id === 'string' ? body.req_id : headers.get('x-request-id');
  const code = (type && CODE_BY_TYPE[type]) || codeForStatus(status);

  return new UnipileApiError({
    code,
    status,
    type,
    reqId,
    retryAfterSeconds: parseRetryAfterSeconds(headers),
    message: detail ?? title ?? `Unipile request failed with HTTP ${status}`,
  });
}

/** Wraps a fetch rejection (DNS, reset, abort by timeout). The cause message is kept, the URL and key are not. */
export function unipileNetworkError(cause: unknown): UnipileApiError {
  const isTimeout = cause instanceof Error && cause.name === 'TimeoutError';
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new UnipileApiError({
    code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    message: isTimeout ? 'Unipile request timed out' : `Unipile request failed: ${detail}`,
  });
}
