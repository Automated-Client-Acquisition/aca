/**
 * REST resource: /v1/sequences
 *
 *   GET /v1/sequences        list email sequences
 *   GET /v1/sequences/{id}   fetch one, including its steps
 *
 * Read-only on purpose. Authoring a sequence means writing step graphs, variant
 * assignments and send-window settings that the builder validates — an API that
 * accepted a raw `steps` blob would let callers create sequences the processor
 * cannot run.
 */

import {
  ApiError,
  createResource,
  json,
  parseLimit,
  decodeCursor,
  paginated,
  requireUuid,
} from '../_shared/rest-api.ts';

/**
 * `steps` is deliberately absent from the list projection — a sequence's step
 * graph runs to tens of kilobytes of JSON, and a 100-row page would be megabytes
 * of payload nobody asked for. It is included on the single-sequence read.
 */
const SEQUENCE_LIST_COLUMNS = [
  'id',
  'name',
  'status',
  'source_type',
  'campaign_id',
  'lead_list_id',
  'lead_list_ids',
  'auto_enroll_new_members',
  'settings',
  'created_at',
  'updated_at',
].join(', ');

const SEQUENCE_DETAIL_COLUMNS = `${SEQUENCE_LIST_COLUMNS}, steps`;

Deno.serve(createResource({
  GET: async ({ url, supabase, caller }) => {
    const id = url.searchParams.get('id');

    if (id) {
      const sequenceId = requireUuid(id, 'id');
      const { data, error } = await supabase
        .from('email_sequences')
        .select(SEQUENCE_DETAIL_COLUMNS)
        .eq('organization_id', caller.organization_id)
        .eq('id', sequenceId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new ApiError('Sequence not found', 404);
      return json({ success: true, data });
    }

    const limit = parseLimit(url);
    const cursor = decodeCursor(url);

    let query = supabase
      .from('email_sequences')
      .select(SEQUENCE_LIST_COLUMNS)
      .eq('organization_id', caller.organization_id)
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (cursor) query = query.gt('id', cursor);

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);

    const campaignId = url.searchParams.get('campaign_id');
    if (campaignId) query = query.eq('campaign_id', requireUuid(campaignId, 'campaign_id'));

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return json({ success: true, ...paginated(data || [], limit, 'id') });
  },
}));
