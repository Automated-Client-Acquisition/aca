import { entryQualificationDecision, entryTriggerProblem, scopedEntryScore, type CampaignEntryTrigger } from './campaign-entry-rules.ts';
import { entryAccountClient, type EntryAccount } from './campaign-entry-sources.ts';
import { parseUnipileError } from './unipile-client.ts';

export interface QueuedCampaignEntry {
  id: string;
  organization_id: string;
  campaign_id: string;
  trigger_id: string;
  trigger_snapshot: CampaignEntryTrigger;
  source_event_id: string;
  event_type: string;
  contact_id: string;
  account_id: string | null;
  channel: string | null;
  context: Record<string, unknown>;
  status: string;
  decision_state: string | null;
  provider_decision: 'accept' | 'decline' | null;
  reviewed_by: string | null;
  icp_score?: number | null;
}

// deno-lint-ignore no-explicit-any
async function finish(supabase: any, event: QueuedCampaignEntry, status: string, reason: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase.from('campaign_trigger_events').update({ status, reason, processed_at: new Date().toISOString(), lease_until: null, ...extra }).eq('id', event.id).eq('status', 'processing');
  if (error) throw new Error(error.message);
  return { id: event.id, status, reason };
}

// deno-lint-ignore no-explicit-any
async function accountForEvent(supabase: any, event: QueuedCampaignEntry): Promise<EntryAccount | null> {
  if (!event.account_id) return null;
  const { data, error } = await supabase.from('unipile_accounts').select('id,organization_id,unipile_account_id,provider,status,access_token_encrypted,dsn_url').eq('id', event.account_id).eq('organization_id', event.organization_id).eq('status', 'active').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// deno-lint-ignore no-explicit-any
async function qualifiedScore(supabase: any, event: QueuedCampaignEntry, account: EntryAccount | null): Promise<number | null> {
  const productId = event.trigger_snapshot.qualification?.productId;
  if (!productId) return null;
  const { data: product, error: productError } = await supabase.from('library_products').select('id').eq('id', productId).eq('organization_id', event.organization_id).maybeSingle();
  if (productError || !product) return null;
  const read = async () => {
    const { data, error } = await supabase.from('contact_product_scores').select('icp_score,product_id,analyzed_at').eq('contact_id', event.contact_id).eq('product_id', productId).eq('organization_id', event.organization_id).maybeSingle();
    if (error) throw new Error(error.message);
    return scopedEntryScore(data, productId);
  };
  const cached = await read();
  if (cached !== null) return cached;
  const { data: contact, error: contactError } = await supabase.from('crm_contacts').select('company_website,primary_linkedin_url,linkedin_url').eq('id', event.contact_id).eq('organization_id', event.organization_id).single();
  if (contactError) throw new Error(contactError.message);
  // Reuse the product-scoped scorer and company crawler, never a second scoring implementation.
  const { error } = await supabase.functions.invoke('analyze-company', { body: {
    contactId: event.contact_id, companyWebsite: contact.company_website || undefined,
    linkedinUrl: contact.primary_linkedin_url || contact.linkedin_url || undefined,
    unipileAccountId: account?.unipile_account_id, productId, skipIfAnalyzedWithinDays: 30,
  } });
  if (error) return null;
  return await read();
}

interface ProviderInvitation { id: string; inviter?: { inviter_id?: string }; specifics?: { shared_secret?: string; provider?: string } }

/** Refresh the secret from the provider immediately before the decision; never trust an external event's payload. */
async function currentInvitation(account: EntryAccount, event: QueuedCampaignEntry) {
  if (event.context.native !== true || typeof event.context.invitationId !== 'string' || typeof event.context.platformUserId !== 'string') return null;
  const client = await entryAccountClient(account);
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const response: { items?: ProviderInvitation[]; cursor?: string | null } = await client.request.send({ method: 'GET', path: ['users', 'invite', 'received'], parameters: { account_id: account.unipile_account_id, limit: '100', ...(cursor ? { cursor } : {}) } });
    const invitation = (response.items || []).find(item => item.id === event.context.invitationId && item.inviter?.inviter_id === event.context.platformUserId);
    if (invitation?.specifics?.provider === 'LINKEDIN' && invitation.specifics.shared_secret) return { client, invitation };
    cursor = response.cursor || null;
    if (!cursor) break;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function decideInvitation(supabase: any, event: QueuedCampaignEntry, account: EntryAccount, action: 'accept' | 'decline'): Promise<'completed' | 'review'> {
  if (event.provider_decision === action) return 'completed';
  const invitationId = String(event.context.invitationId || '');
  if (!invitationId) return 'review';
  const { data: previous, error: previousError } = await supabase.from('campaign_trigger_invite_decisions').select('action,state,event_id').eq('account_id', account.id).eq('invitation_id', invitationId).maybeSingle();
  if (previousError) throw new Error(previousError.message);
  if (previous) {
    if (previous.state === 'completed' && previous.action === action) {
      const { error } = await supabase.from('campaign_trigger_events').update({ provider_decision: action, decision_state: 'provider_completed' }).eq('id', event.id);
      if (error) throw new Error(error.message);
      event.provider_decision = action;
      return 'completed';
    }
    const { error } = await supabase.from('campaign_trigger_events').update({ decision_state: 'provider_unknown' }).eq('id', event.id);
    if (error) throw new Error(error.message);
    return 'review';
  }
  const fresh = await currentInvitation(account, event);
  if (!fresh) return 'review';
  const { error: reserveError } = await supabase.from('campaign_trigger_invite_decisions').insert({ organization_id: event.organization_id, account_id: account.id, invitation_id: invitationId, event_id: event.id, action, state: 'attempting' });
  if (reserveError?.code === '23505') return 'review';
  if (reserveError) throw new Error(reserveError.message);
  try {
    // Last admission check is after provider reads, immediately before the irreversible action.
    const { data: admission, error: guardError } = await supabase.rpc('admit_campaign_trigger_event', { p_event_id: event.id, p_enroll: false });
    if (guardError || !admission?.allowed) {
      await supabase.from('campaign_trigger_invite_decisions').delete().eq('account_id', account.id).eq('invitation_id', invitationId).eq('event_id', event.id).eq('state', 'attempting');
      return 'review';
    }
    const response = await fresh.client.request.send<{ status?: string }>({ method: 'POST', path: ['users', 'invite', 'received', encodeURIComponent(invitationId)], headers: { 'Content-Type': 'application/json' }, body: { provider: 'LINKEDIN', shared_secret: fresh.invitation.specifics!.shared_secret!, account_id: account.unipile_account_id, action } });
    if (response.status !== (action === 'accept' ? 'ACCEPTED' : 'DECLINED')) throw new Error('Provider did not confirm the invitation decision');
    const { error: ledgerError } = await supabase.from('campaign_trigger_invite_decisions').update({ state: 'completed', updated_at: new Date().toISOString() }).eq('account_id', account.id).eq('invitation_id', invitationId).eq('event_id', event.id);
    if (ledgerError) throw new Error(ledgerError.message);
    const { error: eventError } = await supabase.from('campaign_trigger_events').update({ provider_decision: action, decision_state: 'provider_completed' }).eq('id', event.id);
    if (eventError) throw new Error(eventError.message);
    event.provider_decision = action;
    return 'completed';
  } catch (error) {
    const parsed = parseUnipileError(error);
    // Timeouts, throttles, interrupted writes and unknown responses can hide a completed action.
    // Stop here; automatic retry would risk accepting/declining an invitation twice.
    await supabase.from('campaign_trigger_invite_decisions').update({ state: 'unknown', updated_at: new Date().toISOString() }).eq('account_id', account.id).eq('invitation_id', invitationId).eq('state', 'attempting');
    await supabase.from('campaign_trigger_events').update({ decision_state: 'provider_unknown', reason: `Invitation outcome needs review (${parsed.code})` }).eq('id', event.id);
    return 'review';
  }
}

// deno-lint-ignore no-explicit-any
async function confirmInboundConnection(supabase: any, event: QueuedCampaignEntry, account: EntryAccount | null) {
  if (event.channel !== 'linkedin' || !account || event.context.native !== true) return;
  const { data: identity, error } = await supabase.from('crm_contact_identities').select('platform_user_id').eq('organization_id', event.organization_id).eq('contact_id', event.contact_id).eq('channel', 'linkedin').contains('linked_account_ids', [account.id]).maybeSingle();
  if (error || !identity?.platform_user_id) return;
  const client = await entryAccountClient(account);
  const profile = await client.users.getProfile({ account_id: account.unipile_account_id, identifier: identity.platform_user_id, notify: false });
  const connected = ['FIRST_DEGREE', 'DISTANCE_1'].includes(String((profile as Record<string, unknown>).network_distance));
  event.context = { ...event.context, connected };
  const { error: saveError } = await supabase.from('campaign_trigger_events').update({ context: event.context }).eq('id', event.id);
  if (saveError) throw new Error(saveError.message);
}

// deno-lint-ignore no-explicit-any
export async function processCampaignEntryEvent(supabase: any, event: QueuedCampaignEntry) {
  try {
    const problem = entryTriggerProblem(event.trigger_snapshot);
    if (problem) return await finish(supabase, event, 'review', problem);
    const { data: guard, error: guardError } = await supabase.rpc('admit_campaign_trigger_event', { p_event_id: event.id, p_enroll: false });
    if (guardError) throw new Error(guardError.message);
    if (!guard?.allowed) return await finish(supabase, event, 'ignored', guard?.reason || 'Campaign admission refused');
    const account = await accountForEvent(supabase, event);
    const trigger = event.trigger_snapshot;
    const score = event.reviewed_by
      ? (typeof event.icp_score === 'number' && Number.isFinite(event.icp_score) ? event.icp_score : null)
      : trigger.qualification?.enabled !== false ? await qualifiedScore(supabase, event, account) : null;
    const { error: scoreError } = await supabase.from('campaign_trigger_events').update({ icp_score: score }).eq('id', event.id);
    if (scoreError) throw new Error(scoreError.message);
    const decision = entryQualificationDecision(trigger, score, !!event.reviewed_by);
    if (decision === 'review') return await finish(supabase, event, 'review', 'ICP fit is unverified. Review this person before starting the campaign.');
    if (decision === 'mismatch') {
      if (event.event_type === 'connection_request' && trigger.onMismatch === 'decline') {
        if (!account || await decideInvitation(supabase, event, account, 'decline') !== 'completed') return await finish(supabase, event, 'review', 'Invitation decline could not be confirmed. Check the LinkedIn invitation.');
        return await finish(supabase, event, 'declined', `ICP score ${score} is below ${trigger.qualification.minScore}`);
      }
      return await finish(supabase, event, 'ignored', `ICP score ${score} is below ${trigger.qualification.minScore}`);
    }
    if (trigger.onMatch === 'review' && !event.reviewed_by) return await finish(supabase, event, 'review', 'Qualified. This trigger requires approval before enrollment.');
    if (event.event_type === 'connection_request') {
      if (!account || account.provider !== 'LINKEDIN' || await decideInvitation(supabase, event, account, 'accept') !== 'completed') return await finish(supabase, event, 'review', 'Invitation acceptance could not be confirmed. Check the LinkedIn invitation.');
    } else {
      await confirmInboundConnection(supabase, event, account);
    }
    const { data: admission, error } = await supabase.rpc('admit_campaign_trigger_event', { p_event_id: event.id, p_enroll: true });
    if (error) throw new Error(error.message);
    if (!admission?.allowed) return await finish(supabase, event, 'ignored', admission?.reason || 'Campaign admission refused');
    return { id: event.id, status: 'enrolled', progressId: admission.progress_id };
  } catch (error) {
    console.error('[campaign-entry] Processing failed', event.id, error instanceof Error ? error.message : 'Unknown error');
    return await finish(supabase, event, 'review', 'Processing could not be completed. Check the account and qualification setup before approving another attempt.');
  }
}
