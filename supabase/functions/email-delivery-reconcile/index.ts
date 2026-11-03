// ============================================================================
// email-delivery-reconcile
// ----------------------------------------------------------------------------
// Closes the gap between "Microsoft 365 accepted our SMTP handoff" and "the
// message was actually delivered".
//
// ACA writes email_send_log.status='sent' the moment nodemailer gets its 250.
// Microsoft then relays the message asynchronously, and when the remote server
// refuses it — the Gmail reputation block being the case that motivated this —
// nothing ever writes that back. The row keeps reading as a success, so
// bounce_rate, mailbox health, domain health and every analytics page are
// computed from handoffs rather than deliveries.
//
// Proven on 2026-08-03: 4 of 5 active Acquist sending domains were hard-
// rejected by Gmail with
//     550-5.7.1 [ip] Our system has detected that this message is likely
//     unsolicited mail. ... the very low reputation of the sending domain ...
//     the message has been blocked.
// while org bounce rate read 0.09% and ~81% of weekly volume was discarded.
//
// The outcome IS visible in the M365 message trace, which is what this job
// reads: Get-MessageTraceV2 gives Status='Failed', and Get-MessageTraceDetailV2
// gives the remote server's verbatim SMTP rejection. Both are written back onto
// the send_log row (status / error_message / error_category / bounced_at), and
// repeated permanent reputation rejections produce provider-scoped health
// observations. Domain pause/resume is an explicit operator decision.
//
// Read-mostly against M365: only Get-* cmdlets are invoked, nothing in the
// tenant is mutated.
//
// Auth: deployed --no-verify-jwt. Accepts x-cron-secret (Vault cron_secret, the
// project's cron->edge scheme), a service-role bearer, or a user JWT — the last
// one requires organization_id in the body and membership of it.
//
// Body (all optional):
//   { organization_id, dry_run, lookback_hours, min_age_minutes, max_rows }
// ============================================================================

import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { exoInvokeCommand, getEXOToken } from "../_shared/m365-client.ts";
import {
  classifyDeliveryFailure,
  normalizeMessageId,
  normalizeTraceStatus,
  pickFailureEvent,
  type TraceDetailEvent,
  type TraceRow,
  traceStatusToOutcome,
} from "../_shared/m365-trace.ts";
import { warnDomainReputation } from "../_shared/domain-reputation-warning.ts";
import { recipientDomain, summarizeReceiverReputation, receiverScopeLabel, type ReputationTrace } from "../_shared/receiver-reputation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Trace data lags the send by roughly 5-30 minutes; younger rows aren't there yet. */
const DEFAULT_MIN_AGE_MINUTES = 20;
/** V2 trace retention is ~10 days. Stay inside it with room to spare. */
const DEFAULT_LOOKBACK_HOURS = 72;
/** Stop polling a row that never shows up rather than re-querying it forever. */
const MAX_TRACE_ATTEMPTS = 8;
/** Rows pulled per mailbox per run. */
const DEFAULT_MAX_ROWS = 5000;
/** Page size asked of Get-MessageTraceV2; hitting it means the window truncated. */
const TRACE_RESULT_SIZE = 1000;
/** Window-halving depth when a trace window truncates. 4 => 1/16th windows. */
const MAX_WINDOW_SPLITS = 4;
/** Detail lookups cost one EXO round trip each. Bound them per run. */
const MAX_DETAIL_CALLS = 400;
/**
 * Supabase edge functions are killed at a 150s idle timeout — measured in
 * production, where a 72h first pass across every tenant was cut off with
 * `{"code":"IDLE_TIMEOUT"}`. Stop well short of it so the run always returns
 * cleanly and records what it did. Unfinished work is not lost: rows keep
 * trace_status NULL and are picked up by the next pass.
 */
const RUN_DEADLINE_MS = 110_000;

// Provider-scoped observation thresholds. Neither severity changes sending.
const CRITICAL_MIN_EVENTS = 5;
const CRITICAL_MIN_SHARE = 0.20;
const REPUTATION_WINDOW_HOURS = 24;
const WARN_MIN_EVENTS = 5;
const WARN_MIN_SHARE = 0.02;

// Engagement proves delivery. Never let a trace verdict overwrite it.
const ENGAGED_STATUSES = new Set(["opened", "clicked", "replied"]);

