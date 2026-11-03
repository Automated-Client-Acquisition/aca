/**
 * Phase 8.2.1 — Google OAuth callback for Postmaster Tools.
 *
 * Public endpoint (verify_jwt = false). Google redirects here with
 * ?code=...&state=<organization_id>. We exchange the code for tokens, store
 * them encrypted, and redirect the popup to a confirmation page that closes
 * itself and posts a message back to the parent window.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { encryptValue } from '../_shared/encryption.ts';
import {
  exchangeCodeForTokens,
  getAccountEmail,
} from '../_shared/postmaster-oauth.ts';
import { PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const APP_URL_FALLBACK = PUBLIC_SITE_URL;

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function closingPage(success: boolean, message: string, accountEmail?: string): string {
  const status = success ? 'success' : 'error';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Postmaster connected</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; text-align: center; color: #222; }
  .ok { color: #16a34a; }
  .err { color: #dc2626; }
</style></head><body>
<h2 class="${success ? 'ok' : 'err'}">${success ? 'Connected to Google Postmaster Tools' : 'Connection failed'}</h2>
<p>${message}</p>
${accountEmail ? `<p style="color:#6b7280">Account: <code>${accountEmail}</code></p>` : ''}
<p style="color:#6b7280;font-size:13px">You can close this window.</p>
<script>
  try {
    window.opener && window.opener.postMessage(${JSON.stringify({ type: 'postmaster_connect', status, accountEmail: accountEmail ?? null })}, '*');
  } catch (e) {}
  setTimeout(() => window.close(), 1500);
</script>
</body></html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');         // organization_id
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return htmlResponse(closingPage(false, `Google declined: ${oauthError}`));
  }
  if (!code || !state) {
    return htmlResponse(closingPage(false, 'Missing code or state in the redirect.'));
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return htmlResponse(closingPage(false, 'Server is not configured.'));
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // Verify the state matches a real organization (prevents open-redirect / state-fixing)
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', state)
    .maybeSingle();
  if (!org) return htmlResponse(closingPage(false, 'Invalid state parameter.'));

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    return htmlResponse(closingPage(false, e instanceof Error ? e.message : 'Token exchange failed.'));
  }

  if (!tokens.refresh_token) {
    // Google only returns refresh_token on the first consent. If the user
    // already authorized once (without revoking) they don't get a new one.
    // Surface this so the user knows to revoke and retry.
    return htmlResponse(closingPage(
      false,
      'No refresh token returned. Revoke our app at https://myaccount.google.com/permissions and reconnect.',
    ));
  }

  let accountEmail: string | null = null;
  try { accountEmail = await getAccountEmail(tokens.access_token); } catch { /* non-fatal */ }

  const expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const refreshEnc = await encryptValue(tokens.refresh_token);
  const accessEnc = await encryptValue(tokens.access_token);

  const { error: upsertErr } = await supabase
    .from('postmaster_oauth_tokens')
    .upsert({
      organization_id: state,
      account_email: accountEmail,
      scopes: tokens.scope?.split(' ') ?? null,
      refresh_token_encrypted: refreshEnc,
      access_token_encrypted: accessEnc,
      access_token_expires_at: expires_at,
      status: 'connected',
      last_error: null,
      last_synced_at: null,
    }, { onConflict: 'organization_id' });

  if (upsertErr) {
    return htmlResponse(closingPage(false, `Database error: ${upsertErr.message}`));
  }

  // Fire-and-forget: register all BYO domains for this org with Postmaster
  // (the cron will also pick them up but doing it now means immediate UX).
  fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/infra-postmaster-register-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ organization_id: state }),
  }).catch(() => { /* fire-and-forget */ });

  return htmlResponse(closingPage(
    true,
    `Postmaster Tools connected. Reputation data starts flowing within 6 hours.`,
    accountEmail ?? undefined,
  ));
});

void APP_URL_FALLBACK; // referenced for potential future use
