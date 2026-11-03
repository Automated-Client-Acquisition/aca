/**
 * REST resource: /v1/conversations
 *
 *   GET /v1/conversations              list conversations
 *   GET /v1/conversations/{id}         fetch one, with its most recent messages
 *   GET /v1/conversations/{id}/messages full message history, keyset-paginated
 *
 * Writes go through POST /v1/messages, which derives channel, sender account and
 * recipient from the conversation so a reply always leaves the inbox the thread
 * already lives in.
 */

import {
  ApiError,
  createResource,
  json,
  parseLimit,
  decodeCursor,
  paginated,
  requireUuid,
} from '../_shared/rest-api.ts';

const CONVERSATION_COLUMNS = [
  'id',
  'contact_id',
  'channel',
  'status',
  'mailbox_id',
  'assigned_to_user_id',
  'ai_enabled',
  'ai_paused_until',
  'message_count',
  'unread_count',
  'has_inbound_message',
  'has_outbound_message',
  'last_message_at',
  'last_message_preview',
  'last_message_direction',
  'last_message_subject',
  'lead_intent',
  'priority_score',
  'is_system',
  'created_at',
  'updated_at',
].join(', ');

/**
 * `content_tsv` (a tsvector), `email_headers` and the AI token counters are
 * omitted — internal machinery no caller needs, and the tsvector is large.
 */
const MESSAGE_COLUMNS = [
  'id',
  'conversation_id',
  'contact_id',
  'direction',
  'sender_type',
  'content',
  'content_type',
  'email_subject',
  'email_from',
  'email_to',
  'attachments',
  'status',
  'ai_generated',
  'delivered_at',
  'read_at',
  'clicked_at',
  'created_at',
].join(', ');

/** How many recent messages ride along with a single-conversation read. */
const INLINE_MESSAGE_COUNT = 20;

async function assertConversationInOrg(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  conversationId: string,
  organizationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('crm_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ApiError('Conversation not found', 404);
}

Deno.serve(createResource({
  GET: async ({ url, supabase, caller }) => {
    const limit = parseLimit(url);
    const cursor = decodeCursor(url);
    const id = url.searchParams.get('id');

    /* ── Full message history for one conversation ─────────────── */
    if (id && url.searchParams.get('resource') === 'messages') {
      const conversationId = requireUuid(id, 'id');
      await assertConversationInOrg(supabase, conversationId, caller.organization_id);

      let query = supabase
        .from('crm_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .order('id', { ascending: true })
        .limit(limit + 1);

      if (cursor) query = query.gt('id', cursor);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return json({ success: true, ...paginated(data || [], limit, 'id') });
    }

    /* ── One conversation, with recent messages inline ─────────── */
    if (id) {
      const conversationId = requireUuid(id, 'id');
      const { data, error } = await supabase
        .from('crm_conversations')
        .select(CONVERSATION_COLUMNS)
        .eq('organization_id', caller.organization_id)
        .eq('id', conversationId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new ApiError('Conversation not found', 404);

      // Newest-first here, because "the last 20 messages" is what a caller
      // handling a reply actually wants. Use the messages route for full history.
      const { data: messages, error: msgError } = await supabase
        .from('crm_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(INLINE_MESSAGE_COUNT);

      if (msgError) throw new Error(msgError.message);

      return json({
        success: true,
        data: { ...data, messages: (messages || []).reverse() },
      });
    }

    /* ── List ──────────────────────────────────────────────────── */
    let query = supabase
      .from('crm_conversations')
      .select(CONVERSATION_COLUMNS)
      .eq('organization_id', caller.organization_id)
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (cursor) query = query.gt('id', cursor);

    const channel = url.searchParams.get('channel');
    if (channel) query = query.eq('channel', channel);

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);

    const contactId = url.searchParams.get('contact_id');
    if (contactId) query = query.eq('contact_id', requireUuid(contactId, 'contact_id'));

    // The single most useful filter here: conversations where somebody replied.
    const hasInbound = url.searchParams.get('has_inbound_message');
    if (hasInbound === 'true') query = query.eq('has_inbound_message', true);
    if (hasInbound === 'false') query = query.eq('has_inbound_message', false);

    // System threads are bookkeeping (bounce notices and the like), not people.
    if (url.searchParams.get('include_system') !== 'true') {
      query = query.eq('is_system', false);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return json({ success: true, ...paginated(data || [], limit, 'id') });
  },
}));
