/**
 * REST resource: /v1/contacts
 *
 *   GET    /v1/contacts            list, filtered + keyset-paginated
 *   GET    /v1/contacts/{id}       fetch one
 *   POST   /v1/contacts            create in bulk
 *   PATCH  /v1/contacts/{id}       update one
 *   DELETE /v1/contacts/{id}       delete one
 *   DELETE /v1/contacts            delete many, { ids: [...] }
 *
 * The Vercel proxy is path-based and cannot route by method, so every method for
 * this resource lands here and dispatches internally. `{id}` arrives as ?id=
 * because the rewrite has to hand the path segment over as a query parameter.
 *
 * Creation delegates to the same shared core as the MCP tool and the CLI, so all
 * three surfaces dedupe and log activities identically.
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
import { insertContactsBulk, type BulkContactInput } from '../_shared/bulk-contacts.ts';

const MAX_CREATE_BATCH = 1000;

/**
 * Deleting a contact cascades to `crm_contact_tags`, and that table's trigger
 * queues one `tag_removed` webhook per row. A five-figure delete would therefore
 * queue a five-figure webhook burst, so deletes are capped well below the create
 * limit.
 */
const MAX_DELETE_BATCH = 100;

/**
 * Explicit column list rather than `select('*')`. `crm_contacts` is a very wide
 * table and selecting everything drags megabytes of enrichment JSON through the
 * heap on every page.
 *
 * This is the LIST shape. A single-contact lookup uses CONTACT_COLUMNS_FULL
 * below — see the note there.
 */
const CONTACT_COLUMNS = [
  'id',
  'display_name',
  'first_name',
  'last_name',
  'primary_email',
  'primary_phone',
  'primary_linkedin_url',
  'instagram_url',
  'linkedin_bio',
  'company',
  'company_website',
  'job_title',
  'city',
  'state',
  'country',
  'tags',
  'status',
  'source',
  'lead_score',
  'stage_id',
  'pipeline_id',
  'owner_user_id',
  'custom_fields',
  'discovery_metadata',
  'created_at',
  'updated_at',
].join(', ');

/**
 * The single-contact shape: everything a caller can act on.
 *
 * The heap-cost argument above is about *paging* — it scales with the page
 * size, and `enrichment_data` alone can be several KB per row. A lookup by
 * primary key returns exactly one row, so that argument does not apply, and the
 * narrow list actively broke callers: an integration fetching one contact to
 * decide whether to email it could not see `email_verification_status`,
 * `enrichment_data`, or any of the deliverability columns, because they simply
 * were not selected. The data existed; the endpoint hid it.
 *
 * Still explicit rather than `select('*')`, so a future column is a deliberate
 * decision to expose rather than an automatic leak. Deliberately withheld:
 * `organization_id` (implied by the token), and the internal bookkeeping
 * columns `notion_page_id`, `notion_preview_url`, `preview_document_id`,
 * `seg_provider`, `seg_checked_at`, `moltsets_attempted_at`, `source_lead_id`.
 */
const CONTACT_COLUMNS_FULL = [
  CONTACT_COLUMNS,
  // Identity extras
  'avatar_url',
  'full_name',
  'company_name',
  'title',
  'email',
  'phone',
  'linkedin_url',
  'company_id',
  'contact_type',
  'outreach_status',
  // Scoring + pipeline
  'lead_score_breakdown',
  'lead_score_updated_at',
  'stage_entered_at',
  // Provenance
  'source_campaign_id',
  'source_details',
  'first_seen_at',
  'last_activity_at',
  // Enrichment
  'enriched_at',
  'enrichment_data',
  'home_page_text',
  'home_page_text_fetched_at',
  'is_linkedin_connection',
  'linkedin_connected_at',
  'ai_analysis_status',
  'ai_analyzed_at',
  'discovery_score',
  'discovery_signal_strength',
  // Email deliverability — the reason this list exists
  'email_verification_status',
  'email_is_deliverable',
  'email_is_catch_all',
  'email_is_role',
  'email_is_free',
  'email_is_disposable',
  'email_is_spamtrap',
  'email_verification_score',
  'email_verified_at',
  'email_verification_source',
  'email_type',
  'email_last_validated_at',
].join(', ');

