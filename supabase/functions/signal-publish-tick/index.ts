/** Publish high-confidence ACA-native events through the existing signal gate. */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  ACA_NATIVE_SOURCE,
  upsertPublicSignal,
  type PublicSignalType,
  type PushSignalInput,
} from '../_shared/public-signals.ts';
import { buildSignalPresentation } from '../_shared/signal-engine/presentation.ts';
import { assessBlockedPublisherEvidence, assessCanonicalNewsEvidence } from '../_shared/signal-engine/news-evidence.ts';
import {
  CANONICAL_NEWS_RETRY_MS,
  CANONICAL_PUBLISHER_VERIFIER_VERSION,
  inVerificationCooldown,
  isBoundNewsEvidence,
  selectPublishEvidence,
  type EvidenceRow,
  type PublishEvidenceObservation,
} from '../_shared/signal-engine/publish-evidence.ts';
import { PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TYPE_MAP: Record<string, PublicSignalType | undefined> = {
  funding: 'funding',
  acquisition: 'acquisition',
  hiring: 'hiring',
  leadership_change: 'executive_hire',
  growth: 'growth',
};

// A deploy starts in shadow mode. Promotion is an explicit operational action
// after ACA/Hermes parity has been reviewed.
const PUBLISH_ENABLED = Deno.env.get('SIGNAL_ENGINE_PUBLISH_ENABLED') === 'true';
const MAX_CANONICAL_NEWS_VERIFICATIONS_PER_RUN = 10;
const SCAN_WINDOW = 600;

interface EventRow {
  id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  confidence: number;
  corroboration_count: number;
  publish_attempts: number;
  observation_ids: string[];
  company_identities: {
    name: string;
    domain: string;
    website_url: string | null;
    linkedin_url: string | null;
    industry: string | null;
    employee_count: number | null;
    country: string | null;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!PUBLISH_ENABLED) {
    return json({ ok: true, shadow_mode: true, published: 0 });
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(200, Number(body.batch_size ?? 50)));
    const { data, error } = await supabase
      .from('signal_events')
      .select('id,event_type,occurred_at,payload,confidence,corroboration_count,publish_attempts,observation_ids,company_identities!inner(name,domain,website_url,linkedin_url,industry,employee_count,country)')
      .is('public_signal_id', null)
      .in('publish_status', ['pending', 'failed'])
      .lt('publish_attempts', 3)
      .not('company_identities.domain', 'is', null)
      // Corroborated / filing-backed events (confidence >= 2) first, then newest.
      // Single-source news events waiting on a publisher URL never change state
      // and used to fill the whole newest-50 window, starving every publishable
      // EDGAR event behind them. Scan deeper than one batch and stop once
      // `batchSize` have actually published.
      .order('confidence', { ascending: false })
      .order('occurred_at', { ascending: false })
      .limit(SCAN_WINDOW);
    if (error) throw new Error(`event query failed: ${error.message}`);
    const events = (data ?? []) as unknown as EventRow[];
    const observations = await loadEvidence(supabase, events);

    let published = 0;
    let skipped = 0;
    let awaitingEvidenceVerification = 0;
    let awaitingCorroboration = 0;
    let canonicalVerificationsRemaining = MAX_CANONICAL_NEWS_VERIFICATIONS_PER_RUN;
    const failures: Array<{ id: string; error: string }> = [];

    for (const event of events) {
      if (published >= batchSize) break;
      const signalType = TYPE_MAP[event.event_type];
      if (!signalType) {
        skipped++;
        await markSkipped(supabase, event.id, `unsupported event type: ${event.event_type}`);
        continue;
      }
      try {
        const company = event.company_identities;
        let evidence = selectPublishEvidence((event.observation_ids ?? []).slice(0, 100)
          .flatMap((id) => observations.get(id) ? [observations.get(id)!] : []));
        // Legacy article checks proved only a name match. Recheck the article
        // against this event's exact company domain before accepting namesakes.
        if (evidence?.collectorKey === 'google_news_rss'
          && !isBoundNewsEvidence(evidence, company.domain)) {
          evidence = { ...evidence, evidenceStatus: 'rss_headline_only' };
        }
        if (
          evidence?.evidenceStatus === 'rss_headline_only'
          && !isGoogleNewsUrl(evidence.source_url)
          && canonicalVerificationsRemaining > 0
          // Cooldown skips cost nothing. Charging them the budget let a handful
          // of publisher-403 events at the front of the queue burn all 10
          // slots every run, so unattempted events behind them never ran.
          && !inVerificationCooldown(evidence)
        ) {
          canonicalVerificationsRemaining--;
          evidence = await verifyGoogleNewsEvidence(supabase, evidence, company.name, company.domain, event.event_type);
        }
        if (!evidence?.source_url || evidence.evidenceStatus === 'rss_headline_only') {
          awaitingEvidenceVerification++;
          continue;
        }
        const canonicalGoogleEvidence = isBoundNewsEvidence(evidence, company.domain);
        if (event.confidence < 2 && !canonicalGoogleEvidence) {
          awaitingCorroboration++;
          continue;
        }
        const presentation = buildSignalPresentation(company.name, event.event_type, event.payload);
        const input: PushSignalInput = {
          company_name: company.name,
          signal_type: signalType,
          signal_date: event.occurred_at,
          title: presentation.title,
          summary: presentation.detail,
          why_it_matters: presentation.whyItMatters,
          amount_label: presentation.amountLabel,
          amount_usd: presentation.amountUsd,
          source_url: evidence.source_url,
          source_label: evidence.sourceLabel,
          source_key: ACA_NATIVE_SOURCE,
          domain: company.domain,
          company_linkedin_url: company.linkedin_url,
          verified: true,
          published: true,
          confidence: Math.min(1, event.confidence / 5),
          quality_score: Math.min(1, 0.75 + event.confidence * 0.05),
          dedup_key: `aca-native:${event.id}`,
          metadata: {
            signal_event_id: event.id,
            corroboration_count: event.corroboration_count,
            observation_ids: event.observation_ids,
            evidence_status: evidence.evidenceStatus ?? null,
            signal_details: presentation.details,
          },
          company: {
            domain: company.domain,
            employee_count: company.employee_count,
            industry: company.industry,
            country: company.country,
            source: ACA_NATIVE_SOURCE,
          },
        };
        const result = await upsertPublicSignal(supabase, input);
        const { error: updateError } = await supabase
          .from('signal_events')
          .update({
            public_signal_id: result.id,
            publish_status: 'published',
            publish_error: null,
            published_to_public_at: new Date().toISOString(),
          })
          .eq('id', event.id);
        if (updateError) throw new Error(updateError.message);
        published++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ id: event.id, error: message });
        await supabase.from('signal_events').update({
          publish_status: 'failed',
          publish_error: message.slice(0, 500),
          publish_attempts: (event.publish_attempts ?? 0) + 1,
        }).eq('id', event.id);
      }
    }

    return json({
      ok: failures.length === 0,
      considered: data?.length ?? 0,
      published,
      skipped,
      awaitingEvidenceVerification,
      awaitingCorroboration,
      failures,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[signal-publish-tick]', message);
    return json({ ok: false, error: message }, 500);
  }
});

