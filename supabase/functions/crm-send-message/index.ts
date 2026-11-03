import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { authenticateRequest, unauthorized } from "../_shared/cli-auth.ts";
import { sendThreadedReply } from "../_shared/threaded-send.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessageRequest {
  action?: 'resolve_lead_magnet_context';
  conversation_id: string;
  // The remaining fields are derived from the conversation now (kept for backward compat).
  contact_id?: string;
  channel?: string;
  channel_account_id?: string;
  recipient_external_id?: string;
  recipient_display_name?: string;
  external_conversation_id?: string;
  content?: string;
  content_type?: string;
  attachments?: Array<{ type: string; url: string; filename: string }>;
  email_subject?: string;
  email_cc?: string[];
  email_bcc?: string[];
  // Optional: if a message record already exists (re-send / retry)
  message_id?: string;
  // Human-confirmed fulfillment marker. The recovery sequence is armed only
  // after the provider accepts this email.
  lead_magnet_delivery?: boolean | {
    followup_sequence_id?: string;
    delay_hours?: number;
  };
}

type LeadMagnetContextStatus = 'ready' | 'not_configured' | 'source_not_found' | 'ambiguous';

interface LeadMagnetRecoveryContext {
  status: LeadMagnetContextStatus;
  sourceSequenceId?: string;
  sourceSequenceName?: string;
  ruleId?: string;
  targetSequenceId?: string;
  targetSequenceName?: string;
  delayHours?: number;
  message?: string;
  contactId?: string;
  totalTriggered?: number;
}

type LeadMagnetRecoveryStatus = 'enrolled' | 'already_active' | 'failed';

interface LeadMagnetRecoveryResult {
  requested: true;
  status: LeadMagnetRecoveryStatus;
  sequenceId: string;
  sequenceName: string;
  enrollmentId?: string;
  warning?: string;
}

