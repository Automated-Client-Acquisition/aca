/**
 * Twilio Connect: stores an org's Twilio credentials and imports its senders
 * (SMS numbers, short codes, alphanumeric IDs, WhatsApp Business senders) into
 * messaging_senders.
 *
 * Actions:
 *  - { action: "connect", organization_id, account_sid, auth_token, default_country? }
 *      validate → save to api_keys (provider 'twilio') → import senders → start the
 *      org's contact phone backfill
 *  - { action: "sync", key_id }        re-import senders
 *  - { action: "disconnect", key_id }  delete the key (senders cascade)
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { encryptApiKey } from '../_shared/unipile-client.ts';
import { toCountryCode } from '../_shared/phone.ts';
import { statusCallbackUrl } from '../_shared/messaging/sms.ts';
import {
  credentialsFromKeyRow,
  discoverSenders,
  fetchAccount,
  fetchWhatsAppSenderWebhook,
  setNumberSmsUrl,
  setWhatsAppSenderWebhook,
  TwilioError,
  type TwilioCredentials,
} from '../_shared/twilio-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function importSenders(
  supabase: SupabaseClient,
  organizationId: string,
  keyId: string,
  creds: TwilioCredentials,
) {
  const { senders, warnings } = await discoverSenders(creds);

  // Replies only reach ACA when the number's incoming-SMS webhook points here.
  // Set it when empty (or already ours); a number wired to another app is left
  // alone and flagged, since overwriting would break that app.
  const webhookUrl = statusCallbackUrl();
  for (const s of senders) {
    if (s.channel !== 'sms' || (s.address_type !== 'long_code' && s.address_type !== 'toll_free')) continue;
    const current = (s.metadata.sms_url as string | null) || '';
    if (current === webhookUrl) continue;
    if (!current || current.includes('demo.twilio.com')) {
      try {
        await setNumberSmsUrl(creds, s.provider_sender_id, webhookUrl);
        s.metadata.sms_url = webhookUrl;
      } catch (err) {
        warnings.push(`${s.address}: ${(err as Error).message}`);
      }
    } else {
      let host = current;
      try { host = new URL(current).host; } catch { /* not a URL: show as is */ }
      s.status_detail = `Replies go to another app (${host}), not ACA`;
    }
  }

  // Same for WhatsApp senders: their webhook lives on the sender (Senders API)
  for (const s of senders) {
    if (s.channel !== 'whatsapp_business') continue;
    try {
      const { callback_url: current } = await fetchWhatsAppSenderWebhook(creds, s.provider_sender_id);
      if (current === webhookUrl) continue;
      if (!current) {
        await setWhatsAppSenderWebhook(creds, s.provider_sender_id, webhookUrl);
      } else {
        let host = current;
        try { host = new URL(current).host; } catch { /* not a URL: show as is */ }
        s.status_detail = `Replies go to another app (${host}), not ACA`;
      }
    } catch (err) {
      warnings.push(`${s.address} (WhatsApp): ${(err as Error).message}`);
    }
  }

  const { data: existing } = await supabase
    .from('messaging_senders')
    .select('id, channel, address, status')
    .eq('organization_id', organizationId)
    .eq('api_key_id', keyId);
  const existingByKey = new Map((existing ?? []).map((s) => [`${s.channel}|${s.address}`, s]));

  const rows = senders.map((s) => {
    const prior = existingByKey.get(`${s.channel}|${s.address}`);
    return {
      organization_id: organizationId,
      api_key_id: keyId,
      provider: 'twilio',
      ...s,
      // A sender the user switched off stays off across syncs
      status: prior?.status === 'disabled' ? 'disabled' : s.status,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from('messaging_senders')
      .upsert(rows, { onConflict: 'organization_id,provider,channel,address' });
    if (error) throw new Error(`Saving senders failed: ${error.message}`);
  }

  // Gone from Twilio: keep the row (campaigns may reference it) but stop using it
  const found = new Set(senders.map((s) => `${s.channel}|${s.address}`));
  const gone = (existing ?? []).filter((s) => !found.has(`${s.channel}|${s.address}`)).map((s) => s.id);
  if (gone.length > 0) {
    await supabase
      .from('messaging_senders')
      .update({ status: 'error', status_detail: 'No longer in the Twilio account' })
      .in('id', gone);
  }

  await supabase
    .from('api_keys')
    .update({ is_valid: true, last_validated: new Date().toISOString() })
    .eq('id', keyId);

  return {
    imported: rows.length,
    sms: rows.filter((r) => r.channel === 'sms').length,
    whatsapp: rows.filter((r) => r.channel === 'whatsapp_business').length,
    removed: gone.length,
    warnings,
  };
}

async function loadKey(req: Request, supabase: SupabaseClient, keyId: string) {
  if (!keyId) throw new Error('key_id is required');
  const { data: row } = await supabase
    .from('api_keys')
    .select('id, organization_id, key_encrypted, metadata')
    .eq('id', keyId)
    .eq('provider', 'twilio')
    .maybeSingle();
  if (!row) throw new Error('Twilio connection not found');
  await assertOrgAccess(req, supabase, row.organization_id);
  return row;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();

    if (body.action === 'connect') {
      const organizationId = body.organization_id || body.organizationId;
      await assertOrgAccess(req, supabase, organizationId);

      const accountSid = String(body.account_sid ?? '').trim();
      const authToken = String(body.auth_token ?? '').trim();
      if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) return json({ error: 'Account SID should start with AC followed by 32 characters' }, 400);
      if (!authToken) return json({ error: 'Auth token is required' }, 400);
      const defaultCountry = toCountryCode(body.default_country);

      const creds = { accountSid, authToken };
      const account = await fetchAccount(creds);
      if (account.status !== 'active') {
        return json({ error: `This Twilio account is ${account.status}` }, 400);
      }

      const keyEncrypted = await encryptApiKey(authToken, Deno.env.get('ENCRYPTION_KEY')!);
      const metadata = { account_sid: accountSid, friendly_name: account.friendly_name, account_type: account.type, default_country: defaultCountry };

      // Re-connecting the same account replaces its token instead of adding a second key
      const { data: sameAccount } = await supabase
        .from('api_keys')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('provider', 'twilio')
        .eq('metadata->>account_sid', accountSid)
        .maybeSingle();

      let keyId: string;
      if (sameAccount) {
        const { error } = await supabase
          .from('api_keys')
          .update({ key_encrypted: keyEncrypted, key_hint: `••••${authToken.slice(-4)}`, metadata, is_valid: true, last_validated: new Date().toISOString() })
          .eq('id', sameAccount.id);
        if (error) throw new Error(error.message);
        keyId = sameAccount.id;
      } else {
        const { data: inserted, error } = await supabase
          .from('api_keys')
          .insert({
            organization_id: organizationId,
            provider: 'twilio',
            key_encrypted: keyEncrypted,
            key_hint: `••••${authToken.slice(-4)}`,
            is_valid: true,
            last_validated: new Date().toISOString(),
            metadata,
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        keyId = inserted.id;
      }

      const result = await importSenders(supabase, organizationId, keyId, creds);

      // Inbound replies are matched by E.164, so normalise the org's phones now.
      const backfill = fetch(`${supabaseUrl}/functions/v1/contact-phone-backfill`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', organization_id: organizationId, default_country: defaultCountry }),
      }).catch((err) => console.error('[twilio-connect] phone backfill start failed:', err));
      // @ts-ignore EdgeRuntime is provided by the Supabase runtime
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(backfill);

      return json({ success: true, key_id: keyId, account_name: account.friendly_name, ...result });
    }

    if (body.action === 'sync') {
      const row = await loadKey(req, supabase, body.key_id);
      let creds: TwilioCredentials;
      try {
        creds = await credentialsFromKeyRow(row);
        await fetchAccount(creds);
      } catch (err) {
        if (err instanceof TwilioError && err.status === 401) {
          await supabase.from('api_keys').update({ is_valid: false, last_validated: new Date().toISOString() }).eq('id', row.id);
        }
        throw err;
      }
      const result = await importSenders(supabase, row.organization_id, row.id, creds);
      return json({ success: true, ...result });
    }

    if (body.action === 'disconnect') {
      const row = await loadKey(req, supabase, body.key_id);
      const { error } = await supabase.from('api_keys').delete().eq('id', row.id);
      if (error) throw new Error(error.message);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    if (err instanceof AuthError) return unauthorized(err, corsHeaders);
    const message = err instanceof Error ? err.message : String(err);
    console.error('[twilio-connect]', message);
    const status = err instanceof TwilioError && err.status === 401 ? 400
      : message === 'Twilio connection not found' ? 404
      : 500;
    return json({ error: message }, status);
  }
});
