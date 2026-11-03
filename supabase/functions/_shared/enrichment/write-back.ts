/**
 * Shared enrichment write-back logic.
 *
 * Extracted from enrich-contact/index.ts (the correct, current-schema
 * version — primary_email, display_name, platform_user_id, company).
 * process-enrichment-queue/index.ts previously had its own divergent copy
 * that referenced stale columns (contact.email, full_name, identifier,
 * company_name) which don't exist on crm_contacts/crm_contact_identities —
 * that copy is deleted in favor of this shared module.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { EnrichedData } from './index.ts';
import { normalizeEmployeeRange, normalizeIndustryLabel } from './firmographics.ts';

/**
 * Build contact update object from enriched data.
 * Only fills fields that don't already have a value.
 */
export function buildContactUpdates(
  data: EnrichedData,
  existingContact: Record<string, unknown>
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  if (data.email && !existingContact.primary_email) {
    updates.primary_email = data.email;
  }

  // Raw provider classification (e.g. MoltSets business/personal) — fill
  // once, don't overwrite a value another provider already set.
  if (data.emailType && !existingContact.email_type) {
    updates.email_type = data.emailType;
  }
  // Freshness signal — always refresh to the latest provider-reported date.
  if (data.emailLastValidatedAt) {
    updates.email_last_validated_at = data.emailLastValidatedAt;
  }

  if (data.phone && !existingContact.primary_phone) {
    updates.primary_phone = data.phone;
  }

  if (data.title && !existingContact.job_title) {
    updates.job_title = data.title;
  }

  if (data.company?.name && !existingContact.company) {
    updates.company = data.company.name;
  }

  if (data.company?.website && !existingContact.company_website) {
    updates.company_website = data.company.website;
  } else if (data.company?.domain && !existingContact.company_website) {
    updates.company_website = `https://${data.company.domain}`;
  }

  if (data.city && !existingContact.city) {
    updates.city = data.city;
  }
  if (data.state && !existingContact.state) {
    updates.state = data.state;
  }
  if (data.country && !existingContact.country) {
    updates.country = data.country;
  }

  if (!existingContact.primary_linkedin_url && data.socialProfiles) {
    const linkedinProfile = data.socialProfiles.find(p => p.platform === 'linkedin');
    if (linkedinProfile?.url) {
      updates.primary_linkedin_url = linkedinProfile.url;
    }
  }

  updates.enriched_at = new Date().toISOString();

  const existingEnrichmentData = (existingContact.enrichment_data as Record<string, unknown>) || {};
  updates.enrichment_data = {
    ...existingEnrichmentData,
    lastEnrichedAt: new Date().toISOString(),
    emailConfidence: data.emailConfidence,
    emailVerified: data.emailVerified,
    alternateEmails: data.alternateEmails,
    seniority: data.seniority,
    department: data.department,
    company: data.company ? {
      name: data.company.name,
      domain: data.company.domain,
      website: data.company.website,
      industry: normalizeIndustryLabel(data.company.industry) ?? data.company.industry,
      // Banded to the canonical 8-value scale so the same headcount
      // reported differently by different providers filters as one value.
      size: normalizeEmployeeRange(data.company.sizeRange ?? data.company.size) ?? data.company.size,
      sizeRange: data.company.sizeRange,
      revenue: data.company.revenue,
      linkedinUrl: data.company.linkedinUrl,
      description: data.company.description,
      foundedYear: data.company.foundedYear,
      technologies: data.company.technologies,
    } : undefined,
    socialProfiles: data.socialProfiles,
  };

  return updates;
}

/**
 * Add contact identities for newly found channels.
 */
