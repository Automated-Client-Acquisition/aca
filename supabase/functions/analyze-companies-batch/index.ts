/**
 * Analyze Companies Batch Edge Function
 *
 * Batch processor for analyzing multiple contacts' companies.
 * Triggered from the Lead List Detail page when user selects contacts.
 *
 * Endpoint: POST /analyze-companies-batch
 * Body: {
 *   contactIds: string[],          // Selected contact IDs
 *   organizationId: string,
 *   unipileAccountId?: string,     // For LinkedIn posts fetching
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { selectInChunks } from '../_shared/chunked-query.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeBatchRequest {
  contactIds: string[];
  organizationId: string;
  unipileAccountId?: string;
}

interface BatchResult {
  contactId: string;
  status: 'success' | 'skipped' | 'failed' | 'pending';
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const body: AnalyzeBatchRequest = await req.json();
    const { contactIds, organizationId, unipileAccountId } = body;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'contactIds array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'organizationId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // The service-role client acts on whatever org the body names (and forwards to
    // analyze-company with the service key), so the caller must be able to access
    // it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    console.log(`Starting batch analysis for ${contactIds.length} contacts`);

    // Fetch all contacts in chunked queries to avoid URL length limits
    let contacts;
    try {
      contacts = await selectInChunks(
        supabase,
        'crm_contacts',
        'id, display_name, company, company_website, primary_linkedin_url',
        'id',
        contactIds,
        (q) => q.eq('organization_id', organizationId),
      );
    } catch (contactsError) {
      console.error('Failed to fetch contacts:', contactsError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch contacts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Categorize contacts
    const contactsWithWebsite = contacts.filter(c => c.company_website);
    const contactsWithLinkedIn = contacts.filter(c => c.primary_linkedin_url);
    const contactsWithNeither = contacts.filter(c => !c.company_website && !c.primary_linkedin_url);
    const analyzableContacts = contacts.filter(c => c.company_website || c.primary_linkedin_url);

    console.log(`Contacts breakdown:`, {
      total: contacts.length,
      withWebsite: contactsWithWebsite.length,
      withLinkedIn: contactsWithLinkedIn.length,
      withNeither: contactsWithNeither.length,
      analyzable: analyzableContacts.length,
    });

    // Initialize results array
    const results: BatchResult[] = [];

    // Mark contacts without data as skipped
    for (const contact of contactsWithNeither) {
      results.push({
        contactId: contact.id,
        status: 'skipped',
        error: 'No company website or LinkedIn URL',
      });
    }

    // Process analyzable contacts
    // We process them one at a time to avoid overwhelming external APIs
    // In production, you might want to use a queue for better scalability
    for (const contact of analyzableContacts) {
      try {
        console.log(`Analyzing contact ${contact.id} (${contact.display_name})`);

        // Call the single analyze-company function
        const analyzeResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-company`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contactId: contact.id,
            companyWebsite: contact.company_website,
            linkedinUrl: contact.primary_linkedin_url,
            unipileAccountId: unipileAccountId,
          }),
        });

        const analyzeResult = await analyzeResponse.json();

        if (analyzeResult.success) {
          results.push({
            contactId: contact.id,
            status: 'success',
          });
        } else {
          results.push({
            contactId: contact.id,
            status: 'failed',
            error: analyzeResult.error || 'Analysis failed',
          });
        }

        // Add a small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`Failed to analyze contact ${contact.id}:`, error);
        results.push({
          contactId: contact.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Calculate summary
    const summary = {
      total: contactIds.length,
      processed: results.filter(r => r.status === 'success').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      failed: results.filter(r => r.status === 'failed').length,
    };

    console.log('Batch analysis complete:', summary);

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        results,
        breakdown: {
          withWebsite: contactsWithWebsite.length,
          withLinkedIn: contactsWithLinkedIn.length,
          withNeither: contactsWithNeither.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in batch analysis:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
