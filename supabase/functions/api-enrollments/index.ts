/**
 * REST resource: /v1/enrollments
 *
 *   GET /v1/enrollments        list enrollments, filtered + keyset-paginated
 *   GET /v1/enrollments/{id}   fetch one
 *
 * This is the "is this lead in a sequence, and where?" endpoint.
 *
 * TENANCY WARNING — do not "simplify" this to a filter on organization_id.
 * `email_sequence_enrollments.organization_id` is nullable and NULL on ~93% of
 * rows (22,326 of 23,909 at the time of writing), so scoping by it silently
 * returns a small fraction of a caller's real enrollments — the worst kind of
 * bug, because it looks like it works. Tenancy is enforced through
 * `sequence_id`, since `email_sequences.organization_id` is NOT NULL.
 */

import {
  ApiError,
  corsHeaders,
  createResource,
  json,
  parseLimit,
  decodeCursor,
  paginated,
  requireUuid,
} from '../_shared/rest-api.ts';

const ENROLLMENT_COLUMNS = [
  'id',
  'sequence_id',
  'lead_id',
  'status',
  'current_step',
  'cycle_number',
  'next_send_at',
  'mailbox_id',
  'condition_waiting_since',
  // Per-enrollment merge-variable overrides. Included because this is the only
  // place a caller can see what personalization a given lead will actually
  // receive — the sequence's own copy is the fallback, not the truth.
  'custom_data',
  'created_at',
  'updated_at',
].join(', ');

const LEAD_COLUMNS = 'id, email, first_name, last_name, company, job_title';

/**
 * Attach the lead behind each enrollment.
 *
 * Done as a second query rather than a PostgREST embed because
 * `email_sequence_enrollments.lead_id` has no foreign key to `leads` — the
 * relationship exists in practice but not in the schema cache, so `leads(...)`
 * inside select() fails outright. Bounded by page size (100 max), so it is one
 * extra indexed lookup, not an N+1.
 */
async function hydrateLeads(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const leadIds = [...new Set(rows.map((r) => r.lead_id as string).filter(Boolean))];
  if (leadIds.length === 0) return rows.map((r) => ({ ...r, lead: null }));

  const { data, error } = await supabase
    .from('leads')
    .select(LEAD_COLUMNS)
    .in('id', leadIds);

  if (error) throw new Error(error.message);

  const byId = new Map((data || []).map((l: { id: string }) => [l.id, l]));
  // A lead can be hard-deleted while its enrollment row survives, so `lead`
  // is null rather than assumed present.
  return rows.map((r) => ({ ...r, lead: byId.get(r.lead_id as string) ?? null }));
}

/**
 * Every sequence id in the caller's organization. Cheap — sequences number in
 * the dozens per organization — and it is what makes the sequence_id filter a
 * sound tenancy boundary rather than a guess.
 */
async function orgSequenceIds(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('email_sequences')
    .select('id')
    .eq('organization_id', organizationId);

  if (error) throw new Error(error.message);
  return (data || []).map((row: { id: string }) => row.id);
}

Deno.serve(createResource({
  /**
   * Enrolling is owned by `enroll-leads`, which handles audience paging, the
   * one-active-sequence-per-lead guard, suppression and mailbox-pool resolution.
   * POST lands here only because the Vercel proxy routes on path and cannot
   * split a path by method — so forward it rather than fork that logic.
   */
  POST: async ({ req, body }) => {
    const target = `${Deno.env.get('SUPABASE_URL')}/functions/v1/enroll-leads`;
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass the caller's own credential through; enroll-leads authenticates
        // independently rather than trusting this hop.
        Authorization: req.headers.get('Authorization') ?? '',
      },
      body: JSON.stringify(body),
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },

  GET: async ({ url, supabase, caller }) => {
    const id = url.searchParams.get('id');

    if (id) {
      const enrollmentId = requireUuid(id, 'id');
      const { data, error } = await supabase
        .from('email_sequence_enrollments')
        .select(ENROLLMENT_COLUMNS)
        .eq('id', enrollmentId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new ApiError('Enrollment not found', 404);

      // Authorize after fetching: the row itself cannot be trusted to say which
      // organization it belongs to, so the owning sequence decides.
      const allowed = await orgSequenceIds(supabase, caller.organization_id);
      if (!allowed.includes(data.sequence_id)) {
        throw new ApiError('Enrollment not found', 404);
      }

      const [hydrated] = await hydrateLeads(supabase, [data as Record<string, unknown>]);
      return json({ success: true, data: hydrated });
    }

    const limit = parseLimit(url);
    const cursor = decodeCursor(url);

    // Scope to one sequence when asked, otherwise to every sequence in the org.
    let sequenceScope: string[];
    const sequenceParam = url.searchParams.get('sequence_id');
    if (sequenceParam) {
      const sequenceId = requireUuid(sequenceParam, 'sequence_id');
      const allowed = await orgSequenceIds(supabase, caller.organization_id);
      if (!allowed.includes(sequenceId)) throw new ApiError('Sequence not found', 404);
      sequenceScope = [sequenceId];
    } else {
      sequenceScope = await orgSequenceIds(supabase, caller.organization_id);
      if (sequenceScope.length === 0) {
        return json({ success: true, data: [], has_more: false, next_cursor: null });
      }
    }

    let query = supabase
      .from('email_sequence_enrollments')
      .select(ENROLLMENT_COLUMNS)
      .in('sequence_id', sequenceScope)
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (cursor) query = query.gt('id', cursor);

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);

    const leadId = url.searchParams.get('lead_id');
    if (leadId) query = query.eq('lead_id', requireUuid(leadId, 'lead_id'));

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // Page first, hydrate second — otherwise the over-fetched row's lead is
    // looked up and thrown away.
    const page = paginated((data || []) as Record<string, unknown>[], limit, 'id');
    page.data = await hydrateLeads(supabase, page.data);

    return json({ success: true, ...page });
  },
}));
