import { ApiError, createResource, json, requireUuid, type Handler } from '../_shared/rest-api.ts';
import { enqueueCampaignEntryEvent, CAMPAIGN_ENTRY_TYPES, type CampaignEntryType } from '../_shared/campaign-entry-events.ts';
import { testCampaignEntryEvent } from '../_shared/campaign-entry-test.ts';

async function canManage(supabase: Parameters<Handler>[0]['supabase'], caller: { organization_id: string; user_id: string; auth_method: string; scopes?: string[] }) {
  if (caller.auth_method === 'api_token' && !(caller.scopes || []).some(scope => ['cli', 'campaigns:write', 'admin:*', '*'].includes(scope))) throw new ApiError('Token requires campaigns:write', 403);
  const { data: member, error } = await supabase.from('organization_members').select('role,permissions').eq('organization_id', caller.organization_id).eq('user_id', caller.user_id).maybeSingle();
  if (error) throw new Error(error.message);
  // Match the app's organization permission model; an explicit member permission can grant campaign writes.
  if (!member || (!['owner', 'admin'].includes(member.role) && !(Array.isArray(member.permissions) && member.permissions.some((p: string) => ['campaigns:write', 'manage_campaigns', 'admin:*', '*'].includes(p))))) throw new ApiError('Campaign management permission is required', 403);
}

Deno.serve(createResource({
  GET: async ({ supabase, caller }) => {
    if (!caller.organization_id) throw new ApiError('Organization-scoped authentication is required', 403);
    await canManage(supabase, caller);
    return json({ success: true, testMode: true });
  },
  POST: async ({ supabase, caller, body }) => {
    if (!caller.organization_id) throw new ApiError('Organization-scoped authentication is required', 403);
    if (body.organizationId && body.organizationId !== caller.organization_id) throw new ApiError('Your active workspace changed. Reload the campaign before continuing.', 403);
    await canManage(supabase, caller);
    if (body.action !== undefined && !['approve', 'ignore', 'test'].includes(body.action as string)) throw new ApiError('Unsupported action');
    if (body.action === 'approve' || body.action === 'ignore') {
      const eventId = requireUuid(body.eventId, 'eventId');
      const { data: event, error } = await supabase.from('campaign_trigger_events').select('id,status,decision_state,campaign_id,account_id,context').eq('id', eventId).eq('organization_id', caller.organization_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!event) throw new ApiError('Event not found', 404);
      if (body.campaignId && body.campaignId !== event.campaign_id) throw new ApiError('Event does not belong to this campaign', 404);
      if (event.status !== 'review') throw new ApiError('Only events awaiting review can be reviewed', 409);
      if (body.action === 'approve' && event.account_id && event.context?.invitationId) {
        const { data: decision, error: decisionError } = await supabase.from('campaign_trigger_invite_decisions').select('state').eq('account_id', event.account_id).eq('invitation_id', event.context.invitationId).maybeSingle();
        if (decisionError) throw new Error(decisionError.message);
        if (decision && decision.state !== 'completed') throw new ApiError('The invitation outcome is uncertain. Check LinkedIn before continuing; this action cannot be retried automatically.', 409);
      }
      const { data: updated, error: updateError } = await supabase.from('campaign_trigger_events').update({
        status: body.action === 'approve' ? 'pending' : 'ignored',
        reason: body.action === 'approve' ? 'Approved by an organization member; waiting for admission checks' : 'Ignored after review',
        reviewed_by: caller.user_id, reviewed_at: new Date().toISOString(), lease_until: null,
        ...(body.action === 'ignore' ? { processed_at: new Date().toISOString() } : {}),
      }).eq('id', eventId).eq('organization_id', caller.organization_id).eq('status', 'review').select('*').maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!updated) throw new ApiError('This event was already reviewed', 409);
      return json({ success: true, event: updated });
    }
    const payload = body.event;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError('event is required');
    const event = payload as Record<string, unknown>;
    if (body.action === 'test') {
      // A transport test must expose mapping mistakes instead of silently dropping malformed fields.
      for (const field of ['name', 'text', 'postId', 'signalType']) {
        if (event[field] !== undefined && typeof event[field] !== 'string') throw new ApiError(`event.${field} must be a string`);
      }
      if (event.accountId !== undefined) requireUuid(event.accountId, 'event.accountId');
      if (event.metadata !== undefined && (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata))) throw new ApiError('event.metadata must be a JSON object');
    }
    if (!CAMPAIGN_ENTRY_TYPES.includes(event.type as CampaignEntryType)) throw new ApiError('Unsupported event type');
    if (event.type === 'connection_request') throw new ApiError('Received invitations are captured directly from LinkedIn. Integrations cannot create invitation decisions.');
    if (event.type === 'list_member_added') throw new ApiError('List additions are captured directly from ACA lead lists. Add the contact to the selected list to trigger campaign entry.');
    if (event.channel != null && (typeof event.channel !== 'string' || !['any', 'linkedin', 'email', 'whatsapp', 'instagram', 'telegram', 'sms'].includes(event.channel))) throw new ApiError('Choose a supported event channel');
    if (typeof event.id !== 'string' || !event.id.trim() || event.id.length > 512) throw new ApiError('A stable event id of 1–512 characters is required');
    const contactId = requireUuid(event.contactId, 'event.contactId');
    const campaignId = body.campaignId ? requireUuid(body.campaignId, 'campaignId') : undefined;
    const accountId = event.accountId ? requireUuid(event.accountId, 'event.accountId') : undefined;
    if (body.action === 'test' && !campaignId) throw new ApiError('Choose a saved campaign before testing.');
    if (body.triggerId != null && (typeof body.triggerId !== 'string' || !body.triggerId.trim() || body.triggerId.length > 512)) throw new ApiError('triggerId must be a valid trigger identifier');
    if (campaignId && body.action !== 'test') {
      const { data: campaign, error } = await supabase.from('linkedin_campaigns').select('id').eq('id', campaignId).eq('organization_id', caller.organization_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!campaign) throw new ApiError('Campaign not found', 404);
    }
    if (typeof event.text === 'string' && event.text.length > 10000) throw new ApiError('Event text exceeds 10,000 characters');
    // Provider authority is always re-fetched server-side. Integration metadata cannot assert native/connected.
    const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {};
    const entryEvent = {
      organizationId: caller.organization_id, campaignId, type: event.type as CampaignEntryType, eventId: event.id,
      contactId, accountId, channel: typeof event.channel === 'string' && event.channel !== 'any' ? event.channel : undefined,
      text: typeof event.text === 'string' ? event.text : undefined, postId: typeof event.postId === 'string' ? event.postId : undefined,
      signalType: typeof event.signalType === 'string' ? event.signalType : undefined, eventName: typeof event.name === 'string' ? event.name : undefined,
      context: { source: 'integration', metadata, native: false },
    };
    if (body.action === 'test') return json(await testCampaignEntryEvent(supabase, entryEvent, caller, body.triggerId as string | undefined));
    const result = await enqueueCampaignEntryEvent(supabase, entryEvent);
    return json({ success: true, ...result }, 202);
  },
}));