export async function addContactIdentities(
  supabase: SupabaseClient,
  contactId: string,
  organizationId: string,
  data: EnrichedData
): Promise<void> {
  const identitiesToAdd: Array<{
    contact_id: string;
    organization_id: string;
    channel: string;
    platform_user_id: string;
    platform_username: string | null;
  }> = [];

  if (data.email) {
    identitiesToAdd.push({
      contact_id: contactId,
      organization_id: organizationId,
      channel: 'email',
      platform_user_id: data.email,
      platform_username: data.email,
    });
  }

  if (data.phone) {
    identitiesToAdd.push({
      contact_id: contactId,
      organization_id: organizationId,
      channel: 'sms',
      platform_user_id: data.phone,
      platform_username: data.phone,
    });
    identitiesToAdd.push({
      contact_id: contactId,
      organization_id: organizationId,
      channel: 'whatsapp',
      platform_user_id: data.phone,
      platform_username: data.phone,
    });
  }

  if (data.socialProfiles) {
    for (const profile of data.socialProfiles) {
      if (profile.platform === 'linkedin') {
        identitiesToAdd.push({
          contact_id: contactId,
          organization_id: organizationId,
          channel: 'linkedin',
          platform_user_id: profile.url,
          platform_username: profile.username || null,
        });
      } else if (profile.platform === 'instagram') {
        identitiesToAdd.push({
          contact_id: contactId,
          organization_id: organizationId,
          channel: 'instagram',
          platform_user_id: profile.username || profile.url,
          platform_username: profile.username || null,
        });
      } else if (profile.platform === 'twitter') {
        identitiesToAdd.push({
          contact_id: contactId,
          organization_id: organizationId,
          channel: 'twitter',
          platform_user_id: profile.url,
          platform_username: profile.username || null,
        });
      }
    }
  }

  if (identitiesToAdd.length === 0) return;

  const { error } = await supabase
    .from('crm_contact_identities')
    .upsert(identitiesToAdd, {
      onConflict: 'organization_id,channel,platform_user_id',
      ignoreDuplicates: true,
    });

  if (error) {
    console.error('Failed to add contact identities:', error);
  }
}

/**
 * Log an enrichment attempt to enrichment_history.
 */
export async function logEnrichmentHistory(
  supabase: SupabaseClient,
  data: {
    organizationId: string;
    contactId: string;
    provider: string;
    enrichmentType: string;
    dataFound: EnrichedData;
    dataApplied: boolean;
    creditsUsed: number;
  }
): Promise<void> {
  try {
    await supabase.from('enrichment_history').insert({
      organization_id: data.organizationId,
      contact_id: data.contactId,
      provider: data.provider,
      enrichment_type: data.enrichmentType,
      data_found: data.dataFound,
      data_applied: data.dataApplied,
      credits_used: data.creditsUsed,
    });
  } catch (error) {
    console.log('Could not log to enrichment_history (table may not exist):', error);
  }
}

/**
 * Record a completed email-provider response without storing payloads or
 * credentials. Unlike enrichment_history this deliberately includes misses,
 * allowing every enrichment entry point to share one honest find-rate base.
 */
export async function logEmailProviderLookup(
  // Callers currently use two compatible Supabase SDK import URLs.
  supabase: any,
  data: {
    organizationId: string;
    contactId: string;
    provider: string;
    outcome: 'found' | 'not_found';
    source: 'workflow' | 'moltsets_tick' | 'campaign';
    leadListId?: string | null;
    campaignId?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from('email_provider_lookup_outcomes').insert({
      organization_id: data.organizationId,
      contact_id: data.contactId,
      provider: data.provider,
      outcome: data.outcome,
      source: data.source,
      lead_list_id: data.leadListId ?? null,
      campaign_id: data.campaignId ?? null,
    });
    if (error) console.warn('Could not log email provider lookup outcome:', error.message);
  } catch (error) {
    console.warn('Could not log email provider lookup outcome:', error);
  }
}

/**
 * Apply an enrichment result to a contact end-to-end: build+apply updates,
 * add identities, and log history. Shared by enrich-contact,
 * process-enrichment-queue, and moltsets-daily-enrichment-tick so all three
 * callers stay consistent.
 */
