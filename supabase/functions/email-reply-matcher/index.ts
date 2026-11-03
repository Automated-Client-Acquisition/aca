/**
 * Email Reply Matcher Edge Function
 *
 * Correlates inbound emails to send_log entries and sequence enrollments.
 * Auto-pauses on reply, detects auto-replies, and handles company-level stop.
 *
 * Receives inbound emails via webhook/push from SMTP/IMAP providers.
 * This is a secondary/fallback entry point — the primary is IMAP polling.
 *
 * Uses shared reply-processing module (shared with email-imap-poller).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { parseOOOReturnDate } from '../_shared/ooo-date-parser.ts';
import {
  calculateOOOResumeAt,
  detectAutoReply,
  detectOutOfOffice,
  processReplyForEnrollment,
} from '../_shared/reply-processing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InboundEmail {
  from_email: string;
  to_email: string;
  subject: string;
  body?: string;
  in_reply_to?: string;
  references?: string[];
  message_id?: string;
  mailbox_id?: string;
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

    // Process a single inbound email (webhook/push mode)
    const inbound: InboundEmail = body;
    return await handleInboundEmail(supabase, inbound);

  } catch (error) {
    console.error('[Reply Matcher] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Handle a single inbound email (webhook/push mode).
 */
async function handleInboundEmail(supabase: any, inbound: InboundEmail): Promise<Response> {
  console.log('[Reply Matcher] Received inbound:', {
    from: inbound.from_email,
    to: inbound.to_email,
    subject: inbound.subject?.substring(0, 50),
  });

  if (!inbound.from_email) {
    return new Response(
      JSON.stringify({ error: 'from_email is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Look up matching send_log entries
  const { data: sendLogs, error: lookupError } = await supabase
    .from('email_send_log')
    .select('id, mailbox_id, sequence_id, lead_id, status, organization_id')
    .eq('recipient_email', inbound.from_email)
    .in('status', ['sent', 'delivered', 'opened', 'clicked'])
    .order('sent_at', { ascending: false })
    .limit(5);

  if (lookupError) {
    throw new Error(`Failed to look up send logs: ${lookupError.message}`);
  }

  if (!sendLogs || sendLogs.length === 0) {
    console.log('[Reply Matcher] No matching send_log entries found');
    return new Response(
      JSON.stringify({ success: true, matched: 0, autoReplies: 0, companyStopped: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const result = await processReply(supabase, inbound, sendLogs);

  console.log(`[Reply Matcher] Complete: ${result.matched} matched, ${result.autoReplies} auto-replies, ${result.companyStopped} company-stopped`);

  return new Response(
    JSON.stringify({
      success: true,
      ...result,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Process a reply against matching send_log entries.
 * Uses shared detectAutoReply and processReplyForEnrollment.
 */
async function processReply(
  supabase: any,
  inbound: InboundEmail,
  sendLogs: Array<{
    id: string;
    mailbox_id: string;
    sequence_id: string;
    lead_id: string;
    status: string;
    organization_id: string;
  }>
): Promise<{
  matched: number;
  autoReplies: number;
  companyStopped: number;
  isAutoReply: boolean;
}> {
  const nowISO = new Date().toISOString();
  let matchedCount = 0;
  let autoReplyCount = 0;
  let companyStoppedCount = 0;

  const isOutOfOffice = detectOutOfOffice(inbound.subject, inbound.body);
  const isAutoReply = isOutOfOffice || detectAutoReply(inbound.subject, inbound.body);
  const resumeAt = isOutOfOffice
    ? calculateOOOResumeAt(parseOOOReturnDate(inbound.body || ''))
    : undefined;

  for (const sendLog of sendLogs) {
    // Auto-replies must not masquerade as human replies in reporting. OOO is
    // handled as a reasoned pause below and will resume on its due date.
    await supabase
      .from('email_send_log')
      .update({
        status: isAutoReply ? 'auto_replied' : 'replied',
        replied_at: nowISO,
      })
      .eq('id', sendLog.id);

    matchedCount++;

    // Process sequence enrollment using shared module
    const enrollmentResult = await processReplyForEnrollment(
      supabase,
      sendLog,
      inbound.from_email,
      isAutoReply,
      { isOutOfOffice, resumeAt },
    );

    if (isAutoReply && enrollmentResult.paused) autoReplyCount++;
    companyStoppedCount += enrollmentResult.companyStopped;

    // Only process the most recent matching send_log
    break;
  }

  return {
    matched: matchedCount,
    autoReplies: autoReplyCount,
    companyStopped: companyStoppedCount,
    isAutoReply,
  };
}
