/**
 * Mailbox Export Edge Function
 *
 * Exports selected mailboxes as a CSV string with decrypted SMTP/IMAP credentials.
 *
 * POST { organization_id, mailbox_ids?: string[] }
 *
 * Always returns 200 with a JSON envelope so callers can render partial results:
 *   {
 *     csv: string,                          // empty when nothing exported
 *     exported_count: number,
 *     skipped_count: number,
 *     skipped: Array<{ email: string, reason: 'missing_credentials' | 'decryption_failed' }>
 *   }
 *
 * Validation/auth failures still return 4xx with { error: string }.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  extractSMTPCredentialsWithReason,
  type SMTPCredentialsExtractionFailure,
} from '../_shared/smtp-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escapeCSV(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

interface SkippedMailbox {
  email: string;
  reason: SMTPCredentialsExtractionFailure;
}

interface ExportEnvelope {
  csv: string;
  exported_count: number;
  skipped_count: number;
  skipped: SkippedMailbox[];
}

function jsonResponse(body: ExportEnvelope | { error: string }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
    const { organization_id, mailbox_ids } = body;

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

    // Fetch mailboxes (optionally filtered by IDs). Do not filter by
    // connection_type here: ZapMail, legacy null, ACS, Postal, and M365 rows can
    // all carry SMTP credentials in metadata.
    let query = supabase
      .from('email_mailboxes')
      .select('id, email_address, display_name, metadata, connection_type')
      .eq('organization_id', organization_id)
      .order('email_address', { ascending: true });

    if (mailbox_ids && Array.isArray(mailbox_ids) && mailbox_ids.length > 0) {
      query = query.in('id', mailbox_ids);
    }

    const { data: mailboxes, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch mailboxes: ${fetchError.message}`);
    }

    const headers = [
      'Name',
      'Email Address',
      'SMTP Server Address',
      'SMTP Server Port',
      'SMTP User Login',
      'SMTP User Password',
      'IMAP Server Address',
      'IMAP Server Port',
      'IMAP User Login',
      'IMAP User Password',
    ];

    const rows: string[] = [];
    const skipped: SkippedMailbox[] = [];

    for (const mailbox of mailboxes ?? []) {
      const metadata = (mailbox.metadata || {}) as Record<string, unknown>;
      const result = await extractSMTPCredentialsWithReason(metadata);

      if (!result.ok) {
        console.warn(
          `[Mailbox Export] Skipping ${mailbox.email_address}: ${result.reason}`,
        );
        skipped.push({ email: mailbox.email_address, reason: result.reason });
        continue;
      }

      const creds = result.creds;
      const row = [
        escapeCSV(mailbox.display_name || ''),
        escapeCSV(mailbox.email_address),
        escapeCSV(creds.smtp_host),
        escapeCSV(creds.smtp_port),
        escapeCSV(creds.smtp_username),
        escapeCSV(creds.smtp_password),
        escapeCSV(creds.imap_host || ''),
        escapeCSV(creds.imap_port || ''),
        escapeCSV(creds.imap_username || creds.smtp_username),
        escapeCSV(creds.imap_password || creds.smtp_password),
      ];

      rows.push(row.join(','));
    }

    const csv = rows.length > 0 ? [headers.join(','), ...rows].join('\n') : '';

    return jsonResponse({
      csv,
      exported_count: rows.length,
      skipped_count: skipped.length,
      skipped,
    });
  } catch (error) {
    console.error('[Mailbox Export] Error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    );
  }
});
