/**
 * M365 SMTP-credential audit + surgical heal.
 *
 * Background: after an SMTP_ENCRYPTION_KEY rotation, M365 mailboxes whose
 * `metadata.smtp_credentials` blob was encrypted with the OLD key can no longer
 * be decrypted. Inbox replies now send via Graph (see project_inbox_reply_m365_graph),
 * so an undecryptable blob is non-fatal — but it breaks the SMTP fallback and the
 * mailbox CSV export. This function:
 *
 *   1. AUDIT (default): decrypt-checks every M365 mailbox in the CALLER'S org and
 *      returns counts + the list of undecryptable / missing mailboxes. It NEVER
 *      returns plaintext credentials.
 *   2. HEAL (fix=true): for each *undecryptable* mailbox only (healthy ones are
 *      left untouched), rotates the M365 user password via Graph, re-encrypts with
 *      the current key, and atomically merges it back. Mirrors infra-m365-heal-passwords
 *      but scoped to the broken mailboxes instead of rotating the whole fleet.
 *
 * Auth: standard app/CLI auth (JWT or aca_ token). All work is hard-scoped to the
 * caller's own organization, so a caller can only ever audit/heal their own mailboxes.
 *
 * Body: { fix?: boolean, limit?: number }   // limit caps how many broken mailboxes to heal per call (default 100)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { authenticateRequest, unauthorized } from "../_shared/cli-auth.ts";
import {
  extractSMTPCredentialsWithReason,
  encryptCredentials,
  type SMTPCredentials,
} from "../_shared/smtp-client.ts";
import { getM365Token } from "../_shared/m365-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strong password: guarantees lower/upper/digit/symbol, ~140 bits entropy. */
function generatePassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digit = "23456789";
  const symbol = "!@#$%^&*-_=+";
  const all = lower + upper + digit + symbol;
  const pick = (set: string): string => {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return set[buf[0] % set.length];
  };
  const chars = [pick(lower), pick(upper), pick(digit), pick(symbol)];
  for (let i = 0; i < 20; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const r = new Uint8Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface MailboxRow {
  id: string;
  email_address: string;
  metadata: Record<string, unknown> | null;
}

interface BrokenMailbox {
  id: string;
  email: string;
  reason: "decryption_failed" | "missing_credentials";
  admin_email: string | null;
  m365_user_id: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: "Server not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Authenticate and hard-scope to the caller's own org.
  let organizationId: string;
  try {
    const caller = await authenticateRequest(req, supabase);
    organizationId = caller.organization_id;
  } catch (err) {
    return unauthorized(err, corsHeaders);
  }

  let body: { fix?: boolean; limit?: number } = {};
  try {
    if (req.headers.get("content-length") !== "0") body = await req.json();
  } catch { /* empty body fine */ }
  const fix = body.fix === true;
  const healLimit = Math.min(Math.max(body.limit ?? 100, 1), 500);

  // 1) Page through ALL m365 mailboxes for the org (PostgREST caps at 1000/page).
  const mailboxes: MailboxRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("email_mailboxes")
      .select("id, email_address, metadata")
      .eq("organization_id", organizationId)
      .eq("connection_type", "m365")
      // Page by the unique id (not created_at) — bulk-provisioned mailboxes share
      // identical created_at timestamps, and ties make range pagination skip/dup
      // rows across pages, undercounting on a full scan.
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return jsonResponse({ success: false, error: error.message }, 500);
    const rows = (data ?? []) as MailboxRow[];
    mailboxes.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 2) Decrypt-check each mailbox.
  let okCount = 0;
  const broken: BrokenMailbox[] = [];
  for (const mb of mailboxes) {
    const meta = (mb.metadata ?? {}) as Record<string, unknown>;
    const result = await extractSMTPCredentialsWithReason(meta);
    if (result.ok) {
      okCount++;
      continue;
    }
    broken.push({
      id: mb.id,
      email: mb.email_address,
      reason: result.reason,
      admin_email: (meta.m365_admin_email as string | undefined) ?? null,
      m365_user_id: (meta.m365_user_id as string | undefined) ?? null,
    });
  }

  const decryptFailed = broken.filter((b) => b.reason === "decryption_failed");
  const missing = broken.filter((b) => b.reason === "missing_credentials");

  const audit = {
    organization_id: organizationId,
    total_m365: mailboxes.length,
    decryptable: okCount,
    decryption_failed: decryptFailed.length,
    missing_credentials: missing.length,
    // Emails only — never plaintext credentials.
    decryption_failed_sample: decryptFailed.slice(0, 50).map((b) => b.email),
    missing_credentials_sample: missing.slice(0, 50).map((b) => b.email),
  };

  if (!fix) {
    return jsonResponse({ success: true, mode: "audit", ...audit });
  }

  // 3) HEAL — only the undecryptable mailboxes that can be addressed (need a
  //    resolvable tenant + m365_user_id). Healthy mailboxes are never touched.
  const healable = decryptFailed.filter((b) => b.admin_email && b.m365_user_id).slice(0, healLimit);

  // Resolve admin_email → tenant_id for the org.
  const adminEmails = Array.from(new Set(healable.map((b) => b.admin_email!).filter(Boolean)));
  const tenantByAdmin = new Map<string, string>();
  if (adminEmails.length > 0) {
    const { data: tenants } = await supabase
      .from("m365_tenants")
      .select("tenant_id, admin_email")
      .eq("organization_id", organizationId)
      .in("admin_email", adminEmails);
    for (const t of (tenants ?? []) as Array<{ tenant_id: string; admin_email: string }>) {
      tenantByAdmin.set(t.admin_email, t.tenant_id);
    }
  }

  const tokenByTenant = new Map<string, string>();
  const results: Array<{ email: string; status: "healed" | "skipped" | "failed"; reason?: string }> = [];
  let healed = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const mb of healable) {
    const tenantId = tenantByAdmin.get(mb.admin_email!);
    if (!tenantId) {
      results.push({ email: mb.email, status: "skipped", reason: "tenant_not_found" });
      continue;
    }
    try {
      let token = tokenByTenant.get(tenantId);
      if (!token) {
        token = await getM365Token(tenantId);
        tokenByTenant.set(tenantId, token);
      }

      const newPassword = generatePassword();
      const patchRes = await fetch(`https://graph.microsoft.com/v1.0/users/${mb.m365_user_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ passwordProfile: { password: newPassword, forceChangePasswordNextSignIn: false } }),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        throw new Error(`Graph PATCH ${patchRes.status}: ${errText.slice(0, 200)}`);
      }

      const creds: SMTPCredentials = {
        smtp_host: "smtp.office365.com",
        smtp_port: 587,
        smtp_username: mb.email,
        smtp_password: newPassword,
        imap_host: "outlook.office365.com",
        imap_port: 993,
        imap_username: mb.email,
        imap_password: newPassword,
      };
      const encrypted = await encryptCredentials(creds);

      // Atomic JSONB merge — never read-modify-write metadata (other pollers
      // merge the same blob and would clobber smtp_credentials with a stale snapshot).
      const { error: updErr } = await supabase.rpc("merge_mailbox_smtp_credentials", {
        p_id: mb.id,
        p_encrypted: encrypted,
      });
      if (updErr) throw new Error(`db_update_failed: ${updErr.message}`);

      healed++;
      results.push({ email: mb.email, status: "healed" });
    } catch (e) {
      failed++;
      results.push({ email: mb.email, status: "failed", reason: e instanceof Error ? e.message : "unknown" });
    }
  }

  return jsonResponse({
    success: true,
    mode: "heal",
    ...audit,
    heal_attempted: healable.length,
    healed,
    failed,
    unhealable_no_metadata: decryptFailed.length - healable.length,
    elapsed_ms: Date.now() - startedAt,
    sample: results.slice(0, 50),
  });
});
