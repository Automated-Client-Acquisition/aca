import { createUnipileClientFromAccount, parseUnipileError } from './unipile-client.ts';
import { enqueueCampaignEntryEvent } from './campaign-entry-events.ts';
import { entryTriggerProblem, normalizeEntryPostId, type CampaignEntryTrigger } from './campaign-entry-rules.ts';

export interface EntryAccount {
  id: string;
  organization_id: string;
  unipile_account_id: string;
  provider: string;
  status: string;
  access_token_encrypted: string;
  dsn_url: string;
}

export async function entryAccountClient(account: EntryAccount) {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) throw new Error('Account encryption is unavailable');
  return await createUnipileClientFromAccount({ accessTokenEncrypted: account.access_token_encrypted, dsnUrl: account.dsn_url }, encryptionKey);
}

// deno-lint-ignore no-explicit-any
async function incomingContact(supabase: any, account: EntryAccount, person: { id: string; name: string; profileUrl?: string; headline?: string; avatar?: string }) {
  const { data, error } = await supabase.rpc('resolve_campaign_entry_contact', {
    p_org: account.organization_id, p_account: account.id, p_platform_id: person.id, p_name: person.name,
    p_profile_url: person.profileUrl || null, p_job_title: person.headline || null, p_avatar: person.avatar || null,
  });
  if (error || !data) throw new Error(error?.message || 'Incoming contact resolution failed');
  return data as string;
}

interface NativeSource { accountId: string; organizationId: string; key: string; postId?: string; startedAt: string }
interface SourceCursor { account_id: string; source_key: string; cursor: string | null; started_at: string; checked_at: string | null }

