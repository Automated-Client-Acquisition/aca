/**
 * Email IMAP Poller Edge Function
 *
 * Cron: every 3 minutes.
 *
 * Architecture (fan-out):
 *   1. Cron invokes this function with no body → "coordinator" mode.
 *   2. Coordinator fetches all eligible mailboxes and fires parallel
 *      per-mailbox invocations (fire-and-forget via fetch) so each
 *      mailbox runs in its own edge function instance.
 *   3. Each per-mailbox invocation (body: { mailboxId }) connects to IMAP,
 *      fetches new emails, creates CRM records, and processes replies.
 *
 * This scales to thousands of mailboxes — each gets its own 60s window.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { fetchNewEmails, fetchSpamFolderEmails, type InboundEmailMessage } from '../_shared/imap-client.ts';
import { extractSMTPCredentials } from '../_shared/smtp-client.ts';
import {
  calculateOOOResumeAt,
  classifyNdr,
  detectAutoReply,
  detectBounce,
  detectOutOfOffice,
  detectWarmup,
  isSystemEmail,
  processReplyForConversationEnrollments,
  processReplyForEnrollment,
} from '../_shared/reply-processing.ts';
import { classifyReply } from '../_shared/reply-classifier.ts';
import { evaluateFollowupRules } from '../_shared/followup-rule-engine.ts';
import { computeMomentum } from '../_shared/momentum-calculator.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';
import { parseOOOReturnDate } from '../_shared/ooo-date-parser.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron is unscheduled (replaced by a Fly worker); only service-role calls may run it.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Parse body
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    const targetMailboxId = body.mailboxId as string | undefined;
    const debugMode = body.debug === true;

    // ========================================================================
    // Per-mailbox mode: poll a single mailbox (invoked by coordinator or manually)
    // ========================================================================
    if (targetMailboxId) {
      return await handleSingleMailbox(supabase, targetMailboxId, debugMode);
    }

    // ========================================================================
    // Coordinator mode: process a batch of mailboxes concurrently
    // ========================================================================
    console.log('[IMAP Poller] Starting batch poll...');

    // Wake event-based snoozed conversations (OOO returns, timezone mornings)
    try {
      const { data: wakeResult } = await supabase.rpc('wake_event_snoozed_conversations');
      if (wakeResult && wakeResult > 0) {
        console.log(`[IMAP Poller] Woke ${wakeResult} event-snoozed conversations`);
      }
    } catch (wakeErr) {
      console.error('[IMAP Poller] Wake snooze error (non-fatal):', wakeErr);
    }
    try {
      const { data: resumed } = await supabase.rpc('resume_due_ooo_email_enrollments');
      if (resumed && resumed > 0) {
        console.log(`[IMAP Poller] Resumed ${resumed} OOO-paused email enrollments`);
      }
    } catch (resumeErr) {
      console.error('[IMAP Poller] OOO enrollment resume error (non-fatal):', resumeErr);
    }

    // Fetch a batch of mailboxes, oldest-polled first (round-robin).
    // BATCH_SIZE controls how many we process per cron tick. With a 3-min cron:
    //   5 per batch → 100 mailboxes/hour → 1,000 mailboxes cycled in ~10 min
    //   10 per batch → 200 mailboxes/hour → 1,000 mailboxes cycled in ~5 min
    // Each mailbox gets a 15s timeout, so 5 concurrent × 15s = well within 60s.
    const BATCH_SIZE = 5;

    const { data: mailboxes, error: mbError } = await supabase
      .from('email_mailboxes')
      .select('id, organization_id, email_address, display_name, metadata, imap_connected')
      .in('status', ['ready', 'warming'])
      .eq('imap_connected', true)
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (mbError) throw new Error(`Failed to fetch mailboxes: ${mbError.message}`);
    if (!mailboxes || mailboxes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, mode: 'batch', mailboxes: 0, emails: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[IMAP Poller] Processing ${mailboxes.length} mailbox(es) concurrently`);

    // Helper: wrap a promise with a timeout
    const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
        ),
      ]);

    // Process all mailboxes CONCURRENTLY (not sequentially)
    const results = await Promise.allSettled(
      mailboxes.map(async (mailbox: typeof mailboxes[number]) => {
        const mbDebugLog: string[] = [];
        try {
          const result = await withTimeout(
            pollMailbox(supabase, mailbox, mbDebugLog),
            40000,
            `Poll ${mailbox.email_address}`
          );

          // Scan spam folder (lower timeout, non-critical)
          let spamDetected = 0;
          try {
            spamDetected = await withTimeout(
              scanSpamFolder(supabase, mailbox),
              15000,
              `Spam scan ${mailbox.email_address}`
            );
          } catch { /* spam scan timeout is non-fatal */ }

          // Touch updated_at to advance the round-robin cursor
          await supabase
            .from('email_mailboxes')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', mailbox.id);

          return { email: mailbox.email_address, ...result, spamDetected };
        } catch (error) {
          // Still advance cursor on error so we don't get stuck on a broken mailbox
          await supabase
            .from('email_mailboxes')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', mailbox.id);

          console.error(`[IMAP Poller] Error polling ${mailbox.email_address}:`, error);
          return { email: mailbox.email_address, emails: 0, matched: 0, crmCreated: 0, error: true };
        }
      })
    );

    // Aggregate results
    let totalEmails = 0;
    let totalMatched = 0;
    let totalCrmCreated = 0;
    let errors = 0;

    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalEmails += r.value.emails;
        totalMatched += r.value.matched;
        totalCrmCreated += r.value.crmCreated;
        if (r.value.error) errors++;
      } else {
        errors++;
      }
    }

    console.log(`[IMAP Poller] Batch complete: ${mailboxes.length} mailboxes, ${totalEmails} emails, ${totalMatched} matched, ${totalCrmCreated} CRM, ${errors} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'batch',
        mailboxes: mailboxes.length,
        emails: totalEmails,
        matched: totalMatched,
        crmCreated: totalCrmCreated,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[IMAP Poller] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// Single Mailbox Handler
// ============================================================================

async function handleSingleMailbox(
  supabase: any,
  mailboxId: string,
  debugMode: boolean
): Promise<Response> {
  const debugLog: string[] = [];

  try {
    const { data: mailbox, error: mbError } = await supabase
      .from('email_mailboxes')
      .select('id, organization_id, email_address, display_name, metadata, imap_connected')
      .eq('id', mailboxId)
      .in('status', ['ready', 'warming'])
      .eq('imap_connected', true)
      .single();

    if (mbError || !mailbox) {
      return new Response(
        JSON.stringify({ success: true, mailboxes: 0, emails: 0, note: 'Mailbox not found or not ready' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[IMAP Poller] Polling mailbox ${mailbox.email_address}`);

    const result = await pollMailbox(supabase, mailbox, debugLog);

    // Scan spam/junk folder
    let spamDetected = 0;
    try {
      spamDetected = await scanSpamFolder(supabase, mailbox);
    } catch (spamErr) {
      console.error(`[IMAP Poller] Spam scan error for ${mailbox.email_address}:`, spamErr);
    }

    // Touch updated_at so the coordinator's round-robin cursor advances
    await supabase
      .from('email_mailboxes')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', mailbox.id);

    console.log(`[IMAP Poller] ${mailbox.email_address}: ${result.emails} emails, ${result.matched} matched, ${result.crmCreated} CRM`);

    return new Response(
      JSON.stringify({
        success: true,
        mailboxes: 1,
        emails: result.emails,
        matched: result.matched,
        crmCreated: result.crmCreated,
        spamDetected,
        errors: 0,
        ...(debugMode ? { debugLog } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[IMAP Poller] Error polling mailbox ${mailboxId}:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(debugMode ? { debugLog } : {}),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// ============================================================================
// Per-Mailbox Polling
// ============================================================================

interface PollResult {
  emails: number;
  matched: number;
  crmCreated: number;
}

async function pollMailbox(
  supabase: any,
  mailbox: {
    id: string;
    organization_id: string;
    email_address: string;
    display_name: string | null;
    metadata: Record<string, any>;
    imap_connected: boolean;
  },
  debugLog: string[] = []
): Promise<PollResult> {
  // Extract and decrypt IMAP credentials
  const creds = await extractSMTPCredentials(mailbox.metadata || {});
  if (!creds || !creds.imap_host || !creds.imap_username || !creds.imap_password) {
    console.warn(`[IMAP Poller] Skipping mailbox ${mailbox.id} — missing IMAP credentials`);
    return { emails: 0, matched: 0, crmCreated: 0 };
  }

  const lastUid = (mailbox.metadata?.last_imap_uid as number) || 0;

  // Fetch new emails via IMAP
  const emails = await fetchNewEmails(
    {
      imap_host: creds.imap_host,
      imap_port: creds.imap_port || 993,
      imap_username: creds.imap_username,
      imap_password: creds.imap_password,
    },
    lastUid
  );

  if (emails.length === 0) {
    return { emails: 0, matched: 0, crmCreated: 0 };
  }

  console.log(`[IMAP Poller] Mailbox ${mailbox.email_address}: ${emails.length} new email(s) since UID ${lastUid}`);

  let matched = 0;
  let crmCreated = 0;
  let highestUid = lastUid;

  for (const email of emails) {
    try {
      // Skip emails sent FROM this mailbox (outbound)
      if (email.from_email === mailbox.email_address.toLowerCase()) {
        if (email.uid > highestUid) highestUid = email.uid;
        continue;
      }

      const result = await processInboundEmail(supabase, mailbox, email, debugLog);
      if (result.matched) matched++;
      if (result.crmCreated) crmCreated++;
    } catch (err) {
      console.error(`[IMAP Poller] Error processing email UID ${email.uid}:`, err);
    }

    if (email.uid > highestUid) highestUid = email.uid;
  }

  // Update last_imap_uid in metadata.
  // Atomic JSONB merge — read-modify-write would race with infra-m365-heal-passwords
  // and similar writers, clobbering smtp_credentials with our stale snapshot.
  if (highestUid > lastUid) {
    await supabase.rpc('merge_mailbox_metadata', {
      p_id: mailbox.id,
      p_merge: { last_imap_uid: highestUid },
    });
  }

  return { emails: emails.length, matched, crmCreated };
}

// ============================================================================
// Process Single Inbound Email
// ============================================================================

interface ProcessResult {
  matched: boolean;
  crmCreated: boolean;
  debugLog?: string[];
}

async function processInboundEmail(
  supabase: any,
  mailbox: {
    id: string;
    organization_id: string;
    email_address: string;
    display_name: string | null;
  },
  email: InboundEmailMessage,
  debugLog: string[] = []
): Promise<ProcessResult> {
  let matchedSendLog: any = null;

  debugLog.push(`Processing UID ${email.uid}: from=${email.from_email} subj="${email.subject}" in_reply_to=${email.in_reply_to || 'none'}`);

  // Strategy 1a: Match by In-Reply-To → email_send_log.email_message_id (original sequence email)
  if (email.in_reply_to) {
    const { data, error } = await supabase
      .from('email_send_log')
      .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status, subject, body')
      .eq('email_message_id', email.in_reply_to)
      .eq('organization_id', mailbox.organization_id)
      .limit(1)
      .maybeSingle();

    if (error) debugLog.push(`  Strategy1a error: ${error.message}`);
    if (data) {
      matchedSendLog = data;
      debugLog.push(`  Strategy1a matched: send_log ${data.id}, status=${data.status}`);
    }
  }

  // Strategy 1b: Match by In-Reply-To → crm_messages.external_message_id (reply in a thread)
  // This handles multi-turn threads where In-Reply-To points to our CRM outbound reply
  if (!matchedSendLog && email.in_reply_to) {
    const { data: crmMsg } = await supabase
      .from('crm_messages')
      .select('conversation_id, organization_id')
      .eq('external_message_id', email.in_reply_to)
      .eq('organization_id', mailbox.organization_id)
      .eq('direction', 'outbound')
      .limit(1)
      .maybeSingle();

    if (crmMsg) {
      debugLog.push(`  Strategy1b matched: crm_messages thread (conversation ${crmMsg.conversation_id})`);
      // We don't have a send_log match, but we know the conversation — still create CRM records
      // Look up the original send_log for this conversation's recipient
      const { data: sendLog } = await supabase
        .from('email_send_log')
        .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status, subject, body')
        .eq('recipient_email', email.from_email)
        .eq('organization_id', mailbox.organization_id)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sendLog) {
        matchedSendLog = sendLog;
        debugLog.push(`  Strategy1b found send_log ${sendLog.id}`);
      }
    }
  }

  // Strategy 1c: References header → email_send_log.email_message_id
  // Some clients set References but not In-Reply-To
  if (!matchedSendLog && email.references.length > 0) {
    for (const ref of email.references) {
      const { data } = await supabase
        .from('email_send_log')
        .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status, subject, body')
        .eq('email_message_id', ref)
        .eq('organization_id', mailbox.organization_id)
        .limit(1)
        .maybeSingle();
      if (data) {
        matchedSendLog = data;
        debugLog.push(`  Strategy1c matched via References header: send_log ${data.id}`);
        break;
      }
    }
  }

  // Strategy 2 removed — matching by email address alone (without In-Reply-To)
  // caused false "replied" statuses on enrollments. If the inbound email has no
  // thread header linking it to one of our sends, we should NOT treat it as a
  // reply to a sequence email.
  if (!matchedSendLog) {
    debugLog.push(`  No thread header match — skipping address-only fallback to avoid false positives`);
  }

  const isBounce = detectBounce(email.from_email, email.from_name, email.subject);
  const isOutOfOffice = !isBounce && detectOutOfOffice(email.subject, email.text_body);
  const isAutoReply = !isBounce && (isOutOfOffice || detectAutoReply(email.subject, email.text_body));
  const parsedOOOReturnDate = isOutOfOffice ? parseOOOReturnDate(email.text_body || '') : null;
  const oooResumeAt = isOutOfOffice ? calculateOOOResumeAt(parsedOOOReturnDate) : undefined;
  const isWarmup = detectWarmup(email.text_body, email.html_body);

  // Warmup emails: skip CRM record creation entirely — don't pollute inbox
  if (isWarmup) {
    debugLog.push(`  Warmup email detected — skipping CRM creation`);
    return { matched: !!matchedSendLog, crmCreated: false, debugLog };
  }

  if (matchedSendLog) {
    if (isBounce) {
      const ndr = classifyNdr(email.subject, email.text_body);
      const { classification } = ndr;
      debugLog.push(
        `  Bounce/NDR detected from "${email.from_name}" — ${classification.category} ` +
          `(${classification.enhancedCode ?? classification.smtpCode ?? 'no code'}) → ${ndr.sendLogStatus}`,
      );

      // error_category='hard_bounce' + status='bounced' is what fires the global
      // contact-suppression trigger; everything else stays a delivery failure
      // that never touches the lead.
      await supabase
        .from('email_send_log')
        .update({
          status: ndr.sendLogStatus,
          error_category: classification.category,
          error_message: (classification.diagnostic || email.subject || 'NDR with no diagnostic').slice(0, 2000),
          ...(ndr.suppressRecipient ? { bounced_at: new Date().toISOString() } : {}),
        })
        .eq('id', matchedSendLog.id);

      if (ndr.suppressRecipient) {
        if (matchedSendLog.sequence_id && matchedSendLog.lead_id) {
          await supabase
            .from('email_sequence_enrollments')
            .update({ status: 'bounced', updated_at: new Date().toISOString() })
            .eq('sequence_id', matchedSendLog.sequence_id)
            .eq('lead_id', matchedSendLog.lead_id)
            .eq('status', 'active');
        }

        if (matchedSendLog.lead_id) {
          await supabase
            .from('leads')
            .update({ email_status: 'bounced' })
            .eq('id', matchedSendLog.lead_id);
          debugLog.push(`  Lead ${matchedSendLog.lead_id} email_status set to bounced`);
        }
      }
    } else if (isAutoReply) {
      debugLog.push(`  Auto-reply/OOO detected, marking as auto_replied...`);

      await supabase
        .from('email_send_log')
        .update({
          status: 'auto_replied',
          replied_at: new Date().toISOString(),
        })
        .eq('id', matchedSendLog.id);

      await processReplyForEnrollment(supabase, matchedSendLog, email.from_email, isAutoReply, {
        isOutOfOffice,
        resumeAt: oooResumeAt,
      });
    } else {
      debugLog.push(`  Real reply detected, updating send_log and creating CRM records...`);

      await supabase
        .from('email_send_log')
        .update({
          status: 'replied',
          replied_at: new Date().toISOString(),
        })
        .eq('id', matchedSendLog.id);

      await processReplyForEnrollment(supabase, matchedSendLog, email.from_email, isAutoReply, {
        isOutOfOffice,
        resumeAt: oooResumeAt,
      });
    }

    // Bounces/NDRs belong to the originating send record, not to a sender-side
    // CRM contact or reply conversation. Creating a "Mail Delivery System"
    // contact here polluted reply metrics despite the correct bounce status.
    if (isBounce) {
      debugLog.push('  Bounce/NDR — skipping CRM contact, conversation, and reply classification');
      return { matched: true, crmCreated: false, debugLog };
    }

    // Create CRM records for genuine replies and automatic replies only.
    const crmResult = await createCrmRecordsForInbound(
      supabase, mailbox, email, matchedSendLog.lead_id, debugLog, false, matchedSendLog
    );

    debugLog.push(`  CRM created: ${crmResult.success}`);

    if (crmResult.success && crmResult.conversationId) {
      if (isOutOfOffice && oooResumeAt) {
        await supabase.from('crm_conversations')
          .update({
            status: 'snoozed',
            snooze_type: 'until_ooo_ends',
            snooze_context: {
              parsed_return_date: (parsedOOOReturnDate || oooResumeAt).toISOString().split('T')[0],
              resume_at: oooResumeAt.toISOString(),
              used_fallback_date: !parsedOOOReturnDate,
            },
            snoozed_until: oooResumeAt.toISOString(),
          })
          .eq('id', crmResult.conversationId);
      }

      const continuationCount = await processReplyForConversationEnrollments(supabase, {
        organizationId: mailbox.organization_id,
        conversationId: crmResult.conversationId,
        fromEmail: email.from_email,
        isAutoReply,
        isOutOfOffice,
        resumeAt: oooResumeAt,
      });
      if (continuationCount > 0) {
        debugLog.push(`  Applied reply disposition to ${continuationCount} conversation-linked enrollment(s)`);
      }
    }

    // --- CLASSIFICATION + FOLLOW-UP RULES ---
    try {
      // Get org's OpenRouter API key (encrypted, per-org "bring your own key")
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      let openRouterKey: string | null = null;
      try {
        const { data: apiKeyData } = await supabase
          .from('api_keys')
          .select('key_encrypted')
          .eq('organization_id', mailbox.organization_id)
          .eq('provider', 'openrouter')
          .single();
        if (apiKeyData?.key_encrypted && encryptionKey) {
          openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
        }
      } catch (keyErr) {
        debugLog.push(`  OpenRouter key retrieval failed (non-fatal): ${keyErr instanceof Error ? keyErr.message : String(keyErr)}`);
      }

      if (openRouterKey && crmResult.success && crmResult.conversationId) {
        // Get org's default LLM model
        const { data: orgSettings } = await supabase
          .from('organization_settings')
          .select('default_llm_model')
          .eq('organization_id', mailbox.organization_id)
          .maybeSingle();
        const orgModel = orgSettings?.default_llm_model || undefined;

        const classification = await classifyReply({
          from_email: email.from_email,
          subject: email.subject || '',
          body_text: email.text_body || '',
          original_outbound_subject: matchedSendLog.subject,
          // Without the outbound body, a bare "Yes" reply to "reply yes and
          // it's yours" reads as an unclassifiable acknowledgment — the LLM
          // needs to see what it's actually replying to.
          thread_context: matchedSendLog.body
            ? `Original outbound email:\n${String(matchedSendLog.body).slice(0, 1500)}`
            : undefined,
        }, openRouterKey, orgModel);

        debugLog.push(`  Classification: ${classification.intent} (${classification.confidence.toFixed(2)})`);

        // Store per-message classification in metadata
        if (crmResult.messageId) {
          const { data: msgData } = await supabase
            .from('crm_messages')
            .select('metadata')
            .eq('id', crmResult.messageId)
            .single();

          await supabase.from('crm_messages')
            .update({
              metadata: {
                ...(msgData?.metadata || {}),
                classification: {
                  intent: classification.intent,
                  confidence: classification.confidence,
                  reasoning: classification.reasoning,
                  needs_human_review: classification.needs_human_review,
                  classified_at: new Date().toISOString(),
                },
              },
            })
            .eq('id', crmResult.messageId);
        }

        // Update conversation lead_intent
        await supabase.from('crm_conversations')
          .update({ lead_intent: classification.intent })
          .eq('id', crmResult.conversationId);

        // Unsubscribe / Do-Not-Contact — mirror email-unsubscribe edge function logic
        if ((classification.intent === 'unsubscribe' || classification.intent === 'do_not_contact') && matchedSendLog.lead_id) {
          try {
            const now = new Date().toISOString();

            // 1. Mark send log entry as unsubscribed
            await supabase
              .from('email_send_log')
              .update({ unsubscribed_at: now })
              .eq('id', matchedSendLog.id);

            // 2. Mark ALL active enrollments for this lead in this org as unsubscribed
            const { data: orgSequences } = await supabase
              .from('email_sequences')
              .select('id')
              .eq('organization_id', mailbox.organization_id);

            if (orgSequences && orgSequences.length > 0) {
              await supabase
                .from('email_sequence_enrollments')
                .update({ status: 'unsubscribed', updated_at: now })
                .eq('lead_id', matchedSendLog.lead_id)
                .in('sequence_id', orgSequences.map((s: any) => s.id))
                .in('status', ['active', 'paused', 'replied']);
            }

            // 3. Mark CRM contact as unsubscribed
            if (email.from_email) {
              await supabase
                .from('crm_contacts')
                .update({ status: 'unsubscribed', updated_at: now })
                .eq('organization_id', mailbox.organization_id)
                .ilike('primary_email', email.from_email);
            }

            debugLog.push(`  Auto-unsubscribed lead ${matchedSendLog.lead_id} (intent: ${classification.intent})`);
          } catch (unsubErr) {
            debugLog.push(`  Unsubscribe action error (non-fatal): ${unsubErr instanceof Error ? unsubErr.message : String(unsubErr)}`);
          }
        }

        // Evaluate follow-up rules if this reply is from a sequence
        if (matchedSendLog.sequence_id && matchedSendLog.lead_id) {
          const followupResult = await evaluateFollowupRules(supabase, {
            sequenceId: matchedSendLog.sequence_id,
            leadId: matchedSendLog.lead_id,
            organizationId: mailbox.organization_id,
            intent: classification.intent,
            confidence: classification.confidence,
            triggerType: 'intent_match',
          });

          if (followupResult.triggered.length > 0) {
            debugLog.push(`  Follow-up rules triggered: ${followupResult.triggered.length}, enrolled: ${followupResult.enrolled.length}`);
          }
        }

        // --- MOMENTUM COMPUTATION ---
        try {
          if (crmResult.conversationId) {
            const momentum = await computeMomentum(supabase, crmResult.conversationId, mailbox.organization_id);
            await supabase.from('crm_conversations')
              .update({
                momentum_score: momentum.score,
                momentum_trend: momentum.trend,
              })
              .eq('id', crmResult.conversationId);
            debugLog.push(`  Momentum: ${momentum.score} (${momentum.trend})`);
          }
        } catch (momErr) {
          debugLog.push(`  Momentum error (non-fatal): ${momErr instanceof Error ? momErr.message : String(momErr)}`);
        }

        // --- AUTOPILOT PROCESSING ---
        try {
          const autopilotContactId = crmResult.contactId || matchedSendLog.lead_id;
          if (!isOutOfOffice && crmResult.conversationId && openRouterKey && autopilotContactId) {
            const autopilotResult = await processAutopilot(supabase, {
              conversationId: crmResult.conversationId,
              contactId: autopilotContactId,
              organizationId: mailbox.organization_id,
              intent: classification.intent,
              confidence: classification.confidence,
              inboundMessageId: crmResult.messageId || '',
              channel: 'email',
              mailboxId: mailbox.id,
              sequenceId: matchedSendLog.sequence_id,
              model: orgModel,
              messageContent: email.text_body || '',
            }, openRouterKey);
            if (autopilotResult.action !== 'none') {
              debugLog.push(`  Autopilot: ${autopilotResult.action} (queued: ${autopilotResult.queued}, sent: ${autopilotResult.sent})`);
            }
          }
        } catch (autoErr) {
          debugLog.push(`  Autopilot error (non-fatal): ${autoErr instanceof Error ? autoErr.message : String(autoErr)}`);
        }
      }

    } catch (classifyErr) {
      debugLog.push(`  Classification error (non-fatal): ${classifyErr instanceof Error ? classifyErr.message : String(classifyErr)}`);
    }

    return { matched: true, crmCreated: crmResult.success };
  }

  // No match — gate on whether sender is known before creating visible CRM records
  const { data: knownContact } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('organization_id', mailbox.organization_id)
    .ilike('primary_email', email.from_email)
    .limit(1)
    .maybeSingle();

  const { data: knownLead } = await supabase
    .from('leads')
    .select('id')
    .eq('organization_id', mailbox.organization_id)
    .ilike('email', email.from_email)
    .limit(1)
    .maybeSingle();

  // Same path for known and unknown senders. Genuine automated mail
  // (bounces/noreply/DMARC) is still flagged is_system inside
  // createCrmRecordsForInbound() via isSystemEmail(). Warmup pool noise that
  // bypasses detectWarmup is filtered post-ingest by the user's per-org
  // exclusion keywords (src/pages/Inbox.tsx `inbox-exclusion-keywords-*`).
  debugLog.push(`  ${(knownContact || knownLead) ? 'Known contact/lead' : 'Unknown sender'} — creating CRM records`);
  const crmResult = await createCrmRecordsForInbound(
    supabase, mailbox, email, knownLead?.id || null, debugLog,
    isBounce || isSystemEmail(email.from_email, email.subject)
  );

  if (crmResult.success && crmResult.conversationId) {
    if (isOutOfOffice && oooResumeAt) {
      await supabase.from('crm_conversations')
        .update({
          status: 'snoozed',
          snooze_type: 'until_ooo_ends',
          snooze_context: {
            parsed_return_date: (parsedOOOReturnDate || oooResumeAt).toISOString().split('T')[0],
            resume_at: oooResumeAt.toISOString(),
            used_fallback_date: !parsedOOOReturnDate,
          },
          snoozed_until: oooResumeAt.toISOString(),
        })
        .eq('id', crmResult.conversationId);
    }

    await processReplyForConversationEnrollments(supabase, {
      organizationId: mailbox.organization_id,
      conversationId: crmResult.conversationId,
      fromEmail: email.from_email,
      isAutoReply,
      isOutOfOffice,
      resumeAt: oooResumeAt,
    });
  }
  return { matched: false, crmCreated: crmResult.success };
}

// ============================================================================
// CRM Record Creation for Inbound Emails
// ============================================================================

interface CrmCreateResult {
  success: boolean;
  conversationId?: string;
  messageId?: string;
  contactId?: string;
}

async function createCrmRecordsForInbound(
  supabase: any,
  mailbox: {
    id: string;
    organization_id: string;
    email_address: string;
  },
  email: InboundEmailMessage,
  leadId: string | null,
  debugLog: string[] = [],
  isSystem = false,
  sourceSendLog?: { id?: string; sequence_id?: string | null; lead_id?: string | null },
): Promise<CrmCreateResult> {
  try {
    debugLog.push(`  CRM: from=${email.from_email}, leadId=${leadId}`);

    // Find or create CRM contact by email
    let contactId: string | null = null;

    // Try to find existing contact (case-insensitive email match)
    const { data: existingContact, error: contactLookupError } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('organization_id', mailbox.organization_id)
      .ilike('primary_email', email.from_email)
      .limit(1)
      .maybeSingle();

    if (contactLookupError) {
      debugLog.push(`  CRM: contact lookup error: ${contactLookupError.message}`);
    }

    let resultConversationId: string | undefined;
    let resultMessageId: string | undefined;

    if (existingContact) {
      contactId = existingContact.id;
      debugLog.push(`  CRM: found contact ${contactId}`);
    } else if (leadId) {
      // Try to find contact linked to the lead
      const { data: lead } = await supabase
        .from('leads')
        .select('source_id')
        .eq('id', leadId)
        .single();

      if (lead?.source_id) {
        const { data: linkedContact } = await supabase
          .from('crm_contacts')
          .select('id')
          .eq('organization_id', mailbox.organization_id)
          .or(`source_id.eq.${lead.source_id},primary_email.ilike.${email.from_email}`)
          .limit(1)
          .maybeSingle();

        if (linkedContact) contactId = linkedContact.id;
      }
    }

    // Create contact if not found
    if (!contactId) {
      if (isSystem) {
        // Bounce/daemon/noreply sender with no existing contact: keep it out of
        // the CRM entirely — a "Mail Delivery System" contact poisons reply stats.
        debugLog.push(`  CRM: system sender ${email.from_email} unknown — not creating contact`);
        return { success: false };
      }
      const nameParts = (email.from_name || '').split(' ');
      const firstName = nameParts[0] || email.from_email.split('@')[0];
      const lastName = nameParts.slice(1).join(' ') || null;
      const displayName = lastName ? `${firstName} ${lastName}` : firstName;
      const { data: newContact, error: contactError } = await supabase
        .from('crm_contacts')
        .insert({
          organization_id: mailbox.organization_id,
          first_name: firstName,
          last_name: lastName,
          display_name: displayName,
          primary_email: email.from_email,
          source: 'email_inbound',
        })
        .select('id')
        .single();

      if (contactError) {
        debugLog.push(`  CRM: create contact error: ${contactError.message}`);
        return { success: false };
      }
      contactId = newContact.id;
    }

    debugLog.push(`  CRM: contactId=${contactId}, calling get_or_create_conversation...`);

    // Get or create conversation
    const { data: conversationId, error: convError } = await supabase
      .rpc('get_or_create_conversation', {
        p_org_id: mailbox.organization_id,
        p_contact_id: contactId,
        p_channel: 'email',
        p_external_participant_id: email.from_email,
        p_mailbox_id: mailbox.id,
      });

    if (convError || !conversationId) {
      debugLog.push(`  CRM: get_or_create_conversation error: ${convError?.message}, data: ${JSON.stringify(conversationId)}`);
      return { success: false };
    }

    resultConversationId = conversationId as string;

    // Tag system conversations (bounces, noreply, DMARC, notifications)
    if (isSystemEmail(email.from_email, email.subject)) {
      await supabase
        .from('crm_conversations')
        .update({ is_system: true, status: 'closed', unread_count: 0 })
        .eq('id', conversationId)
        .eq('is_system', false);
    } else {
      // Reopen archived conversations on inbound (trigger only reopens 'closed')
      await supabase
        .from('crm_conversations')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('status', 'archived');
    }

    debugLog.push(`  CRM: conversation=${conversationId}, inserting message...`);

    // Dedup check: skip if we already have a message with this email_message_id
    if (email.message_id) {
      const { data: existingMsg } = await supabase
        .from('crm_messages')
        .select('id')
        .eq('external_message_id', email.message_id)
        .eq('organization_id', mailbox.organization_id)
        .limit(1)
        .maybeSingle();

      if (existingMsg) {
        debugLog.push(`  CRM: dedup — message ${email.message_id} already exists, skipping`);
        return { success: true, conversationId: resultConversationId, messageId: existingMsg.id, contactId: contactId! };
      }
    } else if (resultConversationId) {
      // Fallback dedup for emails without Message-ID: check for identical content in recent messages
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentMessages } = await supabase
        .from('crm_messages')
        .select('id, content')
        .eq('conversation_id', resultConversationId)
        .eq('sender_type', 'contact')
        .gte('created_at', fiveMinutesAgo)
        .limit(10);

      const bodyContent = email.html_body || email.text_body || '';
      if (bodyContent && (recentMessages || []).some((msg: any) => msg.content === bodyContent)) {
        debugLog.push(`  CRM: dedup — message without Message-ID matches recent content, skipping`);
        return { success: true, conversationId: resultConversationId, messageId: null, contactId: contactId! };
      }
    }

    // Insert inbound message
    const bodyContent = email.html_body || email.text_body || '';

    const { data: insertedMsg, error: msgError } = await supabase
      .from('crm_messages')
      .insert({
        organization_id: mailbox.organization_id,
        conversation_id: conversationId,
        contact_id: contactId,
        direction: 'inbound',
        sender_type: 'contact',
        content: bodyContent,
        content_type: email.html_body ? 'html' : 'text',
        email_subject: email.subject,
        email_from: email.from_email,
        external_message_id: email.message_id || null,
        metadata: {
          email_from_name: email.from_name,
          email_in_reply_to: email.in_reply_to,
          email_references: email.references,
          source_send_log_id: sourceSendLog?.id || null,
          source_sequence_id: sourceSendLog?.sequence_id || null,
          source_lead_id: sourceSendLog?.lead_id || null,
          source: 'imap_poller',
        },
        created_at: email.date?.toISOString() || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (msgError) {
      debugLog.push(`  CRM: insert message error: ${msgError.message}`);
      return { success: false };
    }

    resultMessageId = insertedMsg?.id;
    debugLog.push(`  CRM: message inserted OK (id=${resultMessageId})`);

    // Note: The update_conversation_on_message trigger on crm_messages INSERT
    // automatically handles: message_count++, unread_count++, last_message_at,
    // last_message_preview, and reopening closed conversations on inbound.

    return { success: true, conversationId: resultConversationId, messageId: resultMessageId, contactId: contactId! };
  } catch (error) {
    debugLog.push(`  CRM: exception: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false };
  }
}

// ============================================================================
// Spam/Junk Folder Scanning
// ============================================================================

/**
 * Scan the mailbox's spam/junk folder for NDR bounce notifications or
 * complaint signals that match our sent emails.
 * Returns the number of spam-flagged send_log entries.
 */
async function scanSpamFolder(
  supabase: any,
  mailbox: {
    id: string;
    organization_id: string;
    email_address: string;
    metadata: Record<string, any>;
  }
): Promise<number> {
  try {
    const creds = await extractSMTPCredentials(mailbox.metadata || {});
    if (!creds || !creds.imap_host || !creds.imap_username || !creds.imap_password) {
      return 0;
    }

    const lastJunkUid = (mailbox.metadata?.last_junk_uid as number) || 0;

    const result = await fetchSpamFolderEmails(
      {
        imap_host: creds.imap_host,
        imap_port: creds.imap_port || 993,
        imap_username: creds.imap_username,
        imap_password: creds.imap_password,
      },
      lastJunkUid
    );

    if (!result || result.emails.length === 0) {
      return 0;
    }

    console.log(`[IMAP Poller] Mailbox ${mailbox.email_address}: ${result.emails.length} email(s) in spam folder "${result.folder}"`);

    let spamCount = 0;
    let highestUid = lastJunkUid;

    for (const email of result.emails) {
      try {
        // Match against our sent emails by threading headers or sender
        let matchedSendLog: any = null;

        // Strategy 1: email references our message_id (it's a reply/NDR to our email)
        if (email.in_reply_to) {
          const { data } = await supabase
            .from('email_send_log')
            .select('id, status')
            .eq('email_message_id', email.in_reply_to)
            .eq('organization_id', mailbox.organization_id)
            .limit(1)
            .single();

          if (data) matchedSendLog = data;
        }

        // Strategy 2: check references array
        if (!matchedSendLog && email.references.length > 0) {
          for (const ref of email.references) {
            const { data } = await supabase
              .from('email_send_log')
              .select('id, status')
              .eq('email_message_id', ref)
              .eq('organization_id', mailbox.organization_id)
              .limit(1)
              .single();

            if (data) {
              matchedSendLog = data;
              break;
            }
          }
        }

        // If we matched and it's not already spam/bounced, mark as spam
        if (matchedSendLog && !['spam', 'bounced', 'replied'].includes(matchedSendLog.status)) {
          await supabase
            .from('email_send_log')
            .update({ status: 'spam' })
            .eq('id', matchedSendLog.id);

          spamCount++;
          console.log(`[IMAP Poller] Marked send_log ${matchedSendLog.id} as spam (found in junk folder)`);
        }
      } catch (err) {
        console.error(`[IMAP Poller] Error processing spam email UID ${email.uid}:`, err);
      }

      if (email.uid > highestUid) highestUid = email.uid;
    }

    // Update last_junk_uid in metadata.
    // Atomic JSONB merge — see comment on last_imap_uid write for rationale.
    if (highestUid > lastJunkUid) {
      await supabase.rpc('merge_mailbox_metadata', {
        p_id: mailbox.id,
        p_merge: { last_junk_uid: highestUid },
      });
    }

    return spamCount;
  } catch (error) {
    console.error(`[IMAP Poller] Spam folder scan failed for ${mailbox.email_address}:`, error);
    return 0;
  }
}
