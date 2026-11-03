// deno-lint-ignore no-import-prefix -- Match the repository's pinned edge-function client imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders, json } from '../_shared/rest-api.ts';
import { pollCampaignEntrySources } from '../_shared/campaign-entry-sources.ts';
import { processCampaignEntryEvent, type QueuedCampaignEntry } from '../_shared/campaign-entry-runtime.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'POST is required' }, 405);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || req.headers.get('Authorization') !== `Bearer ${key}`) return json({ success: false, error: 'Service authorization is required' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, key);
  try {
    const startedAt = Date.now();
    const sources = await pollCampaignEntrySources(supabase);
    const events = [];
    // Claim just before processing; an expensive analysis must not strand an entire claimed batch.
    for (let count = 0; count < 25 && Date.now() - startedAt < 90000; count++) {
      const { data, error } = await supabase.rpc('claim_campaign_trigger_events', { p_limit: 1 });
      if (error) throw new Error(error.message);
      const event = ((data || []) as QueuedCampaignEntry[])[0];
      if (!event) break;
      events.push(await processCampaignEntryEvent(supabase, event));
    }
    return json({ success: true, sources, events });
  } catch (error) {
    console.error('[campaign-trigger-worker]', error instanceof Error ? error.message : 'Unknown error');
    return json({ success: false, error: 'Campaign trigger worker failed' }, 500);
  }
});
