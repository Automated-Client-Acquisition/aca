/**
 * REST resource: /v1/lists and /v1/lists/members
 *
 *   GET    /v1/lists                       list lead lists
 *   GET    /v1/lists/{id}                  fetch one
 *   POST   /v1/lists                       create a lead list
 *   PATCH  /v1/lists/{id}                  rename / describe / archive
 *   GET    /v1/lists/members?listId=…      list members, keyset-paginated
 *   POST   /v1/lists/members               add contacts
 *   DELETE /v1/lists/members               remove contacts
 *
 * The membership routes arrive here with ?resource=members, since the Vercel
 * proxy hands path segments over as query parameters.
 *
 * Creating a list was previously impossible with an `aca_` token — the CLI wrote
 * to PostgREST directly, which rejects those tokens outright — so POST /v1/lists
 * is what makes the create → populate → enroll flow work end to end over the API.
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
import {
  addContactsToList,
  removeContactsFromList,
  resolveContactIdsFromSourceList,
} from '../_shared/list-members.ts';

const LIST_COLUMNS =
  'id, name, description, source_type, status, lead_count, is_smart, created_at, updated_at';

/** Mirrors lead_lists_source_type_check — reject early with a useful message. */
const SOURCE_TYPES = [
  'manual', 'csv', 'linkedin_search', 'event', 'post_reactors', 'smart',
  'apify_leads_finder', 'pool_export', 'pool_search', 'signal', 'discovery_pack',
];

const MAX_MEMBER_BATCH = 5000;

/** Ceiling on a `sourceListId` + `filters` copy, so one call cannot run forever. */
const MAX_SOURCE_LIST_MATCHES = 50_000;

const MEMBER_CONTACT_COLUMNS =
  'id, display_name, first_name, last_name, primary_email, primary_phone, ' +
  'primary_linkedin_url, company, company_website, job_title, city, state, country, ' +
  'tags, status, source, lead_score, stage_id, custom_fields, created_at';

/**
 * Filtered member reads page by offset, not by keyset.
 *
 * `filter_lead_list_member_rows` orders by `(added_at DESC, id DESC)` and takes
 * an offset, and re-deriving a keyset cursor across ~30 optional predicates is
 * not worth the complexity for a set bounded by one list. The cursor stays
 * opaque either way — callers pass back whatever `next_cursor` they were given.
 */
function decodeOffsetCursor(url: URL): number {
  const raw = url.searchParams.get('cursor');
  if (!raw) return 0;

  let decoded: string;
  try {
    decoded = atob(raw);
  } catch {
    throw new ApiError('cursor is not a valid pagination cursor');
  }

  const match = decoded.match(/^offset:(\d+)$/);
  if (!match) throw new ApiError('cursor is not a valid pagination cursor');
  return Number.parseInt(match[1], 10);
}

interface MemberRow {
  member_id: string;
  contact_id: string;
  added_at: string;
}

interface MemberCursor {
  /** `null` marks a legacy id-only cursor, which needs resolving before use. */
  addedAt: string | null;
  id: string;
}

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeMemberCursor(addedAt: string, id: string): string {
  return btoa(`${addedAt}|${id}`);
}

/**
 * Decode a member cursor.
 *
 * Cursors used to be a bare member id, from when this paged on `id` alone. Those
 * are still accepted so a pagination already in flight when this deployed - an
 * n8n workflow midway through a 116-page list, say - finishes rather than 400s.
 */
function decodeMemberCursor(url: URL): MemberCursor | null {
  const raw = url.searchParams.get('cursor');
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = atob(raw);
  } catch {
    throw new ApiError('cursor is not a valid pagination cursor');
  }

  if (UUID_ONLY.test(decoded)) return { addedAt: null, id: decoded };

  const split = decoded.lastIndexOf('|');
  const addedAt = split === -1 ? '' : decoded.slice(0, split);
  const id = split === -1 ? '' : decoded.slice(split + 1);
  if (!addedAt || !UUID_ONLY.test(id) || Number.isNaN(Date.parse(addedAt))) {
    throw new ApiError('cursor is not a valid pagination cursor');
  }
  return { addedAt, id };
}

/**
 * Turn a legacy id-only cursor into a keyset position.
 *
 * The old cursor named a member row, so read its `added_at` and resume from
 * there. A row deleted in the meantime leaves nothing to resume from; restarting
 * the list beats erroring out mid-walk.
 */
