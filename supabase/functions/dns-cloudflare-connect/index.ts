/**
 * dns-cloudflare-connect
 *
 * Validates a Cloudflare API token, persists it encrypted, and exposes the
 * connection state to the UI. Three actions:
 *   - validate_and_store: take a token, verify it via Cloudflare, store it
 *   - disconnect:         delete the credential row (does NOT undo records
 *                         already pushed to Cloudflare zones)
 *   - status:             read the current dns_providers row, re-verify if
 *                         older than 24h
 *
 * All actions are scoped to organization_id. The service-role client bypasses
 * RLS, so the caller must pass assertOrgAccess for that org first.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { encryptValue } from '../_shared/encryption.ts';
import { createCloudflareClient, CloudflareError } from '../_shared/cloudflare-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Translate Cloudflare's machine-readable error codes into messages that point
// the user at the actual problem. Anything we don't have a friendly mapping
// for falls through to the raw CF message.
function friendlyCloudflareError(err: unknown): { error: string; error_title?: string; next_steps?: string[] } {
  if (err instanceof CloudflareError) {
    if (err.code === 1000 || err.code === 6003 || err.code === 9109 || err.status === 401) {
      return {
        error_title: 'Invalid Cloudflare token',
        error: 'The token Cloudflare returned was rejected. It may be revoked, mistyped, or copied incompletely.',
        next_steps: [
          'In Cloudflare, go to My Profile → API Tokens',
          'Create a new token using the "Edit zone DNS" template',
          'Set Zone Resources to "All zones" (or the specific zones you want ACA to manage)',
          'Copy the token *immediately* — Cloudflare only shows it once',
          'Paste it here',
        ],
      };
    }
    if (err.code === 9106) {
      return {
        error_title: 'Token is missing required permissions',
        error: 'The token can authenticate but does not have permission to read zones.',
        next_steps: [
          'Recreate the token with Zone:Read, Zone:Edit, and Account:Read permissions',
        ],
      };
    }
    return { error: err.message };
  }
  return { error: err instanceof Error ? err.message : 'Unknown error' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { action, organization_id } = body;

    if (!organization_id) return json({ error: 'organization_id is required' }, 400);

    // The service-role client acts on whatever org the body names, so the
    // caller must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    if (action === 'validate_and_store') {
      const { api_token } = body;
      if (!api_token || typeof api_token !== 'string' || api_token.length < 20) {
        return json({ error: 'api_token is required (Cloudflare tokens are 40+ chars)' }, 400);
      }

      const client = createCloudflareClient(api_token.trim());

      // Step 1: verify the token is live
      const verification = await client.verifyToken();
      if (!verification.valid) {
        return json(
          friendlyCloudflareError(new CloudflareError(1000, verification.error || 'Token is not active')),
          400,
        );
      }

      // Step 2: resolve the primary account. Two paths:
      //   (a) Token has Account:Read → /accounts returns one or more rows.
      //   (b) Token only has zone-scoped perms (the default "Edit zone DNS"
      //       template doesn't include Account:Read) → /accounts returns []
      //       or a 403. In that case fall back to reading the first zone the
      //       token can see; each zone embeds { account: { id, name } }.
      //
      // The fallback covers the common case where the user pasted a token from
      // CF's "Edit zone DNS" template, which is what we recommend in the dialog.
      let primaryAccount: { id: string; name: string } | null = null;
      try {
        const accounts = await client.listAccounts();
        if (accounts.length > 0) primaryAccount = accounts[0];
      } catch (err) {
        // 403/9109 (no permission to enumerate accounts) is expected for the
        // common token shape — fall through to the zone-based discovery below.
        const isPermErr = err instanceof CloudflareError && (err.status === 403 || err.code === 9109);
        if (!isPermErr) {
          console.warn('[dns-cloudflare-connect] listAccounts non-perm error:', err);
        }
      }
      if (!primaryAccount) {
        try {
          // Grab a single zone purely to read its account binding. We don't
          // need a name filter here — any zone the token can see works.
          const zones = await client.listZones();
          if (zones.length > 0 && zones[0].account?.id) {
            primaryAccount = { id: zones[0].account.id, name: zones[0].account.name };
          }
        } catch (err) {
          console.warn('[dns-cloudflare-connect] zone-based account discovery failed:', err);
        }
      }
      if (!primaryAccount) {
        return json({
          error_title: 'No Cloudflare zones found',
          error: 'The token is valid but the token can\'t see any zones or accounts. Most likely the token\'s "Zone Resources" scope is set to a specific zone you no longer own, or the token has no zone access at all.',
          next_steps: [
            'In Cloudflare → My Profile → API Tokens, open this token',
            'Under "Zone Resources" set it to "All zones" (or pick the zone for your sending domain)',
            'Save the token and re-paste it here',
          ],
        }, 400);
      }

      // Step 3: count zones — cheap signal to surface in the UI "we see N zones"
      let zoneCount = 0;
      try {
        zoneCount = await client.countZones();
      } catch (err) {
        // Non-fatal: token may not have zone read access yet, but the user can still
        // see the connection state and re-create the token with broader perms.
        console.warn('[dns-cloudflare-connect] zone count failed:', err);
      }

      // Step 4: encrypt + upsert. Unique constraint on (organization_id, provider)
      // means re-connect updates the existing row rather than creating a duplicate.
      const encryptedToken = await encryptValue(api_token.trim());

      const { data: upserted, error: upsertErr } = await supabase
        .from('dns_providers')
        .upsert(
          {
            organization_id,
            provider: 'cloudflare',
            account_id: primaryAccount.id,
            account_name: primaryAccount.name,
            api_token_encrypted: encryptedToken,
            token_permissions: { expires_on: verification.expires_on, not_before: verification.not_before },
            validated_at: new Date().toISOString(),
            last_error: null,
            zone_count: zoneCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,provider' },
        )
        .select('id, account_id, account_name, validated_at, zone_count')
        .single();

      if (upsertErr) {
        console.error('[dns-cloudflare-connect] upsert failed:', upsertErr);
        return json({ error: `Failed to store credentials: ${upsertErr.message}` }, 500);
      }

      return json({
        success: true,
        provider: upserted,
      });
    }

    if (action === 'disconnect') {
      const { error } = await supabase
        .from('dns_providers')
        .delete()
        .eq('organization_id', organization_id)
        .eq('provider', 'cloudflare');

      if (error) return json({ error: `Failed to disconnect: ${error.message}` }, 500);
      return json({ success: true, message: 'Cloudflare disconnected. Records already pushed to your zones remain in place.' });
    }

    if (action === 'status') {
      const { data: row, error } = await supabase
        .from('dns_providers')
        .select('id, organization_id, provider, account_id, account_name, validated_at, last_used_at, last_error, zone_count, token_permissions, created_at, updated_at, api_token_encrypted')
        .eq('organization_id', organization_id)
        .eq('provider', 'cloudflare')
        .maybeSingle();

      if (error) return json({ error: `Failed to read status: ${error.message}` }, 500);
      if (!row) return json({ connected: false });

      // If the credential is older than 24h, re-verify in the background.
      // Don't block the response on it — the UI can show stale status and
      // refresh on next call. We decrypt the token only when re-verifying.
      const staleMs = Date.now() - new Date(row.validated_at || row.created_at).getTime();
      const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
      let refreshed = row;
      if (staleMs > STALE_THRESHOLD_MS) {
        try {
          const { decryptValue } = await import('../_shared/encryption.ts');
          const token = await decryptValue(row.api_token_encrypted);
          const client = createCloudflareClient(token);
          const v = await client.verifyToken();
          const update = v.valid
            ? { validated_at: new Date().toISOString(), last_error: null }
            : { last_error: v.error || 'Token verification failed' };
          await supabase.from('dns_providers').update(update).eq('id', row.id);
          refreshed = { ...row, ...update };
        } catch (err) {
          // Decrypt or verify blew up entirely (e.g. ciphertext no longer decrypts
          // under the current key). This is NOT a transient hiccup to shrug off —
          // if we swallow it, `last_error` never gets set and the UI keeps
          // reporting `connected: true` indefinitely while every push silently fails.
          const message = err instanceof Error ? err.message : 'Background re-verify failed';
          console.warn('[dns-cloudflare-connect] background re-verify failed:', err);
          const update = { last_error: message };
          await supabase.from('dns_providers').update(update).eq('id', row.id);
          refreshed = { ...row, ...update };
        }
      }

      // Strip the encrypted token from the response — never expose it client-side.
      const { api_token_encrypted: _strip, ...safe } = refreshed;
      return json({ connected: true, provider: safe });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('[dns-cloudflare-connect] unhandled:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
