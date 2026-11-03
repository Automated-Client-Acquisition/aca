import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { getOrgRecipients } from "./dkim-drift-notifier.ts";
import { receiverScopeLabel, type ReceiverProvider } from "./receiver-reputation.ts";
import { fromAddress } from "./site-config.ts";

export const WARNING_NOTE_PREFIX = "EARLY WARNING";

interface WarningParams {
  domainId: string;
  domain: string;
  organizationId: string;
  healthStatus: string | null;
  blockCount: number;
  reconciledCount: number;
  windowHours: number;
  sample: string;
  provider: ReceiverProvider;
  /** Expanded/high-severity observations are recorded in-app only. */
  notify?: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmail(p: WarningParams): { subject: string; html: string } {
  const pct = ((p.blockCount / Math.max(p.reconciledCount, 1)) * 100).toFixed(1);
  return {
    subject: `Heads up: ${p.domain} is starting to get reputation blocks`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
        <h1 style="font-size:20px;margin:0 0 16px">Early warning for ${escapeHtml(p.domain)}</h1>
        <p style="line-height:1.6">In the last ${p.windowHours} hours, <strong>${p.blockCount}</strong> of ${p.reconciledCount} confirmed outcomes (${pct}%) from <strong>${escapeHtml(p.domain)}</strong> to ${escapeHtml(receiverScopeLabel(p.provider))} were refused for sender reputation. Both counts cover the same recipient scope; this does not describe all recipient providers or all mailboxes.</p>
        <p style="line-height:1.6">Monitoring continues without changing sending status or volume. You can choose to pause or resume the domain in ACA.</p>
        <p style="line-height:1.6;font-size:13px;color:#6b7280">Example rejection:<br><code style="word-break:break-all">${escapeHtml(p.sample)}</code></p>
        <p style="line-height:1.6">Worth checking: whether the blocks keep coming, reply and spam rates for this domain against its usual baseline, and whether to lower its volume or move some mailboxes to another domain.</p>
        <p style="line-height:1.6;margin-top:24px">— The ACA team</p>
      </div>`,
  };
}

/**
 * Records provider-scoped health observations, without changing sendability.
 * Existing early warnings may email owners/admins once per domain/window;
 * expanded high-severity observations only appear in the existing health log.
 * Never changes domain state and never throws.
 */
export async function warnDomainReputation(
  supabase: SupabaseClient,
  p: WarningParams,
): Promise<{ warned: boolean; reason?: string }> {
  try {
    const since = new Date(Date.now() - p.windowHours * 3600_000).toISOString();
    const prefix = `${WARNING_NOTE_PREFIX} [${p.provider}]`;
    const { count: recent, error: dedupeErr } = await supabase
      .from("email_domain_health_log")
      .select("id", { count: "exact", head: true })
      .eq("domain_id", p.domainId)
      .like("notes", `${prefix}%`)
      .gte("recorded_at", since);
    if (dedupeErr) return { warned: false, reason: "dedupe_lookup_failed" };
    if ((recent ?? 0) > 0) return { warned: false, reason: "already_warned" };

    // Preserve the previous once-per-domain/window notification frequency even
    // when multiple receiver providers now produce separate observations.
    let alreadyNotified = false;
    if (p.notify !== false) {
      const { count, error } = await supabase.from("email_domain_health_log")
        .select("id", { count: "exact", head: true })
        .eq("domain_id", p.domainId)
        .like("notes", `${WARNING_NOTE_PREFIX}%`)
        .gte("recorded_at", since);
      if (error) return { warned: false, reason: "dedupe_lookup_failed" };
      alreadyNotified = (count ?? 0) > 0;
    }

    const pct = ((p.blockCount / Math.max(p.reconciledCount, 1)) * 100).toFixed(1);
    const { error: logErr } = await supabase.from("email_domain_health_log").insert({
      domain_id: p.domainId,
      domain_health: p.healthStatus,
      notes: `${prefix}: ${p.blockCount}/${p.reconciledCount} confirmed outcomes to ${receiverScopeLabel(p.provider)} in ${p.windowHours}h refused for sender reputation (${pct}%). Recipient-provider scope only; not all providers/mailboxes. Monitoring continues; sending unchanged. Operator may pause/resume the domain. Sample: ${p.sample.slice(0, 300)}`,
    });
    if (logErr) {
      console.error(`[reputation-warning] log insert failed for ${p.domain}: ${logErr.message}`);
      return { warned: false, reason: "log_insert_failed" };
    }

    if (p.notify === false || alreadyNotified) {
      return { warned: true, reason: "logged_only" };
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      console.warn(`[reputation-warning] RESEND_API_KEY missing, logged only for ${p.domain}`);
      return { warned: true, reason: "logged_only_no_api_key" };
    }
    const recipients = await getOrgRecipients(supabase, p.organizationId);
    if (recipients.length === 0) {
      console.warn(`[reputation-warning] no owner/admin recipients for org ${p.organizationId}, logged only`);
      return { warned: true, reason: "logged_only_no_recipients" };
    }

    const from = Deno.env.get("DKIM_DRIFT_FROM_EMAIL")
      ?? Deno.env.get("TENANT_ORDER_FROM_EMAIL")
      ?? fromAddress("team");
    const { subject, html } = buildEmail(p);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    if (!res.ok) {
      console.error(`[reputation-warning] Resend failed for ${p.domain}: ${res.status} ${await res.text()}`);
      return { warned: true, reason: `logged_only_http_${res.status}` };
    }
    console.log(`[reputation-warning] emailed ${recipients.length} recipient(s) about ${p.domain}`);
    return { warned: true };
  } catch (err) {
    console.error(`[reputation-warning] unexpected error for ${p.domain}:`, err);
    return { warned: false, reason: "error" };
  }
}
