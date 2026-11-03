import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { logEmailProviderLookup } from '../_shared/enrichment/write-back.ts';
import { DEFAULT_SCORER_MODEL } from '../_shared/default-models.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { QuickenrichAdapter } from '../_shared/enrichment/quickenrich.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

type Policy = {
  id: string;
  organization_id: string;
  lead_list_id: string;
  analyze_icp: boolean;
  icp_product_id: string | null;
  icp_ids: string[];
  min_icp_score: number | null;
  icp_llm_provider: string | null;
  icp_llm_model: string | null;
  // 'if_stale' reuses a company analysis younger than analysis_freshness_days
  // (same product/ICP scope only); 'always' re-analyzes every contact.
  analyze_when: 'always' | 'if_stale';
  analysis_freshness_days: number;
  find_email: boolean;
  find_replacement_email_on_invalid: boolean;
  email_provider: string | null;
  email_provider_chain: string[] | null;
  verify_email: boolean;
  verification_provider: 'lite' | 'apify_million_verifier' | 'mailtester_ninja';
  verification_provider_chain: Array<'lite' | 'apify_million_verifier' | 'mailtester_ninja'> | null;
  // 'always' verifies every email; 'if_stale' trusts an email MoltSets validated
  // within verify_freshness_days (skips the verifier) and verifies only stale /
  // never-validated addresses. Only consulted when verify_email is true.
  verify_when: 'always' | 'if_stale';
  verify_freshness_days: number;
  require_valid_email: boolean;
  sequence_id: string | null;
  approved_destination_type: ApprovedDestinationType;
  approved_destination_id: string | null;
  no_email_list_id: string | null;
  unverified_email_list_id: string | null;
  low_icp_destination_type: DestinationType;
  low_icp_destination_id: string | null;
  no_email_destination_type: DestinationType;
  no_email_destination_id: string | null;
  no_source_data_destination_type: DestinationType;
  no_source_data_destination_id: string | null;
  unverified_email_destination_type: DestinationType;
  unverified_email_destination_id: string | null;
  stage_order: Array<'icp' | 'find_email' | 'verify_email' | 'enroll'> | null;
  // AI message writing. Only honoured when the ready-contact destination is an
  // email sequence: the worker generates a per-contact sequence right before
  // enrolling and passes it through as the enrollment's custom_data.
  write_message: boolean;
  message_prompt: string | null;
  message_llm_model: string | null;
  message_temperature: number | null;
  message_product_id: string | null;
  // One-line AI icebreaker stored on the contact itself (custom_fields), read at
  // send time as {{custom_<icebreaker_field_key>}}. Unlike write_message this is
  // destination-agnostic and fails soft — see writeIcebreaker() for why.
  write_icebreaker: boolean;
  icebreaker_prompt: string | null;
  icebreaker_field_key: string | null;
  icebreaker_llm_model: string | null;
  icebreaker_temperature: number | null;
  // Looks up the contact's company_website via QuickEnrich Company Finder
  // (include_full_text) and writes the result to crm_contacts.home_page_text.
  // 1 QuickEnrich credit per company. Fails soft -- never blocks enrollment.
  fetch_home_page_text: boolean;
};

type GeneratedEmail = { step?: number; subject?: string; body?: string };

type Item = { id: string; policy_id: string; organization_id: string; lead_list_id: string; contact_id: string; attempts: number; stage: string; replacement_attempts: number; force_reprocess: boolean };

// A non-valid email (unknown/invalid/catch_all) is treated as "not found": the
// contact is routed (back) into find_email for a replacement address, then
// re-verified. This caps how many verify<->find cycles a single contact can run
// before it settles as rejected.
const MAX_REPLACEMENT_ATTEMPTS = 3;

// How long a contact parked at verifying_email waits before the worker re-checks
// its (slow, externally paced) MailTester job. Kept well above the 1-minute cron
// so a backlog of awaiting-verification items doesn't re-enter the due-set every
// tick — stage-fair claiming (see claim_lead_list_processing_items) plus this
// interval keep verify work from starving finding_email / queued.
const AWAITING_VERIFICATION_REPARK_MS = 180_000;
type DestinationType = 'none' | 'list' | 'linkedin_campaign';
type ApprovedDestinationType = 'none' | 'email_sequence' | 'linkedin_campaign';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Retries are OPT-IN because not every callee is safe to call twice —
 * enroll-leads in particular would double-enrol. The timeout is not opt-in:
 * an unbounded wait is never right. */
type InvokeOptions = { timeoutMs?: number; retries?: number };

