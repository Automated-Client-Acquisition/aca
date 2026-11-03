/**
 * Follow-Up Rule Engine (Node.js port)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadIntent } from './reply-classifier.js';

export interface EvaluateParams {
  sequenceId?: string;
  campaignId?: string;
  leadMagnetCampaignId?: string;
  leadId: string;
  organizationId: string;
  intent?: LeadIntent;
  confidence?: number;
  triggerType: 'intent_match' | 'no_reply_timeout';
}

export interface EvaluateResult {
  triggered: string[];
  enrolled: string[];
  skipped: string[];
}

interface FollowupRule {
  id: string;
  sequence_id: string;
  organization_id: string;
  name: string;
  trigger_type: 'intent_match' | 'no_reply_timeout';
  trigger_config: Record<string, unknown>;
  target_sequence_id: string;
  delay_hours: number;
  is_active: boolean;
  total_triggered: number;
}

export async function evaluateFollowupRules(
  supabase: SupabaseClient,
  params: EvaluateParams,
): Promise<EvaluateResult> {
  const result: EvaluateResult = { triggered: [], enrolled: [], skipped: [] };

  let sourceColumn: string;
  let sourceId: string | undefined;

  if (params.sequenceId) {
    sourceColumn = 'sequence_id';
    sourceId = params.sequenceId;
  } else if (params.campaignId) {
    sourceColumn = 'campaign_id';
    sourceId = params.campaignId;
  } else if (params.leadMagnetCampaignId) {
    sourceColumn = 'lead_magnet_campaign_id';
    sourceId = params.leadMagnetCampaignId;
  } else {
    return result;
  }

  const { data: rules, error: rulesError } = await supabase
    .from('email_sequence_followup_rules')
    .select('*')
    .eq(sourceColumn, sourceId)
    .eq('trigger_type', params.triggerType)
    .eq('is_active', true);

  if (rulesError || !rules?.length) return result;

  for (const rule of rules as FollowupRule[]) {
    try {
      if (!checkRuleTrigger(rule, params)) continue;

      const { data: existingEnrollment } = await supabase
        .from('email_sequence_enrollments')
        .select('id')
        .eq('sequence_id', rule.target_sequence_id)
        .eq('lead_id', params.leadId)
        .eq('status', 'active')
        .maybeSingle();

      if (existingEnrollment) { result.skipped.push(rule.id); continue; }

      const { data: lead } = await supabase
        .from('leads')
        .select('last_sequence_email_at')
        .eq('id', params.leadId)
        .single();

      if (lead?.last_sequence_email_at) {
        const lastSent = new Date(lead.last_sequence_email_at).getTime();
        const hoursSinceLast = (Date.now() - lastSent) / (1000 * 60 * 60);
        if (hoursSinceLast < 24) { result.skipped.push(rule.id); continue; }
      }

      const { data: targetSequence } = await supabase
        .from('email_sequences')
        .select('id, status')
        .eq('id', rule.target_sequence_id)
        .single();

      if (!targetSequence || targetSequence.status !== 'active') { result.skipped.push(rule.id); continue; }

      const nextSendAt = new Date(Date.now() + rule.delay_hours * 60 * 60 * 1000).toISOString();

      const { data: enrollment, error: enrollError } = await supabase
        .from('email_sequence_enrollments')
        .insert({
          sequence_id: rule.target_sequence_id,
          lead_id: params.leadId,
          organization_id: params.organizationId,
          status: 'active',
          current_step: 0,
          next_send_at: nextSendAt,
          metadata: {
            triggered_by_rule: rule.id,
            triggered_by_rule_name: rule.name,
            source_sequence_id: params.sequenceId || null,
            source_campaign_id: params.campaignId || null,
            source_lead_magnet_campaign_id: params.leadMagnetCampaignId || null,
            trigger_type: rule.trigger_type,
            trigger_intent: params.intent || null,
          },
        })
        .select('id')
        .single();

      if (enrollError || !enrollment) { result.skipped.push(rule.id); continue; }

      await supabase
        .from('email_sequence_followup_rules')
        .update({ total_triggered: rule.total_triggered + 1 })
        .eq('id', rule.id);

      result.triggered.push(rule.id);
      result.enrolled.push(enrollment.id);
      console.log(`[Followup] Rule "${rule.name}" triggered: enrolled lead ${params.leadId}`);
    } catch (err) {
      console.error(`[Followup] Error evaluating rule ${rule.name}:`, err);
      result.skipped.push(rule.id);
    }
  }

  return result;
}

function checkRuleTrigger(rule: FollowupRule, params: EvaluateParams): boolean {
  if (rule.trigger_type === 'intent_match') {
    const config = rule.trigger_config as { intents?: string[]; confidence_min?: number };
    if (!config.intents?.length || !params.intent) return false;
    return config.intents.includes(params.intent) && (params.confidence ?? 0) >= (config.confidence_min ?? 0.4);
  }
  if (rule.trigger_type === 'no_reply_timeout') return true;
  return false;
}
