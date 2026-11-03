import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * LinkedIn Event Import Edge Function
 *
 * Imports leads from LinkedIn event attendees.
 * Handles:
 * - Parsing event URL to get event ID
 * - Fetching attendees via Unipile API
 * - Deduplicating and creating contacts
 * - Real-time progress updates
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Parse request body early and store jobId for error handling
  let jobId: string | undefined;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    jobId = body.jobId;

    if (!jobId) {
      throw new Error('jobId is required');
    }

    console.log(`[LinkedIn Event Import] Starting job ${jobId}`);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('linkedin_import_jobs')
      .select(`
        *,
        account:unipile_accounts(*)
      `)
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ success: false, error: 'Job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, job.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (job.status === 'cancelled') {
      console.log(`[LinkedIn Event Import] Job ${jobId} was cancelled`);
      return new Response(JSON.stringify({ success: false, reason: 'cancelled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mark as running
    await supabase
      .from('linkedin_import_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    const account = job.account;
    if (!account || account.status !== 'active') {
      throw new Error('LinkedIn account is not active');
    }

    // Decrypt API key
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);

    // Parse event URL to extract event ID
    const eventId = extractEventId(job.source_url);
    if (!eventId) {
      throw new Error('Could not extract event ID from URL');
    }

    const metadata = job.metadata as { max_leads?: number };
    const maxLeads = metadata.max_leads || 500;

    console.log(`[LinkedIn Event Import] Event ID: ${eventId}, max: ${maxLeads}`);

    let totalFound = 0;
    let totalImported = 0;
    let totalSkipped = 0;
    let cursor: string | null = null;
    const processedIds = new Set<string>();

    // Paginate through attendees
    while (totalImported + totalSkipped < maxLeads) {
      // Check if cancelled
      const { data: currentJob } = await supabase
        .from('linkedin_import_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (currentJob?.status === 'cancelled') {
        console.log('[LinkedIn Event Import] Job cancelled, stopping');
        break;
      }

      // Use Unipile's raw LinkedIn endpoint to fetch event attendees
      // Try multiple LinkedIn API endpoint formats since they change frequently
      const startOffset = cursor ? parseInt(cursor, 10) : 0;

      // List of endpoint formats to try (LinkedIn changes these frequently)
      const endpointOptions = [
        // Option 1: Events REST endpoint
        `https://www.linkedin.com/voyager/api/events/${eventId}/attendees?count=50&start=${startOffset}`,
        // Option 2: Event URN based endpoint
        `https://www.linkedin.com/voyager/api/voyagerEventsEventAttendees?eventUrn=urn%3Ali%3Aevent%3A${eventId}&count=50&start=${startOffset}`,
        // Option 3: Dashboard events endpoint
        `https://www.linkedin.com/voyager/api/eventsDashEventAttendees?q=eventAttendees&event=urn%3Ali%3Aevent%3A${eventId}&count=50&start=${startOffset}`,
      ];

      let response: Response | null = null;
      let data: unknown = null;
      let lastError = '';

      // Try each endpoint option until one works
      for (const linkedinUrl of endpointOptions) {
        console.log(`[LinkedIn Event Import] Trying endpoint: ${linkedinUrl.substring(0, 100)}...`);

        try {
          response = await fetch(`${dsnUrl}/api/v1/linkedin`, {
            method: 'POST',
            headers: {
              'X-API-KEY': apiKey,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              account_id: account.unipile_account_id,
              request_url: linkedinUrl,
              method: 'GET',
            }),
          });

          if (response.ok) {
            data = await response.json();
            console.log(`[LinkedIn Event Import] Endpoint succeeded`);
            break;
          } else {
            const errorText = await response.text();
            lastError = `${response.status} - ${errorText}`;
            console.log(`[LinkedIn Event Import] Endpoint failed: ${lastError.substring(0, 200)}`);
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Unknown error';
          console.log(`[LinkedIn Event Import] Endpoint error: ${lastError}`);
        }
      }

      // If all endpoints failed, check for rate limiting or throw error
      if (!response?.ok || !data) {
        if (lastError.includes('429')) {
          console.log('[LinkedIn Event Import] Rate limited, waiting 60s...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }
        throw new Error(`Unipile API error: All endpoint options failed. Last error: ${lastError}`);
      }

      // Parse LinkedIn response format
      // The raw endpoint wraps the response in { object: 'LinkedinRawData', data: {...} }
      const dataObj = data as Record<string, unknown>;
      const rawData = (dataObj?.data || data) as Record<string, unknown>;

      // LinkedIn event attendees come in a nested format
      // data.data.eventsDashEventGuestsByEventByEvent.elements
      const elements = rawData?.data?.eventsDashEventGuestsByEventByEvent?.elements ||
                       rawData?.elements ||
                       rawData?.items ||
                       rawData?.attendees ||
                       rawData?.results ||
                       [];

      const attendees = Array.isArray(elements) ? elements : [];

      if (attendees.length === 0) {
        console.log('[LinkedIn Event Import] No more attendees');
        break;
      }

      // Get total count from paging info
      const paging = rawData?.data?.eventsDashEventGuestsByEventByEvent?.paging || rawData?.paging;
      if (totalFound === 0 && paging?.total) {
        totalFound = Math.min(paging.total, maxLeads);
        await supabase
          .from('linkedin_import_jobs')
          .update({ total_found: totalFound })
          .eq('id', jobId);
      }

      for (const attendee of attendees) {
        if (totalImported + totalSkipped >= maxLeads) break;

        // Extract guest/member info from LinkedIn's nested structure
        const guest = attendee.guest || attendee.member || attendee;
        const memberProfile = guest?.memberProfile || guest?.profile || guest;

        const userId = memberProfile?.entityUrn ||
                       memberProfile?.publicIdentifier ||
                       guest?.entityUrn ||
                       attendee.user_id ||
                       attendee.id ||
                       attendee.provider_id;

        if (!userId || processedIds.has(userId)) continue;

        processedIds.add(userId);

        // Transform LinkedIn profile data to our expected format
        const userData = {
          id: userId,
          name: memberProfile?.firstName && memberProfile?.lastName
            ? `${memberProfile.firstName} ${memberProfile.lastName}`
            : memberProfile?.name || guest?.name,
          first_name: memberProfile?.firstName || guest?.firstName,
          last_name: memberProfile?.lastName || guest?.lastName,
          headline: memberProfile?.headline || guest?.headline,
          profile_url: memberProfile?.publicIdentifier
            ? `https://www.linkedin.com/in/${memberProfile.publicIdentifier}`
            : memberProfile?.profileUrl || guest?.profileUrl,
          profile_picture_url: memberProfile?.profilePicture?.displayImageReferenceResolutionResult?.vectorImage?.rootUrl ||
                               memberProfile?.picture?.rootUrl ||
                               guest?.picture,
          public_identifier: memberProfile?.publicIdentifier || guest?.publicIdentifier,
        };

        try {
          const result = await processAttendee(
            supabase,
            job.organization_id,
            job.target_list_id,
            userData
          );

          if (result === 'imported') {
            totalImported++;
          } else {
            totalSkipped++;
          }

          // Update progress
          const progress = Math.round(((totalImported + totalSkipped) / maxLeads) * 100);
          await supabase
            .from('linkedin_import_jobs')
            .update({
              progress: Math.min(progress, 99),
              total_found: totalFound || totalImported + totalSkipped,
              total_imported: totalImported,
              total_skipped: totalSkipped,
            })
            .eq('id', jobId);

        } catch (err) {
          console.error('[LinkedIn Event Import] Error processing attendee:', err);
          totalSkipped++;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // LinkedIn uses start-based pagination, not cursor
      // Check if there are more results
      const currentStart = paging?.start || 0;
      const pageCount = paging?.count || attendees.length;
      const total = paging?.total || 0;

      if (currentStart + pageCount >= total || attendees.length < 50) {
        console.log('[LinkedIn Event Import] No more pages');
        cursor = null;
        break;
      } else {
        // Use start offset as cursor for next page
        cursor = String(currentStart + pageCount);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Mark complete
    await supabase
      .from('linkedin_import_jobs')
      .update({
        status: 'completed',
        progress: 100,
        total_found: totalFound || totalImported + totalSkipped,
        total_imported: totalImported,
        total_skipped: totalSkipped,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`[LinkedIn Event Import] Completed: imported=${totalImported}, skipped=${totalSkipped}`);

    return new Response(JSON.stringify({
      success: true,
      totalImported,
      totalSkipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[LinkedIn Event Import] Fatal error:', error);

    // Try to mark job as failed using the jobId we stored earlier
    if (jobId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          await supabase
            .from('linkedin_import_jobs')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString(),
            })
            .eq('id', jobId);
          console.log(`[LinkedIn Event Import] Marked job ${jobId} as failed`);
        }
      } catch (updateError) {
        console.error('[LinkedIn Event Import] Failed to update job status:', updateError);
      }
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Extract event ID from LinkedIn URL
 */
function extractEventId(url: string): string | null {
  // Format: https://www.linkedin.com/events/7123456789012345678/
  // Format: https://www.linkedin.com/events/eventname-7123456789012345678/
  const match = url.match(/\/events\/(?:[\w-]+-)?(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Process an attendee and create/update contact
 * Returns 'imported' if contact was added to list, 'skipped' if already in list
 */
async function processAttendee(
  supabase: SupabaseClient<any>,
  organizationId: string,
  listId: string,
  user: Record<string, unknown>
): Promise<'imported' | 'skipped'> {
  const providerId = (user.id || user.provider_id || user.public_identifier || user.urn) as string;

  if (!providerId) {
    return 'skipped';
  }

  const firstName = (user.first_name || user.firstName) as string | undefined;
  const lastName = (user.last_name || user.lastName) as string | undefined;
  const displayName = (
    user.name ||
    user.display_name ||
    user.full_name ||
    (firstName && lastName ? `${firstName} ${lastName}` : null) ||
    firstName ||
    'Unknown'
  ) as string;

  const headline = (user.headline || user.title || user.occupation) as string | undefined;
  const company = (
    user.company ||
    user.company_name ||
    (user.current_company as Record<string, unknown>)?.name
  ) as string | undefined;
  const avatarUrl = (
    user.avatar_url ||
    user.profile_picture_url ||
    user.picture_url ||
    user.image_url
  ) as string | undefined;
  const profileUrl = (
    user.profile_url ||
    user.public_profile_url ||
    user.linkedin_url ||
    (user.public_identifier ? `https://www.linkedin.com/in/${user.public_identifier}` : null)
  ) as string | undefined;

  // Check if contact exists
  const { data: existingContact } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('primary_linkedin_url', profileUrl)
    .single();

  let contactId: string;
  let isNewContact = false;

  if (existingContact) {
    contactId = existingContact.id;

    await supabase
      .from('crm_contacts')
      .update({
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        job_title: headline,
        company: company,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

  } else {
    isNewContact = true;
    const { data: newContact, error: contactError } = await supabase
      .from('crm_contacts')
      .insert({
        organization_id: organizationId,
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        job_title: headline,
        company: company,
        avatar_url: avatarUrl,
        primary_linkedin_url: profileUrl,
        source: 'event_attendee',
        status: 'active',
      })
      .select('id')
      .single();

    if (contactError || !newContact) {
      throw new Error(`Failed to create contact: ${contactError?.message}`);
    }

    contactId = newContact.id;

    // Create LinkedIn identity
    await supabase.from('crm_contact_identities').insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel: 'linkedin',
      platform_user_id: providerId,
      platform_username: displayName,
      platform_profile_url: profileUrl,
      platform_avatar_url: avatarUrl,
      is_primary: true,
    });
  }

  // Check if contact is already in this list
  const { data: existingMember } = await supabase
    .from('lead_list_members')
    .select('id')
    .eq('list_id', listId)
    .eq('contact_id', contactId)
    .single();

  if (existingMember) {
    // Contact already in list - skip
    return 'skipped';
  }

  // Add to list
  const { error: listError } = await supabase.from('lead_list_members').insert({
    list_id: listId,
    contact_id: contactId,
    source_data: {
      import_type: 'event_attendee',
      imported_at: new Date().toISOString(),
      is_new_contact: isNewContact,
    },
  });

  if (listError) {
    console.error(`[LinkedIn Event Import] Failed to add to list: ${listError.message}`);
    return 'skipped';
  }

  return 'imported';
}

/**
 * Decrypt API key
 */
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}
