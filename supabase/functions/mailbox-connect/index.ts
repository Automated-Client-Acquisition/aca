/**
 * Mailbox Connect Edge Function
 *
 * Generic mailbox connection endpoint supporting:
 *  1. { action: "smtp_test", ...creds } — test SMTP connection
 *  2. { action: "smtp_add", organization_id, ...creds } — add single SMTP mailbox
 *  3. { action: "csv_import", organization_id, csv_data } — bulk CSV import
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  testSMTPConnection,
  testIMAPConnection,
  encryptCredentials,
  extractSMTPCredentials,
  type SMTPCredentials,
} from '../_shared/smtp-client.ts';
import { getVMCredentials, testMailboxAuth } from '../_shared/postal-client.ts';
import { parse } from 'npm:csv-parse@^5/sync';
import { requireFeature } from '../_shared/featureAccess.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * The service-role client acts on whatever org or mailbox the body names, so
 * the caller must be able to access that org (a valid anon-key JWT alone is
 * not enough). Returns the 401/403 response to send, or null when allowed.
 */
async function denyUnlessOrgAccess(
  req: Request,
  supabase: any,
  organizationId: string | null | undefined,
): Promise<Response | null> {
  try {
    await assertOrgAccess(req, supabase, organizationId);
    return null;
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }
}

// ============================================================================
// Provider Detection
// ============================================================================

function detectProvider(email: string): 'gmail' | 'outlook' | 'smtp' {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  if (domain.includes('gmail') || domain.includes('googlemail')) return 'gmail';
  if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live') || domain.includes('microsoft')) return 'outlook';
  return 'smtp';
}

