/**
 * Publishing destinations for the Scheduler (/scheduler) that don't go through GHL. Read only.
 * - Every active LinkedIn account the org connected through Unipile, as its member profile and
 *   each company page it manages ("unipile:<unipile_accounts.id>:profile|<page id>", published by
 *   publish-to-linkedin, which re-checks page access before posting).
 * - Every healthy account in the org's own Zernio workspace when it saved a Zernio API key
 *   ("zernio:<Zernio account id>", published by publish-to-zernio).
 *
 * POST { organization_id }
 * → { success, destinations: [{ id, provider, platform, name, username?, avatar_url?, kind, account_name }], errors: [],
 *     zernio: { key, total?, listed?, skipped?: [{ platform, name, reason }] } }
 *
 * A failing LinkedIn account only drops its pages (the profile still lists); a failing Zernio key
 * drops its accounts. Both are reported in `errors`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { createUnipileClientFromAccount } from '../_shared/unipile-client.ts';
import { createLinkedInDestination, getLinkedInManagedPages } from '../_shared/linkedin-identity.ts';
import { UnipileV2Client } from '../_shared/unipile/v2-client.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { listCompanyPagesV2 } from '../_shared/unipile/posts-v2.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { createZernioDestination, listZernioAccounts } from '../_shared/zernio.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

interface Destination {
  id: string;
  provider: 'unipile' | 'zernio';
  platform: string;
  name: string;
  username?: string;
  avatar_url?: string;
  kind: 'profile' | 'page' | 'account';
  account_name: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400); }
  const orgId = typeof body.organization_id === 'string' ? body.organization_id : '';
  try {
    await assertOrgAccess(req, supabase, orgId);
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }

  const { data: accounts, error } = await supabase.from('unipile_accounts')
    .select('id, unipile_account_id, display_name, first_name, last_name, avatar_url, api_version, access_token_encrypted, dsn_url')
    .eq('organization_id', orgId).eq('provider', 'LINKEDIN').eq('status', 'active');
  if (error) return json({ success: false, error: 'Could not load LinkedIn accounts' }, 500);

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY') ?? '';
  const destinations: Destination[] = [];
  const errors: Array<{ account: string; error: string }> = [];

  // What the org's Zernio key returned, so the Scheduler can say why an account is missing.
  let zernioSummary: { key: boolean; total?: number; listed?: number; skipped?: unknown[] } = { key: false };
  const zernio = (async () => {
    const stored = await resolveApiKey(supabase, orgId, 'zernio');
    if (!stored) return;
    zernioSummary = { key: true };
    try {
      const apiKey = await decryptApiKey(stored.key_encrypted, encryptionKey);
      const listed = await listZernioAccounts(apiKey);
      zernioSummary = { key: true, total: listed.total, listed: listed.accounts.length, skipped: listed.skipped };
      for (const a of listed.accounts) {
        destinations.push({
          id: createZernioDestination(a.id),
          provider: 'zernio',
          platform: a.platform,
          name: a.name,
          ...(a.username ? { username: a.username } : {}),
          ...(a.avatar_url ? { avatar_url: a.avatar_url } : {}),
          kind: 'account',
          account_name: 'Zernio',
        });
      }
    } catch (err) {
      errors.push({ account: 'Zernio', error: err instanceof Error ? err.message.slice(0, 200) : 'Could not list Zernio accounts' });
    }
  })();

  await Promise.all([zernio, ...(accounts ?? []).map(async (acc) => {
    const accountName = acc.display_name || [acc.first_name, acc.last_name].filter(Boolean).join(' ') || 'LinkedIn account';
    let profileId: string;
    try {
      profileId = createLinkedInDestination(acc.id);
    } catch {
      return;
    }
    destinations.push({ id: profileId, provider: 'unipile', platform: 'linkedin', name: accountName, ...(acc.avatar_url ? { avatar_url: acc.avatar_url } : {}), kind: 'profile', account_name: accountName });
    try {
      const pages = acc.api_version === 'v2'
        ? await listCompanyPagesV2(new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(acc, encryptionKey) }), acc.unipile_account_id)
        : await getLinkedInManagedPages(await createUnipileClientFromAccount({ accessTokenEncrypted: acc.access_token_encrypted, dsnUrl: acc.dsn_url }, encryptionKey), acc.unipile_account_id);
      for (const page of pages) {
        try {
          destinations.push({
            id: createLinkedInDestination(acc.id, page.id),
            provider: 'unipile',
            platform: 'linkedin',
            name: page.name,
            ...('avatar_url' in page && page.avatar_url ? { avatar_url: page.avatar_url as string } : {}),
            kind: 'page',
            account_name: accountName,
          });
        } catch { /* non-numeric page id: skip it */ }
      }
    } catch (err) {
      // Never log SDK objects: their request metadata can contain credential headers.
      errors.push({ account: accountName, error: err instanceof Error ? err.message.slice(0, 200) : 'Could not list company pages' });
    }
  })]);

  destinations.sort((a, b) =>
    a.provider.localeCompare(b.provider) || a.platform.localeCompare(b.platform) || a.account_name.localeCompare(b.account_name)
    || (a.kind === 'profile' ? -1 : 1) - (b.kind === 'profile' ? -1 : 1) || a.name.localeCompare(b.name));
  return json({ success: true, destinations, errors, zernio: zernioSummary });
});
