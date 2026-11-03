/**
 * AI SDR: Evening Reply Handler (5:00 PM UTC daily)
 *
 * Pulls new inbound messages from the last 24h.
 * Cross-references with campaign_lead_progress to find SDR-campaign contacts.
 * Classifies reply intent using the existing classifyReply() utility.
 * Responds via crm-send-message edge function for interested/neutral leads.
 * Moves meeting_booked leads to the 'won' pipeline stage.
 * Marks do_not_contact / unsubscribe leads appropriately.
 * Runs a safety net query to flag leads stuck for 3+ days.
 * Logs everything to ai_sdr_sessions.
 *
 * Manual trigger:
 *   curl -X POST <SUPABASE_URL>/functions/v1/ai-sdr-replies \
 *     -H "Authorization: Bearer <ANON_KEY>" \
 *     -d '{"organization_id": "...", "dry_run": true}'
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { classifyReply, type LeadIntent } from '../_shared/reply-classifier.ts';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RunOptions {
  organization_id?: string;
  dry_run?: boolean;
  lookback_hours?: number; // Default 24h
}

// ============================================================================
// Entry point
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let options: RunOptions = {};
  try {
    options = await req.json();
  } catch { /* empty body ok */ }

  const {
    organization_id: targetOrgId,
    dry_run: dryRun = false,
    lookback_hours: lookbackHours = 24,
  } = options;

  console.log(`[ai-sdr-replies] Starting. dryRun=${dryRun} lookbackHours=${lookbackHours} targetOrg=${targetOrgId ?? 'all'}`);

  // Get orgs to process (any org that has recent inbound messages)
  let orgIds: string[] = [];
  if (targetOrgId) {
    orgIds = [targetOrgId];
  } else {
    const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();
    const { data: convRows } = await supabase
      .from('crm_messages')
      .select('crm_conversations!inner(organization_id)')
      .eq('direction', 'inbound')
      .gte('created_at', since);

    const seen = new Set<string>();
    for (const row of convRows ?? []) {
      const orgId = (row as Record<string, unknown>)['crm_conversations'] as Record<string, unknown> | null;
      const id = orgId?.organization_id as string;
      if (id && !seen.has(id)) {
        seen.add(id);
        orgIds.push(id);
      }
    }
  }

  console.log(`[ai-sdr-replies] Processing ${orgIds.length} org(s)`);

  const results: Record<string, unknown>[] = [];
  for (const orgId of orgIds) {
    const result = await processOrg(supabase, orgId, { dryRun, lookbackHours });
    results.push({ organization_id: orgId, ...result });
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// ============================================================================
// Per-org processing
// ============================================================================

async function processOrg(
  supabase: SupabaseClient<any>,
  orgId: string,
  opts: { dryRun: boolean; lookbackHours: number },
) {
  const { dryRun, lookbackHours } = opts;

  // Create session log
  let sessionId: string | null = null;
  if (!dryRun) {
    const { data: session } = await supabase
      .from('ai_sdr_sessions')
      .insert({
        organization_id: orgId,
        run_type: 'evening_reply_handler',
        status: 'running',
        config: { dry_run: dryRun, org_id: orgId, lookback_hours: lookbackHours },
      })
      .select('id')
      .single();
    sessionId = session?.id ?? null;
  }

  const stats = {
    replies_handled: 0,
    meetings_booked: 0,
    errors: 0,
    stuck_leads_flagged: 0,
  };

  try {
    // Get OpenRouter key — required for classifyReply LLM fallback
    const openRouterKey = await getOrgOpenRouterKey(supabase, orgId);
    if (!openRouterKey) {
      const msg = 'OpenRouter API key not configured — cannot classify replies';
      await finalizeSession(supabase, sessionId, stats, msg);
      return { warning: msg, ...stats };
    }

    // Pull new inbound messages from last N hours
    const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

    const { data: messages, error: msgError } = await supabase
      .from('crm_messages')
      .select(`
        id, conversation_id, content, created_at,
        crm_conversations!inner(
          id, contact_id, channel, channel_account_id,
          external_conversation_id, organization_id, status
        )
      `)
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .not('content', 'is', null)
      .neq('content', '')
      .order('created_at', { ascending: true })
      .limit(100);

    if (msgError) throw new Error(`Failed to fetch messages: ${msgError.message}`);

    // Filter to messages from this org only
    const orgMessages = (messages ?? []).filter((m) => {
      const conv = (m as Record<string, unknown>).crm_conversations as Record<string, unknown>;
      return conv?.organization_id === orgId;
    });

    console.log(`[ai-sdr-replies] Org ${orgId}: ${orgMessages.length} new inbound messages`);

    // Process each message
    for (const msg of orgMessages) {
      const conv = (msg as Record<string, unknown>).crm_conversations as Record<string, unknown>;
      const contactId = conv.contact_id as string;
      const conversationId = conv.id as string;
      const channel = conv.channel as string;
      const channelAccountId = conv.channel_account_id as string | null;
      const externalConversationId = conv.external_conversation_id as string | null;
      const messageContent = msg.content as string;

      try {
        // Only process contacts that are in SDR campaigns
        const { data: progressRows } = await supabase
          .from('campaign_lead_progress')
          .select(`
            id, campaign_id, status, lead_intent, current_node_id, channel_used,
            linkedin_campaigns!inner(name, organization_id, autopilot_config)
          `)
          .eq('contact_id', contactId)
          .in('status', ['waiting', 'in_progress', 'replied', 'pending'])
          .order('updated_at', { ascending: false })
          .limit(1);

        if (!progressRows || progressRows.length === 0) {
          // Not a campaign contact - skip
          continue;
        }

        const progress = progressRows[0];
        const campaign = (progress as Record<string, unknown>).linkedin_campaigns as Record<string, unknown>;

        // Skip if campaign doesn't belong to this org
        if (campaign?.organization_id !== orgId) continue;

        // Skip if already classified (intent already set)
        if (progress.lead_intent && progress.lead_intent !== 'out_of_office') continue;

        // Fetch last 10 messages for thread context
        const { data: thread } = await supabase
          .from('crm_messages')
          .select('content, direction, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(10);

        const threadContext = (thread ?? [])
          .reverse()
          .map((m) => `[${m.direction === 'inbound' ? 'THEM' : 'US'}]: ${m.content}`)
          .join('\n');

        // Classify the reply
        const classification = await classifyReply(
          {
            from_email: '',
            subject: '',
            body_text: messageContent,
            thread_context: threadContext,
          },
          openRouterKey,
        );

        console.log(`[ai-sdr-replies] Contact ${contactId}: intent=${classification.intent} confidence=${classification.confidence}`);

        // Act on classification
        let responseMessage: string | null = null;
        let newProgressStatus: string | null = null;
        let newContactStatus: string | null = null;
        let moveToWon = false;
        let snoozeUntil: string | null = null;
        let tagToAdd: string | null = null;

        switch (classification.intent as LeadIntent) {
          case 'interested':
          case 'neutral': {
            // Generate a follow-up response
            responseMessage = await generateFollowUpResponse(
              openRouterKey,
              messageContent,
              threadContext,
              classification.intent,
            );
            break;
          }

          case 'meeting_booked': {
            responseMessage = await generateMeetingConfirmation(openRouterKey, messageContent, threadContext);
            newProgressStatus = 'completed';
            moveToWon = true;
            stats.meetings_booked++;
            break;
          }

          case 'not_interested': {
            newProgressStatus = 'completed';
            tagToAdd = 'sdr_not_interested';
            break;
          }

          case 'do_not_contact':
          case 'unsubscribe': {
            newProgressStatus = 'completed';
            newContactStatus = 'do_not_contact';
            tagToAdd = 'DO-NOT-CONTACT';
            break;
          }

          case 'out_of_office': {
            // Snooze: schedule next action 7 days from now
            snoozeUntil = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
            break;
          }

          case 'auto_reply': {
            // Skip silently — no action needed
            break;
          }
        }

        if (!dryRun) {
          // Send response message if needed
          if (responseMessage && channelAccountId) {
            try {
              await supabase.functions.invoke('crm-send-message', {
                body: {
                  conversation_id: conversationId,
                  contact_id: contactId,
                  channel,
                  channel_account_id: channelAccountId,
                  external_conversation_id: externalConversationId,
                  content: responseMessage,
                  sender_type: 'ai',
                  source_type: 'ai_response',
                },
              });
            } catch (sendErr) {
              console.error(`[ai-sdr-replies] Failed to send response to ${contactId}:`, sendErr);
            }
          }

          // Update campaign_lead_progress
          const progressUpdate: Record<string, unknown> = {
            lead_intent: classification.intent,
            intent_confidence: classification.confidence,
            replied_at: new Date().toISOString(),
          };
          if (newProgressStatus) progressUpdate.status = newProgressStatus;
          if (snoozeUntil) progressUpdate.next_action_at = snoozeUntil;

          await supabase
            .from('campaign_lead_progress')
            .update(progressUpdate)
            .eq('id', progress.id);

          // Move contact to won pipeline stage
          if (moveToWon) {
            const wonStageId = await getWonStageId(supabase, orgId);
            if (wonStageId) {
              await supabase.from('crm_contacts').update({
                stage_id: wonStageId,
                stage_entered_at: new Date().toISOString(),
              }).eq('id', contactId).eq('organization_id', orgId);
            }
          }

          // Update contact status if DNC
          if (newContactStatus) {
            await supabase.from('crm_contacts').update({
              status: newContactStatus,
              updated_at: new Date().toISOString(),
            }).eq('id', contactId).eq('organization_id', orgId);
          }

          // Add tag if needed
          if (tagToAdd) {
            const { data: contactData } = await supabase
              .from('crm_contacts')
              .select('tags')
              .eq('id', contactId)
              .single();
            const existingTags: string[] = contactData?.tags ?? [];
            if (!existingTags.includes(tagToAdd)) {
              await supabase.from('crm_contacts').update({
                tags: [...existingTags, tagToAdd],
              }).eq('id', contactId);
            }
          }
        } else {
          console.log(`[ai-sdr-replies] DRY RUN - Contact ${contactId}: intent=${classification.intent}, would send: ${responseMessage ? 'yes' : 'no'}`);
        }

        stats.replies_handled++;
      } catch (err) {
        console.error(`[ai-sdr-replies] Error processing message ${msg.id}:`, err);
        stats.errors++;
      }
    }

    // --- Safety Net: Find stuck leads ---
    const stuckLeads = await findStuckLeads(supabase, orgId);
    console.log(`[ai-sdr-replies] Found ${stuckLeads.length} stuck leads`);

    if (stuckLeads.length > 0 && !dryRun) {
      // Tag stuck leads so they're visible in the CRM
      for (const lead of stuckLeads) {
        const { data: contactData } = await supabase
          .from('crm_contacts')
          .select('tags')
          .eq('id', lead.contact_id)
          .single();
        const existingTags: string[] = contactData?.tags ?? [];
        if (!existingTags.includes('sdr_stuck')) {
          await supabase.from('crm_contacts').update({
            tags: [...existingTags, 'sdr_stuck'],
          }).eq('id', lead.contact_id);
        }
      }
      stats.stuck_leads_flagged = stuckLeads.length;
    }

    const summary = [
      `Processed ${stats.replies_handled} replies.`,
      stats.meetings_booked > 0 ? `${stats.meetings_booked} meeting(s) booked!` : null,
      stats.stuck_leads_flagged > 0 ? `${stats.stuck_leads_flagged} stuck leads flagged.` : null,
      stats.errors > 0 ? `${stats.errors} errors.` : null,
      dryRun ? '[DRY RUN]' : null,
    ].filter(Boolean).join(' ');

    console.log(`[ai-sdr-replies] ${summary}`);
    await finalizeSession(supabase, sessionId, stats, summary);
    return { ...stats, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-sdr-replies] Fatal error for org ${orgId}:`, msg);
    if (sessionId) {
      await supabase.from('ai_sdr_sessions').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        summary: `Fatal error: ${msg}`,
      }).eq('id', sessionId);
    }
    return { error: msg, ...stats };
  }
}

// ============================================================================
// Response generation (Claude via OpenRouter)
// ============================================================================

async function generateFollowUpResponse(
  openRouterKey: string,
  replyContent: string,
  threadContext: string,
  intent: LeadIntent,
): Promise<string> {
  const isNeutral = intent === 'neutral';

  const systemPrompt = `You write B2B sales follow-up messages.
The prospect has ${isNeutral ? 'sent an unclear or neutral reply' : 'expressed interest'}.
Write a short, natural follow-up that ${isNeutral ? 'gently clarifies their interest and offers value' : 'builds on their interest and proposes a call or demo'}.
RULES: Max 150 words. Conversational tone. No emojis. No pressure. Return ONLY the message.`;

  const response = await callOpenRouter(openRouterKey, systemPrompt,
    `Thread:\n${threadContext}\n\nTheir latest reply:\n${replyContent}\n\nWrite the follow-up response.`);

  return response;
}

async function generateMeetingConfirmation(
  openRouterKey: string,
  replyContent: string,
  threadContext: string,
): Promise<string> {
  const systemPrompt = `You write B2B sales meeting confirmation messages.
The prospect has agreed to a meeting or confirmed a time.
Write a brief, warm confirmation that includes a calendly/booking link placeholder [BOOKING_LINK].
RULES: Max 100 words. Friendly tone. No emojis. Return ONLY the message.`;

  const response = await callOpenRouter(openRouterKey, systemPrompt,
    `Thread:\n${threadContext}\n\nTheir reply:\n${replyContent}\n\nWrite the meeting confirmation.`);

  return response;
}

async function callOpenRouter(
  openRouterKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return sanitizeAIOutput((json.choices?.[0]?.message?.content ?? '').trim());
}

// ============================================================================
// Safety net
// ============================================================================

async function findStuckLeads(
  supabase: SupabaseClient<any>,
  orgId: string,
): Promise<{ id: string; contact_id: string; next_action_at: string }[]> {
  const { data } = await supabase
    .from('campaign_lead_progress')
    .select(`
      id, contact_id, next_action_at,
      linkedin_campaigns!inner(organization_id)
    `)
    .in('status', ['in_progress', 'waiting'])
    .lt('next_action_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
    .eq('linkedin_campaigns.organization_id', orgId)
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    contact_id: row.contact_id as string,
    next_action_at: row.next_action_at as string,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

async function getWonStageId(
  supabase: SupabaseClient<any>,
  orgId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('crm_pipeline_stages')
    .select('id')
    .eq('organization_id', orgId)
    .eq('stage_type', 'won')
    .limit(1)
    .single();
  return data?.id ?? null;
}

async function getOrgOpenRouterKey(
  supabase: SupabaseClient<any>,
  organizationId: string,
): Promise<string | null> {
  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData) return null;
    return await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
  } catch {
    return null;
  }
}

async function finalizeSession(
  supabase: SupabaseClient<any>,
  sessionId: string | null,
  stats: { replies_handled: number; meetings_booked: number; errors: number; stuck_leads_flagged: number },
  summary: string,
) {
  if (!sessionId) return;
  await supabase.from('ai_sdr_sessions').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    replies_handled: stats.replies_handled,
    meetings_booked: stats.meetings_booked,
    errors: stats.errors,
    summary,
  }).eq('id', sessionId);
}

async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);
  const keyBytes = Uint8Array.from(
    encryptionKeyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, cryptoKey, ciphertextWithTag,
  );
  return new TextDecoder().decode(decrypted);
}