async function loadEvidence(supabase: SupabaseClient, events: EventRow[]): Promise<Map<string, PublishEvidenceObservation>> {
  const ids = [...new Set(events.flatMap((event) => (event.observation_ids ?? []).slice(0, 100)))];
  const observations = new Map<string, PublishEvidenceObservation>();
  // One request per event made the 600-row scan exceed the cron HTTP timeout.
  // Load bounded ID pages once, retaining the same per-event evidence limit.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from('signal_observations')
      .select('id,source_url,title,collector_key,structured,signal_sources(label)')
      .in('id', ids.slice(offset, offset + 100));
    if (error) throw new Error(`evidence query failed: ${error.message}`);
    for (const row of (data ?? []) as PublishEvidenceObservation[]) observations.set(row.id, row);
  }
  return observations;
}

async function verifyGoogleNewsEvidence(
  supabase: SupabaseClient,
  evidence: EvidenceRow,
  companyName: string,
  companyDomain: string,
  eventType: string,
): Promise<EvidenceRow> {
  if (evidence.collectorKey !== 'google_news_rss') return evidence;
  const previousAttempt = stringValue(evidence.structured.canonical_verification_attempted_at);
  const previousVerifierVersion = stringValue(evidence.structured.canonical_verification_decoder_version);
  if (
    previousAttempt
    && previousVerifierVersion === CANONICAL_PUBLISHER_VERIFIER_VERSION
    && Date.now() - new Date(previousAttempt).getTime() < CANONICAL_NEWS_RETRY_MS
  ) {
    return evidence;
  }

  const attemptedAt = new Date().toISOString();
  let structured: Record<string, unknown> = {
    ...evidence.structured,
    evidence_status: 'rss_headline_only',
    canonical_verified_company_domain: null,
    canonical_verified_at: null,
    canonical_verification_attempted_at: attemptedAt,
    canonical_verification_decoder_version: CANONICAL_PUBLISHER_VERIFIER_VERSION,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(evidence.source_url, {
      redirect: 'follow',
      headers: { 'User-Agent': `ACA Signal Engine/1.0 (+${PUBLIC_SITE_URL})` },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type');
    const body = (await response.text()).slice(0, 1_000_000);
    const assessment = response.ok
      ? assessCanonicalNewsEvidence({
        finalUrl: response.url,
        contentType,
        body,
        companyName,
        companyDomain,
        eventType,
      })
      // Bot walls answer 403 to every datacenter IP, so a blocked fetch falls
      // back to the RSS headline. It gets its own evidence status so these are
      // auditable apart from articles whose body we actually read.
      : assessBlockedPublisherEvidence({
        finalUrl: response.url,
        httpStatus: response.status,
        headline: evidence.title,
        companyName,
        companyDomain,
        eventType,
      });
    const bodyRead = response.ok;

    structured = {
      ...structured,
      canonical_verification_reason: assessment.reason,
      canonical_verification_url: response.url,
    };
    if (assessment.verified) {
      structured = {
        ...structured,
        evidence_status: bodyRead ? 'canonical_article_verified' : 'publisher_blocked_headline_verified',
        evidence_url: response.url,
        canonical_verified_at: attemptedAt,
        canonical_verified_company_domain: companyDomain,
      };
    }
    const { error: saveError } = await supabase.from('signal_observations').update({
      source_url: assessment.verified ? response.url : evidence.source_url,
      structured,
      updated_at: attemptedAt,
    }).eq('id', evidence.observationId);
    if (saveError) throw new Error(`evidence verification save failed: ${saveError.message}`);
    return assessment.verified
      ? { ...evidence, source_url: response.url, evidenceStatus: String(structured.evidence_status), structured }
      : { ...evidence, evidenceStatus: 'rss_headline_only', structured };
  } catch (error) {
    structured.canonical_verification_reason = error instanceof Error ? error.message.slice(0, 250) : 'canonical_fetch_failed';
    const { error: saveError } = await supabase.from('signal_observations').update({ structured, updated_at: attemptedAt }).eq('id', evidence.observationId);
    if (saveError) throw new Error(`evidence verification save failed: ${saveError.message}`);
    return { ...evidence, evidenceStatus: 'rss_headline_only', structured };
  } finally {
    clearTimeout(timeout);
  }
}

async function markSkipped(supabase: SupabaseClient, id: string, reason: string) {
  await supabase.from('signal_events').update({ publish_status: 'skipped', publish_error: reason }).eq('id', id);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isGoogleNewsUrl(value: string): boolean {
  try {
    return new URL(value).hostname === 'news.google.com';
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
