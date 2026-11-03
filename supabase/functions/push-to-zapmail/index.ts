/**
 * Push Lead to ZapMail (Internal Email Engine)
 *
 * Two modes:
 * 1. Create new sequence: Creates a shared sequence TEMPLATE with {{custom_*}} variable
 *    placeholders, then enrolls the lead with per-lead content in enrollment.custom_data.
 * 2. Add to existing: Skips sequence creation, enrolls the lead in an existing sequence.
 *
 * In both modes, per-lead AI-generated content is stored in enrollment.custom_data.
 * The email-sequence-processor cron resolves {{custom_*}} variables at send time via
 * substituteVariables().
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default scheduling settings when fields are missing
const SCHEDULING_DEFAULTS = {
  send_window: { start: '08:00', end: '18:00' },
  timezone: 'America/New_York',
  skip_weekends: true,
};

/**
 * Calculate the initial next_send_at for a new enrollment, respecting
 * send window, timezone, and weekend settings.
 */
function calculateInitialSendTime(settings: Record<string, unknown>): Date {
  const merged = { ...SCHEDULING_DEFAULTS, ...settings };
  const tz = (merged.timezone as string) || 'America/New_York';
  const sendWindow = merged.send_window as { start: string; end: string } | undefined;
  const skipWeekends = merged.skip_weekends as boolean;

  if (!sendWindow) return new Date();

  const now = new Date();
  const [startH, startM] = sendWindow.start.split(':').map(Number);
  const [endH, endM] = sendWindow.end.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  // Get current local time in the configured timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const localMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekday] ?? 1;
  const localMinOfDay = localHour * 60 + localMin;

  const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;
  const isWithinWindow = localMinOfDay >= windowStartMin && localMinOfDay < windowEndMin;

  // If within window on a valid day, send soon with small jitter (0-5 min)
  if (isWithinWindow && !(skipWeekends && isWeekendDay)) {
    return new Date(now.getTime() + Math.random() * 5 * 60 * 1000);
  }

  // Otherwise, find the next valid window start
  let target = new Date(now.getTime());

  // If after window end or on weekend, advance to next day
  if (localMinOfDay >= windowEndMin || (skipWeekends && isWeekendDay)) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  // Set to window start on the target day
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Iterate to find a valid weekday (max 7 days)
  for (let i = 0; i < 7; i++) {
    const targetParts = formatter.formatToParts(target);
    const targetWeekday = targetParts.find(p => p.type === 'weekday')?.value || 'Mon';
    const targetDow = dayMap[targetWeekday] ?? 1;

    if (skipWeekends && (targetDow === 0 || targetDow === 6)) {
      target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }

    // Build UTC time for window start on this day
    const dateStr = dateFormatter.format(target);
    const localDateTimeStr = `${dateStr}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`;
    const utcStr = target.toLocaleString('en-US', { timeZone: 'UTC' });
    const localStr = target.toLocaleString('en-US', { timeZone: tz });
    const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

    const windowStartUtc = new Date(new Date(localDateTimeStr + 'Z').getTime() + offsetMs);
    // Add jitter (0-15 min)
    return new Date(windowStartUtc.getTime() + Math.random() * 15 * 60 * 1000);
  }

  // Fallback (shouldn't reach here)
  return new Date();
}

