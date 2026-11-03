/**
 * infra-domain-move — move a sending domain and its mailboxes between M365
 * tenants, then (optionally) cancel the source tenant's Pax8 subscription.
 *
 * Built to replace tenant wigskdigitaloj3rz, which Microsoft blocked from sending
 * outbound mail: order a new tenant, move the domains that are not burned, retire
 * the ones that are, cancel the old tenant.
 *
 * A move is a row in `domain_moves` advanced one step per call (2-minute cron),
 * because the slow parts are all asynchronous on Microsoft's side: releasing a
 * domain, DNS verification, DKIM, and Exchange role propagation on a fresh tenant.
 *
 *   preflight            domain not burned; both tenants reachable with the
 *                        Graph roles the move needs; DNS host writable; snapshot
 *                        and pause the mailboxes
 *   remove_from_source   Graph forceDelete (plain DELETE is refused while
 *                        mailboxes still use the domain)
 *   wait_source_release  until the source tenant no longer has the domain
 *   add_to_target        add the domain to the new tenant
 *   publish_verification MS=ms TXT on the DNS host
 *   verify_target        Microsoft verifies ownership; the ACA domain row is
 *                        re-pointed at the new tenant
 *   publish_service      MX, SPF, autodiscover, one DMARC record, DKIM CNAMEs
 *   enable_dkim          until Exchange reports DKIM signing enabled
 *   reprovision_mailboxes  re-create every address on the new tenant, rewriting
 *                        the existing mailbox rows IN PLACE (same id) so
 *                        sequences, enrollments and reply history survive
 *   verify_mailboxes     capability probe: Microsoft confirms each can send/receive
 *   cancel_source        only if requested AND nothing else is left on the source
 *                        tenant: cancel its Pax8 subscription
 *
 * The order is enforced. An M365 domain can be verified in one tenant only, so
 * the source must release it before the target can add it — and cancelling the
 * source first strands the domain on a dying tenant (aigetreplies.com and
 * fastdealai.com were left parked until 2036 that way).
 *
 * Actions (POST):
 *   plan    { organization_id, domain_id, to_tenant_id }                dry run
 *   start   { organization_id, domain_id, to_tenant_id, cancel_source_tenant? }
 *   advance {}                                                            cron
 *   status  { move_id }
 *   abort   { move_id }   only before the domain has left the source tenant
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  getDomainOrNull,
  forceDeleteDomain,
  addDomainToTenant,
  getDomainVerificationRecords,
  getDomainServiceRecords,
  verifyDomain,
  generateM365DnsRecords,
  enableDkimSigning,
  buildDkimDnsRecords,
  checkSendAppRole,
  GRAPH_MAIL_SEND_ROLE_ID,
  type DnsRecord,
} from '../_shared/m365-client.ts';
import { VercelDnsClient } from '../_shared/vercel-dns-client.ts';
import type { RegistrarClient } from '../_shared/registrar-client.ts';
import { getActiveDmarcCollectorEmail } from '../_shared/dmarc-collector.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Graph application roles the move needs in each tenant. */
const DOMAIN_READWRITE_ALL_ROLE_ID = '7e05723c-0bb0-42da-be95-ae9f08a6e53c';

const MINUTE = 60_000;

type Step =
  | 'preflight'
  | 'remove_from_source'
  | 'wait_source_release'
  | 'add_to_target'
  | 'publish_verification'
  | 'verify_target'
  | 'publish_service'
  | 'enable_dkim'
  | 'reprovision_mailboxes'
  | 'verify_mailboxes'
  | 'cancel_source';

/** Retry budget per step before the move is marked failed (or, where noted, continues). */
const MAX_ATTEMPTS: Record<Step, number> = {
  preflight: 30,               // a freshly ordered tenant may still be consenting
  remove_from_source: 10,
  wait_source_release: 90,     // ~90 min
  add_to_target: 45,           // Microsoft can take a while to release a name globally
  publish_verification: 10,
  verify_target: 60,           // DNS propagation
  publish_service: 10,
  enable_dkim: 20,             // continues without DKIM after this, flagged
  reprovision_mailboxes: 200,  // polls the provisioning job
  verify_mailboxes: 12,        // continues with a warning after this
  cancel_source: 5,
};

