/**
 * Enroll Leads (Bulk)
 *
 * Server-side bulk enrollment that handles tens of thousands of leads.
 * Accepts either a list of contact IDs or a lead_list_id, resolves
 * crm_contacts → leads records (creating as needed), then bulk-inserts
 * enrollments with proper next_send_at from sequence settings.
 *
 * Two modes:
 *   { sequenceId, contactIds: string[] }               — enroll specific contacts
 *   { sequenceId, listId: string }                     — enroll one lead list
 *   { sequenceId, listIds: string[] }                  — enroll several lead lists (union)
 *   { sequenceId, listIds | contactIds, background: true } — queue an email_enrollment_jobs row (202)
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { resolveMailboxPool } from '../_shared/mailbox-pool.ts';
import { runInBatches, selectInChunks } from '../_shared/chunked-query.ts';
import { findLeadsActiveInOtherSequences } from '../_shared/enrollment-guards.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import { calculateInitialSendTime, staggerSendTimes } from '../_shared/send-window.ts';
import { previewEnrollment, sequenceRequiresGeneratedContent, hasEnrollmentContent, enrollmentRequestBody } from '../_shared/enrollment-preview.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INSERT_BATCH = 500;
/** PostgREST's default max_rows. A range wider than this is silently truncated. */
const SOURCE_PAGE_MAX = 1000;
const MAILBOX_POOL_QUERY_CHUNK = 150;
const LIST_PAGE_DEFAULT = 2500;
const LIST_PAGE_MAX = 5000;
/** contactIds one background request may carry (~7.6MB of JSON at the cap). */
const BACKGROUND_CONTACT_IDS_MAX = 200_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getReadyMailboxIds(
  supabase: any,
  organizationId: string,
  sequenceId: string,
  seqSettings: Record<string, unknown>,
  configuredMailboxIds?: string[],
): Promise<string[]> {
  // Auto mode: resolve the pool with the shared resolver so pre-assignment
  // matches what the sender will actually use — tag rule, health floor,
  // blocked domains, daily-target sizing, and the warmup graduation bar.
  // Warming mailboxes stay status='ready' while they warm, so a raw
  // ready+connected query here would pre-assign them and the sender's sticky
  // path would then send campaign traffic from them.
  const selection = seqSettings.mailbox_selection as
    | { mode?: string }
    | null
    | undefined;
  if (selection?.mode === 'auto') {
    const pool = await resolveMailboxPool(supabase, organizationId, sequenceId, {
      mailbox_ids: configuredMailboxIds ?? null,
      mailbox_selection: selection as any,
    });
    return pool.mailboxIds ?? [];
  }

  const fetchChunk = async (mailboxIds?: string[]) => {
    let query = supabase
      .from('email_mailboxes')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      .eq('imap_connected', true);
    if (mailboxIds?.length) query = query.in('id', mailboxIds);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to resolve sequence mailboxes: ${error.message}`);
    return (data || []).map((mailbox: { id: string }) => mailbox.id);
  };

  if (!configuredMailboxIds?.length) return fetchChunk();

  const mailboxIds: string[] = [];
  for (let i = 0; i < configuredMailboxIds.length; i += MAILBOX_POOL_QUERY_CHUNK) {
    mailboxIds.push(...await fetchChunk(configuredMailboxIds.slice(i, i + MAILBOX_POOL_QUERY_CHUNK)));
  }
  return mailboxIds;
}


// ---------- Main handler ----------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate the caller (JWT or CLI token) and derive their org.
    const body = await req.json();
    // Keep preview audiences nested: an older deployment must reject this
    // request for having no audience, rather than silently enroll it.
    const dryRun = body.dryRun === true;
    if (dryRun && ['contactIds', 'listId', 'listIds', 'sourceSequenceId'].some((key) => key in body)) {
      return new Response(JSON.stringify({ error: 'dryRun audiences must be provided in previewSource' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const enrollmentBody = enrollmentRequestBody(body);
    const {
      sequenceId, organizationId: requestedOrgId, contactIds: rawContactIds, listId, listIds: rawListIds,
      sourceSequenceId, sourceOffset, sourceLimit, listOffset, listLimit,
      filters, delayHours, continueFromConversationId, allowConcurrent, moveFromSequenceId,
      customDataByContactId,
    } = enrollmentBody as {
      sequenceId: string;
      organizationId?: string;
      contactIds?: string[];
      /**
       * Enroll everyone currently in ANOTHER sequence — the audience half of
       * "duplicate this sequence with its leads". Resolved here rather than by
       * the caller because only this function has the budget to page five
       * figures of enrollments and run them through the guards below.
       *
       * Paged, because the platform kills a request at 150s and a five-figure
       * audience does not fit in one: the caller loops on the returned
       * `sourceCursor` until `done`. Each page is independently complete — a
       * loop that stops early leaves correctly enrolled leads behind, not
       * half-written ones.
       */
      sourceSequenceId?: string;
      /** Row offset into the source's enrollments, ordered by lead_id. Default 0. */
      sourceOffset?: number;
      /**
       * Leads per page. Default and max 1000 — PostgREST caps a range request
       * at 1000 rows, so asking for more silently returns 1000 and would make
       * the page look short (i.e. "done") when the source has plenty left.
       */
      sourceLimit?: number;
      /**
       * Page a list audience. A 50k list in one call dies with 546 (worker
       * limit), so callers pass listOffset and loop on `sourceCursor` until
       * `done`. Ids are sorted so the window is stable across calls; omitted →
       * the whole audience in one call, as before.
       */
      listOffset?: number;
      /** Contacts per list page. Default 2500, max 5000. */
      listLimit?: number;
      listId?: string;
      listIds?: string[]; // multiple lead lists — union of their members
      filters?: Record<string, unknown>; // optional: "select all matching" — resolve the filtered subset of the list
      delayHours?: number; // optional delay before first email (hours)
      continueFromConversationId?: string; // optional: continue an existing email thread (same mailbox + thread)
      /**
       * Opt OUT of one-active-sequence-per-lead. Off by default: a lead live in
       * two sequences gets two unrelated cold threads from two different
       * mailboxes, and nothing downstream reconciles them (a bounce only stops
       * its own sequence). Set true only for deliberate multi-touch.
       */
      allowConcurrent?: boolean;
      /**
       * Atomic move: terminally stop these leads' enrollments in this sequence
       * once they are enrolled in the target. Without it, "pause A, enrol into B"
       * leaves A dormant-but-active and double-sends the day A is resumed.
       */
      moveFromSequenceId?: string;
      /**
       * Per-enrollment variable overrides, keyed by crm_contact id. Written to
       * email_sequence_enrollments.custom_data, where the sender resolves them
       * for {{email_subject_N}} / {{email_body_N}} (stored as
       * custom_email_N_subject / custom_email_N_body). Used by lead processing
       * to hand each contact its own AI-written sequence.
       */
      customDataByContactId?: Record<string, Record<string, string>>;
    };

    // A thread continuation is BY DEFINITION concurrent with the sequence that
    // started the thread — that is the feature (interested-reply follow-ups
    // thread into the same conversation). Exclusivity must not break it.
    const enforceExclusivity = allowConcurrent !== true && !continueFromConversationId;

    // Normalize to a de-duped list of list IDs. Back-compat: a single `listId`
    // is treated as a one-element `listIds`. `filters` (select-all-matching)
    // only applies to the single-list path.
    const listIds: string[] = Array.from(new Set([
      ...(Array.isArray(rawListIds) ? rawListIds : []),
      ...(listId ? [listId] : []),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0)));

    // Internal service-role invocations are used by the discovery exporter
    // after a verified email is persisted. Keep the normal user/API-token
    // auth path for all external callers and require an explicit org id for
    // internal calls to preserve tenant isolation.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const presented = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const isInternal = !!serviceKey && presented === serviceKey;
    let callerOrgId: string;
    let callerUserId: string | null = null;
    if (isInternal) {
      if (!requestedOrgId) {
        return new Response(JSON.stringify({ error: 'organizationId is required for internal enrollment' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerOrgId = requestedOrgId;
    } else {
      try {
        // This function uses the npm Supabase client while cli-auth's shared
        // type is sourced from esm.sh; both clients have the same runtime
        // contract, but TypeScript treats their protected members as distinct.
        // Preserve shared security checks and token-use audit bookkeeping.
        // The preview branch below changes no outreach/business state.
        const caller = await authenticateRequest(
          req,
          supabase as unknown as Parameters<typeof authenticateRequest>[1],
        );
        callerOrgId = caller.organization_id;
        callerUserId = caller.user_id;
      } catch (err) {
        return unauthorized(err, corsHeaders);
      }
    }

    if (!sequenceId) {
      return new Response(
        JSON.stringify({ error: 'sequenceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If the caller passed an organizationId, verify it matches their auth context.
    // Reject mismatches — prevents cross-org enrollment.
    if (requestedOrgId && requestedOrgId !== callerOrgId) {
      return new Response(
        JSON.stringify({ error: 'organizationId does not match the authenticated caller' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const organizationId = callerOrgId;

    // ===== 0. Background mode =====
    // An audience too big for one request becomes an email_enrollment_jobs
    // row; process-email-enrollment-jobs snapshots it and feeds it back here as
    // contactIds pages. Returns at once with the job id — progress is read
    // off the job row, so closing the tab no longer stops the enrollment.
    // Lists are snapshotted in SQL by the worker; hand-picked contactIds are
    // written into the snapshot by create_email_enrollment_job itself.
    if (body.background === true && !dryRun) {
      const badRequest = (error: string, status = 400) => new Response(JSON.stringify({ error }), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      const backgroundContactIds = listIds.length ? [] : [...new Set(
        (Array.isArray(rawContactIds) ? rawContactIds : []).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)),
      )];
      if (!listIds.length && !backgroundContactIds.length) {
        return badRequest('background enrollment requires listIds or contactIds');
      }
      if (backgroundContactIds.length > BACKGROUND_CONTACT_IDS_MAX) {
        return badRequest(`background enrollment takes at most ${BACKGROUND_CONTACT_IDS_MAX} contactIds; put them in a list and enroll the list`);
      }
      // Per-contact options only make sense on the synchronous path.
      if (customDataByContactId || continueFromConversationId || moveFromSequenceId || allowConcurrent) {
        return badRequest('background enrollment does not support customDataByContactId, continueFromConversationId, moveFromSequenceId or allowConcurrent');
      }
      const [{ data: seq, error: seqLookupErr }, { data: ownedLists, error: ownedErr }] = await Promise.all([
        supabase.from('email_sequences').select('id').eq('id', sequenceId).eq('organization_id', organizationId).maybeSingle(),
        listIds.length
          ? supabase.from('lead_lists').select('id').in('id', listIds).eq('organization_id', organizationId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (seqLookupErr) throw seqLookupErr;
      if (ownedErr) throw ownedErr;
      if (!seq) return badRequest('Sequence not found', 404);
      if ((ownedLists?.length ?? 0) !== listIds.length) return badRequest('List not found', 404);
      // Contact ids are not checked against the org here: every page goes
      // back through the crm_contacts lookup below, which is org-scoped, so a
      // foreign id is simply never enrolled.
      const { data: job, error: jobErr } = await supabase.rpc('create_email_enrollment_job', {
        p_org: organizationId,
        p_sequence_id: sequenceId,
        p_list_ids: listIds,
        p_filters: listIds.length === 1 && filters && Object.keys(filters).length > 0 ? filters : null,
        p_delay_hours: typeof delayHours === 'number' && delayHours > 0 ? delayHours : null,
        p_created_by: callerUserId,
        p_contact_ids: backgroundContactIds.length ? backgroundContactIds : null,
      });
      if (jobErr) throw jobErr;
      console.log(
        `[enroll-leads] Background job ${JSON.stringify(job)} for sequence ${sequenceId} ` +
        `(${listIds.length ? `${listIds.length} list(s)` : `${backgroundContactIds.length} contact(s)`})`,
      );
      return new Response(JSON.stringify({ background: true, ...(job as Record<string, unknown>) }), {
        status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== 1. Resolve contact IDs =====
    let contactIds: string[];

    // Resolve one list to its contact IDs. Smart lists evaluate filter_criteria
    // against crm_contacts in real time (so lead_list_members is empty for them
    // — use the RPC). `applyFilters` ("select all matching") only kicks in for
    // the single-list path, where the caller passed `filters`.
    const resolveListContactIds = async (
      oneListId: string,
      applyFilters: boolean,
    ): Promise<string[]> => {
      const { data: listMeta, error: listMetaError } = await supabase
        .from('lead_lists')
        .select('is_smart')
        .eq('id', oneListId)
        .maybeSingle();
      if (listMetaError) throw listMetaError;
      const isSmart = (listMeta as { is_smart?: boolean } | null)?.is_smart === true;

      if (isSmart) {
        const { data: rpcRows, error: rpcErr } = await supabase.rpc(
          'smart_list_eligible_contact_ids',
          { p_list_id: oneListId },
        );
        if (rpcErr) throw rpcErr;
        return Array.isArray(rpcRows)
          ? rpcRows.map((r: unknown) => (typeof r === 'string' ? r : (r as { smart_list_eligible_contact_ids?: string }).smart_list_eligible_contact_ids ?? ''))
            .filter((id: string) => id.length > 0)
          : [];
      }

      if (applyFilters && filters && Object.keys(filters).length > 0) {
        // "Select all matching" — resolve only the filtered subset server-side,
        // via the same predicate that drives the table, so we enroll exactly
        // what the user saw (not the whole list).
        const { data: ids, error: filtErr } = await supabase.rpc('get_filtered_lead_list_member_ids', {
          p_list_id: oneListId,
          p_filters: filters,
        });
        if (filtErr) throw filtErr;
        return Array.isArray(ids) ? (ids as string[]) : [];
      }

      // Fetch ALL members of the static list (paginate past PostgREST 1000-row default)
      const PAGE_SIZE = 1000;
      const out: string[] = [];
      let offset = 0;
      while (true) {
        const { data: page, error: membersErr } = await supabase
          .from('lead_list_members')
          .select('contact_id')
          .eq('list_id', oneListId)
          .range(offset, offset + PAGE_SIZE - 1);
        if (membersErr) throw membersErr;
        if (!page || page.length === 0) break;
        out.push(...page.map((m: { contact_id: string }) => m.contact_id));
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return out;
    };

    // Everyone currently in another sequence, as contact ids. Enrollments point
    // at `leads`; the `source='crm_contact'` mirror carries the contact id.
    // Leads with no mirror row can't be enrolled here and are counted below.
    const resolveSourceSequenceContactIds = async (
      srcSequenceId: string,
      offset: number,
      limit: number,
    ): Promise<{ ids: string[]; leadCount: number; withoutContact: number; done: boolean }> => {
      // (sequence_id, lead_id) is unique, so a window of rows IS a window of
      // distinct leads — ordering by lead_id keeps paging stable across calls.
      const { data, error } = await supabase
        .from('email_sequence_enrollments')
        .select('lead_id')
        .eq('sequence_id', srcSequenceId)
        .order('lead_id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;

      const all = (data || []).map((r: { lead_id: string }) => r.lead_id);
      const done = all.length < limit;
      if (all.length === 0) return { ids: [], leadCount: 0, withoutContact: 0, done };

      const leads = await selectInChunks<{ id: string; source_id: string | null }>(
        supabase, 'leads', 'id, source_id', 'id', all,
        (q) => q.eq('organization_id', organizationId).eq('source', 'crm_contact'),
      );
      const ids = [...new Set(leads.map((l) => l.source_id).filter((id): id is string => !!id))];
      return { ids, leadCount: all.length, withoutContact: all.length - leads.length, done };
    };

    let leadsWithoutContact = 0;
    let sourceCursor: { offset: number; processed: number; done: boolean } | undefined;

    if (sourceSequenceId) {
      // Guard against enrolling a sequence from itself — a no-op that would
      // still burn the whole resolution pass.
      if (sourceSequenceId === sequenceId) {
        return new Response(
          JSON.stringify({ error: 'sourceSequenceId must differ from sequenceId' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: srcSeq, error: srcSeqError } = await supabase
        .from('email_sequences')
        .select('id')
        .eq('id', sourceSequenceId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (srcSeqError) throw srcSeqError;
      if (!srcSeq) {
        return new Response(
          JSON.stringify({ error: 'Source sequence not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const offset = Math.max(0, Number(sourceOffset) || 0);
      const limit = Math.min(SOURCE_PAGE_MAX, Math.max(1, Number(sourceLimit) || SOURCE_PAGE_MAX));
      const resolved = await resolveSourceSequenceContactIds(sourceSequenceId, offset, limit);
      contactIds = resolved.ids;
      leadsWithoutContact = resolved.withoutContact;
      sourceCursor = {
        offset: offset + resolved.leadCount,
        processed: resolved.leadCount,
        done: resolved.done,
      };
      console.log(
        `[enroll-leads] Source sequence ${sourceSequenceId} [${offset}, ${offset + limit}): ` +
        `${resolved.leadCount} lead(s) → ${contactIds.length} contact(s) ` +
        `(${leadsWithoutContact} without a CRM contact, done=${resolved.done})`,
      );
    } else if (listIds.length) {
      // Service-role client bypasses RLS: every list must belong to the caller's org,
      // or another tenant's contacts would be copied into this org and emailed.
      const { data: ownedLists, error: ownedErr } = await supabase
        .from('lead_lists')
        .select('id')
        .in('id', listIds)
        .eq('organization_id', organizationId);
      if (ownedErr) throw ownedErr;
      if ((ownedLists?.length ?? 0) !== new Set(listIds).size) {
        return new Response(
          JSON.stringify({ error: 'List not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // `filters` (select-all-matching) only applies when a single list is in play.
      const applyFilters = listIds.length === 1;
      const seen = new Set<string>();
      for (const oneListId of listIds) {
        const ids = await resolveListContactIds(oneListId, applyFilters);
        for (const id of ids) seen.add(id);
      }
      contactIds = Array.from(seen);
      if (typeof listOffset === 'number') {
        const offset = Math.max(0, Math.floor(listOffset));
        const limit = Math.min(LIST_PAGE_MAX, Math.max(1, Number(listLimit) || LIST_PAGE_DEFAULT));
        const page = contactIds.sort().slice(offset, offset + limit);
        sourceCursor = {
          offset: offset + page.length,
          processed: page.length,
          done: offset + page.length >= contactIds.length,
        };
        console.log(`[enroll-leads] List page [${offset}, ${offset + page.length}) of ${contactIds.length}`);
        contactIds = page;
      }
    } else if (rawContactIds?.length) {
      contactIds = [...new Set(rawContactIds)];
    } else {
      return new Response(
        JSON.stringify({ error: 'Either contactIds, listId, listIds, or sourceSequenceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[enroll-leads] Starting: ${contactIds.length} contacts → sequence ${sequenceId}`);

    // ===== 2. Fetch sequence settings + steps for scheduling =====
    const { data: sequence, error: seqErr } = await supabase
      .from('email_sequences')
      .select('id, organization_id, settings, steps, enroll_filter_criteria')
      .eq('id', sequenceId)
      .eq('organization_id', organizationId)
      .single();

    if (seqErr || !sequence) {
      return new Response(
        JSON.stringify({ error: 'Sequence not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (dryRun) {
      const preview = await previewEnrollment(supabase, {
        organizationId, sequenceId, contactIds, listIds, sequence,
        enforceExclusivity, customDataByContactId, leadsWithoutContact,
      });
      return new Response(JSON.stringify({ ...preview, sourceCursor }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (contactIds.length === 0) {
      return new Response(
        JSON.stringify({ enrolled: 0, skipped: 0, noEmail: 0, suppressed: 0, alreadyInAnotherSequence: 0, moved: 0, leadsWithoutContact, sourceCursor }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let filteredOut = 0;
    let awaitingPipeline = 0;

    // ===== 2b. Enrollment filter =====
    // Read off the sequence rather than trusting the caller, so EVERY route in
    // (the auto-enroll cron, bulk enroll from the UI, MCP) gets the same gate —
    // a filter only the cron honoured would contradict itself on the first fill.
    // Same criteria shape and same engine as smart lists.
    const enrollCriteria = (sequence as { enroll_filter_criteria?: Record<string, unknown> })
      .enroll_filter_criteria;
    if (enrollCriteria && Object.keys(enrollCriteria).length > 0) {
      const beforeFilter = contactIds.length;
      const { data: kept, error: gateErr } = await supabase.rpc('filter_contact_ids_by_criteria', {
        p_org: (sequence as { organization_id?: string }).organization_id ?? requestedOrgId,
        p_ids: contactIds,
        p_criteria: enrollCriteria,
      });
      if (gateErr) throw gateErr;
      contactIds = Array.isArray(kept) ? (kept as string[]) : [];
      filteredOut = beforeFilter - contactIds.length;
      console.log(
        `[enroll-leads] Enrollment filter: ${beforeFilter} → ${contactIds.length} contacts`,
      );
      if (contactIds.length === 0) {
        return new Response(
          JSON.stringify({
            enrolled: 0, skipped: beforeFilter, noEmail: 0, suppressed: 0,
            alreadyInAnotherSequence: 0, moved: 0, filteredOut: beforeFilter,
            leadsWithoutContact, sourceCursor,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ===== 2c. Pipeline-owned gate =====
    // When a list's processing setup routes its approved leads into THIS
    // sequence, the list is pipeline-owned: qualify → enrich → verify decides
    // who enters. Pulling the whole list here (the Ongoing cron, or a bulk
    // enroll from the builder) would bypass that gate and contact rejected or
    // still-processing leads. Only applies to the list path — the pipeline
    // itself routes by contactIds, and a mixed attach is passed through
    // untouched (see filter_contact_ids_by_pipeline_gate).
    if (listIds.length > 0) {
      const beforeGate = contactIds.length;
      const { data: allowed, error: gateErr } = await supabase.rpc(
        'filter_contact_ids_by_pipeline_gate',
        {
          p_org: (sequence as { organization_id?: string }).organization_id ?? organizationId,
          p_list_ids: listIds,
          p_dest_type: 'email_sequence',
          p_dest_id: sequenceId,
          p_ids: contactIds,
        },
      );
      if (gateErr) throw gateErr;
      contactIds = Array.isArray(allowed) ? (allowed as string[]) : contactIds;
      awaitingPipeline = beforeGate - contactIds.length;
      if (contactIds.length !== beforeGate) {
        console.log(
          `[enroll-leads] Pipeline gate: ${beforeGate} → ${contactIds.length} contacts ` +
          `(${beforeGate - contactIds.length} not yet approved by lead processing)`,
        );
      }
      if (contactIds.length === 0) {
        return new Response(
          JSON.stringify({
            enrolled: 0, skipped: filteredOut + beforeGate, noEmail: 0, suppressed: 0,
            alreadyInAnotherSequence: 0, moved: 0, awaitingPipeline: beforeGate,
            filteredOut,
            leadsWithoutContact, sourceCursor,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Calculate initial send time, respecting:
    // 1. Client-provided delayHours (from batch enrollment UI)
    // 2. Step 0 delay (if sequence starts with a delay step)
    // 3. Send window settings
    const seqSteps = (sequence.steps as Array<{ order: number; type: string; delay_hours?: number }>) || [];
    const step0 = seqSteps.find(s => s.order === 0);
    const step0DelayHours = step0?.type === 'delay' ? (step0.delay_hours || 0) : 0;
    const effectiveDelayHours = delayHours ?? step0DelayHours;

    let nextSendAtDate = calculateInitialSendTime(
      (sequence.settings as Record<string, unknown>) || {}
    );
    if (effectiveDelayHours > 0) {
      // Push the send time forward by the delay — the processor's adjustToSendWindow
      // will re-adjust if it lands outside the window when it picks up the enrollment.
      nextSendAtDate = new Date(nextSendAtDate.getTime() + effectiveDelayHours * 60 * 60 * 1000);
    }
    const nextSendAt = nextSendAtDate.toISOString();

    // ===== 3. Fetch contact details (email required) =====
    const contacts = await selectInChunks(supabase, 'crm_contacts',
      'id, first_name, last_name, primary_email, job_title, company, primary_linkedin_url, status',
      'id', contactIds,
      (q) => q.eq('organization_id', organizationId));

    const contactMap = new Map(contacts.map((c: any) => [c.id, c]));

    // Filter out suppressed contacts (PECR / opt-out) — never enroll a contact
    // that has unsubscribed, is do-not-contact, or has hard-bounced. The send
    // path also guards this, but stopping at enrollment avoids creating dead
    // active rows in the first place.
    const SUPPRESSED_CONTACT_STATUSES = new Set(['unsubscribed', 'do_not_contact', 'bounced']);
    const enrollableContacts = contacts.filter((c: any) => !SUPPRESSED_CONTACT_STATUSES.has(c.status));
    const suppressedCount = contacts.length - enrollableContacts.length;

    // Filter out contacts without email
    const contactsWithEmail = enrollableContacts.filter((c: any) => c.primary_email);
    const noEmailCount = enrollableContacts.length - contactsWithEmail.length;
    const validContactIds = contactsWithEmail.map((c: any) => c.id as string);

    if (validContactIds.length === 0) {
      return new Response(
        JSON.stringify({ enrolled: 0, skipped: filteredOut + awaitingPipeline, filteredOut, awaitingPipeline, noEmail: noEmailCount, suppressed: suppressedCount, alreadyInAnotherSequence: 0, moved: 0, leadsWithoutContact, sourceCursor }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== 4. Resolve existing leads (crm_contact → leads via source_id) =====
    const existingLeads = await selectInChunks(supabase, 'leads',
      'id, source_id', 'source_id', validContactIds,
      (q) => q.eq('organization_id', organizationId).eq('source', 'crm_contact'));

    const sourceToLeadId = new Map(existingLeads.map((l: any) => [l.source_id as string, l.id as string]));

    // ===== 5. Create missing leads in batches =====
    const toCreate: any[] = [];
    for (const contactId of validContactIds) {
      if (sourceToLeadId.has(contactId)) continue;
      const c = contactMap.get(contactId);
      if (!c) continue;
      toCreate.push({
        organization_id: organizationId,
        email: c.primary_email,
        first_name: c.first_name || null,
        last_name: c.last_name || null,
        company: c.company || null,
        job_title: c.job_title || null,
        linkedin_url: c.primary_linkedin_url || null,
        source: 'crm_contact',
        source_id: contactId,
      });
    }

    if (toCreate.length > 0) {
      console.log(`[enroll-leads] Creating ${toCreate.length} new lead records`);
      const createdBatches = await runInBatches(toCreate, INSERT_BATCH, async (batch) => {
        const { data: newLeads, error: createErr } = await supabase
          .from('leads')
          .insert(batch)
          .select('id, source_id');
        if (createErr) throw createErr;
        return newLeads || [];
      });
      for (const lead of createdBatches.flat()) {
        sourceToLeadId.set(lead.source_id, lead.id);
      }
    }

    // Re-key any caller-supplied per-contact overrides onto lead ids, now that
    // every enrollable contact has one. Only reached the enrollment row on an
    // INSERT — a duplicate keeps its existing custom_data rather than having a
    // live enrollment's content rewritten mid-sequence.
    const customDataByLeadId = new Map<string, Record<string, string>>();
    if (customDataByContactId) {
      for (const [contactId, customData] of Object.entries(customDataByContactId)) {
        const leadId = sourceToLeadId.get(contactId);
        if (leadId && customData && Object.keys(customData).length > 0) {
          customDataByLeadId.set(leadId, customData);
        }
      }
    }

    // A sequence whose email steps are written entirely out of per-contact
    // variables ({{email_subject_N}} / {{email_body_N}}) has NO content of its
    // own — lead processing's write_message stage is the only thing that fills
    // it, and it hands that content over as `customDataByContactId`. Any other
    // inflow (the every-15-min auto-enroll cron, bulk enroll from the UI, MCP)
    // arrives with nothing, and the sender resolves the missing variables to ''
    // — which on 2026-08-06 put 61 completely blank emails on the wire.
    //
    // Fail closed: such a sequence only accepts contacts that arrive WITH their
    // written emails. The sender carries the same guard as a backstop.
    const requiresGeneratedContent = sequenceRequiresGeneratedContent(sequence.steps);
    let missingContentSkipped = 0;

    // ===== 6. Fetch available mailboxes for round-robin pre-assignment =====
    const seqSettings = (sequence.settings as Record<string, unknown>) || {};
    const settingsMailboxIds = Array.isArray(seqSettings.mailbox_ids)
      ? seqSettings.mailbox_ids.filter((id): id is string => typeof id === 'string')
      : undefined;
    const availableMailboxIds = await getReadyMailboxIds(supabase, organizationId, sequenceId, seqSettings, settingsMailboxIds);

    if (settingsMailboxIds?.length && availableMailboxIds.length === 0) {
      throw new Error("None of the sequence's configured mailboxes are ready and connected");
    }

    if (availableMailboxIds.length > 0) {
      console.log(`[enroll-leads] Pre-assigning ${availableMailboxIds.length} mailbox(es) via round-robin`);
    }

    // ===== 7. Build enrollment rows =====
    const resolvedLeadIds: string[] = [];
    for (const contactId of validContactIds) {
      const leadId = sourceToLeadId.get(contactId);
      if (!leadId) continue;
      // See requiresGeneratedContent above: no written emails → no enrollment.
      if (requiresGeneratedContent) {
        const written = customDataByLeadId.get(leadId);
        if (!hasEnrollmentContent(written)) {
          missingContentSkipped++;
          continue;
        }
      }
      resolvedLeadIds.push(leadId);
    }

    if (missingContentSkipped > 0) {
      console.warn(`[enroll-leads] Skipped ${missingContentSkipped} contact(s) for sequence ${sequenceId}: its steps use per-contact {{email_subject_N}}/{{email_body_N}} but no written emails were supplied`);
    }

    if (resolvedLeadIds.length === 0) {
      return new Response(
        JSON.stringify({
          enrolled: 0, skipped: filteredOut + awaitingPipeline, filteredOut, awaitingPipeline, noEmail: noEmailCount, suppressed: suppressedCount,
          alreadyInAnotherSequence: 0, moved: 0, missingContent: missingContentSkipped,
          leadsWithoutContact, sourceCursor,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== 8. One active sequence per lead =====
    // The category default (Smartlead / Instantly / HeyReach all ship this on):
    // a lead already being worked by another sequence is skipped rather than
    // given a second, unrelated cold thread from a different mailbox. Nothing
    // downstream reconciles two concurrent threads — a bounce stops only its own
    // sequence — so the duplicate is invisible until the prospect notices.
    //
    // Enforced here rather than in the UI: check-enrollment-conflicts already
    // detected this and only ever produced a warning, which is why 44k active
    // enrollments carry no guarantee of uniqueness.
    let dedupedLeadIds = [...new Set(resolvedLeadIds)];
    let concurrentSkipped = 0;

    if (enforceExclusivity && dedupedLeadIds.length > 0) {
      const busy = await findLeadsActiveInOtherSequences(supabase, organizationId, dedupedLeadIds, sequenceId);
      if (busy.size > 0) {
        const before = dedupedLeadIds.length;
        dedupedLeadIds = dedupedLeadIds.filter((id) => !busy.has(id));
        concurrentSkipped = before - dedupedLeadIds.length;
        console.log(`[enroll-leads] Skipped ${concurrentSkipped} lead(s) already active in another sequence`);
      }
    }

    if (dedupedLeadIds.length === 0) {
      return new Response(
        JSON.stringify({
          enrolled: 0, skipped: filteredOut + awaitingPipeline, filteredOut, awaitingPipeline, noEmail: noEmailCount,
          suppressed: suppressedCount, alreadyInAnotherSequence: concurrentSkipped, moved: 0,
          missingContent: missingContentSkipped, leadsWithoutContact, sourceCursor,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== 9. Upsert enrollments in batches =====
    let totalEnrolled = 0;

    console.log(`[enroll-leads] Upserting ${dedupedLeadIds.length} enrollments`);

    // Duplicate path only. Enrolling a copied audience inserts every lead with one
    // identical next_send_at, which is a full ORDER BY next_send_at tie — the
    // sender's FIFO claim then returns an arbitrary slice of the pool each poll
    // rather than a stable order. Spread them so the copy drains predictably.
    // Every other caller (list, campaign) keeps the single shared timestamp.
    const staggeredSendTimes = sourceSequenceId
      ? staggerSendTimes(
          dedupedLeadIds.length,
          (sequence.settings as Record<string, unknown>) || {},
          nextSendAtDate,
        )
      : null;
    if (staggeredSendTimes) {
      console.log(
        `[enroll-leads] Staggered ${staggeredSendTimes.length} sends: ` +
          `${staggeredSendTimes[0].toISOString()} → ` +
          `${staggeredSendTimes[staggeredSendTimes.length - 1].toISOString()}`,
      );
    }

    const enrollmentRows = dedupedLeadIds.map((lead_id, idx) => ({
      sequence_id: sequenceId,
      lead_id,
      current_step: 0,
      status: 'active',
      next_send_at: staggeredSendTimes
        ? staggeredSendTimes[idx].toISOString()
        : nextSendAt,
      ...(customDataByLeadId.has(lead_id) ? { custom_data: customDataByLeadId.get(lead_id) } : {}),
      // For a thread continuation, stamp the conversation so the sender keeps the same
      // mailbox + thread (resolveContinuationAnchor); otherwise round-robin pre-assign a
      // mailbox from the sequence pool (processor may override at send time).
      ...(continueFromConversationId
        ? { metadata: { continue_from_conversation_id: continueFromConversationId } }
        : (availableMailboxIds.length > 0
            ? { mailbox_id: availableMailboxIds[idx % availableMailboxIds.length] }
            : {})),
    }));

    const upsertBatchCounts = await runInBatches(enrollmentRows, INSERT_BATCH, async (batch) => {
      const { data, error: upsertErr } = await supabase
        .from('email_sequence_enrollments')
        .upsert(batch, {
          onConflict: 'sequence_id,lead_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (upsertErr) throw upsertErr;
      return data?.length ?? 0;
    });
    totalEnrolled += upsertBatchCounts.reduce((sum, count) => sum + count, 0);

    const skipped = dedupedLeadIds.length - totalEnrolled + filteredOut + awaitingPipeline;

    // ===== 10. Move: terminally stop the source enrollments =====
    // Runs AFTER the upsert so a failure leaves the lead in the source sequence
    // rather than in neither — losing the lead entirely is worse than a
    // temporary overlap, and the overlap is visible while the source is paused.
    let moved = 0;
    const { data: moveSource } = moveFromSequenceId
      ? await supabase
        .from('email_sequences')
        .select('id')
        .eq('id', moveFromSequenceId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      : { data: null };
    if (moveFromSequenceId && !moveSource) {
      console.warn(`[enroll-leads] move: source sequence ${moveFromSequenceId} not in org ${organizationId}, skipping stop`);
    }
    if (moveSource && moveFromSequenceId !== sequenceId && dedupedLeadIds.length > 0) {
      const { data: stopped, error: stopErr } = await supabase.rpc('stop_sequence_enrollments', {
        p_sequence_id: moveFromSequenceId,
        p_lead_ids: dedupedLeadIds,
        p_reason: `moved to sequence ${sequenceId}`,
      });
      if (stopErr) {
        // Non-fatal: the leads ARE enrolled in the target. Surface it loudly so
        // the caller knows the source still holds live enrollments.
        console.error(`[enroll-leads] move: failed to stop source enrollments: ${stopErr.message}`);
      } else {
        moved = (stopped as number) ?? 0;
        console.log(`[enroll-leads] move: stopped ${moved} enrollment(s) in ${moveFromSequenceId}`);
      }
    }

    console.log(
      `[enroll-leads] Done: enrolled=${totalEnrolled}, skipped=${skipped}, noEmail=${noEmailCount}, ` +
      `suppressed=${suppressedCount}, alreadyInAnotherSequence=${concurrentSkipped}, moved=${moved}, ` +
      `missingContent=${missingContentSkipped}`,
    );

    return new Response(
      JSON.stringify({
        enrolled: totalEnrolled,
        skipped,
        filteredOut,
        awaitingPipeline,
        noEmail: noEmailCount,
        suppressed: suppressedCount,
        // Distinct from `skipped` (already in THIS sequence): these leads were
        // left alone because another sequence is already working them.
        alreadyInAnotherSequence: concurrentSkipped,
        moved,
        // Sequence is built on per-contact {{email_subject_N}}/{{email_body_N}}
        // and these contacts arrived without their written emails.
        missingContent: missingContentSkipped,
        // sourceSequenceId path only: leads with no crm_contact behind them.
        leadsWithoutContact,
        // sourceSequenceId path only: where the next page starts, and whether
        // the source is exhausted. Callers loop until `done`.
        sourceCursor,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[enroll-leads] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
