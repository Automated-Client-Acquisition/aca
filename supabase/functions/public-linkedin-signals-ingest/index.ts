import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aca-signal-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Hermes owns public signal acquisition. This legacy endpoint accepted loosely
// normalised LinkedIn collection output, so it stays off unless an explicit
// emergency rollback flag is set.
const LEGACY_INGEST_ENABLED = Deno.env.get('PUBLIC_LINKEDIN_SIGNALS_INGEST_ENABLED') === 'true';

type EmailStatus = 'verified' | 'catch_all' | 'invalid' | 'unknown';

type DecisionMaker = {
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_status?: EmailStatus | string | null;
};

type NormalizedSignal = {
  company_name: string;
  domain?: string | null;
  linkedin_url?: string | null;
  country?: string | null;
  employee_count_estimate?: number | null;
  signal_type: string;
  signal_detail: string;
  signal_date: string;
  evidence_url?: string | null;
  source_name?: string | null;
  source_key?: string | null;
  source_published_at?: string | null;
  amount_usd?: number | null;
  round_info?: string | null;
  raw_signal?: Record<string, unknown> | null;
  fit_score?: number | null;
  decision_makers?: DecisionMaker[];
};

type IngestRequest = {
  organization_id?: string;
  pack_key?: string;
  public_share_token?: string;
  signals?: NormalizedSignal[];
  dry_run?: boolean;
};

