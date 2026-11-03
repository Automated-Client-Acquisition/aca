// ============================================================================
// infra-m365-contact-alias
// ----------------------------------------------------------------------------
// Makes contact@<domain> a working address on each cold-email sending domain,
// and redirects it to a real human inbox.
//
// The landing pages (outbound-sites/) publish contact@<domain>. Without this,
// every one of those addresses bounces.
//
// Two steps per domain, both idempotent:
//
//  1. ALIAS. Add `smtp:contact@<domain>` as a SECONDARY address on an existing
//     mailbox, so Exchange accepts mail for it. No new licence is consumed.
//
//     The `smtp:` prefix MUST be lowercase. Uppercase `SMTP:` sets the PRIMARY
//     address, which would rewrite the From on a live sending mailbox and break
//     its reputation. We verify PrimarySmtpAddress is unchanged afterwards.
//
//  2. TRANSPORT RULE. Redirect mail sent to contact@<domain> to the destination
//     inbox.
//
//     Deliberately a transport rule rather than mailbox forwarding: forwarding
//     is set on the mailbox and would redirect that mailbox's cold-outreach
//     replies too, which must stay in the ACA inbox. A rule scoped by recipient
//     touches only this one address. It also sidesteps the outbound spam policy
//     that blocks automatic external forwarding by default.
//
// POST body: { dryRun?: boolean, domain?: string, forwardTo?: string }
// Auth: x-site-secret must match SITE_LEAD_SHARED_SECRET.
// ============================================================================

import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getEXOToken, exoInvokeCommand } from "../_shared/m365-client.ts";
import { OPS_ALERT_EMAIL } from "../_shared/site-config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("SITE_LEAD_SHARED_SECRET") ?? "";

const DEFAULT_FORWARD_TO = OPS_ALERT_EMAIL;
const ALIAS_LOCAL = "contact";
const RULE_NAME = "ACA — redirect contact@ to inbox";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** EXO returns single objects or arrays depending on result count. */
function first(res: unknown): Record<string, unknown> | null {
  if (!res) return null;
  const v = (res as { value?: unknown }).value ?? res;
  return Array.isArray(v) ? (v[0] as Record<string, unknown>) ?? null : (v as Record<string, unknown>);
}
function asArray(res: unknown): Record<string, unknown>[] {
  if (!res) return [];
  const v = (res as { value?: unknown }).value ?? res;
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [v as Record<string, unknown>];
}

interface DomainResult {
  domain: string;
  hostMailbox?: string;
  alias: string;
  aliasAdded?: boolean;
  aliasAlreadyPresent?: boolean;
  ruleCreated?: boolean;
  ruleAlreadyPresent?: boolean;
  primarySmtpUnchanged?: boolean;
  error?: string;
}

