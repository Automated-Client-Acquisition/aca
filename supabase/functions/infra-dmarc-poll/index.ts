/**
 * DMARC rua report collector — bootstrap + poll.
 *
 * Root cause this exists: every cold-email sending domain's _dmarc TXT record
 * has `rua=mailto:dmarc@<domain>`, but no dmarc@<domain> mailbox was ever
 * provisioned. Every aggregate report since these domains started sending has
 * been silently bounced by M365. `infra-dmarc-ingest` + `dmarc-parser.ts` +
 * `email_dmarc_reports` (Phase 8.2) were built but never wired to a real
 * inbox, so email_dmarc_reports has stayed empty.
 *
 * Fix: ONE shared collector mailbox per org (dmarc-reports@<a healthy domain>)
 * instead of 44 separate mailboxes. Every other domain authorizes it as an
 * external rua destination (RFC 7489 §7.1: `<domain>._report._dmarc.<collector
 * domain>` = "v=DMARC1"), and each domain's own rua= is repointed there.
 *
 * Two modes, both POST:
 *
 *   Bootstrap (run once per org, or again to add a fallback collector):
 *     { action: "bootstrap", organization_id, source_domain, local_part? }
 *   Creates the shared mailbox on source_domain's M365 tenant via Graph-only
 *   access (no SMTP AUTH setup needed — this mailbox is never used to send).
 *   Returns the external-authorization TXT record every reporting domain needs.
 *
 *   Poll (cron, no body / any body without "action"):
 *   Iterates every active dmarc_collector_mailboxes row across all orgs,
 *   reads new attachments, parses them, upserts into email_dmarc_reports —
 *   the same table and upsert shape infra-dmarc-ingest uses, so both paths
 *   stay interchangeable.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  listUnreadMessagesWithAttachments,
  listMessageAttachments,
  downloadAttachmentBytes,
  markMessageRead,
  ensureExoServicePrincipal,
  ensureExchangeRecipientAdminRole,
  createSharedMailbox,
  resolveUserIdByEmail,
  getEXOToken,
  M365Error,
} from '../_shared/m365-client.ts';
import { parseDmarcReport, decompressGz, extractZipXmlEntries } from '../_shared/dmarc-parser.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

interface BootstrapBody {
  action: 'bootstrap';
  organization_id: string;
  source_domain: string;
  local_part?: string;
}

async function decodeAttachmentToXmlTexts(name: string, bytes: Uint8Array): Promise<string[]> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gz')) return [await decompressGz(bytes)];
  if (lower.endsWith('.zip')) return (await extractZipXmlEntries(bytes)).map((e) => e.text);
  if (lower.endsWith('.xml')) return [new TextDecoder().decode(bytes)];
  return [];
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  // ==========================================================================
  // Bootstrap: create the shared collector mailbox once.
  // ==========================================================================
  if (body.action === 'bootstrap') {
    const { organization_id, source_domain, local_part } = body as unknown as BootstrapBody;
    if (!organization_id || !source_domain) {
      return jsonResponse({ success: false, error: 'organization_id and source_domain are required' }, 400);
    }
    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }
    const localPart = (local_part || 'dmarc-reports').toLowerCase();
    const collectorAddress = `${localPart}@${source_domain}`;

    const { data: existing } = await supabase
      .from('dmarc_collector_mailboxes')
      .select('*')
      .eq('organization_id', organization_id)
      .eq('email_address', collectorAddress)
      .maybeSingle();
    if (existing) {
      return jsonResponse({
        success: true,
        already_existed: true,
        collector: existing,
        authorization_record: `${source_domain} needs external-report authorization from every reporting domain — see next step below.`,
      });
    }

    const { data: domain, error: domainErr } = await supabase
      .from('email_sending_domains')
      .select('id, domain, m365_tenant_id')
      .eq('organization_id', organization_id)
      .eq('domain', source_domain)
      .maybeSingle();
    if (domainErr || !domain) return jsonResponse({ success: false, error: `Domain ${source_domain} not found for this org` }, 404);
    if (!domain.m365_tenant_id) return jsonResponse({ success: false, error: `${source_domain} has no M365 tenant on file` }, 400);

    const { data: tenant, error: tenantErr } = await supabase
      .from('m365_tenants')
      .select('id, tenant_id')
      .eq('id', domain.m365_tenant_id)
      .maybeSingle();
    if (tenantErr || !tenant) return jsonResponse({ success: false, error: 'M365 tenant not found' }, 404);

    try {
      const [graphToken, exoToken] = await Promise.all([getM365Token(tenant.tenant_id), getEXOToken(tenant.tenant_id)]);

      // Idempotent EXO app-only prerequisites (mirrors infra-mailbox-provision).
      await ensureExoServicePrincipal(graphToken);
      await ensureExchangeRecipientAdminRole(graphToken);

      let mailboxUser: { id: string; userPrincipalName: string } | null = null;
      const delaysMs = [5_000, 15_000, 45_000, 90_000];
      for (let attempt = 1; attempt <= delaysMs.length + 1; attempt++) {
        try {
          mailboxUser = await createSharedMailbox(exoToken, tenant.tenant_id, {
            displayName: 'DMARC Reports',
            mailNickname: localPart,
            emailAddress: collectorAddress,
          });
          break;
        } catch (err) {
          const m365Err = err as M365Error;
          const isPropagationError = m365Err.code === 'EXO_ERROR' && m365Err.message?.includes("isn't supported in this scenario");
          if (!isPropagationError || attempt > delaysMs.length) throw err;
          await new Promise((r) => setTimeout(r, delaysMs[attempt - 1]));
        }
      }
      if (!mailboxUser) throw new Error('Failed to create shared mailbox after retries');

      // Graph read is all this mailbox needs — no SMTP AUTH / password setup,
      // unlike sending mailboxes. Resolve the Graph user id with light retry
      // for the same replication lag infra-mailbox-provision documents.
      let userId: string | null = null;
      for (const wait of [2_000, 5_000, 10_000, 20_000, 0]) {
        try {
          userId = await resolveUserIdByEmail(graphToken, collectorAddress);
          break;
        } catch (e) {
          if (wait === 0) throw e;
          await new Promise((r) => setTimeout(r, wait));
        }
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('dmarc_collector_mailboxes')
        .insert({
          organization_id,
          m365_tenant_id: domain.m365_tenant_id,
          email_address: collectorAddress,
          m365_user_id: userId,
          status: 'active',
        })
        .select()
        .single();
      if (insertErr) return jsonResponse({ success: false, error: insertErr.message }, 500);

      return jsonResponse({
        success: true,
        collector: inserted,
        next_steps: [
          `Add rua=mailto:${collectorAddress} to _dmarc TXT on every reporting domain.`,
          `Unless the reporting domain IS ${source_domain}, also add an authorization record on ${source_domain}: TXT "<reporting-domain>._report._dmarc.${source_domain}" = "v=DMARC1" (RFC 7489 §7.1) — receivers discard rua reports to an off-domain mailbox without it.`,
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ success: false, error: `Bootstrap failed: ${msg}` }, 500);
    }
  }

  // ==========================================================================
  // Poll: read + parse + upsert for every active collector mailbox.
  // ==========================================================================
  const organizationIdFilter = (body.organization_id as string | undefined) ?? undefined;
  // Polling every org is the daily cron's job (service key); a scoped poll needs org access.
  if (organizationIdFilter) {
    try {
      await assertOrgAccess(req, supabase, organizationIdFilter);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }
  } else if (!isServiceRoleRequest(req)) {
    return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
  }
  let query = supabase.from('dmarc_collector_mailboxes').select('*').eq('status', 'active');
  if (organizationIdFilter) query = query.eq('organization_id', organizationIdFilter);
  const { data: collectors, error: collectorsErr } = await query;
  if (collectorsErr) return jsonResponse({ success: false, error: collectorsErr.message }, 500);

  const totals = { collectorsPolled: 0, messagesSeen: 0, reportsUpserted: 0, parseFailures: 0, errors: 0 };

  for (const collector of (collectors ?? []) as Array<{
    id: string; organization_id: string; m365_tenant_id: string; email_address: string; m365_user_id: string | null;
  }>) {
    totals.collectorsPolled++;
    if (!collector.m365_user_id) {
      totals.errors++;
      await supabase.from('dmarc_collector_mailboxes').update({ status: 'error', last_error: 'm365_user_id missing' }).eq('id', collector.id);
      continue;
    }

    const { data: tenant } = await supabase.from('m365_tenants').select('tenant_id').eq('id', collector.m365_tenant_id).maybeSingle();
    if (!tenant?.tenant_id) {
      totals.errors++;
      continue;
    }

    try {
      const messages = await listUnreadMessagesWithAttachments(tenant.tenant_id, collector.m365_user_id, { top: 50 });
      totals.messagesSeen += messages.length;

      for (const msg of messages) {
        try {
          const attachments = await listMessageAttachments(tenant.tenant_id, collector.m365_user_id, msg.id);
          for (const att of attachments) {
            const bytes = await downloadAttachmentBytes(tenant.tenant_id, collector.m365_user_id, msg.id, att.id);
            let xmlTexts: string[];
            try {
              xmlTexts = await decodeAttachmentToXmlTexts(att.name, bytes);
            } catch (e) {
              console.warn(`[dmarc-poll] failed to decode ${att.name} on message ${msg.id}: ${e instanceof Error ? e.message : e}`);
              totals.parseFailures++;
              continue;
            }

            for (const xml of xmlTexts) {
              const parsed = parseDmarcReport(xml);
              if (!parsed) {
                totals.parseFailures++;
                continue;
              }

              let domainId: string | null = null;
              if (parsed.policy_domain) {
                const { data: domainRow } = await supabase
                  .from('email_sending_domains')
                  .select('id')
                  .eq('organization_id', collector.organization_id)
                  .eq('domain', parsed.policy_domain.toLowerCase())
                  .maybeSingle();
                domainId = (domainRow as { id: string } | null)?.id ?? null;
              }

              const { error: upsertErr } = await supabase
                .from('email_dmarc_reports')
                .upsert({
                  organization_id: collector.organization_id,
                  domain_id: domainId,
                  report_id: parsed.report_id,
                  org_name: parsed.org_name,
                  report_email: parsed.report_email,
                  report_date_range_begin: parsed.date_range_begin.toISOString(),
                  report_date_range_end: parsed.date_range_end.toISOString(),
                  policy_domain: parsed.policy_domain,
                  policy_p: parsed.policy_p,
                  policy_pct: parsed.policy_pct,
                  total_messages: parsed.total_messages,
                  spf_pass_count: parsed.spf_pass_count,
                  dkim_pass_count: parsed.dkim_pass_count,
                  dmarc_pass_count: parsed.dmarc_pass_count,
                  alignment_failures: parsed.alignment_failures,
                  raw_xml: xml.length > 1024 * 200 ? null : xml,
                }, { onConflict: 'organization_id,report_id,org_name' });
              if (upsertErr) {
                console.warn(`[dmarc-poll] upsert failed for report ${parsed.report_id}: ${upsertErr.message}`);
                totals.errors++;
              } else {
                totals.reportsUpserted++;
              }
            }
          }
          await markMessageRead(tenant.tenant_id, collector.m365_user_id, msg.id);
        } catch (e) {
          totals.errors++;
          console.warn(`[dmarc-poll] message ${msg.id} failed: ${e instanceof Error ? e.message : e}`);
        }
      }

      await supabase.from('dmarc_collector_mailboxes').update({ status: 'active', last_polled_at: new Date().toISOString(), last_error: null }).eq('id', collector.id);
    } catch (e) {
      totals.errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[dmarc-poll] collector ${collector.email_address} failed: ${msg}`);
      await supabase.from('dmarc_collector_mailboxes').update({ last_error: msg }).eq('id', collector.id);
    }
  }

  return jsonResponse({ success: true, ...totals });
});
