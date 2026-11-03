// ============================================================================
// email-domain-health-probe
// ----------------------------------------------------------------------------
// Keeps email_sending_domains.health_status honest without waiting for a
// campaign to burn.
//
// The reputation block that motivated this is invisible from inside the estate:
// Microsoft accepts our SMTP handoff with a 250, and only the RECEIVER (Gmail,
// in the 2026-08-03 case) refuses it — "the very low reputation of the sending
// domain ... the message has been blocked". So the only way to ask "is this
// domain still deliverable?" is to actually send one message to a real outside
// mailbox and read what the receiver said back.
//
// Two phases, because the M365 message trace lags the send by 5-30 minutes and
// no single invocation can span that:
//
//   phase=send  — for every domain whose next_probe_at is due, pick one mailbox,
//                 send one benign message to each configured seed address, and
//                 record a pending row in email_domain_probes.
//   phase=read  — for pending probes old enough to have a trace, run
//                 Get-MessageTraceV2 + Get-MessageTraceDetailV2, classify the
//                 verbatim remote response with the same _shared/m365-trace
//                 logic the delivery reconciler uses, and hand the outcome to
//                 apply_domain_probe_outcome().
//
// Cadence is per domain, held in next_probe_at: 7 days for a domain in service,
// 14 days for burned/recovering ones (the point of probing a domain we are not
// sending from is to notice when it comes back).
//
// The state machine itself is deliberately NOT here — it lives in
// apply_domain_probe_outcome() so this job and email-delivery-reconcile cannot
// drift apart on what "burned" means.
//
// Auth: deploy --no-verify-jwt. Accepts x-cron-secret, a service-role bearer, or
// a user JWT (the last requires organization_id in the body + membership).
//
// Body (all optional):
//   { phase: 'send'|'read'|'both', organization_id, domain_ids[], dry_run,
//     min_age_minutes, force }
// ============================================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getEXOToken, exoInvokeCommand, sendEmailViaGraph } from '../_shared/m365-client.ts';
import { sendEmailViaSMTP, extractSMTPCredentials } from '../_shared/smtp-client.ts';
import {
  classifyDeliveryFailure,
  normalizeTraceStatus,
  pickFailureEvent,
  traceStatusToOutcome,
  type TraceDetailEvent,
  type TraceRow,
} from '../_shared/m365-trace.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Trace data lags the send; younger probes simply aren't there yet. */
const DEFAULT_MIN_AGE_MINUTES = 20;
/** Give up on a probe that never appears in the trace rather than polling forever. */
const MAX_TRACE_ATTEMPTS = 6;
/** Probes older than this are abandoned outright — trace retention is ~10 days. */
const PROBE_EXPIRY_HOURS = 48;
/** Edge functions die at a 150s idle timeout. Return cleanly well before it. */
const RUN_DEADLINE_MS = 110_000;
/** Bound the blast radius of one run; leftovers are picked up next cycle. */
const MAX_DOMAINS_PER_RUN = 40;
const MAX_PROBES_PER_READ = 200;

// A probe must look like ordinary mail. Anything that reads as a monitoring
// beacon risks being filtered differently from real campaign traffic, which
// would make the measurement worthless.
const PROBE_SUBJECTS = [
  'Quick question',
  'Following up',
  'Checking in',
  'One thing',
];

interface DomainRow {
  id: string;
  organization_id: string;
  domain: string;
  health_status: string | null;
  rest_until: string | null;
  next_probe_at: string | null;
}

interface MailboxRow {
  id: string;
  email_address: string;
  display_name: string | null;
  organization_id: string;
  connection_type: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
}

interface SeedRow {
  email: string;
  provider: string | null;
}

