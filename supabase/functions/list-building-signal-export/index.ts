/**
 * Signal Export Runner.
 *
 * Cron-invoked every 5 minutes. For each signal_activity_log row that is
 * `outcome='enrolled'` AND `exported_at IS NULL`:
 *
 *   1. Find the corresponding lb_discovered_companies row.
 *   2. Find the best lb_decision_makers row for that company (Fly's DM scrape).
 *   3. Find a verified lb_email_verifications row for that DM. The Fly
 *      verifier worker writes these now (we patched it on 2026-05-03 — it
 *      used to silently no-op into a non-existent lb_verified_emails table).
 *   4. Upsert a crm_contact with the verified email + DM details + signal
 *      metadata in `discovery_metadata` so the {{ai_signal_*}} variables
 *      and smart-list filters can read it.
 *   5. Add the contact to the subscription's auto-managed lead_list.
 *   6. Stamp signal_activity_log with exported_at.
 *
 * Inline SMTP from this edge function is intentionally NOT done — Supabase
 * edge runtime blocks outbound TCP on port 25. SMTP lives on Fly via the
 * verifier worker. This runner is the post-hoc joiner.
 *
 * Routing into outreach campaigns / email sequences is intentionally NOT
 * handled here. Once the contact lives in crm_contacts with the right
 * discovery_metadata, the existing smart-list filter +
 * `enroll_smart_list_into_active_campaigns()` cron handles enrollment
 * automatically.
 *
 * Idempotent: re-running on the same signal_activity_log row is a no-op
 * because exported_at gets set once.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';

const BATCH_SIZE = 200;

interface ActivityRow {
  id: number;
  subscription_id: string;
  organization_id: string;
  discovered_company_id: string | null;
  signal_type: string | null;
  signal_detail: string | null;
  icp_score: number | null;
  data: Record<string, unknown> | null;
}

interface SubscriptionRow {
  id: string;
  organization_id: string;
  lead_list_id: string | null;
  pack_key: string | null;
  destination_type: 'campaign' | 'sequence' | 'holding' | null;
  destination_id: string | null;
}

interface CompanyRow {
  id: string;
  job_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  country: string | null;
  employee_count_estimate: number | null;
  revenue_range: string | null;
  raw_html_snippet: string | null;
}

interface DmRow {
  id: string;
  first_name: string;
  last_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  source_page: string | null;
}

interface EmailRow {
  email: string;
  status: string;
  catch_all: boolean;
}

async function fetchPending(supabase: SupabaseClient, companyId?: string): Promise<ActivityRow[]> {
  let query = supabase
    .from('signal_activity_log')
    .select('id, subscription_id, organization_id, discovered_company_id, signal_type, signal_detail, icp_score, data')
    .eq('outcome', 'enrolled')
    .is('exported_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (companyId) query = query.eq('discovered_company_id', companyId);
  const { data, error } = await query;
  if (error) {
    console.error('[signal-export] fetchPending failed', error);
    return [];
  }
  return (data as ActivityRow[]) ?? [];
}

async function getSubscription(supabase: SupabaseClient, id: string): Promise<SubscriptionRow | null> {
  const { data } = await supabase
    .from('pack_subscriptions')
    .select('id, organization_id, lead_list_id, pack_key, destination_type, destination_id')
    .eq('id', id)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

async function getCompany(supabase: SupabaseClient, id: string): Promise<CompanyRow | null> {
  const { data } = await supabase
    .from('lb_discovered_companies')
    .select('id, job_id, company_name, domain, website_url, linkedin_url, country, employee_count_estimate, revenue_range, raw_html_snippet')
    .eq('id', id)
    .maybeSingle();
  return (data as CompanyRow | null) ?? null;
}

interface FlatFirmographics {
  employeeCount: number | null;
  revenueRange: string | null;
  industry: string | null;
  source: string | null;
}

async function getFlatFirmographics(
  supabase: SupabaseClient,
  company: CompanyRow,
): Promise<FlatFirmographics> {
  const companyKey = company.company_name.trim().toLowerCase();
  const { data } = await supabase
    .from('public_signal_companies')
    .select('employee_count, revenue_range, industry, source')
    .eq('company_key', companyKey)
    .maybeSingle();
  const row = data as {
    employee_count?: number | null;
    revenue_range?: string | null;
    industry?: string | null;
    source?: string | null;
  } | null;
  return {
    employeeCount: row?.employee_count ?? company.employee_count_estimate,
    revenueRange: row?.revenue_range ?? company.revenue_range,
    industry: row?.industry ?? null,
    source: row?.source ?? (company.employee_count_estimate != null || company.revenue_range ? 'signal_source' : null),
  };
}

/**
 * Returns up to TOP_DMS_PER_SIGNAL decision-makers for the company,
 * ordered by confidence (CEO/founder/C-suite ranked highest by the
 * dm-scraper). The export runner creates one crm_contact per DM that
 * has a verified email, giving the user broad outreach surface (e.g.
 * for a Series B post-funding signal: CEO + Head of Sales + Head of
 * Marketing all become contacts).
 */
