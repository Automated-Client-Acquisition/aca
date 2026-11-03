/**
 * Shared core for lead-list membership writes.
 *
 * Used by the legacy `bulk-add-to-list` function (which the CLI calls by
 * name), the REST resource `api-lists` and the MCP `add_contacts_to_list`
 * tool, so they can never drift on conflict handling.
 *
 * Adds go through the `add_list_members` RPC: one INSERT ... ON CONFLICT DO
 * NOTHING per chunk, which skips contacts already in the list and contacts
 * whose email is already in the list instead of failing the batch. The
 * lead_count trigger is statement-level and counts only rows inserted.
 */

interface SupabaseLike {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc?(fn: string, args: Record<string, unknown>): any;
}

export const MEMBER_BATCH_SIZE = 50;

/**
 * Resolve `sourceListId` + `filters` into the contact ids they select.
 *
 * The point is that the id list never leaves the server: "add everyone in list
 * A who has an email to list B" is one request, not a paginated download
 * followed by an upload. `bulk-add-to-list` has always supported this shape;
 * `api-lists` documented it and did not, which is why it lives here now.
 *
 * Both lists must belong to the same organization — callers pass the org they
 * already authorized, and this function refuses to reach outside it.
 */
export async function resolveContactIdsFromSourceList(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  sourceListId: string,
  organizationId: string,
  filters: Record<string, unknown>,
  limit?: number,
): Promise<string[]> {
  const { data: sourceList, error: sourceError } = await supabase
    .from('lead_lists')
    .select('id')
    .eq('id', sourceListId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (sourceError) throw new Error(sourceError.message);
  if (!sourceList) throw new Error('Source list not found');

  // p_limit defaults to NULL (unbounded). Callers that intend to cap should ask
  // for one more than they will accept, so an overflow is detectable rather than
  // silently truncated into a partial copy.
  const { data, error } = await supabase.rpc('get_filtered_lead_list_member_ids', {
    p_list_id: sourceListId,
    p_filters: filters,
    p_limit: limit ?? null,
  });

  if (error) throw new Error(`Failed to resolve source list members: ${error.message}`);
  return Array.isArray(data) ? (data as string[]) : [];
}

export interface AddMembersResult {
  added: number;
  /** Already in the list, or another contact with the same email is. */
  skipped: number;
  /** Ids that are not contacts of the list's organization. */
  not_found: number;
  total_submitted: number;
}

/** Contact ids per RPC call. */
export const ADD_MEMBERS_CHUNK = 2000;

/**
 * Insert contacts into a list, ignoring ones already present.
 *
 * The RPC re-checks that the list and every contact belong to organizationId,
 * so a caller can never reach across organizations even with a wrong id.
 */
export async function addContactsToList(
  supabase: SupabaseLike,
  organizationId: string,
  listId: string,
  contactIds: string[],
): Promise<AddMembersResult> {
  if (!supabase.rpc) throw new Error('addContactsToList needs a client with rpc()');
  const unique = [...new Set(contactIds)];
  const totals = { added: 0, skipped: 0, not_found: 0 };

  for (let i = 0; i < unique.length; i += ADD_MEMBERS_CHUNK) {
    const { data, error } = await supabase.rpc('add_list_members', {
      p_organization_id: organizationId,
      p_list_id: listId,
      p_contact_ids: unique.slice(i, i + ADD_MEMBERS_CHUNK),
    });
    if (error) throw new Error(`Failed to add contacts to list: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as typeof totals | undefined;
    totals.added += row?.added ?? 0;
    totals.skipped += row?.skipped ?? 0;
    totals.not_found += row?.not_found ?? 0;
  }

  return { ...totals, total_submitted: contactIds.length };
}

/**
 * Recompute `lead_lists.lead_count` from the membership rows.
 *
 * Used after removals, so a count that drifted in the past is restated from
 * the source of truth.
 */
async function resyncLeadCount(supabase: SupabaseLike, listId: string): Promise<void> {
  const { count, error } = await supabase
    .from('lead_list_members')
    .select('id', { count: 'exact', head: true })
    .eq('list_id', listId);

  if (error) return; // Non-fatal: membership is already correct, only the cached count lags.

  await supabase
    .from('lead_lists')
    .update({ lead_count: count || 0, updated_at: new Date().toISOString() })
    .eq('id', listId);
}

/** Remove contacts from a list. Returns how many membership rows were deleted. */
export async function removeContactsFromList(
  supabase: SupabaseLike,
  listId: string,
  contactIds: string[],
): Promise<{ removed: number }> {
  const unique = [...new Set(contactIds)];
  let removed = 0;

  for (let i = 0; i < unique.length; i += MEMBER_BATCH_SIZE) {
    const batch = unique.slice(i, i + MEMBER_BATCH_SIZE);
    const { data, error } = await supabase
      .from('lead_list_members')
      .delete()
      .eq('list_id', listId)
      .in('contact_id', batch)
      .select('id');

    if (error) throw new Error(`Failed to remove contacts from list: ${error.message}`);
    removed += (data || []).length;
  }

  await resyncLeadCount(supabase, listId);

  return { removed };
}
