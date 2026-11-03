// Manual (re)transcription of scraped posts from the Ideas → Scraped Content UI.
// Scrapes already transcribe automatically inside apify-webhook; this is the
// retry path (expired caption link, missing Replicate key added later, etc.).
//
// Body: { content_ids: string[] }  — always forces a fresh attempt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { transcribeScrapedContent, type TranscriptRow } from '../_shared/scraped-transcript.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let contentIds: string[];
  try {
    ({ content_ids: contentIds } = await req.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!Array.isArray(contentIds) || contentIds.length === 0 || contentIds.length > 50) {
    return json({ error: 'content_ids must be an array of 1-50 ids' }, 400);
  }

  const { data: rows, error } = await supabase
    .from('research_content')
    .select('id, organization_id, platform, raw_data, duration_seconds, transcript, transcript_status')
    .in('id', contentIds);
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ error: 'Content not found' }, 404);

  try {
    for (const orgId of new Set(rows.map((r) => r.organization_id))) {
      await assertOrgAccess(req, supabase, orgId);
    }
  } catch (err) {
    return unauthorized(err, corsHeaders);
  }

  const results = await transcribeScrapedContent(supabase, rows as TranscriptRow[], { force: true });
  return json({ results });
});