interface RunTotals {
  domains_due: number;
  domains_probed: number;
  probes_sent: number;
  probes_send_failed: number;
  probes_read: number;
  probes_resolved: number;
  probes_pending: number;
  probes_expired: number;
  domains_burned: number;
  domains_recovered: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const startedAt = Date.now();
  const deadline = startedAt + RUN_DEADLINE_MS;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: {
    phase?: 'send' | 'read' | 'both';
    organization_id?: string;
    domain_ids?: string[];
    dry_run?: boolean;
    min_age_minutes?: number;
    force?: boolean;
  } = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty body is the cron case */ }

  const auth = await authorize(req, supabase, body.organization_id);
  if (!auth.ok) return jsonResponse({ success: false, error: auth.error }, auth.status);

  const phase = body.phase ?? 'both';
  const dryRun = body.dry_run === true;
  const minAgeMinutes = clampNumber(body.min_age_minutes, DEFAULT_MIN_AGE_MINUTES, 0, 24 * 60);

  const totals: RunTotals = {
    domains_due: 0, domains_probed: 0, probes_sent: 0, probes_send_failed: 0,
    probes_read: 0, probes_resolved: 0, probes_pending: 0, probes_expired: 0,
    domains_burned: 0, domains_recovered: 0,
  };
  const errors: Array<Record<string, unknown>> = [];

  try {
    if (phase === 'send' || phase === 'both') {
      await runSendPhase({ supabase, body, dryRun, deadline, totals, errors });
    }
    if (phase === 'read' || phase === 'both') {
      await runReadPhase({ supabase, body, dryRun, minAgeMinutes, deadline, totals, errors });
    }
  } catch (err) {
    errors.push({ scope: 'run', error: errText(err) });
  }

  console.log(
    `[DomainProbe] phase=${phase} ${JSON.stringify(totals)} errors=${errors.length} ` +
    `elapsed=${Math.round((Date.now() - startedAt) / 1000)}s dry_run=${dryRun}`,
  );

  return jsonResponse({ success: true, phase, dry_run: dryRun, ...totals, errors });
});

// ============================================================================
// Phase A — send
// ============================================================================

