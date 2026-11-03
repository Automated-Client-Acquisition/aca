/**
 * BYO Events Webhook — receives bounce/send/health reports from aca-agent-report.sh
 * running on user servers. Authenticated via HMAC-SHA256 of the body using
 * byo_servers.agent_secret_encrypted (decrypted server-side, compared in
 * constant time).
 *
 * Body shape:
 *   {
 *     server_id: string,
 *     ts: ISO timestamp,
 *     events: Array<
 *       { type: "send",   queue_id: string, to: string, relay?: string }
 *       | { type: "bounce", queue_id: string, to: string, reason: string }
 *     >,
 *     health: {
 *       mailq_active: number, mailq_deferred: number,
 *       postfix: "active"|"inactive"|..., opendkim: ..., dovecot: ...,
 *       load_1m: number, mem_used_mb: number
 *     }
 *   }
 *
 * Side effects:
 *   - Heartbeat: byo_servers.deploy_state.last_health = ts; status to 'degraded'
 *     if any service is non-active.
 *   - For each bounce: increment bounces in email_mailbox_daily_stats for the
 *     mailbox owning the From address (looked up from email_send_log queue_id
 *     where available; fallback uses recipient -> last send by that mailbox).
 *   - For each send: increment delivered counter.
 *
 * This endpoint deliberately uses HMAC instead of a JWT — the agent runs on
 * the user's server and shouldn't carry a Supabase auth token.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptValue } from "../_shared/encryption.ts";
import { classifyDeliveryFailure } from "../_shared/m365-trace.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-aca-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AgentEvent {
  type: "send" | "bounce";
  queue_id?: string;
  to?: string;
  relay?: string;
  reason?: string;
}

interface AgentHealth {
  mailq_active?: number;
  mailq_deferred?: number;
  postfix?: string;
  opendkim?: string;
  dovecot?: string;
  load_1m?: number;
  mem_used_mb?: number;
}

interface AgentBody {
  server_id: string;
  ts: string;
  events?: AgentEvent[];
  health?: AgentHealth;
}

async function hmacHexSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const sigHeader = req.headers.get("x-aca-signature");
  if (!sigHeader) {
    return jsonResponse({ success: false, error: "Missing signature" }, 401);
  }

  const raw = await req.text();
  let body: AgentBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  if (!body.server_id) {
    return jsonResponse({ success: false, error: "server_id required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { success: false, error: "Server not configured" },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Resolve the server and verify HMAC against its agent secret.
  const { data: server, error: serverErr } = await supabase
    .from("byo_servers")
    .select("id, organization_id, agent_secret_encrypted, status, deploy_state")
    .eq("id", body.server_id)
    .maybeSingle();
  if (serverErr) {
    return jsonResponse({ success: false, error: serverErr.message }, 500);
  }
  if (!server) {
    return jsonResponse({ success: false, error: "Unknown server" }, 404);
  }
  if (!server.agent_secret_encrypted) {
    return jsonResponse(
      { success: false, error: "Server has no agent secret" },
      401,
    );
  }

  let secret: string;
  try {
    secret = await decryptValue(server.agent_secret_encrypted as string);
  } catch {
    return jsonResponse({
      success: false,
      error: "Failed to decrypt agent secret",
    }, 500);
  }
  const expected = await hmacHexSha256(secret, raw);
  if (!constantTimeEqual(expected, sigHeader.trim())) {
    return jsonResponse({ success: false, error: "Invalid signature" }, 401);
  }

  const now = new Date().toISOString();
  const events = Array.isArray(body.events) ? body.events.slice(0, 1000) : [];
  const health = body.health ?? {};

  // 1) Heartbeat + service status.
  const servicesHealthy = health.postfix === "active" &&
    health.opendkim === "active" && health.dovecot === "active";
  const newServerStatus = !servicesHealthy
    ? "degraded"
    : (server.status === "degraded" ? "ready" : server.status);
  await supabase
    .from("byo_servers")
    .update({
      status: newServerStatus,
      last_error: servicesHealthy ? null : undefined,
      deploy_state: {
        ...((server.deploy_state as Record<string, unknown> | null) ?? {}),
        last_health: now,
        last_health_payload: {
          mailq_active: health.mailq_active ?? 0,
          mailq_deferred: health.mailq_deferred ?? 0,
          postfix: health.postfix ?? "unknown",
          opendkim: health.opendkim ?? "unknown",
          dovecot: health.dovecot ?? "unknown",
          load_1m: health.load_1m ?? null,
          mem_used_mb: health.mem_used_mb ?? null,
        },
      },
    })
    .eq("id", server.id);

  if (events.length === 0) {
    return jsonResponse({ success: true, accepted: 0, heartbeat: true });
  }

  // 2) Process events. Aggregate per (mailbox, day) to minimize round-trips.
  // We look up mailboxes by their email_address inferred from the From: of the
  // matching email_send_log entry (queue_id correlation isn't possible without
  // logging Message-ID into queue_id, which is Phase 7; we fallback to the
  // most-recent send to the recipient).
  const orgId = server.organization_id as string;

  // Group bounces and sends by mailbox.
  const bounceByMailbox = new Map<
    string,
    { confirmed: number; unclassified: number; reasons: string[] }
  >();
  const sendByMailbox = new Map<string, number>();

  for (const evt of events) {
    if (!evt.to) continue;
    const recipient = evt.to.trim().toLowerCase();
    if (!recipient) continue;

    // Find the most recent send to this recipient from any BYO mailbox in this org.
    // This is approximate but adequate for daily counters; per-message accuracy
    // is Phase 7 (header_checks adding X-ACA-Mid).
    const { data: sendRow } = await supabase
      .from("email_send_log")
      .select("id, mailbox_id, status")
      .eq("organization_id", orgId)
      .eq("recipient_email", recipient)
      .in("status", [
        "queued",
        "sending",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "replied",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sendRow) continue;
    const mailboxId = sendRow.mailbox_id as string;

    if (evt.type === "bounce") {
      const classification = classifyDeliveryFailure(evt.reason ?? "");
      const isConfirmedRecipientBounce =
        classification.category === "hard_bounce";
      const acc = bounceByMailbox.get(mailboxId) ??
        { confirmed: 0, unclassified: 0, reasons: [] };
      if (isConfirmedRecipientBounce) acc.confirmed += 1;
      else acc.unclassified += 1;
      if (evt.reason && acc.reasons.length < 5) acc.reasons.push(evt.reason);
      bounceByMailbox.set(mailboxId, acc);

      // Do not turn a generic Postfix DSN into a recipient bounce. The raw
      // diagnostic remains on the send row for operators to classify.
      await supabase
        .from("email_send_log")
        .update({
          status: isConfirmedRecipientBounce
            ? "bounced"
            : classification.isReputationBlock || classification.isTenantBlock
            ? "blocked"
            : classification.category === "content_block"
            ? "spam"
            : "failed",
          bounced_at: isConfirmedRecipientBounce ? now : null,
          error_message: evt.reason ?? null,
          error_category: classification.category,
        })
        .eq("id", sendRow.id);
    } else if (evt.type === "send") {
      sendByMailbox.set(mailboxId, (sendByMailbox.get(mailboxId) ?? 0) + 1);
      // Mark sent rows that were still queued/sending as 'delivered' (Postfix
      // reports 'sent' = handed off to the receiving MX, not user inbox).
      if (
        sendRow.status === "queued" || sendRow.status === "sending" ||
        sendRow.status === "sent"
      ) {
        await supabase
          .from("email_send_log")
          .update({ status: "delivered" })
          .eq("id", sendRow.id);
      }
    }
  }

  // 3) Roll bounce/delivery counters into email_mailbox_daily_stats and update mailbox bounce_rate.
  const today = now.slice(0, 10);
  const allMailboxIds = new Set<string>([
    ...bounceByMailbox.keys(),
    ...sendByMailbox.keys(),
  ]);

  for (const mailboxId of allMailboxIds) {
    const bounce = bounceByMailbox.get(mailboxId) ??
      { confirmed: 0, unclassified: 0, reasons: [] };
    const sent = sendByMailbox.get(mailboxId) ?? 0;
    const confirmedBounces = bounce.confirmed;

    // Upsert daily stats row.
    const { data: existing } = await supabase
      .from("email_mailbox_daily_stats")
      .select("id, sent, delivered, bounced")
      .eq("mailbox_id", mailboxId)
      .eq("stat_date", today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("email_mailbox_daily_stats")
        .update({
          delivered: (existing.delivered ?? 0) + sent,
          bounced: (existing.bounced ?? 0) + confirmedBounces,
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("email_mailbox_daily_stats")
        .insert({
          mailbox_id: mailboxId,
          stat_date: today,
          sent: 0,
          delivered: sent,
          bounced: confirmedBounces,
        });
    }

    // Update rolling bounce_rate on the mailbox itself.
    if (confirmedBounces > 0) {
      const { data: mbox } = await supabase
        .from("email_mailboxes")
        .select("bounce_rate, last_send_at")
        .eq("id", mailboxId)
        .maybeSingle();
      if (mbox) {
        // Simple EWMA: only confirmed recipient failures affect list health.
        const recent = confirmedBounces /
          Math.max(1, sent + confirmedBounces);
        const alpha = 0.15;
        const newRate = Number(
          ((mbox.bounce_rate ?? 0) * (1 - alpha) + recent * alpha).toFixed(4),
        );
        await supabase
          .from("email_mailboxes")
          .update({
            bounce_rate: newRate,
            // Pause mailbox if hard-bounce rate is high — protects sender reputation.
            ...(bounce.confirmed > 0 && newRate > 0.05
              ? {
                status: "paused",
                last_error: `Auto-paused: bounce rate ${
                  (newRate * 100).toFixed(1)
                }%`,
              }
              : {}),
          })
          .eq("id", mailboxId);
      }
    }
  }

  return jsonResponse({
    success: true,
    accepted: events.length,
    confirmed_recipient_bounces: Array.from(bounceByMailbox.values()).reduce(
      (s, b) => s + b.confirmed,
      0,
    ),
    unclassified_delivery_failures: Array.from(bounceByMailbox.values()).reduce(
      (s, b) => s + b.unclassified,
      0,
    ),
    sends: Array.from(sendByMailbox.values()).reduce((s, n) => s + n, 0),
  });
});
