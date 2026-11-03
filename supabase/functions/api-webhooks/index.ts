/**
 * REST resource: /v1/webhooks
 *
 *   GET    /v1/webhooks           list this organization's subscriptions
 *   GET    /v1/webhooks/{id}      fetch one
 *   POST   /v1/webhooks           create (or re-point) a subscription
 *   PATCH  /v1/webhooks/{id}      change events / URL / active flag
 *   DELETE /v1/webhooks/{id}      remove it, and everything still queued for it
 *
 * This exists because `organization_webhook_settings` holds exactly ONE URL per
 * organization. That is fine for a human pasting a URL into Settings; it is
 * unusable for an integration that must register and unregister its own endpoint
 * — which is precisely what the n8n trigger node does on every activation and on
 * every "Listen for test event". Subscriptions are additive: the legacy single
 * URL keeps receiving everything it received before.
 *
 * `secret` is returned on read. That is deliberate: the caller already holds a
 * full-organization API token, and n8n does not persist workflow static data
 * across manual executions, so the trigger node has to be able to re-read the
 * signing key it was given at create time.
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

const SUBSCRIPTION_COLUMNS =
  'id, target_url, events, filters, secret, is_active, source, max_attempts, created_at, updated_at';

/**
 * Mirrors webhook_subscriptions_events_known. Every entry here is emitted by a
 * live database trigger — trigger_contact_webhook, trigger_message_webhook,
 * trigger_tag_webhook, trigger_enrollment_webhook, trigger_handoff_webhook,
 * trigger_list_member_webhook or trigger_signal_lead_webhook.
 * Do not add an event to this list without also adding the thing that emits it;
 * `lead_captured` sat in the UI unemitted for eight months.
 */
const WEBHOOK_EVENTS = [
  'contact_created',
  'contact_updated',
  'stage_changed',
  'score_changed',
  'message_received',
  'message_sent',
  'tag_added',
  'tag_removed',
  'sequence_completed',
  'lead_replied',
  'handoff_requested',
  'list_member_added',
  'list_member_removed',
  'signal_lead_added',
  'campaign_entry_decided',
];

/**
 * A cap, not a quota. Each active subscription multiplies rows in
 * `webhook_event_log`, which has already had to be drained once.
 */
const MAX_SUBSCRIPTIONS_PER_ORG = 20;

const SOURCE_RE = /^[a-z0-9_-]{1,32}$/;

/** Hosts the delivery worker must never be pointed at. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // IPv4 literals in loopback, link-local and RFC1918 space.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function parseTargetUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new ApiError('target_url is required');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError('target_url must be an absolute URL');
  }

  // The delivery worker runs server-side, so http:// to a private address would
  // be a request from ACA's own network, not from the caller's.
  if (parsed.protocol !== 'https:') {
    throw new ApiError('target_url must use https');
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new ApiError('target_url must be publicly reachable');
  }
  return parsed.toString();
}

function parseEvents(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(`events[] is required. Supported: ${WEBHOOK_EVENTS.join(', ')}`);
  }
  const events = Array.from(new Set(raw.map((v) => String(v))));
  const unknown = events.filter((e) => !WEBHOOK_EVENTS.includes(e));
  if (unknown.length > 0) {
    throw new ApiError(
      `Unsupported event(s): ${unknown.join(', ')}. Supported: ${WEBHOOK_EVENTS.join(', ')}`,
    );
  }
  return events;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A list filter beyond this is a sign somebody meant "all lists". */
const MAX_FILTER_LIST_IDS = 50;

/**
 * Narrow the events a subscription receives.
 *
 * Only `{ list_ids: [...] }` exists, and it only applies to the two
 * list_member_* events — `webhook_subscription_matches()` in the database is the
 * authority, and it ignores everything else. Unknown keys are rejected here
 * rather than silently dropped, so a typo'd filter fails loudly at registration
 * instead of quietly delivering everything.
 *
 * An empty array is not a filter that matches nothing; it means "every list",
 * exactly as an absent one does. That mirrors n8n, where clearing the picker is
 * how you say "stop filtering".
 */
function parseFilters(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError('filters must be an object, e.g. {"list_ids": ["<uuid>"]}');
  }

  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => key !== 'list_ids');
  if (unknown.length > 0) {
    throw new ApiError(`Unsupported filter key(s): ${unknown.join(', ')}. Supported: list_ids`);
  }

  if (input.list_ids === undefined || input.list_ids === null) return {};
  if (!Array.isArray(input.list_ids)) {
    throw new ApiError('filters.list_ids must be an array of lead list IDs');
  }

  const listIds = Array.from(new Set(input.list_ids.map((v) => String(v).trim()))).filter(Boolean);
  if (listIds.length === 0) return {};
  if (listIds.length > MAX_FILTER_LIST_IDS) {
    throw new ApiError(
      `filters.list_ids accepts at most ${MAX_FILTER_LIST_IDS} lead lists. Leave it empty to receive every list.`,
    );
  }

  const malformed = listIds.filter((id) => !UUID_RE.test(id));
  if (malformed.length > 0) {
    throw new ApiError(`filters.list_ids must contain lead list UUIDs. Not a UUID: ${malformed[0]}`);
  }

  return { list_ids: listIds };
}

