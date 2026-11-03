/**
 * Infrastructure Provision Mailboxes
 *
 * Creates and manages mailboxes (sender addresses) on email infrastructure.
 * For ACS domains: registers sender addresses via Azure Communication Services API.
 * For legacy postal domains: creates mailboxes on Azure VMs running Postfix/Dovecot.
 *
 * Actions:
 *   - generate_identities: AI-generate realistic mailbox identities
 *   - provision: Create mailboxes/sender addresses + insert into email_mailboxes
 *   - delete: Remove mailbox/sender address + mark disconnected
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getVMCredentials, createMailboxBatch, deleteMailbox } from '../_shared/postal-client.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { encryptJSON, decryptValue } from '../_shared/encryption.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { OpenRouterImageProvider } from '../_shared/providers/OpenRouterImageProvider.ts';
import { buildMailboxAvatarPrompt } from '../_shared/mailbox-avatar.ts';
import { getAzureToken } from '../_shared/azure-sdk.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import {
  createSenderAddress,
  deleteSenderAddress,
} from '../_shared/acs-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generatePassword(length = 24): string {
  // Alphanumeric only — avoids shell escaping issues with chpasswd/Azure RunCommand
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Build the email username from a name using the chosen pattern. */
function buildUsername(
  firstName: string,
  lastName: string,
  pattern: string
): string {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '');
  switch (pattern) {
    case 'firstname.lastname': return `${f}.${l}`;
    case 'f.lastname': return `${f.charAt(0)}.${l}`;
    case 'flastname': return `${f.charAt(0)}${l}`;
    case 'firstname_lastname': return `${f}_${l}`;
    case 'firstnamel': return `${f}${l.charAt(0)}`;
    case 'firstname': return f;
    default: return `${f}.${l}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { action } = body;

    // ── generate_identities ─────────────────────────────────────────
    // AI-generates realistic first/last names, job titles, and bios via OpenRouter
    if (action === 'generate_identities') {
      const { count, domain, company_name, company_industry, locale, organization_id } = body;
      const num = Math.min(Math.max(parseInt(count) || 10, 1), 150);

      if (!organization_id) {
        return jsonResponse({ error: 'organization_id is required' }, 400);
      }

      // The service-role client acts on whatever org the body names, so the caller
      // must be able to access it (a valid anon-key JWT alone is not enough).
      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Get org's OpenRouter API key
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      if (!encryptionKey) {
        return jsonResponse({ error: 'ENCRYPTION_KEY not configured' }, 500);
      }

      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', organization_id)
        .eq('provider', 'openrouter')
        .maybeSingle();

      if (!apiKeyData) {
        return jsonResponse({ error: 'OpenRouter API key not configured. Add it in Settings > API Keys.' }, 400);
      }

      let openRouterKey: string;
      try {
        openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      } catch {
        return jsonResponse({ error: 'Failed to decrypt OpenRouter API key' }, 500);
      }

      const prompt = `Generate exactly ${num} realistic email sender identities for a company's cold email outreach. Each person should feel like a real employee.

Company context:
- Domain: ${domain || 'a business domain'}
- Company name: ${company_name || 'not specified'}
- Industry: ${company_industry || 'technology/SaaS'}
- Name locale/region: ${locale || 'US English — mix of diverse backgrounds'}

For each identity generate:
- first_name: Realistic first name
- last_name: Realistic last name
- job_title: Realistic job title (vary between sales, marketing, partnerships, BD, account management, customer success — roles that naturally send outbound emails)
- bio: One short sentence describing their role (used in email signatures)

Rules:
- Make names diverse and realistic (mix of gender, ethnicity)
- Vary job titles — don't repeat the same title more than 3 times
- Keep titles at IC to mid-management level (no C-suite — those don't send cold emails)
- No duplicate first+last name combinations

Return ONLY a JSON array with no markdown formatting:
[{"first_name":"...","last_name":"...","job_title":"...","bio":"..."},...]`;

      const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_FAST_TEXT_MODEL,
          max_tokens: Math.min(16384, Math.max(4096, num * 120)),
          messages: [{
            role: 'user',
            content: prompt,
          }],
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error('[Infra Mailboxes] OpenRouter generation failed:', errText);
        return jsonResponse({ error: 'Failed to generate identities' }, 500);
      }

      const aiData = await aiResponse.json();
      const text = aiData.choices?.[0]?.message?.content || '[]';

      // Parse JSON from AI response (handle potential markdown wrapping and malformed entries)
      type Identity = { first_name: string; last_name: string; job_title: string; bio: string };
      let identities: Identity[];
      const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      try {
        identities = JSON.parse(jsonStr);
      } catch {
        // LLM sometimes produces malformed JSON — extract valid objects via regex
        const objectPattern = /\{[^{}]*?"first_name"\s*:\s*"([^"]+)"[^{}]*?"last_name"\s*:\s*"([^"]+)"[^{}]*?\}/g;
        identities = [];
        let match;
        while ((match = objectPattern.exec(jsonStr)) !== null) {
          try {
            // Try to parse each object individually
            const obj = JSON.parse(match[0]);
            if (obj.first_name && obj.last_name) {
              identities.push({
                first_name: obj.first_name,
                last_name: obj.last_name,
                job_title: obj.job_title || '',
                bio: obj.bio || '',
              });
            }
          } catch {
            // Extract fields manually from the match groups
            const jt = match[0].match(/"job_title"\s*:\s*"([^"]+)"/);
            const bio = match[0].match(/"bio"\s*:\s*"([^"]+)"/);
            identities.push({
              first_name: match[1],
              last_name: match[2],
              job_title: jt?.[1] || '',
              bio: bio?.[1] || '',
            });
          }
        }
        if (identities.length === 0) {
          console.error('[Infra Mailboxes] Failed to parse AI response:', jsonStr.substring(0, 500));
          return jsonResponse({ error: 'Failed to parse generated identities' }, 500);
        }
        console.warn(`[Infra Mailboxes] Recovered ${identities.length}/${num} identities from malformed JSON`);
      }

      return jsonResponse({ success: true, identities });
    }

    // ── generate_signatures ────────────────────────────────────────
    // Deterministic HTML email signatures from templates — no AI needed.
    if (action === 'generate_signatures') {
      const {
        identities: sigIdentities,
        organization_id,
        domain,
        company_name,
        company_website,
        style,
      } = body;

      if (!sigIdentities?.length || !organization_id || !domain) {
        return jsonResponse({ error: 'identities[], organization_id, and domain are required' }, 400);
      }

      if (!isServiceRoleRequest(req)) {
        try {
          await authenticateRequest(req, supabase);
        } catch (authErr) {
          return unauthorized(authErr, corsHeaders);
        }
      }

      const companyLabel = company_name || domain;
      const websiteUrl = company_website || `https://${domain}`;
      const websiteDisplay = websiteUrl.replace(/^https?:\/\//, '');

      function avatarCell(avatarUrl: string | undefined, size: number): string {
        if (!avatarUrl) return '';
        return `<td style="vertical-align:top;padding-right:12px">` +
          `<img src="${avatarUrl}" alt="" width="${size}" height="${size}" style="border-radius:50%;display:block;width:${size}px;height:${size}px;object-fit:cover" />` +
          `</td>`;
      }

      function buildSignature(
        id: { first_name: string; last_name: string; job_title?: string; email?: string; avatar_url?: string },
        signatureStyle: string,
      ): string {
        const name = `${id.first_name} ${id.last_name}`;
        const title = id.job_title || '';
        const email = id.email || `${id.first_name.toLowerCase()}.${id.last_name.toLowerCase()}@${domain}`;
        const avatar = id.avatar_url;

        if (signatureStyle === 'minimal') {
          return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#333">` +
            `<tr>` +
            avatarCell(avatar, 40) +
            `<td style="vertical-align:top">` +
            `<table cellpadding="0" cellspacing="0" border="0">` +
            `<tr><td style="font-size:14px;font-weight:700;padding-bottom:2px">${name}</td></tr>` +
            (title ? `<tr><td style="font-size:12px;color:#666;padding-bottom:4px">${title}</td></tr>` : '') +
            `<tr><td style="font-size:12px"><a href="mailto:${email}" style="color:#666;text-decoration:none">${email}</a></td></tr>` +
            `</table></td></tr></table>`;
        }

        if (signatureStyle === 'modern') {
          return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif">` +
            `<tr>` +
            avatarCell(avatar, 48) +
            `<td style="border-left:3px solid #3b82f6;padding-left:12px;vertical-align:top">` +
            `<table cellpadding="0" cellspacing="0" border="0">` +
            `<tr><td style="font-size:14px;font-weight:700;color:#1a1a1a;padding-bottom:2px">${name}</td></tr>` +
            (title ? `<tr><td style="font-size:12px;color:#6b7280;padding-bottom:6px">${title}${company_name ? ` · ${companyLabel}` : ''}</td></tr>` : '') +
            `<tr><td style="font-size:12px;color:#6b7280">` +
            `<a href="mailto:${email}" style="color:#3b82f6;text-decoration:none">${email}</a>` +
            (company_website ? ` · <a href="${websiteUrl}" style="color:#3b82f6;text-decoration:none">${websiteDisplay}</a>` : '') +
            `</td></tr>` +
            `</table></td></tr></table>`;
        }

        // Professional (default)
        return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif">` +
          `<tr>` +
          avatarCell(avatar, 52) +
          `<td style="vertical-align:top">` +
          `<table cellpadding="0" cellspacing="0" border="0">` +
          `<tr><td style="font-size:14px;font-weight:700;color:#1a1a1a;padding-bottom:2px">${name}</td></tr>` +
          (title ? `<tr><td style="font-size:12px;color:#555;padding-bottom:6px">${title}${company_name ? ` | ${companyLabel}` : ''}</td></tr>` : '') +
          `<tr><td style="border-top:1px solid #d1d5db;padding-top:6px;font-size:12px;color:#555">` +
          `<a href="mailto:${email}" style="color:#555;text-decoration:none">${email}</a>` +
          (company_website ? `<br><a href="${websiteUrl}" style="color:#555;text-decoration:none">${websiteDisplay}</a>` : '') +
          `</td></tr></table></td></tr></table>`;
      }

      const signatures = sigIdentities.map(
        (id: { first_name: string; last_name: string; job_title?: string; email?: string; avatar_url?: string }, i: number) => ({
          index: i,
          signature_html: buildSignature(id, style || 'professional'),
        })
      );

      return jsonResponse({
        success: true,
        signatures,
        generated: signatures.length,
      });
    }

    // ── generate_avatars ──────────────────────────────────────────
    // Uses the proven OpenRouterImageProvider to generate headshot avatars
    // and upload them to Supabase Storage.
    if (action === 'generate_avatars') {
      const { identities: avatarIdentities, organization_id } = body;

      if (!avatarIdentities?.length || !organization_id) {
        return jsonResponse({ error: 'identities[] and organization_id are required' }, 400);
      }

      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Get org's OpenRouter API key
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      if (!encryptionKey) {
        return jsonResponse({ error: 'ENCRYPTION_KEY not configured' }, 500);
      }

      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', organization_id)
        .eq('provider', 'openrouter')
        .maybeSingle();

      if (!apiKeyData) {
        return jsonResponse({ error: 'OpenRouter API key not configured. Add it in Settings > API Keys.' }, 400);
      }

      let openRouterKey: string;
      try {
        openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      } catch {
        return jsonResponse({ error: 'Failed to decrypt OpenRouter API key' }, 500);
      }

      const imageProvider = new OpenRouterImageProvider(openRouterKey);

      // Process all avatars in parallel (frontend sends small batches to avoid CPU limits)
      const results: Array<{ index: number; avatar_url: string | null; error?: string }> = [];

      const batchResults = await Promise.allSettled(
        avatarIdentities.map(async (identity: { first_name: string; last_name: string; job_title?: string }, index: number) => {
          const name = `${identity.first_name} ${identity.last_name}`;
          const title = identity.job_title || 'professional';

          const prompt = buildMailboxAvatarPrompt({
            displayName: name,
            jobTitle: title,
          });

          const publicUrl = await imageProvider.generateAndUpload(
            supabase,
            prompt,
            'google/gemini-3.1-flash-image-preview',
            {
              aspectRatio: '1:1',
              fileName: `mailbox-avatars/${organization_id}/${crypto.randomUUID()}.png`,
              bucket: 'avatars',
            }
          );

          return { index, avatar_url: publicUrl };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const failedIndex = batchResults.indexOf(result);
          console.error(`[Infra Mailboxes] Avatar generation failed for index ${failedIndex}:`, result.reason);
          results.push({ index: failedIndex, avatar_url: null, error: String(result.reason) });
        }
      }

      return jsonResponse({
        success: true,
        avatars: results,
        generated: results.filter((r) => r.avatar_url).length,
        failed: results.filter((r) => !r.avatar_url).length,
      });
    }

    // ── provision ───────────────────────────────────────────────────
    if (action === 'provision') {
      const { domain_id, organization_id, mailboxes, email_pattern, enable_warmup } = body;
      const pattern = email_pattern || 'firstname.lastname';

      if (!domain_id || !organization_id || !mailboxes?.length) {
        return jsonResponse({ error: 'domain_id, organization_id, and mailboxes[] are required' }, 400);
      }

      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Fetch domain with subscription
      const { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*, azure_subscriptions!inner(*)')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      if (domainRecord.vm_status !== 'running') {
        return jsonResponse({ error: 'Infrastructure is not ready' }, 400);
      }

      // Check capacity
      const remaining = domainRecord.max_mailboxes - domainRecord.mailbox_count;
      if (mailboxes.length > remaining) {
        return jsonResponse({
          error: `Cannot create ${mailboxes.length} mailboxes. Only ${remaining} slots remaining (${domainRecord.mailbox_count}/${domainRecord.max_mailboxes}).`,
        }, 400);
      }

      const sub = domainRecord.azure_subscriptions;
      const isAcs = domainRecord.infra_type === 'acs';
      const results: Array<{ username: string; email: string; success: boolean; error?: string }> = [];
      const createdMailboxIds: string[] = [];
      const usedUsernames = new Set<string>();

      // Phase 1: Prepare all mailbox data (usernames, display names)
      const prepared: Array<{
        username: string; password: string; displayName: string;
        email: string; firstName: string; lastName: string;
        mb: typeof mailboxes[0];
      }> = [];

      for (const mb of mailboxes) {
        const firstName = (mb.first_name || '').trim();
        const lastName = (mb.last_name || '').trim();
        let username: string;
        // The username reaches a root shell on the VM: keep it to a-z 0-9 . _ -
        const requestedUsername = (mb.username || '').toLowerCase().trim().replace(/[^a-z0-9._-]/g, '');

        if (requestedUsername) {
          username = requestedUsername;
        } else if (firstName && lastName) {
          username = buildUsername(firstName, lastName, pattern);
        } else {
          username = (mb.display_name || 'user').toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
        }

        let finalUsername = username;
        let counter = 2;
        while (usedUsernames.has(finalUsername)) {
          finalUsername = `${username}${counter}`;
          counter++;
        }
        usedUsernames.add(finalUsername);

        const displayName = mb.display_name || (firstName && lastName ? `${firstName} ${lastName}` : finalUsername);
        const password = mb.password || generatePassword();
        const email = `${finalUsername}@${domainRecord.domain}`;

        prepared.push({ username: finalUsername, password, displayName, email, firstName, lastName, mb });
      }

      // ── ACS Path: Register sender addresses via ACS API ────────────
      if (isAcs) {
        const clientSecret = await decryptValue(sub.client_secret_encrypted);
        const azureToken = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);

        // Decrypt the domain-level Entra app secret for SMTP credentials
        let entraAppSecret = '';
        if (domainRecord.acs_entra_app_secret_encrypted) {
          entraAppSecret = await decryptValue(domainRecord.acs_entra_app_secret_encrypted);
        }

        const warmupEnabled = enable_warmup === true;

        for (const p of prepared) {
          try {
            // Register sender address with ACS
            await createSenderAddress(
              azureToken,
              sub.subscription_id,
              domainRecord.acs_resource_group,
              domainRecord.acs_email_service_name,
              domainRecord.domain,
              p.username,
              p.displayName
            );

            // Build SMTP credentials (shared per domain via Entra ID app)
            const credentialsEncrypted = await encryptJSON({
              smtp_host: 'smtp.azurecomm.net',
              smtp_port: 587,
              smtp_username: domainRecord.acs_smtp_username,
              smtp_password: entraAppSecret,
              from_email: p.email,
              // No IMAP for ACS — inbound via webhook
            });

            const identityMeta: Record<string, unknown> = {
              smtp_credentials: credentialsEncrypted,
              provisioned_via: 'acs_infrastructure',
              sending_domain_id: domain_id,
              inbound_via: 'webhook',
            };
            if (p.firstName) identityMeta.first_name = p.firstName;
            if (p.lastName) identityMeta.last_name = p.lastName;
            if (p.mb.job_title) identityMeta.job_title = p.mb.job_title;
            if (p.mb.bio) identityMeta.bio = p.mb.bio;
            if (p.mb.avatar_url) identityMeta.avatar_url = p.mb.avatar_url;
            if (p.mb.signature_html) identityMeta.signature = p.mb.signature_html;

            const { data: mailboxRecord, error: insertError } = await supabase
              .from('email_mailboxes')
              .insert({
                organization_id,
                email_address: p.email,
                display_name: p.displayName,
                connection_type: 'acs',
                provider: 'smtp',
                status: warmupEnabled ? 'warming' : 'ready',
                // warmup_enabled is what the warmup engine actually reads
                // (email-warmup-send-tick filters on it). Without this the
                // mailbox showed a "Warming" badge and never sent warmup mail.
                warmup_enabled: warmupEnabled,
                sending_domain_id: domain_id,
                daily_limit: warmupEnabled ? 5 : 60,
                daily_sent: 0,
                health_score: 1.00,
                warmup_start_date: warmupEnabled ? new Date().toISOString() : null,
                warmup_day: warmupEnabled ? 0 : null,
                imap_connected: false,
                metadata: identityMeta,
              })
              .select('id')
              .single();

            if (insertError) throw new Error(insertError.message);

            createdMailboxIds.push(mailboxRecord.id);
            results.push({ username: p.username, email: p.email, success: true });

            await supabase.rpc('increment_mailbox_count', { domain_id_input: domain_id, delta: 1 });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create sender address';
            console.error(`[Infra Mailboxes] ACS sender address creation failed for ${p.email}:`, message);
            results.push({ username: p.username, email: p.email, success: false, error: message });
          }
        }

        // Update domain's sender_addresses array
        const currentSenders = domainRecord.sender_addresses || [];
        const newSenders = results
          .filter((r) => r.success)
          .map((r) => ({ username: r.username, displayName: prepared.find((p) => p.username === r.username)?.displayName || '', email: r.email }));
        await supabase
          .from('email_sending_domains')
          .update({ sender_addresses: [...currentSenders, ...newSenders], updated_at: new Date().toISOString() })
          .eq('id', domain_id);

        const created = results.filter((r) => r.success).length;
        return jsonResponse({
          success: true,
          created,
          failed: results.length - created,
          results,
          mailbox_ids: createdMailboxIds,
        });
      }

      // ── Postal/VM Path: Create mailboxes on VM via RunCommand ──────
      const creds = await getVMCredentials(sub, domainRecord.vm_name, domainRecord.metadata?.resource_group);

      // Phase 2: Create ALL mailboxes on VM in a single RunCommand call.
      const vmResults = await createMailboxBatch(
        creds,
        prepared.map((p) => ({ username: p.username, password: p.password, displayName: p.displayName }))
      );

      // Build a lookup of VM creation results
      const vmResultMap = new Map(vmResults.map((r) => [r.username, r]));

      // Phase 3: For each successfully created mailbox, insert into DB
      const warmupEnabled = enable_warmup === true;
      for (const p of prepared) {
        const vmResult = vmResultMap.get(p.username);
        if (!vmResult?.success) {
          const error = vmResult?.error || 'VM creation failed';
          console.error(`[Infra Mailboxes] Failed to create ${p.email}:`, error);
          results.push({ username: p.username, email: p.email, success: false, error });
          continue;
        }

        try {
          // Use mail.<domain> hostname instead of raw IP for TLS certificate matching
          const mailHostname = `mail.${domainRecord.domain}`;
          const credentialsEncrypted = await encryptJSON({
            smtp_host: mailHostname,
            smtp_port: 587,
            smtp_username: p.username,
            smtp_password: p.password,
            imap_host: mailHostname,
            imap_port: 993,
            imap_username: p.username,
            imap_password: p.password,
          });

          const identityMeta: Record<string, unknown> = {
            smtp_credentials: credentialsEncrypted,
            provisioned_via: 'azure_infrastructure',
            sending_domain_id: domain_id,
          };
          if (p.firstName) identityMeta.first_name = p.firstName;
          if (p.lastName) identityMeta.last_name = p.lastName;
          if (p.mb.job_title) identityMeta.job_title = p.mb.job_title;
          if (p.mb.bio) identityMeta.bio = p.mb.bio;
          if (p.mb.avatar_url) identityMeta.avatar_url = p.mb.avatar_url;
          if (p.mb.signature_html) identityMeta.signature = p.mb.signature_html;

          const { data: mailboxRecord, error: insertError } = await supabase
            .from('email_mailboxes')
            .insert({
              organization_id,
              email_address: p.email,
              display_name: p.displayName,
              connection_type: 'postal',
              provider: 'smtp',
              status: warmupEnabled ? 'warming' : 'ready',
              // See the ACS insert above: warmup_enabled drives the warmup mesh.
              warmup_enabled: warmupEnabled,
              sending_domain_id: domain_id,
              daily_limit: warmupEnabled ? 5 : 60,
              daily_sent: 0,
              health_score: 1.00,
              warmup_start_date: warmupEnabled ? new Date().toISOString() : null,
              warmup_day: warmupEnabled ? 0 : null,
              imap_connected: true,
              metadata: identityMeta,
            })
            .select('id')
            .single();

          if (insertError) throw new Error(insertError.message);

          createdMailboxIds.push(mailboxRecord.id);
          results.push({ username: p.username, email: p.email, success: true });

          await supabase.rpc('increment_mailbox_count', { domain_id_input: domain_id, delta: 1 });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to insert mailbox';
          console.error(`[Infra Mailboxes] DB insert failed for ${p.email}:`, message);
          results.push({ username: p.username, email: p.email, success: false, error: message });
        }
      }

      const created = results.filter((r) => r.success).length;
      return jsonResponse({
        success: true,
        created,
        failed: results.length - created,
        results,
        mailbox_ids: createdMailboxIds,
      });
    }

    // ── delete ──────────────────────────────────────────────────────
    if (action === 'delete') {
      const { mailbox_id, organization_id } = body;

      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Fetch mailbox
      const { data: mailbox, error: mbError } = await supabase
        .from('email_mailboxes')
        .select('*')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (mbError || !mailbox) {
        return jsonResponse({ error: 'Mailbox not found' }, 404);
      }

      if (!mailbox.sending_domain_id) {
        return jsonResponse({ error: 'Mailbox is not managed by Azure infrastructure' }, 400);
      }

      const username = mailbox.email_address.split('@')[0];

      // Fetch domain + subscription
      const { data: domainRecord } = await supabase
        .from('email_sending_domains')
        .select('*, azure_subscriptions!inner(*)')
        .eq('id', mailbox.sending_domain_id)
        .eq('organization_id', organization_id)
        .single();

      // Delete from infrastructure if domain is running
      if (domainRecord?.vm_status === 'running') {
        try {
          if (domainRecord.infra_type === 'acs' && domainRecord.acs_email_service_name) {
            // ACS: Delete sender address via API
            const sub = domainRecord.azure_subscriptions;
            const clientSecret = await decryptValue(sub.client_secret_encrypted);
            const azureToken = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
            await deleteSenderAddress(
              azureToken,
              sub.subscription_id,
              domainRecord.acs_resource_group,
              domainRecord.acs_email_service_name,
              domainRecord.domain,
              username
            );

            // Remove from sender_addresses array
            const currentSenders = (domainRecord.sender_addresses || []) as Array<{ username: string }>;
            const updatedSenders = currentSenders.filter((s) => s.username !== username);
            await supabase
              .from('email_sending_domains')
              .update({ sender_addresses: updatedSenders, updated_at: new Date().toISOString() })
              .eq('id', domainRecord.id);
          } else {
            // Postal/VM: Delete mailbox from VM via RunCommand
            const sub = domainRecord.azure_subscriptions;
            const creds = await getVMCredentials(sub, domainRecord.vm_name, domainRecord.metadata?.resource_group);
            await deleteMailbox(creds, username);
          }
        } catch (err) {
          console.error(`[Infra Mailboxes] Failed to delete ${username} from infrastructure:`, err);
        }
      }

      // Mark disconnected in DB
      await supabase
        .from('email_mailboxes')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('id', mailbox_id);

      // Decrement count atomically
      if (domainRecord) {
        await supabase.rpc('increment_mailbox_count', { domain_id_input: domainRecord.id, delta: -1 });
      }

      return jsonResponse({ success: true });
    }

    // ── fix-credentials ────────────────────────────────────────────
    // Backfill: update SMTP/IMAP credentials to use mail.<domain> hostname
    // instead of raw IP, so TLS certificate hostname matches.
    if (action === 'fix-credentials') {
      const { organization_id } = body;
      if (!organization_id) {
        return jsonResponse({ error: 'organization_id is required' }, 400);
      }

      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Get all infrastructure mailboxes with their domain info
      const { data: mailboxes, error: mbErr } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, metadata, sending_domain_id')
        .eq('organization_id', organization_id)
        .not('sending_domain_id', 'is', null);

      if (mbErr || !mailboxes?.length) {
        return jsonResponse({ error: 'No infrastructure mailboxes found' }, 404);
      }

      // Get domain info for each unique sending_domain_id
      const domainIds = [...new Set(mailboxes.map(m => m.sending_domain_id).filter(Boolean))];
      const { data: domains } = await supabase
        .from('email_sending_domains')
        .select('id, domain, public_ip')
        .in('id', domainIds)
        .eq('organization_id', organization_id);

      const domainMap = new Map((domains || []).map(d => [d.id, d]));

      let fixed = 0;
      let failed = 0;

      for (const mb of mailboxes) {
        const domain = domainMap.get(mb.sending_domain_id);
        if (!domain) { failed++; continue; }

        try {
          // Decrypt existing credentials
          const { decryptJSON } = await import('../_shared/encryption.ts');
          const existingCreds = await decryptJSON(mb.metadata?.smtp_credentials as string);
          if (!existingCreds) { failed++; continue; }

          const mailHostname = `mail.${domain.domain}`;

          // Skip if already using hostname
          if (existingCreds.smtp_host === mailHostname) {
            continue; // Already correct
          }

          // Re-encrypt with hostname instead of IP
          const updatedCreds = {
            ...existingCreds,
            smtp_host: mailHostname,
            imap_host: mailHostname,
          };
          const newEncrypted = await encryptJSON(updatedCreds);

          await supabase
            .from('email_mailboxes')
            .update({
              metadata: { ...mb.metadata, smtp_credentials: newEncrypted },
              updated_at: new Date().toISOString(),
            })
            .eq('id', mb.id);

          fixed++;
        } catch (err) {
          console.error(`[Fix Credentials] Failed for ${mb.email_address}:`, err);
          failed++;
        }
      }

      return jsonResponse({
        success: true,
        fixed,
        failed,
        total: mailboxes.length,
      });
    }

    // ── reset-passwords ─────────────────────────────────────────────
    // Reset passwords for mailboxes with missing or broken credentials.
    // Generates new passwords, sets them on the VM, and stores encrypted creds.
    if (action === 'reset-passwords') {
      const { organization_id, mailbox_ids } = body;
      if (!organization_id) {
        return jsonResponse({ error: 'organization_id is required' }, 400);
      }

      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Get mailboxes missing credentials or specific IDs
      let query = supabase
        .from('email_mailboxes')
        .select('id, email_address, metadata, sending_domain_id')
        .eq('organization_id', organization_id)
        .not('sending_domain_id', 'is', null);

      if (mailbox_ids?.length) {
        query = query.in('id', mailbox_ids);
      }

      const { data: mailboxes, error: mbErr } = await query;
      if (mbErr || !mailboxes?.length) {
        return jsonResponse({ error: 'No mailboxes found' }, 404);
      }

      // If mailbox_ids specified, reset those. Otherwise filter to missing creds only.
      const needsReset = mailbox_ids?.length
        ? mailboxes
        : mailboxes.filter((m: Record<string, unknown>) => !(m.metadata as Record<string, unknown>)?.smtp_credentials);
      if (!needsReset.length) {
        return jsonResponse({ success: true, message: 'All mailboxes already have credentials', reset: 0 });
      }

      // Get domain info
      const domainIds = [...new Set(needsReset.map(m => m.sending_domain_id).filter(Boolean))];
      const { data: resetDomains } = await supabase
        .from('email_sending_domains')
        .select('id, domain, vm_name, subscription_id, metadata')
        .in('id', domainIds)
        .eq('organization_id', organization_id);

      interface DomainInfo { id: string; domain: string; vm_name: string; subscription_id: string; metadata: Record<string, unknown> }
      const domainMap = new Map((resetDomains || []).map((d: DomainInfo) => [d.id, d]));

      let reset = 0;
      let failed = 0;
      const errors: string[] = [];

      // Group by domain for batch VM commands
      const byDomain = new Map<string, Array<{ id: string; email_address: string; metadata: Record<string, unknown>; sending_domain_id: string }>>();
      for (const mb of needsReset) {
        const list = byDomain.get(mb.sending_domain_id) || [];
        list.push(mb);
        byDomain.set(mb.sending_domain_id, list);
      }

      for (const [domainId, mbs] of byDomain) {
        const domainRecord = domainMap.get(domainId);
        if (!domainRecord) { failed += mbs.length; continue; }

        try {
          // Get Azure subscription for this domain
          const { data: sub } = await supabase
            .from('azure_subscriptions')
            .select('*')
            .eq('id', domainRecord.subscription_id)
            .single();

          if (!sub || sub.status !== 'connected') {
            errors.push(`Domain ${domainRecord.domain}: Azure subscription not connected`);
            failed += mbs.length;
            continue;
          }

          const creds = await getVMCredentials(sub, domainRecord.vm_name, domainRecord.metadata?.resource_group as string);
          const mailHostname = `mail.${domainRecord.domain}`;
          const { runCommandOnVM } = await import('../_shared/azure-sdk.ts');

          for (const mb of mbs) {
            try {
              const localPart = mb.email_address.split('@')[0];

              // Try to decrypt existing creds to get password, or generate new one
              let password: string;
              const existingEncrypted = (mb.metadata as Record<string, unknown>)?.smtp_credentials as string | undefined;
              if (existingEncrypted) {
                try {
                  const { decryptJSON } = await import('../_shared/encryption.ts');
                  const existing = await decryptJSON(existingEncrypted) as Record<string, unknown>;
                  password = (existing?.smtp_password as string) || crypto.randomUUID().replace(/-/g, '').substring(0, 24) + '!Aa1';
                } catch {
                  password = crypto.randomUUID().replace(/-/g, '').substring(0, 24) + '!Aa1';
                }
              } else {
                password = crypto.randomUUID().replace(/-/g, '').substring(0, 24) + '!Aa1';
              }

              // Reset password on VM to match what we have. The stored password can
              // come from a provision request, so it is single-quoted for the root shell.
              const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
              const result = await runCommandOnVM(
                creds.token, creds.subscriptionId, creds.resourceGroup, creds.vmName,
                [`echo ${shellQuote(`${localPart}:${password}`)} | chpasswd && echo ${shellQuote(`OK: Password reset for ${localPart}`)}`]
              );

              if (!result?.includes('OK:')) {
                errors.push(`${mb.email_address}: VM command failed`);
                failed++;
                continue;
              }

              // Store updated encrypted credentials with correct hostname
              const newEncryptedCreds = await encryptJSON({
                smtp_host: mailHostname,
                smtp_port: 587,
                smtp_username: localPart,
                smtp_password: password,
                imap_host: mailHostname,
                imap_port: 993,
                imap_username: localPart,
                imap_password: password,
              });

              await supabase
                .from('email_mailboxes')
                .update({
                  metadata: { ...(mb.metadata || {}), smtp_credentials: newEncryptedCreds },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', mb.id);

              reset++;
            } catch (err) {
              errors.push(`${mb.email_address}: ${err instanceof Error ? err.message : 'Unknown error'}`);
              failed++;
            }
          }
        } catch (err) {
          errors.push(`Domain ${domainRecord.domain}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          failed += mbs.length;
        }
      }

      return jsonResponse({ success: true, reset, failed, total: needsReset.length, errors: errors.length ? errors : undefined });
    }

    // ── diagnose ────────────────────────────────────────────────────
    // Run diagnostic checks on a domain's VM: port 25 outbound, mail queue,
    // Postfix config, and send a test email.
    if (action === 'diagnose') {
      const { domain_id, test_recipient } = body;
      if (!domain_id) {
        return jsonResponse({ error: 'domain_id is required' }, 400);
      }
      // test_recipient is interpolated into a shell command run as root on the VM.
      if (test_recipient && (typeof test_recipient !== 'string' || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(test_recipient))) {
        return jsonResponse({ error: 'test_recipient must be a valid email address' }, 400);
      }

      const { data: domainRecord } = await supabase
        .from('email_sending_domains')
        .select('*, azure_subscriptions!inner(*)')
        .eq('id', domain_id)
        .single();

      if (!domainRecord?.vm_name) {
        return jsonResponse({ error: 'Domain or VM not found' }, 404);
      }

      // The domain is loaded by a body-supplied id, so the caller must be able to
      // access the org that owns it.
      try {
        await assertOrgAccess(req, supabase, domainRecord.organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      const sub = domainRecord.azure_subscriptions;
      const creds = await getVMCredentials(sub, domainRecord.vm_name, domainRecord.metadata?.resource_group);
      const { runCommandOnVM } = await import('../_shared/azure-sdk.ts');

      // Run comprehensive diagnostics as a single script to avoid && chain issues
      const diagScript = `
echo "=== SERVICE STATUS ==="
echo "postfix: $(systemctl is-active postfix 2>/dev/null)"
echo "dovecot: $(systemctl is-active dovecot 2>/dev/null)"
echo "opendkim: $(systemctl is-active opendkim 2>/dev/null)"
echo "=== POSTFIX CONFIG ==="
postconf relayhost 2>/dev/null || echo "no relayhost"
postconf myhostname 2>/dev/null
postconf mydomain 2>/dev/null
echo "=== LISTENING PORTS ==="
ss -tlnp 2>/dev/null | grep -E ':(25|587|993|143) ' || echo "no email ports"
echo "=== MAIL QUEUE ==="
mailq 2>/dev/null | tail -5 || echo "empty queue"
echo "=== PORT 25 OUTBOUND ==="
(echo QUIT | nc -w 5 gmail-smtp-in.l.google.com 25 2>/dev/null && echo "PORT_25_OUTBOUND_OPEN") || echo "PORT_25_OUTBOUND_BLOCKED"
echo "=== PORT 587 OUTBOUND ==="
(echo QUIT | nc -w 5 smtp.gmail.com 587 2>/dev/null && echo "PORT_587_OUTBOUND_OPEN") || echo "PORT_587_OUTBOUND_BLOCKED"
echo "=== MASTER.CF SUBMISSION ==="
grep -A5 '^submission' /etc/postfix/master.cf 2>/dev/null || echo "no submission port configured"
echo "=== MAIL LOG (last 30) ==="
tail -30 /var/log/mail.log 2>/dev/null || journalctl -u postfix --no-pager -n 30 2>/dev/null || echo "no mail logs"
echo "=== TLS CERT ==="
postconf smtpd_tls_cert_file 2>/dev/null
ls -la $(postconf -h smtpd_tls_cert_file 2>/dev/null) 2>/dev/null || echo "cert missing"
`;
      const diagCommands = [diagScript];

      let diagOutput: string;
      try {
        diagOutput = await runCommandOnVM(
          creds.token, creds.subscriptionId, creds.resourceGroup, creds.vmName,
          [diagCommands.join(' && ')]
        );
      } catch (err) {
        return jsonResponse({ error: `VM command failed: ${err instanceof Error ? err.message : 'Unknown'}` }, 500);
      }

      // If test_recipient provided, send a test email from the VM
      let sendTestResult: string | undefined;
      if (test_recipient) {
        try {
          const testCmd = `echo "Subject: ACA Diagnostic Test $(date +%s)\nFrom: postmaster@${domainRecord.domain}\nTo: ${test_recipient}\n\nThis is a diagnostic test email from ${domainRecord.domain} sent at $(date)." | sendmail -v "${test_recipient}" 2>&1 | tail -30`;
          sendTestResult = await runCommandOnVM(
            creds.token, creds.subscriptionId, creds.resourceGroup, creds.vmName,
            [testCmd]
          );
        } catch (err) {
          sendTestResult = `Send test failed: ${err instanceof Error ? err.message : 'Unknown'}`;
        }
      }

      return jsonResponse({
        success: true,
        domain: domainRecord.domain,
        vm_name: domainRecord.vm_name,
        public_ip: domainRecord.public_ip,
        diagnostics: diagOutput,
        send_test: sendTestResult || undefined,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[Infra Provision Mailboxes] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
