/**
 * Unipile SDK Client Wrapper
 *
 * Centralizes Unipile API access using the official SDK.
 * Supports both centralized credentials and BYOK (Bring Your Own Key).
 *
 * @see https://developer.unipile.com/docs/nodejs-sdk
 * @see https://github.com/unipile/unipile-node-sdk
 */

import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';

// Re-export the client type for convenience
export { UnipileClient };

// Default DSN if not specified
const DEFAULT_DSN = 'https://api1.unipile.com:13111';

/**
 * Normalize a DSN URL to ensure it has the https:// scheme.
 * Handles cases where users store just "api13.unipile.com:14389" without the protocol.
 */
export function normalizeDsnUrl(dsn: string | null | undefined): string {
  if (!dsn) return DEFAULT_DSN;
  if (!dsn.startsWith('http')) {
    return `https://${dsn}`;
  }
  return dsn;
}

/**
 * Options for creating a Unipile client
 */
export interface UnipileClientOptions {
  /** API key (decrypted) */
  apiKey: string;
  /** DSN URL (optional, defaults to api1.unipile.com) */
  dsnUrl?: string;
}

/**
 * Options for getting credentials from account data
 */
export interface AccountCredentials {
  /** Encrypted access token from unipile_accounts table */
  accessTokenEncrypted: string;
  /** Optional custom DSN URL */
  dsnUrl?: string | null;
}

/**
 * Create a Unipile SDK client with the given credentials
 */
export function createUnipileClient(options: UnipileClientOptions): UnipileClient {
  const dsn = normalizeDsnUrl(options.dsnUrl);
  return new UnipileClient(dsn, options.apiKey);
}

/**
 * Create a Unipile client from encrypted account credentials
 *
 * @param account - Account credentials (from unipile_accounts table)
 * @param encryptionKey - Hex encryption key from ENCRYPTION_KEY env var
 */
export async function createUnipileClientFromAccount(
  account: AccountCredentials,
  encryptionKey: string
): Promise<UnipileClient> {
  const apiKey = await decryptApiKey(account.accessTokenEncrypted, encryptionKey);
  const dsnUrl = normalizeDsnUrl(account.dsnUrl);
  return new UnipileClient(dsnUrl, apiKey);
}

/**
 * Create a Unipile client from an organization's BYOK credentials.
 *
 * @param encryptedApiKey - Encrypted API key from api_keys table
 * @param encryptionKey - Hex encryption key from ENCRYPTION_KEY env var
 * @param dsnUrl - DSN URL from api_keys.metadata.dsn_url
 */
export async function createUnipileClientFromOrgKey(
  encryptedApiKey: string,
  encryptionKey: string,
  dsnUrl?: string | null,
): Promise<UnipileClient> {
  const apiKey = await decryptApiKey(encryptedApiKey, encryptionKey);
  return new UnipileClient(normalizeDsnUrl(dsnUrl), apiKey);
}

/**
 * Get credentials for a Unipile account
 * Returns the decrypted API key and DSN URL
 */
export async function getAccountCredentials(
  account: AccountCredentials,
  encryptionKey: string
): Promise<{ apiKey: string; dsnUrl: string }> {
  const apiKey = await decryptApiKey(account.accessTokenEncrypted, encryptionKey);
  const dsnUrl = normalizeDsnUrl(account.dsnUrl);
  return { apiKey, dsnUrl };
}

/**
 * Get the default DSN URL
 */
export function getDefaultDsn(): string {
  return DEFAULT_DSN;
}

/**
 * Encrypt API key using AES-256-GCM
 * Format: base64(IV[12 bytes] + ciphertext + authTag)
 */
