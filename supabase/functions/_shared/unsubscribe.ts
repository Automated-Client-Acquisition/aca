/**
 * The unsubscribe cascade, shared by the unsubscribe link (email-unsubscribe) and
 * provider complaint/unsubscribe events: stop the lead's enrollments in the org,
 * suppress the CRM contact, and stamp the send log.
 *
 * The contact is found by the lead's CRM link first (leads.source_id when
 * source = 'crm_contact'), then by email case-insensitively through the
 * crm_contact_ids_by_email RPC (an exact match missed case variants; an .ilike
 * timed out on large orgs).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export interface UnsubscribeTarget {
  organizationId: string;
  leadId: string;
  enrollmentId?: string | null;
  sendLogId?: string | null;
  /** 'do_not_contact' for spam complaints; defaults to 'unsubscribed'. */
  contactStatus?: 'unsubscribed' | 'do_not_contact';
}

export async function applyUnsubscribe(supabase: SupabaseClient, target: UnsubscribeTarget): Promise<void> {
  const now = new Date().toISOString();
  const contactStatus = target.contactStatus ?? 'unsubscribed';

  // 1. The specific enrollment (only if still active — idempotent).
  if (target.enrollmentId) {
    await supabase
      .from('email_sequence_enrollments')
      .update({ status: 'unsubscribed', updated_at: now })
      .eq('id', target.enrollmentId)
      .in('status', ['active', 'paused']);
  }

  // 2. Every other active enrollment for this lead in the org. Enrollments carry
  //    no org id, so scope through the org's sequences.
  const { data: orgSequences } = await supabase
    .from('email_sequences')
    .select('id')
    .eq('organization_id', target.organizationId);

  if (orgSequences && orgSequences.length > 0) {
    await supabase
      .from('email_sequence_enrollments')
      .update({ status: 'unsubscribed', updated_at: now })
      .eq('lead_id', target.leadId)
      .in('sequence_id', orgSequences.map((s) => s.id))
      .in('status', ['active', 'paused']);
  }

  // 3. The CRM contact. Never downgrade do_not_contact to unsubscribed.
  const { data: lead } = await supabase
    .from('leads')
    .select('email, source, source_id')
    .eq('id', target.leadId)
    .maybeSingle();

  const contactUpdate = (query: any) => {
    const q = query.update({ status: contactStatus, updated_at: now }).eq('organization_id', target.organizationId);
    return contactStatus === 'unsubscribed' ? q.neq('status', 'do_not_contact') : q;
  };

  if (lead?.source === 'crm_contact' && lead.source_id) {
    await contactUpdate(supabase.from('crm_contacts')).eq('id', lead.source_id);
  }
  if (lead?.email) {
    // Indexed case-insensitive lookup; an .ilike here scans the whole org and
    // times out on orgs with millions of contacts, leaving the contact active.
    const { data: matches, error } = await supabase.rpc('crm_contact_ids_by_email', {
      p_organization_id: target.organizationId,
      p_email: lead.email,
    });
    if (error) throw new Error(`Contact lookup for unsubscribe failed: ${error.message}`);
    const ids = ((matches ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (ids.length > 0) await contactUpdate(supabase.from('crm_contacts')).in('id', ids);
  }

  // 4. Record the unsubscribe on the send log (keep its delivery status intact).
  if (target.sendLogId) {
    await supabase
      .from('email_send_log')
      .update({ unsubscribed_at: now })
      .eq('id', target.sendLogId)
      .eq('organization_id', target.organizationId);
  }
}
