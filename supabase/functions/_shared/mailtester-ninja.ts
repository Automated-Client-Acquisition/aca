type VerificationStatus =
  | 'valid'
  | 'invalid'
  | 'risky'
  | 'catch_all'
  | 'disposable'
  | 'role'
  | 'unknown';

export interface MailtesterNinjaResponse {
  email?: string;
  user?: string;
  domain?: string;
  mx?: string;
  code?: string;
  result?: string;
  status?: string;
  verdict?: string;
  message?: string;
  reason?: string;
  details?: string;
  connections?: number;
  data?: {
    code?: string;
    result?: string;
    status?: string;
    verdict?: string;
    message?: string;
    reason?: string;
    details?: string;
  };
}

function normalizeString(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim().toLowerCase();
  return '';
}

function parseRawResponse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const CODE_KEYS = new Set([
  'code',
  'result',
  'status',
  'verdict',
  'state',
  'response_code',
  'responseCode',
]);

const MESSAGE_KEYS = new Set([
  'message',
  'reason',
  'details',
  'detail',
  'description',
  'error',
  'label',
]);

function collectStrings(raw: unknown, keys: Set<string>, depth = 0): string[] {
  const parsed = parseRawResponse(raw);
  if (depth > 3) return [];
  if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
    return depth === 0 ? [normalizeString(parsed)].filter(Boolean) : [];
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => collectStrings(item, keys, depth + 1));
  }
  if (!isRecord(parsed)) return [];

  const found: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (keys.has(key)) {
      const normalized = normalizeString(value);
      if (normalized) found.push(normalized);
    }
    if (isRecord(value) || Array.isArray(value) || (typeof value === 'string' && value.trim().startsWith('{'))) {
      found.push(...collectStrings(value, keys, depth + 1));
    }
  }
  return found;
}

function normalizedFirstString(values: string[]): string {
  return values.find(Boolean) ?? '';
}

function normalizedMessage(raw: unknown): string {
  return collectStrings(raw, MESSAGE_KEYS).join(' ').trim().toLowerCase();
}

function classifyCode(code: string, message: string): VerificationStatus | null {
  switch (code) {
    case 'ok':
    case 'valid':
    case 'clean':
    case 'deliverable':
    case 'mailbox exists':
    case 'mailbox_exist':
    case 'mailbox_exists':
      return 'valid';
    case 'ko':
    case 'invalid':
    case 'bad':
    case 'undeliverable':
    case 'rejected':
    case 'mailbox does not exist':
    case 'mailbox_not_found':
      return 'invalid';
    case 'catch_all':
    case 'catch-all':
    case 'catch all':
    case 'accept_all':
    case 'accept-all':
    case 'accept all':
      return 'catch_all';
    case 'mb':
      if (
        message.includes('timeout') ||
        message.includes('rate') ||
        message.includes('spam') ||
        message.includes('block') ||
        message.includes('mx error') ||
        message.includes('no mx')
      ) {
        return 'unknown';
      }
      // MailTester Ninja documents `mb` as "unverifiable", but a Limited
      // response is still an accepted mailbox (temporary provider limitation),
      // not an unknown result.
      if (message.includes('limited') || message.includes('accepted')) return 'valid';
      return 'catch_all';
    default:
      return null;
  }
}

/**
 * Mailtester Ninja answers with HTTP 200 even when the API key itself is
 * dead — e.g. `{"code":"--","message":"Disabled Key"}` (expired or
 * revoked). Because the HTTP status is 200, the worker's 401/403
 * check never fires, so without this detector every address silently maps to
 * `unknown` and the job "succeeds" with zero usable signal. Treat these as an
 * auth failure so the job is marked failed and the user is told to fix the key.
 */
export function isMailtesterKeyError(resp: unknown): boolean {
  const parsed = parseRawResponse(resp);
  const message = normalizedMessage(parsed);
  const code = normalizedFirstString(collectStrings(parsed, CODE_KEYS));
  if (
    message.includes('disabled key') ||
    message.includes('invalid key') ||
    message.includes('invalid api key') ||
    message.includes('key disabled') ||
    message.includes('no api key') ||
    message.includes('api key not found') ||
    message.includes('expired key') ||
    message.includes('key expired') ||
    message.includes('unauthorized')
  ) {
    return true;
  }
  // The "--" code paired with an MX-less/empty response is Mailtester's
  // signature for a non-functional key (it never even attempted a lookup).
  if (code === '--' && message.includes('key')) return true;
  return false;
}

/**
 * A quota/rate-limit response means the key may be perfectly valid. Keep this
 * separate from credential rejection so callers never disable a saved key just
 * because the provider's allowance has been exhausted or its plan limit was
 * reached.
 */
export function isMailtesterQuotaError(resp: unknown): boolean {
  const message = normalizedMessage(parseRawResponse(resp));
  return (
    message.includes('quota exceeded') ||
    message.includes('out of credits') ||
    message.includes('credit exhausted') ||
    message.includes('daily limit') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('limit reached')
  );
}

/**
 * Mailtester Ninja's browser/API surfaces short codes (`ok`, `ko`, `mb`), but
 * the surrounding fields have varied across integrations. Keep the provider's
 * vocabulary normalized in one place so cached statuses and job counters agree.
 */
export function mapMailtesterNinjaResponse(resp: unknown): VerificationStatus {
  const parsed = parseRawResponse(resp);
  const message = normalizedMessage(parsed);
  const code = normalizedFirstString(collectStrings(parsed, CODE_KEYS));
  const codeStatus = classifyCode(code, message);
  if (codeStatus) return codeStatus;

  for (const candidate of collectStrings(parsed, MESSAGE_KEYS)) {
    const status = classifyCode(candidate, message);
    if (status) return status;
  }

  if (message.includes('catch') || message.includes('accept all') || message.includes('accept-all')) {
    return 'catch_all';
  }
  if (
    message.includes('mailbox exists') ||
    message.includes('valid') ||
    message.includes('deliverable')
  ) {
    return 'valid';
  }
  if (
    message.includes('mailbox does not exist') ||
    message.includes('invalid') ||
    message.includes('undeliverable') ||
    message.includes('rejected')
  ) {
    return 'invalid';
  }
  return 'unknown';
}
