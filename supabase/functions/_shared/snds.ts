/**
 * Microsoft SNDS (Smart Network Data Services) integration helpers.
 *
 * SNDS exposes Outlook/Hotmail's reputation view of your sending IPs. There's
 * no registration API (Microsoft requires manual form submission), but once
 * you've registered an IP range and Microsoft has assigned a data-feed key,
 * you can pull a CSV daily.
 *
 * Two CSV endpoints:
 *   /snds/data.aspx?key=<KEY>       — IP-level "Filter Result" (red/yellow/green/grey)
 *   /senders/snds/automated.aspx     — Daily activity CSV (RCPT cmds, traps, complaints)
 *
 * We use the first one for the "is this IP healthy?" signal and parse the
 * filter_result column. The second exists for users who want detailed metrics.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const SNDS_REGISTER_BASE = 'https://sendersupport.olc.protection.outlook.com/snds/addnetwork.aspx';
const JMRP_REGISTER_BASE = 'https://sendersupport.olc.protection.outlook.com/jmrp/addnetwork.aspx';

export interface SndsRegistrationLinks {
  snds_url: string;
  jmrp_url: string;
  snds_dashboard_url: string;
}

/**
 * Build pre-filled deep-link URLs for SNDS + JMRP registration. The user
 * clicks once per IP range to register at Microsoft. We track the click via
 * `byo_servers.snds_data_url` once they paste their assigned key back.
 */
export function buildSndsRegistrationLinks(params: {
  ip_range_start: string;
  ip_range_end: string;
  contact_email: string;
}): SndsRegistrationLinks {
  // Microsoft's form fields aren't fully URL-fillable — they show the form
  // empty regardless. We still pass query params for any future support and
  // include both in the user's docs so they have one-click access.
  const snds_url = `${SNDS_REGISTER_BASE}?ip_start=${encodeURIComponent(params.ip_range_start)}&ip_end=${encodeURIComponent(params.ip_range_end)}&contact=${encodeURIComponent(params.contact_email)}`;
  const jmrp_url = `${JMRP_REGISTER_BASE}?ip_start=${encodeURIComponent(params.ip_range_start)}&ip_end=${encodeURIComponent(params.ip_range_end)}&contact=${encodeURIComponent(params.contact_email)}`;
  return {
    snds_url,
    jmrp_url,
    snds_dashboard_url: 'https://sendersupport.olc.protection.outlook.com/snds/index.aspx',
  };
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

export interface SndsRow {
  ip_address: string;
  activity_start?: string;          // ISO date
  activity_end?: string;
  rcpt_commands?: number;
  data_commands?: number;
  message_recipients?: number;
  filter_result?: 'GREEN' | 'YELLOW' | 'RED' | string;
  complaint_rate?: number;
  trap_period_start?: string;
  trap_period_end?: string;
  trap_messages?: number;
  sample_helo?: string;
  sample_mail_from?: string;
  comments?: string;
}

/**
 * Parse SNDS data.aspx CSV. The CSV has no header by default and 13 columns
 * documented at https://sendersupport.olc.protection.outlook.com/snds/data.aspx
 *
 * 1. IP Address
 * 2. Activity period start (ISO 8601)
 * 3. Activity period end
 * 4. RCPT commands
 * 5. DATA commands
 * 6. Message recipients
 * 7. Filter result (GREEN/YELLOW/RED)
 * 8. Complaint rate (0..1)
 * 9. Trap message period start
 * 10. Trap message period end
 * 11. Trap message count
 * 12. Sample HELO
 * 13. Sample MAIL FROM
 * 14. Comments
 */
export function parseSndsCsv(csv: string): SndsRow[] {
  const rows: SndsRow[] = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Microsoft uses comma-separated, no quoting (IPs can't contain commas; comments rarely do).
    const cells = line.split(',');
    if (cells.length < 7) continue;
    const ip = cells[0]?.trim();
    if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) continue;

    rows.push({
      ip_address: ip,
      activity_start: cells[1]?.trim() || undefined,
      activity_end: cells[2]?.trim() || undefined,
      rcpt_commands: cells[3] ? parseInt(cells[3], 10) : undefined,
      data_commands: cells[4] ? parseInt(cells[4], 10) : undefined,
      message_recipients: cells[5] ? parseInt(cells[5], 10) : undefined,
      filter_result: (cells[6]?.trim().toUpperCase() as SndsRow['filter_result']) || undefined,
      complaint_rate: cells[7] ? parseFloat(cells[7]) : undefined,
      trap_period_start: cells[8]?.trim() || undefined,
      trap_period_end: cells[9]?.trim() || undefined,
      trap_messages: cells[10] ? parseInt(cells[10], 10) : undefined,
      sample_helo: cells[11]?.trim() || undefined,
      sample_mail_from: cells[12]?.trim() || undefined,
      comments: cells[13]?.trim() || undefined,
    });
  }
  return rows;
}

/**
 * Fetch SNDS CSV for a server. Returns parsed rows. Throws if the URL is
 * malformed or returns non-2xx.
 */
export async function fetchSndsRows(dataUrl: string): Promise<SndsRow[]> {
  const res = await fetch(dataUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'aca-snds-poller/1.0' },
  });
  if (!res.ok) throw new Error(`SNDS fetch failed: ${res.status}`);
  const csv = await res.text();
  return parseSndsCsv(csv);
}

/**
 * Persist SNDS rows for a server's IPs. Skips rows for IPs we don't have in
 * byo_server_ips (since SNDS data feeds can return CSVs for ranges that include
 * non-ACA-managed IPs).
 */
export async function persistSndsSnapshot(
  supabase: SupabaseClient<any>,
  serverId: string,
  rows: SndsRow[],
): Promise<{ saved: number; skipped: number }> {
  const { data: ips } = await supabase
    .from('byo_server_ips')
    .select('id, organization_id, ip_address')
    .eq('server_id', serverId);

  const ipMap = new Map<string, { id: string; organization_id: string }>();
  for (const ip of (ips ?? []) as Array<{ id: string; organization_id: string; ip_address: string }>) {
    ipMap.set(ip.ip_address, { id: ip.id, organization_id: ip.organization_id });
  }

  let saved = 0, skipped = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    const known = ipMap.get(row.ip_address);
    if (!known) { skipped++; continue; }

    await supabase
      .from('email_ip_reputation_log')
      .upsert({
        byo_server_ip_id: known.id,
        organization_id: known.organization_id,
        ip_address: row.ip_address,
        recorded_for: row.activity_end?.slice(0, 10) || today,
        snds_status: row.filter_result?.toLowerCase() ?? null,
        filter_result: row.filter_result ?? null,
        rcpt_commands: row.rcpt_commands ?? null,
        data_commands: row.data_commands ?? null,
        message_recipients: row.message_recipients ?? null,
        spam_complaint_rate: row.complaint_rate ?? null,
        trap_message_period_start: row.trap_period_start ?? null,
        trap_message_period_end: row.trap_period_end ?? null,
        trap_messages: row.trap_messages ?? null,
        raw_payload: row,
      }, { onConflict: 'byo_server_ip_id,recorded_for' });

    // Also stash the latest filter result on the IP itself for fast UI reads.
    await supabase
      .from('byo_server_ips')
      .update({
        snds_last_status: row.filter_result?.toLowerCase() ?? null,
      })
      .eq('id', known.id);

    saved++;
  }

  return { saved, skipped };
}
