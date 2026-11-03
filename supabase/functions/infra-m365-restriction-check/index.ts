/**
 * M365 Outbound Restriction Check — read-only.
 *
 * Asks Exchange Online whether Microsoft has restricted a tenant's users from
 * sending (Get-BlockedSenderAddress: the "Restricted entities" list that outbound
 * spam protection populates). A restricted sender still gets a 202 from Graph and
 * the message is then silently dropped, so ACA's own send log cannot see it — the
 * only symptom is warmup placement coming back 'missing' for everything.
 *
 * Optionally runs Get-MessageTraceV2 for a sender, which says whether Microsoft
 * delivered, quarantined, filtered or failed each message — the distinction
 * between "our tenant can't send" and "recipients quarantine this domain".
 *
 * Changes nothing.
 * Body: { admin_emails: string[], trace?: { sender: string, start: ISO, end: ISO } }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getEXOToken, exoInvokeCommand } from '../_shared/m365-client.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const adminEmails: string[] = body.admin_emails ?? [];

  const results: unknown[] = [];
  for (const adminEmail of adminEmails) {
    const { data: t } = await supabase
      .from('m365_tenants').select('tenant_id, admin_email').eq('admin_email', adminEmail).maybeSingle();
    if (!t?.tenant_id) { results.push({ adminEmail, error: 'tenant not found' }); continue; }
    const onmicrosoft = adminEmail.split('@')[1];
    try {
      const token = await getEXOToken(t.tenant_id);
      const blocked = await exoInvokeCommand(token, t.tenant_id, onmicrosoft, 'Get-BlockedSenderAddress', {});
      const rows = (blocked?.value ?? blocked ?? []) as Array<Record<string, unknown>>;
      let trace: unknown = undefined;
      if (body.trace?.sender && body.trace.sender.endsWith('@' + '') === false) {
        try {
          const tr = await exoInvokeCommand(token, t.tenant_id, onmicrosoft, 'Get-MessageTraceV2', {
            SenderAddress: body.trace.sender,
            StartDate: body.trace.start,
            EndDate: body.trace.end,
          });
          const trows = (tr?.value ?? tr ?? []) as Array<Record<string, unknown>>;
          const byStatus: Record<string, number> = {};
          for (const r of Array.isArray(trows) ? trows : []) {
            const st = String(r.Status ?? 'unknown');
            byStatus[st] = (byStatus[st] ?? 0) + 1;
          }
          // Pull the failure reason for the first failed message: the SMTP code
          // (e.g. 5.7.705 tenant exceeded threshold) is what distinguishes a
          // tenant-level block from a fixable per-domain problem.
          let detail: unknown = undefined;
          const firstFailed = (Array.isArray(trows) ? trows : []).find((r) => r.Status === 'Failed');
          if (firstFailed?.MessageTraceId) {
            try {
              const dt = await exoInvokeCommand(token, t.tenant_id, onmicrosoft, 'Get-MessageTraceDetailV2', {
                MessageTraceId: firstFailed.MessageTraceId,
                RecipientAddress: firstFailed.RecipientAddress,
              });
              const drows = (dt?.value ?? dt ?? []) as Array<Record<string, unknown>>;
              detail = (Array.isArray(drows) ? drows : []).map((d) => ({
                event: d.Event, action: d.Action, detail: String(d.Detail ?? '').slice(0, 400),
              }));
            } catch (err) {
              detail = { error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
            }
          }
          trace = {
            failure_detail: detail,
            messages: Array.isArray(trows) ? trows.length : null,
            by_status: byStatus,
            sample: Array.isArray(trows)
              ? trows.slice(0, 6).map((r) => ({ to: r.RecipientAddress, status: r.Status, subject: String(r.Subject ?? '').slice(0, 60), received: r.Received }))
              : trows,
          };
        } catch (err) {
          trace = { error: err instanceof Error ? err.message.slice(0, 400) : String(err) };
        }
      }
      // Read-only passthrough, restricted to Get-* cmdlets so this function can
      // never change tenant state.
      const commands: Record<string, unknown> = {};
      for (const c of (body.commands ?? []) as Array<{ name: string; params?: Record<string, unknown> }>) {
        if (!/^Get-[A-Za-z0-9]+$/.test(c.name)) { commands[c.name] = { error: 'only Get-* cmdlets allowed' }; continue; }
        try {
          const out = await exoInvokeCommand(token, t.tenant_id, onmicrosoft, c.name, c.params ?? {});
          const rows = (out?.value ?? out ?? []) as Array<Record<string, unknown>>;
          commands[c.name] = Array.isArray(rows) ? rows.slice(0, 50) : rows;
        } catch (err) {
          commands[c.name] = { error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
        }
      }
      results.push({
        adminEmail,
        commands,
        trace,
        restricted_count: Array.isArray(rows) ? rows.length : null,
        sample: Array.isArray(rows)
          ? rows.slice(0, 5).map((r) => ({ sender: r.SenderAddress, reason: r.Reason, created: r.CreatedDatetime }))
          : rows,
      });
    } catch (err) {
      results.push({ adminEmail, error: err instanceof Error ? err.message.slice(0, 400) : String(err) });
    }
  }
  return new Response(JSON.stringify({ success: true, results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
