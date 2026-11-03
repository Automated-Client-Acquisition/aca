import { ApiError, type Handler } from './rest-api.ts';
import { entryQualificationDecision, entryTriggerMatches, entryTriggerProblem, safeEntryContext, scopedEntryScore, type CampaignEntryEvent, type CampaignEntryTrigger } from './campaign-entry-rules.ts';

export interface CampaignEntryTestResult {
  triggerId: string;
  name: string;
  matched: boolean;
  qualification: 'match' | 'mismatch' | 'review' | null;
  icpScore: number | null;
  reason: string;
}

/** A receipt proves transport and rule matching, without queueing or running provider/qualification jobs. */
export async function testCampaignEntryEvent(supabase: Parameters<Handler>[0]['supabase'], event: CampaignEntryEvent, caller: { user_id: string; auth_method: string }, triggerId?: string) {
  if (!event.campaignId) throw new ApiError('Choose a saved campaign before testing.');
  const { data: campaign, error: campaignError } = await supabase.from('linkedin_campaigns').select('id,status,entry_triggers').eq('id', event.campaignId).eq('organization_id', event.organizationId).maybeSingle();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) throw new ApiError('Campaign not found', 404);
  const { data: person, error: contactError } = await supabase.from('crm_contacts').select('id,display_name,first_name,last_name').eq('id', event.contactId).eq('organization_id', event.organizationId).maybeSingle();
  if (contactError) throw new Error(contactError.message);
  if (!person) throw new ApiError('Contact does not belong to this organization', 404);
  if (event.accountId) {
    const { data: account, error } = await supabase.from('unipile_accounts').select('id').eq('id', event.accountId).eq('organization_id', event.organizationId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!account) throw new ApiError('Account does not belong to this organization', 404);
  }
  const triggers = (Array.isArray(campaign.entry_triggers) ? campaign.entry_triggers : []) as CampaignEntryTrigger[];
  if (triggerId && !triggers.some(trigger => trigger?.id === triggerId)) throw new ApiError('Save this trigger before testing it.', 404);
  const selected = triggerId ? triggers.filter(trigger => trigger?.id === triggerId) : triggers;
  const scores = new Map<string, number | null>();
  const results: CampaignEntryTestResult[] = [];
  for (const trigger of selected) {
    const problem = entryTriggerProblem(trigger);
    const matched = entryTriggerMatches(trigger, event);
    let qualification: CampaignEntryTestResult['qualification'] = null;
    let score: number | null = null;
    let reason = !trigger.enabled ? 'This trigger is disabled; live events will not match it.'
      : problem || 'The received event does not match this trigger’s event type or filters.';
    if (matched) {
      const productId = trigger.qualification?.productId;
      if (trigger.qualification?.enabled !== false && productId) {
        if (!scores.has(productId)) {
          const { data: product, error: productError } = await supabase.from('library_products').select('id').eq('id', productId).eq('organization_id', event.organizationId).maybeSingle();
          if (productError) throw new Error(productError.message);
          let cached: number | null = null;
          if (product) {
            const { data: row, error } = await supabase.from('contact_product_scores').select('icp_score,product_id,analyzed_at').eq('contact_id', event.contactId).eq('product_id', productId).eq('organization_id', event.organizationId).maybeSingle();
            if (error) throw new Error(error.message);
            cached = scopedEntryScore(row, productId);
          }
          scores.set(productId, cached);
        }
        score = scores.get(productId) ?? null;
      }
      qualification = entryQualificationDecision(trigger, score);
      reason = qualification === 'review' ? 'Payload matches. ICP fit is unverified; this test does not run a new analysis.'
        : qualification === 'mismatch' ? `Payload matches. Cached ICP score ${score} is below ${trigger.qualification.minScore}.`
        : trigger.qualification?.enabled === false ? 'Payload matches. ICP qualification is disabled.'
        : `Payload matches. Cached ICP score ${score} meets ${trigger.qualification.minScore}.`;
    }
    results.push({ triggerId: trigger.id, name: trigger.name, matched, qualification, icpScore: score, reason });
  }
  const received = {
    campaignId: campaign.id,
    event: safeEntryContext({
      id: event.eventId, type: event.type, contactId: event.contactId,
      ...(event.accountId ? { accountId: event.accountId } : {}),
      ...(event.channel ? { channel: event.channel } : {}),
      ...(event.text !== undefined ? { text: event.text } : {}),
      ...(event.postId !== undefined ? { postId: event.postId } : {}),
      ...(event.signalType !== undefined ? { signalType: event.signalType } : {}),
      ...(event.eventName !== undefined ? { name: event.eventName } : {}),
      ...(event.context?.metadata ? { metadata: event.context.metadata } : {}),
    }),
  };
  const contact = { id: person.id, name: person.display_name || [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unnamed contact' };
  const { data: receipt, error: receiptError } = await supabase.from('campaign_trigger_test_receipts').insert({
    organization_id: event.organizationId, campaign_id: campaign.id, trigger_id: triggerId || null,
    received, results, campaign_status: campaign.status, contact,
    created_by: caller.user_id, auth_method: caller.auth_method,
  }).select('id').single();
  if (receiptError) throw new Error(receiptError.message);
  return { success: true, test: true, received, campaignStatus: campaign.status, contact, results, receiptId: receipt.id };
}
