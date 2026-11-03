/**
 * process-pool-export — the pump behind /v1/pool/exports.
 *
 * One tick performs exactly one state transition, and every transition is
 * safely repeatable. That is the whole design, and it follows from two facts
 * about the machine underneath:
 *
 *  - The worker serializes every DuckDB query through one process, so the unit
 *    of work has to be small enough that a live search never waits long behind
 *    it. A slice is ~10s at 250k rows.
 *  - An edge invocation can die while the worker is still copying. So a tick
 *    may never assume its own response was received. Slice keys are
 *    deterministic, so a repeated slice overwrites identical bytes rather than
 *    duplicating or corrupting.
 *
 * Modelled on process-pool-add-to-list, with one deliberate difference: that
 * function clears its lease the moment a batch lands, which is right when the
 * unit is 500 Postgres rows. Here the unit is a COPY that can still be running
 * after the invocation returns, so the lease keeps a short floor to stop ticks
 * stampeding the same slice.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import {
  exportIdFromJobId,
  poolExportAbort,
  poolExportFinalize,
  poolExportSlice,
  poolExportStart,
  poolExportStatus,
  type PoolFilter,
} from '../_shared/pool-query.ts';

const LEASE_SECONDS = 300;
/** Short floor after a successful slice: long enough that the next cron tick
 *  does not race a COPY that is still finishing, short enough to keep moving. */
const SLICE_LEASE_FLOOR_SECONDS = 30;
const MAX_ATTEMPTS = 3;
/** A materialization that has not finished in this long is not going to. */
const MAX_WALL_CLOCK_HOURS = 6;
const OBJECT_TTL_DAYS = 7;

