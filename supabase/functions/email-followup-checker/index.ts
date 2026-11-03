/**
 * Email Follow-Up Checker Edge Function
 *
 * Cron: every 30 minutes.
 * Evaluates no_reply_timeout follow-up rules and enrolls leads in
 * target sequences when the timeout has elapsed.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { evaluateFollowupRules } from '../_shared/followup-rule-engine.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ENROLLMENTS_PER_RUN = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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

  try {
    console.log('[Followup Checker] Starting...');

    // Fetch all active no_reply_timeout rules
    const { data: rules, error: rulesError } = await supabase
      .from('email_sequence_followup_rules')
      .select(`
        id, sequence_id, campaign_id, lead_magnet_campaign_id,
        organization_id, name,
        trigger_type, trigger_config, target_sequence_id,
        delay_hours, total_triggered
      `)
      .eq('trigger_type', 'no_reply_timeout')
      .eq('is_active', true);

    if (rulesError) throw new Error(`Failed to fetch rules: ${rulesError.message}`);
    if (!rules || rules.length === 0) {
      console.log('[Followup Checker] No active no_reply_timeout rules');
      return new Response(
        JSON.stringify({ success: true, rules: 0, enrolled: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Followup Checker] Processing ${rules.length} rule(s)`);

    let totalEnrolled = 0;
    let totalSkipped = 0;
    let processedCount = 0;

    for (const rule of rules) {
      if (processedCount >= MAX_ENROLLMENTS_PER_RUN) break;

      try {
        // Only email sequence rules have enrollments to check
        // Campaign/lead-magnet rules use different timeout sources (not implemented yet)
        if (!rule.sequence_id) continue;

        const config = rule.trigger_config as { timeout_days?: number };
        const timeoutDays = config.timeout_days || 7;
        const cutoffDate = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000).toISOString();

        // Find enrollments that completed or replied (without positive intent)
        // in the source sequence, and whose timeout has elapsed
        const { data: candidates, error: candidateError } = await supabase
          .from('email_sequence_enrollments')
          .select('id, lead_id, sequence_id, status, updated_at')
          .eq('sequence_id', rule.sequence_id)
          .in('status', ['completed', 'replied'])
          .lt('updated_at', cutoffDate)
          .limit(MAX_ENROLLMENTS_PER_RUN - processedCount);

        if (candidateError) {
          console.error(`[Followup Checker] Error fetching candidates for rule ${rule.name}:`, candidateError.message);
          continue;
        }

        if (!candidates || candidates.length === 0) continue;

        console.log(`[Followup Checker] Rule "${rule.name}": ${candidates.length} candidate(s)`);

        for (const candidate of candidates) {
          if (processedCount >= MAX_ENROLLMENTS_PER_RUN) break;

          try {
            // For "replied" enrollments, check if the conversation intent
            // is positive (interested/meeting_booked) — skip those
            if (candidate.status === 'replied') {
              const { data: convData } = await supabase
                .from('crm_conversations')
                .select('lead_intent')
                .eq('organization_id', rule.organization_id)
                .or(`metadata->>source_lead_id.eq.${candidate.lead_id}`)
                .limit(1)
                .maybeSingle();

              // If the lead expressed positive intent, don't follow up
              if (convData?.lead_intent && ['interested', 'meeting_booked'].includes(convData.lead_intent)) {
                totalSkipped++;
                continue;
              }
            }

            const result = await evaluateFollowupRules(supabase, {
              sequenceId: rule.sequence_id,
              leadId: candidate.lead_id,
              organizationId: rule.organization_id,
              triggerType: 'no_reply_timeout',
            });

            totalEnrolled += result.enrolled.length;
            totalSkipped += result.skipped.length;
            processedCount++;
          } catch (err) {
            console.error(`[Followup Checker] Error processing candidate ${candidate.id}:`, err);
            processedCount++;
          }
        }
      } catch (err) {
        console.error(`[Followup Checker] Error processing rule ${rule.name}:`, err);
      }
    }

    console.log(`[Followup Checker] Complete: ${totalEnrolled} enrolled, ${totalSkipped} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        rules: rules.length,
        enrolled: totalEnrolled,
        skipped: totalSkipped,
        processed: processedCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Followup Checker] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
