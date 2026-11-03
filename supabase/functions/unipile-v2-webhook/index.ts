/**
 * Unipile v2 webhook endpoint (application-level, one endpoint for every v2 account).
 *
 * 1. Verifies `unipile-signature: t=<unix>,v0=<hex HMAC-SHA256 of "<t>.<raw body>">` with the
 *    endpoint secret stored in unipile_v2_webhook_endpoints.
 * 2. Answers 200 at once: Unipile allows 5 s and retries only twice.
 * 3. In the background:
 *    - message.new (inbound only) and relation.new are translated into the v1 payload shape and
 *      handed to unipile-webhook-handler, which already files replies into the inbox, stops
 *      sequences, advances accepted connections, runs autopilot and lead-magnet delivery.
 *    - account.add / account.reconnect save the account for the org whose hosted-auth `state` it
 *      carries (the redirect callback does the same; whichever lands first wins).
 *    - account.* events update the account's status.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { unipileWebhookHeaders } from '../_shared/unipile-webhook-auth.ts';
import { UnipileV2Client } from '../_shared/unipile/index.ts';
import {
  resolveOrgV2Key,
  saveV2Account,
  v2ApiKeyForAccount,
  v2ProviderLabel,
  type V2Account,
} from '../_shared/unipile/v2-accounts.ts';

const MAX_SKEW_SECONDS = 300;

interface V2Event {
  id?: string;
  type?: string;
  account_id?: string;
  account_provider?: string;
  payload?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const raw = await req.text();

  if (!(await verifySignature(supabase, req.headers.get('unipile-signature'), raw))) {
    console.warn('[Unipile v2 Webhook] Rejected: bad or missing signature');
    return json({ error: 'Unauthorized' }, 401);
  }

  let event: V2Event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const work = handleEvent(supabase, supabaseUrl, event).catch((error) => {
    console.error(`[Unipile v2 Webhook] ${event.type} ${event.id} failed:`, error);
  });
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else await work;

  return json({ received: true, type: event.type ?? null });
});

async function handleEvent(supabase: SupabaseClient, supabaseUrl: string, event: V2Event): Promise<void> {
  const type = event.type ?? '';
  const accountId = event.account_id;
  if (!accountId) return;

  switch (type) {
    case 'message.new': {
      const msg = event.payload ?? {};
      if (msg.is_sender === true) return; // v2 fires message.new for our own sends too
      const sender = (msg.sender ?? {}) as Record<string, unknown>;
      await forwardToV1Handler(supabaseUrl, {
        event: 'message_received',
        id: event.id,
        account_id: accountId,
        account_info: { type: providerName(event.account_provider) },
        chat_id: msg.chat_id,
        message_id: msg.id,
        message: msg.text,
        timestamp: msg.timestamp,
        is_sender: false,
        attachments: msg.attachments,
        sender: {
          // Instagram: the 1:1 chat id is the sender's messaging identifier, the id ACA DMs and stores
          // on lead-magnet leads; sender_id may be the profile id, which would match no lead.
          attendee_provider_id: providerName(event.account_provider) === 'INSTAGRAM' && msg.chat_id
            ? msg.chat_id
            : msg.sender_id ?? sender.id,
          attendee_name: sender.display_name,
          attendee_profile_url: sender.profile_url,
          attendee_specifics: { provider: providerName(event.account_provider) },
        },
      });
      return;
    }

    case 'relation.new': {
      const relation = event.payload ?? {};
      const user = (relation.user ?? {}) as Record<string, unknown>;
      const userId = user.id ?? relation.id;
      if (!userId) return;
      await forwardToV1Handler(supabaseUrl, {
        event: 'new_relation',
        id: event.id,
        account_id: accountId,
        user_provider_id: userId,
        user_full_name: user.display_name,
        user_profile_url: user.profile_url,
      });
      return;
    }

    case 'account.add':
    case 'account.reconnect': {
      const payload = event.payload ?? {};
      const account = payload.account as V2Account | undefined;
      const state = typeof payload.state === 'string' ? payload.state : null;
      if (state && account?.id) await saveFromState(supabase, state, account);
      if (type === 'account.reconnect') await setStatus(supabase, accountId, 'active', null);
      return;
    }

    case 'account.status.running':
    case 'account.unlocked':
      await setStatus(supabase, accountId, 'active', null);
      return;
    case 'account.status.disconnected':
      await setStatus(
        supabase, accountId, 'expired',
        `${v2ProviderLabel(event.account_provider)} logged this account out. Please reconnect it.`,
      );
      return;
    case 'account.status.errored':
    case 'account.locked':
      await setStatus(supabase, accountId, 'error', `Unipile reported ${type}. Please reconnect this account.`);
      return;
    case 'account.remove':
      await setStatus(supabase, accountId, 'disconnected', 'Account was removed from Unipile.');
      return;
    default:
      return;
  }
}

/** Saves a newly linked account for the org that created the hosted-auth link with `state`. */
async function saveFromState(supabase: SupabaseClient, state: string, account: V2Account): Promise<void> {
  const { data: stateRow } = await supabase
    .from('oauth_states')
    .select('organization_id, expires_at')
    .eq('state', state)
    .maybeSingle();
  // Spent (the redirect callback saved it) or not ours: nothing to do.
  if (!stateRow || new Date(stateRow.expires_at) < new Date()) return;

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const { data: existing } = await supabase
    .from('unipile_accounts')
    .select('access_token_encrypted')
    .eq('organization_id', stateRow.organization_id)
    .eq('unipile_account_id', account.id)
    .eq('api_version', 'v2')
    .maybeSingle();
  const key = existing
    ? { apiKey: await v2ApiKeyForAccount(existing, encryptionKey), encryptedKey: existing.access_token_encrypted }
    : await resolveOrgV2Key(supabase, stateRow.organization_id, encryptionKey);

  const saved = await saveV2Account(
    supabase, new UnipileV2Client({ apiKey: key.apiKey }), stateRow.organization_id, account, key.encryptedKey,
  );
  // The state stays: the redirect callback may still arrive and must find it.
  console.log(`[Unipile v2 Webhook] Saved ${account.id} (${saved.provider}) as ${saved.id} for org ${stateRow.organization_id}`);
}

async function forwardToV1Handler(supabaseUrl: string, payload: Record<string, unknown>): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const h of await unipileWebhookHeaders()) headers[h.key] = h.value;
  const res = await fetch(`${supabaseUrl}/functions/v1/unipile-webhook-handler`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`unipile-webhook-handler answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function setStatus(
  supabase: SupabaseClient,
  unipileAccountId: string,
  status: string,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('unipile_accounts')
    .update({ status, error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq('unipile_account_id', unipileAccountId)
    .eq('api_version', 'v2')
    .neq('status', status);
  if (error) console.error(`[Unipile v2 Webhook] Status update for ${unipileAccountId} failed:`, error.message);
}

async function verifySignature(supabase: SupabaseClient, header: string | null, raw: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  const v0 = parts.v0;
  if (!Number.isFinite(t) || !v0) return false;
  if (Math.abs(Date.now() / 1000 - t) > MAX_SKEW_SECONDS) return false;

  const { data: endpoints } = await supabase.from('unipile_v2_webhook_endpoints').select('secret_encrypted');
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  for (const endpoint of endpoints ?? []) {
    const secret = await decryptApiKey(endpoint.secret_encrypted, encryptionKey);
    if (timingSafeEqual(await hmacHex(secret, `${parts.t}.${raw}`), v0)) return true;
  }
  return false;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function providerName(provider: string | undefined): string {
  return (provider ?? 'linkedin').toUpperCase();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
