/**
 * M365 Consent Audit
 *
 * Reports, per tenant, whether the "ACA Email Infra" app actually holds the Graph
 * application roles the platform depends on:
 *
 *   Mail.Send      — required to send at all (campaigns, sequences, warmup)
 *   Mail.ReadWrite — required by the warmup receive tick to detect inbox-vs-junk
 *                    placement and move mail out of Junk
 *
 * WHY THIS EXISTS: Mail.Send was added to the app registration after some tenants
 * had already been admin-consented. Those tenants hold a *stale* consent granting
 * every other role but not Mail.Send, and their mailboxes then fail with
 * "Access is denied" — silently, from the operator's point of view, because the
 * failure looks like an ordinary per-send error. The warmup pilot surfaced this
 * again: several sends and replies failed this way, and one mailbox could not send
 * at all. Consent *date* is not a usable proxy (re-consent was applied per tenant,
 * not by date), so only a live appRoleAssignments read is truth.
 *
 * It also attempts a headless self-heal: on tenants where the app already holds
 * AppRoleAssignment.ReadWrite.All, a missing role can be granted without a human.
 * Tenants that cannot self-heal are returned in `needsAdminConsent` — that list is
 * the actual work item for a Global Admin.
 *
 * GET/POST. Body: { "grant": true } to attempt the self-heal (default false —
 * dry-run reporting only).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  checkSendAppRole,
  grantSendAppRole,
  GRAPH_MAIL_SEND_ROLE_ID,
  GRAPH_MAIL_READWRITE_ROLE_ID,
} from '../_shared/m365-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TenantReport {
  tenantId: string;
  adminEmail: string;
  organizationId: string;
  mailboxes: number;
  mailSend: boolean | null;
  mailReadWrite: boolean | null;
  granted?: string[];
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let attemptGrant = false;
  try {
    const body = await req.json().catch(() => ({}));
    attemptGrant = body?.grant === true;
  } catch { /* no body */ }

  try {
    const { data: tenants, error } = await supabase
      .from('m365_tenants')
      .select('tenant_id, admin_email, organization_id');
    if (error) throw new Error(`Failed to load tenants: ${error.message}`);

    // Mailbox counts make the report actionable: a tenant with 100 mailboxes and
    // no Mail.Send is a different priority from one with 2.
    const { data: mailboxes } = await supabase
      .from('email_mailboxes')
      .select('organization_id, metadata')
      .in('status', ['ready', 'warming']);

    const mailboxCount = new Map<string, number>();
    for (const m of mailboxes || []) {
      const admin = (m.metadata as Record<string, unknown> | null)?.m365_admin_email as string | undefined;
      if (!admin) continue;
      const key = `${m.organization_id}:${admin}`;
      mailboxCount.set(key, (mailboxCount.get(key) ?? 0) + 1);
    }

    const reports: TenantReport[] = [];

    for (const t of tenants || []) {
      const report: TenantReport = {
        tenantId: t.tenant_id,
        adminEmail: t.admin_email,
        organizationId: t.organization_id,
        mailboxes: mailboxCount.get(`${t.organization_id}:${t.admin_email}`) ?? 0,
        mailSend: null,
        mailReadWrite: null,
      };

      try {
        const token = await getM365Token(t.tenant_id);
        const [send, rw] = await Promise.all([
          checkSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID),
          checkSendAppRole(token, GRAPH_MAIL_READWRITE_ROLE_ID),
        ]);
        report.mailSend = send.consented;
        report.mailReadWrite = rw.consented;
        if (send.error || rw.error) report.error = send.error || rw.error;

        if (attemptGrant) {
          const granted: string[] = [];
          if (send.consented === false) {
            const g = await grantSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID);
            if (g.granted) { granted.push('Mail.Send'); report.mailSend = true; }
          }
          if (rw.consented === false) {
            const g = await grantSendAppRole(token, GRAPH_MAIL_READWRITE_ROLE_ID);
            if (g.granted) { granted.push('Mail.ReadWrite'); report.mailReadWrite = true; }
          }
          if (granted.length) report.granted = granted;
        }
      } catch (e) {
        report.error = e instanceof Error ? e.message : String(e);
      }

      reports.push(report);
    }

    // Anything still missing a role after the self-heal attempt genuinely requires
    // a Global Admin. Sorted by blast radius so the biggest tenants come first.
    const needsAdminConsent = reports
      .filter((r) => r.mailSend === false || r.mailReadWrite === false)
      .sort((a, b) => b.mailboxes - a.mailboxes);

    const undetermined = reports.filter((r) => r.mailSend === null || r.mailReadWrite === null);

    return json({
      success: true,
      tenants: reports.length,
      healthy: reports.filter((r) => r.mailSend === true && r.mailReadWrite === true).length,
      mailSendMissing: reports.filter((r) => r.mailSend === false).length,
      mailReadWriteMissing: reports.filter((r) => r.mailReadWrite === false).length,
      selfHealed: reports.filter((r) => r.granted?.length).length,
      mailboxesBlocked: needsAdminConsent.reduce((n, r) => n + r.mailboxes, 0),
      needsAdminConsent,
      undetermined,
      reports,
    });
  } catch (error) {
    console.error('[Consent Audit] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
