/**
 * Bulk Add to List Edge Function
 *
 * Adds contacts to a lead list server-side through the shared
 * addContactsToList core (add_list_members RPC). Contacts already in the list,
 * or whose email already is, are skipped instead of failing the batch.
 *
 * Endpoint: POST /bulk-add-to-list
 * Body: { listId: string, contactIds: string[] }
 * Returns: { success, inserted, skipped, not_found, errors: 0, totalInList }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import { addContactsToList } from '../_shared/list-members.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Authenticate caller (JWT or CLI token)
    let caller;
    try {
      caller = await authenticateRequest(req, supabase);
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }
    const user = { id: caller.user_id };

    // 2. Parse input — explicit ids, or (sourceListId + filters) resolved
    //    server-side for the "select all matching" path.
    const body = await req.json();
    const listId: string | undefined = body.listId;
    let contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds : [];
    const sourceListId: string | undefined = body.sourceListId;
    const filters = body.filters;

    if (!listId) {
      return new Response(
        JSON.stringify({ success: false, error: 'listId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Verify the list exists and get its org
    const { data: list, error: listError } = await supabase
      .from('lead_lists')
      .select('id, organization_id')
      .eq('id', listId)
      .single();

    if (listError || !list) {
      return new Response(
        JSON.stringify({ success: false, error: 'List not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Verify caller belongs to the list's organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', list.organization_id)
      .maybeSingle();

    if (!membership) {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4b. Filter-based selection → resolve the source list's matching members
    //     server-side (org-checked) so the client never ships the id list.
    if (contactIds.length === 0 && sourceListId && filters) {
      const { data: srcList } = await supabase
        .from('lead_lists')
        .select('organization_id')
        .eq('id', sourceListId)
        .maybeSingle();
      if (!srcList || srcList.organization_id !== list.organization_id) {
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

    if (contactIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'contactIds[] or (sourceListId + filters) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[bulk-add-to-list] Adding ${contactIds.length} contacts to list ${listId}`);

    // 5. Insert through the shared core: conflict-tolerant, org-checked, and
    //    the lead_count trigger counts only rows actually inserted.
    const result = await addContactsToList(supabase, list.organization_id, listId, contactIds);

    const { count: actualCount } = await supabase
      .from('lead_list_members')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId);

    console.log(
      `[bulk-add-to-list] Done. Added ${result.added}, skipped ${result.skipped}, not found ${result.not_found}, total in list: ${actualCount}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        inserted: result.added,
        skipped: result.skipped,
        not_found: result.not_found,
        errors: 0,
        totalInList: actualCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[bulk-add-to-list] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
