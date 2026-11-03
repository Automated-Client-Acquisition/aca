/**
 * Delete Notion Pages Edge Function
 *
 * Archives Notion pages for selected contacts and clears the
 * notion_preview_url / notion_page_id fields from crm_contacts
 * and contact_email_sequences.
 *
 * Uses job-based processing with self-reinvocation for large batches.
 * Processes 10 Notion API calls concurrently per batch.
 *
 * Auto-detects the Notion connection from the organization —
 * no connectionId needed from the frontend.
 *
 * Endpoint: POST /delete-notion-pages
 * Body:
 *   Start:  { contactIds: string[], organizationId: string }
 *   Continue: { jobId: string, isContinuation: true }
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient , type SupabaseClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { selectInChunks, updateInChunks } from '../_shared/chunked-query.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Leave 30s safety margin from ~150s practical limit
const MAX_EXECUTION_MS = 120_000;
// Concurrent Notion API calls per micro-batch
const CONCURRENCY = 10;

interface ContactRow {
  id: string;
  notion_page_id: string;
  display_name: string;
}

interface JobMeta {
  organizationId: string;
  notionToken: string;
  totalContacts: number;
  processedContactIds: string[];
  archived: number;
  skipped: number;
  failed: number;
  errors: Array<{ contactId: string; error: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const batchStart = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough). The
    // continuation self-invoke names no org and passes as the service role.
    try {
      await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], body.organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // ── Continuation path ──
    if (body.jobId && body.isContinuation) {
      return await processContinuation(supabase, supabaseUrl, supabaseServiceKey, body.jobId, batchStart);
    }

    // ── Initial invocation ──
    const { contactIds, organizationId } = body;

    if (!organizationId || !contactIds || contactIds.length === 0) {
      throw new Error('Missing required fields: organizationId, contactIds');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured');

    // Auto-detect Notion connection
    const { data: connections } = await supabase
      .from('email_tool_connections')
      .select('id, api_key_encrypted')
      .eq('organization_id', organizationId)
      .eq('tool_type', 'notion')
      .eq('status', 'active')
      .limit(1);

    if (!connections || connections.length === 0) {
      throw new Error('No active Notion connection found for this organization');
    }

    const notionToken = await decryptApiKey(connections[0].api_key_encrypted, encryptionKey);

    // Fetch contacts that have a notion_page_id set
    const contacts = await selectInChunks<ContactRow>(
      supabase, 'crm_contacts', 'id, notion_page_id, display_name', 'id', contactIds,
      (q: any) => q.eq('organization_id', organizationId).not('notion_page_id', 'is', null),
    );

    const validContacts = (contacts || []).filter(c => c.notion_page_id !== 'generating');
    const skippedFromSelect = contactIds.length - (contacts?.length || 0);
    const skippedGenerating = (contacts?.length || 0) - validContacts.length;
    const totalSkipped = skippedFromSelect + skippedGenerating;

    if (validContacts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, archived: 0, skipped: totalSkipped, failed: 0, errors: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Process in concurrent batches, time-aware
    const result = await archiveNotionPages(
      validContacts, notionToken, organizationId, supabase, batchStart,
    );

    // Clear DB fields for successfully archived contacts
    if (result.processedContactIds.length > 0) {
      await clearNotionFields(supabase, result.processedContactIds, organizationId);
    }

    const archived = result.archived;
    const skipped = totalSkipped + result.skipped;
    const failed = result.failed;
    const remaining = validContacts.length - result.processedCount;

    // If we ran out of time with contacts remaining, self-reinvoke
    if (remaining > 0) {
      const remainingContacts = validContacts.slice(result.processedCount);

      // Create a lightweight job record in the DB for continuation
      const jobId = crypto.randomUUID();
      await supabase
        .from('email_sequence_jobs')
        .insert({
          id: jobId,
          organization_id: organizationId,
          job_type: 'delete_notion_pages',
          status: 'running',
          contact_ids: remainingContacts.map(c => c.id),
          total_contacts: contactIds.length,
          generated_count: archived,
          skipped_count: skipped,
          failed_count: failed,
          started_at: new Date().toISOString(),
          results: result.errors.length > 0 ? result.errors : null,
          notion_config: { notionToken, organizationId },
        });

      console.log(`Time limit reached. ${remaining} contacts remaining. Continuing as job ${jobId}`);

      // Fire-and-forget continuation
      selfReinvoke(supabase, supabaseUrl, supabaseServiceKey, jobId);

      return new Response(
        JSON.stringify({
          success: true,
          archived,
          skipped,
          failed,
          errors: result.errors,
          jobId,
          continuing: true,
          remaining,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`Deleted pages: ${archived} archived, ${skipped} skipped, ${failed} failed`);

    return new Response(
      JSON.stringify({ success: true, archived, skipped, failed, errors: result.errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Delete Notion pages error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        archived: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

/** Process a continuation batch from a saved job */
async function processContinuation(
  supabase: SupabaseClient<any>,
  supabaseUrl: string,
  supabaseServiceKey: string,
  jobId: string,
  batchStart: number,
) {
  const { data: job, error: jobError } = await supabase
    .from('email_sequence_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    return new Response(
      JSON.stringify({ success: false, error: 'Job not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (job.status !== 'running') {
    return new Response(
      JSON.stringify({ success: false, error: `Job not running (status: ${job.status})` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const config = job.notion_config as { notionToken: string; organizationId: string };
  const contactIds = job.contact_ids as string[];

  // Fetch the contacts for this batch
  const contacts = await selectInChunks<ContactRow>(
    supabase, 'crm_contacts', 'id, notion_page_id, display_name', 'id', contactIds,
    (q: any) => q.eq('organization_id', config.organizationId).not('notion_page_id', 'is', null),
  );

  const validContacts = (contacts || []).filter(c => c.notion_page_id !== 'generating');

  if (validContacts.length === 0) {
    // All done
    await supabase
      .from('email_sequence_jobs')
      .update({
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return new Response(
      JSON.stringify({ success: true, done: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const result = await archiveNotionPages(
    validContacts, config.notionToken, config.organizationId, supabase, batchStart,
  );

  if (result.processedContactIds.length > 0) {
    await clearNotionFields(supabase, result.processedContactIds, config.organizationId);
  }

  const totalArchived = (job.generated_count || 0) + result.archived;
  const totalSkipped = (job.skipped_count || 0) + result.skipped;
  const totalFailed = (job.failed_count || 0) + result.failed;
  const remaining = validContacts.length - result.processedCount;

  if (remaining > 0) {
    // Update job with remaining contacts
    const remainingContacts = validContacts.slice(result.processedCount);
    await supabase
      .from('email_sequence_jobs')
      .update({
        contact_ids: remainingContacts.map(c => c.id),
        generated_count: totalArchived,
        skipped_count: totalSkipped,
        failed_count: totalFailed,
      })
      .eq('id', jobId);

    console.log(`Continuation: ${remaining} remaining. Re-invoking.`);
    selfReinvoke(supabase, supabaseUrl, supabaseServiceKey, jobId);
  } else {
    // All done
    await supabase
      .from('email_sequence_jobs')
      .update({
        status: 'completed',
        progress: 100,
        generated_count: totalArchived,
        skipped_count: totalSkipped,
        failed_count: totalFailed,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`Job ${jobId} completed: ${totalArchived} archived, ${totalSkipped} skipped, ${totalFailed} failed`);
  }

  return new Response(
    JSON.stringify({ success: true, done: remaining === 0 }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

/** Archive Notion pages concurrently in batches of CONCURRENCY, respecting time budget */
async function archiveNotionPages(
  contacts: ContactRow[],
  notionToken: string,
  _organizationId: string,
  _supabase: SupabaseClient<any>,
  batchStart: number,
): Promise<{
  processedContactIds: string[];
  processedCount: number;
  archived: number;
  skipped: number;
  failed: number;
  errors: Array<{ contactId: string; error: string }>;
}> {
  const processedContactIds: string[] = [];
  const errors: Array<{ contactId: string; error: string }> = [];
  let archived = 0;
  let skipped = 0;
  let failed = 0;
  let processedCount = 0;

  // Process in concurrent micro-batches
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    if (Date.now() - batchStart > MAX_EXECUTION_MS) {
      console.log(`Time limit reached after processing ${processedCount} contacts`);
      break;
    }

    const batch = contacts.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(contact => archiveSinglePage(contact, notionToken)),
    );

    for (let j = 0; j < results.length; j++) {
      const contact = batch[j];
      const result = results[j];
      processedCount++;

      if (result.status === 'fulfilled') {
        if (result.value.success) {
          archived++;
          processedContactIds.push(contact.id);
        } else {
          errors.push({ contactId: contact.id, error: result.value.error! });
          failed++;
        }
      } else {
        errors.push({ contactId: contact.id, error: result.reason?.message || 'Unknown error' });
        failed++;
      }
    }
  }

  return { processedContactIds, processedCount, archived, skipped, failed, errors };
}

/** Archive a single Notion page */
async function archiveSinglePage(
  contact: ContactRow,
  notionToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${contact.notion_page_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archived: true }),
    });

    if (response.ok || response.status === 404) {
      return { success: true };
    }

    const errorData = await response.json().catch(() => ({}));
    return { success: false, error: errorData.message || `HTTP ${response.status}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Clear notion fields from crm_contacts and contact_email_sequences */
async function clearNotionFields(
  supabase: SupabaseClient<any>,
  contactIds: string[],
  organizationId: string,
) {
  await updateInChunks(
    supabase, 'crm_contacts',
    { notion_preview_url: null, notion_page_id: null },
    'id', contactIds,
    (q: any) => q.eq('organization_id', organizationId),
  );

  await updateInChunks(
    supabase, 'contact_email_sequences',
    { notion_preview_url: null, notion_page_id: null },
    'contact_id', contactIds,
    (q: any) => q.eq('organization_id', organizationId),
  );
}

/** Fire-and-forget self-reinvocation */
function selfReinvoke(
  supabase: SupabaseClient<any>,
  supabaseUrl: string,
  supabaseServiceKey: string,
  jobId: string,
) {
  // Use supabase.functions.invoke first, fallback to direct fetch
  supabase.functions.invoke('delete-notion-pages', {
    body: { jobId, isContinuation: true },
  }).catch(async () => {
    try {
      await fetch(`${supabaseUrl}/functions/v1/delete-notion-pages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId, isContinuation: true }),
      });
    } catch (err) {
      console.error(`Failed to self-reinvoke for job ${jobId}:`, err);
    }
  });
}