export async function applyEnrichmentResult(
  supabase: SupabaseClient,
  params: {
    contactId: string;
    organizationId: string;
    existingContact: Record<string, unknown>;
    provider: string;
    enrichmentType: string;
    data: EnrichedData;
    creditsUsed: number;
  }
): Promise<{ appliedToContact: boolean }> {
  const updates = buildContactUpdates(params.data, params.existingContact);
  let appliedToContact = false;

  // Feed the shared pool as a side effect of ordinary tenant enrichment.
  //
  // Company size and revenue are the scarcest data on the platform — the
  // ~75k MoltSets records/week ceiling is exactly what caps list building —
  // and every enrichment already pays for them. Writing them through means the
  // pool improves whenever anyone anywhere enriches a contact, instead of only
  // when a dedicated sweep runs.
  //
  // Global on purpose, like the rest of lead_pool_verified: the pool is shared
  // infrastructure, so a company resolved once is resolved for everyone. Only
  // firmographics travel — never the tenant's contact, list or campaign.
  //
  // Best-effort and non-fatal: this is a bonus, and failing a tenant's
  // enrichment because a shared-infrastructure write hiccuped would trade
  // something they asked for against something they did not.
  await writeThroughToPool(supabase, params.data).catch((err) =>
    console.log('[enrichment] pool write-through skipped:', err?.message ?? err)
  );

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('crm_contacts')
      .update(updates)
      .eq('id', params.contactId);

    if (updateError) {
      console.error('Failed to update contact:', updateError);
    } else {
      appliedToContact = true;
      await addContactIdentities(supabase, params.contactId, params.organizationId, params.data);
    }
  }

  await logEnrichmentHistory(supabase, {
    organizationId: params.organizationId,
    contactId: params.contactId,
    provider: params.provider,
    enrichmentType: params.enrichmentType,
    dataFound: params.data,
    dataApplied: appliedToContact,
    creditsUsed: params.creditsUsed,
  });

  return { appliedToContact };
}


/**
 * Mirror provider firmographics into the global verified pool layer.
 *
 * COALESCE semantics throughout: an enrichment must never blank a field the
 * website classifier already established. Category in particular is derived
 * from what a company publishes about itself and is better evidence of what a
 * business DOES than any provider's industry label, so it is never touched
 * here.
 */
async function writeThroughToPool(
  supabase: SupabaseClient,
  data: EnrichedData,
): Promise<void> {
  const raw = (data.rawResponse ?? {}) as Record<string, unknown>;
  const rawCompany = raw.company && typeof raw.company === 'object' && !Array.isArray(raw.company)
    ? raw.company as Record<string, unknown>
    : {};
  const company = data.company;
  const domain = (company?.domain ?? '').toLowerCase().trim();

  if (domain) {
    await supabase.rpc('upsert_verified_person', {
      p: {
        linkedin_url: raw.linkedin_url ?? null,
        first_name: raw.first_name ?? null,
        last_name: raw.last_name ?? null,
        full_name: raw.full_name ?? null,
        title: data.title ?? null,
        headline: raw.headline ?? null,
        seniority: data.seniority ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? null,
        company_domain: domain,
        company_name: company?.name ?? null,
        company_linkedin_url: company?.linkedinUrl ?? null,
        company_country: rawCompany.country ?? null,
        company_state: rawCompany.state ?? null,
        company_city: rawCompany.city ?? null,
        employee_count: raw.employee_count ?? null,
        employee_range: company?.size ?? null,
        revenue_range: company?.revenue ?? null,
        linkedin_industry: company?.industry ?? null,
        business_email: data.email ?? null,
        business_email_validated_at: raw.business_email_validated_at ?? null,
        business_email_risk: raw.business_email_risk_score ?? null,
        personal_email: raw.personal_email ?? null,
        personal_email_validated_at: raw.personal_email_validated_at ?? null,
        personal_email_risk: raw.personal_email_risk_score ?? null,
        source_updated_at: raw.last_updated_at ?? null,
        moltsets_payload: raw,
        moltsets_company_payload: rawCompany,
        status: 'found',
      },
    });
  }
}