interface SendLogRow {
  id: string;
  organization_id: string;
  mailbox_id: string;
  recipient_email: string;
  sent_at: string | null;
  created_at: string;
  status: string;
  message_id: string | null;
  email_message_id: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  trace_attempts: number;
}

interface MailboxRow {
  id: string;
  email_address: string;
  organization_id: string;
  sending_domain_id: string | null;
}

interface RunTotals {
  tenants_considered: number;
  tenants_traced: number;
  trace_calls: number;
  rows_examined: number;
  rows_delivered: number;
  rows_failed: number;
  rows_spam: number;
  rows_pending: number;
  rows_exhausted: number;
  reputation_blocks: number;
  // Legacy run-table column retained for compatibility; observation jobs never increment it.
  domains_blocked: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const startedAt = Date.now();
  const deadline = startedAt + RUN_DEADLINE_MS;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { success: false, error: "Server not configured" },
      500,
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: {
    organization_id?: string;
    dry_run?: boolean;
    lookback_hours?: number;
    min_age_minutes?: number;
    max_rows?: number;
  } = {};
  try {
    body = (await req.json()) ?? {};
  } catch { /* empty body is the cron case */ }

  const auth = await authorize(req, supabase, body.organization_id);
  if (!auth.ok) {
    return jsonResponse({ success: false, error: auth.error }, auth.status);
  }

  const dryRun = body.dry_run === true;
  const minAgeMinutes = clampNumber(
    body.min_age_minutes,
    DEFAULT_MIN_AGE_MINUTES,
    0,
    24 * 60,
  );
  const lookbackHours = clampNumber(
    body.lookback_hours,
    DEFAULT_LOOKBACK_HOURS,
    1,
    10 * 24,
  );
  const maxRows = clampNumber(body.max_rows, DEFAULT_MAX_ROWS, 1, 20000);

  const now = Date.now();
  const windowEnd = new Date(now - minAgeMinutes * 60_000);
  const windowStart = new Date(now - lookbackHours * 3600_000);

  const totals: RunTotals = {
    tenants_considered: 0,
    tenants_traced: 0,
    trace_calls: 0,
    rows_examined: 0,
    rows_delivered: 0,
    rows_failed: 0,
    rows_spam: 0,
    rows_pending: 0,
    rows_exhausted: 0,
    reputation_blocks: 0,
    domains_blocked: 0,
  };
  let domainsObserved = 0;
  const errors: Array<Record<string, unknown>> = [];

  // Run log first so a crashed run still leaves a trace of having started.
  let runId: string | null = null;
  if (!dryRun) {
    const { data: run } = await supabase
      .from("email_delivery_reconciliation_runs")
      .insert({ dry_run: dryRun })
      .select("id")
      .single();
    runId = run?.id ?? null;
  }

  // Sending domains that saw a fresh permanent reputation rejection this run.
  const domainsWithReputationHits = new Set<string>();
  // Mailboxes whose outcomes changed — their bounce_rate needs recomputing.
  const dirtyMailboxes = new Set<string>();

