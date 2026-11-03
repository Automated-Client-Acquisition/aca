/**
 * Lead Magnet Follow-Up Checker
 *
 * Cron (every 30 min) that sends follow-up DMs to lead magnet leads
 * who received the initial DM but never replied.
 *
 * Two paths:
 *   1. Static template follow-ups — leads with status='dm_sent' (no AI chatbot)
 *   2. AI-generated follow-ups — leads with status='ai_chatting' where the
 *      chatbot's last message went unanswered
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { chatbotModel } from '../_shared/default-models.ts';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LLM_TIMEOUT_MS = 20_000;

interface SmartConfig {
  followup_enabled?: boolean;
  followup_delay_hours?: number;
  /** Legacy single template — kept for backwards compatibility */
  followup_message_template?: string;
  followup_message_1?: string;
  followup_message_2?: string;
  max_followups?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // verify_jwt=false: only pg_cron / internal callers (service key) may trigger this.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const startTime = Date.now();
  let leadsChecked = 0;
  let staticFollowupsSent = 0;
  let aiFollowupsSent = 0;

  try {
    console.log('[Lead Magnet Followup] Starting check...');

    // Fetch campaigns with followup enabled
    const { data: campaigns, error: campaignsError } = await supabase
      .from('unipile_campaigns')
      .select('id, organization_id, smart_config, account_id, ai_chatbot_enabled, ai_chatbot_model, ai_chatbot_instructions')
      .eq('is_active', true)
      .not('smart_config', 'is', null);

    if (campaignsError) {
      throw new Error(`Failed to fetch campaigns: ${campaignsError.message}`);
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('[Lead Magnet Followup] No campaigns with smart config');
      return new Response(JSON.stringify({ success: true, message: 'No campaigns to check' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cache decrypted API keys per org to avoid repeated decryption
    const orgApiKeys = new Map<string, string>();

    for (const campaign of campaigns) {
      const smartConfig = campaign.smart_config as SmartConfig;

      if (!smartConfig.followup_enabled) {
        continue;
      }

      const maxFollowups = smartConfig.max_followups || 2;
      const delayHours = smartConfig.followup_delay_hours || 72;
      const cutoff = new Date(Date.now() - delayHours * 60 * 60 * 1000).toISOString();

      // ─── Path 1: Static template follow-ups (non-AI leads) ──────────
      const hasStaticMessages = smartConfig.followup_message_1 || smartConfig.followup_message_2 || smartConfig.followup_message_template;
      if (hasStaticMessages) {
        const { data: leads, error: leadsError } = await supabase
          .from('unipile_leads')
          .select('id, commenter_name, commenter_id, dm_sent_at, last_followup_at, followup_count')
          .eq('campaign_id', campaign.id)
          .eq('status', 'dm_sent')
          .eq('ai_conversation_active', false)
          .is('replied_at', null)
          .lt('followup_count', maxFollowups)
          .order('dm_sent_at', { ascending: true })
          .limit(50);

        if (!leadsError && leads?.length) {
          for (const lead of leads) {
            leadsChecked++;

            const lastContactAt = lead.last_followup_at || lead.dm_sent_at;
            if (!lastContactAt || new Date(lastContactAt) > new Date(cutoff)) {
              continue;
            }

            const name = lead.commenter_name || 'there';
            // Pick message by attempt number (1-indexed). Fall back to legacy single template.
            const attemptNumber = (lead.followup_count || 0) + 1;
            const rawTemplate =
              (attemptNumber === 1 ? smartConfig.followup_message_1 : smartConfig.followup_message_2)
              || smartConfig.followup_message_template
              || '';

            const message = rawTemplate
              .replace(/\{\{name\}\}/gi, name)
              .replace(/\{name\}/gi, name)
              .replace(/\{\{full_name\}\}/gi, name)
              .replace(/\{full_name\}/gi, name)
              .replace(/\{\{first_name\}\}/gi, name)
              .replace(/\{first_name\}/gi, name)
              // Safety net: strip any remaining unrecognized {placeholder} patterns
              .replace(/\{\{[^}]+\}\}/g, (match) => {
                console.warn(`[Lead Magnet Followup] Unrecognized placeholder "${match}" in template for lead ${lead.id} — removing it`);
                return '';
              })
              .replace(/\{[^}]+\}/g, (match) => {
                console.warn(`[Lead Magnet Followup] Unrecognized placeholder "${match}" in template for lead ${lead.id} — removing it`);
                return '';
              });

            if (!message.trim()) continue;

            const { error: queueError } = await supabase
              .from('unipile_message_queue')
              .insert({
                organization_id: campaign.organization_id,
                campaign_id: campaign.id,
                lead_id: lead.id,
                account_id: campaign.account_id,
                recipient_platform_id: lead.commenter_id,
                recipient_name: lead.commenter_name,
                message_text: message,
                scheduled_for: new Date().toISOString(),
                priority: 5,
              });

            if (queueError) {
              console.error(`[Lead Magnet Followup] Queue error for lead ${lead.id}:`, queueError.message);
              continue;
            }

            await supabase
              .from('unipile_leads')
              .update({
                followup_count: (lead.followup_count || 0) + 1,
                last_followup_at: new Date().toISOString(),
              })
              .eq('id', lead.id);

            staticFollowupsSent++;
            console.log(`[Lead Magnet Followup] Static followup ${(lead.followup_count || 0) + 1}/${maxFollowups} for lead ${lead.id}`);
          }
        }
      }

      // ─── Path 2: AI-generated follow-ups (chatbot leads) ────────────
      if (!campaign.ai_chatbot_enabled) {
        continue;
      }

      // Find active AI conversations where the bot's last message went unanswered
      const { data: conversations, error: convError } = await supabase
        .from('ai_chatbot_conversations')
        .select(`
          id, conversation_history, system_prompt, turn_count, max_turns,
          last_ai_response_at, total_input_tokens, total_output_tokens,
          lead_id
        `)
        .eq('campaign_id', campaign.id)
        .eq('status', 'active')
        .lt('last_ai_response_at', cutoff)
        .order('last_ai_response_at', { ascending: true })
        .limit(20);

      if (convError || !conversations?.length) {
        continue;
      }

      for (const conv of conversations) {
        leadsChecked++;

        // Fetch lead data separately to avoid FK name assumptions
        const { data: lead } = await supabase
          .from('unipile_leads')
          .select('id, commenter_id, commenter_name, followup_count, last_followup_at')
          .eq('id', conv.lead_id)
          .single();

        if (!lead) continue;

        // Check turn and followup limits
        if (conv.turn_count >= conv.max_turns) continue;
        if ((lead.followup_count || 0) >= maxFollowups) continue;

        // Verify last message was from assistant (not a missed user reply)
        const history = (conv.conversation_history || []) as Array<{
          role: string;
          content: string;
          timestamp: string;
        }>;
        if (history.length === 0) continue;
        const lastEntry = history[history.length - 1];
        if (lastEntry.role !== 'assistant') continue;

        // Get or cache OpenRouter API key for this org
        let openRouterKey = orgApiKeys.get(campaign.organization_id);
        if (!openRouterKey) {
          const { data: apiKeyData } = await supabase
            .from('api_keys')
            .select('key_encrypted')
            .eq('organization_id', campaign.organization_id)
            .eq('provider', 'openrouter')
            .single();

          if (!apiKeyData) {
            console.warn(`[Lead Magnet Followup] No OpenRouter API key for org ${campaign.organization_id}, skipping AI followups`);
            break; // Skip all conversations for this campaign
          }

          const encKey = Deno.env.get('ENCRYPTION_KEY')!;
          openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encKey);
          orgApiKeys.set(campaign.organization_id, openRouterKey);
        }

        // Calculate hours since last AI message
        const hoursSinceLastMessage = Math.round(
          (Date.now() - new Date(conv.last_ai_response_at).getTime()) / (1000 * 60 * 60)
        );

        // Build follow-up prompt
        const followupNumber = (lead.followup_count || 0) + 1;
        const followupInstruction = [
          `\n\n--- FOLLOW-UP CONTEXT ---`,
          `The lead hasn't replied to your last message, sent ${hoursSinceLastMessage} hours ago.`,
          `This is follow-up attempt ${followupNumber} of ${maxFollowups}.`,
          `Send a brief, natural follow-up message (1-2 sentences) to re-engage them.`,
          `Don't repeat what you already said. Be warm but not pushy.`,
          followupNumber > 1
            ? `This is your second+ nudge — keep it lighter and shorter than the first.`
            : `A gentle check-in works well — reference the value you offered or ask a simple question.`,
        ].join('\n');

        const systemPrompt = (conv.system_prompt || '') + followupInstruction;

        const messages = [
          { role: 'system', content: systemPrompt },
          ...history.map(entry => ({ role: entry.role, content: entry.content })),
        ];

        // Call OpenRouter
        const aiModel = chatbotModel(campaign.ai_chatbot_model);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

        let aiResponse: string;
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': supabaseUrl,
            },
            body: JSON.stringify({
              model: aiModel,
              messages,
              temperature: 0.7,
              max_tokens: 200,
            }),
            signal: controller.signal,
          });

          if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            console.error(`[Lead Magnet Followup] OpenRouter error for conv ${conv.id}: ${llmResponse.status} ${errorText}`);
            continue;
          }

          const llmData = await llmResponse.json();
          aiResponse = sanitizeAIOutput(llmData.choices?.[0]?.message?.content?.trim() || '');
          inputTokens = llmData.usage?.prompt_tokens || 0;
          outputTokens = llmData.usage?.completion_tokens || 0;

          if (!aiResponse) {
            console.error(`[Lead Magnet Followup] Empty LLM response for conv ${conv.id}`);
            continue;
          }
        } catch (llmErr) {
          if (llmErr instanceof DOMException && llmErr.name === 'AbortError') {
            console.error(`[Lead Magnet Followup] LLM timeout for conv ${conv.id}`);
          } else {
            console.error(`[Lead Magnet Followup] LLM error for conv ${conv.id}:`, llmErr);
          }
          continue;
        } finally {
          clearTimeout(timeout);
        }

        // Queue the AI follow-up message
        const { error: queueError } = await supabase
          .from('unipile_message_queue')
          .insert({
            organization_id: campaign.organization_id,
            campaign_id: campaign.id,
            lead_id: lead.id,
            account_id: campaign.account_id,
            recipient_platform_id: lead.commenter_id,
            recipient_name: lead.commenter_name,
            message_text: aiResponse,
            scheduled_for: new Date().toISOString(),
            priority: 5,
          });

        if (queueError) {
          console.error(`[Lead Magnet Followup] Queue error for AI conv ${conv.id}:`, queueError.message);
          continue;
        }

        // Update conversation: append follow-up to history, bump turn count & tokens
        const now = new Date().toISOString();
        const updatedHistory = [
          ...history,
          { role: 'assistant', content: aiResponse, timestamp: now },
        ];

        await supabase
          .from('ai_chatbot_conversations')
          .update({
            conversation_history: updatedHistory,
            turn_count: conv.turn_count + 1,
            last_ai_response_at: now,
            total_input_tokens: (conv.total_input_tokens || 0) + inputTokens,
            total_output_tokens: (conv.total_output_tokens || 0) + outputTokens,
          })
          .eq('id', conv.id);

        // Update lead tracking
        await supabase
          .from('unipile_leads')
          .update({
            followup_count: followupNumber,
            last_followup_at: now,
            ai_conversation_turn_count: conv.turn_count + 1,
          })
          .eq('id', lead.id);

        aiFollowupsSent++;
        console.log(`[Lead Magnet Followup] AI followup ${followupNumber}/${maxFollowups} for conv ${conv.id} (${inputTokens}+${outputTokens} tokens)`);

        // Hand off if this follow-up exhausted max_followups or max_turns
        const newTurnCount = conv.turn_count + 1;
        if (followupNumber >= maxFollowups || newTurnCount >= conv.max_turns) {
          const reason = followupNumber >= maxFollowups
            ? `No reply after ${followupNumber} follow-up(s)`
            : `Max conversation turns reached (${newTurnCount}/${conv.max_turns})`;

          await supabase
            .from('ai_chatbot_conversations')
            .update({
              status: 'handed_off',
              handoff_at: now,
              handoff_reason: reason,
            })
            .eq('id', conv.id);

          await supabase
            .from('unipile_leads')
            .update({
              ai_conversation_active: false,
              ai_handoff_requested: true,
              ai_handoff_reason: reason,
              status: 'pending',
            })
            .eq('id', lead.id);

          console.log(`[Lead Magnet Followup] Handed off conv ${conv.id}: ${reason}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    const totalFollowups = staticFollowupsSent + aiFollowupsSent;
    console.log(`[Lead Magnet Followup] Done in ${duration}ms. Checked ${leadsChecked} leads, sent ${totalFollowups} followups (${staticFollowupsSent} static, ${aiFollowupsSent} AI).`);

    return new Response(
      JSON.stringify({
        success: true,
        leadsChecked,
        followupsSent: totalFollowups,
        staticFollowupsSent,
        aiFollowupsSent,
        durationMs: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Lead Magnet Followup] Error:', message);

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