interface PushToZapMailRequest {
  contact: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    jobTitle?: string;
    linkedinUrl?: string;
  };
  // Email content (same format as push-to-smartlead)
  personalizedSubject?: string;
  personalizedBody?: string;
  customFields?: Record<string, string>;
  // Sequence name for the generated sequence
  sequenceName?: string;
  // Source tracking
  organizationId: string;
  progressId?: string;
  internalCampaignId?: string;
  // Internal engine settings (from Generate & Send flow)
  internalSettings?: {
    // Legacy fields (backwards compat)
    dailyLimit?: number;
    openTracking?: boolean;
    clickTracking?: boolean;
    stopOnReply?: boolean;
    // Full settings object (new flow)
    fullSettings?: Record<string, unknown>;
    autopilotConfig?: Record<string, unknown>;
    agentProfileId?: string | null;
  };
  mailboxTagFilter?: string[];
  // If set, add lead to this existing sequence instead of creating a new one
  existingSequenceId?: string;
  // If true, create sequence with status 'draft' instead of 'active'
  createAsDraft?: boolean;
  // Knowledge base document IDs to persist on the sequence
  knowledgeDocumentIds?: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: PushToZapMailRequest = await req.json();
    const {
      contact,
      personalizedSubject,
      personalizedBody,
      customFields = {},
      sequenceName,
      organizationId,
      progressId,
      internalCampaignId,
      internalSettings,
      mailboxTagFilter,
      existingSequenceId,
      createAsDraft,
      knowledgeDocumentIds,
    } = body;

    // Validate required fields
    if (!contact?.email || !organizationId) {
      throw new Error('Missing required fields: contact.email, organizationId');
    }

    if (!existingSequenceId && (!personalizedSubject || !personalizedBody)) {
      throw new Error('Missing required fields: personalizedSubject, personalizedBody');
    }

    // Determine the sequence ID — either existing or create new
    let sequenceId: string;
    let stepsCount: number;
    let seqSettings: Record<string, unknown> = {};

    if (existingSequenceId) {
      // ========== MODE: Add to existing sequence ==========
      // Verify the sequence exists
      const { data: existingSeq, error: existingSeqError } = await supabase
        .from('email_sequences')
        .select('id, steps, settings')
        .eq('id', existingSequenceId)
        .single();

      if (existingSeqError || !existingSeq) {
        throw new Error(`Existing sequence not found: ${existingSequenceId}`);
      }

      sequenceId = existingSeq.id;
      stepsCount = Array.isArray(existingSeq.steps) ? existingSeq.steps.length : 0;
      seqSettings = (existingSeq.settings as Record<string, unknown>) || {};
      console.log(`[push-to-zapmail] Adding to existing sequence ${sequenceId}`);
    } else {
      // ========== MODE: Create new shared sequence template ==========

      // Build TEMPLATE steps with {{custom_*}} placeholders
      const emailCount = parseInt(customFields.email_count || '0', 10);
      const steps: Array<{
        order: number;
        type: string;
        subject?: string;
        body?: string;
        delay_hours?: number;
      }> = [];

      if (emailCount > 1) {
        // Multi-step: build interleaved email + delay template steps
        let orderIndex = 0;
        for (let i = 1; i <= emailCount; i++) {
          // Use actual delay values from the first lead (delays are uniform across leads)
          const delayDays = parseInt(customFields[`email_${i}_delay`] || '3', 10);
          const delayHours = delayDays * 24;

          // Insert a delay step before each email except the first
          if (orderIndex > 0 && delayHours > 0) {
            steps.push({
              order: orderIndex,
              type: 'delay',
              delay_hours: delayHours,
            });
            orderIndex++;
          }

          // Template step: uses {{custom_email_N_subject}} / {{custom_email_N_body}}
          // These are resolved from enrollment.custom_data at send time
          steps.push({
            order: orderIndex,
            type: 'email',
            subject: `{{custom_email_${i}_subject}}`,
            body: `{{custom_email_${i}_body}}`,
          });
          orderIndex++;
        }
      }

      // Fallback: single email template
      if (steps.length === 0) {
        steps.push({
          order: 0,
          type: 'email',
          subject: '{{custom_email_1_subject}}',
          body: '{{custom_email_1_body}}',
        });
      }

      stepsCount = steps.length;

      // Build sequence settings — use full settings if provided, otherwise legacy fields
      let sequenceSettings: Record<string, unknown>;

      if (internalSettings?.fullSettings) {
        // Full settings provided from the new dialog flow
        sequenceSettings = { ...internalSettings.fullSettings };
      } else {
        // Legacy minimal settings (backwards compatibility)
        sequenceSettings = {
          stop_on_reply: internalSettings?.stopOnReply ?? true,
          stop_on_auto_reply: true,
          open_tracking: internalSettings?.openTracking ?? true,
          click_tracking: internalSettings?.clickTracking ?? true,
          unsubscribe_header: true,
        };

        if (internalSettings?.dailyLimit) {
          sequenceSettings.daily_limit = internalSettings.dailyLimit;
        }
      }

      // Resolve mailbox tag filter to mailbox IDs (only if not already set in fullSettings)
      if (mailboxTagFilter && mailboxTagFilter.length > 0 && !internalSettings?.fullSettings) {
        const { data: filteredMailboxes } = await supabase
          .from('email_mailboxes')
          .select('id, tags')
          .eq('organization_id', organizationId)
          .eq('status', 'ready');

        const matchingIds = (filteredMailboxes || [])
          .filter((m: { id: string; tags: string[] | null }) =>
            m.tags?.some((t: string) => mailboxTagFilter.includes(t))
          )
          .map((m: { id: string }) => m.id);

        if (matchingIds.length > 0) {
          sequenceSettings.mailbox_ids = matchingIds;
        }
      }

      // Extract tracking_domain_id from settings — it's a DB column, not settings JSON
      const trackingDomainId = sequenceSettings.tracking_domain_id || null;
      delete sequenceSettings.tracking_domain_id;
      delete sequenceSettings.custom_tracking_domain;

      // Create the shared sequence template
      const { data: sequence, error: seqError } = await supabase
        .from('email_sequences')
        .insert({
          organization_id: organizationId,
          campaign_id: internalCampaignId || null,
          name: sequenceName || `Outreach - ${new Date().toLocaleDateString()}`,
          steps,
          status: createAsDraft ? 'draft' : 'active',
          settings: sequenceSettings,
          source_type: 'template',
          knowledge_document_ids: knowledgeDocumentIds || [],
          tracking_domain_id: trackingDomainId,
        })
        .select('id')
        .single();

      if (seqError || !sequence) {
        throw new Error(`Failed to create email sequence: ${seqError?.message || 'Unknown error'}`);
      }

      sequenceId = sequence.id;

      // Apply autopilot config and agent profile if provided
      if (internalSettings?.autopilotConfig || internalSettings?.agentProfileId !== undefined) {
        const updateFields: Record<string, unknown> = {};
        if (internalSettings.autopilotConfig) {
          updateFields.autopilot_config = internalSettings.autopilotConfig;
        }
        if (internalSettings.agentProfileId !== undefined) {
          updateFields.agent_profile_id = internalSettings.agentProfileId;
        }
        await supabase
          .from('email_sequences')
          .update(updateFields)
          .eq('id', sequenceId);
      }

      seqSettings = sequenceSettings;
      console.log(`[push-to-zapmail] Created template sequence ${sequenceId} with ${stepsCount} steps (status: ${createAsDraft ? 'draft' : 'active'})`);
    }

    // ========== Build per-enrollment custom_data from AI-generated content ==========
    const customData: Record<string, string> = {};

    // Store all email content with custom_ prefix for namespace safety
    const emailCount = parseInt(customFields.email_count || '0', 10);
    if (emailCount > 0) {
      for (let i = 1; i <= emailCount; i++) {
        if (customFields[`email_${i}_subject`]) {
          customData[`custom_email_${i}_subject`] = customFields[`email_${i}_subject`];
        }
        if (customFields[`email_${i}_body`]) {
          customData[`custom_email_${i}_body`] = customFields[`email_${i}_body`];
        }
        if (customFields[`email_${i}_delay`]) {
          customData[`custom_email_${i}_delay`] = customFields[`email_${i}_delay`];
        }
      }
    } else if (personalizedSubject && personalizedBody) {
      // Single email fallback (skip if no content provided for existing sequence mode)
      customData['custom_email_1_subject'] = personalizedSubject;
      customData['custom_email_1_body'] = personalizedBody;
    }

    // Include notion_preview_url if available
    if (customFields.notion_preview_url) {
      customData['notion_preview_url'] = customFields.notion_preview_url;
    }

    // ========== Upsert lead record ==========
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('email', contact.email)
      .maybeSingle();

    let leadId: string;

    if (existingLead) {
      leadId = existingLead.id;
      await supabase
        .from('leads')
        .update({
          first_name: contact.firstName || undefined,
          last_name: contact.lastName || undefined,
          company: contact.company || undefined,
          job_title: contact.jobTitle || undefined,
          linkedin_url: contact.linkedinUrl || undefined,
          source: 'crm_contact',
          source_id: contact.id,
        })
        .eq('id', leadId);
    } else {
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert({
          organization_id: organizationId,
          email: contact.email,
          first_name: contact.firstName || null,
          last_name: contact.lastName || null,
          company: contact.company || null,
          job_title: contact.jobTitle || null,
          linkedin_url: contact.linkedinUrl || null,
          source: 'crm_contact',
          source_id: contact.id,
        })
        .select('id')
        .single();

      if (leadError || !newLead) {
        throw new Error(`Failed to create lead: ${leadError?.message || 'Unknown error'}`);
      }
      leadId = newLead.id;
    }

    // ========== Enroll lead with per-lead custom_data (atomic cycle increment) ==========
    // Uses database function to atomically increment cycle_number, preventing race conditions
    const { data: enrollmentResult, error: enrollError } = await supabase
      .rpc('upsert_enrollment_with_cycle', {
        p_sequence_id: sequenceId,
        p_lead_id: leadId,
        p_organization_id: organizationId,
        p_custom_data: customData,
        p_next_send_at: calculateInitialSendTime(seqSettings).toISOString(),
      })
      .single();

    if (enrollError || !enrollmentResult) {
      throw new Error(`Failed to enroll lead: ${enrollError?.message || 'Unknown error'}`);
    }

    const enrollment = { id: enrollmentResult.enrollment_id };
    const isReEnrollment = enrollmentResult.is_reenrollment;

    if (isReEnrollment) {
      console.log(`[push-to-zapmail] Re-enrolling ${contact.email} (new cycle: ${enrollmentResult.cycle_number})`);
    }

    // Update CRM contact outreach status to 'reached'
    await supabase
      .from('crm_contacts')
      .update({ outreach_status: 'reached' })
      .eq('id', contact.id)
      .eq('outreach_status', 'unreached');

    // Record the handoff
    const { error: handoffError } = await supabase.from('lead_handoffs').insert({
      campaign_id: internalCampaignId || null,
      progress_id: progressId || null,
      contact_id: contact.id,
      organization_id: organizationId,
      tool_type: 'zapmail',
      connection_id: null,
      external_campaign_id: null,
      email_subject: personalizedSubject,
      email_body: personalizedBody,
      push_mode: 'with_sequences',
      status: 'sent',
      external_lead_id: enrollment.id,
      pushed_at: new Date().toISOString(),
    });

    if (handoffError) {
      console.error('Failed to record handoff:', handoffError);
    }

    console.log(`[push-to-zapmail] Enrolled lead ${contact.email} in sequence ${sequenceId}, enrollment ${enrollment.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        sequenceId,
        enrollmentId: enrollment.id,
        leadId,
        stepsCount,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Push to ZapMail error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
