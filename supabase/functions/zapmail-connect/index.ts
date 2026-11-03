/**
 * ZapMail Connect Edge Function
 *
 * Actions:
 *  1. { action: "list_workspaces", key_id } — returns workspaces
 *  2. Default import: { key_id, organization_id, workspace_id? } — imports mailboxes
 *
 * API keys are stored in the shared `api_keys` table (provider='zapmail').
 * Key management (add/delete) is handled by the standard useAddApiKey/useDeleteApiKey flow.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  validateApiKey,
  listAllMailboxes,
  listWorkspaces,
  getStoredKeyById,
} from '../_shared/zapmail-client.ts';
import {
  encryptCredentials,
  type SMTPCredentials,
} from '../_shared/smtp-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Derive SMTP/IMAP credentials from a ZapMail mailbox.
 * ZapMail provisions Google Workspace mailboxes, so we use Gmail SMTP/IMAP settings.
 * Uses appPassword if available (for Google accounts with 2FA), otherwise falls back to password.
 */
function deriveCredentials(email: string, password: string, appPassword: string): SMTPCredentials {
  const pw = appPassword || password;
  return {
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_username: email,
    smtp_password: pw,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_username: email,
    imap_password: pw,
  };
}

/**
 * Resolve the API key from a stored key_id in the api_keys table.
 * The caller must be able to access the org that owns the key; the lookup by
 * id alone would hand any caller another org's ZapMail key.
 */
