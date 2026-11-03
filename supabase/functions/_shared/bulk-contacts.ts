/**
 * Shared core for bulk CRM contact creation.
 *
 * Single source of truth used by every surface that creates contacts in bulk:
 *   - REST edge function `bulk-create-contacts` (CLI + external API callers)
 *   - MCP server tool `bulk_create_contacts`
 *
 * Keeping the insert/dedup/activity logic here guarantees all three surfaces
 * behave identically (same accepted fields, same dedup semantics, same
 * response shape). The work itself happens in the `bulk_import_contacts` RPC:
 * one statement per chunk matches existing contacts (lower email, then
 * LinkedIn URL), inserts the rest without failing on conflicts, logs
 * activities and, when asked, adds every row to a list.
 *
 * The client param is typed structurally so it accepts a supabase-js client
 * from any pinned version (the MCP function and edge functions import slightly
 * different @supabase/supabase-js URLs).
 */

interface SupabaseLike {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
}

export interface BulkContactInput {
  display_name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  primary_email?: string;
  primary_phone?: string;
  primary_linkedin_url?: string;
  /** Instagram profile URL or @handle. */
  instagram_url?: string;
  linkedin_bio?: string;
  home_page_text?: string;
  company_website?: string;
  city?: string;
  state?: string;
  country?: string;
  pipeline_id?: string;
  stage_id?: string;
  tags?: string[];
  source?: string;
  custom_fields?: Record<string, unknown>;
  owner_user_id?: string;
  /**
   * Buying-signal context. Read by the {{ai_signal_*}} resolvers in
   * generate-email-sequence, campaign-processor and the Fly sequence-sender —
   * `custom_fields` is NOT read by any of them, so signal context belongs here
   * or the writer never sees it. Key names must match what
   * list-building-signal-export writes (signal_type, signal_date, signal_detail,
   * signal_outreach_context, signal_source_url, ai_signal_*, company_*_range).
   */
  discovery_metadata?: Record<string, unknown>;
}

export interface BulkContactOptions {
  /** Skip inputs whose primary_email already exists in the org (default true). */
  dedupeOnEmail?: boolean;
  /** Write one `contact_created` crm_activities row per contact (default true). */
  logActivity?: boolean;
  /** Fallback source when a row omits `source` (default "api"). */
  defaultSource?: string;
  /** Hard cap on how many contacts one call may submit (default 1000). */
  maxBatch?: number;
  /** Also add every submitted contact (new or existing) to this list. Must belong to orgId. */
  listId?: string;
}

export interface BulkContactRowResult {
  index: number;
  contact_id: string | null;
  status: 'created' | 'existing' | 'invalid';
  added_to_list: boolean;
}

export interface BulkContactResult {
  created: number;
  /** Rows that matched an existing contact (or an earlier row in the same call). */
  skipped: number;
  total_submitted: number;
  /** Ids of contacts created by this call. */
  contact_ids: string[];
  /** One entry per submitted row, in order: the contact it resolved to. */
  results: BulkContactRowResult[];
  /** Present when listId was given: membership rows this call inserted. */
  added_to_list?: number;
}

/**
 * Rows per RPC call. Every row writes ~65 crm_contacts index entries and fires
 * the lead_list_members triggers inside one statement: about 9ms a row on prod
 * (2026-10-16), so 250 rows hit the 8s statement_timeout under concurrent load.
 * 100 keeps each call near one second.
 */
const CHUNK_SIZE = 100;

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Derive a display_name when one isn't supplied — first+last, else company,
 * else email. Returns null when nothing usable exists (caller errors on that).
 */
export function deriveDisplayName(c: BulkContactInput): string | null {
  const explicit = trimStr(c.display_name);
  if (explicit) return explicit;
  const name = [trimStr(c.first_name), trimStr(c.last_name)].filter(Boolean).join(' ').trim();
  if (name) return name;
  const company = trimStr(c.company);
  if (company) return company;
  const email = trimStr(c.primary_email);
  if (email) return email;
  return null;
}

/**
 * Insert many CRM contacts for one organization.
 *
 * - Derives display_name when missing.
 * - Matches existing contacts on lower(primary_email) (unless dedupeOnEmail is
 *   off) and on primary_linkedin_url, against the org AND within the batch;
 *   matched rows are reported as skipped and resolved to the existing id.
 * - Never fails a chunk on a unique conflict: a row that loses a race to a
 *   concurrent import resolves to the contact that won.
 *
 * Throws on validation failure or a database error.
 */
export async function insertContactsBulk(
  supabase: SupabaseLike,
  orgId: string,
  contacts: BulkContactInput[],
  opts: BulkContactOptions = {},
): Promise<BulkContactResult> {
  const maxBatch = opts.maxBatch ?? 1000;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error('contacts array is required and must be non-empty');
  }
  if (contacts.length > maxBatch) {
    throw new Error(`Maximum ${maxBatch} contacts per request (received ${contacts.length})`);
  }

  // Validate + derive display_name up front so we fail before writing anything.
  const prepared = contacts.map((c, i) => {
    const display_name = deriveDisplayName(c);
    if (!display_name) {
      throw new Error(
        `Contact at index ${i} needs a display_name (or first/last name, company, or email to derive one)`,
      );
    }
    return { ...c, display_name };
  });

  const results: BulkContactRowResult[] = [];
  for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
    const chunk = prepared.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase.rpc('bulk_import_contacts', {
      p_organization_id: orgId,
      p_rows: chunk,
      p_list_id: opts.listId ?? null,
      p_dedupe_on_email: opts.dedupeOnEmail !== false,
      p_default_source: opts.defaultSource || 'api',
      p_log_activity: opts.logActivity !== false,
    });
    if (error) {
      console.error('[bulk-contacts] bulk_import_contacts failed:', error.message);
      if ((error as { code?: string }).code === 'P0002') throw new Error('List not found');
      throw new Error(`Failed to insert contacts: ${error.message}`);
    }
    for (const r of (data || []) as Array<{
      idx: number;
      contact_id: string | null;
      status: BulkContactRowResult['status'];
      added_to_list: boolean;
    }>) {
      results.push({
        index: i + r.idx,
        contact_id: r.contact_id,
        status: r.status,
        added_to_list: r.added_to_list,
      });
    }
  }

  const contactIds = results.filter((r) => r.status === 'created').map((r) => r.contact_id as string);
  const result: BulkContactResult = {
    created: contactIds.length,
    skipped: results.filter((r) => r.status === 'existing').length,
    total_submitted: contacts.length,
    contact_ids: contactIds,
    results,
  };
  if (opts.listId) result.added_to_list = results.filter((r) => r.added_to_list).length;
  return result;
}
