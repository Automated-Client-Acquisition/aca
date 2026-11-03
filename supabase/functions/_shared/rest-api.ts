/**
 * Shared plumbing for the public REST API (`/v1/*`).
 *
 * These endpoints are reached through the Vercel proxy, which is path-based and
 * cannot branch on HTTP method — so one function owns a resource and routes on
 * `req.method` itself. This module holds the parts every resource needs to do
 * identically: auth, JSON shapes, method dispatch and keyset pagination.
 *
 * Pagination is keyset, never OFFSET. `crm_contacts` is past five million rows
 * and an OFFSET deep into a big organization is a guaranteed statement timeout.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  authenticateRequest,
  callerHasScope,
  unauthorized,
  type AuthenticatedCaller,
  type TokenScope,
} from './cli-auth.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers':
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After',
};

/** Page sizes. Deliberately modest — these are index scans on very large tables. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/**
 * Requests per minute per API token. Page size caps at 100, so this is roughly
 * 12,000 rows a minute — generous for an integration, and far below what it
 * takes to hurt a shared connection pool.
 */
export const RATE_LIMIT_PER_MINUTE = 120;
const RATE_LIMIT_WINDOW_SECONDS = 60;

interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  reset_at: string;
}

/**
 * Count this request against the caller's window.
 *
 * Fails OPEN. A rate limiter that takes the API down when it cannot reach its
 * own counter has inverted its purpose; an unlimited minute is strictly better
 * than a blanket outage.
 */
async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
): Promise<RateLimitDecision | null> {
  const { data, error } = await supabase.rpc('check_api_rate_limit', {
    p_key: key,
    p_limit: RATE_LIMIT_PER_MINUTE,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (error) {
    console.error('[rest-api] rate limit check failed, allowing request', error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as RateLimitDecision) : null;
}

function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(RATE_LIMIT_PER_MINUTE),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': decision.reset_at,
  };
}

/** Re-emit a response with extra headers, leaving status and body untouched. */
function withHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function apiError(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export type Handler = (ctx: {
  req: Request;
  url: URL;
  supabase: SupabaseClient;
  caller: AuthenticatedCaller;
  body: Record<string, unknown>;
}) => Promise<Response>;

export interface ResourceOptions {
  /**
   * Scope an API token must carry to call this resource. Leave unset for the
   * resources that predate scopes: every token has `cli`, so they stay open to
   * all tokens exactly as before.
   */
  scope?: TokenScope;
}

/**
 * Wrap a per-method handler map with CORS, auth, body parsing and error mapping,
 * so each resource file contains only its own logic.
 */
export function createResource(
  handlers: Partial<Record<string, Handler>>,
  options: ResourceOptions = {},
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    const handler = handlers[req.method];
    if (!handler) {
      return apiError(
        `${req.method} is not supported here. Allowed: ${Object.keys(handlers).join(', ')}`,
        405,
      );
    }

    const supabase = serviceClient();

    let caller: AuthenticatedCaller;
    // A platform background job (cron worker calling another edge function)
    // presents the service-role key, which is not a user JWT and not an `aca_`
    // token, so cli-auth rejects it. These jobs act on shared infrastructure —
    // classifying pool domains benefits every org — and belong to no tenant, so
    // there is no org membership for cli-auth to resolve.
    //
    // Safe because the service-role key never leaves the platform: it is not
    // issued to users, and anything holding it could already bypass this
    // function entirely by talking to Postgres directly.
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (serviceKey && bearer === serviceKey) {
      caller = {
        user_id: null,
        // Platform-owned work is not attributable to a tenant. Handlers that
        // need an org must reject this caller rather than guess one.
        organization_id: null,
        source: 'service_role',
      } as unknown as AuthenticatedCaller;
    } else {
      try {
        caller = await authenticateRequest(req, supabase);
      } catch (err) {
        return unauthorized(err, corsHeaders);
      }

      if (options.scope && !callerHasScope(caller, options.scope)) {
        return apiError(
          `This API token is missing the "${options.scope}" scope. Create a token with it in Settings → CLI Tokens.`,
          403,
        );
      }
    }

    // Rate limit per token, falling back to the organization for a session
    // caller. The platform service-role caller is exempt: it is our own cron
    // work, it holds a key no user is issued, and throttling it would only stall
    // the queue processors.
    let limitHeaders: Record<string, string> = {};
    if (caller.organization_id) {
      const key = caller.token_id ? `token:${caller.token_id}` : `org:${caller.organization_id}`;
      const decision = await checkRateLimit(supabase, key);

      if (decision) {
        limitHeaders = rateLimitHeaders(decision);

        if (!decision.allowed) {
          const retryAfter = Math.max(
            1,
            Math.ceil((new Date(decision.reset_at).getTime() - Date.now()) / 1000),
          );
          return withHeaders(
            apiError(
              `Rate limit exceeded: ${RATE_LIMIT_PER_MINUTE} requests per minute. Retry in ${retryAfter}s.`,
              429,
            ),
            { ...limitHeaders, 'Retry-After': String(retryAfter) },
          );
        }
      }
    }

    // Only read a body for methods that carry one; GET with a body is a client bug.
    let body: Record<string, unknown> = {};
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return apiError('Request body must be valid JSON');
      }
    } else if (req.method === 'DELETE') {
      // DELETE may carry a body (bulk delete) or not (single, via ?id=).
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    try {
      const response = await handler({ req, url: new URL(req.url), supabase, caller, body });
      return withHeaders(response, limitHeaders);
    } catch (err) {
      if (err instanceof ApiError) return withHeaders(apiError(err.message, err.status), limitHeaders);
      console.error('[rest-api] unhandled', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return withHeaders(apiError(message, 500), limitHeaders);
    }
  };
}

/** Parse and clamp `limit`, so one caller can't ask for a million rows. */
export function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) throw new ApiError('limit must be a positive integer');
  return Math.min(n, MAX_LIMIT);
}

/**
 * Keyset cursor. Opaque to callers by design — it is base64 so nobody builds a
 * dependency on the column it happens to sort by today.
 */
export function encodeCursor(value: string): string {
  return btoa(value);
}

export function decodeCursor(url: URL): string | null {
  const raw = url.searchParams.get('cursor');
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = atob(raw);
  } catch {
    throw new ApiError('cursor is not a valid pagination cursor');
  }

  // Every resource keys on a uuid id. Validating here keeps a hand-edited cursor
  // from reaching Postgres and surfacing as a 500 with a raw type-cast error.
  if (!UUID_RE.test(decoded)) {
    throw new ApiError('cursor is not a valid pagination cursor');
  }
  return decoded;
}

/** Build the standard list envelope, deriving `has_more` from an over-fetch of one. */
export function paginated<T extends Record<string, unknown>>(
  rows: T[],
  limit: number,
  cursorField: keyof T,
) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(String(last[cursorField])) : null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!UUID_RE.test(s)) {
    throw new ApiError(`${field} must be a valid UUID`);
  }
  return s;
}