async function resolveLegacyCursor(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  listId: string,
  memberId: string,
): Promise<MemberCursor | null> {
  const { data, error } = await supabase
    .from('lead_list_members')
    .select('id, added_at')
    .eq('id', memberId)
    .eq('list_id', listId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? { addedAt: String(data.added_at), id: String(data.id) } : null;
}

/**
 * Attach each member's contact.
 *
 * Both reads return identifiers only, so hydrate in one round trip and re-impose
 * the page's ordering, which `.in()` does not preserve. The organization filter
 * is belt-and-braces: the list was already checked, but a contact moved between
 * organizations should not leak through a stale membership row.
 */
async function hydrateMembers(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
  page: MemberRow[],
): Promise<Array<Record<string, unknown>>> {
  let contactsById = new Map<string, Record<string, unknown>>();

  if (page.length > 0) {
    const { data: contacts, error } = await supabase
      .from('crm_contacts')
      .select(MEMBER_CONTACT_COLUMNS)
      .eq('organization_id', organizationId)
      .in('id', page.map((m) => m.contact_id));

    if (error) throw new Error(error.message);
    contactsById = new Map(
      (contacts || []).map((c: Record<string, unknown>) => [String(c.id), c]),
    );
  }

  return page.map((m) => ({
    id: m.member_id,
    contact_id: m.contact_id,
    added_at: m.added_at,
    contact: contactsById.get(m.contact_id) ?? null,
  }));
}

/** Confirm a list exists inside the caller's organization before touching it. */
async function assertListInOrg(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  listId: string,
  organizationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('lead_lists')
    .select('id')
    .eq('id', listId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ApiError('List not found', 404);
}

function contactIdsFrom(body: Record<string, unknown>): string[] {
  const raw = body.contactIds ?? body.contact_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError('contactIds[] is required and must be non-empty');
  }
  if (raw.length > MAX_MEMBER_BATCH) {
    throw new ApiError(`Maximum ${MAX_MEMBER_BATCH} contacts per request (received ${raw.length})`);
  }
  return (raw as unknown[]).map((v, i) => requireUuid(v, `contactIds[${i}]`));
}

Deno.serve(createResource({
  /* ── Read ────────────────────────────────────────────────────── */
  GET: async ({ url, supabase, caller }) => {
    const limit = parseLimit(url);

    if (url.searchParams.get('resource') === 'members') {
      const listId = requireUuid(url.searchParams.get('listId'), 'listId');
      await assertListInOrg(supabase, listId, caller.organization_id);

      /* ── Filtered read ─────────────────────────────────────────
       * Delegates to the Advanced Filters engine the app already uses, so the
       * API and the UI agree on what a filter means rather than growing a
       * second, subtly different interpretation of "has an email".
       */
      const filtersParam = url.searchParams.get('filters');
      if (filtersParam) {
        let filters: Record<string, unknown>;
        try {
          filters = JSON.parse(filtersParam) as Record<string, unknown>;
        } catch {
          throw new ApiError('filters must be a JSON object, url-encoded');
        }
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
          throw new ApiError('filters must be a JSON object');
        }

        const offset = decodeOffsetCursor(url);

        const { data: matched, error: filterError } = await supabase.rpc(
          'filter_lead_list_member_rows',
          { p_list_id: listId, p_filters: filters, p_limit: limit + 1, p_offset: offset },
        );
        if (filterError) throw new Error(filterError.message);

        const matches = (matched || []) as MemberRow[];
        const hasMore = matches.length > limit;
        const page = hasMore ? matches.slice(0, limit) : matches;

        return json({
          success: true,
          data: await hydrateMembers(supabase, caller.organization_id, page),
          has_more: hasMore,
          next_cursor: hasMore ? btoa(`offset:${offset + limit}`) : null,
        });
      }

      /* ── Unfiltered read ──────────────────────────────────
       * Keyed on (added_at DESC, id DESC) — the order the filtered path already
       * returns, and the exact shape of idx_lead_list_members_list_added_id, so a
       * page costs a page-sized index range scan.
       *
       * Ordering on `id` alone, as this did, matched no index: every page scanned
       * the list's whole partition and top-N sorted it, which is O(list size) per
       * page and quadratic over a full pass. On an 11.5k-member list at limit=100
       * that was 820 buffers a page, 116 pages over, and under load one crossed
       * the caller role's 8s statement_timeout and 500'd.
       *
       * The row comparison lives in `lead_list_member_page` because PostgREST
       * cannot express `(added_at, id) < (?, ?)`, and its OR-expansion degrades
       * straight back to a filter over the full partition.
       */
      const after = decodeMemberCursor(url);
      const resumeFrom = after && after.addedAt === null
        ? await resolveLegacyCursor(supabase, listId, after.id)
        : after;

      const { data: paged, error: pageError } = await supabase.rpc('lead_list_member_page', {
        p_list_id: listId,
        p_limit: limit + 1,
        p_after_added_at: resumeFrom?.addedAt ?? null,
        p_after_id: resumeFrom?.id ?? null,
      });
      if (pageError) throw new Error(pageError.message);

      const members = (paged || []) as MemberRow[];
      const hasMore = members.length > limit;
      const page = hasMore ? members.slice(0, limit) : members;
      const last = page[page.length - 1];

      return json({
        success: true,
        data: await hydrateMembers(supabase, caller.organization_id, page),
        has_more: hasMore,
        next_cursor: hasMore && last ? encodeMemberCursor(last.added_at, last.member_id) : null,
      });
    }

    const id = url.searchParams.get('id');
    if (id) {
      const listId = requireUuid(id, 'id');
      const { data, error } = await supabase
        .from('lead_lists')
        .select(LIST_COLUMNS)
        .eq('organization_id', caller.organization_id)
        .eq('id', listId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new ApiError('List not found', 404);
      return json({ success: true, data });
    }

    const listCursor = decodeCursor(url);
    let query = supabase
      .from('lead_lists')
      .select(LIST_COLUMNS)
      .eq('organization_id', caller.organization_id)
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (listCursor) query = query.gt('id', listCursor);

    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);

    const sourceType = url.searchParams.get('source_type');
    if (sourceType) query = query.eq('source_type', sourceType);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return json({ success: true, ...paginated(data || [], limit, 'id') });
  },

  /* ── Create list / add members ───────────────────────────────── */
  POST: async ({ url, supabase, caller, body }) => {
    if (url.searchParams.get('resource') === 'members') {
      const listId = requireUuid(body.listId ?? body.list_id, 'listId');
      await assertListInOrg(supabase, listId, caller.organization_id);

      // Two ways to name the contacts: explicit ids, or a source list plus the
      // filters that select from it. The second exists so "add everyone in list
      // A with an email to list B" is one request instead of paging a few
      // hundred thousand ids down and straight back up again.
      const sourceListId = body.sourceListId ?? body.source_list_id;
      let contactIds: string[];

      if (sourceListId !== undefined) {
        const filters = body.filters;
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
          throw new ApiError('filters must be an object when sourceListId is given');
        }

        contactIds = await resolveContactIdsFromSourceList(
          supabase,
          requireUuid(sourceListId, 'sourceListId'),
          caller.organization_id,
          filters as Record<string, unknown>,
          // One over the ceiling, so "too many" is distinguishable from "exactly
          // at the limit" instead of quietly copying a truncated subset.
          MAX_SOURCE_LIST_MATCHES + 1,
        );

        if (contactIds.length === 0) {
          return json({ success: true, added: 0, skipped: 0, total_submitted: 0 });
        }

        // A few hundred thousand matches would run past the request timeout
        // and report nothing, so refuse rather than half-finish.
        if (contactIds.length > MAX_SOURCE_LIST_MATCHES) {
          throw new ApiError(
            `Those filters match ${contactIds.length} contacts, over the ${MAX_SOURCE_LIST_MATCHES} limit for one request. Narrow the filters.`,
          );
        }
      } else {
        contactIds = contactIdsFrom(body);
      }

      const result = await addContactsToList(supabase, caller.organization_id, listId, contactIds);
      return json({ success: true, ...result });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ApiError('name is required');

    const sourceType = typeof body.source_type === 'string' ? body.source_type : 'manual';
    if (!SOURCE_TYPES.includes(sourceType)) {
      throw new ApiError(`source_type must be one of: ${SOURCE_TYPES.join(', ')}`);
    }

    const { data, error } = await supabase
      .from('lead_lists')
      .insert({
        organization_id: caller.organization_id,
        name,
        description: typeof body.description === 'string' ? body.description : null,
        source_type: sourceType,
        status: 'active',
        created_by: caller.user_id,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return json({ success: true, data }, 201);
  },

  /* ── Update ──────────────────────────────────────────────────── */
  PATCH: async ({ url, supabase, caller, body }) => {
    const listId = requireUuid(url.searchParams.get('id'), 'id');

    const updates: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.description === 'string') updates.description = body.description;
    if (typeof body.status === 'string') {
      if (!['active', 'archived'].includes(body.status)) {
        throw new ApiError('status must be active or archived');
      }
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) {
      throw new ApiError('Supply at least one of: name, description, status');
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('lead_lists')
      .update(updates)
      .eq('organization_id', caller.organization_id)
      .eq('id', listId)
      .select(LIST_COLUMNS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ApiError('List not found', 404);
    return json({ success: true, data });
  },

  /* ── Remove members ──────────────────────────────────────────── */
  DELETE: async ({ url, supabase, caller, body }) => {
    if (url.searchParams.get('resource') !== 'members') {
      throw new ApiError(
        'Deleting a list is not supported over the API. Archive it with PATCH /v1/lists/{id} instead.',
        405,
      );
    }

    const listId = requireUuid(body.listId ?? body.list_id ?? url.searchParams.get('listId'), 'listId');
    await assertListInOrg(supabase, listId, caller.organization_id);
    const result = await removeContactsFromList(supabase, listId, contactIdsFrom(body));
    return json({ success: true, ...result });
  },
}));