  try {
    // Least-recently-reconciled first. A run can be cut short by the deadline,
    // so without this ordering the same tenants would be traced every pass and
    // the tail would starve — the tenants most likely to be quietly burned are
    // exactly the ones we'd never look at.
    let tenantQuery = supabase
      .from("m365_tenants")
      .select(
        "id, organization_id, tenant_id, onmicrosoft_domain, admin_email, exo_consent_granted",
      )
      .eq("exo_consent_granted", true)
      .order("delivery_reconciled_at", { ascending: true, nullsFirst: true });
    if (body.organization_id) {
      tenantQuery = tenantQuery.eq("organization_id", body.organization_id);
    }

    const { data: tenants, error: tenantErr } = await tenantQuery;
    if (tenantErr) {
      return jsonResponse({ success: false, error: tenantErr.message }, 500);
    }

    totals.tenants_considered = tenants?.length ?? 0;

    for (const tenant of tenants ?? []) {
      if (Date.now() > deadline) {
        errors.push({
          stage: "deadline",
          message:
            "Run deadline hit; remaining tenants deferred to the next pass.",
        });
        break;
      }
      if (!tenant.tenant_id || !tenant.admin_email) continue;

      try {
        const processed = await reconcileTenant({
          supabase,
          tenant,
          windowStart,
          windowEnd,
          maxRows,
          dryRun,
          deadline,
          totals,
          domainsWithReputationHits,
          dirtyMailboxes,
        });
        if (processed) totals.tenants_traced++;

        // Stamp even when there was nothing to trace, so a quiet tenant doesn't
        // hold the front of the queue and block busier ones behind it.
        if (!dryRun) {
          await supabase
            .from("m365_tenants")
            .update({ delivery_reconciled_at: new Date().toISOString() })
            .eq("id", tenant.id);
        }
      } catch (err) {
        errors.push({
          stage: "tenant",
          tenant_id: tenant.tenant_id,
          organization_id: tenant.organization_id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Refresh delivery diagnostics now rather than waiting for the daily
    // aggregate. Reputation refusals are not recipient bounces.
    if (!dryRun) {
      for (const mailboxId of dirtyMailboxes) {
        try {
          await recomputeMailboxBounceRate(supabase, mailboxId);
        } catch (err) {
          errors.push({
            stage: "bounce_rate",
            mailbox_id: mailboxId,
            message: errText(err),
          });
        }
      }
    }

    for (const domainId of domainsWithReputationHits) {
      try {
        const observed = await evaluateDomainReputation(
          supabase,
          domainId,
          dryRun,
        );
        if (observed) domainsObserved++;
      } catch (err) {
        errors.push({
          stage: "domain_observation",
          domain_id: domainId,
          message: errText(err),
        });
      }
    }
  } catch (err) {
    errors.push({ stage: "run", message: errText(err) });
  }

  if (runId) {
    await supabase
      .from("email_delivery_reconciliation_runs")
      .update({ ...totals, finished_at: new Date().toISOString(), errors })
      .eq("id", runId);
  }

  console.log(
    `[DeliveryReconcile] ${JSON.stringify({ ...totals, domains_observed: domainsObserved })} errors=${errors.length} ` +
      `elapsed=${
        Math.round((Date.now() - startedAt) / 1000)
      }s dry_run=${dryRun}`,
  );

  return jsonResponse({
    success: true,
    run_id: runId,
    dry_run: dryRun,
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    ...totals,
    domains_observed: domainsObserved,
    errors,
  });
});

// ============================================================================
// Per-tenant reconciliation
// ============================================================================

async function reconcileTenant(ctx: {
  supabase: SupabaseClient;
  tenant: {
    organization_id: string;
    tenant_id: string;
    onmicrosoft_domain: string;
    admin_email: string;
  };
  windowStart: Date;
  windowEnd: Date;
  maxRows: number;
  dryRun: boolean;
  deadline: number;
  totals: RunTotals;
  domainsWithReputationHits: Set<string>;
  dirtyMailboxes: Set<string>;
}): Promise<boolean> {
  const {
    supabase,
    tenant,
    windowStart,
    windowEnd,
    maxRows,
    dryRun,
    deadline,
    totals,
  } = ctx;

  // Mailboxes belonging to this tenant. metadata.m365_admin_email -> tenant is
  // the same pointer infra-m365-heal-passwords and infra-m365-message-trace
  // use. Filtered server-side via the PostgREST JSON operator: the org+
  // connection_type predicate alone is NOT enough to narrow to "a handful of
  // rows" on an org with many M365 tenants sharing one organization_id — a
  // 1598-mailbox org silently truncated at PostgREST's 1000-row default,
  // so any tenant whose mailboxes fell past that cut never got fetched at all
  // and reconciled nothing, forever, with no error.
  const { data: mailboxes, error: mboxErr } = await supabase
    .from("email_mailboxes")
    .select("id, email_address, organization_id, sending_domain_id")
    .eq("organization_id", tenant.organization_id)
    .eq("connection_type", "m365")
    .eq("metadata->>m365_admin_email", tenant.admin_email);

  if (mboxErr) throw new Error(`mailbox lookup: ${mboxErr.message}`);
  if (!mailboxes?.length) return false;

  const tenantMailboxes = mailboxes as MailboxRow[];

  const mailboxById = new Map<string, MailboxRow>(
    tenantMailboxes.map((m) => [m.id, m]),
  );
  const mailboxIds = [...mailboxById.keys()];

  // Candidate rows: only ones we currently believe succeeded, never reconciled,
  // inside the trace-retention window.
  const { data: rows, error: rowsErr } = await supabase
    .from("email_send_log")
    .select(
      "id, organization_id, mailbox_id, recipient_email, sent_at, created_at, status, " +
        "message_id, email_message_id, opened_at, clicked_at, replied_at, trace_attempts",
    )
    .in("mailbox_id", mailboxIds)
    .in("status", ["sent", "delivered"])
    .is("trace_status", null)
    .gte("sent_at", windowStart.toISOString())
    .lte("sent_at", windowEnd.toISOString())
    .order("sent_at", { ascending: true })
    .limit(maxRows);

  if (rowsErr) throw new Error(`send_log lookup: ${rowsErr.message}`);

  // No pending rows => no EXO call. This is what keeps an idle schedule cheap.
  const pending = (rows ?? []) as unknown as SendLogRow[];
  if (!pending.length) return false;

  totals.rows_examined += pending.length;

  // Trace by receipt time. EXO records the message when it accepts it, which is
  // our sent_at; the row's Status then updates in place as delivery resolves.
  const sentTimes = pending
    .map((r) => Date.parse(r.sent_at ?? r.created_at))
    .filter((t) => Number.isFinite(t));
  const traceStart = new Date(Math.min(...sentTimes) - 10 * 60_000);
  const traceEnd = new Date(Math.max(...sentTimes) + 10 * 60_000);

  const token = await getEXOToken(tenant.tenant_id);
  const cmdlets = await resolveCmdlets(
    token,
    tenant,
    traceStart,
    traceEnd,
    totals,
  );

  const traceRows = await fetchTraceWindow({
    token,
    tenant,
    start: traceStart,
    end: traceEnd,
    cmdlet: cmdlets.trace,
    depth: 0,
    totals,
    deadline,
  });

  const matcher = new TraceMatcher(traceRows);
  let detailCalls = 0;

  // Pending-row bumps grouped by current attempt count so each group is one
  // UPDATE rather than one per row.
  const bumpByAttempts = new Map<number, string[]>();
  const nowIso = new Date().toISOString();

  for (const row of pending) {
    const mailbox = mailboxById.get(row.mailbox_id);
    if (!mailbox) continue;

    // Engagement is proof of delivery. A trace verdict must never undo it.
    if (
      row.opened_at || row.clicked_at || row.replied_at ||
      ENGAGED_STATUSES.has(row.status)
    ) {
      if (!dryRun) {
        await supabase
          .from("email_send_log")
          .update({ trace_status: "Delivered", trace_checked_at: nowIso })
          .eq("id", row.id);
      }
      totals.rows_delivered++;
      continue;
    }

    const match = matcher.match(row, mailbox.email_address);

    if (!match) {
      const attempts = row.trace_attempts ?? 0;
      if (attempts + 1 >= MAX_TRACE_ATTEMPTS) {
        // Give up polling. The send status is left untouched — "we could not
        // confirm" is not the same as "it failed", and silently bouncing a row
        // we have no evidence against would be the same class of bug as the one
        // being fixed.
        if (!dryRun) {
          await supabase
            .from("email_send_log")
            .update({
              trace_status: "no_trace",
              trace_checked_at: nowIso,
              trace_attempts: attempts + 1,
            })
            .eq("id", row.id);
        }
        totals.rows_exhausted++;
      } else {
        const bucket = bumpByAttempts.get(attempts) ?? [];
        bucket.push(row.id);
        bumpByAttempts.set(attempts, bucket);
        totals.rows_pending++;
      }
      continue;
    }

    const traceStatus = normalizeTraceStatus(match.Status);
    const outcome = traceStatusToOutcome(traceStatus);

    if (outcome.kind === "pending") {
      const attempts = row.trace_attempts ?? 0;
      const bucket = bumpByAttempts.get(attempts) ?? [];
      bucket.push(row.id);
      bumpByAttempts.set(attempts, bucket);
      totals.rows_pending++;
      continue;
    }

    const update: Record<string, unknown> = {
      trace_status: traceStatus,
      trace_checked_at: nowIso,
      trace_attempts: (row.trace_attempts ?? 0) + 1,
    };

    if (outcome.kind === "delivered") {
      update.status = "delivered";
      totals.rows_delivered++;
    } else if (outcome.kind === "spam") {
      // Accepted but filed as junk / quarantined. Not a bounce, but it is not a
      // delivery either, and the existing 'spam' status already feeds
      // spam_rate in email-stats-aggregate.
      update.status = "spam";
      totals.rows_spam++;
      ctx.dirtyMailboxes.add(row.mailbox_id);
    } else {
      // Failed. Pull the per-event detail — that is where the remote server's
      // verbatim SMTP response lives, and it is the only thing that separates
      // "the recipient does not exist" from "your domain is blocked".
      let diagnosticSource: string | null = null;
      let detailAttempted = false;
      if (
        match.MessageTraceId && detailCalls < MAX_DETAIL_CALLS &&
        Date.now() < deadline
      ) {
        detailAttempted = true;
        detailCalls++;
        totals.trace_calls++;
        try {
          const detail = await exoInvokeCommand(
            token,
            tenant.tenant_id,
            tenant.onmicrosoft_domain,
            cmdlets.detail,
            {
              MessageTraceId: match.MessageTraceId,
              RecipientAddress: match.RecipientAddress,
            },
          );
          const events = toArray<TraceDetailEvent>(detail?.value);
          diagnosticSource = pickFailureEvent(events)?.Detail ?? null;
        } catch (err) {
          console.warn(
            `[DeliveryReconcile] detail lookup failed for ${row.id}: ${
              errText(err)
            }`,
          );
        }
      }

      // If we never got to ASK for the diagnostic — deadline, per-run cap — do
      // not finalize. Writing 'bounced' + error_category='unknown' would stamp
      // trace_status and permanently bury the remote rejection, which is the
      // evidence this whole job exists to capture. Observed on the first real
      // run: 146 rows landed as 'unknown' purely because the deadline cut their
      // detail lookups off. Leave them queued; the next pass classifies them
      // properly. (A lookup that was attempted and came back empty IS final —
      // retrying it would just spend the same call again.)
      if (!detailAttempted) {
        const attempts = row.trace_attempts ?? 0;
        const bucket = bumpByAttempts.get(attempts) ?? [];
        bucket.push(row.id);
        bumpByAttempts.set(attempts, bucket);
        totals.rows_pending++;
        continue;
      }

      const classification = classifyDeliveryFailure(diagnosticSource);
      const isSpamVerdict = classification.category === "content_block";
      const isConfirmedRecipientBounce =
        classification.category === "hard_bounce";

      // A reputation block is NOT a bounce. The recipient's mailbox is fine —
      // the receiver refused OUR sending domain. Recording it as 'bounced'
      // suppressed the lead from every future sequence (the sender stops on any
      // prior replied/bounced/spam row), burning 692 perfectly good addresses
      // before this was caught. 'blocked' keeps it a delivery failure for
      // analytics and domain reputation monitoring without punishing the recipient.
      update.status = isSpamVerdict
        ? "spam"
        : classification.isReputationBlock || classification.isTenantBlock
        ? "blocked"
        : isConfirmedRecipientBounce
        ? "bounced"
        : "failed";
      update.error_category = classification.category;
      update.error_message = classification.diagnostic
        ? classification.diagnostic.slice(0, 2000)
        : "M365 message trace reported Failed with no remote diagnostic";
      // bounced_at drives bounce reporting and per-recipient suppression, so it
      // is reserved for actual bounces.
      if (isConfirmedRecipientBounce) update.bounced_at = nowIso;

      totals.rows_failed++;
      if (isConfirmedRecipientBounce) ctx.dirtyMailboxes.add(row.mailbox_id);

      if (classification.isTenantBlock) {
        // Microsoft refused to relay: a tenant/user restriction, not a receiver
        // judging one domain. Deliberately NOT fed to evaluateDomainReputation.
        console.warn(
          `[DeliveryReconcile] tenant block from=${mailbox.email_address} ` +
            `tenant=${tenant.onmicrosoft_domain} code=${
              classification.enhancedCode ?? classification.smtpCode ?? "?"
            } detail=${classification.diagnostic.slice(0, 300)}`,
        );
      }

      if (classification.isReputationBlock) {
        totals.reputation_blocks++;
        if (mailbox.sending_domain_id) {
          ctx.domainsWithReputationHits.add(mailbox.sending_domain_id);
        }
        console.warn(
          `[DeliveryReconcile] reputation block from=${mailbox.email_address} ` +
            `to=${row.recipient_email} code=${
              classification.smtpCode ?? "?"
            } ` +
            `detail=${classification.diagnostic.slice(0, 300)}`,
        );
      }
    }

    if (!dryRun) {
      const { error: updErr } = await supabase
        .from("email_send_log")
        .update(update)
        .eq("id", row.id)
        // Guard against a concurrent writer (reply matcher, open tracker) having
        // advanced the row to a real engagement status while we were tracing.
        .in("status", ["sent", "delivered"]);
      if (updErr) {
        console.error(
          `[DeliveryReconcile] update ${row.id} failed: ${updErr.message}`,
        );
      }
    }
  }

  if (!dryRun) {
    for (const [attempts, ids] of bumpByAttempts) {
      for (const chunk of chunkArray(ids, 200)) {
        await supabase
          .from("email_send_log")
          .update({ trace_attempts: attempts + 1, trace_checked_at: nowIso })
          .in("id", chunk);
      }
    }
  }

  return true;
}

// ============================================================================
// Trace fetching
// ============================================================================

/**
 * V1 Get-MessageTrace was retired but some tenants still only expose it. Probe
 * once per tenant per run with a deliberately tiny window and remember which
 * pair works, so the hot path doesn't try-and-fall-back on every call.
 */
async function resolveCmdlets(
  token: string,
  tenant: { tenant_id: string; onmicrosoft_domain: string },
  start: Date,
  end: Date,
  totals: RunTotals,
): Promise<{ trace: string; detail: string }> {
  try {
    totals.trace_calls++;
    await exoInvokeCommand(
      token,
      tenant.tenant_id,
      tenant.onmicrosoft_domain,
      "Get-MessageTraceV2",
      {
        StartDate: start.toISOString(),
        EndDate: end.toISOString(),
        ResultSize: 1,
      },
    );
    return { trace: "Get-MessageTraceV2", detail: "Get-MessageTraceDetailV2" };
  } catch {
    return { trace: "Get-MessageTrace", detail: "Get-MessageTraceDetail" };
  }
}

/**
 * Fetch every trace row in a window.
 *
 * V2 dropped V1's Page/PageSize parameters in favour of a continuation scheme,
 * so instead of depending on that contract we detect truncation (a full page)
 * and halve the window. Correct against either cmdlet, and self-limiting: the
 * recursion is bounded, and an exhausted split is logged rather than silently
 * dropping rows.
 */
async function fetchTraceWindow(args: {
  token: string;
  tenant: { tenant_id: string; onmicrosoft_domain: string };
  start: Date;
  end: Date;
  cmdlet: string;
  depth: number;
  totals: RunTotals;
  deadline: number;
}): Promise<TraceRow[]> {
  const { token, tenant, start, end, cmdlet, depth, totals, deadline } = args;

  totals.trace_calls++;
  const raw = await exoInvokeCommand(
    token,
    tenant.tenant_id,
    tenant.onmicrosoft_domain,
    cmdlet,
    {
      StartDate: start.toISOString(),
      EndDate: end.toISOString(),
      ResultSize: TRACE_RESULT_SIZE,
    },
  );

  const rows = toArray<TraceRow>(raw?.value);

  if (rows.length < TRACE_RESULT_SIZE) return rows;

  const spanMs = end.getTime() - start.getTime();
  if (depth >= MAX_WINDOW_SPLITS || spanMs < 120_000 || Date.now() > deadline) {
    console.warn(
      `[DeliveryReconcile] trace window ${start.toISOString()}..${end.toISOString()} still full at ` +
        `${rows.length} rows after ${depth} splits — some messages in this window will be retried next run.`,
    );
    return rows;
  }

  const mid = new Date(start.getTime() + Math.floor(spanMs / 2));
  const [left, right] = [
    await fetchTraceWindow({ ...args, end: mid, depth: depth + 1 }),
    await fetchTraceWindow({ ...args, start: mid, depth: depth + 1 }),
  ];
  return dedupeTraceRows([...left, ...right]);
}

function dedupeTraceRows(rows: TraceRow[]): TraceRow[] {
  const seen = new Set<string>();
  const out: TraceRow[] = [];
  for (const r of rows) {
    const key = `${r.MessageTraceId ?? ""}|${
      (r.RecipientAddress ?? "").toLowerCase()
    }`;
    if (key !== "|" && seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ============================================================================
// Matching send_log rows to trace rows
// ============================================================================

/**
 * Message-ID is the exact key: the SMTP path stamps `<{send_log_id}@{domain}>`
 * as the Message-ID, so it round-trips through the trace. Two paths don't have
 * it — Graph sends (202 Accepted returns no Message-Id) and older rows — so
 * those fall back to sender + recipient + nearest send time.
 *
 * Every trace row is consumed at most once, which keeps the fallback from
 * mapping several send_log rows onto the same trace record.
 */
class TraceMatcher {
  private byMessageId = new Map<string, TraceRow[]>();
  private byRecipient = new Map<string, TraceRow[]>();
  private consumed = new Set<TraceRow>();

  constructor(rows: TraceRow[]) {
    for (const row of rows) {
      const mid = normalizeMessageId(row.MessageId);
      if (mid) push(this.byMessageId, mid, row);
      const rcpt = (row.RecipientAddress ?? "").toLowerCase();
      if (rcpt) push(this.byRecipient, rcpt, row);
    }
  }

  match(row: SendLogRow, senderAddress: string): TraceRow | null {
    for (const candidateId of [row.message_id, row.email_message_id]) {
      const mid = normalizeMessageId(candidateId);
      if (!mid) continue;
      const hit = (this.byMessageId.get(mid) ?? []).find((r) =>
        !this.consumed.has(r)
      );
      if (hit) {
        this.consumed.add(hit);
        return hit;
      }
    }

    const rcpt = (row.recipient_email ?? "").toLowerCase();
    const sentAt = Date.parse(row.sent_at ?? row.created_at);
    if (!rcpt || !Number.isFinite(sentAt)) return null;

    const sender = senderAddress.toLowerCase();
    let best: TraceRow | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const candidate of this.byRecipient.get(rcpt) ?? []) {
      if (this.consumed.has(candidate)) continue;
      const candidateSender = (candidate.SenderAddress ?? "").toLowerCase();
      if (candidateSender && candidateSender !== sender) continue;
      const received = Date.parse(candidate.Received ?? "");
      if (!Number.isFinite(received)) continue;
      const delta = Math.abs(received - sentAt);
      // 30 minutes is generous for the gap between our SMTP handoff and EXO's
      // recorded receipt, and tight enough not to collide with a later step of
      // the same sequence to the same recipient.
      if (delta > 30 * 60_000) continue;
      if (delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }

    if (best) this.consumed.add(best);
    return best;
  }
}

// ============================================================================
// Write-backs
// ============================================================================

/**
 * Recompute a mailbox's lifetime bounce_rate from the send log, matching the
 * definition already used by _shared/email-rotation.ts#recordSendResult so the
 * two writers can't disagree.
 */
async function recomputeMailboxBounceRate(
  supabase: SupabaseClient,
  mailboxId: string,
): Promise<void> {
  const { count: total } = await supabase
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_id", mailboxId)
    .in("status", [
      "sent",
      "delivered",
      "opened",
      "clicked",
      "replied",
      "bounced",
    ]);

  if (!total) return;

  const { count: bounced } = await supabase
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_id", mailboxId)
    .eq("status", "bounced");

  await supabase
    .from("email_mailboxes")
    .update({
      bounce_rate: (bounced ?? 0) / total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mailboxId);
}

/** Record receiver-scoped reputation observations, including on paused or
 * previously unhealthy domains. Health observations never stop rotation. */
async function evaluateDomainReputation(
  supabase: SupabaseClient,
  domainId: string,
  dryRun: boolean,
): Promise<boolean> {
  const { data: domain, error: domainError } = await supabase
    .from("email_sending_domains")
    .select("id, domain, organization_id, health_status")
    .eq("id", domainId)
    .maybeSingle();
  if (domainError) throw new Error(domainError.message);
  if (!domain) return false;

  const { data: mailboxes, error: mailboxError } = await supabase
    .from("email_mailboxes")
    .select("id")
    .eq("organization_id", domain.organization_id)
    .eq("sending_domain_id", domainId);
  if (mailboxError) throw new Error(mailboxError.message);
  const mailboxIds = (mailboxes ?? []).map((m) => m.id as string);
  if (!mailboxIds.length) return false;

  const since = new Date(Date.now() - REPUTATION_WINDOW_HOURS * 3600_000).toISOString();
  // Read every confirmed row: calculating a provider rate from differently
  // scoped numerator/denominator, or Supabase's default first page, is invalid.
  const rows: ReputationTrace[] = [];
  const pageSize = 1000;
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await supabase.from("email_send_log")
      .select("recipient_email, trace_status, error_category, error_message")
      .eq("organization_id", domain.organization_id)
      .in("mailbox_id", mailboxIds)
      .in("trace_status", ["Delivered", "Failed", "Quarantined", "FilteredAsSpam"])
      .gte("sent_at", since)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as ReputationTrace[]);
    if ((data?.length ?? 0) < pageSize) break;
  }

  const receiverDomains = [...new Set(rows.map((r) => recipientDomain(r.recipient_email)))].filter(Boolean);
  const knownMx = new Map<string, string>();
  // Reuse public DNS MX facts only for domains present in this org's confirmed
  // recipient rows. The deployed cache is global; custom domains without
  // verified, unexpired evidence remain explicitly unknown.
  for (let offset = 0; offset < receiverDomains.length; offset += 100) {
    const { data, error } = await supabase.from("domain_pattern_cache")
      .select("domain, mx_provider")
      .eq("mx_valid", true)
      .not("last_verified_at", "is", null)
      .gt("expires_at", new Date().toISOString())
      .in("domain", receiverDomains.slice(offset, offset + 100));
    if (error) {
      console.warn(`[DeliveryReconcile] MX evidence unavailable; custom recipients remain unknown: ${error.message}`);
      continue;
    }
    for (const fact of data ?? []) {
      if (fact.mx_provider) knownMx.set(fact.domain, fact.mx_provider);
    }
  }

  const summaries = summarizeReceiverReputation(rows, knownMx)
    .sort((a, b) => b.blockCount - a.blockCount);
  // Preserve the prior domain-wide early-warning notification envelope. New
  // provider breakdowns and domain-wide critical observations stay log-only.
  const totalBlocks = summaries.reduce((sum, r) => sum + r.blockCount, 0);
  const totalShare = rows.length ? totalBlocks / rows.length : 0;
  const notifyEarlyWarning = totalBlocks >= WARN_MIN_EVENTS &&
    totalShare >= WARN_MIN_SHARE && totalShare < CRITICAL_MIN_SHARE;
  let observed = false;
  for (const summary of summaries) {
    const share = summary.blockCount / summary.reconciledCount;
    if (summary.blockCount < WARN_MIN_EVENTS || share < WARN_MIN_SHARE) continue;
    const critical = summary.blockCount >= CRITICAL_MIN_EVENTS && share >= CRITICAL_MIN_SHARE;
    const reason = `${summary.blockCount}/${summary.reconciledCount} confirmed outcomes to ${receiverScopeLabel(summary.provider)} in ${REPUTATION_WINDOW_HOURS}h refused for reputation (${(share * 100).toFixed(1)}%). Recipient-provider scope only. Monitoring continues; sending unchanged. Sample: ${summary.sample.slice(0, 500)}`;
    console.warn(`[DeliveryReconcile] ${critical ? 'CRITICAL OBSERVATION' : 'EARLY WARNING'} ${domain.domain}: ${reason}; dry_run=${dryRun}`);
    observed = true;
    if (dryRun) continue;

    // Existing below-threshold notifications remain bounded to one per window;
    // newly expanded high-severity/provider observations are in-app only.
    const warning = await warnDomainReputation(supabase, {
      domainId,
      domain: domain.domain,
      organizationId: domain.organization_id,
      healthStatus: domain.health_status,
      blockCount: summary.blockCount,
      reconciledCount: summary.reconciledCount,
      windowHours: REPUTATION_WINDOW_HOURS,
      sample: summary.sample,
      provider: summary.provider,
      notify: notifyEarlyWarning && summary.provider === summaries[0]?.provider,
    });
    if (critical && warning.warned) {
      // The SQL state machine records diagnostics only. It does not own the
      // separate sending_paused_at operator control or mailbox connectivity.
      const { error } = await supabase.rpc("apply_domain_probe_outcome", {
        p_domain_id: domainId,
        p_outcome: "failed_550",
        p_reason: reason,
        p_source: "reconcile",
      });
      if (error) throw new Error(`Health observation failed: ${error.message}`);
    }
  }

  return observed;
}

// ============================================================================
// Helpers
// ============================================================================

async function authorize(
  req: Request,
  supabase: SupabaseClient,
  organizationId: string | undefined,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret");
  if (cronSecret && provided && provided === cronSecret) return { ok: true };

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return { ok: false, error: "Missing credentials", status: 401 };

  if (bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return { ok: true };

  const { data: userRes, error: userErr } = await supabase.auth.getUser(bearer);
  if (userErr || !userRes?.user) {
    return { ok: false, error: "Invalid token", status: 401 };
  }
  if (!organizationId) {
    return {
      ok: false,
      error: "organization_id is required for user-authenticated runs",
      status: 400,
    };
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userRes.user.id)
    .maybeSingle();

  return membership
    ? { ok: true }
    : { ok: false, error: "Forbidden", status: 403 };
}

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value ? [value as T] : [];
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
  return Math.min(max, Math.max(min, n));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
