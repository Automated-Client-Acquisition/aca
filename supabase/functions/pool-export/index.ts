// ============================================================================
// pool-export
// ----------------------------------------------------------------------------
// Server-streamed CSV export. Accepts the same query body as
// list-building-pool-search and pages the worker /search in BATCH_SIZE
// chunks, encoding each chunk to CSV and pushing it through a ReadableStream
// straight to the client. The browser sees a normal file download that
// flushes progressively — no edge-function wall-time cap on payload size,
// caller can abort via Cancel.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

const BATCH_SIZE = 1000;
const HARD_CAP = 200_000;

const COLUMNS = [
  'first_name',
  'last_name',
  'title',
  'seniority',
  'department',
  'email',
  'email_status',
  'mobile_phone',
  'person_linkedin_url',
  'person_city',
  'person_state',
  'company',
  'domain',
  'company_phone',
  'company_linkedin_url',
  'industry',
  'sic_code',
  'p_sic',
  'employees',
  'employees_range',
  'annual_revenue',
  'company_address',
  'company_city',
  'company_state',
  'company_zip',
  'p_industry',
  'p_bucket',
] as const;

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvLine(row: Record<string, unknown>): string {
  return COLUMNS.map((c) => csvEscape(row[c])).join(',') + '\n';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // --- auth -----------------------------------------------------------------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Missing Authorization', { status: 401, headers: corsHeaders });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response('Invalid token', { status: 401, headers: corsHeaders });
  }

  // --- body -----------------------------------------------------------------
  let queryBody: Record<string, unknown>;
  try {
    queryBody = await req.json();
  } catch {
    return new Response('invalid json', { status: 400, headers: corsHeaders });
  }
  const requestedMax = typeof queryBody.max_rows === 'number'
    ? Math.min(queryBody.max_rows, HARD_CAP)
    : HARD_CAP;

  // --- stream CSV from paged worker calls -----------------------------------
  //
  // Cursor-paged: open a server-side cursor once, then fetch slices from the
  // same materialized result set. The worker doesn't re-run the FTS scan per
  // page. Cursor is always cleaned up via cursor-end on stream close (best-
  // effort; the worker's TTL sweep is the safety net).
  const encoder = new TextEncoder();

  const callProxy = async (
    mode: string,
    extra: Record<string, unknown>,
  ): Promise<Response> => {
    return await fetch(
      `${supabaseUrl}/functions/v1/list-building-pool-search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use service role internally — user already authenticated above;
          // service avoids re-validating per batch.
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ ...queryBody, mode, ...extra }),
      },
    );
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursorId: string | null = null;
      try {
        controller.enqueue(encoder.encode(COLUMNS.join(',') + '\n'));

        // Open cursor. Pass cursor_ttl_ms generous enough for the worst case
        // (200k rows × ~50ms/fetch + cold starts ≈ 30 min).
        const startResp = await callProxy('cursor-start', {
          dedup_by_email: queryBody.dedup_by_email,
          cursor_ttl_ms: 60 * 60 * 1000, // 1h
        });
        if (!startResp.ok) {
          const text = await startResp.text();
          controller.enqueue(encoder.encode(`# error: ${text.slice(0, 200)}\n`));
          controller.close();
          return;
        }
        const startData = await startResp.json() as {
          cursor_id?: string;
          row_count?: number;
        };
        if (!startData.cursor_id || typeof startData.row_count !== 'number') {
          controller.enqueue(encoder.encode('# error: cursor-start did not return id/row_count\n'));
          controller.close();
          return;
        }
        cursorId = startData.cursor_id;
        const totalRows = Math.min(startData.row_count, requestedMax);

        let offset = 0;
        while (offset < totalRows) {
          const limit = Math.min(BATCH_SIZE, totalRows - offset);
          const fetchResp = await callProxy('cursor-fetch', {
            cursor_id: cursorId,
            offset,
            limit,
          });
          if (!fetchResp.ok) {
            const text = await fetchResp.text();
            controller.enqueue(encoder.encode(`# error: ${text.slice(0, 200)}\n`));
            break;
          }
          const data = await fetchResp.json();
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          if (rows.length === 0) break;
          for (const r of rows) {
            controller.enqueue(encoder.encode(toCsvLine(r as Record<string, unknown>)));
          }
          offset += rows.length;
          if (rows.length < limit) break; // cursor exhausted
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`# fatal: ${msg.slice(0, 200)}\n`));
        controller.close();
      } finally {
        // Cursor cleanup — fire-and-forget; if it fails, TTL sweeps in 1h.
        if (cursorId) {
          callProxy('cursor-end', { cursor_id: cursorId }).catch(() => {});
        }
      }
    },
    async cancel() {
      // Client aborted (browser canceled the download). The `start` callback's
      // finally block still runs after the throw from controller, so cursor
      // cleanup happens there. This handler is here for clarity.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pool-export-${Date.now()}.csv"`,
      // Prevent Cloudflare/Supabase from buffering the stream.
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
});
