import { entryTriggerMatches, safeEntryContext, type CampaignEntryEvent, type CampaignEntryTrigger } from './campaign-entry-rules.ts';
export { CAMPAIGN_ENTRY_TYPES } from './campaign-entry-rules.ts';
export type { CampaignEntryEvent, CampaignEntryTrigger, CampaignEntryType } from './campaign-entry-rules.ts';

// Supabase's generated types lag migrations in edge functions. Keep this boundary compatible with existing callers.
// deno-lint-ignore no-explicit-any
export async function enqueueCampaignEntryEvent(supabase: any, event: CampaignEntryEvent): Promise<{ queued: number; duplicate: number; eventIds: string[] }> {
  if (!event.organizationId || !event.contactId || !event.eventId?.trim()) throw new Error('Organization, contact, and stable event ID are required');
  const { data: contact, error: contactError } = await supabase.from('crm_contacts').select('id').eq('id', event.contactId).eq('organization_id', event.organizationId).maybeSingle();
  if (contactError) throw new Error(contactError.message);
  if (!contact) throw new Error('Contact does not belong to this organization');
  if (event.accountId) {
    const { data: account, error } = await supabase.from('unipile_accounts').select('id').eq('id', event.accountId).eq('organization_id', event.organizationId).maybeSingle();
    if (error || !account) throw new Error('Account does not belong to this organization');
  }
  let query = supabase.from('linkedin_campaigns').select('id, started_at, entry_triggers').eq('organization_id', event.organizationId).eq('status', 'active');
  if (event.campaignId) query = query.eq('id', event.campaignId);
  const { data: campaigns, error } = await query;
  if (error) throw new Error(error.message);
  const result = { queued: 0, duplicate: 0, eventIds: [] as string[] };
  for (const campaign of campaigns || []) {
    for (const trigger of (Array.isArray(campaign.entry_triggers) ? campaign.entry_triggers : []) as CampaignEntryTrigger[]) {
      if (!entryTriggerMatches(trigger, event)) continue;
      if (event.type === 'post_comment' && event.context?.native === true) {
        const occurredAt = Date.parse(String(event.context.occurredAt || ''));
        const baseline = Math.max(Date.parse(campaign.started_at || '1970-01-01'), Date.parse(trigger.createdAt || campaign.started_at || '1970-01-01'));
        if (!Number.isFinite(occurredAt) || !Number.isFinite(baseline) || occurredAt < baseline) continue;
      }
      const { data, error: insertError } = await supabase.from('campaign_trigger_events').insert({
        organization_id: event.organizationId, campaign_id: campaign.id, trigger_id: trigger.id, trigger_snapshot: trigger,
        source_event_id: event.eventId.slice(0, 512), event_type: event.type, contact_id: event.contactId,
        account_id: event.accountId || null, channel: event.channel || null,
        context: { ...safeEntryContext(event.context), text: (event.text || '').slice(0, 10000), postId: event.postId || null, signalType: event.signalType || null, eventName: event.eventName || null },
      }).select('id').single();
      if (insertError?.code === '23505') { result.duplicate++; continue; }
      if (insertError) throw new Error(insertError.message);
      result.queued++; result.eventIds.push(data.id);
    }
  }
  return result;
}