/** Fields a caller may change. Anything else is ignored rather than silently trusted. */
const UPDATABLE_FIELDS = new Set([
  'display_name',
  'first_name',
  'last_name',
  'primary_email',
  'primary_phone',
  'primary_linkedin_url',
  'instagram_url',
  'linkedin_bio',
  'home_page_text',
  'company',
  'company_website',
  'job_title',
  'city',
  'state',
  'country',
  'tags',
  'status',
  'source',
  'lead_score',
  'stage_id',
  'pipeline_id',
  'owner_user_id',
  'custom_fields',
  'discovery_metadata',
]);

/**
 * Turn a Postgres uniqueness violation into something a caller can act on.
 *
 * Some organizations carry a partial unique index on
 * `(organization_id, lower(primary_email))`, so writing an address another
 * contact already holds is a conflict, not a server fault. Left unmapped it
 * surfaced as a 500 quoting an index name — which reads as "ACA is broken"
 * rather than "that email is taken".
 */
function rethrowConflict(error: { code?: string; message: string }): never {
  if (error.code === '23505') {
    if (error.message.includes('email')) {
      throw new ApiError(
        'Another contact in this organization already uses that email address. ' +
          'Emails are unique per organization, so update that contact instead.',
        409,
      );
    }
    throw new ApiError('That value is already taken by another contact', 409);
  }
  throw new Error(error.message);
}

