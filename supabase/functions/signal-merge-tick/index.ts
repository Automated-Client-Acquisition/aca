/**
 * Edge Function: signal-merge-tick
 * ---------------------------------------------------------------------------
 * Collapses resolved observations into canonical signal_events.
 *
 * This is where the engine earns its keep. A single funding round shows up in
 * an SEC filing, three trade-press articles and the company's own blog. Bought
 * from a vendor that is five signals, five leads and five reasons for a
 * prospect to think we're spamming them. Here it is one event with
 * corroboration_count = 5, which is both a cleaner lead and a *stronger* one.
 *
 * Corroboration is the thing a signal reseller structurally cannot sell us,
 * because they are one of the sources being corroborated.
 *
 * CONFIDENCE
 *   base authority of the strongest source (a legal filing outranks a tweet)
 *   + 1 per additional independent source, capped at 5.
 *
 * DEDUPE KEY
 *   funding / acquisition : company + type + calendar month
 *   hiring / other        : company + type + calendar day
 *
 * The month bucket is deliberate: sources report the same round days apart, and
 * a tighter window would let the SEC filing and the TechCrunch piece land as two
 * events. The cost is that two genuinely separate rounds in one month merge —
 * rare, and it surfaces as an unusually high corroboration_count rather than as
 * silent data loss.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_BATCH = 200;  // merge is DB-only, so it can take a bigger bite than resolve
const MAX_CONFIDENCE = 5;

/**
 * How much one sighting is worth on its own.
 *
 * An SEC filing is a legal document with penalties for lying, and a company's
 * own ATS board is a first-party statement of intent — both stand alone. Press
 * repeats what it was told, and a forum post is one person's claim, so neither
 * clears the bar without corroboration.
 */
const SOURCE_AUTHORITY: Record<string, number> = {
  edgar_form_d: 3,
  edgar_8k: 3,
  ats_boards: 3,
  rss: 1,
  forum_hn: 1,
  forum_reddit: 1,
};

function monthBucket(d: string): string {
  return d.slice(0, 7);
}

function eventDate(obs: ObservationRow): string {
  const raw =
    (obs.extracted?.filed_at as string | undefined) ??
    (obs.extracted?.date_of_first_sale as string | undefined) ??
    obs.published_at ??
    obs.created_at;
  // filed_at arrives as YYYYMMDD from the EDGAR index.
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw ?? '').trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

interface ObservationRow {
  id: string;
  source_id: string;
  collector_key: string;
  company_identity_id: string;
  event_type: string | null;
  extracted: Record<string, unknown> | null;
  structured: Record<string, unknown> | null;
  source_url: string | null;
  published_at: string | null;
  created_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Number(body.batch_size ?? DEFAULT_BATCH);

    const { data, error } = await supabase.rpc('claim_signal_observations', {
      p_status: 'resolved',
      p_limit: batchSize,
      p_max_attempts: 5,
      p_worker: 'signal-merge-tick',
      p_lease_seconds: 300,
    });
    if (error) throw new Error(`claim failed: ${error.message}`);

    const rows = (data ?? []) as ObservationRow[];
    if (rows.length === 0) return json({ ok: true, claimed: 0, created: 0, corroborated: 0 });

    let created = 0;
    let corroborated = 0;
    const failures: string[] = [];

    for (const obs of rows) {
      try {
        const type = obs.event_type ?? (obs.extracted?.event_type as string) ?? 'unknown';
        const date = eventDate(obs);
        const bucket = type === 'funding' || type === 'acquisition' ? monthBucket(date) : date;
        const dedupeKey = `${obs.company_identity_id}:${type}:${bucket}`;

        const existing = await findEvent(supabase, dedupeKey);
        const payload = (obs.extracted ?? obs.structured ?? {}) as Record<string, unknown>;

        if (!existing) {
          const { data: inserted, error: insErr } = await supabase
            .from('signal_events')
            .insert({
              company_identity_id: obs.company_identity_id,
              event_type: type,
              occurred_at: date,
              dedupe_key: dedupeKey,
              payload,
              confidence: Math.min(MAX_CONFIDENCE, SOURCE_AUTHORITY[obs.collector_key] ?? 1),
              corroboration_count: 1,
              source_ids: [obs.source_id],
              observation_ids: [obs.id],
            })
            .select('id')
            .maybeSingle();

          if (insErr) {
            // Lost an insert race with a concurrent tick — fold into the winner.
            const winner = await findEvent(supabase, dedupeKey);
            if (!winner) throw new Error(insErr.message);
            await corroborate(supabase, winner, obs);
            corroborated++;
          } else {
            await markMerged(supabase, obs.id, inserted!.id as string);
            created++;
          }
        } else {
          await corroborate(supabase, existing, obs);
          corroborated++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${obs.id}: ${message}`);
        await supabase.from('signal_observations').update({
          attempts: Number((obs as ObservationRow & { attempts?: number }).attempts ?? 0) + 1,
          error: message.slice(0, 500),
          lease_until: null,
          claimed_by: null,
          updated_at: new Date().toISOString(),
        }).eq('id', obs.id);
      }
    }

    return json({
      ok: true,
      claimed: rows.length,
      created,
      corroborated,
      failures: failures.slice(0, 10),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[signal-merge-tick]', msg);
    return json({ ok: false, error: msg }, 500);
  }
});

interface EventRow {
  id: string;
  payload: Record<string, unknown>;
  confidence: number;
  source_ids: string[];
  observation_ids: string[];
  collector_authority?: number;
}

async function findEvent(supabase: SupabaseClient, dedupeKey: string): Promise<EventRow | null> {
  const { data } = await supabase
    .from('signal_events')
    .select('id, payload, confidence, source_ids, observation_ids')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  return (data as EventRow) ?? null;
}

/**
 * Fold another sighting into an existing event.
 *
 * Corroboration counts DISTINCT sources, not observations: ten articles from
 * one wire service are one independent confirmation, and counting them
 * separately would let a single noisy feed manufacture false confidence.
 */
async function corroborate(
  supabase: SupabaseClient,
  event: EventRow,
  obs: ObservationRow,
): Promise<void> {
  const sourceIds = [...new Set([...(event.source_ids ?? []), obs.source_id])];
  const observationIds = [...new Set([...(event.observation_ids ?? []), obs.id])];
  const authority = SOURCE_AUTHORITY[obs.collector_key] ?? 1;

  const confidence = Math.min(
    MAX_CONFIDENCE,
    Math.max(event.confidence, authority) + (sourceIds.length - 1),
  );

  // Merge payloads without letting a thinner later source blank out fields the
  // first one supplied (a press mention must not null out the SEC amount).
  const incoming = (obs.extracted ?? obs.structured ?? {}) as Record<string, unknown>;
  const payload = { ...incoming, ...event.payload };
  for (const [k, v] of Object.entries(incoming)) {
    if (payload[k] == null && v != null) payload[k] = v;
  }

  await supabase
    .from('signal_events')
    .update({
      payload,
      confidence,
      corroboration_count: sourceIds.length,
      source_ids: sourceIds,
      observation_ids: observationIds,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', event.id);

  await markMerged(supabase, obs.id, event.id);
}

async function markMerged(supabase: SupabaseClient, obsId: string, eventId: string): Promise<void> {
  await supabase
    .from('signal_observations')
    .update({
      status: 'merged',
      signal_event_id: eventId,
      lease_until: null,
      claimed_by: null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', obsId);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
