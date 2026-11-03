import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

/**
 * Decrypt an AES-GCM encrypted API key stored in the database.
 */
export async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertextWithTag);
  return new TextDecoder().decode(decrypted);
}

export const APIFY_ACTOR_ID = 'code_crafter~leads-finder';
export const APIFY_BASE_URL = 'https://api.apify.com/v2';

export interface BatchInfo {
  batch_index: number;
  apify_run_id: string | null;
  dataset_id: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  leads_found: number;
  leads_imported: number;
  leads_skipped: number;
  error?: string;
}

export interface SearchConfig {
  contact_job_title?: string[];
  contact_not_job_title?: string[];
  contact_location?: string[];
  contact_not_location?: string[];
  contact_city?: string[];
  contact_not_city?: string[];
  seniority_level?: string[];
  functional_level?: string[];
  email_status?: string[];
  company_domain?: string[];
  company_industry?: string[];
  company_not_industry?: string[];
  company_keywords?: string[];
  company_not_keywords?: string[];
  size?: string[];
  min_revenue?: string;
  max_revenue?: string;
  funding?: string[];
}

/**
 * Start an Apify actor run with an ad-hoc webhook for completion notification.
 */
export async function startApifyRun(
  apifyToken: string,
  searchConfig: SearchConfig,
  fetchCount: number,
  webhookUrl: string,
): Promise<{ runId: string; datasetId: string }> {
  const lowercaseArray = (arr?: string[]) => arr?.map(s => s.toLowerCase());

  const input = {
    ...searchConfig,
    ...(searchConfig.contact_location && { contact_location: lowercaseArray(searchConfig.contact_location) }),
    ...(searchConfig.contact_job_title && { contact_job_title: lowercaseArray(searchConfig.contact_job_title) }),
    ...(searchConfig.contact_not_job_title && { contact_not_job_title: lowercaseArray(searchConfig.contact_not_job_title) }),
    ...(searchConfig.company_industry && { company_industry: lowercaseArray(searchConfig.company_industry) }),
    ...(searchConfig.company_not_industry && { company_not_industry: lowercaseArray(searchConfig.company_not_industry) }),
    ...(searchConfig.company_keywords && { company_keywords: lowercaseArray(searchConfig.company_keywords) }),
    ...(searchConfig.company_not_keywords && { company_not_keywords: lowercaseArray(searchConfig.company_not_keywords) }),
    ...(searchConfig.seniority_level && { seniority_level: lowercaseArray(searchConfig.seniority_level) }),
    ...(searchConfig.functional_level && { functional_level: lowercaseArray(searchConfig.functional_level) }),
    ...(searchConfig.email_status && { email_status: lowercaseArray(searchConfig.email_status) }),
    ...(searchConfig.size && { size: lowercaseArray(searchConfig.size) }),
    fetch_count: fetchCount,
  };

  // Ad-hoc webhook: base64-encoded config passed as URL parameter
  // See: https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks
  const webhookConfig = [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
    requestUrl: webhookUrl,
  }];
  const webhooksParam = btoa(JSON.stringify(webhookConfig));

  console.log(`[Apify Leads] Starting actor run with fetch_count=${fetchCount}`);

  const response = await fetch(
    `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/runs?token=${apifyToken}&webhooks=${encodeURIComponent(webhooksParam)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start Apify run: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const runId = data.data?.id;
  const datasetId = data.data?.defaultDatasetId;

  if (!runId || !datasetId) {
    throw new Error('Apify run started but missing runId or datasetId');
  }

  console.log(`[Apify Leads] Run started: ${runId}, dataset: ${datasetId}`);
  return { runId, datasetId };
}

/**
 * Fetch dataset items from a completed Apify run.
 */
export async function fetchDatasetItems(
  apifyToken: string,
  datasetId: string,
  limit?: number,
  offset?: number,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ token: apifyToken, format: 'json' });
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));

  const response = await fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?${params.toString()}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch dataset: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Process a single lead from Apify Leads Finder and create/update contact.
 * Returns 'imported' if new contact added to list, 'skipped' if already exists.
 *
 * Dedup strategy (email-first since this actor specializes in verified emails):
 * 1. Check by primary_email
 * 2. Check by primary_linkedin_url
 * 3. Check by identity provider_id
 */
export async function processApifyLead(
  // Was ReturnType<typeof createClient>, which carries no Database generic, so
  // every .from(...) resolved to `never` and each row access was a type error.
  supabase: SupabaseClient<any>,
  organizationId: string,
  listId: string,
  lead: Record<string, unknown>
): Promise<'imported' | 'skipped'> {
  const firstName = (lead.first_name || lead.firstName || '') as string;
  const lastName = (lead.last_name || lead.lastName || '') as string;
  const displayName = (
    lead.full_name ||
    lead.name ||
    (firstName && lastName ? `${firstName} ${lastName}`.trim() : null) ||
    firstName ||
    'Unknown'
  ) as string;

  const email = (lead.email || lead.primary_email || lead.work_email || lead.personal_email) as string | undefined;
  const linkedinUrl = (lead.linkedin || lead.linkedin_url || lead.linkedin_profile_url || lead.person_linkedin_url) as string | undefined;
  const jobTitle = (lead.job_title || lead.title || lead.position || lead.headline) as string | undefined;
  const company = (lead.company_name || lead.company || lead.organization_name) as string | undefined;
  const city = (lead.city || lead.location) as string | undefined;
  const state = (lead.state) as string | undefined;
  const country = (lead.country) as string | undefined;
  const phone = (lead.mobile_number || lead.phone || lead.phone_number || lead.direct_phone || lead.company_phone) as string | undefined;
  const companyDomain = (lead.company_domain || lead.company_website || lead.domain || lead.website) as string | undefined;
  const industry = (lead.industry || lead.company_industry) as string | undefined;
  const employeeCount = (lead.company_size || lead.employees || lead.employee_count) as string | number | undefined;

  if (!email && !linkedinUrl) {
    console.log(`[Apify Leads] Skipping lead - no email or LinkedIn URL: ${displayName}`);
    return 'skipped';
  }

  // Tier 1: Check by email
  let existingContact: { id: string } | null = null;

  if (email) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('primary_email', email)
      .maybeSingle();
    existingContact = data;
  }

  // Tier 2: Check by LinkedIn URL
  if (!existingContact && linkedinUrl) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('primary_linkedin_url', linkedinUrl)
      .maybeSingle();
    existingContact = data;
  }

  // Tier 3: Check by LinkedIn identity
  if (!existingContact && linkedinUrl) {
    const linkedinId = linkedinUrl.split('/in/')[1]?.replace(/\/$/, '');
    if (linkedinId) {
      const { data: identityData } = await supabase
        .from('crm_contact_identities')
        .select('contact_id')
        .eq('organization_id', organizationId)
        .eq('channel', 'linkedin')
        .eq('platform_user_id', linkedinId)
        .maybeSingle();

      if (identityData) {
        const { data } = await supabase
          .from('crm_contacts')
          .select('id')
          .eq('id', identityData.contact_id)
          .maybeSingle();
        existingContact = data;
      }
    }
  }

  let contactId: string;
  let isNewContact = false;

  if (existingContact) {
    contactId = existingContact.id;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (email) updates.primary_email = email;
    if (linkedinUrl) updates.primary_linkedin_url = linkedinUrl;
    if (phone) updates.primary_phone = phone;
    if (jobTitle) updates.job_title = jobTitle;
    if (company) updates.company = company;
    if (city) updates.city = city;
    if (state) updates.state = state;
    if (country) updates.country = country;
    if (companyDomain) updates.company_website = companyDomain;

    await supabase
      .from('crm_contacts')
      .update(updates)
      .eq('id', contactId);

  } else {
    isNewContact = true;

    const { data: newContact, error: contactError } = await supabase
      .from('crm_contacts')
      .insert({
        organization_id: organizationId,
        display_name: displayName,
        first_name: firstName || null,
        last_name: lastName || null,
        primary_email: email || null,
        primary_linkedin_url: linkedinUrl || null,
        primary_phone: phone || null,
        job_title: jobTitle || null,
        company: company || null,
        company_website: companyDomain || null,
        city: city || null,
        state: state || null,
        country: country || null,
        source: 'apify_leads_finder',
        status: 'active',
        contact_type: 'prospect',
        enrichment_data: {
          company_domain: companyDomain,
          industry,
          employee_count: employeeCount,
          seniority_level: lead.seniority_level || null,
          functional_level: lead.functional_level || null,
          headline: lead.headline || null,
          company_linkedin: lead.company_linkedin || null,
          company_phone: lead.company_phone || null,
          company_founded_year: lead.company_founded_year || null,
          company_description: (lead.company_description as string)?.substring(0, 500) || null,
          company_annual_revenue: lead.company_annual_revenue || null,
          company_total_funding: lead.company_total_funding || null,
          company_technologies: lead.company_technologies || null,
          keywords: lead.keywords || null,
          personal_email: lead.personal_email || null,
          mobile_number: lead.mobile_number || null,
        },
      })
      .select('id')
      .single();

    if (contactError || !newContact) {
      console.error(`[Apify Leads] Failed to create contact:`, contactError);
      return 'skipped';
    }

    contactId = newContact.id;

    if (email) {
      const { error: emailIdErr } = await supabase.from('crm_contact_identities').insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel: 'email',
        platform_user_id: email,
        platform_username: displayName,
        is_primary: true,
      });
      if (emailIdErr) console.log(`[Apify Leads] Email identity skipped: ${emailIdErr.code}`);
    }

    if (linkedinUrl) {
      const linkedinId = linkedinUrl.split('/in/')[1]?.replace(/\/$/, '') || linkedinUrl;
      const { error: liIdErr } = await supabase.from('crm_contact_identities').insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel: 'linkedin',
        platform_user_id: linkedinId,
        platform_username: displayName,
        platform_profile_url: linkedinUrl,
        is_primary: !email,
      });
      if (liIdErr) console.log(`[Apify Leads] LinkedIn identity skipped: ${liIdErr.code}`);
    }
  }

  // Add to lead list (ON CONFLICT DO NOTHING via unique constraint)
  const { error: listError } = await supabase.from('lead_list_members').insert({
    list_id: listId,
    contact_id: contactId,
    source_data: {
      import_type: 'apify_leads_finder',
      imported_at: new Date().toISOString(),
      is_new_contact: isNewContact,
      email: email || null,
      company: company || null,
    },
  });

  if (listError) {
    if (listError.code === '23505') {
      return 'skipped';
    }
    console.error(`[Apify Leads] Failed to add contact ${contactId} to list:`, listError);
    return 'skipped';
  }

  return 'imported';
}