/**
 * CRM Send Message Edge Function
 *
 * Sends a reply into an existing conversation, preserving the conversation's mailbox
 * and email thread (Re: subject + In-Reply-To / References for email; same chat for
 * LinkedIn/IG/etc.). Delegates to the shared sendThreadedReply() so the threading +
 * mailbox logic is identical across this path, process-autopilot-queue, and the MCP
 * send_conversation_reply tool.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Authenticate (JWT or CLI token) — helper resolves user_id + org in one shot.
    let caller;
    try {
      caller = await authenticateRequest(req, supabase);
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }
    const organizationId = caller.organization_id;

    const input: SendMessageRequest = await req.json();

    if (input.action === 'resolve_lead_magnet_context') {
      if (!input.conversation_id) {
        return new Response(JSON.stringify({ error: 'conversation_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const context = await resolveLeadMagnetRecoveryContext(
        supabase,
        organizationId,
        input.conversation_id,
      );
      const { contactId: _contactId, totalTriggered: _totalTriggered, ...publicContext } = context;
      return new Response(JSON.stringify({ success: true, context: publicContext }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hasContent = !!(input.content?.trim());
    const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;

    if (!input.conversation_id || (!hasContent && !hasAttachments)) {
      return new Response(JSON.stringify({
        error: 'Missing required fields (conversation_id and content or attachments required)',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let recoveryContext: {
      sequenceId: string;
      sequenceName: string;
      delayHours: number;
      contactId: string;
      sourceSequenceId: string;
      sourceSequenceName: string;
      ruleId: string;
      totalTriggered: number;
    } | null = null;

    if (input.lead_magnet_delivery) {
      const context = await resolveLeadMagnetRecoveryContext(
        supabase,
        organizationId,
        input.conversation_id,
      );

      if (
        context.status !== 'ready' ||
        !context.targetSequenceId ||
        !context.targetSequenceName ||
        !context.sourceSequenceId ||
        !context.sourceSequenceName ||
        !context.ruleId ||
        !context.contactId ||
        !context.delayHours
      ) {
        return new Response(JSON.stringify({
          error: context.message || 'This campaign has no lead magnet recovery route configured',
          context,
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      recoveryContext = {
        sequenceId: context.targetSequenceId,
        sequenceName: context.targetSequenceName,
        delayHours: context.delayHours,
        contactId: context.contactId,
        sourceSequenceId: context.sourceSequenceId,
        sourceSequenceName: context.sourceSequenceName,
        ruleId: context.ruleId,
        totalTriggered: context.totalTriggered || 0,
      };
    }

    // The shared helper org-scopes the conversation lookup, derives the mailbox/recipient,
    // builds threading headers, sends via the channel router, and records the message.
    const result = await sendThreadedReply(supabase, {
      organizationId,
      conversationId: input.conversation_id,
      content: input.content || '',
      contentType: (input.content_type as 'text' | 'html' | 'markdown') || 'text',
      subject: input.email_subject,
      senderType: 'user',
      senderUserId: caller.user_id,
      attachments: input.attachments,
      cc: input.email_cc,
      bcc: input.email_bcc,
      messageId: input.message_id,
      metadata: recoveryContext ? {
        lead_magnet_delivery: true,
        recovery_type: 'lead_magnet_followup',
        recovery_sequence_id: recoveryContext.sequenceId,
        recovery_sequence_name: recoveryContext.sequenceName,
        recovery_delay_hours: recoveryContext.delayHours,
        recovery_source_sequence_id: recoveryContext.sourceSequenceId,
        recovery_source_sequence_name: recoveryContext.sourceSequenceName,
        recovery_rule_id: recoveryContext.ruleId,
        recovery_status: 'pending',
      } : undefined,
    });

    if (!result.success) {
      console.error('[CRM Send] Send failed:', result.error);
      return new Response(JSON.stringify({
        success: false,
        error: result.error || 'Failed to send message',
        errorCode: result.errorCode,
        messageId: result.messageId,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let leadMagnetRecovery: LeadMagnetRecoveryResult | undefined;

    if (recoveryContext) {
      leadMagnetRecovery = await armLeadMagnetRecovery(
        supabase,
        supabaseKey,
        organizationId,
        input.conversation_id,
        result.messageId!,
        recoveryContext,
      );
    }

    // Preserve the historical response shape (callers read `message`) while
    // returning the structured post-send recovery outcome separately.
    const { data: message } = await supabase
      .from('crm_messages')
      .select()
      .eq('id', result.messageId)
      .single();

    console.log(`[CRM Send] Message sent successfully: ${result.messageId}`);

    return new Response(JSON.stringify({
      success: true,
      messageId: result.messageId,
      externalMessageId: result.externalMessageId,
      message,
      leadMagnetRecovery,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[CRM Send] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function armLeadMagnetRecovery(
  supabase: any,
  serviceRoleKey: string,
  organizationId: string,
  conversationId: string,
  deliveryMessageId: string,
  context: {
    sequenceId: string;
    sequenceName: string;
    delayHours: number;
    contactId: string;
    sourceSequenceId: string;
    sourceSequenceName: string;
    ruleId: string;
    totalTriggered: number;
  },
): Promise<LeadMagnetRecoveryResult> {
  const base: Omit<LeadMagnetRecoveryResult, 'status'> = {
    requested: true,
    sequenceId: context.sequenceId,
    sequenceName: context.sequenceName,
  };

  try {
    const { data: enrollmentResult, error: enrollmentError } = await supabase.functions.invoke('enroll-leads', {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
      body: {
        sequenceId: context.sequenceId,
        organizationId,
        contactIds: [context.contactId],
        continueFromConversationId: conversationId,
        delayHours: context.delayHours,
      },
    });

    if (enrollmentError) throw enrollmentError;

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('source', 'crm_contact')
      .eq('source_id', context.contactId)
      .maybeSingle();

    if (!lead?.id) {
      throw new Error('The contact could not be resolved to an email lead');
    }

    let { data: enrollment } = await supabase
      .from('email_sequence_enrollments')
      .select('id, status, pause_reason, metadata')
      .eq('sequence_id', context.sequenceId)
      .eq('lead_id', lead.id)
      .maybeSingle();

    if (!enrollment) {
      const reason = enrollmentResult?.suppressed
        ? 'The contact is suppressed and cannot enter a follow-up sequence'
        : enrollmentResult?.noEmail
          ? 'The contact has no usable email address'
          : 'The follow-up enrollment was not created';
      throw new Error(reason);
    }

    let status: LeadMagnetRecoveryStatus = enrollmentResult?.enrolled > 0
      ? 'enrolled'
      : 'already_active';
    const existingStatus = String(enrollment.status || '');
    const terminalButReusable = ['completed', 'replied'].includes(existingStatus);

    if (existingStatus === 'paused' && enrollment.pause_reason !== 'out_of_office') {
      throw new Error('This contact already has a manually paused enrollment in the selected sequence');
    }

    const recoveryMetadata = {
      ...((enrollment.metadata as Record<string, unknown>) || {}),
      continue_from_conversation_id: conversationId,
      recovery_type: 'lead_magnet_followup',
      recovery_source_sequence_id: context.sourceSequenceId,
      recovery_rule_id: context.ruleId,
      delivery_message_id: deliveryMessageId,
      recovery_armed_at: new Date().toISOString(),
    };

    if (terminalButReusable) {
      const nextSendAt = new Date(Date.now() + context.delayHours * 60 * 60 * 1000).toISOString();
      const { data: rearmed, error: rearmError } = await supabase
        .from('email_sequence_enrollments')
        .update({
          status: 'active',
          current_step: 0,
          next_send_at: nextSendAt,
          pause_reason: null,
          resume_at: null,
          paused_by_conversation_id: null,
          metadata: recoveryMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', enrollment.id)
        .in('status', ['completed', 'replied'])
        .select('id, status, metadata')
        .maybeSingle();
      if (rearmError || !rearmed) {
        throw new Error(rearmError?.message || 'The previous follow-up enrollment could not be restarted');
      }
      enrollment = rearmed;
      status = 'enrolled';
    } else {
      const { data: linked, error: linkError } = await supabase
        .from('email_sequence_enrollments')
        .update({ metadata: recoveryMetadata, updated_at: new Date().toISOString() })
        .eq('id', enrollment.id)
        .in('status', ['active', 'paused'])
        .select('id, status, metadata')
        .maybeSingle();
      if (linkError || !linked) {
        throw new Error(linkError?.message || `Existing enrollment is ${existingStatus} and cannot be armed`);
      }
      enrollment = linked;
    }

    await supabase
      .from('email_send_log')
      .update({ sequence_id: context.sequenceId, lead_id: lead.id })
      .eq('crm_message_id', deliveryMessageId)
      .eq('organization_id', organizationId);

    await supabase
      .from('email_sequence_followup_rules')
      .update({ total_triggered: context.totalTriggered + 1 })
      .eq('id', context.ruleId)
      .eq('organization_id', organizationId);

    await updateRecoveryMessageMetadata(supabase, deliveryMessageId, {
      recovery_status: status,
      recovery_enrollment_id: enrollment.id,
      recovery_armed_at: new Date().toISOString(),
    });

    const warning = status === 'already_active'
      ? existingStatus === 'paused'
        ? 'The selected sequence remains paused until its out-of-office return date.'
        : 'The selected sequence will continue on its existing schedule in this email thread.'
      : undefined;
    return { ...base, status, enrollmentId: enrollment.id, warning };
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'Unknown follow-up scheduling error';
    console.error(`[CRM Send] Lead magnet email sent, recovery arming failed: ${warning}`);
    await updateRecoveryMessageMetadata(supabase, deliveryMessageId, {
      recovery_status: 'failed',
      recovery_error: warning,
      recovery_failed_at: new Date().toISOString(),
    });
    return { ...base, status: 'failed', warning };
  }
}

function messageIdVariants(value: string): string[] {
  const bare = value.trim().replace(/^<|>$/g, '');
  return bare ? [bare, `<${bare}>`] : [];
}

async function resolveLeadMagnetRecoveryContext(
  supabase: any,
  organizationId: string,
  conversationId: string,
): Promise<LeadMagnetRecoveryContext> {
  const { data: conversation, error: conversationError } = await supabase
    .from('crm_conversations')
    .select('id, contact_id, channel, mailbox_id')
    .eq('id', conversationId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (conversationError) throw conversationError;
  if (!conversation || conversation.channel !== 'email' || !conversation.mailbox_id) {
    return {
      status: 'source_not_found',
      message: 'Lead magnet recovery is available only for mailbox-backed email conversations',
    };
  }

  const { data: messages, error: messagesError } = await supabase
    .from('crm_messages')
    .select('direction, external_message_id, metadata, created_at')
    .eq('conversation_id', conversationId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (messagesError) throw messagesError;

  const threadMessages = messages || [];
  const latestInbound = threadMessages.find((message: any) => message.direction === 'inbound');
  const inboundMetadata = (latestInbound?.metadata || {}) as Record<string, unknown>;
  let sourceSequenceId = typeof inboundMetadata.source_sequence_id === 'string'
    ? inboundMetadata.source_sequence_id
    : undefined;

  if (!sourceSequenceId && latestInbound) {
    const directReplyId = typeof inboundMetadata.email_in_reply_to === 'string'
      ? inboundMetadata.email_in_reply_to
      : '';
    const referenceIds = Array.isArray(inboundMetadata.email_references)
      ? inboundMetadata.email_references.filter((value): value is string => typeof value === 'string')
      : [];
    const orderedIds = [directReplyId, ...referenceIds.slice().reverse()].filter(Boolean);
    const variants = [...new Set(orderedIds.flatMap(messageIdVariants))];

    if (variants.length > 0) {
      const { data: matchedLogs, error: matchedLogsError } = await supabase
        .from('email_send_log')
        .select('email_message_id, sequence_id')
        .eq('organization_id', organizationId)
        .in('email_message_id', variants)
        .not('sequence_id', 'is', null);
      if (matchedLogsError) throw matchedLogsError;

      const matchedByMessageId = new Map<string, string>();
      for (const log of matchedLogs || []) {
        for (const variant of messageIdVariants(log.email_message_id || '')) {
          if (log.sequence_id) matchedByMessageId.set(variant, log.sequence_id);
        }
      }
      for (const id of orderedIds) {
        const match = messageIdVariants(id)
          .map((variant) => matchedByMessageId.get(variant))
          .find(Boolean);
        if (match) {
          sourceSequenceId = match;
          break;
        }
      }
    }

    if (!sourceSequenceId && directReplyId) {
      const repliedToMessage = threadMessages.find((message: any) =>
        message.direction === 'outbound' &&
        messageIdVariants(directReplyId).includes(String(message.external_message_id || ''))
      );
      const repliedToMetadata = (repliedToMessage?.metadata || {}) as Record<string, unknown>;
      const preservedSource = repliedToMetadata.recovery_source_sequence_id || repliedToMetadata.source_sequence_id;
      if (typeof preservedSource === 'string') sourceSequenceId = preservedSource;
    }
  }

  if (!sourceSequenceId) {
    for (const message of threadMessages) {
      if (message.direction !== 'outbound') continue;
      const metadata = (message.metadata || {}) as Record<string, unknown>;
      const preservedSource = metadata.recovery_source_sequence_id || metadata.source_sequence_id;
      if (typeof preservedSource === 'string') {
        sourceSequenceId = preservedSource;
        break;
      }
    }
  }

  if (!sourceSequenceId) {
    const sendLogIds = threadMessages
      .filter((message: any) => message.direction === 'outbound')
      .map((message: any) => (message.metadata as Record<string, unknown> | null)?.send_log_id)
      .filter((value: unknown): value is string => typeof value === 'string');

    if (sendLogIds.length > 0) {
      const { data: fallbackLogs, error: fallbackLogsError } = await supabase
        .from('email_send_log')
        .select('id, sequence_id, sent_at')
        .eq('organization_id', organizationId)
        .in('id', [...new Set(sendLogIds)])
        .not('sequence_id', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1);
      if (fallbackLogsError) throw fallbackLogsError;
      sourceSequenceId = fallbackLogs?.[0]?.sequence_id || undefined;
    }
  }

  if (!sourceSequenceId) {
    return {
      status: 'source_not_found',
      message: 'This thread is not linked to an email sequence, so ACA cannot choose a recovery route safely',
    };
  }

  const [{ data: sourceSequence, error: sourceError }, { data: rules, error: rulesError }] = await Promise.all([
    supabase
      .from('email_sequences')
      .select('id, name')
      .eq('id', sourceSequenceId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('email_sequence_followup_rules')
      .select('id, target_sequence_id, delay_hours, is_active, total_triggered, target_sequence:target_sequence_id(id, name, status, steps)')
      .eq('organization_id', organizationId)
      .eq('sequence_id', sourceSequenceId)
      .eq('trigger_type', 'lead_magnet_delivery')
      .order('created_at', { ascending: true }),
  ]);

  if (sourceError) throw sourceError;
  if (rulesError) throw rulesError;
  if (!sourceSequence) {
    return { status: 'source_not_found', message: 'The originating email sequence no longer exists' };
  }

  const activeRules = (rules || []).filter((rule: any) => rule.is_active);
  if (activeRules.length === 0) {
    return {
      status: 'not_configured',
      sourceSequenceId: sourceSequence.id,
      sourceSequenceName: sourceSequence.name,
      message: rules?.length
        ? `Lead magnet recovery is turned off for “${sourceSequence.name}”`
        : `Set a recovery sequence for “${sourceSequence.name}” before sending`,
    };
  }
  if (activeRules.length > 1) {
    return {
      status: 'ambiguous',
      sourceSequenceId: sourceSequence.id,
      sourceSequenceName: sourceSequence.name,
      message: `“${sourceSequence.name}” has more than one active lead magnet recovery route`,
    };
  }

  const rule = activeRules[0];
  const targetSequence = Array.isArray(rule.target_sequence)
    ? rule.target_sequence[0]
    : rule.target_sequence;
  const orderedSteps = Array.isArray(targetSequence?.steps)
    ? [...targetSequence.steps]
      .filter((step: unknown): step is { type?: string; order?: number } => !!step && typeof step === 'object')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];
  const delayHours = Math.round(Number(rule.delay_hours));

  if (
    !targetSequence ||
    targetSequence.status !== 'active' ||
    orderedSteps[0]?.type !== 'email' ||
    !Number.isFinite(delayHours) ||
    delayHours < 1 ||
    delayHours > 720
  ) {
    return {
      status: 'not_configured',
      sourceSequenceId: sourceSequence.id,
      sourceSequenceName: sourceSequence.name,
      message: `The recovery route for “${sourceSequence.name}” needs an active email-first target and a valid delay`,
    };
  }

  return {
    status: 'ready',
    sourceSequenceId: sourceSequence.id,
    sourceSequenceName: sourceSequence.name,
    ruleId: rule.id,
    targetSequenceId: targetSequence.id,
    targetSequenceName: targetSequence.name,
    delayHours,
    contactId: conversation.contact_id,
    totalTriggered: Number(rule.total_triggered) || 0,
  };
}

async function updateRecoveryMessageMetadata(
  supabase: any,
  messageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: message } = await supabase
    .from('crm_messages')
    .select('metadata')
    .eq('id', messageId)
    .maybeSingle();

  await supabase
    .from('crm_messages')
    .update({ metadata: { ...((message?.metadata as Record<string, unknown>) || {}), ...patch } })
    .eq('id', messageId);
}
