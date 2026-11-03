/**
 * Shared secret for Unipile webhook deliveries. Unipile has no signing, but lets us attach
 * custom headers when a webhook is registered; the handler checks that header.
 *
 * The secret is derived from ENCRYPTION_KEY (HMAC with a fixed label) rather than stored as
 * its own project secret: the project is at Supabase's 100-secret cap, and ENCRYPTION_KEY
 * cannot rotate without breaking every stored credential anyway.
 *
 * Rollout: webhooks registered before this header existed don't send it. The handler accepts
 * header-less events (known accounts only) until UNIPILE_WEBHOOK_REQUIRE_SECRET=true, which
 * should be set once every account's webhooks have been re-registered.
 */
export const UNIPILE_WEBHOOK_SECRET_HEADER = 'X-Aca-Webhook-Secret';

async function webhookSecret(): Promise<string | null> {
  const base = Deno.env.get('ENCRYPTION_KEY');
  if (!base) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(base), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('aca-unipile-webhook-v1'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function unipileWebhookHeaders(): Promise<Array<{ key: string; value: string }>> {
  const secret = await webhookSecret();
  return secret ? [{ key: UNIPILE_WEBHOOK_SECRET_HEADER, value: secret }] : [];
}

/** 'ok' | 'missing' (no header sent) | 'invalid' (header sent but wrong) */
export async function checkUnipileWebhookSecret(req: Request): Promise<'ok' | 'missing' | 'invalid'> {
  const got = req.headers.get(UNIPILE_WEBHOOK_SECRET_HEADER);
  if (!got) return 'missing';
  const expected = await webhookSecret();
  return expected && got === expected ? 'ok' : 'invalid';
}