async function resolveApiKey(
  req: Request,
  supabase: any,
  body: Record<string, any>
): Promise<{ apiKey: string; keyId: string; keyOrgId: string }> {
  const keyId = body.keyId || body.key_id;

  if (!keyId) {
    throw new Error('key_id is required');
  }

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('organization_id')
    .eq('id', keyId)
    .eq('provider', 'zapmail')
    .maybeSingle();
  if (!keyRow) throw new Error('Stored API key not found');
  await assertOrgAccess(req, supabase, keyRow.organization_id);

  const stored = await getStoredKeyById(supabase, keyId);
  if (!stored) throw new Error('Stored API key not found');
  return { apiKey: stored.api_key, keyId, keyOrgId: keyRow.organization_id };
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
    const action = body.action;

    // ── Action: list_workspaces ────────────────────────────────────────
    if (action === 'list_workspaces') {
      const { apiKey } = await resolveApiKey(req, supabase, body);

      console.log('[ZapMail Connect] Listing workspaces...');

      const isValid = await validateApiKey(apiKey);
      if (!isValid) {
        return new Response(
          JSON.stringify({ error: 'Invalid ZapMail API key' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const workspaces = await listWorkspaces(apiKey);
      console.log(`[ZapMail Connect] Found ${workspaces.length} workspaces`);
      return new Response(
        JSON.stringify({ success: true, workspaces }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Default action: import mailboxes ───────────────────────────────
    const { apiKey, keyId, keyOrgId } = await resolveApiKey(req, supabase, body);
    const organizationId = body.organizationId || body.organization_id;
    const workspaceId = body.workspaceId || body.workspace_id || undefined;
    const workspaceName = body.workspaceName || body.workspace_name || null;

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: 'organization_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mailboxes (with their SMTP/IMAP passwords) are imported into organizationId,
    // so the key must belong to that same org.
    if (organizationId !== keyOrgId) {
      return unauthorized(new AuthError('This ZapMail key belongs to another organization', 403), corsHeaders);
    }

    console.log(`[ZapMail Connect] Connecting org ${organizationId}${workspaceId ? ` workspace ${workspaceId}` : ''}`);

    // Validate the API key
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid ZapMail API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update workspace_ids in api_keys metadata if needed
    if (workspaceId) {
      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('metadata')
        .eq('id', keyId)
        .single();

      const meta = keyRow?.metadata || {};
      const existingIds: string[] = meta.workspace_ids || [];
      if (!existingIds.includes(workspaceId)) {
        await supabase
          .from('api_keys')
          .update({ metadata: { ...meta, workspace_ids: [...existingIds, workspaceId] } })
          .eq('id', keyId);
      }
    }

    // Fetch mailboxes from ZapMail (scoped to workspace if provided)
    const zapMailboxes = await listAllMailboxes(apiKey, workspaceId);
    console.log(`[ZapMail Connect] Found ${zapMailboxes.length} mailboxes from ZapMail`);

    // Check which emails already exist for this org (with their metadata for merge)
    const { data: existingMailboxes } = await supabase
      .from('email_mailboxes')
      .select('email_address, metadata')
      .eq('organization_id', organizationId);

    const existingMap = new Map(
      (existingMailboxes || []).map((m: any) => [m.email_address.toLowerCase(), m.metadata || {}])
    );

    // Upsert each mailbox into our registry
    const importedMailboxes: Array<{ email: string; status: string }> = [];
    const updatedMailboxes: Array<{ email: string }> = [];
    const errors: string[] = [];

    for (const zm of zapMailboxes) {
      if (zm.status === 'EXPIRED' || zm.status === 'FAILED') {
        continue;
      }

      const isExisting = existingMap.has(zm.email.toLowerCase());

      // Guess provider from email domain (ZapMail provisions Google Workspace mailboxes)
      const domain = zm.email.split('@')[1]?.toLowerCase() || '';
      let provider: string;
      if (domain.includes('gmail') || domain.includes('googlemail')) {
        provider = 'gmail';
      } else if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live')) {
        provider = 'outlook';
      } else {
        provider = 'google';
      }

      const displayName = [zm.firstName, zm.lastName].filter(Boolean).join(' ') || null;

      // Derive and encrypt SMTP/IMAP credentials from ZapMail data
      let encryptedCreds: string | null = null;
      const creds = deriveCredentials(zm.email, zm.password, zm.appPassword);
      try {
        encryptedCreds = await encryptCredentials(creds);
      } catch (encErr) {
        console.error(`[ZapMail Connect] Failed to encrypt credentials for ${zm.email}:`, encErr);
      }

      const credentialMetadata = encryptedCreds ? {
        smtp_credentials: encryptedCreds,
        smtp_host: creds.smtp_host,
        smtp_port: creds.smtp_port,
        imap_host: creds.imap_host,
        imap_port: creds.imap_port,
      } : {};

      const zapmailMetadata = {
        zapmail_workspace_id: workspaceId || null,
        zapmail_workspace_name: workspaceName,
        zapmail_status: zm.status,
        zapmail_is_provisioned: zm.isWarmedUp,
        zapmail_domain_id: zm.domainId,
        zapmail_domain: zm.domain,
        zapmail_assigned_on: zm.assignedOn,
        zapmail_expire_on: zm.expireOn,
      };

      if (isExisting) {
        // For existing mailboxes: only update metadata (merge) and imap_connected — preserve user settings
        const existingMeta = existingMap.get(zm.email.toLowerCase()) || {};
        const mergedMeta = { ...existingMeta, ...zapmailMetadata, ...credentialMetadata };
        // Clean up legacy zapmail_api_key from metadata
        delete (mergedMeta as any).zapmail_api_key;

        const { error: updateError } = await supabase
          .from('email_mailboxes')
          .update({
            metadata: mergedMeta,
            zapmail_api_key_id: keyId,
            imap_connected: !!encryptedCreds,
            updated_at: new Date().toISOString(),
          })
          .eq('organization_id', organizationId)
          .eq('email_address', zm.email);

        if (updateError) {
          console.error(`[ZapMail Connect] Failed to update ${zm.email}:`, updateError.message);
          errors.push(`${zm.email}: ${updateError.message}`);
          continue;
        }

        updatedMailboxes.push({ email: zm.email });
      } else {
        // New mailbox: full insert
        const { error: insertError } = await supabase
          .from('email_mailboxes')
          .insert({
            organization_id: organizationId,
            zapmail_mailbox_id: zm.id,
            zapmail_api_key_id: keyId,
            connection_type: 'zapmail',
            email_address: zm.email,
            display_name: displayName,
            provider,
            status: 'ready',
            warmup_start_date: null,
            warmup_day: 0,
            daily_limit: 30,
            daily_sent: 0,
            health_score: 1.00,
            imap_connected: !!encryptedCreds,
            metadata: { ...zapmailMetadata, ...credentialMetadata },
            updated_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error(`[ZapMail Connect] Failed to insert ${zm.email}:`, insertError.message);
          errors.push(`${zm.email}: ${insertError.message}`);
          continue;
        }

        importedMailboxes.push({ email: zm.email, status: 'ready' });
      }
    }

    // Update last_sync_at in api_keys metadata
    const { data: currentKeyRow } = await supabase
      .from('api_keys')
      .select('metadata')
      .eq('id', keyId)
      .single();

    if (currentKeyRow) {
      await supabase
        .from('api_keys')
        .update({
          metadata: {
            ...(currentKeyRow.metadata || {}),
            last_sync_at: new Date().toISOString(),
          },
        })
        .eq('id', keyId);
    }

    console.log(`[ZapMail Connect] Imported ${importedMailboxes.length}, updated ${updatedMailboxes.length}, errors ${errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        imported: importedMailboxes.length,
        updated: updatedMailboxes.length,
        skipped: updatedMailboxes.length,
        mailboxes: importedMailboxes,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    if (error instanceof AuthError) return unauthorized(error, corsHeaders);
    console.error('[ZapMail Connect] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