async function runSendPhase(ctx: {
  supabase: SupabaseClient;
  body: { organization_id?: string; domain_ids?: string[]; force?: boolean };
  dryRun: boolean;
  deadline: number;
  totals: RunTotals;
  errors: Array<Record<string, unknown>>;
}): Promise<void> {
  const { supabase, body, dryRun, deadline, totals, errors } = ctx;
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('email_sending_domains')
    .select('id, organization_id, domain, health_status, rest_until, next_probe_at')
    .order('next_probe_at', { ascending: true, nullsFirst: true })
    .limit(MAX_DOMAINS_PER_RUN);

  if (body.organization_id) query = query.eq('organization_id', body.organization_id);
  if (body.domain_ids?.length) query = query.in('id', body.domain_ids);
  // `force` re-probes regardless of cadence — used when investigating by hand.
  if (!body.force && !body.domain_ids?.length) {
    query = query.or(`next_probe_at.is.null,next_probe_at.lte.${nowIso}`);
  }

  const { data: domains, error: domErr } = await query;
  if (domErr) throw new Error(`domain lookup: ${domErr.message}`);
  if (!domains?.length) return;

  totals.domains_due = domains.length;

  // Seeds are org-scoped; fetch once per org rather than per domain.
  const orgIds = [...new Set(domains.map((d) => d.organization_id as string))];
  const { data: seedRows } = await supabase
    .from('email_domain_probe_seeds')
    .select('organization_id, email, provider')
    .in('organization_id', orgIds)
    .eq('active', true);

  const seedsByOrg = new Map<string, SeedRow[]>();
  for (const s of seedRows ?? []) {
    const bucket = seedsByOrg.get(s.organization_id as string) ?? [];
    bucket.push({ email: s.email as string, provider: (s.provider as string) ?? null });
    seedsByOrg.set(s.organization_id as string, bucket);
  }

  // Platform seeds (organization_id NULL) cover every org without its own. Only
  // one org ever configured seeds, so until 2026-09-28 every other org's domains
  // were never probed — and a burned domain that is never probed never recovers.
  const { data: platformSeedRows } = await supabase
    .from('email_domain_probe_seeds')
    .select('email, provider')
    .is('organization_id', null)
    .eq('active', true);
  const platformSeeds: SeedRow[] = (platformSeedRows ?? []).map((s) => ({
    email: s.email as string,
    provider: (s.provider as string) ?? null,
  }));
  for (const orgId of orgIds) {
    if (!seedsByOrg.get(orgId)?.length && platformSeeds.length) {
      seedsByOrg.set(orgId, platformSeeds);
    }
  }

  // An org with domains but no seeds cannot be probed. Say so loudly — silently
  // doing nothing is how "self-driving" quietly becomes "not running".
  for (const orgId of orgIds) {
    if (!seedsByOrg.get(orgId)?.length) {
      errors.push({
        scope: 'seeds',
        organization_id: orgId,
        error: 'no active rows in email_domain_probe_seeds — domains in this org cannot be probed',
      });
    }
  }

  // Tenant map for Graph sends, resolved once.
  const tenantByAdmin = await loadTenantMap(supabase, orgIds);

  for (const domain of domains as DomainRow[]) {
    if (Date.now() > deadline) break;

    const seeds = seedsByOrg.get(domain.organization_id) ?? [];
    if (!seeds.length) continue;

    const mailbox = await pickProbeMailbox(supabase, domain.id);
    if (!mailbox) {
      errors.push({ scope: 'probe', domain: domain.domain, error: 'no mailbox on domain to probe from' });
      continue;
    }

    totals.domains_probed++;

    for (const seed of seeds) {
      if (Date.now() > deadline) break;

      const token = `p${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      // The token rides in the subject because Graph 202-Accepts WITHOUT
      // returning a Message-Id (same constraint email-warmup-send-tick works
      // around), so subject+sender is the only correlation handle we get.
      const subject = `${PROBE_SUBJECTS[Math.floor(Math.random() * PROBE_SUBJECTS.length)]} [${token}]`;

      if (dryRun) {
        totals.probes_sent++;
        continue;
      }

      const { data: probe, error: insErr } = await supabase
        .from('email_domain_probes')
        .insert({
          organization_id: domain.organization_id,
          domain_id: domain.id,
          mailbox_id: mailbox.id,
          seed_email: seed.email,
          seed_provider: seed.provider,
          probe_token: token,
          subject,
        })
        .select('id')
        .single();

      if (insErr || !probe) {
        errors.push({ scope: 'probe', domain: domain.domain, error: insErr?.message ?? 'insert failed' });
        continue;
      }

      const result = await deliverProbe(mailbox, seed.email, subject, token, tenantByAdmin);

      if (result.success) {
        totals.probes_sent++;
        await supabase
          .from('email_domain_probes')
          .update({ sent_at: new Date().toISOString(), transport: result.transport })
          .eq('id', probe.id);
        continue;
      }

      totals.probes_send_failed++;

      // A BYO/SMTP domain relays straight to the recipient MX, so a reputation
      // rejection comes back inside the SMTP conversation rather than in a trace
      // we have to go read. Classify it here and act on it immediately — waiting
      // for a trace that will never exist would strand the signal.
      const cls = classifyDeliveryFailure(result.error);
      const outcome = cls.isReputationBlock ? 'failed_550' : 'send_failed';

      await supabase
        .from('email_domain_probes')
        .update({
          transport: result.transport,
          send_error: (result.error ?? '').slice(0, 2000),
          outcome,
          checked_at: new Date().toISOString(),
        })
        .eq('id', probe.id);

      if (outcome === 'failed_550') {
        await applyOutcome(supabase, domain, 'failed_550', cls.diagnostic, totals, errors);
      } else {
        // No health signal, but the cadence still has to advance or this domain
        // is retried on every single run.
        await touchProbeSchedule(supabase, domain.id, 'send_failed');
      }
    }
  }
}

/**
 * Pick the mailbox a probe is sent from.
 *
 * Deliberately does NOT require status='ready': the mailboxes on a burned domain
 * are all parked (that is the whole point of the guard trigger), and refusing to
 * probe them would mean a burned domain could never be observed recovering.
 * Prefers a ready one when the domain is in service so the probe traverses the
 * same path real mail does.
 */
async function pickProbeMailbox(supabase: SupabaseClient, domainId: string): Promise<MailboxRow | null> {
  const { data } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, display_name, organization_id, connection_type, status, metadata')
    .eq('sending_domain_id', domainId)
    .in('status', ['ready', 'paused'])
    // DESC so 'ready' sorts ahead of 'paused'. This matters because of the
    // limit: a 100-mailbox domain with a handful of ready mailboxes would, under
    // ascending order, return 25 paused rows and never show us a usable one — so
    // a healthy domain would be probed from a parked mailbox.
    .order('status', { ascending: false })
    .limit(25);

  const rows = (data ?? []) as MailboxRow[];
  if (!rows.length) return null;

  return rows.find((m) => m.status === 'ready') ?? rows[0];
}

interface DeliverResult {
  success: boolean;
  transport: 'graph' | 'smtp';
  error?: string;
}

/**
 * Same routing the live sender and the warmup engine use: Graph for M365
 * (no per-mailbox password, immune to the credential drift that breaks SMTP on
 * this estate), SMTP for everything else. A probe that took a different path
 * than production mail would not be measuring production deliverability.
 */
async function deliverProbe(
  mailbox: MailboxRow,
  toEmail: string,
  subject: string,
  token: string,
  tenantByAdmin: Map<string, string>,
): Promise<DeliverResult> {
  const meta = mailbox.metadata ?? {};
  const adminEmail = meta.m365_admin_email as string | undefined;
  const senderUserId = (meta.m365_user_id as string | undefined) || mailbox.email_address;
  const tenantId = adminEmail ? tenantByAdmin.get(`${mailbox.organization_id}:${adminEmail}`) : undefined;

  const firstName = mailbox.display_name?.split(' ')[0] || mailbox.email_address.split('@')[0];
  const text = [
    'Hi,',
    '',
    'Wanted to check this reached you — no action needed on your end.',
    '',
    'Thanks,',
    firstName,
    '',
    `ref: ${token}`,
  ].join('\n');

  if (tenantId) {
    const graph = await sendEmailViaGraph({
      tenantId,
      senderUserId,
      toEmail,
      subject,
      html: text.replace(/\n/g, '<br>'),
      saveToSentItems: true,
    });
    return graph.success
      ? { success: true, transport: 'graph' }
      : { success: false, transport: 'graph', error: graph.error };
  }

  try {
    const creds = await extractSMTPCredentials(meta);
    if (!creds) return { success: false, transport: 'smtp', error: 'no usable SMTP credentials' };

    const res = await sendEmailViaSMTP({
      credentials: creds,
      from_name: mailbox.display_name || mailbox.email_address.split('@')[0],
      from_email: mailbox.email_address,
      to_email: toEmail,
      subject,
      text,
    });
    return res.success
      ? { success: true, transport: 'smtp' }
      : { success: false, transport: 'smtp', error: res.error };
  } catch (e) {
    return { success: false, transport: 'smtp', error: errText(e) };
  }
}

// ============================================================================
// Phase B — read
// ============================================================================

async function runReadPhase(ctx: {
  supabase: SupabaseClient;
  body: { organization_id?: string; domain_ids?: string[] };
  dryRun: boolean;
  minAgeMinutes: number;
  deadline: number;
  totals: RunTotals;
  errors: Array<Record<string, unknown>>;
}): Promise<void> {
  const { supabase, body, dryRun, minAgeMinutes, deadline, totals, errors } = ctx;

  const now = Date.now();
  const cutoff = new Date(now - minAgeMinutes * 60_000).toISOString();
  const expiry = new Date(now - PROBE_EXPIRY_HOURS * 3600_000).toISOString();

  let query = supabase
    .from('email_domain_probes')
    .select('id, organization_id, domain_id, mailbox_id, seed_email, probe_token, subject, sent_at, trace_attempts')
    .eq('outcome', 'pending')
    .not('sent_at', 'is', null)
    .lte('sent_at', cutoff)
    .order('sent_at', { ascending: true })
    .limit(MAX_PROBES_PER_READ);

  if (body.organization_id) query = query.eq('organization_id', body.organization_id);
  if (body.domain_ids?.length) query = query.in('domain_id', body.domain_ids);

  const { data: probes, error: probeErr } = await query;
  if (probeErr) throw new Error(`probe lookup: ${probeErr.message}`);
  if (!probes?.length) return;

  totals.probes_read = probes.length;

  // Resolve the mailboxes and their tenants once.
  const mailboxIds = [...new Set(probes.map((p) => p.mailbox_id).filter(Boolean) as string[])];
  const { data: mailboxes } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, organization_id, metadata')
    .in('id', mailboxIds);

  const mailboxById = new Map<string, MailboxRow>(
    ((mailboxes ?? []) as MailboxRow[]).map((m) => [m.id, m]),
  );

  const orgIds = [...new Set(probes.map((p) => p.organization_id as string))];
  const tenantByAdmin = await loadTenantMap(supabase, orgIds);

  const { data: domainRows } = await supabase
    .from('email_sending_domains')
    .select('id, organization_id, domain, health_status, rest_until, next_probe_at')
    .in('id', [...new Set(probes.map((p) => p.domain_id as string))]);

  const domainById = new Map<string, DomainRow>(
    ((domainRows ?? []) as DomainRow[]).map((d) => [d.id, d]),
  );

  for (const probe of probes) {
    if (Date.now() > deadline) break;

    const domain = domainById.get(probe.domain_id as string);
    const mailbox = probe.mailbox_id ? mailboxById.get(probe.mailbox_id as string) : null;

    // Too old to ever resolve — stop carrying it.
    if ((probe.sent_at as string) < expiry) {
      totals.probes_expired++;
      if (!dryRun) {
        await supabase
          .from('email_domain_probes')
          .update({ outcome: 'no_trace', checked_at: new Date().toISOString() })
          .eq('id', probe.id);
        if (domain) await touchProbeSchedule(supabase, domain.id, 'no_trace');
      }
      continue;
    }

    if (!mailbox || !domain) {
      totals.probes_pending++;
      continue;
    }

    const adminEmail = (mailbox.metadata ?? {}).m365_admin_email as string | undefined;
    const tenantId = adminEmail ? tenantByAdmin.get(`${mailbox.organization_id}:${adminEmail}`) : undefined;

    if (!tenantId) {
      // Non-M365 (BYO SMTP): there is no trace to read. The send-time SMTP
      // response was the whole signal, and a clean handoff there means the
      // receiving MX accepted it — record that rather than leaving it pending
      // forever.
      totals.probes_resolved++;
      if (!dryRun) {
        await supabase
          .from('email_domain_probes')
          .update({ outcome: 'delivered', checked_at: new Date().toISOString(), trace_status: 'SmtpAccepted' })
          .eq('id', probe.id);
        await applyOutcome(supabase, domain, 'delivered', 'SMTP handoff accepted by recipient MX', totals, errors);
      }
      continue;
    }

    try {
      const resolved = await resolveProbeFromTrace({
        tenantId,
        senderAddress: mailbox.email_address,
        recipient: probe.seed_email as string,
        token: probe.probe_token as string,
        sentAt: probe.sent_at as string,
        supabase,
      });

      if (resolved.kind === 'pending') {
        const attempts = (probe.trace_attempts as number) + 1;
        totals.probes_pending++;
        if (!dryRun) {
          if (attempts >= MAX_TRACE_ATTEMPTS) {
            await supabase
              .from('email_domain_probes')
              .update({ outcome: 'no_trace', trace_attempts: attempts, checked_at: new Date().toISOString() })
              .eq('id', probe.id);
            await touchProbeSchedule(supabase, domain.id, 'no_trace');
          } else {
            await supabase
              .from('email_domain_probes')
              .update({ trace_attempts: attempts, checked_at: new Date().toISOString() })
              .eq('id', probe.id);
          }
        }
        continue;
      }

      totals.probes_resolved++;
      if (dryRun) continue;

      await supabase
        .from('email_domain_probes')
        .update({
          outcome: resolved.outcome,
          trace_status: resolved.traceStatus,
          trace_detail: (resolved.diagnostic ?? '').slice(0, 2000),
          trace_attempts: (probe.trace_attempts as number) + 1,
          checked_at: new Date().toISOString(),
        })
        .eq('id', probe.id);

      await applyOutcome(supabase, domain, resolved.outcome, resolved.diagnostic, totals, errors);
    } catch (err) {
      errors.push({ scope: 'trace', domain: domain.domain, error: errText(err) });
    }
  }
}

interface ResolvedProbe {
  kind: 'resolved' | 'pending';
  outcome: 'delivered' | 'failed_550' | 'spam' | 'no_trace';
  traceStatus: string;
  diagnostic: string | null;
}

/**
 * Find this probe in the M365 trace and turn it into an outcome.
 *
 * Matched on subject rather than Message-Id: Graph does not hand one back, so
 * the token embedded in the subject is the only durable correlation key.
 */
async function resolveProbeFromTrace(args: {
  tenantId: string;
  senderAddress: string;
  recipient: string;
  token: string;
  sentAt: string;
  supabase: SupabaseClient;
}): Promise<ResolvedProbe> {
  const { tenantId, senderAddress, recipient, token, sentAt, supabase } = args;

  const { data: tenant } = await supabase
    .from('m365_tenants')
    .select('onmicrosoft_domain')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const onmicrosoft = (tenant?.onmicrosoft_domain as string) ?? '';
  const token4 = await getEXOToken(tenantId);

  const sent = Date.parse(sentAt);
  const start = new Date(sent - 15 * 60_000).toISOString();
  const end = new Date(sent + 6 * 3600_000).toISOString();

  const params: Record<string, unknown> = {
    SenderAddress: senderAddress,
    RecipientAddress: recipient,
    StartDate: start,
    EndDate: end,
  };

  let raw: any;
  let cmdlet = 'Get-MessageTraceV2';
  try {
    raw = await exoInvokeCommand(token4, tenantId, onmicrosoft, cmdlet, params);
  } catch {
    cmdlet = 'Get-MessageTrace';
    raw = await exoInvokeCommand(token4, tenantId, onmicrosoft, cmdlet, params);
  }

  const rows: TraceRow[] = Array.isArray(raw?.value) ? raw.value : raw?.value ? [raw.value] : [];
  const match = rows.find((r) => (r.Subject ?? '').includes(token));
  if (!match) return { kind: 'pending', outcome: 'no_trace', traceStatus: 'NotFound', diagnostic: null };

  const traceStatus = normalizeTraceStatus(match.Status);
  const outcome = traceStatusToOutcome(traceStatus);

  if (outcome.kind === 'pending') {
    return { kind: 'pending', outcome: 'no_trace', traceStatus, diagnostic: null };
  }

  if (outcome.kind === 'delivered') {
    return { kind: 'resolved', outcome: 'delivered', traceStatus, diagnostic: null };
  }

  if (outcome.kind === 'spam') {
    return { kind: 'resolved', outcome: 'spam', traceStatus, diagnostic: 'filtered as spam / quarantined' };
  }

  // Failed: go get the remote server's verbatim words. Without the detail we
  // cannot tell a reputation block from a dead seed address, and burning a
  // domain over a typo'd seed would be worse than not probing at all.
  let events: TraceDetailEvent[] = [];
  if (match.MessageTraceId) {
    try {
      const d = await exoInvokeCommand(
        token4, tenantId, onmicrosoft,
        cmdlet === 'Get-MessageTraceV2' ? 'Get-MessageTraceDetailV2' : 'Get-MessageTraceDetail',
        { MessageTraceId: match.MessageTraceId, RecipientAddress: match.RecipientAddress ?? recipient },
      );
      events = Array.isArray(d?.value) ? d.value : d?.value ? [d.value] : [];
    } catch { /* fall through to an unclassifiable failure */ }
  }

  const failEvent = pickFailureEvent(events);
  const cls = classifyDeliveryFailure(failEvent?.Detail as string | undefined);

  return {
    kind: 'resolved',
    // Only a genuine reputation refusal burns the domain. A hard bounce means
    // the seed address is wrong; that is an operator problem, not a domain one.
    outcome: cls.isReputationBlock ? 'failed_550' : 'no_trace',
    traceStatus,
    // When Exchange attaches no remote reply to the Fail event, keep the whole
    // timeline: the reason is often on an earlier Defer / Send-external hop, and
    // "The message was not delivered." alone is unrecoverable evidence.
    diagnostic: cls.diagnostic || summarizeEvents(events) || null,
  };
}

/** Compact one-line dump of every trace event, so a failure never loses its evidence. */
function summarizeEvents(events: TraceDetailEvent[]): string {
  if (!events.length) return 'no trace events returned';
  return events
    .map((e) => `${e.Event ?? '?'}${e.Action ? `/${e.Action}` : ''}: ${String(e.Detail ?? '').slice(0, 300)}`)
    .join(' | ')
    .slice(0, 1900);
}

// ============================================================================
// Shared helpers
// ============================================================================

async function applyOutcome(
  supabase: SupabaseClient,
  domain: DomainRow,
  outcome: string,
  reason: string | null,
  totals: RunTotals,
  errors: Array<Record<string, unknown>>,
): Promise<void> {
  const { data, error } = await supabase.rpc('apply_domain_probe_outcome', {
    p_domain_id: domain.id,
    p_outcome: outcome,
    p_reason: reason,
    p_source: 'probe',
  });

  if (error) {
    errors.push({ scope: 'apply', domain: domain.domain, error: error.message });
    return;
  }

  const next = data as string | null;
  if (next === 'burned' && domain.health_status !== 'burned') {
    totals.domains_burned++;
    console.error(`[DomainProbe] BURNED ${domain.domain}: ${reason ?? outcome}`);
  }
  if (next === 'healthy' && domain.health_status === 'recovering') {
    totals.domains_recovered++;
    console.log(`[DomainProbe] RECOVERED ${domain.domain}`);
  }
}

/** Advance the cadence without asserting anything about health. */
async function touchProbeSchedule(supabase: SupabaseClient, domainId: string, result: string): Promise<void> {
  await supabase.rpc('apply_domain_probe_outcome', {
    p_domain_id: domainId,
    p_outcome: result,
    p_reason: null,
    p_source: 'probe',
  });
}

async function loadTenantMap(supabase: SupabaseClient, orgIds: string[]): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('m365_tenants')
    .select('organization_id, admin_email, tenant_id')
    .in('organization_id', orgIds);

  const map = new Map<string, string>();
  for (const t of data ?? []) {
    if (t.tenant_id && t.admin_email) {
      map.set(`${t.organization_id}:${t.admin_email}`, t.tenant_id as string);
    }
  }
  return map;
}

async function authorize(
  req: Request,
  supabase: SupabaseClient,
  organizationId: string | undefined,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const provided = req.headers.get('x-cron-secret');
  if (cronSecret && provided && provided === cronSecret) return { ok: true };

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearer) return { ok: false, error: 'Missing credentials', status: 401 };

  if (bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return { ok: true };

  const { data: userRes, error: userErr } = await supabase.auth.getUser(bearer);
  if (userErr || !userRes?.user) return { ok: false, error: 'Invalid token', status: 401 };
  if (!organizationId) {
    return { ok: false, error: 'organization_id is required for user-authenticated runs', status: 400 };
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userRes.user.id)
    .maybeSingle();

  return membership ? { ok: true } : { ok: false, error: 'Forbidden', status: 403 };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