export async function encryptApiKey(
  plaintext: string,
  encryptionKeyHex: string
): Promise<string> {
  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encodedText
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt API key using AES-256-GCM
 * Format: base64(IV[12 bytes] + ciphertext + authTag)
 */
export async function decryptApiKey(
  encryptedBase64: string,
  encryptionKeyHex: string
): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

  // Extract IV (first 12 bytes) and ciphertext+authTag (rest)
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  // Import the encryption key
  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Classify an HTTP status code into a standardized error result.
 */
function classifyByStatus(status: number, message: string): {
  code: string;
  message: string;
  retryable: boolean;
  status: number;
} {
  const lowerMessage = message.toLowerCase();

  switch (status) {
    case 401:
      return { code: 'AUTHENTICATION_FAILED', message, retryable: false, status };
    case 403:
      if (
        lowerMessage.includes('subscription_required') ||
        lowerMessage.includes('subscription required') ||
        lowerMessage.includes('feature_not_subscribed') ||
        lowerMessage.includes('feature not subscribed')
      ) {
        return {
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'This LinkedIn account does not have access to the requested Sales Navigator feature. Please verify the account has an active Sales Navigator seat, reconnect it if the subscription was recently added, then retry.',
          retryable: false,
          status,
        };
      }
      if (
        lowerMessage.includes('account_restricted') ||
        lowerMessage.includes('resource_access_restricted') ||
        lowerMessage.includes('action_required') ||
        lowerMessage.includes('unknown_authentication_context')
      ) {
        return { code: 'ACTION_REQUIRED', message, retryable: false, status };
      }
      return { code: 'AUTHENTICATION_FAILED', message, retryable: false, status };
    case 404:
      return { code: 'NOT_FOUND', message, retryable: false, status };
    case 429:
      return { code: 'RATE_LIMITED', message, retryable: true, status };
    case 400:
      if (message.toLowerCase().includes('blocked')) {
        return { code: 'BLOCKED_BY_USER', message, retryable: false, status };
      }
      return { code: 'VALIDATION_ERROR', message, retryable: false, status };
    case 422:
      return { code: 'VALIDATION_ERROR', message, retryable: false, status };
    case 500:
    case 502:
    case 503:
    case 504:
      return { code: 'PROVIDER_ERROR', message, retryable: true, status };
    default:
      return { code: 'UNKNOWN', message, retryable: status >= 500, status };
  }
}

/**
 * Unipile returns `errors/disconnected_account` (HTTP 401) when an account is
 * logged out / restricted on the underlying provider (LinkedIn, Instagram, …).
 * The DB status can lag ("active") because /api/v1/accounts may not surface the
 * drop for a while, so callers detect it straight from the error body and flip
 * the account status on the first failure instead of trusting the stale flag.
 */
export function isDisconnectedAccountError(error?: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('disconnected_account') || lower.includes('disconnected account');
}

/**
 * Parse Unipile error into a standardized format.
 *
 * Handles multiple error shapes:
 * - SDK errors with `.body` (official Unipile SDK)
 * - Errors with `.response` (axios-style)
 * - Errors with `.status` directly (fetch-style)
 * - Plain Error objects (network failures, timeouts)
 */
export function parseUnipileError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
} {
  if (!error || typeof error !== 'object') {
    const message = String(error);
    return { code: 'UNKNOWN', message, retryable: false };
  }

  const errObj = error as Record<string, unknown>;

  // Shape 1: SDK errors with `.body` (e.g. { body: { status: 422, message: '...' } })
  if ('body' in errObj && errObj.body && typeof errObj.body === 'object') {
    const body = errObj.body as { status?: number; message?: string; error?: string; detail?: string; title?: string; type?: string };
    const status = body.status;
    const message = body.message || body.error || body.detail || body.title || String(error);
    if (status) return classifyByStatus(status, message);
    return { code: 'UNKNOWN', message, retryable: false };
  }

  // Shape 2: Errors with `.response` (axios-style, some SDK wrappers)
  if ('response' in errObj && errObj.response && typeof errObj.response === 'object') {
    const resp = errObj.response as { status?: number; data?: { message?: string }; statusText?: string };
    const status = resp.status;
    const message = resp.data?.message || resp.statusText || String(error);
    if (status) return classifyByStatus(status, message);
  }

  // Shape 3: Error with `.status` directly (our REST wrapper errors)
  if ('status' in errObj && typeof errObj.status === 'number') {
    const status = errObj.status as number;
    const message = (errObj.message as string) || String(error);
    return classifyByStatus(status, message);
  }

  // Shape 4: Plain Error objects — extract the best message possible
  const rawMessage = error instanceof Error ? error.message : String(error);

  // Network/timeout errors should be retryable
  const lowerMsg = rawMessage.toLowerCase();
  const isNetworkError = lowerMsg.includes('fetch failed') || lowerMsg.includes('timeout') ||
    lowerMsg.includes('econnrefused') || lowerMsg.includes('econnreset') ||
    lowerMsg.includes('network') || lowerMsg.includes('dns') ||
    lowerMsg.includes('socket hang up') || lowerMsg.includes('aborted');

  if (isNetworkError) {
    return { code: 'NETWORK_ERROR', message: rawMessage, retryable: true };
  }

  // Generic "Error" with no useful info = likely transient SDK failure, retry
  if (rawMessage === 'Error' || rawMessage === '' || rawMessage === 'undefined') {
    const detail = error instanceof Error && error.stack
      ? `Unknown error (${error.constructor.name} at ${error.stack.split('\n')[1]?.trim() || 'unknown'})`
      : 'Unknown error (no details available)';
    return { code: 'UNKNOWN', message: detail, retryable: true };
  }

  return { code: 'UNKNOWN', message: rawMessage, retryable: false };
}

// ============================================================================
// Type definitions for Unipile API responses
// These help with TypeScript when the SDK types are incomplete
// ============================================================================

export interface UnipileAccount {
  id: string;
  name?: string;
  type: string;
  status: 'active' | 'expired' | 'disconnected' | 'error';
  connection_params?: Record<string, unknown>;
  sources?: string[];
}

