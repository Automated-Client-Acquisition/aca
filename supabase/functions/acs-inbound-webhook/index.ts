/**
 * ACS Inbound Email Webhook
 *
 * Receives inbound email events from Azure EventGrid when emails arrive
 * at ACS-provisioned domains. Matches replies to existing conversations
 * using Message-ID threading (In-Reply-To / References headers), then
 * routes through the existing reply processing pipeline.
 *
 * Threading priority:
 *   1. In-Reply-To header → match email_send_log.message_id
 *   2. References header → match any Message-ID in email_send_log.message_id
 *   3. Sender+Recipient pair → match send_log.recipient_email ↔ mailbox.email_address
 *   4. Subject line matching → strip Re:/Fwd: prefixes, match send_log.subject
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { classifyNdr, detectAutoReply, detectBounce, isSystemEmail, processReplyForEnrollment } from '../_shared/reply-processing.ts';
import { classifyReply } from '../_shared/reply-classifier.ts';
import { evaluateFollowupRules } from '../_shared/followup-rule-engine.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EventGridEvent {
  id: string;
  eventType: string;
  subject: string;
  data: Record<string, unknown>;
  dataVersion: string;
  metadataVersion: string;
  eventTime: string;
  topic: string;
}

interface InboundEmail {
  from: string;
  to: string[];
  subject: string;
  bodyPlainText: string;
  bodyHtml: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  receivedAt: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();

    // ── EventGrid Subscription Validation Handshake ──────────────
    // Azure sends this when first creating the EventGrid subscription.
    if (Array.isArray(body) && body[0]?.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
      const validationCode = body[0].data?.validationCode;
      console.log('[ACS Inbound] EventGrid validation handshake received');
      return new Response(
        JSON.stringify({ validationResponse: validationCode }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Process Email Events ─────────────────────────────────────
    const events: EventGridEvent[] = Array.isArray(body) ? body : [body];

    let processed = 0;
    let errors = 0;

    for (const event of events) {
      if (event.eventType !== 'Microsoft.Communication.EmailReceived') {
        console.log(`[ACS Inbound] Ignoring event type: ${event.eventType}`);
        continue;
      }

      try {
        const email = parseInboundEmail(event.data);
        console.log(`[ACS Inbound] Processing email from ${email.from} to ${email.to.join(', ')} subject="${email.subject}"`);

        await processInboundEmail(supabase, email);
        processed++;
      } catch (err) {
        console.error(`[ACS Inbound] Failed to process event ${event.id}:`, err instanceof Error ? err.message : err);
        errors++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, errors }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ACS Inbound Webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// Email Parsing
// ============================================================================

function parseInboundEmail(data: Record<string, unknown>): InboundEmail {
  const headers = (data.internetMessageHeaders as Array<{ name: string; value: string }>) || [];
  const headerMap = new Map(headers.map((h) => [h.name.toLowerCase(), h.value]));

  const from = (data.from as string) || headerMap.get('from') || '';
  const toRaw = data.recipients as string[] || [];
  const subject = (data.subject as string) || '';

  // Parse In-Reply-To header
  const inReplyTo = headerMap.get('in-reply-to') || '';

  // Parse References header (space-separated Message-IDs)
  const referencesRaw = headerMap.get('references') || '';
  const references = referencesRaw
    .split(/\s+/)
    .filter((ref) => ref.startsWith('<') && ref.endsWith('>'))
    .map((ref) => ref.replace(/^<|>$/g, ''));

  return {
    from: extractEmailAddress(from),
    to: toRaw.map(extractEmailAddress),
    subject,
    bodyPlainText: (data.bodyPlainText as string) || '',
    bodyHtml: (data.bodyHTML as string) || '',
    messageId: headerMap.get('message-id') || '',
    inReplyTo: inReplyTo.replace(/^<|>$/g, ''),
    references,
    receivedAt: (data.receivedDateTime as string) || new Date().toISOString(),
  };
}

function extractEmailAddress(raw: string): string {
  // Extract email from "Name <email@domain.com>" or plain "email@domain.com"
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

// ============================================================================
// Thread Matching & Processing
// ============================================================================

async function processInboundEmail(
  supabase: SupabaseClient<any>,
  email: InboundEmail
): Promise<void> {

  // NDRs come from system senders (mailer-daemon, postmaster) — detect them
  // before the system-email skip, which would otherwise drop every bounce.
  const isBounce = detectBounce(email.from, undefined, email.subject);

  // Skip system/automated emails
  if (!isBounce && isSystemEmail(email.from, email.subject)) {
    console.log(`[ACS Inbound] Skipping system email from ${email.from}`);
    return;
  }

  // ── Step 1: Find matching outbound email via threading headers ──
  const sendLogEntry = await findMatchingSendLog(supabase, email);

  if (!sendLogEntry && isBounce) {
    console.log(`[ACS Inbound] NDR from ${email.from} matches no outbound — ignoring`);
    return;
  }

  if (!sendLogEntry) {
    console.log(`[ACS Inbound] No matching outbound found for email from ${email.from} — storing as unsolicited inbound`);
    await storeUnsolicitedInbound(supabase, email);
    return;
  }

  console.log(`[ACS Inbound] Matched to send_log ${sendLogEntry.id} (campaign: ${sendLogEntry.campaign_id}, sequence: ${sendLogEntry.sequence_id})`);

  // ── Step 2: Classify the reply ──
  const isAutoReply = detectAutoReply(email.subject, email.bodyPlainText, email.from);

  if (isBounce) {
    const ndr = classifyNdr(email.subject, email.bodyPlainText);
    const { classification } = ndr;

    // Only a dead recipient is a bounce. A reputation/tenant block is our
    // sending identity being refused; recording it as 'bounced' would suppress
    // a perfectly good address.
    await supabase
      .from('email_send_log')
      .update({
        status: ndr.sendLogStatus,
        error_category: classification.category,
        error_message: (classification.diagnostic || email.subject || 'NDR with no diagnostic').slice(0, 2000),
        ...(ndr.suppressRecipient ? { bounced_at: new Date().toISOString() } : {}),
      })
      .eq('id', sendLogEntry.id);

    if (ndr.suppressRecipient) {
      await supabase.rpc('increment_mailbox_stat', {
        p_mailbox_id: sendLogEntry.mailbox_id,
        p_stat: 'bounced',
      });
    }

    console.log(
      `[ACS Inbound] NDR for ${sendLogEntry.recipient_email}: ${classification.category} ` +
        `(${classification.enhancedCode ?? classification.smtpCode ?? 'no code'}) → ${ndr.sendLogStatus}`,
    );
    return;
  }

  if (isAutoReply) {
    await supabase
      .from('email_send_log')
      .update({ status: 'auto_replied', replied_at: new Date().toISOString() })
      .eq('id', sendLogEntry.id);

    console.log(`[ACS Inbound] Auto-reply from ${email.from}`);
  } else {
    // Real reply — update send log
    await supabase
      .from('email_send_log')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', sendLogEntry.id);

    // Update mailbox reply stats
    await supabase.rpc('increment_mailbox_stat', {
      p_mailbox_id: sendLogEntry.mailbox_id,
      p_stat: 'replied',
    });
  }

  // ── Step 3: Process reply for enrollment (sequence tracking) ──
  if (sendLogEntry.sequence_id && sendLogEntry.lead_id) {
    try {
      await processReplyForEnrollment(supabase, {
        sequenceId: sendLogEntry.sequence_id,
        leadId: sendLogEntry.lead_id,
        isAutoReply,
        replyBody: email.bodyPlainText,
        replySubject: email.subject,
        senderEmail: email.from,
      });
    } catch (err) {
      console.error(`[ACS Inbound] processReplyForEnrollment failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Step 4: Classify reply sentiment/intent ──
  if (!isAutoReply && !isBounce) {
    try {
      const classification = await classifyReply(supabase, {
        replyBody: email.bodyPlainText,
        originalSubject: sendLogEntry.subject || '',
        recipientEmail: sendLogEntry.recipient_email,
        organizationId: sendLogEntry.organization_id,
      });

      if (classification) {
        console.log(`[ACS Inbound] Reply classified as: ${classification.intent} (${classification.sentiment})`);
      }
    } catch (err) {
      console.error(`[ACS Inbound] classifyReply failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Step 5: Evaluate follow-up rules and autopilot ──
  if (sendLogEntry.sequence_id && !isAutoReply && !isBounce) {
    try {
      await evaluateFollowupRules(supabase, {
        sequenceId: sendLogEntry.sequence_id,
        leadId: sendLogEntry.lead_id,
        replyBody: email.bodyPlainText,
        replySubject: email.subject,
        organizationId: sendLogEntry.organization_id,
      });
    } catch (err) {
      console.error(`[ACS Inbound] evaluateFollowupRules failed:`, err instanceof Error ? err.message : err);
    }

    // Autopilot: auto-respond if configured
    try {
      await processAutopilot(supabase, {
        sequenceId: sendLogEntry.sequence_id,
        leadId: sendLogEntry.lead_id,
        mailboxId: sendLogEntry.mailbox_id,
        replyBody: email.bodyPlainText,
        replySubject: email.subject,
        senderEmail: email.from,
        organizationId: sendLogEntry.organization_id,
      });
    } catch (err) {
      console.error(`[ACS Inbound] processAutopilot failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Step 6: Store inbound email in CRM ──
  await createCrmActivity(supabase, sendLogEntry, email);
}

// ============================================================================
// Thread Matching (Priority-ordered)
// ============================================================================

async function findMatchingSendLog(
  supabase: SupabaseClient<any>,
  email: InboundEmail
): Promise<Record<string, unknown> | null> {

  // Priority 1: Match via In-Reply-To header → message_id
  if (email.inReplyTo) {
    const { data } = await supabase
      .from('email_send_log')
      .select('*')
      .eq('message_id', email.inReplyTo)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      console.log(`[ACS Inbound] Thread match via In-Reply-To: ${email.inReplyTo}`);
      return data;
    }
  }

  // Priority 2: Match via References header → any message_id
  if (email.references.length > 0) {
    const { data } = await supabase
      .from('email_send_log')
      .select('*')
      .in('message_id', email.references)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      console.log(`[ACS Inbound] Thread match via References header`);
      return data;
    }
  }

  // Priority 3: Match via sender ↔ recipient pair
  // The inbound sender should be someone we sent an outbound to
  // The inbound recipient should be one of our mailboxes
  for (const toAddr of email.to) {
    const { data } = await supabase
      .from('email_send_log')
      .select('*')
      .eq('recipient_email', email.from)
      .eq('mailbox_id', await findMailboxIdByEmail(supabase, toAddr))
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      console.log(`[ACS Inbound] Thread match via sender+recipient pair: ${email.from} → ${toAddr}`);
      return data;
    }
  }

  // Priority 4: Subject line matching (strip Re:/Fwd: prefixes)
  const cleanSubject = email.subject.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim();
  if (cleanSubject) {
    for (const toAddr of email.to) {
      const mailboxId = await findMailboxIdByEmail(supabase, toAddr);
      if (!mailboxId) continue;

      const { data } = await supabase
        .from('email_send_log')
        .select('*')
        .eq('recipient_email', email.from)
        .eq('mailbox_id', mailboxId)
        .eq('subject', cleanSubject)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        console.log(`[ACS Inbound] Thread match via subject line: "${cleanSubject}"`);
        return data;
      }
    }
  }

  return null;
}

async function findMailboxIdByEmail(
  supabase: SupabaseClient<any>,
  email: string
): Promise<string | null> {
  const { data } = await supabase
    .from('email_mailboxes')
    .select('id')
    .eq('email_address', email.toLowerCase())
    .limit(1)
    .maybeSingle();

  return data?.id || null;
}

// ============================================================================
// Unsolicited Inbound (no matching outbound)
// ============================================================================

async function storeUnsolicitedInbound(
  supabase: SupabaseClient<any>,
  email: InboundEmail
): Promise<void> {
  // Find which mailbox received this email
  for (const toAddr of email.to) {
    const { data: mailbox } = await supabase
      .from('email_mailboxes')
      .select('id, organization_id')
      .eq('email_address', toAddr.toLowerCase())
      .limit(1)
      .maybeSingle();

    if (mailbox) {
      // Create CRM activity for unsolicited inbound
      await supabase
        .from('crm_activities')
        .insert({
          organization_id: mailbox.organization_id,
          activity_type: 'email_received',
          subject: `Inbound email from ${email.from}`,
          description: email.bodyPlainText?.substring(0, 500),
          metadata: {
            from: email.from,
            to: toAddr,
            subject: email.subject,
            message_id: email.messageId,
            received_at: email.receivedAt,
            source: 'acs_webhook',
          },
        });

      console.log(`[ACS Inbound] Stored unsolicited inbound from ${email.from} to ${toAddr}`);
      break;
    }
  }
}

// ============================================================================
// CRM Activity Creation
// ============================================================================

async function createCrmActivity(
  supabase: SupabaseClient<any>,
  sendLog: Record<string, unknown>,
  email: InboundEmail
): Promise<void> {
  try {
    // Find CRM contact by email
    const { data: contact } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('organization_id', sendLog.organization_id)
      .eq('primary_email', email.from)
      .limit(1)
      .maybeSingle();

    if (contact) {
      await supabase
        .from('crm_activities')
        .insert({
          organization_id: sendLog.organization_id as string,
          contact_id: contact.id,
          activity_type: 'email_received',
          subject: `Reply: ${email.subject}`,
          description: email.bodyPlainText?.substring(0, 500),
          metadata: {
            from: email.from,
            subject: email.subject,
            send_log_id: sendLog.id,
            campaign_id: sendLog.campaign_id,
            sequence_id: sendLog.sequence_id,
            source: 'acs_webhook',
          },
        });
    }
  } catch (err) {
    console.error(`[ACS Inbound] CRM activity creation failed:`, err instanceof Error ? err.message : err);
  }
}
