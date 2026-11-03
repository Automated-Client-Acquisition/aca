/**
 * supabase.functions.invoke() reports every non-2xx response as the generic
 * "Edge Function returned a non-2xx status code". The callee's real reason is
 * in the response body; error.context is the raw Response. Server-side twin of
 * src/lib/supabase-functions.ts.
 */

export interface InvokeErrorDetail {
  message: string;
  status?: number;
}

function pickMessage(body: any): string | null {
  const candidates = [body?.error_message, body?.error, body?.message, body?.error?.message];
  const hit = candidates.find((c) => typeof c === 'string' && c.trim());
  return hit ? hit.trim() : null;
}

export async function readInvokeError(error: unknown): Promise<InvokeErrorDetail> {
  const fallback = (error as { message?: string } | null)?.message || 'Unknown error';
  const context = (error as { context?: any } | null)?.context;
  if (!context || typeof context.text !== 'function' || typeof context.status !== 'number') {
    return { message: fallback };
  }

  let message = fallback;
  try {
    const text = (await context.text()).trim();
    if (text) {
      try {
        message = pickMessage(JSON.parse(text)) ?? text;
      } catch {
        message = text; // not JSON
      }
    }
  } catch {
    // Body already consumed or unreadable; keep the generic message.
  }

  return { message: message.slice(0, 1000), status: context.status };
}

/** 4xx (bar timeout/rate limit) will fail the same way again; retrying is noise. */
export function isRetryableStatus(status?: number): boolean {
  return status === undefined || status >= 500 || status === 408 || status === 429;
}