/** Bounded polling fills capabilities without native webhooks. Broader keyword search remains in n8n/GHL. */
// deno-lint-ignore no-explicit-any
export async function pollCampaignEntrySources(supabase: any): Promise<{ checked: number; queued: number; errors: string[] }> {
  const result = { checked: 0, queued: 0, errors: [] as string[] };
  const { data: campaigns, error } = await supabase.from('linkedin_campaigns').select('organization_id, started_at, sender_account_ids, sender_accounts, entry_triggers').eq('status', 'active');
  if (error) throw new Error(error.message);
  if (!campaigns?.length) return result;
  const { data: ownedAccounts, error: ownershipError } = await supabase.from('unipile_accounts').select('id,organization_id').in('organization_id', [...new Set(campaigns.map((campaign: { organization_id: string }) => campaign.organization_id))]).eq('provider', 'LINKEDIN').eq('status', 'active');
  if (ownershipError) throw new Error(ownershipError.message);
  const accountOwners = new Map<string, string>((ownedAccounts || []).map((account: { id: string; organization_id: string }) => [account.id, account.organization_id]));
  const sources = new Map<string, NativeSource>();
  for (const campaign of campaigns || []) {
    for (const rule of (Array.isArray(campaign.entry_triggers) ? campaign.entry_triggers : []) as CampaignEntryTrigger[]) {
      if (!rule.enabled || entryTriggerProblem(rule)) continue;
      const baseline = Math.max(Date.parse(campaign.started_at || '1970-01-01'), Date.parse(rule.createdAt || campaign.started_at || '1970-01-01'));
      if (!Number.isFinite(baseline)) continue;
      const startedAt = new Date(baseline).toISOString();
      const putSource = (key: string, source: NativeSource) => {
        const previous = sources.get(key);
        if (!previous || Date.parse(source.startedAt) < Date.parse(previous.startedAt)) sources.set(key, source);
      };
      const senderIds = [...new Set<string>([...(campaign.sender_account_ids || []), ...(campaign.sender_accounts?.linkedin || [])])];
      const accounts = rule.accountIds.filter(id => senderIds.includes(id) && accountOwners.get(id) === campaign.organization_id);
      for (const accountId of accounts) {
        if (rule.type === 'connection_request') putSource(`${accountId}:invites`, { accountId, organizationId: campaign.organization_id, key: 'invites', startedAt });
        if (rule.type === 'post_comment' || (rule.type === 'keyword_match' && rule.keywordSource === 'comments')) {
          for (const value of (rule.postIds || []).slice(0, 20)) {
            const postId = normalizeEntryPostId(value);
            putSource(`${accountId}:comments:${postId}`, { accountId, organizationId: campaign.organization_id, key: `comments:${postId}`, postId, startedAt });
          }
        }
      }
    }
  }
  if (!sources.size) return result;
  const { data: cursors, error: cursorError } = await supabase.from('campaign_trigger_source_cursors').select('account_id,source_key,cursor,started_at,checked_at').in('account_id', [...new Set([...sources.values()].map(s => s.accountId))]);
  if (cursorError) throw new Error(cursorError.message);
  const bySource = new Map<string, SourceCursor>(((cursors || []) as SourceCursor[]).map(row => [`${row.account_id}:${row.source_key}`, row]));
  const jobs = [...sources.entries()].sort(([left], [right]) => Date.parse(bySource.get(left)?.checked_at || '1970-01-01') - Date.parse(bySource.get(right)?.checked_at || '1970-01-01')).slice(0, 12);
  for (const [sourceId, source] of jobs) {
    try {
      const { data: account, error: accountError } = await supabase.from('unipile_accounts').select('id,organization_id,unipile_account_id,provider,status,access_token_encrypted,dsn_url,profile_url').eq('id', source.accountId).eq('organization_id', source.organizationId).eq('provider', 'LINKEDIN').eq('status', 'active').maybeSingle();
      if (accountError || !account) continue;
      const client = await entryAccountClient(account);
      const saved = bySource.get(sourceId);
      const startedAt = saved?.started_at || source.startedAt;
      let response: { items?: Record<string, unknown>[]; cursor?: string | null };
      if (!source.postId) {
        response = await client.request.send({ method: 'GET', path: ['users', 'invite', 'received'], parameters: { account_id: account.unipile_account_id, limit: '50', ...(saved?.cursor ? { cursor: saved.cursor } : {}) } });
        for (const invitation of response.items || []) {
          const inviter = invitation.inviter as Record<string, unknown> | undefined;
          const platformId = String(inviter?.inviter_id || '');
          const invitationId = String(invitation.id || '');
          if (!platformId || !invitationId) continue;
          const publicId = String(inviter?.inviter_public_identifier || '');
          const contactId = await incomingContact(supabase, account, { id: platformId, name: String(inviter?.inviter_name || platformId), profileUrl: publicId ? `https://www.linkedin.com/in/${publicId}` : undefined, headline: String(inviter?.inviter_description || '') });
          const queued = await enqueueCampaignEntryEvent(supabase, { organizationId: account.organization_id, accountId: account.id, type: 'connection_request', eventId: `invite:${account.id}:${invitationId}`, contactId, channel: 'linkedin', text: String(invitation.invitation_text || ''), context: { native: true, invitationId, platformUserId: platformId } });
          result.queued += queued.queued;
        }
      } else {
        // The social_id returned by Get Post is required by the comments endpoint; URL activity IDs can differ.
        const post = await client.users.getPost({ account_id: account.unipile_account_id, post_id: source.postId });
        const providerPostId = String((post as Record<string, unknown>).social_id || (post as Record<string, unknown>).id || source.postId);
        response = await client.request.send({ method: 'GET', path: ['posts', encodeURIComponent(providerPostId), 'comments'], parameters: { account_id: account.unipile_account_id, limit: '50', sort_by: 'MOST_RECENT', ...(saved?.cursor ? { cursor: saved.cursor } : {}) } });
        for (const comment of response.items || []) {
          const author = comment.author_details as Record<string, unknown> | undefined;
          const commentDate = Date.parse(String(comment.date || ''));
          // The rule activation time is the baseline, including comments before the first poll.
          if (!Number.isFinite(commentDate) || commentDate < Date.parse(startedAt) || !author?.id || !comment.id) continue;
          const profileUrl = typeof author.profile_url === 'string' ? author.profile_url : undefined;
          if (profileUrl && profileUrl.replace(/\/$/, '') === String(account.profile_url || '').replace(/\/$/, '')) continue;
          const contactId = await incomingContact(supabase, account, { id: String(author.id), name: String(comment.author || author.id), profileUrl, headline: String(author.headline || ''), avatar: String(author.profile_picture_url || '') });
          const queued = await enqueueCampaignEntryEvent(supabase, { organizationId: account.organization_id, accountId: account.id, type: 'post_comment', eventId: `comment:${source.postId}:${comment.id}`, contactId, channel: 'linkedin', text: String(comment.text || ''), postId: source.postId, context: { native: true, platformUserId: String(author.id), commentId: String(comment.id), occurredAt: String(comment.date) } });
          result.queued += queued.queued;
        }
      }
      const { error: saveError } = await supabase.from('campaign_trigger_source_cursors').upsert({ account_id: account.id, source_key: source.key, cursor: response.cursor || null, started_at: startedAt, checked_at: new Date().toISOString() });
      if (saveError) throw new Error(saveError.message);
      result.checked++;
    } catch (error) {
      const parsed = parseUnipileError(error);
      result.errors.push(`${source.key}: ${parsed.code}`);
      // Failure participates in fair rotation too, so a disconnected first account cannot starve others.
      const saved = bySource.get(sourceId);
      await supabase.from('campaign_trigger_source_cursors').upsert({ account_id: source.accountId, source_key: source.key, cursor: saved?.cursor || null, started_at: saved?.started_at || source.startedAt, checked_at: new Date().toISOString() });
    }
  }
  return result;
}