const TOP_DMS_PER_SIGNAL = 5;

async function getTopDms(supabase: SupabaseClient, companyId: string): Promise<DmRow[]> {
  const { data } = await supabase
    .from('lb_decision_makers')
    .select('id, first_name, last_name, title, linkedin_url, source_page')
    .eq('company_id', companyId)
    .order('confidence', { ascending: false, nullsFirst: false })
    .limit(TOP_DMS_PER_SIGNAL);
  return (data as DmRow[] | null) ?? [];
}

async function getVerifiedEmail(supabase: SupabaseClient, dmId: string): Promise<EmailRow | null> {
  const { data } = await supabase
    .from('lb_email_verifications')
    .select('email, status, catch_all')
    .eq('dm_id', dmId)
    .in('status', ['verified', 'catch_all'])
    .order('verified_at', { ascending: false })
    .limit(1);
  return (data?.[0] as EmailRow | null) ?? null;
}

// Historical backfill (verified emails buried in stage='icp' work item payloads
// because the Fly verifier used to write to a non-existent table) is handled
// once via supabase/migrations/20260516230000_backfill_lb_email_verifications_from_icp.sql.

/**
 * Ensure a crm_companies row exists for this discovered company. Keyed on
 * (organization_id, normalized_domain). Returns the row id so we can link
 * the contact's company_id FK. Idempotent — re-runs are no-ops thanks to
 * the unique index on normalized_domain.
 *
 * Bumps last_signal_at so the company list sorts by recent activity.
 *
 * NEVER triggers external enrichment — that's opt-in only, via the
 * enrich-company-signalbase edge function called from the company detail page.
 */