async function processDomain(
  supabase: SupabaseClient<any>,
  domain: string,
  forwardTo: string,
  dryRun: boolean,
  debug = false,
): Promise<DomainResult> {
  const alias = `${ALIAS_LOCAL}@${domain}`;
  const out: DomainResult = { domain, alias };

  const { data: sd } = await supabase
    .from("email_sending_domains")
    .select("m365_tenant_id, m365_tenants!inner(tenant_id, onmicrosoft_domain, exo_consent_granted)")
    .eq("domain", domain)
    .maybeSingle();

  const tenant = (sd as Record<string, any> | null)?.m365_tenants;
  if (!tenant?.tenant_id) {
    out.error = "no M365 tenant linked to this domain";
    return out;
  }
  if (!tenant.exo_consent_granted) {
    out.error = "Exchange Online consent not granted for this tenant";
    return out;
  }

  // Host the alias on a real, ready mailbox. Ordering by address keeps the
  // choice stable across reruns, so we never scatter aliases about.
  const { data: mailboxes } = await supabase
    .from("email_mailboxes")
    .select("email_address")
    .eq("status", "ready")
    .ilike("email_address", `%@${domain}`)
    .order("email_address", { ascending: true })
    .limit(1);

  const host = mailboxes?.[0]?.email_address as string | undefined;
  if (!host) {
    out.error = "no ready mailbox on this domain to host the alias";
    return out;
  }
  out.hostMailbox = host;

  const token = await getEXOToken(tenant.tenant_id);
  const exo = (cmd: string, params: Record<string, unknown> = {}) =>
    exoInvokeCommand(token, tenant.tenant_id, tenant.onmicrosoft_domain, cmd, params);

  // ── 1. alias ──────────────────────────────────────────────────────────────
  const before = first(await exo("Get-Mailbox", { Identity: host }));

  if (debug) {
    return {
      ...out,
      // deno-lint-ignore no-explicit-any
      debug: {
        primary: before?.PrimarySmtpAddress,
        emailAddressesType: Array.isArray(before?.EmailAddresses) ? "array" : typeof before?.EmailAddresses,
        emailAddresses: before?.EmailAddresses,
      },
    } as DomainResult;
  }
  const beforePrimary = String(before?.PrimarySmtpAddress ?? "").toLowerCase();
  const beforeAddrs = (before?.EmailAddresses as string[] | undefined) ?? [];
  const hasAlias = beforeAddrs.some((a) => a.toLowerCase() === `smtp:${alias}`);

  out.aliasAlreadyPresent = hasAlias;
  if (!hasAlias && !dryRun) {
    // The REST InvokeCommand endpoint rejects PowerShell hashtable parameters
    // (`@{Add=…}` → "Invalid Operation"), so the whole list has to be written.
    //
    // That is replace semantics on a live mailbox, so: the list is taken from a
    // Get-Mailbox issued moments earlier, existing entries are passed through
    // byte-for-byte (preserving the uppercase `SMTP:` that marks the primary),
    // and only a lowercase `smtp:` entry is appended. PrimarySmtpAddress is
    // re-read and compared immediately after.
    if (!beforeAddrs.length) {
      out.error = "Get-Mailbox returned no EmailAddresses — refusing to write a replacement list";
      return out;
    }
    await exo("Set-Mailbox", {
      Identity: host,
      EmailAddresses: [...beforeAddrs, `smtp:${alias}`],
    });

    const after = first(await exo("Get-Mailbox", { Identity: host }));
    const afterPrimary = String(after?.PrimarySmtpAddress ?? "").toLowerCase();
    const afterAddrs = (after?.EmailAddresses as string[] | undefined) ?? [];

    out.primarySmtpUnchanged = afterPrimary === beforePrimary;
    out.aliasAdded = afterAddrs.some((a) => a.toLowerCase() === `smtp:${alias}`);

    if (!out.primarySmtpUnchanged) {
      out.error = `PRIMARY ADDRESS CHANGED (${beforePrimary} → ${afterPrimary}) — investigate immediately`;
      return out;
    }
    if (!out.aliasAdded) {
      out.error = "alias did not appear after Set-Mailbox";
      return out;
    }
  }

  // ── 2. transport rule ─────────────────────────────────────────────────────
  const rules = asArray(await exo("Get-TransportRule").catch(() => null));
  const existing = rules.find((r) => String(r?.Name ?? "") === RULE_NAME);
  out.ruleAlreadyPresent = Boolean(existing);

  if (!existing && !dryRun) {
    await exo("New-TransportRule", {
      Name: RULE_NAME,
      SentTo: alias,
      RedirectMessageTo: forwardTo,
      Comments: "Created by infra-m365-contact-alias. Routes landing-page enquiries to a monitored inbox.",
      Enabled: true,
    });
    const after = asArray(await exo("Get-TransportRule").catch(() => null));
    out.ruleCreated = after.some((r) => String(r?.Name ?? "") === RULE_NAME);
    if (!out.ruleCreated) out.error = "transport rule did not appear after New-TransportRule";
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SHARED_SECRET || req.headers.get("x-site-secret") !== SHARED_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // safe by default
  const forwardTo = String(body.forwardTo ?? DEFAULT_FORWARD_TO);
  const only = body.domain ? String(body.domain) : null;
  const debug = body.debug === true;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: rows } = await supabase
    .from("email_sending_domains")
    .select("domain")
    .not("m365_tenant_id", "is", null);

  let domains = (rows ?? []).map((r) => r.domain as string);
  if (only) domains = domains.filter((d) => d === only);
  if (!domains.length) return json({ error: only ? `domain ${only} not found` : "no domains" }, 404);

  const results: DomainResult[] = [];
  for (const d of domains) {
    try {
      results.push(await processDomain(supabase, d, forwardTo, dryRun, debug));
    } catch (err) {
      const detail = (err as { message?: string })?.message ?? String(err);
      results.push({ domain: d, alias: `${ALIAS_LOCAL}@${d}`, error: detail.slice(0, 500) });
    }
  }

  return json({
    dryRun,
    forwardTo,
    processed: results.length,
    ok: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    results,
  });
});