// ============================================================================
// Main Handler
// ============================================================================

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

    // The test actions touch no org data but open connections to any host the
    // body names, so they still need a signed-in caller.
    if ((action === 'smtp_test' || action === 'imap_test') && !isServiceRoleRequest(req)) {
      try {
        await authenticateRequest(req, supabase);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
    }

    // ── Action: smtp_test ──────────────────────────────────────────────
    if (action === 'smtp_test') {
      const creds: SMTPCredentials = {
        smtp_host: body.smtp_host,
        smtp_port: Number(body.smtp_port) || 587,
        smtp_username: body.smtp_username,
        smtp_password: body.smtp_password,
      };

      if (!creds.smtp_host || !creds.smtp_username || !creds.smtp_password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required SMTP fields (host, username, password)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Mailbox Connect] Testing SMTP: ${creds.smtp_host}:${creds.smtp_port}`);
      const result = await testSMTPConnection(creds);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Action: imap_test ─────────────────────────────────────────────
    if (action === 'imap_test') {
      const creds: SMTPCredentials = {
        smtp_host: '',
        smtp_port: 0,
        smtp_username: '',
        smtp_password: '',
        imap_host: body.imap_host,
        imap_port: Number(body.imap_port) || 993,
        imap_username: body.imap_username,
        imap_password: body.imap_password,
      };

      if (!creds.imap_host || !creds.imap_username || !creds.imap_password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required IMAP fields (host, username, password)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Mailbox Connect] Testing IMAP: ${creds.imap_host}:${creds.imap_port}`);
      const result = await testIMAPConnection(creds);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Action: smtp_add ───────────────────────────────────────────────
    if (action === 'smtp_add') {
      const organizationId = body.organization_id;
      if (!organizationId) {
        return new Response(
          JSON.stringify({ error: 'organization_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const denied = await denyUnlessOrgAccess(req, supabase, organizationId);
      if (denied) return denied;

      // Require email_campaigns feature
      await requireFeature(supabase, organizationId, 'email_campaigns');

      const fromEmail = body.from_email;
      const fromName = body.from_name || '';
      if (!fromEmail) {
        return new Response(
          JSON.stringify({ error: 'from_email is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const creds: SMTPCredentials = {
        smtp_host: body.smtp_host,
        smtp_port: Number(body.smtp_port) || 587,
        smtp_username: body.smtp_username,
        smtp_password: body.smtp_password,
        imap_host: body.imap_host || undefined,
        imap_port: body.imap_port ? Number(body.imap_port) : undefined,
        imap_username: body.imap_username || undefined,
        imap_password: body.imap_password || undefined,
      };

      if (!creds.smtp_host || !creds.smtp_username || !creds.smtp_password) {
        return new Response(
          JSON.stringify({ error: 'Missing required SMTP fields (host, username, password)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // IMAP is required for reply detection
      if (!creds.imap_host || !creds.imap_username || !creds.imap_password) {
        return new Response(
          JSON.stringify({ error: 'Missing required IMAP fields (host, username, password). IMAP is needed to receive email replies.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Mailbox Connect] Adding SMTP mailbox: ${fromEmail}`);

      // Test SMTP connection
      const testResult = await testSMTPConnection(creds);
      if (!testResult.success) {
        return new Response(
          JSON.stringify({ error: `SMTP connection failed: ${testResult.error}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test IMAP connection
      const imapResult = await testIMAPConnection(creds);
      if (!imapResult.success) {
        return new Response(
          JSON.stringify({ error: `IMAP connection failed: ${imapResult.error}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Encrypt credentials
      const encryptedCreds = await encryptCredentials(creds);

      // Upsert mailbox
      const { data: mailbox, error: upsertError } = await supabase
        .from('email_mailboxes')
        .upsert({
          organization_id: organizationId,
          email_address: fromEmail.toLowerCase(),
          display_name: fromName || null,
          provider: detectProvider(fromEmail),
          connection_type: 'smtp',
          zapmail_mailbox_id: null,
          status: 'ready',
          warmup_start_date: null,
          warmup_day: 0,
          daily_limit: 30,
          daily_sent: 0,
          health_score: 1.00,
          imap_connected: true,
          metadata: {
            smtp_credentials: encryptedCreds,
            smtp_host: creds.smtp_host,
            smtp_port: creds.smtp_port,
            imap_host: creds.imap_host || null,
            imap_port: creds.imap_port || null,
          },
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id,email_address',
        })
        .select()
        .single();

      if (upsertError) {
        console.error(`[Mailbox Connect] Upsert failed for ${fromEmail}:`, upsertError.message);
        return new Response(
          JSON.stringify({ error: `Failed to save mailbox: ${upsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          mailbox: {
            id: mailbox.id,
            email: mailbox.email_address,
            status: mailbox.status,
            connection_type: 'smtp',
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Action: csv_import ─────────────────────────────────────────────
    if (action === 'csv_import') {
      const organizationId = body.organization_id;
      const csvData = body.csv_data;

      if (!organizationId) {
        return new Response(
          JSON.stringify({ error: 'organization_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const denied = await denyUnlessOrgAccess(req, supabase, organizationId);
      if (denied) return denied;

      // Require email_campaigns feature
      await requireFeature(supabase, organizationId, 'email_campaigns');

      if (!csvData || typeof csvData !== 'string') {
        return new Response(
          JSON.stringify({ error: 'csv_data is required (string)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Mailbox Connect] CSV import for org ${organizationId}`);

      let records: Record<string, string>[];
      try {
        records = parse(csvData, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });
      } catch (parseError) {
        return new Response(
          JSON.stringify({ error: `CSV parse error: ${parseError instanceof Error ? parseError.message : 'Invalid CSV'}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (records.length === 0) {
        return new Response(
          JSON.stringify({ error: 'CSV contains no data rows' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check existing mailboxes
      const { data: existingMailboxes } = await supabase
        .from('email_mailboxes')
        .select('email_address')
        .eq('organization_id', organizationId);

      const existingEmails = new Set(
        (existingMailboxes || []).map((m: any) => m.email_address.toLowerCase())
      );

      const imported: Array<{ email: string; status: string; verified: boolean; error?: string }> = [];
      const skipped: string[] = [];
      const errors: string[] = [];

      // ── Pass 1: validate + dedupe rows into a work list ──
      interface PreparedRow {
        rowNum: number;
        fromEmail: string;
        fromName: string;
        creds: SMTPCredentials;
        maxEmailPerDay: number;
        signature: string;
      }
      const prepared: PreparedRow[] = [];

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2; // +2 for header row + 0-index

        // Map Smartlead CSV columns to our fields
        const fromEmail = (row.from_email || row.email || '').trim().toLowerCase();
        const fromName = (row.from_name || row.name || '').trim();
        const smtpHost = (row.smtp_host || '').trim();
        const smtpPort = parseInt(row.smtp_port || '587', 10);
        const smtpUsername = (row.user_name || row.username || row.smtp_username || fromEmail).trim();
        const smtpPassword = (row.password || row.smtp_password || '').trim();
        const imapHost = (row.imap_host || '').trim();
        const imapPort = parseInt(row.imap_port || '993', 10);
        const imapUsername = (row.imap_user_name || row.imap_username || '').trim();
        const imapPassword = (row.imap_password || '').trim();
        const maxEmailPerDay = parseInt(row.max_email_per_day || '0', 10);
        const signature = (row.signature || '').trim();

        // Validate required fields
        if (!fromEmail || !fromEmail.includes('@')) {
          errors.push(`Row ${rowNum}: missing or invalid email address`);
          continue;
        }

        if (!smtpHost) {
          errors.push(`Row ${rowNum} (${fromEmail}): missing smtp_host`);
          continue;
        }

        if (!smtpPassword) {
          errors.push(`Row ${rowNum} (${fromEmail}): missing password`);
          continue;
        }

        // IMAP is required for reply detection
        if (!imapHost) {
          errors.push(`Row ${rowNum} (${fromEmail}): missing imap_host (IMAP is required for reply detection)`);
          continue;
        }

        if (!imapPassword) {
          errors.push(`Row ${rowNum} (${fromEmail}): missing imap_password (IMAP is required for reply detection)`);
          continue;
        }

        // Skip if already exists (or duplicated within the CSV)
        if (existingEmails.has(fromEmail)) {
          skipped.push(fromEmail);
          continue;
        }
        existingEmails.add(fromEmail);

        prepared.push({
          rowNum,
          fromEmail,
          fromName,
          maxEmailPerDay,
          signature,
          creds: {
            smtp_host: smtpHost,
            smtp_port: smtpPort,
            smtp_username: smtpUsername,
            smtp_password: smtpPassword,
            imap_host: imapHost || undefined,
            imap_port: imapHost ? imapPort : undefined,
            imap_username: imapUsername || undefined,
            imap_password: imapPassword || undefined,
          },
        });
      }

      // ── Pass 2: upsert each prepared row as 'pending' (unverified) ──
      // We do NOT block the request on SMTP/IMAP probes — a large CSV would blow
      // past the 150s edge-function limit. Instead every row is imported honestly
      // as 'pending' / imap_connected=false (so it's excluded from sending until
      // proven), then verified in the background (below) and by the
      // auto-retest-disconnected cron as a safety net for any size of import.
      const toVerify: Array<{ id: string; creds: SMTPCredentials }> = [];

      for (const p of prepared) {
        const { rowNum, fromEmail, fromName, creds, maxEmailPerDay, signature } = p;
        try {
          const encryptedCreds = await encryptCredentials(creds);
          const dailyLimit = maxEmailPerDay || 50;

          const { data: row, error: upsertError } = await supabase
            .from('email_mailboxes')
            .upsert({
              organization_id: organizationId,
              email_address: fromEmail,
              display_name: fromName || null,
              provider: detectProvider(fromEmail),
              connection_type: 'smtp',
              zapmail_mailbox_id: null,
              status: 'pending',
              warmup_start_date: null,
              warmup_day: 0,
              daily_limit: dailyLimit,
              daily_sent: 0,
              health_score: 0.50,
              imap_connected: false,
              metadata: {
                smtp_credentials: encryptedCreds,
                smtp_host: creds.smtp_host,
                smtp_port: creds.smtp_port,
                imap_host: creds.imap_host || null,
                imap_port: creds.imap_port || null,
                csv_imported: true,
                max_email_per_day: maxEmailPerDay || null,
                signature: signature || null,
                needs_connection_test: true,
              },
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'organization_id,email_address',
            })
            .select('id')
            .single();

          if (upsertError || !row) {
            errors.push(`Row ${rowNum} (${fromEmail}): ${upsertError?.message || 'upsert returned no row'}`);
            continue;
          }

          imported.push({ email: fromEmail, status: 'pending', verified: false });
          toVerify.push({ id: row.id, creds });
        } catch (err) {
          errors.push(`Row ${rowNum} (${fromEmail}): ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      // ── Background verification ──
      // Probe SMTP + IMAP for each imported mailbox after the response returns, in
      // small concurrent batches, flipping each to 'ready' or 'disconnected'. Uses
      // EdgeRuntime.waitUntil so it survives past the response without holding the
      // client. Anything this pass can't finish (very large imports) stays 'pending'
      // and is recovered by the auto-retest-disconnected cron (every 10 min).
      if (toVerify.length > 0) {
        const VERIFY_BATCH_SIZE = 5;
        const verifyAll = async () => {
          for (let i = 0; i < toVerify.length; i += VERIFY_BATCH_SIZE) {
            const batch = toVerify.slice(i, i + VERIFY_BATCH_SIZE);
            await Promise.all(batch.map(async ({ id, creds }) => {
              try {
                const smtpResult = await testSMTPConnection(creds);
                const imapResult = smtpResult.success
                  ? await testIMAPConnection(creds)
                  : { success: false, error: undefined as string | undefined };

                if (smtpResult.success && imapResult.success) {
                  await supabase
                    .from('email_mailboxes')
                    .update({
                      status: 'ready',
                      imap_connected: true,
                      health_score: 1.00,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);
                } else {
                  const reason = !smtpResult.success ? 'smtp_test_failed' : 'imap_test_failed';
                  const detail = !smtpResult.success
                    ? `SMTP: ${smtpResult.error || 'connection failed'}`
                    : `IMAP: ${imapResult.error || 'connection failed'}`;
                  // Re-read metadata to preserve creds while flagging the failure.
                  const { data: cur } = await supabase
                    .from('email_mailboxes')
                    .select('metadata')
                    .eq('id', id)
                    .single();
                  const meta = { ...((cur?.metadata as Record<string, unknown>) || {}) };
                  delete meta.needs_connection_test;
                  meta.disconnected_reason = reason;
                  meta.disconnected_at = new Date().toISOString();
                  meta.disconnected_error = detail;
                  await supabase
                    .from('email_mailboxes')
                    .update({
                      status: 'disconnected',
                      imap_connected: false,
                      health_score: 0,
                      last_error: detail,
                      metadata: meta,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);
                }
              } catch (err) {
                console.warn(`[Mailbox Connect] Background verify error for mailbox ${id}: ${err instanceof Error ? err.message : err}`);
              }
            }));
          }
          console.log(`[Mailbox Connect] CSV background verification done for ${toVerify.length} mailboxes`);
        };

        const work = verifyAll().catch((err) => {
          console.error('[Mailbox Connect] CSV background verification failed:', err);
        });
        try {
          (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work);
        } catch { /* not available locally — verification falls back to the cron */ }
      }

      console.log(
        `[Mailbox Connect] CSV import: ${imported.length} imported (pending — verifying in background), ` +
        `${skipped.length} skipped, ${errors.length} errors`
      );

      return new Response(
        JSON.stringify({
          success: true,
          imported: imported.length,
          // At response time every imported row is still pending; statuses resolve
          // in the background and surface in the Mailboxes list as they complete.
          verified: 0,
          failed: 0,
          unverified: imported.length,
          verifying: imported.length > 0,
          skipped: skipped.length,
          mailboxes: imported,
          errors,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Action: connection_retest ───────────────────────────────────────
    // Also supports legacy "imap_retest" for backwards compatibility
    if (action === 'connection_retest' || action === 'imap_retest') {
      const mailboxId = body.mailbox_id;
      if (!mailboxId) {
        return new Response(
          JSON.stringify({ success: false, error: 'mailbox_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch mailbox metadata
      const { data: mailbox, error: fetchErr } = await supabase
        .from('email_mailboxes')
        .select('id, organization_id, email_address, metadata, imap_connected, status, connection_type, sending_domain_id')
        .eq('id', mailboxId)
        .single();

      if (fetchErr || !mailbox) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mailbox not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const denied = await denyUnlessOrgAccess(req, supabase, mailbox.organization_id);
      if (denied) return denied;

      console.log(`[Mailbox Connect] Connection retest for ${mailbox.email_address} (type: ${mailbox.connection_type})`);

      // ── M365 mailboxes: test SMTP + Graph API (not IMAP) ──
      if (mailbox.connection_type === 'm365') {
        console.log(`[Mailbox Connect] M365 mailbox ${mailbox.email_address} — testing SMTP + Graph`);

        // 1. Test SMTP
        let smtpOk = false;
        let smtpError: string | undefined;
        const creds = await extractSMTPCredentials(mailbox.metadata || {});
        if (creds?.smtp_host && creds?.smtp_username && creds?.smtp_password) {
          const smtpResult = await testSMTPConnection(creds);
          smtpOk = smtpResult.success;
          smtpError = smtpResult.error;
          console.log(`[Mailbox Connect] M365 SMTP test for ${mailbox.email_address}: ${smtpOk ? 'OK' : smtpError}`);
        } else {
          smtpError = 'No SMTP credentials found';
        }

        // 2. Test Graph API — get token + read inbox
        let graphOk = false;
        let graphError: string | undefined;
        try {
          const meta = mailbox.metadata as Record<string, unknown>;
          const m365UserId = meta.m365_user_id as string | undefined;

          // Resolve the tenant_id from domain → m365_tenants
          const { data: domainRow } = await supabase
            .from('email_sending_domains')
            .select('m365_tenant_id')
            .eq('id', mailbox.sending_domain_id)
            .single();

          if (!domainRow?.m365_tenant_id) {
            graphError = 'No M365 tenant linked to this domain';
          } else {
            const { data: tenantRow } = await supabase
              .from('m365_tenants')
              .select('tenant_id')
              .eq('id', domainRow.m365_tenant_id)
              .single();

            if (!tenantRow?.tenant_id) {
              graphError = 'M365 tenant not found';
            } else {
              const { getM365Token } = await import('../_shared/m365-client.ts');
              const token = await getM365Token(tenantRow.tenant_id);
              const userEncoded = encodeURIComponent(m365UserId || mailbox.email_address);
              const res = await fetch(
                `https://graph.microsoft.com/v1.0/users/${userEncoded}/mailFolders/inbox?$select=id,displayName,totalItemCount`,
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
              );
              if (res.ok) {
                graphOk = true;
                console.log(`[Mailbox Connect] M365 Graph test for ${mailbox.email_address}: OK`);
              } else {
                const body = await res.text();
                graphError = `Graph API ${res.status}: ${body.substring(0, 200)}`;
                console.log(`[Mailbox Connect] M365 Graph test for ${mailbox.email_address}: ${graphError}`);
              }
            }
          }
        } catch (err) {
          graphError = err instanceof Error ? err.message : 'Graph API test failed';
          console.error(`[Mailbox Connect] M365 Graph test error for ${mailbox.email_address}:`, graphError);
        }

        // The live sender is GRAPH-PRIMARY for M365 (workers/sequence-sender:
        // `useGraph`), and falls back to SMTP only when Graph is unavailable. So
        // a Graph-eligible mailbox whose SMTP AUTH is switched off is fully
        // usable, and failing it here benched 113 working mailboxes on a channel
        // the sender does not need. Microsoft disables SMTP AUTH by default and
        // retires Basic Auth in Dec 2026, so this will only become more common.
        // Gate availability on Graph; record SMTP purely as fallback health.
        const meta0 = (mailbox.metadata || {}) as Record<string, unknown>;
        const graphEligible = !!meta0.m365_user_id && !!meta0.m365_admin_email;
        const allOk = graphEligible ? graphOk : (smtpOk && graphOk);

        // Update mailbox status
        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };

        if (allOk) {
          if (mailbox.status === 'disconnected') {
            updatePayload.status = 'ready';
          }
          // For m365, `imap_connected` means "in the Graph polling pool", and
          // every send path gates on `status='ready' AND imap_connected=true`.
          // Without this the retest left the mailbox reading as a connection
          // issue and still unable to send — and it could never recover on its
          // own, because the poller selects `.eq('imap_connected', true)`, so
          // its own self-heal never reaches a mailbox that is false.
          updatePayload.imap_connected = true;
          // Clear any stale auth errors
          const cleanedMeta = { ...(mailbox.metadata || {}) } as Record<string, unknown>;
          delete cleanedMeta.graph_auth_error;
          delete cleanedMeta.graph_auth_failed_at;
          delete cleanedMeta.graph_auth_fail_count;
          delete cleanedMeta.imap_auth_error;
          delete cleanedMeta.imap_auth_failed_at;
          delete cleanedMeta.imap_auth_fail_count;
          delete cleanedMeta.disconnected_reason;
          delete cleanedMeta.disconnected_error;
          // Graph is the send path; SMTP is only the fallback. Keep its state
          // visible without letting it gate availability.
          cleanedMeta.smtp_fallback_ok = smtpOk;
          if (!smtpOk) cleanedMeta.smtp_fallback_error = smtpError || 'SMTP unavailable';
          else delete cleanedMeta.smtp_fallback_error;
          updatePayload.metadata = cleanedMeta;
        } else {
          updatePayload.status = 'disconnected';
          const meta = { ...(mailbox.metadata || {}) } as Record<string, unknown>;
          if (!smtpOk && !graphEligible) {
            meta.disconnected_reason = 'smtp_test_failed';
            meta.disconnected_error = smtpError || 'SMTP connection failed';
          } else {
            meta.graph_auth_error = graphError || 'Graph API authorization failed';
            meta.graph_auth_failed_at = new Date().toISOString();
            meta.disconnected_reason = 'graph_test_failed';
            meta.disconnected_error = graphError || 'Graph API authorization failed';
          }
          meta.disconnected_at = new Date().toISOString();
          updatePayload.metadata = meta;
        }

        await supabase.from('email_mailboxes').update(updatePayload).eq('id', mailboxId);

        return new Response(
          JSON.stringify({
            success: allOk,
            smtp_ok: smtpOk,
            graph_ok: graphOk,
            imap_ok: graphOk, // For compatibility with existing UI
            error: allOk ? undefined : (smtpError || graphError),
            test_method: 'm365_smtp_graph',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ── Postal (Azure infrastructure) mailboxes: test via VM Run Command ──
      if (mailbox.connection_type === 'postal') {
        const sendingDomainId = (mailbox.metadata as Record<string, unknown>)?.sending_domain_id as string | undefined;
        if (sendingDomainId) {
          try {
            const { data: domainRecord } = await supabase
              .from('email_sending_domains')
              .select('*, azure_subscriptions!inner(*)')
              .eq('id', sendingDomainId)
              .single();

            if (domainRecord?.vm_name) {
              const sub = domainRecord.azure_subscriptions;
              const vmCreds = await getVMCredentials(sub, domainRecord.vm_name, domainRecord.metadata?.resource_group);

              const postalCreds = await extractSMTPCredentials(mailbox.metadata || {});
              if (postalCreds) {
                console.log(`[Mailbox Connect] Postal VM auth test for ${mailbox.email_address}`);

                const result = await Promise.race([
                  testMailboxAuth(vmCreds, postalCreds.smtp_username, postalCreds.smtp_password),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('VM test timed out after 50s')), 50000)
                  ),
                ]);

                // Update mailbox status
                const updatePayload: Record<string, unknown> = {
                  imap_connected: result.imap_ok,
                  updated_at: new Date().toISOString(),
                };

                if (result.success) {
                  if (mailbox.status === 'disconnected') {
                    updatePayload.status = 'ready';
                  }
                  const cleanedMeta = { ...(mailbox.metadata || {}) } as Record<string, unknown>;
                  delete cleanedMeta.imap_auth_error;
                  delete cleanedMeta.imap_auth_failed_at;
                  delete cleanedMeta.disconnected_reason;
                  delete cleanedMeta.disconnected_at;
                  delete cleanedMeta.disconnected_error;
                  updatePayload.metadata = cleanedMeta;
                } else {
                  updatePayload.status = 'disconnected';
                  const meta = { ...(mailbox.metadata || {}) } as Record<string, unknown>;
                  meta.disconnected_reason = !result.smtp_ok ? 'smtp_test_failed' : 'imap_test_failed';
                  meta.disconnected_at = new Date().toISOString();
                  meta.disconnected_error = result.error || 'Connection test failed';
                  updatePayload.metadata = meta;
                }

                await supabase.from('email_mailboxes').update(updatePayload).eq('id', mailboxId);

                return new Response(
                  JSON.stringify({
                    success: result.success,
                    smtp_ok: result.smtp_ok,
                    imap_ok: result.imap_ok,
                    imap_connected: result.imap_ok,
                    error: result.success ? undefined : result.error,
                    test_method: 'vm_run_command',
                  }),
                  { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            }
          } catch (err) {
            console.error(`[Mailbox Connect] Postal VM test failed for ${mailbox.email_address}, falling back to standard test:`, err);
            // Fall through to standard test below
          }
        } else {
          console.log(`[Mailbox Connect] Postal mailbox ${mailbox.email_address} missing sending_domain_id, falling back to standard test`);
        }
      }

      // Extract stored credentials
      const creds = await extractSMTPCredentials(mailbox.metadata || {});
      if (!creds) {
        console.log(`[Mailbox Connect] No credentials found for ${mailbox.email_address} — metadata keys: ${Object.keys(mailbox.metadata || {}).join(', ')}`);
        const hint = mailbox.connection_type === 'zapmail'
          ? 'No SMTP/IMAP credentials found. Please re-import your ZapMail mailboxes to auto-configure credentials.'
          : 'No SMTP/IMAP credentials configured. Please re-add this mailbox with your SMTP & IMAP settings.';
        return new Response(
          JSON.stringify({
            success: false,
            smtp_ok: false,
            imap_ok: false,
            missing_credentials: true,
            error: hint,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test SMTP
      let smtpOk = false;
      let smtpError: string | undefined;
      if (creds.smtp_host && creds.smtp_username && creds.smtp_password) {
        const smtpResult = await testSMTPConnection(creds);
        smtpOk = smtpResult.success;
        smtpError = smtpResult.error;
        console.log(`[Mailbox Connect] SMTP test for ${mailbox.email_address}: ${smtpOk ? 'OK' : smtpError}`);
      } else {
        smtpError = 'No SMTP credentials stored';
      }

      // Test IMAP
      let imapOk = false;
      let imapError: string | undefined;
      if (creds.imap_host && creds.imap_username && creds.imap_password) {
        const imapResult = await testIMAPConnection(creds);
        imapOk = imapResult.success;
        imapError = imapResult.error;
        console.log(`[Mailbox Connect] IMAP test for ${mailbox.email_address}: ${imapOk ? 'OK' : imapError}`);
      } else {
        imapError = 'No IMAP credentials stored';
      }

      const allOk = smtpOk && imapOk;

      // Update mailbox connection status
      const updatePayload: Record<string, unknown> = {
        imap_connected: imapOk,
        updated_at: new Date().toISOString(),
      };

      if (allOk) {
        // Restore to ready when connection is healthy again
        if (mailbox.status === 'disconnected') {
          updatePayload.status = 'ready';
        }
        // Clear auth error metadata on success
        if ((mailbox.metadata as any)?.imap_auth_error) {
          const cleanedMeta = { ...(mailbox.metadata || {}) };
          delete (cleanedMeta as any).imap_auth_error;
          delete (cleanedMeta as any).imap_auth_failed_at;
          delete (cleanedMeta as any).disconnected_reason;
          delete (cleanedMeta as any).disconnected_at;
          delete (cleanedMeta as any).disconnected_error;
          updatePayload.metadata = cleanedMeta;
        }
      } else {
        // Mark disconnected when connection test fails
        updatePayload.status = 'disconnected';
        const meta = { ...(mailbox.metadata || {}) } as Record<string, unknown>;
        meta.disconnected_reason = !smtpOk ? 'smtp_test_failed' : 'imap_test_failed';
        meta.disconnected_at = new Date().toISOString();
        meta.disconnected_error = !smtpOk ? (smtpError || 'SMTP connection failed') : (imapError || 'IMAP connection failed');
        updatePayload.metadata = meta;
      }

      await supabase
        .from('email_mailboxes')
        .update(updatePayload)
        .eq('id', mailboxId);

      // Build error message for failures
      const errors: string[] = [];
      if (!smtpOk) errors.push(`SMTP: ${smtpError || 'failed'}`);
      if (!imapOk) errors.push(`IMAP: ${imapError || 'failed'}`);

      return new Response(
        JSON.stringify({
          success: allOk,
          smtp_ok: smtpOk,
          imap_ok: imapOk,
          imap_connected: imapOk,
          error: allOk ? undefined : errors.join('; '),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Action: update_credentials ──────────────────────────────────────
    if (action === 'update_credentials') {
      const mailboxId = body.mailbox_id;
      if (!mailboxId) {
        return new Response(
          JSON.stringify({ success: false, error: 'mailbox_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch existing mailbox
      const { data: mailbox, error: fetchErr } = await supabase
        .from('email_mailboxes')
        .select('id, organization_id, email_address, metadata, imap_connected, status, connection_type')
        .eq('id', mailboxId)
        .single();

      if (fetchErr || !mailbox) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mailbox not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const denied = await denyUnlessOrgAccess(req, supabase, mailbox.organization_id);
      if (denied) return denied;

      // Build updated credentials (merge with existing where not provided)
      const existingCreds = await extractSMTPCredentials(mailbox.metadata || {});
      const updatedCreds: SMTPCredentials = {
        smtp_host: body.smtp_host || existingCreds?.smtp_host || '',
        smtp_port: body.smtp_port ? Number(body.smtp_port) : (existingCreds?.smtp_port || 587),
        smtp_username: body.smtp_username || existingCreds?.smtp_username || '',
        smtp_password: body.smtp_password || existingCreds?.smtp_password || '',
        imap_host: body.imap_host || existingCreds?.imap_host || undefined,
        imap_port: body.imap_port ? Number(body.imap_port) : (existingCreds?.imap_port || undefined),
        imap_username: body.imap_username || existingCreds?.imap_username || undefined,
        imap_password: body.imap_password || existingCreds?.imap_password || undefined,
      };

      if (!updatedCreds.smtp_host || !updatedCreds.smtp_username || !updatedCreds.smtp_password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required SMTP fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!updatedCreds.imap_host || !updatedCreds.imap_username || !updatedCreds.imap_password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required IMAP fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Mailbox Connect] Updating credentials for ${mailbox.email_address}`);

      // Test SMTP
      const smtpResult = await testSMTPConnection(updatedCreds);
      if (!smtpResult.success) {
        return new Response(
          JSON.stringify({ success: false, smtp_ok: false, error: `SMTP: ${smtpResult.error}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test IMAP
      const imapResult = await testIMAPConnection(updatedCreds);
      if (!imapResult.success) {
        return new Response(
          JSON.stringify({ success: false, smtp_ok: true, imap_ok: false, error: `IMAP: ${imapResult.error}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Encrypt and store new credentials
      const encryptedCreds = await encryptCredentials(updatedCreds);
      const cleanedMeta = { ...(mailbox.metadata || {}) };
      delete (cleanedMeta as any).imap_auth_error;
      delete (cleanedMeta as any).imap_auth_failed_at;

      await supabase
        .from('email_mailboxes')
        .update({
          imap_connected: true,
          metadata: {
            ...cleanedMeta,
            smtp_credentials: encryptedCreds,
            smtp_host: updatedCreds.smtp_host,
            smtp_port: updatedCreds.smtp_port,
            imap_host: updatedCreds.imap_host || null,
            imap_port: updatedCreds.imap_port || null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', mailboxId);

      console.log(`[Mailbox Connect] Credentials updated successfully for ${mailbox.email_address}`);

      return new Response(
        JSON.stringify({ success: true, smtp_ok: true, imap_ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Unknown action ─────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Mailbox Connect] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
