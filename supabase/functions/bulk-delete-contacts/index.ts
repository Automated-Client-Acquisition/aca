/**
 * Bulk Delete Contacts Edge Function
 *
 * Deletes contacts one-by-one using service_role to handle CASCADE deletes
 * across 15+ child tables. Uses controlled concurrency to stay under
 * statement timeouts while maximizing throughput.
 *
 * Returns a streaming NDJSON response so the frontend can track progress.
 *
 * Endpoint: POST /bulk-delete-contacts
 * Body: { contactIds: string[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { resolveEffectiveOrgId } from '../_shared/resolve-api-key.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delete contacts individually (cascade is heavy), but run N in parallel
const CONCURRENCY = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Authenticate caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse input — either an explicit id list, or a (sourceListId + filters)
    //    "select all matching" selection that we resolve server-side so the
    //    client never ships thousands of UUIDs.
    const body = await req.json();
    let contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds : [];
    const sourceListId: string | undefined = body.sourceListId;
    const filters = body.filters;

    // 3. Resolve caller's organization
    const orgId = await resolveEffectiveOrgId(supabase, user.id);
    if (!orgId || (body.organizationId && body.organizationId !== orgId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Organization access denied. Refresh the page and try again.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3b. Filter-based selection → resolve the matching contact ids server-side.
    if (contactIds.length === 0 && sourceListId && filters) {
      const { data: srcList } = await supabase
        .from('lead_lists')
        .select('organization_id')
        .eq('id', sourceListId)
        .maybeSingle();
      if (!srcList || srcList.organization_id !== orgId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: ids, error: idErr } = await supabase.rpc('get_filtered_lead_list_member_ids', {
        p_list_id: sourceListId,
        p_filters: filters,
      });
      if (idErr) throw idErr;
      contactIds = Array.isArray(ids) ? (ids as string[]) : [];
    }

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'contactIds[] or (sourceListId + filters) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[bulk-delete-contacts] Deleting ${contactIds.length} contacts for org ${orgId}`);

    // Helper: delete a single contact with org scoping
    const deleteOne = async (contactId: string) => {
      const { data, error } = await supabase
        .from('crm_contacts')
        .delete()
        .eq('id', contactId)
        .eq('organization_id', orgId)
        .select('id');

      if (error) {
        console.error(`[bulk-delete-contacts] Failed to delete ${contactId}:`, error.message);
        throw error;
      }
      if (!data?.length) throw new Error('Contact not found in the current organization');
    };

    // 4a. Small deletes (≤5): simple JSON response (works with supabase.functions.invoke)
    if (contactIds.length <= CONCURRENCY) {
      let deleted = 0;
      let errors = 0;
      let firstError: string | undefined;

      const results = await Promise.allSettled(
        contactIds.map((id: string) => deleteOne(id))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') deleted++;
        else {
          errors++;
          firstError ??= result.reason?.message || 'Failed to delete contact';
        }
      }

      console.log(`[bulk-delete-contacts] Done. Deleted ${deleted}, errors: ${errors}`);
      return new Response(
        JSON.stringify({ success: true, deleted, errors, error: firstError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4b. Large deletes: stream progress as NDJSON
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let deleted = 0;
        let errors = 0;

        for (let i = 0; i < contactIds.length; i += CONCURRENCY) {
          const window = contactIds.slice(i, i + CONCURRENCY);

          const results = await Promise.allSettled(
            window.map((contactId: string) => deleteOne(contactId))
          );

          for (const result of results) {
            if (result.status === 'fulfilled') deleted++;
            else errors++;
          }

          // Emit progress line
          const progress = { deleted, errors, total: contactIds.length };
          controller.enqueue(encoder.encode(JSON.stringify(progress) + '\n'));
        }

        // Emit final result
        const final = { success: true, deleted, errors, total: contactIds.length, done: true };
        controller.enqueue(encoder.encode(JSON.stringify(final) + '\n'));
        controller.close();

        console.log(`[bulk-delete-contacts] Done. Deleted ${deleted}, errors: ${errors}`);
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error('[bulk-delete-contacts] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
