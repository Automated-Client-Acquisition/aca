/**
 * One-time fix to add CSV imported contacts to their list
 * Uses LEFT JOIN to find contacts NOT in list efficiently
 * POST /fix-list-membership
 * Body: { listId: string, source?: string, since?: string, batchSize?: number }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // One-off maintenance script: run by an operator with the service-role key only.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { listId, source = 'csv_import', since = '2026-01-28', batchSize = 500, offset = 0 } = body;

    if (!listId) {
      return new Response(
        JSON.stringify({ success: false, error: 'listId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing batch for list ${listId}, batchSize=${batchSize}, offset=${offset}`);

    // Get contacts that match criteria, using offset to skip already-processed
    const { data: contacts, error: contactsError } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('source', source)
      .gte('created_at', since)
      .order('id', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (contactsError) {
      throw new Error(`Failed to fetch contacts: ${contactsError.message}`);
    }

    if (!contacts || contacts.length === 0) {
      // No contacts found at all
      const { count: inListCount } = await supabase
        .from('lead_list_members')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', listId);

      return new Response(
        JSON.stringify({
          success: true,
          added: 0,
          inList: inListCount,
          totalContacts: 0,
          remaining: 0,
          message: 'No contacts found matching criteria',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contactIds = contacts.map(c => c.id);

    // Check which are already in the list
    const { data: existingMembers, error: existingError } = await supabase
      .from('lead_list_members')
      .select('contact_id')
      .eq('list_id', listId)
      .in('contact_id', contactIds);

    if (existingError) {
      console.log('Error checking existing:', existingError.message);
    }

    const existingSet = new Set((existingMembers || []).map(m => m.contact_id));
    const toInsert = contacts.filter(c => !existingSet.has(c.id));

    console.log(`Fetched ${contacts.length} (offset ${offset}), ${existingSet.size} already in list, ${toInsert.length} new to add`);

    console.log(`Found ${toInsert?.length || 0} contacts to process`);

    if (!toInsert || toInsert.length === 0) {
      // Get total counts
      const { count: totalContacts } = await supabase
        .from('crm_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('source', source)
        .gte('created_at', since);

      const { count: inListCount } = await supabase
        .from('lead_list_members')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', listId);

      return new Response(
        JSON.stringify({
          success: true,
          added: 0,
          inList: inListCount,
          totalContacts: totalContacts,
          remaining: (totalContacts || 0) - (inListCount || 0),
          message: 'No more contacts to add',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert in small sub-batches to avoid timeouts
    const members = toInsert.map((c: { id: string }) => ({
      list_id: listId,
      contact_id: c.id,
    }));

    let totalAdded = 0;
    const subBatchSize = 100;

    for (let i = 0; i < members.length; i += subBatchSize) {
      const batch = members.slice(i, i + subBatchSize);

      const { error: insertError } = await supabase
        .from('lead_list_members')
        .upsert(batch, {
          onConflict: 'list_id,contact_id',
          ignoreDuplicates: true,
        });

      if (insertError) {
        console.error(`Insert error at batch ${i}:`, insertError);
      } else {
        totalAdded += batch.length;
      }
    }
    console.log(`Inserted ${totalAdded} list members`);

    // Get updated counts
    const { count: totalContacts } = await supabase
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('source', source)
      .gte('created_at', since);

    const { count: inListCount } = await supabase
      .from('lead_list_members')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId);

    return new Response(
      JSON.stringify({
        success: true,
        added: totalAdded,
        inList: inListCount,
        totalContacts: totalContacts,
        remaining: (totalContacts || 0) - (inListCount || 0),
        nextOffset: offset + contacts.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
