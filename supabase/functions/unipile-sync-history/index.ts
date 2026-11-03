import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, parseUnipileError, UnipileChat, UnipileMessage, UnipileAttendee, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Unipile Sync History Edge Function
 *
 * Imports existing conversations and messages when a new account is connected.
 * This ensures users don't start with an empty inbox.
 * Uses the official Unipile SDK.
 *
 * Can be triggered:
 * - Automatically after account connection (from unipile-auth-callback)
 * - Manually via API call
 *
 * Parameters:
 * - account_id: UUID of the unipile_accounts record
 * - limit: Max conversations to import (default: 50)
 * - messages_per_conversation: Max messages per conversation (default: 20)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

  const jobId = crypto.randomUUID();
  const startTime = Date.now();

  let conversationsImported = 0;
  let messagesImported = 0;
  let contactsCreated = 0;
  const errors: string[] = [];

  try {
    const body = await req.json();
    const {
      account_id,
      limit = 50,
      messages_per_conversation = 20,
      mode = 'sync',
    } = body;

    if (!account_id) {
      throw new Error('account_id is required');
    }

    console.log(`[Sync History] Starting job ${jobId} for account ${account_id}`);

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ success: false, jobId, error: 'Account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, account.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (account.status !== 'active') {
      throw new Error(`Account is not active: ${account.status}`);
    }

    // Decrypt API key and create SDK client
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const client = new UnipileClient(dsnUrl, apiKey);
    const channelType = account.provider.toLowerCase();

    // ------------------------------------------------------------------
    // ENRICH mode: resolve "Unknown" imported contacts to real names.
    // A prior sync can leave contacts named "Unknown" when the per-chat
    // attendee lookup gets throttled during the burst. This pass resolves
    // each stored LinkedIn member URN directly via GET /api/v1/users/{urn},
    // which is rate-limited and safely re-runnable.
    // ------------------------------------------------------------------
    if (mode === 'enrich_unknown') {
      const enriched = await enrichUnknownContacts(
        supabase, apiKey, dsnUrl, account.unipile_account_id,
        account_id, account.organization_id, limit,
      );
      const duration = Date.now() - startTime;
      return new Response(JSON.stringify({
        success: true, jobId, duration, mode, stats: enriched,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[Sync History] Fetching ${channelType} conversations via SDK...`);

    // Fetch conversations/chats from Unipile using SDK
    let conversations: Record<string, unknown>[] = [];

    try {
      if (channelType === 'email') {
        // For email, get threads/conversations
        const threadsData = await client.request.send({
          path: '/api/v1/emails/threads',
          method: 'GET',
          query: {
            account_id: account.unipile_account_id,
            limit: String(limit),
          },
        }) as { items?: Record<string, unknown>[] };

        conversations = threadsData.items || [];
      } else {
        // For LinkedIn/Instagram, use the SDK's typed messaging method.
        // NOTE: do NOT use client.request.send({ path: '<string>' }) here — the
        // unipile-node-sdk@^1.4 caret resolves to builds where request.send
        // expects `path` as an array of segments and throws "path.map is not a
        // function" on a string. The typed methods are stable across versions.
        const chatsData = await client.messaging.getAllChats({
          account_id: account.unipile_account_id,
          limit,
        }) as { items?: Record<string, unknown>[] };

        conversations = chatsData.items || [];
      }
    } catch (fetchError) {
      const parsedError = parseUnipileError(fetchError);
      throw new Error(`Failed to fetch conversations: ${parsedError.message}`);
    }

    console.log(`[Sync History] Found ${conversations.length} conversations`);

    // Process each conversation
    for (const conv of conversations) {
      try {
        const externalConversationId = conv.id || conv.thread_id;

        // Skip if conversation already exists
        const { data: existingConv } = await supabase
          .from('crm_conversations')
          .select('id')
          .eq('external_conversation_id', externalConversationId)
          .eq('channel_account_id', account_id)
          .single();

        if (existingConv) {
          console.log(`[Sync History] Conversation ${externalConversationId} already exists, skipping`);
          continue;
        }

        // Extract participant info based on channel type
        let participantId: string;
        let participantName: string;
        let participantAvatarUrl: string | null = null;
        let participantProfileUrl: string | null = null;

        if (channelType === 'email') {
          // Email: use the other participant's email
          const participants = conv.participants || [];
          const otherParticipant = participants.find((p: any) => !p.is_me) || participants[0] || {};
          participantId = otherParticipant.email || conv.from?.email || 'unknown';
          participantName = otherParticipant.name || otherParticipant.email || 'Unknown';
        } else {
          // LinkedIn/Instagram: Fetch attendee details from the chat
          // The chat object may have attendees array or we need to fetch them
          let attendeeInfo = null;

          // Try to get attendee info from the chat object first
          if (conv.attendees && Array.isArray(conv.attendees) && conv.attendees.length > 0) {
            // Filter out "self" attendee if there's more than one
            const otherAttendee = conv.attendees.find((a: any) => !a.is_self && !a.is_me) || conv.attendees[0];
            attendeeInfo = otherAttendee;
          }

          // If no attendee info in chat object, fetch attendees via the typed SDK
          // method. Again, avoid request.send({ path: '<string>' }) (see note above).
          // getAllChats also returns flat attendee_* fields, which we use as a
          // last-resort fallback so imports still get a name even if the
          // attendees lookup is unavailable in the resolved SDK build.
          if (!attendeeInfo || (!attendeeInfo.name && !attendeeInfo.display_name)) {
            try {
              const attendeesData = await client.messaging.getAllAttendeesFromChat({
                chat_id: externalConversationId as string,
              }) as { items?: UnipileAttendee[]; attendees?: UnipileAttendee[] };

              const attendees = attendeesData.items || attendeesData.attendees || [];
              // Find the other participant (not the account owner)
              attendeeInfo = attendees.find((a: UnipileAttendee) =>
                a.provider_id !== account.unipile_account_id &&
                !(a as Record<string, unknown>).is_self &&
                !(a as Record<string, unknown>).is_me
              ) || attendees[0];

              console.log(`[Sync History] Fetched attendee for chat ${externalConversationId}:`,
                attendeeInfo ? `${attendeeInfo.name || attendeeInfo.display_name || attendeeInfo.id}` : 'none');
            } catch (attendeeError) {
              console.error(`[Sync History] Failed to fetch attendees for chat ${externalConversationId}:`, attendeeError);
            }
          }

          // Fall back to flat attendee_* fields that getAllChats returns on the
          // chat object itself when the attendees lookup yielded nothing usable.
          if (!attendeeInfo || (!attendeeInfo.name && !attendeeInfo.display_name)) {
            const flat = conv as Record<string, unknown>;
            if (flat.attendee_id || flat.attendee_provider_id || flat.attendee_name) {
              attendeeInfo = {
                id: (flat.attendee_id || flat.attendee_provider_id) as string,
                provider_id: flat.attendee_provider_id as string | undefined,
                name: flat.attendee_name as string | undefined,
                avatar_url: flat.attendee_avatar as string | undefined,
              } as UnipileAttendee;
            }
          }

          // Extract info from attendee object - try multiple possible field names
          if (attendeeInfo) {
            participantId = attendeeInfo.id || attendeeInfo.provider_id || attendeeInfo.attendee_id || 'unknown';
            participantName = attendeeInfo.name || attendeeInfo.display_name || attendeeInfo.first_name ||
                             (attendeeInfo.first_name && attendeeInfo.last_name ?
                               `${attendeeInfo.first_name} ${attendeeInfo.last_name}` : null) ||
                             attendeeInfo.headline || 'Unknown';
            participantAvatarUrl = attendeeInfo.avatar_url || attendeeInfo.profile_picture_url ||
                                   attendeeInfo.picture_url || attendeeInfo.avatar || null;
            participantProfileUrl = attendeeInfo.profile_url || attendeeInfo.public_profile_url ||
                                    attendeeInfo.linkedin_url || null;
          } else {
            participantId = conv.attendee_provider_id || 'unknown';
            participantName = 'Unknown';
          }

          console.log(`[Sync History] Chat ${externalConversationId} participant: ${participantName} (${participantId})`);
        }

        // Find or create contact
        const { contactId, isNew: isNewContact } = await findOrCreateContact(
          supabase,
          account.organization_id,
          account_id,
          channelType,
          participantId,
          participantName,
          participantAvatarUrl,
          participantProfileUrl
        );

        if (isNewContact) {
          contactsCreated++;
        }

        // Create conversation record
        // NOTE: get_or_create_conversation has two overloads (with/without
        // p_mailbox_id). Passing p_mailbox_id explicitly disambiguates the call
        // — omitting it makes PostgREST unable to choose an overload and every
        // conversation insert fails with "Could not choose the best candidate".
        const { data: conversationId } = await supabase.rpc('get_or_create_conversation', {
          p_org_id: account.organization_id,
          p_contact_id: contactId,
          p_channel: channelType,
          p_channel_account_id: account_id,
          p_external_conversation_id: externalConversationId,
          p_external_participant_id: participantId,
          p_mailbox_id: null,
        });

        if (!conversationId) {
          console.error(`[Sync History] Failed to create conversation for ${externalConversationId}`);
          errors.push(`Failed to create conversation: ${externalConversationId}`);
          continue;
        }

        conversationsImported++;

        // Fetch messages for this conversation using SDK
        let messages: Record<string, unknown>[] = [];

        try {
          if (channelType === 'email') {
            const emailsData = await client.request.send({
              path: '/api/v1/emails',
              method: 'GET',
              query: {
                thread_id: externalConversationId,
                limit: String(messages_per_conversation),
              },
            }) as { items?: Record<string, unknown>[] };

            messages = emailsData.items || [];
          } else {
            const messagesData = await client.messaging.getAllMessagesFromChat({
              chat_id: externalConversationId as string,
              limit: messages_per_conversation,
            }) as { items?: Record<string, unknown>[]; messages?: Record<string, unknown>[] };

            messages = messagesData.items || messagesData.messages || [];
          }
        } catch (msgFetchError) {
          console.error(`[Sync History] Failed to fetch messages for ${externalConversationId}:`, msgFetchError);
        }

        // Import messages (oldest first)
        messages.reverse();

        let latestMessageAt: string | null = null;
        let latestMessagePreview: string | null = null;
        let latestMessageDirection: 'inbound' | 'outbound' | null = null;
        let importedCount = 0;

        for (const msg of messages) {
          try {
            const externalMessageId = msg.id || msg.message_id;

            // Skip if message already exists
            const { data: existingMsg } = await supabase
              .from('crm_messages')
              .select('id')
              .eq('external_message_id', externalMessageId)
              .single();

            if (existingMsg) {
              continue;
            }

            // Determine direction and sender
            const isFromMe = msg.is_sender || msg.is_from_me || msg.direction === 'outgoing' || msg.sent;
            const direction = isFromMe ? 'outbound' : 'inbound';
            const senderType = isFromMe ? 'user' : 'contact';

            // Extract content
            let content = '';
            let contentType = 'text';
            let emailSubject = null;
            let emailFrom = null;
            let emailTo = null;

            if (channelType === 'email') {
              content = msg.text || msg.html || msg.body || '';
              contentType = msg.html ? 'html' : 'text';
              emailSubject = msg.subject;
              emailFrom = msg.from?.email || msg.from;
              emailTo = Array.isArray(msg.to) ? msg.to.map((t: any) => t.email || t) : msg.to;
            } else {
              // Prefer body (may contain HTML with <br> for line breaks) over text (plain, no breaks)
              const rawBody = (msg.body || '') as string;
              const rawText = (msg.text || '') as string;
              const bodyHasHtml = /<(?:br|p|div|span|a)\b/i.test(rawBody);
              if (bodyHasHtml && rawBody) {
                content = rawBody;
                contentType = 'html';
              } else {
                content = rawText || rawBody || '';
              }
            }

            // Get the actual message timestamp from Unipile
            const messageTimestamp = msg.timestamp || msg.created_at || msg.date || new Date().toISOString();

            // Insert message
            const { error: msgError } = await supabase
              .from('crm_messages')
              .insert({
                organization_id: account.organization_id,
                conversation_id: conversationId,
                contact_id: contactId,
                direction,
                sender_type: senderType,
                content,
                content_type: contentType,
                attachments: msg.attachments || [],
                external_message_id: externalMessageId,
                external_thread_id: externalConversationId,
                email_subject: emailSubject,
                email_from: emailFrom,
                email_to: emailTo,
                status: 'delivered',
                delivered_at: messageTimestamp,
                metadata: { unipile: msg, imported: true },
              });

            if (!msgError) {
              messagesImported++;
              importedCount++;

              // Track the latest message for conversation update
              if (!latestMessageAt || new Date(messageTimestamp) > new Date(latestMessageAt)) {
                latestMessageAt = messageTimestamp;
                latestMessagePreview = content
                  .replace(/<(style|head|script|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
                  .replace(/<br\s*\/?>/gi, ' ')
                  .replace(/<[^>]*>/g, '')
                  .replace(/&nbsp;/gi, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .substring(0, 200);
                latestMessageDirection = direction;
              }
            }
          } catch (msgError) {
            console.error(`[Sync History] Error importing message:`, msgError);
          }
        }

        // Update conversation with actual last message timestamp
        if (latestMessageAt) {
          await supabase
            .from('crm_conversations')
            .update({
              last_message_at: latestMessageAt,
              last_message_preview: latestMessagePreview,
              last_message_direction: latestMessageDirection,
              message_count: importedCount,
            })
            .eq('id', conversationId);
        }

        console.log(`[Sync History] Imported conversation ${externalConversationId} with ${importedCount} messages, last at ${latestMessageAt}`);

      } catch (convError) {
        console.error(`[Sync History] Error processing conversation:`, convError);
        errors.push(`Conversation error: ${convError instanceof Error ? convError.message : 'Unknown'}`);
      }
    }

    // Update account to mark initial sync complete
    await supabase
      .from('unipile_accounts')
      .update({
        last_synced_at: new Date().toISOString(),
        metadata: {
          ...account.metadata,
          initial_sync_completed: true,
          initial_sync_at: new Date().toISOString(),
          initial_sync_stats: {
            conversations: conversationsImported,
            messages: messagesImported,
            contacts: contactsCreated,
          },
        },
      })
      .eq('id', account_id);

    const duration = Date.now() - startTime;
    console.log(`[Sync History] Job ${jobId} completed in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      duration,
      stats: {
        conversationsImported,
        messagesImported,
        contactsCreated,
      },
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Sync History] Fatal error:', error);

    return new Response(JSON.stringify({
      success: false,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stats: {
        conversationsImported,
        messagesImported,
        contactsCreated,
      },
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve LinkedIn contacts left as "Unknown" by a prior sync.
 *
 * Names are only available from Unipile's attendee/user endpoints, which get
 * throttled when a sync fetches ~100 chats in a burst. This pass finds imported
 * contacts still named "Unknown", then resolves each stored member URN directly
 * via GET /api/v1/users/{urn} (plain fetch — avoids the SDK request.send path
 * drift), rate-limited and safely re-runnable until every name is filled in.
 */
async function enrichUnknownContacts(
  supabase: SupabaseClient<any>,
  apiKey: string,
  dsnUrl: string,
  unipileAccountId: string,
  accountId: string,
  organizationId: string,
  max: number,
): Promise<{ scanned: number; resolved: number; failed: number }> {
  // 1. Imported LinkedIn contacts still named "Unknown" for this org.
  const { data: unknownContacts } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('source', 'linkedin_import')
    .eq('display_name', 'Unknown')
    .order('first_seen_at', { ascending: false })
    .limit(max);

  const contactIds = (unknownContacts || []).map((c: { id: string }) => c.id);
  if (contactIds.length === 0) return { scanned: 0, resolved: 0, failed: 0 };

  // 2. Their identities that carry a resolvable member URN, scoped to this account.
  const { data: identities } = await supabase
    .from('crm_contact_identities')
    .select('id, contact_id, platform_user_id')
    .eq('channel', 'linkedin')
    .contains('linked_account_ids', [accountId])
    .like('platform_user_id', 'ACoAA%')
    .in('contact_id', contactIds);

  const targets = (identities || []) as Array<{ id: string; contact_id: string; platform_user_id: string }>;
  let resolved = 0;
  let failed = 0;

  for (const row of targets) {
    const urn = row.platform_user_id;
    try {
      const params = new URLSearchParams({ account_id: unipileAccountId, notify: 'false' });
      const url = `${dsnUrl}/api/v1/users/${encodeURIComponent(urn)}?${params.toString()}`;
      const fetchProfile = async () => {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
        });
        return resp;
      };

      let resp = await fetchProfile();
      if (resp.status === 429) {
        await sleep(2500); // throttled — back off once and retry
        resp = await fetchProfile();
      }

      if (!resp.ok) { failed++; await sleep(400); continue; }

      const profile = await resp.json() as Record<string, any>;
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
        || (profile.name as string) || (profile.headline as string) || null;
      const avatar = (profile.profile_picture_url as string) || null;
      const profileUrl = (profile.public_profile_url as string) || null;

      if (name) {
        await supabase.from('crm_contacts').update({
          display_name: name,
          ...(avatar ? { avatar_url: avatar } : {}),
          ...(profileUrl ? { primary_linkedin_url: profileUrl } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', row.contact_id);

        await supabase.from('crm_contact_identities').update({
          platform_username: name,
          ...(avatar ? { platform_avatar_url: avatar } : {}),
          ...(profileUrl ? { platform_profile_url: profileUrl } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        resolved++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[Sync History][enrich] Failed to resolve ${urn}:`, err);
      failed++;
    }
    await sleep(400); // ~2-3 req/s — stay under Unipile throttle
  }

  return { scanned: targets.length, resolved, failed };
}

/**
 * Find existing contact or create new one
 */
async function findOrCreateContact(
  supabase: SupabaseClient<any>,
  organizationId: string,
  accountId: string,
  channel: string,
  platformUserId: string,
  displayName: string,
  avatarUrl: string | null,
  profileUrl: string | null
): Promise<{ contactId: string; isNew: boolean }> {
  const accountScopedData = {
    imported_at: new Date().toISOString(),
    source: 'unipile_sync_history',
    platform_user_id: platformUserId,
    display_name: displayName,
    profile_url: profileUrl,
    avatar_url: avatarUrl,
  };

  // Try to find by identity already linked to this source account.
  const { data: existingIdentity } = await supabase
    .from('crm_contact_identities')
    .select('contact_id')
    .eq('organization_id', organizationId)
    .eq('channel', channel)
    .eq('platform_user_id', platformUserId)
    .contains('linked_account_ids', [accountId])
    .single();

  if (existingIdentity) {
    return { contactId: existingIdentity.contact_id, isNew: false };
  }

  // If the same platform user already exists for this organization but is not
  // yet linked to this Unipile account, link the account explicitly instead of
  // relying on a global org-level match later.
  const { data: identityForOtherAccount } = await supabase
    .from('crm_contact_identities')
    .select('id, contact_id, linked_account_ids, raw_connection_data')
    .eq('organization_id', organizationId)
    .eq('channel', channel)
    .eq('platform_user_id', platformUserId)
    .maybeSingle();

  if (identityForOtherAccount) {
    const linkedAccountIds = (identityForOtherAccount.linked_account_ids || []) as string[];
    await supabase
      .from('crm_contact_identities')
      .update({
        linked_account_ids: [...new Set([...linkedAccountIds, accountId])],
        raw_connection_data: {
          ...((identityForOtherAccount.raw_connection_data || {}) as Record<string, unknown>),
          [accountId]: accountScopedData,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', identityForOtherAccount.id);

    return { contactId: identityForOtherAccount.contact_id, isNew: false };
  }

  // Create new contact
  const { data: newContact, error: contactError } = await supabase
    .from('crm_contacts')
    .insert({
      organization_id: organizationId,
      display_name: displayName || platformUserId,
      avatar_url: avatarUrl,
      primary_email: channel === 'email' ? platformUserId : null,
      primary_linkedin_url: channel === 'linkedin' ? profileUrl : null,
      source: `${channel}_import`,
      status: 'active',
    })
    .select()
    .single();

  if (contactError || !newContact) {
    throw new Error(`Failed to create contact: ${contactError?.message}`);
  }

  // Create identity
  await supabase.from('crm_contact_identities').insert({
    organization_id: organizationId,
    contact_id: newContact.id,
    channel,
    platform_user_id: platformUserId,
    platform_username: displayName,
    platform_profile_url: profileUrl,
    platform_avatar_url: avatarUrl,
    linked_account_ids: [accountId],
    raw_connection_data: { [accountId]: accountScopedData },
    is_primary: true,
  });

  // Log activity
  await supabase.from('crm_activities').insert({
    organization_id: organizationId,
    contact_id: newContact.id,
    activity_type: 'contact_created',
    title: 'Contact imported',
    description: `Contact imported from ${channel} history`,
    metadata: { channel, platformUserId, imported: true },
    performed_by_type: 'system',
  });

  return { contactId: newContact.id, isNew: true };
}