/** Handlers below all act on one tenant; the platform service-role caller has none. */
function requireOrg(organizationId: string | null): string {
  if (!organizationId) {
    throw new ApiError('This endpoint requires an organization-scoped API token', 403);
  }
  return organizationId;
}

Deno.serve(createResource({
  /* ── Read ────────────────────────────────────────────────────── */
  GET: async ({ url, supabase, caller }) => {
    const organizationId = requireOrg(caller.organization_id);
    const id = url.searchParams.get('id');

    if (id) {
      const subscriptionId = requireUuid(id, 'id');
      const { data, error } = await supabase
        .from('webhook_subscriptions')
        .select(SUBSCRIPTION_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('id', subscriptionId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new ApiError('Webhook subscription not found', 404);
      return json({ success: true, data });
    }

    const limit = parseLimit(url);
    const cursor = decodeCursor(url);

    let query = supabase
      .from('webhook_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('organization_id', organizationId)
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (cursor) query = query.gt('id', cursor);

    // Lets the n8n trigger's checkExists ask about exactly one URL instead of
    // paging the whole list.
    const targetUrl = url.searchParams.get('target_url');
    if (targetUrl) query = query.eq('target_url', targetUrl);

    const event = url.searchParams.get('event');
    if (event) query = query.contains('events', [event]);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return json({ success: true, ...paginated(data || [], limit, 'id') });
  },

  /* ── Create ──────────────────────────────────────────────────── */
  POST: async ({ supabase, caller, body }) => {
    const organizationId = requireOrg(caller.organization_id);
    const targetUrl = parseTargetUrl(body.target_url ?? body.targetUrl);
    const events = parseEvents(body.events);
    const filters = parseFilters(body.filters);

    const source = typeof body.source === 'string' ? body.source.trim() : 'api';
    if (!SOURCE_RE.test(source)) {
      throw new ApiError('source must be 1-32 characters of a-z, 0-9, hyphen or underscore');
    }

    // Re-registering the same URL updates it in place rather than 409-ing. The
    // n8n trigger re-runs create() whenever the selected events drift, and a
    // conflict there would strand the workflow with no way to self-heal.
    const { data: existing, error: existingError } = await supabase
      .from('webhook_subscriptions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('target_url', targetUrl)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    if (existing) {
      const { data, error } = await supabase
        .from('webhook_subscriptions')
        // POST is a full re-registration, so filters are replaced, not merged:
        // clearing the list picker in n8n has to actually clear the filter.
        .update({ events, filters, is_active: true, source })
        .eq('id', existing.id)
        .select(SUBSCRIPTION_COLUMNS)
        .single();

      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    const { count, error: countError } = await supabase
      .from('webhook_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_ORG) {
      throw new ApiError(
        `This organization already has ${MAX_SUBSCRIPTIONS_PER_ORG} webhook subscriptions. Delete one before creating another.`,
        409,
      );
    }

    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .insert({
        organization_id: organizationId,
        target_url: targetUrl,
        events,
        filters,
        source,
        created_by: caller.user_id,
      })
      .select(SUBSCRIPTION_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return json({ success: true, data }, 201);
  },

  /* ── Update ──────────────────────────────────────────────────── */
  PATCH: async ({ url, supabase, caller, body }) => {
    const organizationId = requireOrg(caller.organization_id);
    const subscriptionId = requireUuid(url.searchParams.get('id'), 'id');

    const updates: Record<string, unknown> = {};
    if (body.events !== undefined) updates.events = parseEvents(body.events);
    if (body.filters !== undefined) updates.filters = parseFilters(body.filters);
    if (body.target_url !== undefined || body.targetUrl !== undefined) {
      updates.target_url = parseTargetUrl(body.target_url ?? body.targetUrl);
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') throw new ApiError('is_active must be a boolean');
      updates.is_active = body.is_active;
    }
    if (Object.keys(updates).length === 0) {
      throw new ApiError('Supply at least one of: events, filters, target_url, is_active');
    }

    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .update(updates)
      .eq('organization_id', organizationId)
      .eq('id', subscriptionId)
      .select(SUBSCRIPTION_COLUMNS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ApiError('Webhook subscription not found', 404);
    return json({ success: true, data });
  },

  /* ── Delete ──────────────────────────────────────────────────── */
  DELETE: async ({ url, supabase, caller }) => {
    const organizationId = requireOrg(caller.organization_id);
    const subscriptionId = requireUuid(url.searchParams.get('id'), 'id');

    // Deleting cascades to any rows still queued for this subscription — a
    // destination that no longer exists must not keep receiving deliveries.
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', subscriptionId)
      .select('id');

    if (error) throw new Error(error.message);

    // Idempotent on purpose: the n8n trigger calls delete() during teardown and
    // must not fail a workflow deactivation because the row was already gone.
    return json({ success: true, deleted: (data || []).length });
  },
}));
