/**
 * Push Contact to GHL (Lead Connector)
 *
 * Pushes a CRM contact to the organization's GHL account via the Contacts API.
 * Optionally applies tags both in GHL and locally.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import {
  getGHLAccessToken,
  upsertGHLContact,
} from '../_shared/ghl-calendar-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushContactRequest {
  contactId: string;
  organizationId: string;
  conversationId?: string;
  tags?: string[];
  applyTagsLocally?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      contactId,
      organizationId,
      conversationId,
      tags = [],
      applyTagsLocally = false,
    }: PushContactRequest = await req.json();

    if (!contactId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'contactId and organizationId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch contact data
    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, display_name, primary_email, primary_phone, company, company_website, job_title, primary_linkedin_url')
      .eq('id', contactId)
      .eq('organization_id', organizationId)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ success: false, error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate email OR phone
    if (!contact.primary_email && !contact.primary_phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'Contact must have at least an email or phone number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get GHL access token (auto-refreshes if needed)
    const { accessToken, locationId } = await getGHLAccessToken(supabase, organizationId);

    // Push to GHL
    console.log(`[push-contact-to-ghl] Pushing contact ${contactId} to GHL location ${locationId}`);

    const ghlResult = await upsertGHLContact(accessToken, locationId, {
      email: contact.primary_email || undefined,
      phone: contact.primary_phone || undefined,
      firstName: contact.first_name || undefined,
      lastName: contact.last_name || undefined,
      companyName: contact.company || undefined,
      website: contact.company_website || undefined,
      jobTitle: contact.job_title || undefined,
      linkedinUrl: contact.primary_linkedin_url || undefined,
      tags: tags.length > 0 ? tags : undefined,
      source: 'ACA Inbox',
    });

    console.log(`[push-contact-to-ghl] GHL contact upserted: ${ghlResult.id}`);

    // Apply tags locally if requested
    if (applyTagsLocally && tags.length > 0) {
      // Find existing tags by name
      const { data: existingTags } = await supabase
        .from('crm_tags')
        .select('id, name')
        .eq('organization_id', organizationId)
        .in('name', tags);

      const existingTagMap = new Map((existingTags || []).map((t: { id: string; name: string }) => [t.name, t.id]));
      const tagIdsToAssign: string[] = [];

      // Create missing tags
      for (const tagName of tags) {
        if (existingTagMap.has(tagName)) {
          tagIdsToAssign.push(existingTagMap.get(tagName)!);
        } else {
          const { data: newTag } = await supabase
            .from('crm_tags')
            .insert({ organization_id: organizationId, name: tagName, color: '#6366f1' })
            .select('id')
            .single();

          if (newTag) {
            tagIdsToAssign.push(newTag.id);
          }
        }
      }

      // Assign tags to contact
      if (tagIdsToAssign.length > 0) {
        await supabase
          .from('crm_contact_tags')
          .upsert(
            tagIdsToAssign.map(tagId => ({
              organization_id: organizationId,
              contact_id: contactId,
              tag_id: tagId,
            })),
            { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
          );
      }
    }

    return new Response(
      JSON.stringify({ success: true, ghlContactId: ghlResult.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[push-contact-to-ghl] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