interface MoveRow {
  id: string;
  organization_id: string;
  domain_id: string;
  domain: string;
  from_tenant_id: string;
  to_tenant_id: string;
  status: string;
  step: Step;
  step_attempts: number;
  cancel_source_tenant: boolean;
  mailboxes: MovedMailbox[];
  provisioning_job_id: string | null;
  log: unknown[];
}

interface MovedMailbox {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  prev_status: string;
}

interface TenantRow {
  id: string;
  tenant_id: string;
  admin_email: string;
  onmicrosoft_domain: string;
  organization_id: string;
  status: string | null;
}

type StepResult =
  | { next: Step; waitMs?: number; note?: string }
  | { wait: number; note?: string }
  | { done: true; note?: string }
  | { fail: string };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = body.action as string;

  try {
    // Authorization. Internal callers (the 2-minute cron, tenant tooling) carry the
    // service-role bearer or x-cron-secret. Everyone else is a user/API-token caller
    // who must belong to the organization the action targets. 'advance' drives every
    // org's moves, so it is internal-only.
    const internal = isInternalRequest(req);
    if (action === 'advance') {
      if (!internal) return json({ success: false, error: 'Forbidden' }, 403);
    } else if (!internal) {
      if (action === 'status' || action === 'abort') {
        const { data: m } = await supabase.from('domain_moves').select('organization_id').eq('id', body.move_id).maybeSingle();
        // Same response for "missing" and "not yours" so ids cannot be probed.
        if (!m) return json({ success: false, error: 'Forbidden' }, 403);
        await assertOrgAccess(req, supabase, m.organization_id);
      } else {
        await assertOrgAccess(req, supabase, body.organization_id);
      }
    }

    if (action === 'plan') {
      const checks = await planChecks(supabase, body.organization_id, body.domain_id, body.to_tenant_id);
      return json({ success: true, ...checks });
    }

    if (action === 'start') {
      const checks = await planChecks(supabase, body.organization_id, body.domain_id, body.to_tenant_id);
      if (checks.blocking.length > 0) {
        return json({ success: false, error: 'Move cannot start', ...checks }, 409);
      }
      const { data: row, error } = await supabase
        .from('domain_moves')
        .insert({
          organization_id: body.organization_id,
          domain_id: body.domain_id,
          domain: checks.domain,
          from_tenant_id: checks.from_tenant_id,
          to_tenant_id: body.to_tenant_id,
          cancel_source_tenant: body.cancel_source_tenant === true,
          log: [logEntry('created', `move ${checks.domain}: ${checks.from_admin} -> ${checks.to_admin}; cancel source tenant: ${body.cancel_source_tenant === true}`)],
        })
        .select('*')
        .single();
      if (error) return json({ success: false, error: error.message }, 409);
      const result = await advanceOne(supabase, row as MoveRow);
      return json({ success: true, move_id: row.id, first_step: result });
    }

    if (action === 'advance') {
      const { data: due } = await supabase
        .from('domain_moves')
        .select('*')
        .in('status', ['running', 'waiting'])
        .lte('next_run_at', new Date().toISOString())
        .order('next_run_at', { ascending: true })
        .limit(3);
      const results = [];
      for (const m of (due ?? []) as MoveRow[]) results.push({ id: m.id, domain: m.domain, ...(await advanceOne(supabase, m)) });
      return json({ success: true, advanced: results });
    }

    if (action === 'status') {
      const { data } = await supabase.from('domain_moves').select('*').eq('id', body.move_id).single();
      return json({ success: true, move: data });
    }

    if (action === 'abort') {
      const { data: m } = await supabase.from('domain_moves').select('*').eq('id', body.move_id).single();
      if (!m) return json({ success: false, error: 'not found' }, 404);
      const irreversible = !['preflight', 'remove_from_source'].includes(m.step);
      if (irreversible) {
        return json({ success: false, error: `Cannot abort at step ${m.step}: the domain has already left the source tenant. Let the move finish.` }, 409);
      }
      await restoreMailboxes(supabase, m as MoveRow);
      await supabase.from('domain_moves').update({
        status: 'cancelled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        log: [...(m.log ?? []), logEntry('aborted', 'mailboxes restored to their previous status')],
      }).eq('id', m.id);
      return json({ success: true });
    }

    return json({ success: false, error: `unknown action: ${action}` }, 400);
  } catch (err) {
    if (err instanceof AuthError) return json({ success: false, error: err.message }, err.status);
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** Service-role bearer or the shared cron secret. */
function isInternalRequest(req: Request): boolean {
  if (isServiceRoleRequest(req)) return true;
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const provided = req.headers.get('x-cron-secret') ?? '';
  return cronSecret.length > 0 && provided === cronSecret;
}

// ── Advancing ────────────────────────────────────────────────────────────────

async function advanceOne(supabase: SupabaseClient, move: MoveRow) {
  const step = move.step;
  let result: StepResult;
  try {
    result = await runStep(supabase, move);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { wait: 2 * MINUTE, note: `error: ${msg}` };
  }

  const now = new Date();
  const log = [...(move.log ?? [])];
  const update: Record<string, unknown> = { updated_at: now.toISOString() };

  if ('fail' in result) {
    update.status = 'failed';
    update.last_error = result.fail;
    update.finished_at = now.toISOString();
    log.push(logEntry(step, `FAILED: ${result.fail}`));
  } else if ('done' in result) {
    update.status = 'done';
    update.last_error = null;
    update.finished_at = now.toISOString();
    log.push(logEntry(step, `done${result.note ? `: ${result.note}` : ''}`));
  } else if ('next' in result) {
    update.status = 'running';
    update.step = result.next;
    update.step_attempts = 0;
    update.last_error = null;
    update.next_run_at = new Date(now.getTime() + (result.waitMs ?? 0)).toISOString();
    log.push(logEntry(step, `-> ${result.next}${result.note ? `: ${result.note}` : ''}`));
  } else {
    const attempts = (move.step_attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS[step]) {
      update.status = 'failed';
      update.last_error = `step ${step} did not complete after ${attempts} attempts${result.note ? `: ${result.note}` : ''}`;
      update.finished_at = now.toISOString();
      log.push(logEntry(step, `FAILED after ${attempts} attempts${result.note ? `: ${result.note}` : ''}`));
    } else {
      update.status = 'waiting';
      update.step_attempts = attempts;
      update.last_error = result.note ?? null;
      update.next_run_at = new Date(now.getTime() + result.wait).toISOString();
      // Only log waits that carry information, so the log stays readable.
      if (result.note && attempts % 5 === 1) log.push(logEntry(step, `waiting (${attempts}): ${result.note}`));
    }
  }

  update.log = log.slice(-200);
  await supabase.from('domain_moves').update(update).eq('id', move.id);
  return { step, result };
}

async function runStep(supabase: SupabaseClient, move: MoveRow): Promise<StepResult> {
  const from = await loadTenant(supabase, move.from_tenant_id);
  const to = await loadTenant(supabase, move.to_tenant_id);
  const { data: domainRow } = await supabase.from('email_sending_domains').select('*').eq('id', move.domain_id).single();
  if (!domainRow) return { fail: 'domain row no longer exists' };

  switch (move.step) {
    case 'preflight': {
      const checks = await planChecks(supabase, move.organization_id, move.domain_id, move.to_tenant_id);
      // Tenant consent/roles on a freshly ordered tenant can lag — wait on those,
      // fail immediately on things that will not fix themselves.
      const permanent = checks.blocking.filter((b) => !b.startsWith('[wait]'));
      if (permanent.length > 0) return { fail: permanent.join('; ') };
      if (checks.blocking.length > 0) return { wait: 5 * MINUTE, note: checks.blocking.join('; ') };

      const snapshot: MovedMailbox[] = checks.mailboxes;
      const ids = snapshot.map((m) => m.id);
      for (const m of snapshot) {
        await supabase.rpc('apply_mailbox_metadata_patch', {
          p_id: m.id,
          p_set: { paused_reason: 'domain_moving', paused_at: new Date().toISOString(), domain_move_id: move.id },
          p_unset: [],
        });
      }
      if (ids.length > 0) {
        await supabase.from('email_mailboxes')
          .update({ status: 'paused', warmup_enabled: false, updated_at: new Date().toISOString() })
          .in('id', ids);
      }
      await supabase.from('domain_moves').update({ mailboxes: snapshot }).eq('id', move.id);
      return { next: 'remove_from_source', note: `${ids.length} mailboxes paused for the move` };
    }

    case 'remove_from_source': {
      const token = await getM365Token(from.tenant_id);
      const existing = await getDomainOrNull(token, move.domain);
      if (!existing) return { next: 'add_to_target', note: 'source tenant no longer has the domain' };
      await forceDeleteDomain(token, move.domain);
      return { next: 'wait_source_release', waitMs: MINUTE, note: 'forceDelete accepted by source tenant' };
    }

    case 'wait_source_release': {
      const token = await getM365Token(from.tenant_id);
      const existing = await getDomainOrNull(token, move.domain);
      if (existing) return { wait: MINUTE, note: 'source tenant still holds the domain' };
      return { next: 'add_to_target', note: 'released by source tenant' };
    }

    case 'add_to_target': {
      const token = await getM365Token(to.tenant_id);
      const existing = await getDomainOrNull(token, move.domain);
      if (!existing) {
        try {
          await addDomainToTenant(token, move.domain);
        } catch (err) {
          // Microsoft can keep a released name reserved for a while.
          return { wait: 2 * MINUTE, note: `target could not add the domain yet: ${errMsg(err)}` };
        }
      }
      return { next: 'publish_verification' };
    }

    case 'publish_verification': {
      const token = await getM365Token(to.tenant_id);
      const verification = await getDomainVerificationRecords(token, move.domain);
      const records = generateM365DnsRecords(move.domain, verification, []).filter((r) => r.type === 'TXT' && /^MS=ms/i.test(r.value));
      if (records.length === 0) return { wait: MINUTE, note: 'target has not issued the MS=ms verification value yet' };
      const dns = await dnsClientFor(move.domain);
      await replaceRecords(dns, move.domain, 'TXT', '', (v) => /^MS=ms/i.test(v), records);
      return { next: 'verify_target', waitMs: MINUTE, note: `published ${records[0].value}` };
    }

    case 'verify_target': {
      const token = await getM365Token(to.tenant_id);
      const { isVerified } = await verifyDomain(token, move.domain).catch(() => ({ isVerified: false }));
      if (!isVerified) return { wait: MINUTE, note: 'Microsoft has not verified ownership yet (DNS propagation)' };
      const d = await getDomainOrNull(token, move.domain);
      await supabase.from('email_sending_domains').update({
        m365_tenant_id: to.id,
        m365_domain_id: d?.id ?? null,
        m365_domain_verified: true,
        dns_status: 'pending',
        dkim_verified: false,
        updated_at: new Date().toISOString(),
      }).eq('id', move.domain_id);
      return { next: 'publish_service', note: 'verified; domain row re-pointed at target tenant' };
    }

    case 'publish_service': {
      const token = await getM365Token(to.tenant_id);
      const service = await getDomainServiceRecords(token, move.domain);
      const collector = await getActiveDmarcCollectorEmail(supabase, move.organization_id);
      const canonical = generateM365DnsRecords(move.domain, [], service, collector ?? undefined);
      const dns = await dnsClientFor(move.domain);

      const mx = canonical.filter((r) => r.type === 'MX');
      const spf = canonical.filter((r) => r.type === 'TXT' && /^v=spf1/i.test(r.value) && rel(move.domain, r.name) === '');
      const autodiscover = canonical.filter((r) => r.type === 'CNAME' && rel(move.domain, r.name) === 'autodiscover');
      const dmarc = canonical.filter((r) => r.type === 'TXT' && rel(move.domain, r.name) === '_dmarc');

      if (mx.length === 0 || spf.length === 0) return { wait: MINUTE, note: 'target has not issued MX/SPF service records yet' };

      // Apex MX must point only at the new tenant. Subdomain MX (e.g. an SES
      // feedback record) is left alone.
      await replaceRecords(dns, move.domain, 'MX', '', () => true, mx);
      await replaceRecords(dns, move.domain, 'TXT', '', (v) => /^v=spf1/i.test(v), spf);
      if (autodiscover.length) await replaceRecords(dns, move.domain, 'CNAME', 'autodiscover', () => true, autodiscover);
      // Exactly one DMARC record: two (as last10legal.com had) makes DMARC invalid.
      if (dmarc.length) await replaceRecords(dns, move.domain, 'TXT', '_dmarc', () => true, dmarc.slice(0, 1));

      const dkimConfig = await enableDkimSigning(token, to.tenant_id, move.domain);
      const dkim: DnsRecord[] = dkimConfig ? buildDkimDnsRecords(move.domain, dkimConfig) : [];
      for (const r of dkim) {
        await replaceRecords(dns, move.domain, 'CNAME', rel(move.domain, r.name), () => true, [r]);
      }

      await supabase.from('email_sending_domains').update({
        dns_records: [...canonical, ...dkim],
        spf_verified: true,
        dmarc_verified: dmarc.length > 0,
        last_dns_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', move.domain_id);

      return {
        next: 'enable_dkim',
        waitMs: 2 * MINUTE,
        note: `published MX, SPF, autodiscover, DMARC${dkim.length ? ', DKIM CNAMEs' : ' (DKIM selectors not issued yet)'}`,
      };
    }

    case 'enable_dkim': {
      const token = await getM365Token(to.tenant_id);
      const config = await enableDkimSigning(token, to.tenant_id, move.domain);
      if (config?.Enabled) {
        await supabase.from('email_sending_domains').update({ dkim_verified: true, dns_status: 'verified' }).eq('id', move.domain_id);
        return { next: 'reprovision_mailboxes', note: 'DKIM signing enabled' };
      }
      if ((move.step_attempts ?? 0) + 1 >= MAX_ATTEMPTS.enable_dkim) {
        // Mail flows without DKIM; do not hold 50 inboxes hostage to it.
        return { next: 'reprovision_mailboxes', note: `DKIM still not enabled (${config?.Status ?? 'unknown'}) — continuing; run repair_dkim later` };
      }
      if (config?.Selector1CNAME) {
        const dns = await dnsClientFor(move.domain);
        for (const r of buildDkimDnsRecords(move.domain, config)) {
          await replaceRecords(dns, move.domain, 'CNAME', rel(move.domain, r.name), () => true, [r]);
        }
      }
      return { wait: 2 * MINUTE, note: `DKIM status ${config?.Status ?? 'unknown'}` };
    }

    case 'reprovision_mailboxes': {
      if (!move.provisioning_job_id) {
        if (move.mailboxes.length === 0) return { next: 'verify_mailboxes', note: 'no mailboxes to re-create' };
        const { data: job, error } = await supabase
          .from('mailbox_provisioning_jobs')
          .insert({
            organization_id: move.organization_id,
            domain_id: move.domain_id,
            status: 'pending',
            total: move.mailboxes.length,
            mailboxes: move.mailboxes.map((m) => ({
              username: m.username,
              display_name: m.display_name,
              avatar_url: m.avatar_url,
              reprovision: true,
            })),
            generate_avatars: false,
          })
          .select('id')
          .single();
        if (error || !job) return { wait: MINUTE, note: `could not create provisioning job: ${error?.message}` };
        await supabase.from('domain_moves').update({ provisioning_job_id: job.id }).eq('id', move.id);
        await invokeFunction('infra-mailbox-provision', { action: 'resume_job', job_id: job.id });
        return { wait: 2 * MINUTE, note: `provisioning job ${job.id} started for ${move.mailboxes.length} mailboxes` };
      }

      const { data: job } = await supabase
        .from('mailbox_provisioning_jobs')
        .select('status, processed_index, total, created_count, failed_count, errors')
        .eq('id', move.provisioning_job_id)
        .single();
      if (!job) return { fail: 'provisioning job disappeared' };
      if (job.status === 'completed') {
        const failed = job.failed_count ?? 0;
        return {
          next: 'verify_mailboxes',
          waitMs: 3 * MINUTE,
          note: `re-created ${job.created_count}/${job.total}${failed ? `, ${failed} failed: ${JSON.stringify(job.errors).slice(0, 300)}` : ''}`,
        };
      }
      if (job.status === 'failed' || job.status === 'cancelled') return { fail: `provisioning job ${job.status}` };
      return { wait: 2 * MINUTE, note: `provisioning ${job.processed_index}/${job.total}` };
    }

    case 'verify_mailboxes': {
      const ids = move.mailboxes.map((m) => m.id);
      if (ids.length === 0) return { next: 'cancel_source' };
      await invokeFunction('infra-mailbox-capability-probe', { mailbox_ids: ids });
      const { data: rows } = await supabase.from('email_mailboxes').select('id, email_address, metadata').in('id', ids);
      const bad = (rows ?? []).filter((r: any) => !(r.metadata?.capability_probe?.can_send === true && r.metadata?.capability_probe?.can_receive === true));
      if (bad.length === 0) return { next: 'cancel_source', note: `all ${ids.length} mailboxes confirmed by Microsoft to send and receive` };
      if ((move.step_attempts ?? 0) + 1 >= MAX_ATTEMPTS.verify_mailboxes) {
        return { next: 'cancel_source', note: `${bad.length}/${ids.length} still not confirmed (${bad.slice(0, 5).map((b: any) => b.email_address).join(', ')}) — continuing; they recover via the retest cron` };
      }
      return { wait: 5 * MINUTE, note: `${bad.length}/${ids.length} not yet confirmed` };
    }

    case 'cancel_source': {
      if (!move.cancel_source_tenant) return { done: true, note: 'source tenant left as-is (cancel_source_tenant=false)' };

      // Never cancel a tenant that still carries anything live.
      const { data: remainingDomains } = await supabase
        .from('email_sending_domains')
        .select('id, domain')
        .eq('m365_tenant_id', from.id);
      const blockers: string[] = [];
      for (const d of remainingDomains ?? []) {
        const { count } = await supabase
          .from('email_mailboxes')
          .select('id', { count: 'exact', head: true })
          .eq('sending_domain_id', d.id)
          .neq('status', 'archived');
        if ((count ?? 0) > 0) blockers.push(`${d.domain} (${count} live mailboxes)`);
      }
      const { count: otherMoves } = await supabase
        .from('domain_moves')
        .select('id', { count: 'exact', head: true })
        .eq('from_tenant_id', from.id)
        .in('status', ['running', 'waiting'])
        .neq('id', move.id);
      if ((otherMoves ?? 0) > 0) blockers.push(`${otherMoves} other move(s) from this tenant still running`);
      if (blockers.length > 0) {
        return { done: true, note: `NOT cancelling source tenant — still carries: ${blockers.join('; ')}` };
      }

      const { data: order } = await supabase
        .from('tenant_orders')
        .select('id, status, pax8_subscription_id')
        .eq('organization_id', from.organization_id)
        .eq('m365_tenant_domain', from.onmicrosoft_domain)
        .maybeSingle();
      if (!order) return { done: true, note: `no tenant order for ${from.onmicrosoft_domain} — cancel the tenant manually` };
      if (order.status === 'cancelled') return { done: true, note: 'tenant order already cancelled' };

      const res = await invokeFunction('tenant-order-cancel', { tenantOrderId: order.id });
      if (!res.ok || res.body?.success !== true) {
        return { wait: 10 * MINUTE, note: `Pax8 cancellation failed: ${JSON.stringify(res.body).slice(0, 300)}` };
      }
      await supabase.from('m365_tenants').update({
        metadata: { ...(from as any).metadata, cancelled_at: new Date().toISOString(), cancelled_by_move: move.id },
        updated_at: new Date().toISOString(),
      }).eq('id', from.id);
      return { done: true, note: `cancelled tenant order ${order.id} (Pax8 subscription ${order.pax8_subscription_id})` };
    }
  }
}

// ── Plan / preflight checks ─────────────────────────────────────────────────

async function planChecks(supabase: SupabaseClient, organizationId: string, domainId: string, toTenantId: string) {
  const blocking: string[] = [];
  const info: string[] = [];

  if (!organizationId || !domainId || !toTenantId) {
    throw new Error('organization_id, domain_id and to_tenant_id are required');
  }

  const { data: domain } = await supabase
    .from('email_sending_domains')
    .select('*')
    .eq('id', domainId)
    .eq('organization_id', organizationId)
    .single();
  if (!domain) throw new Error('domain not found in this organization');

  if (domain.infra_type !== 'm365') blocking.push('domain is not an M365 domain');
  if (domain.health_status === 'burned' || domain.reputation_blocked_at) {
    blocking.push(`domain is burned (${domain.reputation_block_reason ?? domain.health_status}) — retire it instead of moving it`);
  }
  if (!domain.m365_tenant_id) blocking.push('domain has no source tenant');
  if (domain.m365_tenant_id === toTenantId) blocking.push('domain is already on the target tenant');

  const from = domain.m365_tenant_id ? await loadTenant(supabase, domain.m365_tenant_id).catch(() => null) : null;
  const to = await loadTenant(supabase, toTenantId).catch(() => null);
  if (!to) blocking.push('target tenant not found');
  if (to && to.organization_id !== organizationId) blocking.push('target tenant belongs to a different organization');

  // Roles the move needs. Missing roles on a freshly ordered tenant are usually
  // consent that has not propagated yet, so these wait rather than fail.
  for (const [label, tenant] of [['source', from], ['target', to]] as const) {
    if (!tenant) continue;
    try {
      const token = await getM365Token(tenant.tenant_id);
      const domainWrite = await checkSendAppRole(token, DOMAIN_READWRITE_ALL_ROLE_ID);
      if (domainWrite.consented === false) blocking.push(`[wait] ${label} tenant ${tenant.admin_email}: ACA app lacks Domain.ReadWrite.All`);
      if (label === 'target') {
        const mailSend = await checkSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID);
        if (mailSend.consented === false) blocking.push(`[wait] target tenant ${tenant.admin_email}: ACA app lacks Mail.Send`);
        const has = await getDomainOrNull(token, domain.domain);
        if (has) info.push('target tenant already lists the domain (will be reused)');
      } else {
        const has = await getDomainOrNull(token, domain.domain);
        info.push(has ? 'source tenant holds the domain' : 'source tenant no longer holds the domain');
      }
    } catch (err) {
      blocking.push(`[wait] ${label} tenant ${tenant.admin_email}: cannot get a token (${errMsg(err)})`);
    }
  }

  // DNS host must be writable, or the move would strand the domain half-way.
  try {
    const dns = await dnsClientFor(domain.domain);
    await dns.listDnsRecords(domain.domain);
    info.push(`DNS host writable (${await nameserverHost(domain.domain)})`);
  } catch (err) {
    blocking.push(`DNS: ${errMsg(err)}`);
  }

  const { data: mbx } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, display_name, status, metadata')
    .eq('sending_domain_id', domainId)
    .neq('status', 'archived');
  const mailboxes: MovedMailbox[] = (mbx ?? []).map((m: any) => ({
    id: m.id,
    email: m.email_address,
    username: String(m.email_address).split('@')[0],
    display_name: m.display_name || String(m.email_address).split('@')[0],
    avatar_url: m.metadata?.avatar_url,
    prev_status: m.status,
  }));

  return {
    domain: domain.domain as string,
    from_tenant_id: domain.m365_tenant_id as string,
    from_admin: from?.admin_email ?? null,
    to_admin: to?.admin_email ?? null,
    mailbox_count: mailboxes.length,
    mailboxes,
    blocking,
    info,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadTenant(supabase: SupabaseClient, id: string): Promise<TenantRow> {
  const { data, error } = await supabase.from('m365_tenants').select('*').eq('id', id).single();
  if (error || !data) throw new Error(`tenant ${id} not found`);
  return data as TenantRow;
}

async function nameserverHost(domain: string): Promise<string> {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=NS`);
  const data = await res.json();
  const ns = (data?.Answer ?? []).map((a: any) => String(a.data).toLowerCase());
  if (ns.some((n: string) => n.includes('vercel-dns.com'))) return 'vercel';
  if (ns.some((n: string) => n.includes('cloudflare.com'))) return 'cloudflare';
  if (ns.some((n: string) => n.includes('porkbun.com'))) return 'porkbun';
  return ns[0] ?? 'unknown';
}

async function dnsClientFor(domain: string): Promise<RegistrarClient> {
  const host = await nameserverHost(domain);
  if (host === 'vercel') {
    const token = Deno.env.get('VERCEL_TOKEN');
    if (!token) throw new Error('domain DNS is on Vercel but VERCEL_TOKEN is not set');
    return new VercelDnsClient(token, Deno.env.get('VERCEL_TEAM_ID') ?? undefined);
  }
  throw new Error(`DNS for ${domain} is hosted on "${host}", which infra-domain-move cannot write yet (supported: Vercel)`);
}

function rel(domain: string, name: string): string {
  return VercelDnsClient.relativeName(domain, name);
}

/**
 * Replace records of one type at one name: delete the existing ones that
 * `owned` matches, then create the new set. Records `owned` rejects are left
 * untouched (a Google verification TXT at the apex survives an SPF swap).
 */
async function replaceRecords(
  dns: RegistrarClient,
  domain: string,
  type: string,
  relName: string,
  owned: (value: string) => boolean,
  desired: DnsRecord[],
) {
  const current = await dns.listDnsRecords(domain);
  const norm = (v: string) => (v || '').replace(/\.$/, '').toLowerCase();
  const wanted = new Set(desired.map((d) => norm(d.value)));
  for (const r of current) {
    if (r.type !== type || rel(domain, r.name) !== relName || !owned(r.value)) continue;
    if (wanted.has(norm(r.value))) continue; // already correct, keep it
    const res = await dns.deleteDnsRecord(domain, type, relName, r.value);
    if (!res.success) throw new Error(`delete ${type} ${relName || '@'} ${r.value}: ${res.error}`);
  }
  const after = await dns.listDnsRecords(domain);
  for (const d of desired) {
    const exists = after.some((r) => r.type === type && rel(domain, r.name) === relName && norm(r.value) === norm(d.value));
    if (exists) continue;
    const res = await dns.createDnsRecord(domain, {
      type: d.type,
      name: relName,
      value: d.value,
      ttl: d.ttl ?? 3600,
      priority: d.priority,
    });
    if (!res.success) throw new Error(`create ${type} ${relName || '@'} ${d.value}: ${res.error}`);
  }
}

async function restoreMailboxes(supabase: SupabaseClient, move: MoveRow) {
  for (const m of move.mailboxes ?? []) {
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: m.id, p_set: {}, p_unset: ['paused_reason', 'paused_at', 'domain_move_id'],
    });
    await supabase.from('email_mailboxes').update({ status: m.prev_status, updated_at: new Date().toISOString() }).eq('id', m.id);
  }
}

async function invokeFunction(name: string, payload: unknown): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, body };
}

function logEntry(step: string, message: string) {
  return { at: new Date().toISOString(), step, message };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}