async function upsertCrmCompany(
  supabase: SupabaseClient,
  orgId: string,
  company: CompanyRow,
): Promise<string | null> {
  // Normalize domain client-side to find the existing row (the DB trigger
  // also normalizes on write, so we'll match on the same shape).
  const rawDomain = company.domain ?? company.website_url ?? null;
  if (!rawDomain && !company.company_name) return null;
  const normalizedDomain = rawDomain
    ? rawDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()
    : null;

  // Look for existing match. Domain wins; fall back to lower(name) when no domain.
  let existingId: string | null = null;
  if (normalizedDomain) {
    const { data } = await supabase
      .from('crm_companies')
      .select('id')
      .eq('organization_id', orgId)
      .eq('normalized_domain', normalizedDomain)
      .maybeSingle();
    existingId = (data as { id?: string } | null)?.id ?? null;
  }
  if (!existingId && company.company_name) {
    const { data } = await supabase
      .from('crm_companies')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('name', company.company_name)
      .maybeSingle();
    existingId = (data as { id?: string } | null)?.id ?? null;
  }

  if (existingId) {
    // Touch last_signal_at + opportunistically backfill missing fields.
    const patch: Record<string, unknown> = {
      last_signal_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (company.linkedin_url) patch.linkedin_url = company.linkedin_url;
    if (company.country) patch.country = company.country;
    if (company.website_url) patch.website_url = company.website_url;
    if (rawDomain) patch.domain = rawDomain;
    await supabase.from('crm_companies').update(patch).eq('id', existingId);
    return existingId;
  }

  // Insert new. Default account_stage = 'prospect' (the column was renamed
  // from lifecycle_status in 20260521050000_account_stage_replaces_lifecycle).
  const { data: created, error } = await supabase
    .from('crm_companies')
    .insert({
      organization_id: orgId,
      name: company.company_name,
      domain: rawDomain,
      website_url: company.website_url,
      linkedin_url: company.linkedin_url,
      country: company.country,
      account_stage: 'prospect',
      last_signal_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !created) {
    console.warn('[signal-export] crm_companies insert failed', error);
    return null;
  }
  return (created as { id: string }).id;
}

// JSON helpers used by the signal-data extraction path (added on main).
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

function parseEmbeddedSignal(raw: string | null): Record<string, unknown> {
  if (!raw?.startsWith('__signal__:')) return {};
  try {
    return asRecord(JSON.parse(raw.slice('__signal__:'.length)));
  } catch {
    return {};
  }
}

async function upsertContact(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
  dm: DmRow,
  company: CompanyRow,
  signal: {
    type: string | null;
    detail: string | null;
    icp_score: number | null;
    pack_key: string | null;
    subscription_id: string;
    evidence_url: string | null;
    signal_date: string | null;
    context: Record<string, unknown>;
    source_urls: string[];
    outreach_context: string | null;
    signal_confidence: unknown;
    signal_verification_status: string | null;
  },
  verification: EmailRow,
  firmographics: FlatFirmographics,
): Promise<string | null> {
  const fullName = `${dm.first_name} ${dm.last_name ?? ''}`.trim();
  const liUrl = dm.linkedin_url ?? company.linkedin_url;
  const signalContext = asRecord(signal.context);
  const companyContext = asRecord(signalContext.company);
  const fundingContext = asRecord(signalContext.funding);
  const hiringContext = asRecord(signalContext.hiring);
  const jobChangeContext = asRecord(signalContext.job_change);
  const sourceUrls = signal.source_urls.length > 0
    ? signal.source_urls
    : signal.evidence_url
      ? [signal.evidence_url]
      : [];
  const discoveryMetadata = {
    pack_source: signal.pack_key,
    signal_subscription_id: signal.subscription_id,
    signal_type: signal.type,
    signal_detail: signal.detail,
    signal_date: signal.signal_date,
    signal_context: signalContext,
    signal_outreach_context: signal.outreach_context ?? asString(signalContext.outreach_context) ?? signal.detail,
    signal_source_url: signal.evidence_url ?? sourceUrls[0] ?? null,
    directory_evidence_url: signal.evidence_url ?? sourceUrls[0] ?? null,
    source_urls: sourceUrls,
    signal_confidence: signal.signal_confidence ?? signalContext.confidence_score ?? null,
    signal_verification_status: signal.signal_verification_status ?? asString(signalContext.verification_status),
    company_context: {
      website: asString(companyContext.website) ?? company.website_url,
      linkedin: asString(companyContext.linkedin) ?? company.linkedin_url,
      industry: asString(companyContext.industry),
      employee_count: companyContext.employee_count ?? null,
      description: asString(companyContext.description),
      country: asString(companyContext.country) ?? company.country,
    },
    funding_context: fundingContext,
    hiring_context: hiringContext,
    job_change_context: jobChangeContext,
    ai_signal_company_website: asString(companyContext.website) ?? company.website_url,
    ai_signal_company_linkedin: asString(companyContext.linkedin) ?? company.linkedin_url,
    ai_signal_company_industry: asString(companyContext.industry),
    ai_signal_person: asString(jobChangeContext.person_name),
    ai_signal_new_role: asString(jobChangeContext.new_role),
    ai_signal_amount: fundingContext.amount != null ? String(fundingContext.amount) : null,
    ai_signal_investors: asStringArray(fundingContext.investors).join(', ') || null,
    icp_score: signal.icp_score,
    email_confidence: signal.icp_score,
  };
  const flatSignal = {
    signal_event_id: asString(signalContext.signal_event_id),
    signal_subscription_id: signal.subscription_id,
    signal_type: signal.type,
    signal_date: signal.signal_date,
    signal_detail: signal.detail,
    signal_source_url: signal.evidence_url ?? sourceUrls[0] ?? null,
    signal_confidence: typeof signal.signal_confidence === 'number' ? signal.signal_confidence : null,
    company_employee_count: firmographics.employeeCount,
    company_revenue_range: firmographics.revenueRange,
    company_industry: firmographics.industry,
    firmographics_checked_at: firmographics.source ? new Date().toISOString() : null,
    firmographics_source: firmographics.source,
    email_verification_status: verification.status === 'verified' ? 'valid' : 'catch_all',
    email_verification_source: dm.source_page?.startsWith('quickenrich:') ? 'quickenrich' : 'signal_verifier',
    email_verified_at: new Date().toISOString(),
    email_is_catch_all: verification.catch_all || verification.status === 'catch_all',
    email_is_deliverable: verification.status === 'verified',
  };

  // Tier 1 dedup: existing contact found by primary_email.
  // crm_contacts has UNIQUE(organization_id, primary_linkedin_url), so we
  // can't blindly overwrite that column — another row may already own the
  // URL we'd be writing. Pre-flight against that.
  const { data: byEmail } = await supabase
    .from('crm_contacts')
    .select('id, primary_linkedin_url')
    .eq('organization_id', orgId)
    .eq('primary_email', email)
    .maybeSingle();

  if (byEmail) {
    const existingId = (byEmail as { id: string }).id;
    const currentLi = (byEmail as { primary_linkedin_url: string | null }).primary_linkedin_url;
    let safeLi: string | null = currentLi;
    if (liUrl && liUrl !== currentLi) {
      const { data: liConflict } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('organization_id', orgId)
        .eq('primary_linkedin_url', liUrl)
        .neq('id', existingId)
        .maybeSingle();
      safeLi = liConflict ? currentLi : liUrl;
    }
    await supabase
      .from('crm_contacts')
      .update({
        first_name: dm.first_name,
        last_name: dm.last_name,
        job_title: dm.title,
        company: company.company_name,
        company_website: company.website_url,
        primary_linkedin_url: safeLi,
        country: company.country,
        discovery_metadata: discoveryMetadata,
        discovery_score: signal.icp_score,
        ...flatSignal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingId);
    return existingId;
  }

  // Tier 2 dedup: existing contact found by primary_linkedin_url.
  // Same person discovered earlier (LinkedIn import or prior signal run)
  // under a different email. Re-use the row, attach the verified email.
  if (liUrl) {
    const { data: byLi } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('primary_linkedin_url', liUrl)
      .maybeSingle();
    if (byLi) {
      const existingId = (byLi as { id: string }).id;
      await supabase
        .from('crm_contacts')
        .update({
          first_name: dm.first_name,
          last_name: dm.last_name,
          job_title: dm.title,
          company: company.company_name,
          company_website: company.website_url,
          primary_email: email,
          country: company.country,
          discovery_metadata: discoveryMetadata,
          discovery_score: signal.icp_score,
          ...flatSignal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId);
      // Best-effort: add email identity. Swallow uniqueness errors.
      await supabase.from('crm_contact_identities').insert({
        organization_id: orgId,
        contact_id: existingId,
        channel: 'email',
        platform_user_id: email,
        platform_username: fullName,
        is_verified: true,
        is_primary: true,
      }).then(() => undefined, () => undefined);
      return existingId;
    }
  }

  // Tier 3: insert a new contact.
  const { data: created, error } = await supabase
    .from('crm_contacts')
    .insert({
      organization_id: orgId,
      display_name: fullName || company.company_name,
      first_name: dm.first_name,
      last_name: dm.last_name,
      primary_email: email,
      primary_linkedin_url: liUrl,
      job_title: dm.title,
      company: company.company_name,
      company_website: company.website_url,
      country: company.country,
      source: 'aca_discovery',
      status: 'active',
      discovery_metadata: discoveryMetadata,
      discovery_score: signal.icp_score,
      ...flatSignal,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.error('[signal-export] crm_contacts insert failed', error);
    return null;
  }
  const contactId = (created as { id: string }).id;

  // Email + LinkedIn identities so campaign-processor + smart-list filters
  // can find them. Swallow per-row failures — duplicate-identity errors
  // must not roll back the whole contact insert.
  await supabase.from('crm_contact_identities').insert({
    organization_id: orgId,
    contact_id: contactId,
    channel: 'email',
    platform_user_id: email,
    platform_username: fullName,
    is_verified: true,
    is_primary: true,
  }).then(() => undefined, () => undefined);
  if (liUrl) {
    const liId = liUrl.split('/in/')[1]?.replace(/\/$/, '') ?? liUrl;
    await supabase.from('crm_contact_identities').insert({
      organization_id: orgId,
      contact_id: contactId,
      channel: 'linkedin',
      platform_user_id: liId,
      platform_username: fullName,
      platform_profile_url: liUrl,
      is_primary: false,
    }).then(() => undefined, () => undefined);
  }
  return contactId;
}

async function processOne(supabase: SupabaseClient, row: ActivityRow): Promise<{
  ok: boolean;
  reason?: string;
  contactId?: string;
  contacts_created?: number;
}> {
  if (!row.discovered_company_id) return { ok: false, reason: 'no_company' };
  const sub = await getSubscription(supabase, row.subscription_id);
  if (!sub) return { ok: false, reason: 'subscription_missing' };
  const company = await getCompany(supabase, row.discovered_company_id);
  if (!company) return { ok: false, reason: 'company_missing' };

  // Fan out: top-5 DMs per company. Each DM with a verified email becomes
  // its own crm_contact, giving the user the full outreach surface for
  // the signal (CEO + sales lead + marketing lead etc.).
  const dms = await getTopDms(supabase, company.id);
  if (dms.length === 0) return { ok: false, reason: 'no_dm_yet' };

  const data = (row.data as Record<string, unknown>) ?? {};
  // Pull enriched signal context from either signal_activity_log.data
  // (preferred, set by pack-refresh) or the embedded marker on
  // company.raw_html_snippet (legacy fallback for old rows).
  const embedded = parseEmbeddedSignal(company.raw_html_snippet);
  const embeddedContext = asRecord(embedded.context);
  const rowContext = asRecord(data.signal_context);
  const signalContext = Object.keys(rowContext).length > 0 ? rowContext : embeddedContext;
  const sourceUrls = asStringArray(data.source_urls).length > 0
    ? asStringArray(data.source_urls)
    : asStringArray(signalContext.source_urls);
  const signalCtx = {
    type: row.signal_type,
    detail: row.signal_detail,
    icp_score: row.icp_score,
    pack_key: sub.pack_key,
    subscription_id: row.subscription_id,
    evidence_url: asString(data.evidence_url) ?? asString(embedded.evidence_url),
    signal_date: asString(data.signal_date) ?? asString(embedded.date),
    context: signalContext,
    source_urls: sourceUrls,
    outreach_context: asString(data.outreach_context) ?? asString(signalContext.outreach_context),
    signal_confidence: data.signal_confidence ?? signalContext.confidence_score ?? null,
    signal_verification_status:
      asString(data.signal_verification_status) ?? asString(signalContext.verification_status),
  };

  // Ensure a crm_companies row exists before creating contacts. Once-per-
  // signal-row cost: 1-2 Supabase round trips. NEVER calls Apify — only
  // user-clicked enrichment does that.
  const crmCompanyId = await upsertCrmCompany(supabase, row.organization_id, company);
  const firmographics = await getFlatFirmographics(supabase, company);

  const createdContactIds: string[] = [];
  for (const dm of dms) {
    const email = await getVerifiedEmail(supabase, dm.id);
    if (!email) continue;
    const contactId = await upsertContact(
      supabase, row.organization_id, email.email, dm, company, signalCtx, email, firmographics,
    );
    if (contactId) {
      createdContactIds.push(contactId);
      // Link the contact to the canonical company. Best-effort; an FK
      // constraint failure here just means the company id was bogus.
      if (crmCompanyId) {
        await supabase
          .from('crm_contacts')
          .update({ company_id: crmCompanyId })
          .eq('id', contactId)
          .then(() => undefined, () => undefined);
      }
    }
  }

  if (createdContactIds.length === 0) return { ok: false, reason: 'no_email_yet' };

  // Add every new contact to the pack's auto-managed lead_list (idempotent —
  // UNIQUE(list_id, contact_id) makes duplicates a no-op).
  if (sub.lead_list_id) {
    const memberRows = createdContactIds.map((id) => ({
      list_id: sub.lead_list_id,
      contact_id: id,
      source_data: { source: 'signal_export', signal_type: row.signal_type },
    }));
    await supabase.from('lead_list_members').upsert(memberRows, {
      onConflict: 'list_id,contact_id',
      ignoreDuplicates: true,
    })
      .then(() => undefined, () => undefined);
  }

  // Sequence destinations bypass the 15-minute list auto-enrollment cron.
  // enroll-leads accepts this internal service-role call and remains
  // idempotent on (sequence_id, lead_id), so retries are safe.
  if (sub.destination_type === 'sequence' && sub.destination_id) {
    const { error: enrollmentError } = await supabase.functions.invoke('enroll-leads', {
      body: {
        sequenceId: sub.destination_id,
        organizationId: row.organization_id,
        contactIds: createdContactIds,
      },
    });
    if (enrollmentError) {
      console.warn('[signal-export] immediate sequence enrollment failed', enrollmentError.message);
    }
  }

  // Stamp the activity row with the FIRST contact id (legacy — used by
  // SignalDetailPage's "in CRM" badge). Future schema work could store
  // an array of all contact ids, but the binary flag is enough today.
  await supabase
    .from('signal_activity_log')
    .update({
      exported_at: new Date().toISOString(),
      contact_id_resolved: createdContactIds[0],
    })
    .eq('id', row.id);

  return { ok: true, contactId: createdContactIds[0], contacts_created: createdContactIds.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({})) as { company_id?: string };

    // The pg_cron job and the list-building workers send the service-role key;
    // the app also kicks this with a signed-in user's JWT. A user kick runs the
    // normal idempotent sweep: only the service role may scope it to a company.
    if (!isServiceRoleRequest(req)) {
      try {
        await authenticateRequest(req, supabase);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
      body.company_id = undefined;
    }

    const rows = await fetchPending(supabase, body.company_id);
    let exported = 0;
    let contacts_created = 0;
    let waiting = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const r = await processOne(supabase, row);
      if (r.ok) {
        exported += 1;
        contacts_created += r.contacts_created ?? 1;
      } else if (r.reason === 'no_dm_yet' || r.reason === 'no_email_yet') {
        waiting += 1;
      } else {
        failed += 1;
        if (r.reason) errors.push(`${row.id}:${r.reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: rows.length,
        exported,
        contacts_created,
        waiting,
        failed,
        errors: errors.slice(0, 10),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[signal-export] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
