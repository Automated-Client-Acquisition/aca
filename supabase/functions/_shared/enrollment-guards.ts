/**
 * Enrollment admission guards, shared by every path that can create an email
 * sequence enrollment.
 *
 * There are two independent implementations of "enroll these leads":
 *   * supabase/functions/enroll-leads   (UI / CLI / bulk list enrollment)
 *   * supabase/functions/mcp enrollLeads (agents, MCP clients)
 * They resolve contacts to leads separately and both upsert into
 * email_sequence_enrollments. A guard added to one is not a guarantee — it is a
 * guarantee with a hole in it. This module is the single place the admission
 * rules live so both callers enforce the same thing.
 *
 * (The same duplication already bit this codebase in the rotation twins and the
 * reply engines; a rule that exists in one copy is a rule that will drift.)
 */

import { selectInChunks } from './chunked-query.ts';

/** Contact states that must never receive outreach. Mirrors the send-time guard. */
export const SUPPRESSED_CONTACT_STATUSES = new Set([
  'unsubscribed',
  'do_not_contact',
  'bounced',
]);

/**
 * Sequences in this organization that can actually send.
 *
 * The sender only ever picks up enrollments whose SEQUENCE is `active`
 * (email-sequence-processor gates on `email_sequences.status = 'active'` and
 * re-checks it before every send), so an enrollment row in a paused or draft
 * sequence is dormant: it holds the lead's slot without ever mailing it.
 */
export async function findLiveSequenceIds(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('email_sequences')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  if (error) throw new Error(`Failed to resolve live sequences: ${error.message}`);
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((row: { id: string }) => row.id);
}

/**
 * Leads already being worked by a DIFFERENT sequence.
 *
 * The category default (Smartlead / Instantly / HeyReach) is one active campaign
 * per lead: a second concurrent sequence means two unrelated cold threads from
 * two different mailboxes, and nothing downstream reconciles them — a bounce
 * stops only its own sequence, so the duplicate is invisible until the prospect
 * notices.
 *
 * "Being worked" means the other sequence is LIVE (see findLiveSequenceIds).
 * An active enrollment parked in a paused/draft sequence sends nothing, so
 * counting it as busy is a false conflict that makes the lead unenrollable
 * everywhere: on 2026-09-29 a 964-lead audience sat in a paused sequence and
 * every attempt to enroll it into a new one was skipped, with the operator
 * told only "already active in another sequence". Paused holders are the
 * caller's business (the builder's Move path stops them explicitly).
 *
 * Served by idx_enrollments_lead_active (lead_id, status) WHERE status='active'.
 */
export async function findLeadsActiveInOtherSequences(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
  leadIds: string[],
  sequenceId: string,
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();

  const liveSequenceIds = await findLiveSequenceIds(supabase, organizationId);
  if (liveSequenceIds.length === 0) return new Set();

  const rows = await selectInChunks<{ lead_id: string }>(
    supabase,
    'email_sequence_enrollments',
    'lead_id',
    'lead_id',
    leadIds,
    // deno-lint-ignore no-explicit-any
    (q: any) => q
      .eq('status', 'active')
      .neq('sequence_id', sequenceId)
      .in('sequence_id', liveSequenceIds),
  );

  return new Set(rows.map((r) => r.lead_id));
}

/**
 * Leads whose underlying CRM contact is suppressed.
 *
 * Resolves lead -> contact two ways because `leads` rows arrive from several
 * sources: the `source='crm_contact'` mirror carries `source_id`, everything
 * else only matches on address. Address matching uses lower(email) to hit
 * idx_crm_contacts_org_lower_email.
 *
 * The send path re-checks this immediately before every send, so this is about
 * not creating dead rows (and not silently "enrolling" someone who will never be
 * mailed) rather than about PECR compliance, which the send-time guard owns.
 */
export async function findSuppressedLeadIds(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
  leadIds: string[],
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();

  const leads = await selectInChunks<{ id: string; email: string | null; source: string | null; source_id: string | null }>(
    supabase,
    'leads',
    'id, email, source, source_id',
    'id',
    leadIds,
    // deno-lint-ignore no-explicit-any
    (q: any) => q.eq('organization_id', organizationId),
  );

  if (leads.length === 0) return new Set();

  const suppressed = new Set<string>();

  // Path A: direct mirror link.
  const mirrorIds = leads
    .filter((l) => l.source === 'crm_contact' && l.source_id)
    .map((l) => l.source_id as string);

  if (mirrorIds.length > 0) {
    const contacts = await selectInChunks<{ id: string; status: string | null }>(
      supabase, 'crm_contacts', 'id, status', 'id', mirrorIds,
      // deno-lint-ignore no-explicit-any
      (q: any) => q.eq('organization_id', organizationId),
    );
    const badContactIds = new Set(
      contacts.filter((c) => SUPPRESSED_CONTACT_STATUSES.has(c.status ?? '')).map((c) => c.id),
    );
    for (const l of leads) {
      if (l.source_id && badContactIds.has(l.source_id)) suppressed.add(l.id);
    }
  }

  // Path B: address match for leads with no mirror link.
  const emails = [...new Set(
    leads.filter((l) => !suppressed.has(l.id) && l.email).map((l) => (l.email as string).toLowerCase()),
  )];

  if (emails.length > 0) {
    const contacts = await selectInChunks<{ primary_email: string | null; status: string | null }>(
      supabase, 'crm_contacts', 'primary_email, status', 'primary_email', emails,
      // deno-lint-ignore no-explicit-any
      (q: any) => q.eq('organization_id', organizationId),
    );
    const badEmails = new Set(
      contacts
        .filter((c) => SUPPRESSED_CONTACT_STATUSES.has(c.status ?? ''))
        .map((c) => (c.primary_email ?? '').toLowerCase()),
    );
    for (const l of leads) {
      if (l.email && badEmails.has(l.email.toLowerCase())) suppressed.add(l.id);
    }
  }

  return suppressed;
}
