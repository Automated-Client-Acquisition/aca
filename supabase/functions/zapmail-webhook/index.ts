/**
 * ZapMail Webhook Edge Function
 *
 * Receives delivery events from ZapMail:
 * delivered, opened, clicked, bounced, complained
 *
 * Updates email_send_log and mailbox health metrics.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { recordSendResult } from '../_shared/email-rotation.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Event types from ZapMail webhook
type DeliveryEventType = 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';

interface ZapMailWebhookPayload {
  event: DeliveryEventType;
  message_id: string;
  mailbox_id: string;
  recipient_email: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// Map ZapMail events to send_log status values
const EVENT_TO_STATUS: Record<DeliveryEventType, string> = {
  delivered: 'delivered',
  opened: 'opened',
  clicked: 'clicked',
  bounced: 'bounced',
  complained: 'spam',
};

// Map events to timestamp fields on send_log
const EVENT_TO_TIMESTAMP: Record<string, string> = {
  opened: 'opened_at',
  clicked: 'clicked_at',
  bounced: 'bounced_at',
  replied: 'replied_at',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // No callers: ZapMail cannot send a Supabase JWT, so only operators (service-role key) may post events.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const payload: ZapMailWebhookPayload = await req.json();

    console.log('[ZapMail Webhook] Received:', {
      event: payload.event,
      message_id: payload.message_id,
      recipient: payload.recipient_email,
    });

    if (!payload.event || !payload.message_id) {
      return new Response(
        JSON.stringify({ error: 'Missing event or message_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up the send_log entry by message_id (stored in metadata) or by recipient + mailbox
    let sendLogQuery = supabase
      .from('email_send_log')
      .select('id, mailbox_id, status, sequence_id, lead_id')
      .limit(1);

    // Try to find by metadata.zapmail_message_id first
    const { data: sendLogs, error: lookupError } = await supabase
      .from('email_send_log')
      .select('id, mailbox_id, status, sequence_id, lead_id')
      .eq('recipient_email', payload.recipient_email)
      .order('sent_at', { ascending: false })
      .limit(1);

    if (lookupError) {
      console.error('[ZapMail Webhook] Lookup error:', lookupError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to look up send log' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!sendLogs || sendLogs.length === 0) {
      console.warn('[ZapMail Webhook] No send_log found for:', payload.recipient_email);
      return new Response(
        JSON.stringify({ success: true, matched: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sendLog = sendLogs[0];
    const newStatus = EVENT_TO_STATUS[payload.event];

    if (!newStatus) {
      console.warn('[ZapMail Webhook] Unknown event type:', payload.event);
      return new Response(
        JSON.stringify({ success: true, message: 'Unknown event type' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build update payload
    const update: Record<string, any> = {
      status: newStatus,
    };

    // Set timestamp field if applicable
    const tsField = EVENT_TO_TIMESTAMP[payload.event];
    if (tsField) {
      update[tsField] = payload.timestamp || new Date().toISOString();
    }

    // Update the send_log entry
    const { error: updateError } = await supabase
      .from('email_send_log')
      .update(update)
      .eq('id', sendLog.id);

    if (updateError) {
      console.error('[ZapMail Webhook] Failed to update send_log:', updateError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to update send log' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle bounce: record as send failure on the mailbox
    if (payload.event === 'bounced' && sendLog.mailbox_id) {
      await recordSendResult(supabase, sendLog.mailbox_id, false);
    }

    // Handle spam complaint: update mailbox spam_rate
    if (payload.event === 'complained' && sendLog.mailbox_id) {
      await updateMailboxSpamRate(supabase, sendLog.mailbox_id);
    }

    console.log(`[ZapMail Webhook] Updated send_log ${sendLog.id} -> ${newStatus}`);

    return new Response(
      JSON.stringify({ success: true, matched: true, sendLogId: sendLog.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ZapMail Webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Recalculate and update the spam_rate for a mailbox based on recent send_log data.
 */
async function updateMailboxSpamRate(supabase: any, mailboxId: string): Promise<void> {
  const { data: recentSends } = await supabase
    .from('email_send_log')
    .select('status')
    .eq('mailbox_id', mailboxId)
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'spam'])
    .order('sent_at', { ascending: false })
    .limit(100);

  if (!recentSends || recentSends.length === 0) return;

  const spamCount = recentSends.filter((s: any) => s.status === 'spam').length;
  const spamRate = spamCount / recentSends.length;

  await supabase
    .from('email_mailboxes')
    .update({
      spam_rate: spamRate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailboxId);
}