Deno.serve(createResource({
  /* ── Read ────────────────────────────────────────────────────── */
  GET: async ({ url, supabase, caller }) => {
    const id = url.searchParams.get('id');

    if (id) {
      const contactId = requireUuid(id, 'id');
      const { data, error } = await supabase
        .from('crm_contacts')
        // Full shape: one row by PK, so the paging heap cost that keeps the
        // list narrow does not apply here.
        .select(CONTACT_COLUMNS_FULL)
        .eq('organization_id', caller.organization_id)
        .eq('id', contactId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new ApiError('Contact not found', 404);
      return json({ success: true, data });
    }

    const limit = parseLimit(url);
    const cursor = decodeCursor(url);

    // Ordered by id, not created_at: the only organization-scoped btree that can
    // serve this at five million rows is (organization_id, id). Sorting by date
    // would fall back to a heap scan on big organizations.
    let query = supabase
      .from('crm_contacts')
      .select(CONTACT_COLUMNS)
      .eq('organization_id', caller.organization_id)
      .order('id', { ascending: true })
      .limit(limit + 1); // over-fetch by one to detect has_more

    if (cursor) query = query.gt('id', cursor);

    // Filters restricted to indexed columns — an unindexed predicate here is a
    // statement timeout waiting to happen.
    const email = url.searchParams.get('email');
    if (email) query = query.ilike('primary_email', email);

    const stageId = url.searchParams.get('stage_id');
    if (stageId) query = query.eq('stage_id', requireUuid(stageId, 'stage_id'));

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);

    const source = url.searchParams.get('source');
    if (source) query = query.eq('source', source);

    const ownerId = url.searchParams.get('owner_user_id');
    if (ownerId) query = query.eq('owner_user_id', requireUuid(ownerId, 'owner_user_id'));

    const tag = url.searchParams.get('tag');
    if (tag) query = query.contains('tags', [tag]);

    const company = url.searchParams.get('company');
    if (company) query = query.ilike('company', `%${company}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return json({ success: true, ...paginated(data || [], limit, 'id') });
  },

  /* ── Create ──────────────────────────────────────────────────── */
  POST: async ({ supabase, caller, body }) => {
    const contacts = body.contacts;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new ApiError('contacts[] is required and must be non-empty');
    }
    if (contacts.length > MAX_CREATE_BATCH) {
      throw new ApiError(
        `Maximum ${MAX_CREATE_BATCH} contacts per request (received ${contacts.length})`,
      );
    }

    const result = await insertContactsBulk(
      supabase,
      caller.organization_id,
      contacts as BulkContactInput[],
      {
        dedupeOnEmail: body.dedupe_on_email !== false,
        logActivity: body.log_activity !== false,
        defaultSource: typeof body.source === 'string' && body.source ? body.source : 'api',
        maxBatch: MAX_CREATE_BATCH,
      },
    );

    return json({ success: true, ...result });
  },

  /* ── Update ──────────────────────────────────────────────────── */
  PATCH: async ({ url, supabase, caller, body }) => {
    const contactId = requireUuid(url.searchParams.get('id'), 'id');

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (UPDATABLE_FIELDS.has(key)) updates[key] = value;
    }

    /*
     * `custom_fields` replaces the whole object, which is right for "here is the
     * complete set" and catastrophic for "set this one key". `custom_fields_patch`
     * merges instead, atomically, so two workflows writing different keys on the
     * same contact cannot lose each other's write. A null value removes a key.
     */
    const patch = body.custom_fields_patch;
    const hasPatch = patch !== undefined;
    if (hasPatch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new ApiError('custom_fields_patch must be an object');
      }
      if (updates.custom_fields !== undefined) {
        throw new ApiError(
          'Send either custom_fields (replaces all) or custom_fields_patch (merges), not both',
        );
      }
    }

    if (Object.keys(updates).length === 0 && !hasPatch) {
      throw new ApiError(
        `No updatable fields supplied. Allowed: ${[...UPDATABLE_FIELDS].join(', ')}, custom_fields_patch`,
      );
    }

    if (hasPatch) {
      const { error: mergeError } = await supabase.rpc('merge_contact_custom_fields', {
        p_organization_id: caller.organization_id,
        p_contact_id: contactId,
        p_patch: patch,
      });
      if (mergeError) throw new Error(mergeError.message);

      // The merge already stamped updated_at; without other changes there is
      // nothing left to write, so read the contact back and return it.
      if (Object.keys(updates).length === 0) {
        const { data, error } = await supabase
          .from('crm_contacts')
          .select(CONTACT_COLUMNS)
          .eq('organization_id', caller.organization_id)
          .eq('id', contactId)
          .maybeSingle();

        if (error) throw new Error(error.message);
        if (!data) throw new ApiError('Contact not found', 404);
        return json({ success: true, data });
      }
    }
    updates.updated_at = new Date().toISOString();

    // The org filter is the authorization check — a contact in another
    // organization simply matches no rows and 404s.
    const { data, error } = await supabase
      .from('crm_contacts')
      .update(updates)
      .eq('organization_id', caller.organization_id)
      .eq('id', contactId)
      .select(CONTACT_COLUMNS)
      .maybeSingle();

    if (error) rethrowConflict(error);
    if (!data) throw new ApiError('Contact not found', 404);
    return json({ success: true, data });
  },

  /* ── Delete ──────────────────────────────────────────────────── */
  DELETE: async ({ url, supabase, caller, body }) => {
    const single = url.searchParams.get('id');
    const ids = single
      ? [requireUuid(single, 'id')]
      : Array.isArray(body.ids)
        ? (body.ids as unknown[]).map((v, i) => requireUuid(v, `ids[${i}]`))
        : [];

    if (ids.length === 0) {
      throw new ApiError('Provide a contact id in the path, or { "ids": [...] } in the body');
    }
    if (ids.length > MAX_DELETE_BATCH) {
      throw new ApiError(
        `Maximum ${MAX_DELETE_BATCH} contacts per delete (received ${ids.length})`,
      );
    }

    const { data, error } = await supabase
      .from('crm_contacts')
      .delete()
      .eq('organization_id', caller.organization_id)
      .in('id', ids)
      .select('id');

    if (error) throw new Error(error.message);

    const deleted = (data || []).length;
    if (single && deleted === 0) throw new ApiError('Contact not found', 404);

    return json({ success: true, deleted, requested: ids.length });
  },
}));