function seniorityRank(title?: string | null): number {
  const t = (title || "").toLowerCase();
  if (!t) return 0;
  if (/\b(founder|co-?founder|owner|ceo|chief executive|president|managing director|managing partner)\b/.test(t)) return 100;
  if (/\bc[tfdmiore]o\b|\bchief\b/.test(t)) return 90;
  if (/\b(partner|general partner|gp)\b/.test(t)) return 80;
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 70;
  if (/\b(head of|head,|director)\b/.test(t)) return 60;
  return 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function normalizeDomain(value: unknown): string | null {
  const s = cleanText(value);
  if (!s) return null;
  try {
    const url = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null;
  }
}

function normalizeLinkedinUrl(value: unknown, kind: 'company' | 'person' = 'company'): string | null {
  const s = cleanText(value);
  if (!s) return null;
  if (s.includes('linkedin.com/')) return s.split('?')[0].replace(/\/$/, '');
  const slug = s.replace(/^@/, '').replace(/^company\//, '').replace(/^in\//, '').trim();
  if (!slug || slug === 'https:') return null;
  return kind === 'person'
    ? `https://www.linkedin.com/in/${slug}`
    : `https://www.linkedin.com/company/${slug}`;
}

function isHttpUrl(value: unknown): boolean {
  const text = cleanText(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isVerifiedEmail(value: unknown, status: unknown): boolean {
  const email = cleanText(value)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  const normalized = normalizeEmailStatus(status);
  return normalized === 'verified' || normalized === 'catch_all';
}

/**
 * The public feed is useful for discovery, but ACA must only create a CRM
 * company when the source supplies a stable identity and evidence. Name-only
 * LinkedIn mentions collide frequently and cannot be enriched reliably.
 */
function signalValidationError(sig: NormalizedSignal): string | null {
  if (!cleanText(sig.company_name)) return 'missing_company_name';
  if (!normalizeDomain(sig.domain) && !normalizeLinkedinUrl(sig.linkedin_url, 'company')) {
    return 'missing_company_identity';
  }
  if (!cleanText(sig.signal_type)) return 'missing_signal_type';
  if (!cleanText(sig.signal_detail)) return 'missing_signal_detail';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(sig.signal_date) || '')) return 'invalid_signal_date';
  if (!isHttpUrl(sig.evidence_url)) return 'missing_or_invalid_evidence_url';
  return null;
}

function isEligibleDecisionMaker(dm: DecisionMaker): boolean {
  const rank = seniorityRank(cleanText(dm.title));
  if (rank <= 0) return false;
  return !!normalizeLinkedinUrl(dm.linkedin_url, 'person') || isVerifiedEmail(dm.email, dm.email_status);
}

async function findOrCreatePublicSubscription(
  supabase: SupabaseClient<any>,
  organizationId: string,
  packKey: string,
  token: string,
) {
  const now = new Date().toISOString();
  const { data: existing, error: findErr } = await supabase
    .from('pack_subscriptions')
    .select('id, public_published_at')
    .eq('organization_id', organizationId)
    .eq('pack_key', packKey)
    .is('deleted_at', null)
    .maybeSingle();

  if (findErr) throw new Error(`subscription_lookup_failed: ${findErr.message}`);

  if (existing?.id) {
    const { data, error } = await supabase
      .from('pack_subscriptions')
      .update({
        tier: 'signal',
        status: 'active',
        refresh_cadence: 'daily',
        is_public: true,
        public_share_token: token,
        public_published_at: existing.public_published_at ?? now,
        last_refreshed_at: now,
        next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', existing.id)
      .select('id, organization_id, public_share_token')
      .single();
    if (error) throw new Error(`subscription_update_failed: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from('pack_subscriptions')
    .insert({
      organization_id: organizationId,
      pack_key: packKey,
      tier: 'signal',
      status: 'active',
      refresh_cadence: 'daily',
      config: { source: 'public_linkedin_signals_ingest' },
      is_public: true,
      public_share_token: token,
      public_published_at: now,
      last_refreshed_at: now,
      next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id, organization_id, public_share_token')
    .single();
  if (error) throw new Error(`subscription_insert_failed: ${error.message}`);
  return data;
}

async function createJob(supabase: SupabaseClient<any>, organizationId: string, packKey: string, count: number) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('list_building_jobs')
    .insert({
      organization_id: organizationId,
      name: `Public LinkedIn signals ingest ${today}`,
      status: 'completed',
      query: { pack_key: packKey, source: 'public_linkedin_signals_ingest', count },
      worker_config: { triggered_by: 'public_linkedin_signals_ingest' },
      progress: 100,
      total_companies: count,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      metadata: { pack_key: packKey },
    })
    .select('id')
    .single();
  if (error) throw new Error(`job_insert_failed: ${error.message}`);
  return data.id as string;
}

function signalDedupeKey(subscriptionId: string, companyId: string, sig: NormalizedSignal): string {
  const parts = [
    subscriptionId,
    companyId,
    sig.signal_type,
    sig.signal_date,
    sig.evidence_url || (sig.raw_signal?.signal_hash as string | undefined) || '',
  ];
  return parts.map((p) => String(p ?? '').toLowerCase().trim()).join('|');
}

function eventClusterKey(companyId: string, sig: NormalizedSignal): string {
  const amount = typeof sig.amount_usd === 'number' && sig.amount_usd > 0 ? String(Math.round(sig.amount_usd)) : '';
  const round = cleanText(sig.round_info)?.toLowerCase() || '';
  const detail = cleanText(sig.signal_detail)?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 80) || '';
  return [companyId, sig.signal_type, sig.signal_date, amount, round || detail].map((p) => String(p ?? '').trim()).join('|').toLowerCase();
}

function normalizeEmailStatus(status: unknown): EmailStatus {
  const s = String(status ?? '').toLowerCase().trim();
  if (s === 'verified' || s === 'valid' || s === 'ok' || s === 'accepted') return 'verified';
  if (s === 'catch_all' || s === 'catch-all' || s === 'risky') return 'catch_all';
  if (s === 'invalid' || s === 'failed' || s === 'rejected' || s === 'not_found') return 'invalid';
  return 'unknown';
}

async function upsertCompany(
  supabase: SupabaseClient<any>,
  organizationId: string,
  jobId: string,
  sig: NormalizedSignal,
) {
  const companyName = cleanText(sig.company_name);
  if (!companyName) throw new Error('missing_company_name');
  const domain = normalizeDomain(sig.domain);
  const linkedinUrl = normalizeLinkedinUrl(sig.linkedin_url, 'company');

  let query = supabase
    .from('lb_discovered_companies')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1);
  if (linkedinUrl) query = query.eq('linkedin_url', linkedinUrl);
  else if (domain) query = query.eq('domain', domain);
  else query = query.eq('company_name', companyName);

  const { data: found, error: findErr } = await query.maybeSingle();
  if (findErr) throw new Error(`company_lookup_failed: ${findErr.message}`);

  const payload = {
    job_id: jobId,
    organization_id: organizationId,
    company_name: companyName,
    domain,
    website_url: domain ? `https://${domain}` : null,
    linkedin_url: linkedinUrl,
    country: cleanText(sig.country),
    employee_count_estimate: typeof sig.employee_count_estimate === 'number' ? sig.employee_count_estimate : null,
    source: 'public_linkedin_signals',
    raw_html_snippet: `__signal__:${JSON.stringify({ type: sig.signal_type, date: sig.signal_date, detail: sig.signal_detail, evidence_url: sig.evidence_url ?? null })}`,
  };

  if (found?.id) {
    const { data, error } = await supabase
      .from('lb_discovered_companies')
      .update(payload)
      .eq('id', found.id)
      .select('id')
      .single();
    if (error) throw new Error(`company_update_failed: ${error.message}`);
    return data.id as string;
  }

  const { data, error } = await supabase
    .from('lb_discovered_companies')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw new Error(`company_insert_failed: ${error.message}`);
  return data.id as string;
}

async function upsertDecisionMaker(
  supabase: SupabaseClient<any>,
  organizationId: string,
  jobId: string,
  companyId: string,
  dm: DecisionMaker,
) {
  const first = cleanText(dm.first_name);
  const last = cleanText(dm.last_name);
  const title = cleanText(dm.title);
  const linkedinUrl = normalizeLinkedinUrl(dm.linkedin_url, 'person');
  if (!isEligibleDecisionMaker(dm)) return null;

  let found = null as { id: string } | null;
  if (linkedinUrl) {
    const res = await supabase
      .from('lb_decision_makers')
      .select('id')
      .eq('company_id', companyId)
      .eq('linkedin_url', linkedinUrl)
      .maybeSingle();
    if (res.error) throw new Error(`dm_lookup_failed: ${res.error.message}`);
    found = res.data as { id: string } | null;
  } else if (first || last) {
    const res = await supabase
      .from('lb_decision_makers')
      .select('id')
      .eq('company_id', companyId)
      .ilike('first_name', first || 'Unknown')
      .ilike('last_name', last || '')
      .limit(1)
      .maybeSingle();
    if (!res.error) found = res.data as { id: string } | null;
  }

  const payload = {
    company_id: companyId,
    job_id: jobId,
    organization_id: organizationId,
    first_name: first || 'Unknown',
    last_name: last,
    title,
    linkedin_url: linkedinUrl,
    source_page: linkedinUrl,
    claude_reasoning: 'Imported from public LinkedIn signal payload.',
    confidence: 80,
    name_flags: { source: 'public_linkedin_signals_ingest' },
  };

  if (found?.id) {
    const { data, error } = await supabase
      .from('lb_decision_makers')
      .update(payload)
      .eq('id', found.id)
      .select('id')
      .single();
    if (error) throw new Error(`dm_update_failed: ${error.message}`);
    return data.id as string;
  }

  const { data, error } = await supabase
    .from('lb_decision_makers')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw new Error(`dm_insert_failed: ${error.message}`);
  return data.id as string;
}

async function upsertEmailVerification(
  supabase: SupabaseClient<any>,
  organizationId: string,
  jobId: string,
  dmId: string,
  dm: DecisionMaker,
) {
  const email = cleanText(dm.email)?.toLowerCase();
  if (!email) return false;
  const status = normalizeEmailStatus(dm.email_status);
  const { data: existing, error: findErr } = await supabase
    .from('lb_email_verifications')
    .select('id')
    .eq('dm_id', dmId)
    .eq('email', email)
    .maybeSingle();
  if (findErr) throw new Error(`email_lookup_failed: ${findErr.message}`);

  const payload = {
    dm_id: dmId,
    job_id: jobId,
    organization_id: organizationId,
    email,
    pattern: null,
    tier: null,
    status,
    catch_all: status === 'catch_all',
    attempts: 1,
  };

  if (existing?.id) {
    const { error } = await supabase.from('lb_email_verifications').update(payload).eq('id', existing.id);
    if (error) throw new Error(`email_update_failed: ${error.message}`);
    return true;
  }
  const { error } = await supabase.from('lb_email_verifications').insert(payload);
  if (error) throw new Error(`email_insert_failed: ${error.message}`);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!LEGACY_INGEST_ENABLED) {
    return json({
      ok: false,
      error: 'legacy_source_retired',
      message: 'Public signal collection is handled by the Hermes web-scout.',
    }, 410);
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('PUBLIC_LINKEDIN_SIGNALS_INGEST_SECRET');
  const provided = req.headers.get('x-aca-signal-ingest-secret');
  if (!expected || provided !== expected) return json({ ok: false, error: 'unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as IngestRequest;
  const organizationId = body.organization_id || Deno.env.get('PUBLIC_LINKEDIN_SIGNALS_ORG_ID');
  if (!organizationId) return json({ ok: false, error: 'missing_organization_id' }, 400);
  const packKey = body.pack_key || 'public_linkedin_signals';
  const token = body.public_share_token || Deno.env.get('PUBLIC_LINKEDIN_SIGNALS_TOKEN') || crypto.randomUUID().replaceAll('-', '');
  const signals = Array.isArray(body.signals) ? body.signals : [];
  if (!signals.length) return json({ ok: false, error: 'no_signals' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body.dry_run) {
    return json({ ok: true, dry_run: true, candidate_count: signals.length });
  }

  const errors: Array<{ company_name?: string; error: string }> = [];
  let companies = 0;
  let activities = 0;
  let duplicates = 0;
  let dms = 0;
  let emails = 0;
  let quarantinedSignals = 0;
  let decisionMakersSkippedInvalid = 0;
  let publicPeopleUpserted = 0;
  let publicPeopleSkippedNoLinkedin = 0;

  try {
    const sub = await findOrCreatePublicSubscription(supabase, organizationId, packKey, token);
    const jobId = await createJob(supabase, organizationId, packKey, signals.length);

    for (const sig of signals) {
      try {
        const validationError = signalValidationError(sig);
        if (validationError) {
          quarantinedSignals += 1;
          errors.push({ company_name: sig.company_name, error: validationError });
          continue;
        }
        const companyId = await upsertCompany(supabase, organizationId, jobId, sig);
        companies += 1;
        const score = typeof sig.fit_score === 'number' ? Math.max(0, Math.min(100, Math.round(sig.fit_score))) : null;
        const outcome = score == null || score >= 70 ? 'enrolled' : 'review_pending';
        const key = signalDedupeKey(sub.id as string, companyId, sig);
        const clusterKey = eventClusterKey(companyId, sig);
        const { data: activity, error: activityErr } = await supabase
          .from('signal_activity_log')
          .upsert({
            subscription_id: sub.id,
            organization_id: organizationId,
            discovered_company_id: companyId,
            outcome,
            icp_score: score,
            signal_type: cleanText(sig.signal_type),
            signal_detail: cleanText(sig.signal_detail),
            destination_type: 'holding',
            data: {
              signal_dedup_key: key,
              event_cluster_key: clusterKey,
              company_name: sig.company_name,
              domain: normalizeDomain(sig.domain),
              signal_date: sig.signal_date,
              evidence_url: cleanText(sig.evidence_url),
              source_name: cleanText(sig.source_name),
              source_key: cleanText(sig.source_key),
              source_published_at: cleanText(sig.source_published_at) || sig.signal_date,
              amount_usd: typeof sig.amount_usd === 'number' ? sig.amount_usd : null,
              round_info: cleanText(sig.round_info),
              supporting_sources: cleanText(sig.evidence_url) ? [{ url: cleanText(sig.evidence_url), name: cleanText(sig.source_name) || cleanText(sig.source_key) || 'Source' }] : [],
              raw_signal: sig.raw_signal ?? null,
            },
          }, { onConflict: 'subscription_id,signal_dedup_key', ignoreDuplicates: true })
          .select('id');
        if (activityErr) throw new Error(`activity_upsert_failed: ${activityErr.message}`);
        if (activity && activity.length > 0) activities += 1;
        else duplicates += 1;

        for (const dm of sig.decision_makers ?? []) {
          if (!isEligibleDecisionMaker(dm)) {
            decisionMakersSkippedInvalid += 1;
            continue;
          }
          const dmId = await upsertDecisionMaker(supabase, organizationId, jobId, companyId, dm);
          if (!dmId) continue;
          dms += 1;
          if (await upsertEmailVerification(supabase, organizationId, jobId, dmId, dm)) emails += 1;

          // Write to public_signal_people so the export picks this up
          const dmLinkedin = normalizeLinkedinUrl(dm.linkedin_url, 'person');
          if (!dmLinkedin) {
            publicPeopleSkippedNoLinkedin += 1;
            continue;
          }
          const fullName = [dm.first_name, dm.last_name].filter(Boolean).join(' ') || dm.email || 'Unknown';
          const { error: pubErr } = await supabase.from('public_signal_people').upsert({
            company_key: sig.company_name.toLowerCase(),
            company_linkedin_url: sig.linkedin_url?.trim() || null,
            domain: normalizeDomain(sig.domain) || null,
            full_name: fullName,
            title: cleanText(dm.title) || null,
            linkedin_url: dmLinkedin,
            photo_url: null,
            seniority_rank: seniorityRank(dm.title),
            source: 'push',
          }, { onConflict: 'company_key,linkedin_url' });
          if (!pubErr) publicPeopleUpserted += 1;
        }
      } catch (err) {
        errors.push({ company_name: sig.company_name, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await supabase
      .from('pack_subscriptions')
      .update({
        last_refreshed_at: new Date().toISOString(),
        public_published_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    return json({
      ok: errors.length === 0,
      subscription_id: sub.id,
      received: signals.length,
      companies_upserted: companies,
      signals_quarantined: quarantinedSignals,
      signal_rows_inserted: activities,
      duplicate_signals_skipped: duplicates,
      decision_makers_upserted: dms,
      decision_makers_skipped_invalid: decisionMakersSkippedInvalid,
      email_verifications_upserted: emails,
      public_people_upserted: publicPeopleUpserted,
      public_people_skipped_no_linkedin: publicPeopleSkippedNoLinkedin,
      errors,
    }, errors.length ? 207 : 200);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