/**
 * Account `type` values that unipile_accounts.provider accepts.
 * MUST stay in sync with the unipile_accounts_provider_check constraint
 * (migration 20260717230000). Writing anything else fails the insert, and
 * because the callers run on a cron that failure repeats silently — so check
 * with isPersistableProvider() and skip loudly instead of attempting the write.
 *
 * Not the same list as unipile-connect's SUPPORTED_PROVIDERS: that one is what
 * we ask Unipile to open a hosted-auth link for, this is what Unipile hands
 * back to us to store.
 */
export const PERSISTABLE_UNIPILE_PROVIDERS = [
  'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'TELEGRAM', 'MESSENGER', 'TWITTER',
  'SLACK', 'MOBILE',
  'MAIL', 'GOOGLE_OAUTH', 'OUTLOOK', 'ICLOUD', 'EXCHANGE',
  'GOOGLE_CALENDAR',
  'EMAIL', 'GOOGLE',
] as const;

export function isPersistableProvider(provider: string): boolean {
  return (PERSISTABLE_UNIPILE_PROVIDERS as readonly string[]).includes(provider);
}

export interface UnipileChat {
  id: string;
  account_id: string;
  attendees?: UnipileAttendee[];
  attendee_id?: string;
  attendee_name?: string;
  attendee_avatar?: string;
  last_message?: UnipileMessage;
  updated_at?: string;
}

export interface UnipileMessage {
  id: string;
  text?: string;
  body?: string;
  sender_id?: string;
  sender_name?: string;
  is_from_me?: boolean;
  is_sender?: boolean;
  attachments?: UnipileAttachment[];
  created_at?: string;
  timestamp?: string;
}

export interface UnipileAttendee {
  id: string;
  provider_id?: string;
  name?: string;
  display_name?: string;
  avatar_url?: string;
  profile_url?: string;
}

export interface UnipileAttachment {
  type: string;
  url: string;
  filename?: string;
  size?: number;
  mime_type?: string;
}

/** LinkedIn comment shape from Unipile API */
export interface UnipileLinkedInComment {
  object: 'Comment';
  id: string;
  post_id: string;
  post_urn: string;
  thread_id?: string;
  author: string | null;
  author_details: {
    id: string | null;
    headline: string | null;
    profile_url: string | null;
    profile_picture_url: string | null;
    network_distance: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK' | null;
    public_identifier?: string | null;
  };
  date: string;
  text: string;
  reaction_counter: number;
  reply_counter: number;
  impressions_counter?: number;
  user_reacted?: string;
}

/** Instagram comment shape from Unipile API */
export interface UnipileInstagramComment {
  object: 'Comment';
  provider_id: string;
  author: {
    provider_id: string;
    messaging_id: string;
    public_identifier: string;
    pk: string;
    profile_pic_url: string;
    is_verified: boolean;
  };
  text: string;
  created_at: number;
  is_covered: boolean;
  child_comment_count: number;
  restricted_status: string | null;
  has_liked_comment: boolean;
  giphy_media_info: string | null;
  parent_comment_id: string | null;
  comment_like_count: number;
}

/** Union type for any Unipile comment */
export type UnipileComment = UnipileLinkedInComment | UnipileInstagramComment;

/** Response from getAllPostComments */
export interface UnipileCommentListResponse {
  object: 'CommentList';
  items: UnipileComment[];
  cursor: string | null;
  total_items: number | null;
  paging: {
    start: number | null;
    page_count: number;
    total_count: number | null;
  };
}

/** Type guard: LinkedIn comment */
export function isLinkedInComment(comment: UnipileComment): comment is UnipileLinkedInComment {
  return 'author_details' in comment && typeof comment.author_details === 'object' && comment.author_details !== null;
}

/** Type guard: Instagram comment */
export function isInstagramComment(comment: UnipileComment): comment is UnipileInstagramComment {
  return 'provider_id' in comment && typeof (comment as UnipileInstagramComment).author === 'object'
    && (comment as UnipileInstagramComment).author !== null
    && 'messaging_id' in ((comment as UnipileInstagramComment).author || {});
}

export interface UnipilePost {
  id: string;
  title?: string;
  headline?: string;
  text?: string;
  content?: string;
  commentary?: string;
  thumbnail_url?: string;
  image?: string;
  images?: { url: string }[];
  author?: { name?: string };
  actor?: { name?: string };
  created_at?: string;
  date?: string;
}

export interface UnipileRelation {
  id: string;
  provider_id?: string;
  public_identifier?: string;
  urn?: string;
  name?: string;
  display_name?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  title?: string;
  occupation?: string;
  company?: string;
  company_name?: string;
  current_company?: { name?: string };
  avatar_url?: string;
  profile_picture_url?: string;
  image_url?: string;
  profile_url?: string;
  public_profile_url?: string;
  linkedin_url?: string;
  email?: string;
  primary_email?: string;
  connected_at?: string;
  connection_date?: string;
  created_at?: string;
}

export interface UnipilePaginatedResponse<T> {
  items?: T[];
  results?: T[]; // Alternative field name some endpoints use
  cursor?: string;
  next_cursor?: string;
}
