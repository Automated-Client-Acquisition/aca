/**
 * mailtester-verify-kickoff — async entry point for Mailtester Ninja
 * verification of large lists.
 *
 * Body:
 *   {
 *     organization_id: uuid,
 *     emails?: string[],
 *     contact_ids?: uuid[],
 *     lead_ids?: uuid[],
 *     list_id?: uuid              // optional, just for reporting / UI grouping
 *   }
 *
 * Flow:
 *   1. Resolve target emails (emails > contact_ids > lead_ids).
 *   2. Heuristic short-circuits in-memory (free): malformed / disposable / role.
 *   3. Cache lookup against email_address_verifications (30-day TTL).
 *   4. Persist heuristic results so they're cached for next time too.
 *   5. Insert a mailtester_verification_jobs row with the survivors as
 *      pending_emails. The cron-driven worker drains them at the plan's RPS.
 *
 * Returns: { job_id, total, pre_pass_resolved, queued, pre_pass_counts: {...} }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  type MailtesterNinjaPlan,
  type VerificationRecord,
  type VerificationStatus,
} from '../_shared/list-verifier.ts';
import { isDisposableEmail } from '../_shared/disposable-domains.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// PostgREST encodes `.in()` values in the request URL. UUID batches of 1,000
// exceed practical proxy URL limits and return a 400, so keep lookups small.
const CONTACT_LOOKUP_CHUNK_SIZE = 200;
function normalize(email: string): { ok: boolean; lower: string; local: string; domain: string } {
  const trimmed = (email ?? '').trim();
  if (!EMAIL_RE.test(trimmed)) {
    return { ok: false, lower: trimmed.toLowerCase(), local: '', domain: '' };
  }
  const lower = trimmed.toLowerCase();
  const at = lower.lastIndexOf('@');
  return { ok: true, lower, local: lower.slice(0, at), domain: lower.slice(at + 1) };
}

interface KickoffBody {
  organization_id: string;
  emails?: string[];
  contact_ids?: string[];
  lead_ids?: string[];
  list_id?: string;
}

function isMailtesterPlan(value: unknown): value is MailtesterNinjaPlan {
  return value === 'starter' || value === 'pro' || value === 'ultimate';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: KickoffBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON' }, 400);
  }

  const { organization_id, emails, contact_ids, lead_ids, list_id } = body;
  if (!organization_id) return jsonResponse({ success: false, error: 'organization_id required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // AuthN — JWT or service-role bearer
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  }
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole = token === serviceKey;
  let userId: string | null = null;
  if (!isServiceRole) {
    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    userId = userRes.user.id;

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', organization_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // Resolve org's Mailtester key + plan
  const { data: apiKeyRow } = await supabase
    .from('api_keys')
    .select('metadata')
    .eq('organization_id', organization_id)
    .eq('provider', 'mailtester_ninja')
    .maybeSingle();
  if (!apiKeyRow) {
    return jsonResponse({
      success: false,
      error: 'Mailtester Ninja API key not found. Add a key in Settings → Integrations.',
    }, 400);
  }
  const metadataPlan = (apiKeyRow.metadata as Record<string, unknown> | null)?.plan;
  const plan: MailtesterNinjaPlan = isMailtesterPlan(metadataPlan) ? metadataPlan : 'pro';

  // Resolve target emails
  const targetEmails: string[] = [];
  let inputSummary: string;
  if (emails && emails.length > 0) {
    targetEmails.push(...emails);
    inputSummary = `emails[${emails.length}]`;
  } else if (lead_ids && lead_ids.length > 0) {
    for (let i = 0; i < lead_ids.length; i += CONTACT_LOOKUP_CHUNK_SIZE) {
      const chunk = lead_ids.slice(i, i + CONTACT_LOOKUP_CHUNK_SIZE);
      const { data: leads, error: leadsErr } = await supabase
        .from('leads')
        .select('email')
        .eq('organization_id', organization_id)
        .in('id', chunk);
      if (leadsErr) {
        return jsonResponse({ success: false, error: `Failed to resolve leads: ${leadsErr.message}` }, 500);
      }
      for (const l of (leads ?? []) as Array<{ email: string | null }>) {
        if (l.email) targetEmails.push(l.email);
      }
    }
    inputSummary = `lead_ids[${lead_ids.length}]`;
  } else if (contact_ids && contact_ids.length > 0) {
    const seen = new Set<string>();
    for (let i = 0; i < contact_ids.length; i += CONTACT_LOOKUP_CHUNK_SIZE) {
      const chunk = contact_ids.slice(i, i + CONTACT_LOOKUP_CHUNK_SIZE);
      const { data: contacts, error: contactsErr } = await supabase
        .from('crm_contacts')
        .select('primary_email')
        .eq('organization_id', organization_id)
        .in('id', chunk);
      if (contactsErr) {
        return jsonResponse({ success: false, error: `Failed to resolve contacts: ${contactsErr.message}` }, 500);
      }
      for (const c of (contacts ?? []) as Array<{ primary_email: string | null }>) {
        const e = c.primary_email?.trim();
        if (e && !seen.has(e.toLowerCase())) {
          seen.add(e.toLowerCase());
          targetEmails.push(e);
        }
      }
    }
    inputSummary = `contact_ids[${contact_ids.length}]`;
  } else if (list_id) {
    // "Verify the whole list" shortcut — avoids shipping 70k+ UUIDs in the
    // POST body. Verifies list ownership against the calling org, then asks
    // a JSONB-returning Postgres function for every primary_email in the
    // list. Single round-trip; bypasses PostgREST's db_max_rows = 1000 cap
    // (defined in 20260606020000_get_lead_list_member_ids.sql).
    const { data: listRow, error: listErr } = await supabase
      .from('lead_lists')
      .select('id, organization_id')
      .eq('id', list_id)
      .maybeSingle();
    if (listErr) {
      return jsonResponse({ success: false, error: `Failed to look up list: ${listErr.message}` }, 500);
    }
    if (!listRow) {
      return jsonResponse({ success: false, error: 'List not found' }, 404);
    }
    if (listRow.organization_id !== organization_id) {
      return jsonResponse({ success: false, error: 'List does not belong to this organization' }, 403);
    }

    const { data: rpcEmails, error: rpcErr } = await supabase.rpc('get_lead_list_member_emails', {
      p_list_id: list_id,
    });
    if (rpcErr) {
      return jsonResponse({ success: false, error: `Failed to read list members: ${rpcErr.message}` }, 500);
    }
    if (Array.isArray(rpcEmails)) {
      for (const e of rpcEmails as Array<string | null>) {
        if (typeof e === 'string' && e.trim().length > 0) targetEmails.push(e);
      }
    }
    inputSummary = `list_id=${list_id}`;
  } else {
    return jsonResponse({ success: false, error: 'One of emails, contact_ids, lead_ids, or list_id is required' }, 400);
  }

  console.log(`[mailtester-kickoff] org=${organization_id} input=${inputSummary} → ${targetEmails.length} unique emails resolved`);

  if (targetEmails.length === 0) {
    return jsonResponse({ success: false, error: 'No emails resolved from the input' }, 400);
  }
  // Upper guard on a single kickoff. The worker is built to drain arbitrarily
  // large lists (paced slices of pending_emails at the plan's RPS), and all
  // kickoffs for an org merge into one active job anyway — so this is just a
  // sanity ceiling, not a throughput limit. Real reverse-IP / Visitor-ID lists
  // run 150k+, so 100k was rejecting legitimate whole-list verifies.
  if (targetEmails.length > 250_000) {
    return jsonResponse({ success: false, error: 'Maximum 250,000 addresses per kickoff. Split the request.' }, 400);
  }

  // 1. Dedup + heuristic short-circuit (free)
  const dedup = Array.from(new Set(targetEmails.map((e) => e?.trim().toLowerCase()).filter(Boolean)));
  const total = dedup.length;
  const heuristicRows: Array<Omit<VerificationRecord, 'raw_response'> & { raw_response: unknown }> = [];
  const survivors: string[] = [];

  for (const email of dedup) {
    const norm = normalize(email);
    if (!norm.ok) {
      heuristicRows.push({
        email,
        email_lower: norm.lower,
        domain: norm.domain,
        local_part: norm.local,
        status: 'invalid',
        provider: 'heuristic',
        smtp_response_code: null,
        is_disposable: false,
        is_role: false,
        is_catch_all: false,
        is_spamtrap: false,
        raw_response: { reason: 'malformed' },
      });
      continue;
    }
    if (isDisposableEmail(email)) {
      heuristicRows.push({
        email,
        email_lower: norm.lower,
        domain: norm.domain,
        local_part: norm.local,
        status: 'disposable',
        provider: 'heuristic',
        smtp_response_code: null,
        is_disposable: true,
        is_role: false,
        is_catch_all: false,
        is_spamtrap: false,
        raw_response: { reason: 'disposable_domain' },
      });
      continue;
    }
    survivors.push(email);
  }

  // 2. Cache lookup against email_address_verifications (30-day TTL)
  const cachedHits = new Set<string>();
  const cacheCounts = { valid: 0, invalid: 0, disposable: 0, role: 0, catch_all: 0, unknown: 0 } as Record<VerificationStatus, number>;
  if (survivors.length > 0) {
    const survivorsLower = survivors.map((e) => e.toLowerCase());
    for (let i = 0; i < survivorsLower.length; i += 500) {
      const slice = survivorsLower.slice(i, i + 500);
      const { data: cached } = await supabase
        .from('email_address_verifications')
        .select('email_lower, status, provider')
        .eq('organization_id', organization_id)
        .in('email_lower', slice)
        .gt('expires_at', new Date().toISOString());
      for (const row of (cached ?? []) as Array<{ email_lower: string; status: VerificationStatus; provider: string }>) {
        // Provider-level unknowns are not useful cache hits: if the user runs
        // Mailtester again, spend the call and let the worker try for a real
        // ok/ko/mb result instead of preserving a stale "Unknown" badge.
        if (row.status === 'unknown') continue;
        // Old heuristic role verdicts never reached Mailtester: verify them now.
        if (row.status === 'role' && row.provider === 'heuristic') continue;
        cachedHits.add(row.email_lower);
        cacheCounts[row.status] = (cacheCounts[row.status] ?? 0) + 1;
      }
    }
  }
  const queueEmails = survivors.filter((e) => !cachedHits.has(e.toLowerCase()));

  // 3. Persist heuristic rows (chunked upsert)
  let prePassValid = 0;
  let prePassInvalid = 0;
  let prePassRole = 0;
  let prePassDisposable = 0;
  if (heuristicRows.length > 0) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const verifiedAt = new Date().toISOString();
    for (let i = 0; i < heuristicRows.length; i += 1000) {
      const slice = heuristicRows.slice(i, i + 1000).map((r) => ({
        organization_id,
        ...r,
        verified_at: verifiedAt,
        expires_at: expiresAt,
      }));
      const { error } = await supabase
        .from('email_address_verifications')
        .upsert(slice, { onConflict: 'organization_id,email_lower' });
      if (error) {
        console.warn('[mailtester-kickoff] heuristic upsert failed:', error.message);
      }
    }
    for (const r of heuristicRows) {
      if (r.status === 'invalid') prePassInvalid += 1;
      else if (r.status === 'disposable') prePassDisposable += 1;
      else if (r.status === 'role') prePassRole += 1;
      else if (r.status === 'valid') prePassValid += 1;
    }
  }

  const prePassResolved = heuristicRows.length + cachedHits.size;
  const validIncrement = prePassValid + (cacheCounts.valid ?? 0);
  const invalidIncrement = prePassInvalid + prePassDisposable + (cacheCounts.invalid ?? 0) + (cacheCounts.disposable ?? 0);
  const catchAllIncrement = cacheCounts.catch_all ?? 0;
  const unknownIncrement = prePassRole + (cacheCounts.role ?? 0) + (cacheCounts.unknown ?? 0);

  // 4a. If there's already an active (queued/running) job for this org, merge
  //     the new survivors into its pending_emails instead of inserting a
  //     sibling row. The org-level mutex in try_claim_mailtester_job would
  //     otherwise block the new job until the active one finishes, which
  //     looks like "the second list isn't being verified" from the UI.
  //
  //     The RPC takes a row lock on the target job so the worker can't race
  //     the append, dedupes against what's already pending, and returns NULL
  //     when no active job exists (in which case we fall through to insert).
  const { data: mergeRows, error: mergeErr } = await supabase.rpc('merge_into_active_mailtester_job', {
    p_organization_id: organization_id,
    p_new_emails: queueEmails,
    p_new_total_increment: total,
    p_pre_pass_increment: prePassResolved,
    p_valid_increment: validIncrement,
    p_invalid_increment: invalidIncrement,
    p_catch_all_increment: catchAllIncrement,
    p_unknown_increment: unknownIncrement,
    p_list_id: list_id ?? null,
  });
  if (mergeErr) {
    console.warn(`[mailtester-kickoff] merge attempt failed (will fall through to insert): ${mergeErr.message}`);
  }
  const merged = Array.isArray(mergeRows) && mergeRows.length > 0
    ? (mergeRows[0] as { id: string; appended: number; pending_after: number; total_after: number })
    : null;

  if (merged) {
    console.log(`[mailtester-kickoff] merged into active job ${merged.id}: appended=${merged.appended}, pending_after=${merged.pending_after}, total_after=${merged.total_after}`);
    return jsonResponse({
      success: true,
      job_id: merged.id,
      status: 'running',
      total: merged.total_after,
      pre_pass_resolved: prePassResolved,
      queued: merged.appended,
      plan,
      merged_into_existing: true,
      pre_pass_counts: {
        heuristic: {
          valid: prePassValid,
          invalid: prePassInvalid,
          disposable: prePassDisposable,
          role: prePassRole,
        },
        cache: cacheCounts,
      },
    });
  }

  // 4b. No active job — insert a fresh one.
  const { data: job, error: jobErr } = await supabase
    .from('mailtester_verification_jobs')
    .insert({
      organization_id,
      created_by: userId,
      list_id: list_id ?? null,
      plan,
      pending_emails: queueEmails,
      total,
      pre_pass_resolved: prePassResolved,
      // pre-load cumulative counts so the UI shows the heuristic + cache hits up front
      processed: prePassResolved,
      valid: validIncrement,
      invalid: invalidIncrement,
      catch_all: catchAllIncrement,
      unknown: unknownIncrement,
      status: queueEmails.length === 0 ? 'succeeded' : 'queued',
      finished_at: queueEmails.length === 0 ? new Date().toISOString() : null,
    })
    .select('id, status, total, pre_pass_resolved')
    .single();

  if (jobErr || !job) {
    return jsonResponse({
      success: false,
      error: `Failed to create job: ${jobErr?.message ?? 'unknown'}`,
    }, 500);
  }

  // Mirror the existing job.list_id into the junction table so the per-list
  // view is consistent for fresh jobs and merged jobs.
  if (list_id) {
    const { error: junctionErr } = await supabase
      .from('mailtester_job_lists')
      .upsert({
        job_id: job.id,
        list_id,
        emails_contributed: queueEmails.length,
      }, { onConflict: 'job_id,list_id' });
    if (junctionErr) {
      console.warn(`[mailtester-kickoff] junction insert failed for job ${job.id}: ${junctionErr.message}`);
    }
  }

  return jsonResponse({
    success: true,
    job_id: job.id,
    status: job.status,
    total,
    pre_pass_resolved: prePassResolved,
    queued: queueEmails.length,
    plan,
    merged_into_existing: false,
    pre_pass_counts: {
      heuristic: {
        valid: prePassValid,
        invalid: prePassInvalid,
        disposable: prePassDisposable,
        role: prePassRole,
      },
      cache: cacheCounts,
    },
  });
});
