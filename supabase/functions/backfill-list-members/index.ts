/**
 * Backfill List Members Edge Function
 *
 * Adds missing contacts to a lead list by processing in small batches.
 * Self-invokes to continue processing if there are more contacts.
 *
 * Endpoint: POST /backfill-list-members
 * Body: { listId: string, orgId: string, lastId?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { selectInChunks } from '../_shared/chunked-query.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 200;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Only its own continuation self-invoke (service-role key) calls this.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { listId, orgId, lastId } = await req.json();

    if (!listId || !orgId) {
      return new Response(
        JSON.stringify({ success: false, error: 'listId and orgId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Backfilling list ${listId}, lastId: ${lastId || 'none'}`);

    // Get contacts that were recently created, ordered by ID for pagination
    let query = supabase
      .from('crm_contacts')
      .select('id')
      .eq('organization_id', orgId)
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (lastId) {
      query = query.gt('id', lastId);
    }

    const { data: contacts, error: queryError } = await query;

    if (queryError) {
      console.error('Query error:', queryError);
      throw new Error(`Failed to query contacts: ${queryError.message}`);
    }

    if (!contacts || contacts.length === 0) {
      console.log('No more contacts to process');
      return new Response(
        JSON.stringify({ success: true, message: 'Backfill complete', totalAdded: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${contacts.length} contacts to check`);

    // Check which are already members
    const existingMembers = await selectInChunks(supabase, 'lead_list_members', 'contact_id', 'contact_id', contacts.map(c => c.id),
      (q) => q.eq('list_id', listId));

    const existingSet = new Set((existingMembers || []).map(m => m.contact_id));
    const toAdd = contacts.filter(c => !existingSet.has(c.id));

    console.log(`${toAdd.length} contacts need to be added to list`);

    let addedCount = 0;

    if (toAdd.length > 0) {
      // Insert in smaller batches to avoid timeouts
      for (let i = 0; i < toAdd.length; i += 50) {
        const batch = toAdd.slice(i, i + 50);
        const members = batch.map(c => ({
          list_id: listId,
          contact_id: c.id,
        }));

        const { error: insertError } = await supabase
          .from('lead_list_members')
          .insert(members);

        if (insertError) {
          console.error('Insert error:', insertError);
        } else {
          addedCount += batch.length;
        }
      }
    }

    // If we got a full batch, there might be more - self-invoke to continue
    const newLastId = contacts[contacts.length - 1].id;
    const hasMore = contacts.length === BATCH_SIZE;

    if (hasMore) {
      console.log(`More contacts to process, self-invoking with lastId: ${newLastId}`);

      const continuationPromise = fetch(`${supabaseUrl}/functions/v1/backfill-list-members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ listId, orgId, lastId: newLastId }),
      }).catch(err => {
        console.error('Failed to self-invoke:', err);
      });

      if ((globalThis as any).EdgeRuntime?.waitUntil) {
        (globalThis as any).EdgeRuntime.waitUntil(continuationPromise);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        addedInBatch: addedCount,
        processedInBatch: contacts.length,
        hasMore,
        lastId: newLastId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in backfill:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
