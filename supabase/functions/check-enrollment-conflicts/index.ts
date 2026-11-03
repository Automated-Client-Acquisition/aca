/**
 * Check Enrollment Conflicts
 *
 * Given a list of CRM contact IDs, checks for enrollment conflicts:
 * 1. Active enrollments in ANY sequence (cross-sequence conflicts)
 * 2. Non-active enrollments in the TARGET sequence (same-sequence re-enrollment candidates)
 *
 * Returns tiered conflicts so the UI can show appropriate warnings:
 * - "active" conflicts: contacts currently active in another sequence
 * - "replied" / "bounced" / "unsubscribed" / "completed" / "paused": same-sequence re-enrollment history
 *
 * When targetSequenceId is provided, also returns previous cycle stats
 * (emails sent, opened, replied) from send logs.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { selectInChunks } from '../_shared/chunked-query.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConflictRequest {
  contactIds: string[];
  organizationId: string;
  targetSequenceId?: string;
}

interface PreviousCycleStats {
  emailsSent: number;
  opened: boolean;
  replied: boolean;
  repliedAt?: string;
}

interface EnrollmentConflict {
  contactId: string;
  contactName?: string;
  leadId: string;
  sequenceId: string;
  sequenceName: string;
  status: string;
  previousCycleStats?: PreviousCycleStats;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { contactIds, organizationId, targetSequenceId }: ConflictRequest = await req.json();

    if (!contactIds?.length || !organizationId) {
      return new Response(
        JSON.stringify({ conflicts: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find leads linked to these CRM contacts
    const leads = await selectInChunks(supabase, 'leads', 'id, email, source_id', 'source_id', contactIds,
      (q) => q.eq('organization_id', organizationId));

    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({ conflicts: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const leadIds = leads.map(l => l.id);
    const leadToContact = new Map(leads.map(l => [l.id, l.source_id]));

    // Fetch contact names for richer UI display
    const contactNameMap = new Map<string, string>();
    if (contactIds.length > 0) {
      const contacts = await selectInChunks(supabase, 'crm_contacts', 'id, display_name', 'id', contactIds);
      for (const c of contacts || []) {
        contactNameMap.set(c.id, c.display_name);
      }
    }

    const conflicts: EnrollmentConflict[] = [];

    // ===== 1. Cross-sequence active conflicts =====
    const activeEnrollments = await selectInChunks(supabase, 'email_sequence_enrollments',
      'id, lead_id, sequence_id, status, email_sequences!inner (id, name)',
      'lead_id', leadIds,
      (q) => q.eq('status', 'active'));

    for (const enrollment of (activeEnrollments || []) as any[]) {
      // Skip active enrollments in the target sequence — those will be handled
      // by the re-enrollment flow (upsert resets them)
      if (targetSequenceId && enrollment.sequence_id === targetSequenceId) continue;

      const contactId = leadToContact.get(enrollment.lead_id) || '';
      conflicts.push({
        contactId,
        contactName: contactNameMap.get(contactId),
        leadId: enrollment.lead_id,
        sequenceId: enrollment.sequence_id,
        sequenceName: enrollment.email_sequences?.name || 'Unknown Sequence',
        status: 'active',
      });
    }

    // ===== 2. Same-sequence re-enrollment candidates =====
    if (targetSequenceId) {
      const targetEnrollments = await selectInChunks(supabase, 'email_sequence_enrollments',
        'id, lead_id, sequence_id, status, updated_at, email_sequences!inner (id, name)',
        'lead_id', leadIds,
        (q) => q.eq('sequence_id', targetSequenceId));

      // Collect lead IDs that have previous enrollments in target sequence
      const targetLeadIds: string[] = [];
      const enrollmentByLead = new Map<string, any>();

      for (const enrollment of (targetEnrollments || []) as any[]) {
        targetLeadIds.push(enrollment.lead_id);
        enrollmentByLead.set(enrollment.lead_id, enrollment);
      }

      // Fetch send log stats for these leads in the target sequence (current cycle only)
      let sendLogStats = new Map<string, PreviousCycleStats>();
      if (targetLeadIds.length > 0) {
        const sendLogs = await selectInChunks(supabase, 'email_send_log',
          'lead_id, status, opened_at, replied_at, sent_at',
          'lead_id', targetLeadIds,
          (q) => q.eq('sequence_id', targetSequenceId));

        // Aggregate per lead, filtering by current cycle boundary (enrollment.updated_at)
        const statsMap = new Map<string, { sent: number; opened: boolean; replied: boolean; repliedAt?: string }>();
        for (const log of (sendLogs || []) as any[]) {
          // Only count logs from current enrollment cycle
          const enrollment = enrollmentByLead.get(log.lead_id);
          if (enrollment?.updated_at && log.sent_at && log.sent_at < enrollment.updated_at) {
            continue; // Skip logs from previous cycles
          }
          const existing = statsMap.get(log.lead_id) || { sent: 0, opened: false, replied: false };
          existing.sent++;
          if (log.opened_at) existing.opened = true;
          if (log.replied_at) {
            existing.replied = true;
            existing.repliedAt = log.replied_at;
          }
          statsMap.set(log.lead_id, existing);
        }

        sendLogStats = new Map(
          [...statsMap.entries()].map(([leadId, stats]) => [
            leadId,
            {
              emailsSent: stats.sent,
              opened: stats.opened,
              replied: stats.replied,
              repliedAt: stats.repliedAt,
            },
          ])
        );
      }

      // Build conflicts for same-sequence enrollments
      for (const [leadId, enrollment] of enrollmentByLead) {
        const contactId = leadToContact.get(leadId) || '';
        conflicts.push({
          contactId,
          contactName: contactNameMap.get(contactId),
          leadId,
          sequenceId: enrollment.sequence_id,
          sequenceName: enrollment.email_sequences?.name || 'Unknown Sequence',
          status: enrollment.status,
          previousCycleStats: sendLogStats.get(leadId),
        });
      }
    }

    return new Response(
      JSON.stringify({ conflicts }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Check enrollment conflicts error:', error);
    return new Response(
      JSON.stringify({ conflicts: [], error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