interface ExportJob {
  id: string;
  organization_id: string;
  status: string;
  query_body: PoolFilter;
  dedup_by_email: boolean;
  total_rows: number | null;
  slice_rows: number | null;
  next_slice: number;
  slices_total: number | null;
  rows_written: number;
  r2_prefix: string | null;
  parts: Array<{ key: string; rows: number }>;
  attempts: number;
  started_at: string | null;
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

/** Fire-and-forget continuation. The cron tick is only the recovery path. */
function selfKick(jobId: string): void {
  try {
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-pool-export`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ source: 'self-kick', job_id: jobId }),
    }).catch(() => {});
  } catch {
    // Best effort — cron picks it up within the minute regardless.
  }
}

/**
 * Guarded progress write.
 *
 * The `.in('status', …)` is the same guard process-pool-add-to-list needed: a
 * self-kick already in flight must not be able to resurrect a job the user
 * cancelled between ticks.
 */
async function advance(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
  from: string[] = ['pending', 'materializing', 'running'],
) {
  const { error } = await supabase
    .from('pool_export_jobs')
    .update(patch)
    .eq('id', jobId)
    .in('status', from);
  if (error) console.error('[export-pump] update failed:', error.message);
}

async function fail(supabase: SupabaseClient, jobId: string, exportId: string, message: string) {
  console.error(`[export-pump] ${jobId} failed: ${message}`);
  await poolExportAbort(exportId);
  await advance(supabase, jobId, {
    status: 'failed',
    error_message: message.slice(0, 1000),
    lease_until: null,
    completed_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Callers: the export cron, api-pool and this function's self-kick, all with the service-role key.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = serviceClient();
  let body: { job_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data: claimed, error: claimErr } = await supabase.rpc('claim_pool_export_job', {
    p_lease_seconds: LEASE_SECONDS,
    p_job_id: body.job_id ?? null,
  });
  if (claimErr) {
    console.error('[export-pump] claim failed:', claimErr.message);
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const job = (claimed as ExportJob[] | null)?.[0];
  if (!job) {
    return new Response(JSON.stringify({ ok: true, idle: true }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const exportId = exportIdFromJobId(job.id);

  // Reaper: a job that has been going for hours is stuck, not slow.
  if (
    job.started_at &&
    Date.now() - new Date(job.started_at).getTime() > MAX_WALL_CLOCK_HOURS * 3600_000
  ) {
    await fail(supabase, job.id, exportId, `export exceeded ${MAX_WALL_CLOCK_HOURS}h wall clock`);
    return new Response(JSON.stringify({ ok: true, reaped: job.id }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  try {
    /* ── pending → materializing ─────────────────────────────────────────── */
    if (job.status === 'pending') {
      const prefix = `exports/${job.organization_id}/${exportId}`;
      const res = await poolExportStart(
        { ...job.query_body, dedup_by_email: job.dedup_by_email },
        exportId,
      );
      await advance(supabase, job.id, {
        status: 'materializing',
        started_at: job.started_at ?? new Date().toISOString(),
        r2_prefix: prefix,
        slice_rows: res.slice_rows ?? null,
        lease_until: null,
      }, ['pending']);
      selfKick(job.id);
      return new Response(JSON.stringify({ ok: true, job: job.id, state: 'materializing' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    /* ── materializing → running ─────────────────────────────────────────── */
    if (job.status === 'materializing') {
      const st = await poolExportStatus(exportId);

      if (st.state === 'materializing') {
        // Still working. Release the lease so the next tick can poll again.
        await advance(supabase, job.id, { lease_until: null });
        return new Response(JSON.stringify({ ok: true, job: job.id, state: 'materializing' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      if (st.state === 'failed') {
        await fail(supabase, job.id, exportId, st.error ?? 'materialization failed');
        return new Response(JSON.stringify({ ok: true, job: job.id, state: 'failed' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      if (st.state === 'unknown') {
        // The worker restarted. Its in-memory record is gone and any file on
        // disk is a partial CTAS, so there is nothing to resume — only to
        // redo. Bounded, so a crash-looping worker cannot spin here forever.
        if (job.attempts + 1 >= MAX_ATTEMPTS) {
          await fail(supabase, job.id, exportId, 'worker restarted repeatedly during materialization');
        } else {
          await poolExportAbort(exportId);
          await advance(supabase, job.id, {
            status: 'pending',
            attempts: job.attempts + 1,
            lease_until: null,
          });
          selfKick(job.id);
        }
        return new Response(JSON.stringify({ ok: true, job: job.id, state: 'restarted' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      // ready
      const totalRows = st.row_count ?? 0;
      const sliceRows = st.slice_rows ?? job.slice_rows ?? 250_000;
      if (totalRows === 0) {
        await fail(supabase, job.id, exportId, 'filter matched no rows');
        return new Response(JSON.stringify({ ok: true, job: job.id, state: 'failed' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
      await advance(supabase, job.id, {
        status: 'running',
        total_rows: totalRows,
        slice_rows: sliceRows,
        slices_total: Math.ceil(totalRows / sliceRows),
        attempts: 0,
        lease_until: null,
      }, ['materializing']);
      selfKick(job.id);
      return new Response(JSON.stringify({ ok: true, job: job.id, state: 'running' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    /* ── running: one slice per tick ─────────────────────────────────────── */
    if (job.status === 'running') {
      const slicesTotal = job.slices_total ?? 0;

      if (job.next_slice >= slicesTotal) {
        await poolExportFinalize(exportId);
        await advance(supabase, job.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + OBJECT_TTL_DAYS * 86_400_000).toISOString(),
          lease_until: null,
        }, ['running']);
        console.log(`[export-pump] ${job.id} completed rows=${job.rows_written}`);
        return new Response(JSON.stringify({ ok: true, job: job.id, state: 'completed' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      const prefix = job.r2_prefix ?? `exports/${job.organization_id}/${exportId}`;
      const res = await poolExportSlice(exportId, job.next_slice, prefix);
      const parts = [...(job.parts ?? []), { key: res.key, rows: res.rows }];

      await advance(supabase, job.id, {
        next_slice: job.next_slice + 1,
        rows_written: job.rows_written + res.rows,
        parts,
        attempts: 0,
        // Short floor rather than an immediate release: the COPY may still be
        // settling, and two ticks on one slice is wasted contention.
        lease_until: new Date(Date.now() + SLICE_LEASE_FLOOR_SECONDS * 1000).toISOString(),
      }, ['running']);

      selfKick(job.id);
      return new Response(
        JSON.stringify({ ok: true, job: job.id, slice: job.next_slice, rows: res.rows }),
        { headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }

    await advance(supabase, job.id, { lease_until: null });
    return new Response(JSON.stringify({ ok: true, job: job.id, noop: job.status }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await fail(supabase, job.id, exportId, msg);
    } else {
      console.error(`[export-pump] ${job.id} attempt ${attempts}: ${msg}`);
      await advance(supabase, job.id, { attempts, lease_until: null });
    }
    return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 500) }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
