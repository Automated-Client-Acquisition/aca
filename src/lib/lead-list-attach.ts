import { supabase } from "@/integrations/supabase/client";

/**
 * One way to attach or detach a lead list from a sequence / campaign.
 *
 * Two UIs point at the same two columns: the builder's "Who enters this
 * sequence" panel and the lead list's "Route leads" dialog. They used to write
 * differently — the dialog set the LEGACY SCALAR `lead_list_id` and forced
 * `auto_enroll_new_members: true`. Because sync_lead_list_scalar_array rebuilds
 * the array from the scalar, that quietly replaced every other attached list
 * with just this one, and overrode whatever Ongoing / One-time send the user
 * had chosen in the builder.
 *
 * These helpers are array-native and never touch a choice the user already
 * made: the auto-enroll default is derived only when the FIRST list is
 * attached, exactly like the builder does it.
 */

type DestinationTable = "email_sequences" | "linkedin_campaigns";

/**
 * Append a list to the destination's lead_list_ids.
 *
 * @param defaultOngoing Auto-enroll default, applied ONLY when this is the
 *   first list attached (living list → true, fixed cohort → false). On later
 *   attaches the user's existing choice is preserved.
 * @returns the resulting list ids, or null if the list was already attached.
 */
export async function attachLeadList(
  table: DestinationTable,
  destinationId: string,
  listId: string,
  defaultOngoing: boolean,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from(table)
    .select("lead_list_ids")
    .eq("id", destinationId)
    .single();
  if (error) throw error;

  const current = ((data as { lead_list_ids?: string[] | null } | null)?.lead_list_ids ?? [])
    .filter((id): id is string => typeof id === "string");
  if (current.includes(listId)) return null;

  const next = [...current, listId];
  const { error: updateErr } = await supabase
    .from(table)
    .update({
      lead_list_ids: next,
      // First list decides the mode; later ones must not silently flip it.
      ...(current.length === 0 ? { auto_enroll_new_members: defaultOngoing } : {}),
    })
    .eq("id", destinationId);
  if (updateErr) throw updateErr;

  return next;
}

/**
 * Remove one list from the destination's lead_list_ids, leaving any others
 * attached. Clearing the last list also turns Ongoing off — an empty source
 * with auto-enroll armed is a trap that silently re-fills on the next attach.
 */
export async function detachLeadList(
  table: DestinationTable,
  destinationId: string,
  listId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from(table)
    .select("lead_list_ids")
    .eq("id", destinationId)
    .single();
  if (error) throw error;

  const current = ((data as { lead_list_ids?: string[] | null } | null)?.lead_list_ids ?? [])
    .filter((id): id is string => typeof id === "string");
  const next = current.filter((id) => id !== listId);

  const { error: updateErr } = await supabase
    .from(table)
    .update({
      lead_list_ids: next,
      ...(next.length === 0 ? { auto_enroll_new_members: false } : {}),
    })
    .eq("id", destinationId);
  if (updateErr) throw updateErr;

  return next;
}
