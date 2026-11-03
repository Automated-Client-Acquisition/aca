/**
 * Bulk Create Contacts Edge Function (REST API)
 *
 * Creates many CRM contacts in one call, scoped to the caller's organization.
 * Backs both the `aca contact bulk-create` CLI command and any external API
 * caller. Shares its insert/dedup/activity logic with the MCP
 * `bulk_create_contacts` tool via _shared/bulk-contacts.ts.
 *
 * Endpoint: POST /bulk-create-contacts
 * Auth:     Authorization: Bearer <supabase-jwt | aca_ token>
 * Body:     {
 *             contacts: Array<{ display_name?, first_name?, last_name?, company?,
 *               job_title?, primary_email?, primary_phone?, primary_linkedin_url?,
 *               linkedin_bio?, home_page_text?,
 *               company_website?, city?, state?, country?, pipeline_id?, stage_id?,
 *               tags?: string[], source?, custom_fields?, owner_user_id? }>,
 *             dedupe_on_email?: boolean,  // default true
 *             log_activity?: boolean,     // default true
 *             source?: string,            // default source applied to rows without one
 *             list_id?: string            // also add every row (new or existing) to this list
 *           }
 * Returns:  { success: true, created, skipped, total_submitted, contact_ids,
 *             results: [{ index, contact_id, status, added_to_list }], added_to_list? }
 *           Rows that match an existing contact never fail the request; they
 *           come back as status 'existing' with that contact's id.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import { insertContactsBulk, type BulkContactInput } from '../_shared/bulk-contacts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// External API callers may submit larger batches than the MCP tool (which caps
// at 100). The CLI splits big files into requests under this ceiling.
const MAX_BATCH = 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Authenticate caller (Supabase JWT or aca_ CLI token). Org is resolved
    //    from the caller — clients never pass organization_id.
    let caller;
    try {
      caller = await authenticateRequest(req, supabase);
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }

    // 2. Parse + validate input.
    const body = await req.json().catch(() => ({}));
    const contacts = body.contacts;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return jsonResponse({ success: false, error: 'contacts[] is required and must be non-empty' }, 400);
    }
    if (contacts.length > MAX_BATCH) {
      return jsonResponse(
        { success: false, error: `Maximum ${MAX_BATCH} contacts per request (received ${contacts.length})` },
        400,
      );
    }

    console.log(
      `[bulk-create-contacts] org=${caller.organization_id} submitting ${contacts.length} contacts (${caller.auth_method})`,
    );

    const listId = typeof body.list_id === 'string' && body.list_id ? body.list_id : undefined;

    // 3. Delegate to the shared core (identical to the MCP tool).
    const result = await insertContactsBulk(
      supabase,
      caller.organization_id,
      contacts as BulkContactInput[],
      {
        dedupeOnEmail: body.dedupe_on_email !== false,
        logActivity: body.log_activity !== false,
        defaultSource: typeof body.source === 'string' && body.source ? body.source : 'api',
        maxBatch: MAX_BATCH,
        listId,
      },
    );

    console.log(
      `[bulk-create-contacts] done. created=${result.created} skipped=${result.skipped} of ${result.total_submitted}`,
    );

    return jsonResponse({ success: true, ...result });
  } catch (error) {
    console.error('[bulk-create-contacts] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Validation errors from the shared core (e.g. missing display_name) → 400.
    const status = message === 'List not found'
      ? 404
      : /required|Maximum|needs a display_name|invalid input syntax/.test(message) ? 400 : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
});