async function invoke(
  url: string,
  serviceKey: string,
  functionName: string,
  body: unknown,
  options: InvokeOptions = {},
) {
  // The platform 504s a callee that hasn't responded in 150s. Give up first, so
  // a wedged callee costs one lane one timeout instead of the caller's whole
  // budget, and so the failure is ours to classify rather than a bare gateway 504.
  const timeoutMs = options.timeoutMs ?? 120_000;
  const retries = options.retries ?? 0;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Jittered: lanes that saturate a callee fail at the same instant, and an
      // unjittered backoff would march them all back in at the same instant too.
      const base = 2 ** (attempt - 1) * 2_000;
      await new Promise((resolve) => setTimeout(resolve, base + Math.random() * base));
    }
    try {
      const result = await fetch(`${url}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok || payload?.success === false) {
        const detail = payload?.error?.message || payload?.error || `${functionName} failed (${result.status})`;
        // Only congestion is worth a second go; an application error repeats.
        if (attempt < retries && [502, 503, 504].includes(result.status)) {
          lastError = new Error(detail);
          continue;
        }
        throw new Error(detail);
      }
      return payload;
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      if (!timedOut) throw error;
      // Worded so classifyProcessingFailure reads it as transient.
      lastError = new Error(`${functionName} timed out after ${timeoutMs}ms`);
      if (attempt >= retries) throw lastError;
    }
  }
  throw lastError ?? new Error(`${functionName} failed`);
}

/** Ceiling on concurrent company analyses per organization. Sized well under the
 * ~50 in-flight calls that collapsed the ICP stage in July, and deliberately
 * decoupled from worker lane/fan-out counts so those stay free to tune. */
const ANALYSIS_CONCURRENCY = 12;

/** 'granted' carries a slotId to release (null when the limiter itself is
 * unavailable and we deliberately proceed uncapped); 'full' means wait. The two
 * must stay distinguishable — a full pool should park the contact, a broken
 * limiter should not. */
type AnalysisSlot = { status: 'granted'; slotId: string | null } | { status: 'full' };

async function acquireAnalysisSlot(supabase: SupabaseClient<any>, organizationId: string, limit: number): Promise<AnalysisSlot> {
  const { data, error } = await supabase.rpc('acquire_analysis_slot', {
    p_organization_id: organizationId,
    p_slot_key: 'analyze_company',
    p_limit: limit,
    p_lease_seconds: 300,
  });
  if (error) {
    // A broken limiter must not become a broken pipeline: proceed uncapped
    // rather than failing every contact. Worst case is July's behaviour, which
    // the timeout and backoff above now bound anyway.
    console.warn('Could not acquire analysis slot, proceeding uncapped:', error.message);
    return { status: 'granted', slotId: null };
  }
  const slotId = data as string | null;
  return slotId ? { status: 'granted', slotId } : { status: 'full' };
}

async function releaseAnalysisSlot(supabase: SupabaseClient<any>, slotId: string): Promise<void> {
  const { error } = await supabase.rpc('release_analysis_slot', { p_slot_id: slotId });
  // Leases expire on their own, so a failed release costs one slot for 5 minutes.
  if (error) console.warn('Could not release analysis slot:', error.message);
}

type EnrichmentInvocation = {
  success?: boolean;
  provider?: string;
  creditsUsed?: number;
  data?: { email?: string };
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: { retryAfterMs?: number; nextAvailableAt?: string };
  };
};

async function invokeEnrichment(
  url: string,
  serviceKey: string,
  body: unknown,
): Promise<EnrichmentInvocation> {
  const result = await fetch(`${url}/functions/v1/enrich-contact`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await result.json().catch(() => ({})) as EnrichmentInvocation;
  if (!result.ok && !payload.error) {
    throw new Error(`enrich-contact failed (${result.status})`);
  }
  return payload;
}

function retryDelay(attempts: number) {
  return new Date(Date.now() + Math.min(30, 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString();
}

function classifyProcessingFailure(detail: string): 'no_source_data' | 'transient' | 'unknown' {
  const normalized = detail.toLowerCase();
  // Transient FIRST: a "couldn't fetch this attempt" failure (crawler down,
  // timeout, upstream/LLM hiccup) must not be permanently binned as no-data.
  // analyze-company now words these explicitly ("transient fetch failure",
  // "did not respond", "transient; retrying") so a passing crawler/LLM outage
  // doesn't discard an analyzable company. Bounded by the attempts>=4 cap below.
  if (
    normalized.includes('transient fetch failure')
    || normalized.includes('did not respond')
    || normalized.includes('transient; retrying')
    || normalized.includes('failed (502)')
    || normalized.includes('failed (503)')
    || normalized.includes('failed (504)')
    || normalized.includes('signal has been aborted')
    // Our own client-side abort (see invoke): a callee that ran past its budget
    // is the same class of problem as a gateway 504, not a verdict on the lead.
    || normalized.includes('timed out after')
  ) return 'transient';
  // Permanent no-source-data: genuinely nothing to analyze (no URL at all, or
  // the endpoint positively reported no retrievable data). NOTE: bare "website
  // unreachable" is intentionally NOT here anymore — it was the mislabel that
  // terminally failed leads on a transient crawler/timeout blip.
  if (
    normalized.includes('no data could be retrieved')
    || normalized.includes('no company website or linkedin url')
    || normalized.includes('no website or linkedin url available')
    // generate-email-sequence refuses a contact with no usable enrichment.
    // Retrying can't conjure it — route the contact like any other no-data one.
    || normalized.includes('company analysis required')
    || normalized.includes('insufficient enrichment data')
  ) return 'no_source_data';
  return 'unknown';
}

class ProcessingCanceledError extends Error {}
class ProcessingPausedError extends Error {}

async function assertProcessingActive(supabase: SupabaseClient<any>, itemId: string) {
  const { data, error } = await supabase
    .from('lead_list_processing_items')
    .select('status, cancel_requested_at, pause_requested_at')
    .eq('id', itemId)
    .single();
  if (error) throw new Error(`Could not read processing state: ${error.message}`);
  if (data.status === 'canceled' || data.cancel_requested_at) throw new ProcessingCanceledError('Processing canceled');
  if (data.pause_requested_at) throw new ProcessingPausedError('Processing paused');
}

async function markProcessingCanceled(supabase: SupabaseClient<any>, itemId: string) {
  const now = new Date().toISOString();
  await supabase.from('lead_list_processing_items').update({
    status: 'canceled',
    stage: 'canceled',
    canceled_at: now,
    completed_at: now,
    last_error: null,
    updated_at: now,
  }).eq('id', itemId);
}

async function markProcessingPaused(supabase: SupabaseClient<any>, item: Item) {
  const now = new Date().toISOString();
  await supabase.from('lead_list_processing_items').update({
    status: 'pending',
    pause_requested_at: null,
    claimed_at: null,
    next_attempt_at: now,
    attempts: Math.max(0, item.attempts - 1),
    last_error: null,
    updated_at: now,
  }).eq('id', item.id);
}

async function startProviderAttempt(
  supabase: SupabaseClient<any>,
  item: Item,
  provider: string,
): Promise<{ id: string; startedAt: number } | null> {
  const startedAt = Date.now();
  const { data, error } = await supabase
    .from('lead_list_processing_provider_attempts')
    .insert({
      organization_id: item.organization_id,
      lead_list_id: item.lead_list_id,
      processing_item_id: item.id,
      contact_id: item.contact_id,
      provider,
      status: 'running',
      started_at: new Date(startedAt).toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    console.warn(`Could not start provider telemetry for ${provider}:`, error);
    return null;
  }
  return { id: data.id, startedAt };
}

async function finishProviderAttempt(
  supabase: SupabaseClient<any>,
  item: Item,
  provider: string,
  attempt: { id: string; startedAt: number } | null,
  result: {
    status: 'found' | 'not_found' | 'skipped' | 'failed';
    creditsUsed?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  if (attempt) {
    const completedAt = Date.now();
    const { error } = await supabase
      .from('lead_list_processing_provider_attempts')
      .update({
        status: result.status,
        credits_used: result.creditsUsed ?? 0,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        completed_at: new Date(completedAt).toISOString(),
        duration_ms: Math.max(0, completedAt - attempt.startedAt),
      })
      .eq('id', attempt.id);
    if (error) console.warn('Could not finish provider telemetry:', error);
  }
  if (result.status === 'found' || result.status === 'not_found') {
    await logEmailProviderLookup(supabase as unknown as SupabaseClient, {
      organizationId: item.organization_id,
      contactId: item.contact_id,
      provider,
      outcome: result.status,
      source: 'workflow',
      leadListId: item.lead_list_id,
    });
  }
}

async function routeToRecoveryList(
  supabase: SupabaseClient<any>,
  item: Item,
  destinationListId: string | null,
  reason: string,
) {
  if (!destinationListId || destinationListId === item.lead_list_id) return;
  const { data: destination } = await supabase
    .from('lead_lists')
    .select('id')
    .eq('id', destinationListId)
    .eq('organization_id', item.organization_id)
    .eq('status', 'active')
    .maybeSingle();
  if (!destination) return;
  const { error } = await supabase.from('lead_list_members').upsert({
    list_id: destinationListId,
    contact_id: item.contact_id,
    source_data: { source: 'lead_processing_recovery', from_list_id: item.lead_list_id, reason },
  }, { onConflict: 'list_id,contact_id' });
  if (error) throw new Error(`Recovery-list routing failed: ${error.message}`);
}

async function routeOutcome(
  supabase: SupabaseClient<any>,
  item: Item,
  destination: { type: DestinationType | null; id: string | null },
  reason: string,
  legacyListId: string | null = null,
) {
  const type = destination.type || (legacyListId ? 'list' : 'none');
  const id = destination.id || legacyListId;
  if (!id || type === 'none') return;

  if (type === 'list') {
    await routeToRecoveryList(supabase, item, id, reason);
    return;
  }

  // Paused campaigns accept leads: campaign-processor only picks up active campaigns,
  // so the progress rows park here and start moving when the campaign resumes.
  const { data: campaign } = await supabase
    .from('linkedin_campaigns')
    .select('id')
    .eq('id', id)
    .eq('organization_id', item.organization_id)
    .in('status', ['active', 'paused'])
    .maybeSingle();
  if (!campaign) return;
  const { error } = await supabase.from('campaign_lead_progress').upsert({
    campaign_id: id,
    contact_id: item.contact_id,
    status: 'pending',
    next_action_at: new Date().toISOString(),
  }, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true });
  if (error) throw new Error(`Campaign routing failed: ${error.message}`);
}

const DEFAULT_ICEBREAKER_FIELD_KEY = 'icebreaker';
const ICEBREAKER_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** Anything longer than this is not a sentence — it is an email that ignored the
 *  brief. Dropped rather than stored, because the value lands mid-sentence in
 *  copy the operator wrote. */
const MAX_ICEBREAKER_CHARS = 240;

/**
 * Turn generate-email-sequence's email body into ONE plain-text sentence.
 *
 * Everything here was seen on real runs against real contacts — the generator is
 * a cold-email writer being asked for a fragment, and it pushes back:
 *  - It returns HTML (`<div>…</div><br>`). Raw tags would render as markup in an
 *    email and as a literal "<div>" in a LinkedIn message.
 *  - It opens with a greeting ("Hey there." / "Hi Pavel,") even when the brief
 *    forbids one. The copy this feeds already has its own greeting.
 *  - On a reasoning model it ignored "one sentence" outright and returned a full
 *    four-paragraph email with a CTA. Hence first-sentence-only plus the length
 *    cap: without them an entire email gets spliced into the middle of a line.
 */
function toIcebreakerLine(body: string): string {
  const text = body
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(div|p)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  // Only a greeting at the very start, and only the greeting word plus a short
  // address ("Hey there," / "Hi John —"): never enough to eat a real sentence.
  const withoutGreeting = text.replace(/^(hi|hey|hello|greetings)\b[^.!?]{0,20}?[.,!;:—–-]\s*/i, '').trim();
  const sentence = firstSentence(withoutGreeting);
  return sentence.length > MAX_ICEBREAKER_CHARS ? '' : sentence;
}

const SENTENCE_ABBREVIATIONS = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|inc|ltd|llc|llp|corp|co|st|vs|etc|approx|dept|est|no|fig)$/i;

/**
 * First sentence of a plain-text string.
 *
 * A naive split on /(?<=[.!?])\s+/ cuts at abbreviations: the real output
 * "…appeals for U.S. service members…" came back as "…appeals for U." — a
 * truncated fragment that would have shipped. So a candidate terminator is
 * rejected when the period belongs to an initialism (a lone letter preceded by
 * a space or another period, covering "U.S." and "e.g.") or to a known
 * abbreviation ("Acme Inc. just opened…").
 */
function firstSentence(text: string): string {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const rest = text.slice(i + 1);
    if (rest !== '' && !/^\s/.test(rest)) continue;
    const before = text.slice(0, i);
    if (ch === '.' && (/(?:^|[\s.])[A-Za-z]$/.test(before) || SENTENCE_ABBREVIATIONS.test(before))) continue;
    return text.slice(0, i + 1).trim();
  }
  return text.trim();
}

/**
 * Generate a one-line icebreaker for this contact and store it on
 * crm_contacts.custom_fields, where the sender picks it up as
 * {{custom_<field_key>}} (workers/sequence-sender/src/index.ts hydrates every
 * custom field onto the lead as custom_<key>).
 *
 * Reuses generate-email-sequence with emailCount 1 rather than adding a second
 * LLM path: its system prompt defers to the creative brief, so a brief asking
 * for one sentence returns one sentence, and we inherit the brief's variable
 * resolver, model/temperature config and AI-tell sanitization. The subject it
 * also returns is discarded.
 *
 * FAILS SOFT, deliberately — the opposite of write_message. write_message owns
 * the WHOLE email, so a failure there must stop the enrollment or blank emails
 * ship. An icebreaker is one line inside copy the user wrote themselves: a miss
 * resolves to '' and the rest of the email is intact, so blocking the enrollment
 * would cost more than the missing line. Returns whether it wrote anything.
 */
async function writeIcebreaker(
  supabase: SupabaseClient<any>,
  url: string,
  serviceKey: string,
  item: Item,
  config: Policy,
): Promise<boolean> {
  const fieldKey = (config.icebreaker_field_key || DEFAULT_ICEBREAKER_FIELD_KEY).trim();
  if (!ICEBREAKER_FIELD_KEY_PATTERN.test(fieldKey)) {
    console.warn(`[lead-processing] Skipping icebreaker for item ${item.id}: invalid field key "${fieldKey}"`);
    return false;
  }

  let line = '';
  try {
    const generation = await invoke(url, serviceKey, 'generate-email-sequence', {
      contactId: item.contact_id,
      emailCount: 1,
      config: {
        prompt: config.icebreaker_prompt || '',
        ...(config.message_product_id ? { productId: config.message_product_id } : {}),
      },
      // NOT the workspace default. That is x-ai/grok-4.20, a reasoning model:
      // measured at ~3 minutes for a single generation, past both invoke()'s
      // budget and the platform's 150s gateway ceiling, so every icebreaker
      // would time out. One sentence is lightweight classification-grade work —
      // use the fast model unless the operator picked one.
      model: config.icebreaker_llm_model || DEFAULT_SCORER_MODEL,
      ...(config.icebreaker_temperature !== null && config.icebreaker_temperature !== undefined
        ? { temperature: Number(config.icebreaker_temperature) }
        : {}),
    }, { timeoutMs: 140_000 }) as { emails?: GeneratedEmail[] };
    line = toIcebreakerLine(generation.emails?.[0]?.body || '');
  } catch (error) {
    console.warn(`[lead-processing] Icebreaker generation failed for item ${item.id} (continuing): ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  if (!line) {
    console.warn(`[lead-processing] Icebreaker generation returned nothing for item ${item.id} (continuing)`);
    return false;
  }

  // Read-modify-write the single contact row. Never a bulk UPDATE on
  // crm_contacts — that fires one outbound webhook per row.
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('custom_fields')
    .eq('id', item.contact_id)
    .eq('organization_id', item.organization_id)
    .maybeSingle();
  if (!contact) {
    console.warn(`[lead-processing] Contact ${item.contact_id} not found when storing icebreaker`);
    return false;
  }

  const merged = { ...((contact.custom_fields as Record<string, unknown>) || {}), [fieldKey]: line };
  const { error: writeError } = await supabase
    .from('crm_contacts')
    .update({ custom_fields: merged })
    .eq('id', item.contact_id)
    .eq('organization_id', item.organization_id);
  if (writeError) {
    console.warn(`[lead-processing] Could not store icebreaker for item ${item.id} (continuing): ${writeError.message}`);
    return false;
  }

  // Register the field def so {{custom_<key>}} shows up in the variable pickers
  // and so the org-level placeholder default applies when a contact has no value.
  // ignoreDuplicates: an existing def is the user's, not ours to overwrite.
  await supabase.from('crm_custom_field_defs').upsert({
    organization_id: item.organization_id,
    field_key: fieldKey,
    display_name: 'Icebreaker',
    field_type: 'text',
    description: 'One-line AI icebreaker written by lead processing.',
  }, { onConflict: 'organization_id,field_key', ignoreDuplicates: true });

  return true;
}

/**
 * Look up the contact's company home page text via QuickEnrich's Company
 * Finder API (include_full_text) and store it on crm_contacts.home_page_text
 * -- a real column, unlike the icebreaker's dynamic custom field, so no
 * crm_custom_field_defs bookkeeping is needed here.
 *
 * FAILS SOFT, same rationale as writeIcebreaker(): this is one enrichment
 * field, not the whole message, so a miss (no API key, no match, API error)
 * should never block enrollment. Costs 1 QuickEnrich credit per company
 * returned. Returns whether it wrote anything.
 */
async function fetchHomePageText(
  supabase: SupabaseClient<any>,
  item: Item,
  contact: { company_website?: string | null },
): Promise<boolean> {
  if (!contact.company_website) {
    return false;
  }

  const { data: apiKeyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted, is_valid')
    .eq('organization_id', item.organization_id)
    .eq('provider', 'quickenrich')
    .maybeSingle();

  if (!apiKeyRow || !(apiKeyRow as any).is_valid) {
    console.warn(`[lead-processing] Skipping home page text for item ${item.id}: QuickEnrich not configured`);
    return false;
  }

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.warn(`[lead-processing] Skipping home page text for item ${item.id}: ENCRYPTION_KEY not set`);
    return false;
  }

  let homePageText = '';
  try {
    const apiKey = await decryptApiKey((apiKeyRow as any).key_encrypted, encryptionKey);
    const result = await QuickenrichAdapter.companyFinder(apiKey, {
      company_url: contact.company_website,
      include_full_text: true,
      per_page: 1,
    });
    const first = Array.isArray(result.data) ? result.data[0] : result.data;
    homePageText = first?.home_page_text || '';
  } catch (error) {
    console.warn(`[lead-processing] QuickEnrich company-finder failed for item ${item.id} (continuing): ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  if (!homePageText) {
    return false;
  }

  const { error: writeError } = await supabase
    .from('crm_contacts')
    .update({ home_page_text: homePageText, home_page_text_fetched_at: new Date().toISOString() })
    .eq('id', item.contact_id)
    .eq('organization_id', item.organization_id);
  if (writeError) {
    console.warn(`[lead-processing] Could not store home page text for item ${item.id} (continuing): ${writeError.message}`);
    return false;
  }

  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!url || !serviceKey) return response({ error: 'Server not configured' }, 500);

  const body = await req.json().catch(() => ({})) as { listId?: string; limit?: number; fanout?: number };
  const suppliedCronSecret = req.headers.get('x-cron-secret');
  const isCron = !!cronSecret && suppliedCronSecret === cronSecret;
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const isService = token === serviceKey;
  const supabase = createClient(url, serviceKey);
  const linkedinAccountByOrganization = new Map<string, string | null>();
  const analysisConcurrencyByOrganization = new Map<string, number>();

  // organization_settings.analysis_concurrency_limit lets one org's cap be
  // raised above the platform default without touching it for everyone else
  // (see 20260903130000_org_analysis_concurrency_override.sql).
  const getAnalysisConcurrencyLimit = async (organizationId: string): Promise<number> => {
    if (analysisConcurrencyByOrganization.has(organizationId)) {
      return analysisConcurrencyByOrganization.get(organizationId)!;
    }
    const { data } = await supabase
      .from('organization_settings')
      .select('analysis_concurrency_limit')
      .eq('organization_id', organizationId)
      .maybeSingle();
    const limit = data?.analysis_concurrency_limit ?? ANALYSIS_CONCURRENCY;
    analysisConcurrencyByOrganization.set(organizationId, limit);
    return limit;
  };

  const getLinkedinAccountId = async (organizationId: string) => {
    if (linkedinAccountByOrganization.has(organizationId)) {
      return linkedinAccountByOrganization.get(organizationId) ?? null;
    }

    const { data, error } = await supabase
      .from('unipile_accounts')
      .select('unipile_account_id')
      .eq('organization_id', organizationId)
      .eq('provider', 'LINKEDIN')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(`Could not resolve a LinkedIn account for ${organizationId}:`, error);
    }
    const accountId = data?.unipile_account_id || null;
    linkedinAccountByOrganization.set(organizationId, accountId);
    return accountId;
  };

  if (!isCron && !isService) {
    if (!token || !body.listId) return response({ error: 'Unauthorized' }, 401);
    const { data: userResult } = await supabase.auth.getUser(token);
    const { data: list } = await supabase.from('lead_lists').select('organization_id').eq('id', body.listId).maybeSingle();
    if (!userResult?.user || !list) return response({ error: 'Unauthorized' }, 401);
    const { data: membership } = await supabase.from('organization_members')
      .select('organization_id').eq('organization_id', list.organization_id).eq('user_id', userResult.user.id).maybeSingle();
    if (!membership) return response({ error: 'Forbidden' }, 403);
  }

  if (body.fanout) {
    const fanout = Math.min(Math.max(Number(body.fanout) || 1, 1), 10);
    const batchLimit = Math.min(Math.max(Number(body.limit) || 10, 1), 10);
    const dispatch = Promise.allSettled(Array.from({ length: fanout }, () => fetch(
      `${url}/functions/v1/process-lead-list-processing`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ listId: body.listId, limit: batchLimit }),
      },
    ))).then((results) => {
      const rejected = results.filter((result) => result.status === 'rejected').length;
      if (rejected) console.warn(`${rejected} lead-processing worker dispatches failed`);
    });

    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime) edgeRuntime.waitUntil(dispatch);
    else await dispatch;
    return response({ dispatched: fanout, limit: batchLimit });
  }

  const { data: items, error: claimError } = await supabase.rpc('claim_lead_list_processing_items', {
    p_limit: Math.min(Math.max(Number(body.limit) || 10, 1), 25),
    p_list_id: body.listId || null,
  });
  if (claimError) return response({ error: claimError.message }, 500);

  const processItem = async (item: Item): Promise<{ itemId: string; status: string; detail?: string }> => {
    try {
      await assertProcessingActive(supabase, item.id);
      const { data: policy, error: policyError } = await supabase.from('lead_list_processing_policies').select('*').eq('id', item.policy_id).single();
      if (policyError || !policy) throw new Error('Processing policy was removed');
      const config = policy as Policy;
      const { data: contact, error: contactError } = await supabase
        .from('crm_contacts')
        .select('id, primary_email, company_website, primary_linkedin_url, enrichment_data, email_verification_status, email_last_validated_at')
        .eq('id', item.contact_id).eq('organization_id', item.organization_id).single();
      if (contactError || !contact) throw new Error('Contact was removed');

      let email = contact.primary_email;
      let emailValid = contact.email_verification_status === 'valid';
      let verificationRan = false;
      let replacementEmailFound = item.stage === 'replacement_email_found';
      let replacementAttempts = item.replacement_attempts ?? 0;
      // A list reset must exercise every configured stage again. The raw CRM
      // contact is deliberately shared across lists, so it is not deleted just
      // to make this one list's workflow start over.
      const forceReprocess = item.force_reprocess === true;
      // Persisted signal (survives across passes, unlike verificationRan): the
      // contact has an email that a prior verify pass marked non-valid. Drives
      // the order-independent "re-search on non-valid" behavior.
      const persistedNonValid = !!email
        && contact.email_verification_status != null
        && contact.email_verification_status !== 'valid';
      const approvedDestinationType = config.approved_destination_type || (config.sequence_id ? 'email_sequence' : 'none');
      const approvedDestinationId = config.approved_destination_id || config.sequence_id;
      // An email-only lookup has no qualification gate to fail. A provider miss
      // is a completed search result, not a rejection: the contact simply has
      // no email to write back or route.
      const isEmailLookupOnly = config.find_email
        && !config.analyze_icp
        && !config.verify_email;
      const stageOrder = config.stage_order?.length === 4
        ? config.stage_order
        : ['icp', 'find_email', 'verify_email', 'enroll'] as const;
      // The funnel is "designed to verify found emails" only when verify_email
      // runs AFTER find_email. Otherwise a provider-sourced email is trusted and
      // enrolled without (re-)verification.
      const verifyRunsAfterFind = config.verify_email
        && stageOrder.indexOf('verify_email') > stageOrder.indexOf('find_email');
      const resumeStage = ({
        analyzing_icp: 'icp',
        finding_email: 'find_email',
        verifying_email: 'verify_email',
        replacement_email_found: 'enroll',
        writing_message: 'enroll',
        enrolling: 'enroll',
      } as Record<string, typeof stageOrder[number] | undefined>)[item.stage];
      let reachedResumeStage = !resumeStage;
      for (const stage of stageOrder) {
        if (!reachedResumeStage) {
          if (stage !== resumeStage) continue;
          reachedResumeStage = true;
        }
        await assertProcessingActive(supabase, item.id);
        if (replacementEmailFound && stage !== 'enroll') continue;
        if (stage === 'icp' && config.analyze_icp) {
          await supabase.from('lead_list_processing_items').update({ stage: 'analyzing_icp', updated_at: new Date().toISOString() }).eq('id', item.id);
          const unipileAccountId = await getLinkedinAccountId(item.organization_id);
          // 'if_stale' reuses a stored analysis instead of re-crawling the site
          // and re-running the LLM. analyze-company only honours it when that
          // analysis was scoped to this policy's product + ICPs, so the score
          // read below always belongs to this configuration.
          // Take a slot BEFORE calling: this is the only thing standing between a
          // big list run and the congestion collapse of 2026-07-16. Parking on a
          // full pool is what applies backpressure — the contact keeps its place
          // and comes back, rather than piling onto a saturated callee.
          const analysisLimit = await getAnalysisConcurrencyLimit(item.organization_id);
          const slot = await acquireAnalysisSlot(supabase, item.organization_id, analysisLimit);
          if (slot.status === 'full') throw new Error('Analysis capacity is fully scheduled');
          let analysis: { skipped?: boolean };
          try {
            analysis = await invoke(url, serviceKey, 'analyze-company', {
              contactId: item.contact_id,
              companyWebsite: contact.company_website || undefined,
              linkedinUrl: contact.primary_linkedin_url || undefined,
              unipileAccountId: unipileAccountId || undefined,
              productId: config.icp_product_id || undefined,
              icpIds: config.icp_ids.length ? config.icp_ids : undefined,
              model: config.icp_llm_model || undefined,
              ...(!forceReprocess && config.analyze_when === 'if_stale'
                ? { skipIfAnalyzedWithinDays: config.analysis_freshness_days > 0 ? config.analysis_freshness_days : 30 }
                : {}),
            }, { retries: 1 }) as { skipped?: boolean };
          } finally {
            // Must run on the failure path too, or a run of errors drains the
            // pool and starves every later contact behind a 5-minute lease.
            if (slot.slotId) await releaseAnalysisSlot(supabase, slot.slotId);
          }
          await supabase.from('lead_list_processing_items')
            .update({ analysis_reused: analysis?.skipped === true, updated_at: new Date().toISOString() })
            .eq('id', item.id);
          await assertProcessingActive(supabase, item.id);
          const { data: analyzed } = await supabase.from('crm_contacts').select('enrichment_data').eq('id', item.contact_id).single();
          const score = Number((analyzed?.enrichment_data as Record<string, unknown> | null)?.icp_score);
          if (config.min_icp_score !== null && (!Number.isFinite(score) || score < config.min_icp_score)) {
            await routeOutcome(supabase, item, { type: config.low_icp_destination_type, id: config.low_icp_destination_id }, 'icp_rejected');
            await supabase.from('lead_list_processing_items').update({ status: 'rejected', stage: 'rejected', rejected_reason: `ICP score ${Number.isFinite(score) ? score : 'unavailable'} is below ${config.min_icp_score}`, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', item.id);
            return { itemId: item.id, status: 'rejected', detail: 'ICP gate' };
          }
        }

        // Replacement search fires when the current email is non-valid — either
        // verify just failed this pass (verificationRan) or a prior pass left a
        // non-valid status (persistedNonValid). Bounded by MAX_REPLACEMENT_ATTEMPTS.
        const wantsReplacement = config.find_replacement_email_on_invalid
          && !!email && !emailValid
          && (verificationRan || persistedNonValid)
          && replacementAttempts < MAX_REPLACEMENT_ATTEMPTS;
        if (stage === 'find_email' && config.find_email && (forceReprocess || !email || wantsReplacement)) {
          await supabase.from('lead_list_processing_items').update({ stage: 'finding_email', updated_at: new Date().toISOString() }).eq('id', item.id);
          const providers = config.email_provider_chain?.length ? config.email_provider_chain : config.email_provider ? [config.email_provider] : [];
          const replacingInvalidEmail = wantsReplacement;
          const previousEmail = email;
          let sawDefinitiveMiss = false;
          let lastOperationalError: { code?: string; message: string; retryAfterMs?: number } | null = null;
          for (const provider of providers) {
            const attempt = await startProviderAttempt(supabase, item, provider);
            let attemptFinished = false;
            try {
              const enrichment = await invokeEnrichment(url, serviceKey, {
                contactId: item.contact_id,
                enrichmentTypes: ['email'],
                preferredProviders: [provider],
                strictPreferredProviders: true,
                applyToContact: true,
                leadListId: item.lead_list_id,
                // Wait for the slot the scheduler reserves for us rather than
                // demanding an instant one. At 0 every item whose slot was even
                // one tick away bounced as RATE_LIMITED and requeued, so a batch
                // landed ~1 real lookup and re-collided next tick (~9% of plan
                // rate, plus a flood of skipped attempt rows). A granted
                // reservation holds its slot, so sleeping through it is what
                // actually fills the plan allowance. Keep the ceiling under the
                // claim lease so a waiter can never outlive its own lease.
                maxProviderWaitMs: 60_000,
              });
              const discoveredEmail = enrichment.data?.email?.trim() || null;
              const usableEmail = discoveredEmail && (
                !replacingInvalidEmail || discoveredEmail.toLowerCase() !== previousEmail!.toLowerCase()
              ) ? discoveredEmail : null;

              if (replacingInvalidEmail && usableEmail) {
                const { error: replaceError } = await supabase.from('crm_contacts').update({
                  primary_email: usableEmail,
                  email_verification_status: null,
                  email_verified_at: null,
                  updated_at: new Date().toISOString(),
                }).eq('id', item.contact_id).eq('organization_id', item.organization_id);
                if (replaceError) throw new Error(`Could not replace invalid email: ${replaceError.message}`);
                email = usableEmail;
                emailValid = false;
                replacementAttempts += 1;
                // Whether this replacement is trusted (enroll as-is) or re-verified
                // is decided below based on the funnel's stage order.
              }

              const errorCode = enrichment.error?.code;
              const errorMessage = enrichment.error?.message
                || (discoveredEmail && !usableEmail ? 'Provider returned the same invalid email' : null);
              // 'skipped' = provider never ran a real lookup (excluded from
              // find-rate). QUOTA_EXCEEDED/RATE_LIMITED are transient (retry);
              // INVALID_INPUT is permanent (missing input, e.g. no /in/ URL) —
              // both burn 0 credits. error_code lets the metrics RPC tell the two
              // apart. Only found/not_found reflect an executed provider lookup.
              const outcome = usableEmail
                ? 'found'
                : errorCode === 'QUOTA_EXCEEDED' || errorCode === 'INVALID_INPUT' || errorCode === 'RATE_LIMITED'
                  ? 'skipped'
                  : !errorCode || errorCode === 'NOT_FOUND'
                    ? 'not_found'
                    : 'failed';
              await finishProviderAttempt(supabase, item, provider, attempt, {
                status: outcome,
                creditsUsed: enrichment.creditsUsed,
                errorCode,
                errorMessage,
              });
              attemptFinished = true;
              await assertProcessingActive(supabase, item.id);

              if (outcome === 'not_found' || errorCode === 'INVALID_INPUT') {
                sawDefinitiveMiss = true;
              } else if (outcome === 'failed' || errorCode === 'QUOTA_EXCEEDED' || errorCode === 'RATE_LIMITED') {
                lastOperationalError = {
                  code: errorCode,
                  message: errorMessage || `${provider} could not complete enrichment`,
                  retryAfterMs: enrichment.error?.details?.retryAfterMs,
                };
              }

              if (usableEmail) {
                email = usableEmail;
                break;
              }
            }
            catch (error) {
              if (!attemptFinished) {
                await finishProviderAttempt(supabase, item, provider, attempt, {
                  status: 'failed',
                  errorCode: 'WORKER_ERROR',
                  errorMessage: error instanceof Error ? error.message : 'Unknown provider error',
                });
              }
              if (error instanceof ProcessingCanceledError || error instanceof ProcessingPausedError) throw error;
              lastOperationalError = {
                code: 'WORKER_ERROR',
                message: error instanceof Error ? error.message : 'Unknown provider error',
              };
              console.warn(`Email provider ${provider} failed for ${item.contact_id}:`, error);
            }
            const { data: enriched } = await supabase.from('crm_contacts').select('primary_email').eq('id', item.contact_id).single();
            email = enriched?.primary_email || null;
            if (email && (!replacingInvalidEmail || email.toLowerCase() !== previousEmail!.toLowerCase())) break;
          }
          await assertProcessingActive(supabase, item.id);
          if (!email || (replacingInvalidEmail && email.toLowerCase() === previousEmail!.toLowerCase())) {
            if (!sawDefinitiveMiss && lastOperationalError?.code === 'QUOTA_EXCEEDED') {
              const nextQuotaWindow = new Date();
              nextQuotaWindow.setUTCDate(nextQuotaWindow.getUTCDate() + 1);
              nextQuotaWindow.setUTCHours(0, 5, 0, 0);
              await supabase.from('lead_list_processing_items').update({
                status: 'pending',
                stage: 'finding_email',
                next_attempt_at: nextQuotaWindow.toISOString(),
                attempts: Math.max(0, item.attempts - 1),
                last_error: lastOperationalError.message,
                updated_at: new Date().toISOString(),
              }).eq('id', item.id);
              return { itemId: item.id, status: 'pending', detail: 'waiting for provider daily quota' };
            }
            if (!sawDefinitiveMiss && lastOperationalError?.code === 'RATE_LIMITED') {
              const retryAfterMs = Math.max(1_000, lastOperationalError.retryAfterMs ?? 15_000);
              await supabase.from('lead_list_processing_items').update({
                status: 'pending',
                stage: 'finding_email',
                next_attempt_at: new Date(Date.now() + retryAfterMs).toISOString(),
                attempts: Math.max(0, item.attempts - 1),
                last_error: lastOperationalError.message,
                updated_at: new Date().toISOString(),
              }).eq('id', item.id);
              return { itemId: item.id, status: 'pending', detail: 'waiting for provider rate capacity' };
            }
            if (!sawDefinitiveMiss && lastOperationalError) {
              throw new Error(lastOperationalError.message);
            }
            await routeOutcome(supabase, item, { type: config.no_email_destination_type, id: config.no_email_destination_id }, 'no_email_found', config.no_email_list_id);
            if (isEmailLookupOnly) {
              await supabase.from('lead_list_processing_items').update({ status: 'completed', stage: 'completed', completed_at: new Date().toISOString(), rejected_reason: null, last_error: null, updated_at: new Date().toISOString() }).eq('id', item.id);
              return { itemId: item.id, status: 'completed', detail: 'no email found' };
            }
            await supabase.from('lead_list_processing_items').update({ status: 'rejected', stage: 'rejected', rejected_reason: 'No email found after configured providers', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', item.id);
            return { itemId: item.id, status: 'rejected', detail: 'no email found' };
          }
          // Past the no-email guard: find_email produced a usable address (first
          // pass or replacement). Provider data is trusted and enrolled as-is —
          // marked replacement_email_found so the enroll gate accepts it and the
          // marker survives retries — UNLESS the funnel is designed to verify it
          // (verify_email after find_email), in which case the loop falls through
          // to verify_email to (re-)verify the address.
          if (!verifyRunsAfterFind) {
            replacementEmailFound = true;
            await supabase.from('lead_list_processing_items').update({ stage: 'replacement_email_found', replacement_attempts: replacementAttempts, updated_at: new Date().toISOString() }).eq('id', item.id);
          } else if (replacingInvalidEmail && email.toLowerCase() !== previousEmail!.toLowerCase()) {
            replacementEmailFound = false;
            await supabase.from('lead_list_processing_items').update({ replacement_attempts: replacementAttempts, updated_at: new Date().toISOString() }).eq('id', item.id);
          }
        }

        if (stage === 'verify_email' && config.verify_email && email) {
          // Conditional verification: when the policy is 'if_stale', trust an
          // address MoltSets already validated within verify_freshness_days and
          // skip the verifier entirely. Re-read from crm_contacts because a
          // fresh find_email pass may have written a newer email + validation
          // date than the row snapshot taken at claim time. A null
          // last_validated_at is treated as stale (MoltSets often returns null).
          if (!forceReprocess && config.verify_when === 'if_stale') {
            const { data: freshRow } = await supabase
              .from('crm_contacts')
              .select('email_verification_status, email_last_validated_at')
              .eq('id', item.contact_id)
              .single();
            const alreadyValid = freshRow?.email_verification_status === 'valid';
            const validatedAtMs = freshRow?.email_last_validated_at ? Date.parse(freshRow.email_last_validated_at) : NaN;
            const freshnessDays = config.verify_freshness_days > 0 ? config.verify_freshness_days : 30;
            const isFresh = Number.isFinite(validatedAtMs)
              && (Date.now() - validatedAtMs) <= freshnessDays * 86_400_000;
            if (alreadyValid || isFresh) {
              // Trust it as-is (same enroll semantics as a provider-found email):
              // mark replacement_email_found so the enroll gate accepts it without
              // asserting a deliverability check we never ran.
              emailValid = alreadyValid;
              replacementEmailFound = true;
              await supabase.from('lead_list_processing_items').update({ stage: 'replacement_email_found', updated_at: new Date().toISOString() }).eq('id', item.id);
              continue;
            }
          }
          await supabase.from('lead_list_processing_items').update({ stage: 'verifying_email', updated_at: new Date().toISOString() }).eq('id', item.id);
          const providers = config.verification_provider_chain?.length ? config.verification_provider_chain : [config.verification_provider || 'lite'];
          for (let index = 0; index < providers.length; index += 1) {
            if (providers[index] === 'mailtester_ninja') {
              const { data: mailtesterResult } = await supabase
                .from('email_address_verifications')
                .select('status')
                .eq('organization_id', item.organization_id)
                .eq('email_lower', email.toLowerCase().trim())
                .eq('provider', 'mailtester_ninja')
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();
              if (mailtesterResult) {
                if (mailtesterResult.status === 'valid') break;
                continue;
              }

              const normalizedEmail = email.toLowerCase().trim();
              const { data: activeMailtesterJob } = await supabase
                .from('mailtester_verification_jobs')
                .select('id')
                .eq('organization_id', item.organization_id)
                .in('status', ['queued', 'running'])
                .contains('pending_emails', [normalizedEmail])
                .limit(1)
                .maybeSingle();
              if (activeMailtesterJob) {
                await supabase.from('mailtester_job_lists').upsert({
                  job_id: activeMailtesterJob.id,
                  list_id: item.lead_list_id,
                  emails_contributed: 0,
                }, { onConflict: 'job_id,list_id', ignoreDuplicates: true });
                await supabase.from('lead_list_processing_items').update({
                  status: 'pending',
                  stage: 'verifying_email',
                  next_attempt_at: new Date(Date.now() + AWAITING_VERIFICATION_REPARK_MS).toISOString(),
                  updated_at: new Date().toISOString(),
                }).eq('id', item.id);
                return { itemId: item.id, status: 'pending', detail: 'awaiting MailTester Ninja' };
              }

              await invoke(url, serviceKey, 'mailtester-verify-kickoff', {
                organization_id: item.organization_id,
                contact_ids: [item.contact_id],
                list_id: item.lead_list_id,
              });
              await assertProcessingActive(supabase, item.id);
              await supabase.from('lead_list_processing_items').update({
                status: 'pending',
                stage: 'verifying_email',
                next_attempt_at: new Date(Date.now() + AWAITING_VERIFICATION_REPARK_MS).toISOString(),
                updated_at: new Date().toISOString(),
              }).eq('id', item.id);
              return { itemId: item.id, status: 'pending', detail: 'awaiting MailTester Ninja' };
            }
            await invoke(url, serviceKey, 'infra-list-verify-batch', { organization_id: item.organization_id, contact_ids: [item.contact_id], provider: providers[index], force_refresh: forceReprocess || index > 0 });
            await assertProcessingActive(supabase, item.id);
            const { data: verified } = await supabase.from('crm_contacts').select('email_verification_status').eq('id', item.contact_id).single();
            if (verified?.email_verification_status === 'valid') break;
          }
          const { data: verification } = await supabase.from('crm_contacts').select('email_verification_status').eq('id', item.contact_id).single();
          await assertProcessingActive(supabase, item.id);
          emailValid = verification?.email_verification_status === 'valid';
          verificationRan = true;

          // Non-valid (unknown/invalid/catch_all) is treated as "not found": if
          // the funnel has an email-search step and replacement is enabled, route
          // (back) to find_email for a replacement address instead of falling
          // through to the enroll gate. Order-independent — works whether find
          // runs before or after verify. Bounded by MAX_REPLACEMENT_ATTEMPTS.
          if (!emailValid
            && config.find_email
            && config.find_replacement_email_on_invalid
            && replacementAttempts < MAX_REPLACEMENT_ATTEMPTS) {
            await supabase.from('lead_list_processing_items').update({
              stage: 'finding_email',
              status: 'pending',
              next_attempt_at: new Date(Date.now() + 5_000).toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', item.id);
            return { itemId: item.id, status: 'pending', detail: `email ${verification?.email_verification_status ?? 'non-valid'} — searching replacement` };
          }
        }

        if (stage === 'enroll') {
          // A retry that resumes at writing_message already cleared this gate on
          // its first pass. Re-running it would reject a provider-sourced email
          // whose "trusted" marker (stage = replacement_email_found) the stage
          // column no longer carries.
          const emailGateCleared = item.stage === 'writing_message';
          if (config.require_valid_email && !emailGateCleared && approvedDestinationType !== 'linkedin_campaign') {
            const { data: verified } = await supabase.from('crm_contacts').select('primary_email, email_verification_status').eq('id', item.contact_id).single();
            await assertProcessingActive(supabase, item.id);
            if (!verified?.primary_email || (verified.email_verification_status !== 'valid' && !replacementEmailFound)) {
              await routeOutcome(supabase, item, { type: config.unverified_email_destination_type, id: config.unverified_email_destination_id }, verified?.primary_email ? `email_${verified.email_verification_status || 'unknown'}` : 'no_email_for_verification', config.unverified_email_list_id);
              await supabase.from('lead_list_processing_items').update({ status: 'rejected', stage: 'rejected', rejected_reason: verified?.primary_email ? `Email status is ${verified.email_verification_status || 'unknown'}` : 'No email found', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', item.id);
              return { itemId: item.id, status: 'rejected', detail: 'email gate' };
            }
          }
          // Write the one-line icebreaker into the contact's custom fields.
          // Runs for EVERY destination (email sequence, LinkedIn campaign, none):
          // it lives on the contact, so it is reusable by any copy that references
          // {{custom_<key>}}, not just the destination this run happens to route to.
          // Reuses the writing_message stage label — the stage column has a CHECK
          // allowlist and a new value would buy nothing the operator can see.
          if (config.write_icebreaker && config.icebreaker_prompt?.trim()) {
            await supabase.from('lead_list_processing_items').update({ stage: 'writing_message', updated_at: new Date().toISOString() }).eq('id', item.id);
            await assertProcessingActive(supabase, item.id);
            await writeIcebreaker(supabase, url, serviceKey, item, config);
            await assertProcessingActive(supabase, item.id);
          }

          // Look up the contact's company home page text via QuickEnrich.
          // Same rationale as the icebreaker: lives on the contact, not tied
          // to a destination, and fails soft.
          if (config.fetch_home_page_text) {
            await fetchHomePageText(supabase, item, contact);
            await assertProcessingActive(supabase, item.id);
          }

          // Write the emails with AI, one sequence per contact. Fails closed:
          // invoke() throws on a bad generation, so the item retries and can end
          // up failed/rejected — but it never enrols. A destination sequence
          // built on {{email_subject_N}} would otherwise send blank emails.
          let enrollmentCustomData: Record<string, string> | null = null;
          if (config.write_message && approvedDestinationType === 'email_sequence' && approvedDestinationId) {
            await supabase.from('lead_list_processing_items').update({ stage: 'writing_message', updated_at: new Date().toISOString() }).eq('id', item.id);
            await assertProcessingActive(supabase, item.id);

            const { data: destinationSequence } = await supabase
              .from('email_sequences')
              .select('steps')
              .eq('id', approvedDestinationId)
              .eq('organization_id', item.organization_id)
              .maybeSingle();
            // The count comes from the destination itself so every
            // {{email_subject_N}} the sequence references gets a value.
            const emailSteps = Array.isArray(destinationSequence?.steps)
              ? (destinationSequence!.steps as Array<{ type?: string }>).filter((step) => step?.type === 'email').length
              : 0;
            const emailCount = Math.min(7, Math.max(1, emailSteps));

            const generation = await invoke(url, serviceKey, 'generate-email-sequence', {
              contactId: item.contact_id,
              emailCount,
              config: {
                prompt: config.message_prompt || '',
                ...(config.message_product_id ? { productId: config.message_product_id } : {}),
              },
              ...(config.message_llm_model ? { model: config.message_llm_model } : {}),
              ...(config.message_temperature !== null && config.message_temperature !== undefined
                ? { temperature: Number(config.message_temperature) }
                : {}),
            }) as { emails?: GeneratedEmail[] };

            const customData: Record<string, string> = {};
            for (const [index, email] of (generation.emails ?? []).entries()) {
              const position = index + 1;
              if (email?.subject) customData[`custom_email_${position}_subject`] = email.subject;
              if (email?.body) customData[`custom_email_${position}_body`] = email.body;
            }
            if (!customData.custom_email_1_subject || !customData.custom_email_1_body) {
              throw new Error('AI returned no usable email content for this contact');
            }
            enrollmentCustomData = customData;
            await assertProcessingActive(supabase, item.id);
          }

          if (approvedDestinationType === 'email_sequence' && approvedDestinationId) {
            await supabase.from('lead_list_processing_items').update({ stage: 'enrolling', updated_at: new Date().toISOString() }).eq('id', item.id);
            await assertProcessingActive(supabase, item.id);
            await invoke(url, serviceKey, 'enroll-leads', {
              sequenceId: approvedDestinationId,
              organizationId: item.organization_id,
              contactIds: [item.contact_id],
              ...(enrollmentCustomData ? { customDataByContactId: { [item.contact_id]: enrollmentCustomData } } : {}),
            });
          }
          if (approvedDestinationType === 'linkedin_campaign' && approvedDestinationId) {
            await supabase.from('lead_list_processing_items').update({ stage: 'enrolling', updated_at: new Date().toISOString() }).eq('id', item.id);
            await assertProcessingActive(supabase, item.id);
            await routeOutcome(supabase, item, { type: 'linkedin_campaign', id: approvedDestinationId }, 'approved_for_linkedin_campaign');
          }
        }
      }
      await assertProcessingActive(supabase, item.id);
      const { data: completed, error: completionError } = await supabase.from('lead_list_processing_items')
        .update({ status: 'completed', stage: 'completed', completed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .is('cancel_requested_at', null)
        .select('id')
        .maybeSingle();
      if (completionError) throw completionError;
      if (!completed) {
        await markProcessingCanceled(supabase, item.id);
        return { itemId: item.id, status: 'canceled' };
      }
      return { itemId: item.id, status: 'completed' };
    } catch (error) {
      const { data: state } = await supabase.from('lead_list_processing_items')
        .select('cancel_requested_at, pause_requested_at, stage')
        .eq('id', item.id)
        .maybeSingle();
      if (error instanceof ProcessingPausedError || state?.pause_requested_at) {
        await markProcessingPaused(supabase, item);
        return { itemId: item.id, status: 'paused' };
      }
      if (error instanceof ProcessingCanceledError || state?.cancel_requested_at) {
        await markProcessingCanceled(supabase, item.id);
        return { itemId: item.id, status: 'canceled' };
      }
      const detail = error instanceof Error ? error.message : 'Unknown processing error';
      if (detail.startsWith('OpenRouter key blocked:')) {
        await supabase.from('lead_list_processing_items').update({
          status: 'pending',
          stage: state?.stage && state.stage !== 'failed' ? state.stage : item.stage,
          attempts: Math.max(0, item.attempts - 1),
          next_attempt_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          last_error: detail,
          updated_at: new Date().toISOString(),
        }).eq('id', item.id);
        return { itemId: item.id, status: 'pending', detail: 'waiting for OpenRouter key recovery' };
      }
      // Systemic scraper-infrastructure outage (crawl4ai down): park and retry
      // WITHOUT burning the attempt budget (the claim RPC already +1'd attempts,
      // so decrementing nets zero), exactly like the OpenRouter-key-blocked path.
      // This is what makes a prolonged crawler outage unable to exhaust retries
      // and mass-fail an entire list as "no source data".
      // Backpressure, not failure: the contact lost a race for an analysis slot.
      // Come back in a minute (slots turn over in seconds) without spending an
      // attempt, so queueing behind a busy pool can never exhaust the budget and
      // mass-fail a list the way July's retry storm did.
      if (detail.includes('Analysis capacity is fully scheduled')) {
        await supabase.from('lead_list_processing_items').update({
          status: 'pending',
          stage: state?.stage && state.stage !== 'failed' ? state.stage : item.stage,
          attempts: Math.max(0, item.attempts - 1),
          next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
          last_error: detail,
          updated_at: new Date().toISOString(),
        }).eq('id', item.id);
        return { itemId: item.id, status: 'pending', detail: 'waiting for analysis capacity' };
      }
      if (detail.includes('Scraper infrastructure temporarily unavailable') || detail.includes('Data service unavailable')) {
        await supabase.from('lead_list_processing_items').update({
          status: 'pending',
          stage: state?.stage && state.stage !== 'failed' ? state.stage : item.stage,
          attempts: Math.max(0, item.attempts - 1),
          next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          last_error: detail,
          updated_at: new Date().toISOString(),
        }).eq('id', item.id);
        return { itemId: item.id, status: 'pending', detail: 'waiting for scraper infrastructure recovery' };
      }
      const failureCategory = classifyProcessingFailure(detail);
      const terminal = failureCategory === 'no_source_data' || item.attempts >= 4;
      const retryStage = state?.stage && state.stage !== 'failed' ? state.stage : item.stage;
      if (failureCategory === 'no_source_data') {
        const { data: recoveryPolicy } = await supabase
          .from('lead_list_processing_policies')
          .select('no_source_data_destination_type, no_source_data_destination_id')
          .eq('id', item.policy_id)
          .maybeSingle();
        await routeOutcome(
          supabase,
          item,
          {
            type: (recoveryPolicy?.no_source_data_destination_type as DestinationType | null | undefined) ?? 'none',
            id: recoveryPolicy?.no_source_data_destination_id ?? null,
          },
          'no_source_data',
          null,
        );
      }
      await supabase.from('lead_list_processing_items').update({
        status: terminal ? 'failed' : 'retry',
        stage: terminal ? 'failed' : retryStage,
        failure_category: terminal ? failureCategory : null,
        last_error: detail,
        next_attempt_at: retryDelay(item.attempts),
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      return { itemId: item.id, status: terminal ? 'failed' : 'retry', detail };
    }
  };

  const queue = (items ?? []) as Item[];
  if (!queue.length) return response({ processed: 0, results: [] });

  // Two independent platform limits bound a worker (supabase.com/docs/guides/functions/limits):
  //   request idle timeout 150s — the caller gets a 504 if we haven't responded
  //   wall clock          400s — the isolate is killed outright
  // Draining the batch before responding put us against the 150s one: a batch of
  // 10 at 5 lanes is two rounds, and at the observed p50 of ~73s/item that lands
  // at ~146s — a knife-edge we intermittently lost, killing the isolate mid-item
  // and stranding those rows in 'processing' until the 15-minute lease reaper.
  //
  // So respond as soon as the batch is claimed and drain it under waitUntil,
  // which the fan-out branch above already does. That leaves the full 400s wall
  // clock for the work instead of 150s, and LANES only has to fit the batch into
  // that budget rather than into a response deadline.
  const LANES = 10;
  const results: Array<{ itemId: string; status: string; detail?: string }> = [];
  let nextIndex = 0;
  const drain = Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    while (nextIndex < queue.length) {
      const item = queue[nextIndex++];
      results.push(await processItem(item));
    }
  })).catch((error) => {
    // processItem is self-contained (it catches and records its own failures), so
    // reaching here means the bookkeeping itself broke. The lease reaper reclaims
    // whatever was left mid-flight; just make sure it isn't an unhandled rejection.
    console.error('lead-processing drain failed:', error);
  });

  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime) {
    edgeRuntime.waitUntil(drain);
    return response({ claimed: queue.length, mode: 'background' });
  }
  await drain;
  return response({ processed: results.length, results });
});
