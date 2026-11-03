// Replicate webhook for Whisper transcriptions of scraped Instagram videos
// (started by _shared/scraped-transcript.ts).
//
// verify_jwt = false (Replicate can't send a Supabase JWT). The body is never
// trusted: we only use its prediction id to find our row, then re-fetch the
// prediction from Replicate with that org's own key. An unknown id is a no-op.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey } from '../_shared/llm-client.ts';
import { applyWhisperResult } from '../_shared/scraped-transcript.ts';

const ok = (body: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let predictionId: string | undefined;
  try {
    predictionId = (await req.json())?.id;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!predictionId || typeof predictionId !== 'string') return new Response('Missing id', { status: 400 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: row } = await supabase
    .from('research_content')
    .select('id, organization_id')
    .eq('transcript_prediction_id', predictionId)
    .maybeSingle();
  if (!row) return ok({ ok: true, ignored: 'unknown prediction' });

  const resolved = await resolveApiKey(supabase, row.organization_id, 'replicate');
  if (!resolved) return ok({ ok: true, ignored: 'no replicate key' });
  const replicateKey = await decryptApiKey(resolved.key_encrypted);

  const resp = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(predictionId)}`, {
    headers: { Authorization: `Bearer ${replicateKey}` },
  });
  if (!resp.ok) {
    console.error(`[scraped-transcript-webhook] fetch prediction ${predictionId}: ${resp.status}`);
    // Non-2xx makes Replicate retry the webhook.
    return new Response('Prediction lookup failed', { status: 502 });
  }
  const prediction = await resp.json();
  if (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) return ok({ ok: true, pending: true });

  await applyWhisperResult(supabase, row.id, prediction);
  return ok();
});
