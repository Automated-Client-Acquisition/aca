import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { backgroundTasks } from "@/hooks/useBackgroundTasks";
import { readContactDeletionResponse } from "@/lib/contact-deletion-response";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { EnrichmentFilters } from "@/types/enrichment-filters";

// ============================================================================
// Types
// ============================================================================

export type ContactType = 'prospect' | 'lead' | 'contact';
export type OutreachStatus = 'unreached' | 'reached' | 'replied';
export type AiAnalysisStatus = 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed';

export interface CrmContact {
  id: string;
  organization_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  avatar_url: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  primary_linkedin_url: string | null;
  instagram_url: string | null;
  linkedin_bio: string | null;
  home_page_text: string | null;
  lead_score: number;
  lead_score_breakdown: Record<string, number>;
  lead_score_updated_at: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  stage_entered_at: string | null;
  custom_fields: Record<string, unknown>;
  tags: string[];
  source: string | null;
  source_campaign_id: string | null;
  source_details: Record<string, unknown>;
  status: 'active' | 'archived' | 'bounced' | 'unsubscribed' | 'do_not_contact';
  owner_user_id: string | null;
  first_seen_at: string;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  // Contact type: prospect (cold), lead (showed intent), contact (established relationship)
  // Note: This field may not exist until migration is applied - defaults to 'prospect'
  contact_type?: ContactType;
  // LinkedIn connection fields
  is_linkedin_connection: boolean;
  linkedin_connected_at: string | null;
  // Enrichment data from AI analysis
  enrichment_data: Record<string, unknown> | null;
  company_employee_count?: number | null;
  enriched_at: string | null;
  company_website: string | null;
  // Signal/discovery metadata used by signal-generated smart lists
  discovery_score?: number | null;
  discovery_signal_strength?: string | null;
  discovery_metadata?: Record<string, unknown> | null;
  // Location fields
  city: string | null;
  state: string | null;
  country: string | null;
  // Outreach and AI analysis status
  outreach_status: OutreachStatus;
  ai_analysis_status: AiAnalysisStatus;
  ai_analyzed_at: string | null;
  // Notion integration
  notion_preview_url: string | null;
  notion_page_id: string | null;
  // SEG firewall
  seg_provider: string | null;
  seg_checked_at: string | null;
  // Email verification (written by the verifyEmail sequence step / verifier)
  email_verification_status: string | null; // valid | invalid | catch_all | unknown | role | risky | …
  email_is_catch_all: boolean | null;
  email_is_role: boolean | null;
  email_is_deliverable: boolean | null;
  email_verified_at: string | null;
  // Joined data
  pipeline?: CrmPipeline;
  stage?: CrmPipelineStage;
  identities?: (CrmContactIdentity | CrmContactIdentityPartial)[];
}

// Partial identity type for list views (only fields needed for avatar fallback)
export interface CrmContactIdentityPartial {
  id: string;
  contact_id?: string;
  channel: string;
  platform_user_id: string;
  platform_avatar_url: string | null;
  linked_account_ids: string[] | null;
}

export interface CrmContactIdentity {
  id: string;
  contact_id: string;
  organization_id: string;
  channel: 'linkedin' | 'instagram' | 'email' | 'sms' | 'whatsapp' | 'twitter' | 'facebook';
  platform_user_id: string;
  platform_username: string | null;
  platform_profile_url: string | null;
  platform_avatar_url: string | null;
  platform_metadata: Record<string, unknown>;
  is_verified: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface CrmPipeline {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface CrmPipelineStage {
  id: string;
  pipeline_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  stage_order: number;
  stage_type: 'new' | 'active' | 'won' | 'lost';
  color: string;
  expected_days: number | null;
  // Default confidence (0-100) for deals in this stage; drives the weighted forecast.
  win_probability?: number | null;
  created_at: string;
  updated_at: string;
}

export type ContactSortField = 'last_activity_at' | 'display_name' | 'created_at' | 'lead_score' | 'first_seen_at';
export type SortDirection = 'asc' | 'desc';

/**
 * All Advanced Filters fields come from the shared EnrichmentFilters type
 * (src/types/enrichment-filters.ts) so this engine and the lead-list RPC
 * engine can't silently support different subsets. aiAnalysisStatus is
 * re-declared to allow the page-level 'all' sentinel.
 */
export interface ContactsFilters extends Omit<EnrichmentFilters, 'aiAnalysisStatus'> {
  search?: string;
  status?: CrmContact['status'] | 'all';
  pipeline_id?: string;
  stage_id?: string;
  tags?: string[];
  owner_user_id?: string;
  source?: string;
  min_score?: number;
  max_score?: number;
  page?: number;
  pageSize?: number;
  sortBy?: ContactSortField;
  sortDirection?: SortDirection;
  // LinkedIn connection filters
  linkedinOnly?: boolean;
  linkedAccountId?: string;
  // Contact type filter: prospect, lead, contact
  contactType?: ContactType | 'all';
  // Outreach and AI analysis filters
  outreachStatus?: OutreachStatus | 'all';
  // 'no_data' is a virtual status (see applyContactFilters): failed analysis OR no analyzable source.
  aiAnalysisStatus?: AiAnalysisStatus | 'no_data' | 'all';
  // Signal/discovery filters
  signalSubscriptionId?: string;
  signalTypes?: string[];
  signalMaxAgeDays?: number;
  minDiscoveryScore?: number;
  // List membership filters
  inListIds?: string[];
  notInListIds?: string[];
  // Optional polling interval (ms) — used to refresh rows during active analysis
  refetchInterval?: number | false;
}

export interface PaginatedContacts {
  data: CrmContact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** True when the search RPC hit its 1000-match cap — results (and total)
   *  are the top 1000 matches, not the full set. Surface this in the UI. */
  searchCapped?: boolean;
}

export interface CreateContactInput {
  display_name: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  avatar_url?: string;
  primary_email?: string;
  primary_phone?: string;
  primary_linkedin_url?: string;
  instagram_url?: string | null;
  linkedin_bio?: string;
  home_page_text?: string;
  company_website?: string;
  city?: string;
  state?: string;
  country?: string;
  pipeline_id?: string;
  stage_id?: string;
  custom_fields?: Record<string, unknown>;
  tags?: string[];
  source?: string;
  owner_user_id?: string;
}

export interface UpdateContactInput extends Partial<CreateContactInput> {
  id: string;
  status?: CrmContact['status'];
  lead_score?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

// ============================================================================
// Shared filter builder
// ============================================================================

/**
 * Max IDs to pass in a single PostgREST `.in()` filter.
 * Each UUID is ~39 chars URL-encoded (36 + %2C separator).
 * 100 × 39 ≈ 3.9 KB for IDs — safe margin under PostgREST's URL limit.
 */
const MAX_IN_CHUNK = 100;

/**
 * Execute a Supabase query that uses `.in()` on a potentially large ID array.
 * Splits into chunks of MAX_IN_CHUNK, runs them in parallel, and merges results.
 * `buildQuery(chunk)` should return a fully-configured query with `.in(col, chunk)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function chunkedIn<T = any>(
  ids: string[],
  buildQuery: (chunk: string[]) => any,
): Promise<T[]> {
  if (ids.length === 0) return [];
  if (ids.length <= MAX_IN_CHUNK) {
    const { data, error } = await buildQuery(ids);
    if (error) throw error;
    return (data || []) as T[];
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IN_CHUNK) {
    chunks.push(ids.slice(i, i + MAX_IN_CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await buildQuery(chunk);
      if (error) throw error;
      return (data || []) as T[];
    }),
  );

  return results.flat();
}

/**
 * Execute a Supabase DELETE/UPDATE mutation with .in() on a large ID array.
 * Runs in sequential chunks to avoid URL length limits.
 * `buildQuery(chunk)` should return a fully-configured query with `.in(col, chunk)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function chunkedMutate(
  ids: string[],
  buildQuery: (chunk: string[]) => any,
): Promise<void> {
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += MAX_IN_CHUNK) {
    const chunk = ids.slice(i, i + MAX_IN_CHUNK);
    const { error } = await buildQuery(chunk);
    if (error) throw error;
  }
}

function attachPipelineStage(
  contacts: CrmContact[],
  pipelineById: Record<string, CrmPipeline>,
  stageById: Record<string, CrmPipelineStage>,
): CrmContact[] {
  return contacts.map(c => ({
    ...c,
    pipeline: c.pipeline_id ? (pipelineById[c.pipeline_id] ?? undefined) : undefined,
    stage: c.stage_id ? (stageById[c.stage_id] ?? undefined) : undefined,
  }));
}

async function attachContactIdentities(contacts: CrmContact[], orgId: string): Promise<CrmContact[]> {
  const ids = contacts.map(contact => contact.id).filter(Boolean);
  if (ids.length === 0) return contacts;

  const identities = await chunkedIn<CrmContactIdentityPartial & { contact_id: string }>(
    ids,
    (chunk) => supabase
      .from('crm_contact_identities')
      .select('id, contact_id, channel, platform_user_id, platform_avatar_url, linked_account_ids')
      .eq('organization_id', orgId)
      .in('contact_id', chunk),
  );

  const identitiesByContactId = new Map<string, CrmContactIdentityPartial[]>();
  for (const identity of identities) {
    const existing = identitiesByContactId.get(identity.contact_id) ?? [];
    existing.push(identity);
    identitiesByContactId.set(identity.contact_id, existing);
  }

  return contacts.map(contact => ({
    ...contact,
    identities: identitiesByContactId.get(contact.id) ?? [],
  }));
}

/**
 * Fetch all rows from a paginated Supabase query (bypasses 1000-row server limit).
 * `buildQuery` must return a query that already has `.select()` applied.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllIds(
  buildQuery: () => any,
  idColumn = 'contact_id',
): Promise<string[]> {
  const PAGE_SIZE = 1000;
  const allIds: string[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery()
      .order(idColumn)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data || []) as Record<string, string>[];
    allIds.push(...rows.map(r => r[idColumn]));

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allIds;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Resolve EVERY contact ID matching a free-text search — no 1000-row cap.
 * Keyset-paginates search_crm_contacts_keyset by (organization_id, id) so each
 * page is index-bounded (the visible table keeps the fast, capped, recency-
 * ordered search_crm_contacts instead). Only for bulk paths — select-all and
 * export — where the full match set is the point and order is irrelevant.
 */
async function fetchAllSearchMatchIds(orgId: string, searchTerm: string): Promise<string[]> {
  const PAGE = 1000;
  const ids: string[] = [];
  let after = ZERO_UUID;
  // Safety valve against a truly pathological broad term walking the whole org.
  const HARD_CAP = 100_000;
  while (ids.length < HARD_CAP) {
    // @ts-ignore - RPC exists but not in generated types
    const { data, error } = await supabase.rpc('search_crm_contacts_keyset', {
      p_org_id: orgId,
      p_query: searchTerm,
      p_after_id: after,
      p_limit: PAGE,
    });
    if (error) throw error;
    const rows = ((data || []) as unknown as { contact_id: string }[]).map(r => r.contact_id);
    ids.push(...rows);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1]; // RPC orders by id — last id is the next cursor
  }
  return ids;
}

/** Wrap a value in percent-encoded double quotes for PostgREST .or() raw syntax.
 * PostgREST reserves , . : ( ) as delimiters — values containing these must be quoted. */
function pgrstValue(v: string): string {
  if (/[,.:()]/.test(v)) return `%22${v}%22`;
  return v;
}

/**
 * Narrow queries to a pre-resolved set of matching contact IDs (RPC-backed
 * filters like custom fields / custom questions). Chunked .in() clauses are
 * OR'd together; >2000 matches degrades to a no-op narrowing rather than an
 * oversized PostgREST URL (~72KB cap).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function narrowQueriesToIds(apply: (fn: (q: any) => any) => void, matchingIds: string[], label: string): void {
  if (matchingIds.length === 0) {
    apply(q => q.eq('id', '00000000-0000-0000-0000-000000000000'));
  } else if (matchingIds.length <= MAX_IN_CHUNK * 10) {
    const orClause = matchingIds
      .reduce<string[][]>((chunks, id, i) => {
        const chunkIdx = Math.floor(i / MAX_IN_CHUNK);
        (chunks[chunkIdx] ??= []).push(id);
        return chunks;
      }, [])
      .map(chunk => `id.in.(${chunk.join(',')})`)
      .join(',');
    apply(q => q.or(orClause));
  } else {
    console.warn(`[useContacts] ${label} matched ${matchingIds.length} contacts — skipping ID-based narrowing`);
  }
}

/** Apply the per-product ICP / decision-maker score conditions to a query that
 *  selects the contact_product_scores!inner join. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyIcpScoreConditions(query: any, filters: ContactsFilters | undefined): any {
  if (!filters?.icpProductId) return query;
  query = query.eq('contact_product_scores.product_id', filters.icpProductId);
  if (filters.minIcpScore !== undefined && filters.minIcpScore > 0)
    query = query.gte('contact_product_scores.icp_score', filters.minIcpScore);
  if (filters.maxIcpScore !== undefined && filters.maxIcpScore < 100)
    query = query.lte('contact_product_scores.icp_score', filters.maxIcpScore);
  if (filters.minDmScore !== undefined && filters.minDmScore > 0)
    query = query.gte('contact_product_scores.decision_maker_score', filters.minDmScore);
  if (filters.maxDmScore !== undefined && filters.maxDmScore < 100)
    query = query.lte('contact_product_scores.decision_maker_score', filters.maxDmScore);
  return query;
}

/**
 * True when any filter is active that narrows beyond a pre-resolved
 * search/list candidate set. When false, the candidate count IS the total and
 * the cheap slice-based pagination is exact.
 */
function hasCandidateNarrowingFilters(f: ContactsFilters | undefined): boolean {
  if (!f) return false;
  return !!(
    (f.status && f.status !== 'all') || f.pipeline_id || f.stage_id || f.owner_user_id ||
    f.source || f.min_score !== undefined || f.max_score !== undefined ||
    f.tags?.length || f.linkedinOnly || f.linkedAccountId ||
    (f.contactType && f.contactType !== 'all') ||
    (f.outreachStatus && f.outreachStatus !== 'all') ||
    (f.aiAnalysisStatus && f.aiAnalysisStatus !== 'all') ||
    f.signalSubscriptionId || f.signalTypes?.length ||
    (f.signalMaxAgeDays !== undefined && f.signalMaxAgeDays > 0) || f.minDiscoveryScore !== undefined ||
    f.icpProductId ||
    f.industries?.length || f.companySizes?.length || f.minEmployeeCount !== undefined || f.maxEmployeeCount !== undefined || f.seniorities?.length || f.departments?.length ||
    f.technologies?.length || f.emailVerified !== undefined || f.emailQuality?.length ||
    (f.minEmailConfidence !== undefined && f.minEmailConfidence > 0) || f.emailType ||
    f.countries?.length || f.cities?.length || f.hasEnrichmentData !== undefined ||
    f.isB2b !== undefined || f.revenueModels?.length || f.hasOutboundMotion !== undefined ||
    f.hiringSalesRoles !== undefined || f.runsAds !== undefined || f.detectedTechnologies?.length ||
    f.excludedTechnologies?.length || f.customQuestions?.length || f.customFieldConditions?.length ||
    f.hasNotionUrl !== undefined || f.hasEmail !== undefined || f.segFirewall
  );
}

/**
 * Resolve the intersection of all RPC-backed conditions (custom fields /
 * custom questions) as a Set of contact IDs, or null when none are active.
 * Resolving these once up front (instead of inside every chunked query via
 * applyContactFilters) avoids N× RPC calls, and client-side intersection is
 * exempt from the 2000-match URL cap.
 */
async function resolveRpcConditionIdSet(filters: ContactsFilters | undefined, orgId: string): Promise<Set<string> | null> {
  let result: Set<string> | null = null;
  const intersect = (ids: string[]) => {
    if (result === null) {
      result = new Set(ids);
      return;
    }
    const prev = result;
    const next = new Set<string>();
    for (const id of ids) if (prev.has(id)) next.add(id);
    result = next;
  };
  for (const cond of filters?.customFieldConditions ?? []) {
    if ((cond.operator === 'equals' || cond.operator === 'contains') && !cond.value) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('crm_contact_ids_by_custom_field', {
      p_organization_id: orgId,
      p_field_key: cond.fieldKey,
      p_operator: cond.operator,
      p_value: cond.value ?? null,
    });
    if (error) throw error;
    intersect(((data || []) as Array<{ id: string }>).map(r => r.id));
  }
  for (const cond of filters?.customQuestions ?? []) {
    if (!cond.question) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('crm_contact_ids_by_custom_question', {
      p_organization_id: orgId,
      p_question: cond.question,
      p_min_score: cond.minScore ?? null,
    });
    if (error) throw error;
    intersect(((data || []) as Array<{ id: string }>).map(r => r.id));
  }
  return result;
}

const ID_FILTER_CHUNK = 300; // ~11KB of UUIDs per URL — safely under PostgREST's ~72KB cap
const ID_FILTER_PARALLEL = 4;

/**
 * Reduce a pre-resolved candidate ID set (search / list membership) to the
 * subset matching all remaining ContactsFilters, preserving candidate order.
 * This is what makes totals + pagination exact when search/list filters are
 * combined with advanced filters (previously the total was the unfiltered
 * candidate count and trailing pages rendered empty).
 */
async function filterCandidateIds(candidateIds: string[], filters: ContactsFilters | undefined, orgId: string): Promise<string[]> {
  const rpcIdSet = await resolveRpcConditionIdSet(filters, orgId);
  const candidates = rpcIdSet ? candidateIds.filter(id => rpcIdSet.has(id)) : candidateIds;
  if (candidates.length === 0) return [];

  // RPC-backed conditions are already applied — strip so applyContactFilters
  // doesn't re-run them per chunk.
  const chunkFilters: ContactsFilters = { ...filters, customFieldConditions: undefined, customQuestions: undefined };

  const selectParts = ['id'];
  if (filters?.icpProductId) selectParts.push('contact_product_scores!inner(product_id)');
  if (filters?.linkedAccountId) selectParts.push('linked_identities:crm_contact_identities!inner(channel, linked_account_ids)');
  const selectClause = selectParts.join(', ');

  const chunks: string[][] = [];
  for (let i = 0; i < candidates.length; i += ID_FILTER_CHUNK) {
    chunks.push(candidates.slice(i, i + ID_FILTER_CHUNK));
  }

  const matched: string[][] = new Array(chunks.length);
  for (let b = 0; b < chunks.length; b += ID_FILTER_PARALLEL) {
    await Promise.all(chunks.slice(b, b + ID_FILTER_PARALLEL).map(async (chunk, j) => {
      // @ts-ignore - crm_contacts table exists but not in generated types
      let query = supabase
        .from('crm_contacts')
        .select(selectClause)
        .eq('organization_id', orgId)
        .in('id', chunk);
      query = applyIcpScoreConditions(query, filters);
      const [filtered] = await applyContactFilters([query], chunkFilters, orgId);
      const { data, error } = await filtered;
      if (error) throw error;
      const idSet = new Set((data as Array<{ id: string }>).map(d => d.id));
      matched[b + j] = chunk.filter(id => idSet.has(id));
    }));
  }
  return matched.flat();
}

// Drift guard: every EnrichmentFilters key must be acknowledged by this engine.
// If a field is added to src/types/enrichment-filters.ts without a matching
// branch in applyContactFilters (or the ICP-join handling in useContacts),
// add it here ONLY after wiring it — this constant failing the build is the
// signal that the new filter would otherwise be silently dead on /people.
const _CONTACTS_ENGINE_HANDLES = {
  industries: true, companySizes: true, minEmployeeCount: true, maxEmployeeCount: true, seniorities: true, departments: true,
  technologies: true, emailVerified: true, emailQuality: true,
  minEmailConfidence: true, emailType: true, countries: true, cities: true,
  hasEnrichmentData: true, icpProductId: true, minIcpScore: true,
  maxIcpScore: true, minDmScore: true, maxDmScore: true, isB2b: true,
  revenueModels: true, hasOutboundMotion: true, hiringSalesRoles: true,
  runsAds: true, detectedTechnologies: true, detectedTechMatchAll: true,
  excludedTechnologies: true, customQuestions: true, customFieldConditions: true,
  hasNotionUrl: true, hasEmail: true, segFirewall: true, aiAnalysisStatus: true,
} as const satisfies Record<keyof EnrichmentFilters, true>;
void _CONTACTS_ENGINE_HANDLES;

/**
 * Apply ContactsFilters to one or more Supabase query builders.
 * Returns the same array of queries with all filters applied.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyContactFilters(
  queries: any[],
  filters: ContactsFilters | undefined,
  orgId: string,
): Promise<any[]> {
  const apply = (fn: (q: any) => any) => { queries = queries.map(fn); };

  // NULL-safe: absent custom_fields.keyword_excluded (the vast majority of contacts)
  // must count as "not excluded" — a plain .not(...,'eq','true') evaluates to NULL
  // for those rows and silently drops them from every result set.
  apply(q => q.or('custom_fields->>keyword_excluded.is.null,custom_fields->>keyword_excluded.neq.true'));

  if (filters?.status && filters.status !== 'all') {
    apply(q => q.eq('status', filters.status));
  }
  if (filters?.pipeline_id) {
    apply(q => q.eq('pipeline_id', filters.pipeline_id));
  }
  if (filters?.stage_id) {
    apply(q => q.eq('stage_id', filters.stage_id));
  }
  if (filters?.owner_user_id) {
    apply(q => q.eq('owner_user_id', filters.owner_user_id));
  }
  if (filters?.source) {
    apply(q => q.eq('source', filters.source));
  }
  if (filters?.min_score !== undefined) {
    apply(q => q.gte('lead_score', filters.min_score));
  }
  if (filters?.max_score !== undefined) {
    apply(q => q.lte('lead_score', filters.max_score));
  }
  if (filters?.tags && filters.tags.length > 0) {
    apply(q => q.overlaps('tags', filters.tags));
  }
  // NOTE: search is handled via the search_crm_contacts RPC at the call site
  // (useContacts / useFetchAllFilteredContactIds), not here.
  if (filters?.linkedinOnly) {
    apply(q => q.eq('is_linkedin_connection', true));
  }
  // linkedAccountId: handled via !inner join in the select clause of useContacts.
  // applyContactFilters just adds the filter condition on the joined table.
  if (filters?.linkedAccountId) {
    apply(q => q.eq('linked_identities.channel', 'linkedin'));
    apply(q => q.contains('linked_identities.linked_account_ids', [filters.linkedAccountId]));
  }
  if (filters?.contactType && filters.contactType !== 'all') {
    apply(q => q.eq('contact_type', filters.contactType));
  }
  if (filters?.industries && filters.industries.length > 0) {
    const industryFilter = filters.industries.map(i => `enrichment_data->company->>industry.ilike.${pgrstValue(i)}`).join(',');
    apply(q => q.or(industryFilter));
  }
  if (filters?.companySizes && filters.companySizes.length > 0) {
    const sizeFilter = filters.companySizes.map(s => `enrichment_data->company->>size.ilike.${pgrstValue(s)}`).join(',');
    apply(q => q.or(sizeFilter));
  }
  if (filters?.minEmployeeCount !== undefined) {
    apply(q => q.gte('company_employee_count', filters.minEmployeeCount));
  }
  if (filters?.maxEmployeeCount !== undefined) {
    apply(q => q.lte('company_employee_count', filters.maxEmployeeCount));
  }
  if (filters?.seniorities && filters.seniorities.length > 0) {
    const seniorityFilter = filters.seniorities.map(s => `enrichment_data->>seniority.ilike.${pgrstValue(s)}`).join(',');
    apply(q => q.or(seniorityFilter));
  }
  if (filters?.departments && filters.departments.length > 0) {
    const deptFilter = filters.departments.map(d => `enrichment_data->>department.ilike.${pgrstValue(d)}`).join(',');
    apply(q => q.or(deptFilter));
  }
  if (filters?.technologies && filters.technologies.length > 0) {
    apply(q => q.contains('enrichment_data', { company: { technologies: filters.technologies } }));
  }
  if (filters?.emailVerified !== undefined) {
    const verifiedValue = filters.emailVerified ? 'true' : 'false';
    apply(q => q.eq('enrichment_data->>emailVerified', verifiedValue));
  }
  if (filters?.minEmailConfidence !== undefined && filters.minEmailConfidence > 0) {
    apply(q => q.gte('enrichment_data->>emailConfidence', filters.minEmailConfidence));
  }
  if (filters?.emailType) {
    apply(q => q.eq('email_type', filters.emailType));
  }
  if (filters?.emailQuality && filters.emailQuality.length > 0) {
    // Same bucketing as the filter_lead_list_members RPC, over the mirrored
    // verification columns (email_verified_at / email_verification_status /
    // email_is_*). Buckets are OR'd; `not.is.true` keeps NULL columns passing
    // like the RPC's COALESCE(x, false) = false.
    const buckets: string[] = [];
    for (const q of filters.emailQuality) {
      if (q === 'clean') {
        buckets.push('and(email_verified_at.not.is.null,email_verification_status.eq.valid,email_is_catch_all.not.is.true,email_is_role.not.is.true,email_is_free.not.is.true,email_is_disposable.not.is.true,email_is_spamtrap.not.is.true)');
      } else if (q === 'risky') {
        buckets.push('and(email_verified_at.not.is.null,or(email_verification_status.eq.catch_all,email_is_catch_all.is.true,email_is_role.is.true,email_is_free.is.true),email_is_disposable.not.is.true,email_is_spamtrap.not.is.true)');
      } else if (q === 'failed') {
        buckets.push('and(email_verified_at.not.is.null,or(email_verification_status.in.(invalid,disposable,spamtrap,disabled,role_only),email_is_disposable.is.true,email_is_spamtrap.is.true))');
      } else if (q === 'unverified') {
        buckets.push('email_verified_at.is.null');
      }
    }
    if (buckets.length > 0) apply(q => q.or(buckets.join(',')));
  }
  if (filters?.runsAds !== undefined) {
    apply(q => q.eq('enrichment_data->detected_technologies->>runs_paid_ads', String(filters.runsAds)));
  }
  if (filters?.detectedTechnologies && filters.detectedTechnologies.length > 0) {
    if (filters.detectedTechMatchAll) {
      // ALL selected techs must be present — single jsonb containment
      apply(q => q.contains('enrichment_data', { detected_technologies: { all: filters.detectedTechnologies } }));
    } else {
      // ANY selected tech — OR of single-element containments
      const anyTech = filters.detectedTechnologies
        .map(t => `enrichment_data->detected_technologies->all.cs.${JSON.stringify([t])}`)
        .join(',');
      apply(q => q.or(anyTech));
    }
  }
  if (filters?.excludedTechnologies && filters.excludedTechnologies.length > 0) {
    // Contacts with no detected_technologies at all must pass (RPC uses
    // COALESCE(..., '[]')), so each exclusion is `path is null OR not contains`.
    for (const t of filters.excludedTechnologies) {
      apply(q => q.or(`enrichment_data->detected_technologies->all.is.null,enrichment_data->detected_technologies->all.not.cs.${JSON.stringify([t])}`));
    }
  }
  if (filters?.countries && filters.countries.length > 0) {
    const countryFilter = filters.countries.map(c => `country.ilike.${pgrstValue(c)}`).join(',');
    apply(q => q.or(countryFilter));
  }
  if (filters?.cities && filters.cities.length > 0) {
    const cityFilter = filters.cities.map(c => `city.ilike.${pgrstValue(c)}`).join(',');
    apply(q => q.or(cityFilter));
  }
  if (filters?.hasEnrichmentData !== undefined) {
    if (filters.hasEnrichmentData) {
      // enrichment_data defaults to '{}' — check for actual content
      apply(q => q.not('enrichment_data', 'is', null).not('enrichment_data', 'eq', '{}'));
    } else {
      apply(q => q.or('enrichment_data.is.null,enrichment_data.eq.{}'));
    }
  }
  // ICP filter is handled separately in useContacts — see icpProductId logic there
  if (filters?.isB2b !== undefined) {
    apply(q => q.eq('enrichment_data->>is_b2b', String(filters.isB2b)));
  }
  if (filters?.revenueModels && filters.revenueModels.length > 0) {
    const revenueFilter = filters.revenueModels.map(m => `enrichment_data->>revenue_model.ilike.${pgrstValue(m)}`).join(',');
    apply(q => q.or(revenueFilter));
  }
  if (filters?.hasOutboundMotion !== undefined) {
    apply(q => q.eq('enrichment_data->>has_outbound_motion', String(filters.hasOutboundMotion)));
  }
  if (filters?.hiringSalesRoles !== undefined) {
    apply(q => q.eq('enrichment_data->>hiring_sales_roles', String(filters.hiringSalesRoles)));
  }
  if (filters?.outreachStatus && filters.outreachStatus !== 'all') {
    apply(q => q.eq('outreach_status', filters.outreachStatus));
  }
  if (filters?.aiAnalysisStatus && filters.aiAnalysisStatus !== 'all') {
    if (filters.aiAnalysisStatus === 'no_data') {
      // "No data" = scraped but no usable analysis: either analysis failed, or the
      // contact has no analyzable source (no website AND no LinkedIn URL). The latter
      // bucket is reset to 'not_analyzed' by the worker, so it can't be matched on
      // status alone — match the missing-source condition directly.
      apply(q => q.or(
        'ai_analysis_status.eq.failed,' +
        'and(or(company_website.is.null,company_website.eq.),or(primary_linkedin_url.is.null,primary_linkedin_url.eq.))'
      ));
    } else {
      apply(q => q.eq('ai_analysis_status', filters.aiAnalysisStatus));
    }
  }
  if (filters?.hasEmail !== undefined) {
    if (filters.hasEmail) {
      apply(q => q.not('primary_email', 'is', null).neq('primary_email', ''));
    } else {
      apply(q => q.or('primary_email.is.null,primary_email.eq.'));
    }
  }
  if (filters?.signalSubscriptionId) {
    apply(q => q.eq('discovery_metadata->>signal_subscription_id', filters.signalSubscriptionId));
  }
  if (filters?.signalTypes && filters.signalTypes.length > 0) {
    apply(q => q.in('discovery_metadata->>signal_type', filters.signalTypes));
  }
  if (filters?.minDiscoveryScore !== undefined) {
    apply(q => q.gte('discovery_score', filters.minDiscoveryScore));
  }
  if (filters?.signalMaxAgeDays !== undefined && filters.signalMaxAgeDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.signalMaxAgeDays);
    apply(q => q.gte('discovery_metadata->>signal_date', cutoff.toISOString().slice(0, 10)));
  }
  if (filters?.hasNotionUrl !== undefined) {
    if (filters.hasNotionUrl) {
      apply(q => q.not('notion_preview_url', 'is', null).neq('notion_preview_url', ''));
    } else {
      apply(q => q.or('notion_preview_url.is.null,notion_preview_url.eq.'));
    }
  }
  if (filters?.segFirewall) {
    if (filters.segFirewall === 'behind') {
      apply(q => q.not('seg_provider', 'is', null));
    } else if (filters.segFirewall === 'clear') {
      apply(q => q.is('seg_provider', null).not('seg_checked_at', 'is', null));
    } else if (filters.segFirewall === 'unchecked') {
      apply(q => q.is('seg_checked_at', null));
    }
  }
  // List membership "is in list": handled via !inner join in the select clause.
  // applyContactFilters just adds the filter condition on the joined table.
  if (filters?.inListIds && filters.inListIds.length > 0) {
    apply(q => q.in('list_members.list_id', filters.inListIds!));
  }
  // List membership: "is not in list"
  // Uses a server-side RPC with NOT EXISTS to get the set of excluded
  // contact IDs, then applies chunked NOT IN filters.
  // Capped at 2000 excluded IDs (~72KB URL) to avoid PostgREST 500s.
  // For lists with >2000 members, the RPC-based approach in
  // useFetchAllFilteredContactIds handles it correctly.
  if (filters?.notInListIds && filters.notInListIds.length > 0) {
    const excludedIds = await fetchAllIds(
      () => supabase
        .from('lead_list_members')
        .select('contact_id')
        .in('list_id', filters.notInListIds!),
    );
    const uniqueExcludedIds = [...new Set(excludedIds)];
    // Cap at 2000 IDs (10 chunks of 200) to stay under URL limits.
    // For larger exclusion sets, use the server-side RPC path.
    const MAX_EXCLUDE_IDS = MAX_IN_CHUNK * 10; // 2000
    if (uniqueExcludedIds.length > 0 && uniqueExcludedIds.length <= MAX_EXCLUDE_IDS) {
      for (let i = 0; i < uniqueExcludedIds.length; i += MAX_IN_CHUNK) {
        const chunk = uniqueExcludedIds.slice(i, i + MAX_IN_CHUNK);
        apply(q => q.not('id', 'in', `(${chunk.join(',')})`));
      }
    } else if (uniqueExcludedIds.length > MAX_EXCLUDE_IDS) {
      // Too many excluded IDs for URL params — store on queries for
      // the caller to handle via post-filtering or RPC.
      (queries as any).__notInListExcludedIds = new Set(uniqueExcludedIds);
    }
  }

  // Org custom field filters (crm_custom_field_defs / crm_contacts.custom_fields).
  // Multiple conditions are AND-combined. A plain custom_fields->>key comparison
  // forces a sequential scan (the GIN index on custom_fields only accelerates
  // ?/@> containment, not ->> path extraction) and timed out (57014) on a
  // large production org — route through the GIN-accelerated RPC instead and
  // intersect the matching contact IDs, same pattern as notInListIds below.
  if (filters?.customFieldConditions && filters.customFieldConditions.length > 0) {
    for (const cond of filters.customFieldConditions) {
      if ((cond.operator === 'equals' || cond.operator === 'contains') && !cond.value) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('crm_contact_ids_by_custom_field', {
        p_organization_id: orgId,
        p_field_key: cond.fieldKey,
        p_operator: cond.operator,
        p_value: cond.value ?? null,
      });
      if (error) throw error;
      const matchingIds = ((data || []) as Array<{ id: string }>).map(r => r.id);
      narrowQueriesToIds(apply, matchingIds, `customFieldConditions: ${cond.fieldKey}`);
    }
  }

  // Custom-question score filters: answered custom-analysis questions with
  // score >= minScore. Resolved via GIN-friendly RPC and AND-intersected,
  // same pattern as customFieldConditions above.
  if (filters?.customQuestions && filters.customQuestions.length > 0) {
    for (const cond of filters.customQuestions) {
      if (!cond.question) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('crm_contact_ids_by_custom_question', {
        p_organization_id: orgId,
        p_question: cond.question,
        p_min_score: cond.minScore ?? null,
      });
      if (error) throw error;
      const matchingIds = ((data || []) as Array<{ id: string }>).map(r => r.id);
      narrowQueriesToIds(apply, matchingIds, `customQuestions: ${cond.question}`);
    }
  }

  return queries;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all contact IDs matching current filters (no pagination).
 * Used for "Select all X contacts" across pages.
 */
export function useFetchAllFilteredContactIds() {
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (filters: ContactsFilters | undefined): Promise<string[]> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      const hasIcpFilter = !!filters?.icpProductId;
      const hasListFilter = !!(filters?.inListIds && filters.inListIds.length > 0);
      const hasNotInListFilter = !!(filters?.notInListIds && filters.notInListIds.length > 0);
      const hasLinkedAccountFilter = !!filters?.linkedAccountId;
      const searchTerm = filters?.search?.slice(0, 100);

      // Pre-resolve ALL search matches (uncapped) — this is a bulk path, so the
      // whole match set is the point. Keyset-paginated, unlike the table view.
      let searchIds: string[] | null = null;
      if (searchTerm) {
        searchIds = await fetchAllSearchMatchIds(orgId, searchTerm);
        if (searchIds.length === 0) return [];
      }

      // Strip search from filters (already resolved via RPC)
      const filtersForPostgrest = filters ? { ...filters, search: undefined } : filters;

      // Resolve list membership server-side in a single RPC call
      let candidateIds: string[] | null = null;

      if (hasListFilter || hasNotInListFilter) {
        // @ts-ignore - RPC exists but not in generated types
        const { data: rpcIds, error: rpcError } = await supabase
          .rpc('get_contact_ids_for_list_filter', {
            p_organization_id: orgId,
            p_in_list_ids: filters?.inListIds || null,
            p_exclude_list_ids: filters?.notInListIds || null,
          });
        if (rpcError) throw rpcError;
        candidateIds = (rpcIds || []) as string[];
      }

      // Intersect search IDs with list IDs if both are active
      if (searchIds && candidateIds) {
        const searchSet = new Set(searchIds);
        candidateIds = candidateIds.filter(id => searchSet.has(id));
      } else if (searchIds) {
        candidateIds = searchIds;
      }

      // If any pre-resolution produced an empty set, return early
      if (candidateIds !== null && candidateIds.length === 0) return [];

      // Build select (no !inner join for lists — already resolved above)
      const selectParts = ['id'];
      if (hasIcpFilter) selectParts.push('contact_product_scores!inner(icp_score, decision_maker_score, product_id)');
      if (hasLinkedAccountFilter) selectParts.push('linked_identities:crm_contact_identities!inner(channel, linked_account_ids)');
      const selectClause = selectParts.join(', ');

      // Strip list filters since we handle them via candidateIds
      const filtersWithoutLists = filtersForPostgrest ? { ...filtersForPostgrest, inListIds: undefined, notInListIds: undefined } : filtersForPostgrest;

      const PAGE_SIZE = 1000;
      const allIds: string[] = [];

      if (candidateIds !== null) {
        // Reduce candidates to the matching subset (shared with useContacts —
        // resolves custom-field/question RPCs once, chunks in parallel)
        allIds.push(...await filterCandidateIds(candidateIds, filtersWithoutLists, orgId));
      } else {
        // No list or search filters — paginate normally
        let from = 0;
        while (true) {
          // @ts-ignore
          let query = supabase
            .from('crm_contacts')
            .select(selectClause)
            .eq('organization_id', orgId)
            .order('id')
            .range(from, from + PAGE_SIZE - 1);
          query = applyIcpScoreConditions(query, filters);

          const [filtered] = await applyContactFilters([query], filtersWithoutLists, orgId);
          const { data, error } = await filtered;
          if (error) throw error;

          const rows = data as { id: string }[];
          allIds.push(...rows.map(d => d.id));

          if (rows.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
      }

      return allIds;
    },
  });
}

/**
 * Fetch all contacts for the current organization with optional filters and pagination
 */
export function useContacts(filters?: ContactsFilters, options?: { enabled?: boolean }) {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  const sortBy = filters?.sortBy ?? 'last_activity_at';
  const sortDirection = filters?.sortDirection ?? 'desc';

  // Debounce the search value so keystroke-per-query floods don't hammer PostgREST
  const debouncedSearch = useDebouncedValue(filters?.search, 300);
  // Effective filters swap in the debounced (and truncated) search for the raw value
  const effectiveFilters = filters ? { ...filters, search: debouncedSearch?.slice(0, 100) || undefined } : filters;

  // Exclude refetchInterval from the query key — use debounced search instead of raw
  const { refetchInterval, search: _rawSearch, ...queryKeyFilters } = filters ?? {};

  return useQuery({
    queryKey: ['crm-contacts', currentOrganization?.id, { ...queryKeyFilters, search: debouncedSearch }],
    queryFn: async (): Promise<PaginatedContacts> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      const ef = effectiveFilters;
      const hasIcpFilter = !!ef?.icpProductId;
      const hasListFilter = !!(ef?.inListIds && ef.inListIds.length > 0);
      const hasNotInListFilter = !!(ef?.notInListIds && ef.notInListIds.length > 0);
      const hasLinkedAccountFilter = !!ef?.linkedAccountId;
      const searchTerm = ef?.search;

      // Fetch pipelines and stages once — used to resolve pipeline/stage objects
      // client-side instead of via slow PostgREST embedded resource joins.
      const [{ data: pipelinesData }, { data: stagesData }] = await Promise.all([
        // @ts-ignore
        supabase.from('crm_pipelines').select('*').eq('organization_id', orgId),
        // @ts-ignore
        supabase.from('crm_pipeline_stages').select('*').eq('organization_id', orgId),
      ]);
      const pipelineById: Record<string, CrmPipeline> = Object.fromEntries(
        (pipelinesData ?? []).map((p: CrmPipeline) => [p.id, p]),
      );
      const stageById: Record<string, CrmPipelineStage> = Object.fromEntries(
        (stagesData ?? []).map((s: CrmPipelineStage) => [s.id, s]),
      );

      // ================================================================
      // Search pre-resolution: resolve matching IDs via server-side RPC
      // (trigram-indexed ILIKE on 6 fields — fast even at 100K+ rows)
      // ================================================================
      let searchIds: string[] | null = null;
      if (searchTerm) {
        // @ts-ignore - RPC exists but not in generated types
        const { data: searchRpcIds, error: searchError } = await supabase
          .rpc('search_crm_contacts', {
            p_org_id: orgId,
            p_query: searchTerm,
            p_limit: 1000,
          });
        if (searchError) throw searchError;
        searchIds = ((searchRpcIds || []) as unknown as { contact_id: string }[]).map(r => r.contact_id);

        if (searchIds.length === 0) {
          return { data: [], total: 0, page, pageSize, totalPages: 0 };
        }
      }

      // Strip search from filters passed to applyContactFilters (already resolved via RPC)
      const filtersForPostgrest = ef ? { ...ef, search: undefined } : ef;

      // ================================================================
      // List filter path: pre-resolve contact IDs from lead_list_members
      // and/or the notInLists RPC, then fetch contacts by ID.
      // This avoids PostgREST !inner join timeouts on large lists (45K+).
      // ================================================================
      const searchCapped = (searchIds?.length ?? 0) >= 1000;

      if (hasListFilter || hasNotInListFilter || searchIds) {
        let candidateIds: string[];

        if (hasListFilter || hasNotInListFilter) {
          // @ts-ignore - RPC exists but not in generated types
          const { data: rpcIds, error: rpcError } = await supabase
            .rpc('get_contact_ids_for_list_filter', {
              p_organization_id: orgId,
              p_in_list_ids: ef?.inListIds || null,
              p_exclude_list_ids: ef?.notInListIds || null,
            });
          if (rpcError) throw rpcError;
          candidateIds = (rpcIds || []) as string[];

          // Intersect with search results if both are active
          if (searchIds) {
            const searchSet = new Set(searchIds);
            candidateIds = candidateIds.filter(id => searchSet.has(id));
          }
        } else {
          candidateIds = searchIds!;
        }

        if (candidateIds.length === 0) {
          return { data: [], total: 0, page, pageSize, totalPages: 0, searchCapped };
        }

        const filtersWithoutLists: ContactsFilters = { ...filtersForPostgrest, inListIds: undefined, notInListIds: undefined };

        // When advanced/inline filters combine with the candidate set, reduce
        // the candidates to the matching subset FIRST so total + pagination
        // reflect what the user actually sees (previously the total was the
        // unfiltered candidate count and trailing pages rendered empty).
        // Cached separately from the page query so page flips don't re-resolve.
        const preFiltered = hasCandidateNarrowingFilters(filtersWithoutLists);
        let matchingIds = candidateIds;
        if (preFiltered) {
          const {
            page: _pg, pageSize: _psz, sortBy: _sb, sortDirection: _sdir,
            refetchInterval: _ri, ...narrowingFilters
          } = filtersWithoutLists;
          matchingIds = await queryClient.fetchQuery({
            queryKey: ['crm-contacts-filtered-ids', orgId, {
              inListIds: ef?.inListIds ?? null,
              notInListIds: ef?.notInListIds ?? null,
              search: searchTerm ?? null,
              filters: narrowingFilters,
            }],
            queryFn: () => filterCandidateIds(candidateIds, filtersWithoutLists, orgId),
            staleTime: 30_000,
          });
        }

        const total = matchingIds.length;
        const totalPages = Math.ceil(total / pageSize);
        const pageStart = (page - 1) * pageSize;
        const pageIds = matchingIds.slice(pageStart, pageStart + pageSize);

        if (pageIds.length === 0) {
          return { data: [], total, page, pageSize, totalPages, searchCapped };
        }

        const joinParts: string[] = [];
        if (hasIcpFilter) joinParts.push('contact_product_scores!inner(icp_score, decision_maker_score, product_id)');
        if (hasLinkedAccountFilter) joinParts.push('linked_identities:crm_contact_identities!inner(channel, linked_account_ids)');
        const baseSelect = ['*', ...joinParts].join(',\n          ');

        // @ts-ignore
        let pageQuery = supabase
          .from('crm_contacts')
          .select(baseSelect)
          .eq('organization_id', orgId)
          .in('id', pageIds)
          .order(sortBy, { ascending: sortDirection === 'asc' });
        pageQuery = applyIcpScoreConditions(pageQuery, ef);

        // When the IDs were pre-filtered, every row already matches — skip
        // re-applying filters (which would re-run the custom-field/question RPCs).
        if (!preFiltered) {
          [pageQuery] = await applyContactFilters([pageQuery], filtersWithoutLists, orgId);
        }
        const { data: pageData, error: pageError } = await pageQuery;
        if (pageError) throw pageError;
        const contacts = attachPipelineStage(
          await attachContactIdentities((pageData || []) as CrmContact[], orgId),
          pipelineById,
          stageById,
        );

        return {
          data: contacts,
          total,
          page,
          pageSize,
          totalPages,
          searchCapped,
        };
      }

      // ================================================================
      // Standard path: no search, no list filters — use !inner joins
      // ================================================================
      const joinParts: string[] = [];
      const countJoinParts: string[] = [];

      if (hasIcpFilter) {
        joinParts.push('contact_product_scores!inner(icp_score, decision_maker_score, product_id)');
        countJoinParts.push('contact_product_scores!inner(icp_score, decision_maker_score, product_id)');
      }
      if (hasLinkedAccountFilter) {
        joinParts.push('linked_identities:crm_contact_identities!inner(channel, linked_account_ids)');
        countJoinParts.push('linked_identities:crm_contact_identities!inner(channel, linked_account_ids)');
      }

      const baseSelect = ['*', ...joinParts].join(',\n          ');

      const countSelect = ['id', ...countJoinParts].join(', ');

      // 'estimated' falls back to a planner estimate above PostgREST's max-rows
      // threshold instead of a full COUNT(*) scan — orgs with 500k+ contacts were
      // seeing this exact-count query alone exceed the 8s statement_timeout,
      // which (via Promise.all below) failed the whole contacts fetch.
      // @ts-ignore - crm_contacts table exists but not in generated types
      let countQuery = supabase
        .from('crm_contacts')
        .select(countSelect, { count: 'estimated', head: true })
        .eq('organization_id', orgId);

      // @ts-ignore - crm_contacts table exists but not in generated types
      let query = supabase
        .from('crm_contacts')
        .select(baseSelect)
        .eq('organization_id', orgId)
        .order(sortBy, { ascending: sortDirection === 'asc' });

      if (hasIcpFilter && ef?.icpProductId) {
        query = query.eq('contact_product_scores.product_id', ef.icpProductId);
        countQuery = countQuery.eq('contact_product_scores.product_id', ef.icpProductId);
        if (ef.minIcpScore !== undefined && ef.minIcpScore > 0) {
          query = query.gte('contact_product_scores.icp_score', ef.minIcpScore);
          countQuery = countQuery.gte('contact_product_scores.icp_score', ef.minIcpScore);
        }
        if (ef.maxIcpScore !== undefined && ef.maxIcpScore < 100) {
          query = query.lte('contact_product_scores.icp_score', ef.maxIcpScore);
          countQuery = countQuery.lte('contact_product_scores.icp_score', ef.maxIcpScore);
        }
        if (ef.minDmScore !== undefined && ef.minDmScore > 0) {
          query = query.gte('contact_product_scores.decision_maker_score', ef.minDmScore);
          countQuery = countQuery.gte('contact_product_scores.decision_maker_score', ef.minDmScore);
        }
        if (ef.maxDmScore !== undefined && ef.maxDmScore < 100) {
          query = query.lte('contact_product_scores.decision_maker_score', ef.maxDmScore);
          countQuery = countQuery.lte('contact_product_scores.decision_maker_score', ef.maxDmScore);
        }
      }

      const queries = await applyContactFilters([query, countQuery], filtersForPostgrest, orgId);
      query = queries[0];
      countQuery = queries[1];

      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      // Execute both queries
      const [{ count, error: countError }, { data, error }] = await Promise.all([
        countQuery,
        query,
      ]);

      // Count is best-effort: a failed/slow count must never blank out an
      // otherwise-successful contacts page (this previously happened when the
      // exact count timed out and this threw, discarding the fetched rows).
      if (countError) console.error('useContacts count query failed:', countError);
      if (error) throw error;

      const total = count ?? 0;
      const totalPages = Math.ceil(total / pageSize);
      const contacts = attachPipelineStage(
        await attachContactIdentities((data || []) as CrmContact[], orgId),
        pipelineById,
        stageById,
      );

      return {
        data: contacts,
        total,
        page,
        pageSize,
        totalPages,
      };
    },
    enabled: !!user && !!currentOrganization && (options?.enabled ?? true),
    // When polling is active (analysis running), set staleTime to 0 so refetchInterval
    // actually triggers refetches. Otherwise keep 30s to avoid excessive queries.
    staleTime: refetchInterval ? 0 : 30000,
    refetchInterval: refetchInterval || false,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetch a single contact by ID with all related data (identities, activities, notes)
 */
export function useContact(contactId: string | null | undefined) {
  const { user, currentOrganization } = useAuth();
  const validId = contactId && UUID_RE.test(contactId) ? contactId : null;

  return useQuery({
    queryKey: ['crm-contact', validId, currentOrganization?.id],
    queryFn: async () => {
      if (!user || !validId) throw new Error('Not authenticated or no contact ID');

      // Fetch contact with pipeline and stage (scoped to organization)
      const { data: contact, error: contactError } = await supabase
        .from('crm_contacts')
        .select(`
          *,
          pipeline:crm_pipelines(*),
          stage:crm_pipeline_stages(*)
        `)
        .eq('id', validId)
        .eq('organization_id', currentOrganization!.id)
        .single();

      if (contactError) throw contactError;

      // Fetch identities
      const { data: identities, error: identitiesError } = await supabase
        .from('crm_contact_identities')
        .select('*')
        .eq('contact_id', validId)
        .order('is_primary', { ascending: false });

      if (identitiesError) throw identitiesError;

      // Fetch recent activities (last 50)
      const { data: activities, error: activitiesError } = await supabase
        .from('crm_activities')
        .select('*')
        .eq('contact_id', validId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (activitiesError) throw activitiesError;

      // Fetch notes
      const { data: notes, error: notesError } = await supabase
        .from('crm_notes')
        .select('*')
        .eq('contact_id', validId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (notesError) throw notesError;

      return {
        ...contact,
        identities: identities || [],
        activities: activities || [],
        notes: notes || [],
      } as CrmContact & {
        activities: CrmActivity[];
        notes: CrmNote[];
      };
    },
    enabled: !!user && !!validId && !!currentOrganization,
    staleTime: 30000,
  });
}

// Activity type for timeline
export interface CrmActivity {
  id: string;
  organization_id: string;
  contact_id: string;
  activity_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  related_message_id: string | null;
  related_sequence_id: string | null;
  performed_by_type: 'user' | 'system' | 'contact' | 'automation' | null;
  performed_by_user_id: string | null;
  created_at: string;
}

// Note type
export interface CrmNote {
  id: string;
  organization_id: string;
  contact_id: string;
  content: string;
  mentioned_user_ids: string[];
  is_internal: boolean;
  is_pinned: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch contacts grouped by pipeline stage (for Kanban view)
 */
export function useContactsByStage(pipelineId: string | null) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-contacts-by-stage', currentOrganization?.id, pipelineId],
    queryFn: async () => {
      if (!user || !pipelineId) throw new Error('Not authenticated or no pipeline');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      // Fetch stages
      const { data: stages, error: stagesError } = await supabase
        .from('crm_pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('stage_order', { ascending: true });

      if (stagesError) throw stagesError;

      // Fetch contacts for this pipeline
      const { data: contacts, error: contactsError } = await supabase
        .from('crm_contacts')
        .select('*')
        .eq('organization_id', orgId)
        .eq('pipeline_id', pipelineId)
        .eq('status', 'active')
        .order('stage_entered_at', { ascending: false });

      if (contactsError) throw contactsError;

      // Group contacts by stage
      const contactsByStage: Record<string, CrmContact[]> = {};
      for (const stage of stages || []) {
        contactsByStage[stage.id] = (contacts || []).filter(c => c.stage_id === stage.id);
      }

      // Add unassigned contacts (no stage)
      contactsByStage['unassigned'] = (contacts || []).filter(c => !c.stage_id);

      return {
        stages: stages as CrmPipelineStage[],
        contactsByStage,
      };
    },
    enabled: !!user && !!currentOrganization && !!pipelineId,
    staleTime: 30000,
  });
}

/**
 * Create a new contact
 */
export function useCreateContact() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      const { data, error } = await supabase
        .from('crm_contacts')
        .insert({
          organization_id: orgId,
          display_name: input.display_name,
          first_name: input.first_name || null,
          last_name: input.last_name || null,
          company: input.company || null,
          job_title: input.job_title || null,
          avatar_url: input.avatar_url || null,
          primary_email: input.primary_email || null,
          primary_phone: input.primary_phone || null,
          primary_linkedin_url: input.primary_linkedin_url || null,
          instagram_url: input.instagram_url || null,
          linkedin_bio: input.linkedin_bio || null,
          home_page_text: input.home_page_text || null,
          company_website: input.company_website || null,
          city: input.city || null,
          state: input.state || null,
          country: input.country || null,
          pipeline_id: input.pipeline_id || null,
          stage_id: input.stage_id || null,
          stage_entered_at: input.stage_id ? new Date().toISOString() : null,
          custom_fields: input.custom_fields || {},
          tags: input.tags || [],
          source: input.source || 'manual',
          owner_user_id: input.owner_user_id || user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Create activity for contact creation
      await supabase.from('crm_activities').insert({
        organization_id: orgId,
        contact_id: data.id,
        activity_type: 'contact_created',
        title: 'Contact created',
        performed_by_type: 'user',
        performed_by_user_id: user.id,
      });

      return data as CrmContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Contact created successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create contact');
    },
  });
}

/**
 * Update a contact
 */
export function useUpdateContact() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateContactInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      // Get current contact to check for stage change
      const { data: currentContact } = await supabase
        .from('crm_contacts')
        .select('stage_id')
        .eq('id', id)
        .single();

      const stageChanged = input.stage_id !== undefined && input.stage_id !== currentContact?.stage_id;

      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Only include defined fields
      if (input.display_name !== undefined) updateData.display_name = input.display_name;
      if (input.first_name !== undefined) updateData.first_name = input.first_name;
      if (input.last_name !== undefined) updateData.last_name = input.last_name;
      if (input.company !== undefined) updateData.company = input.company;
      if (input.job_title !== undefined) updateData.job_title = input.job_title;
      if (input.avatar_url !== undefined) updateData.avatar_url = input.avatar_url;
      if (input.primary_email !== undefined) updateData.primary_email = input.primary_email;
      if (input.primary_phone !== undefined) updateData.primary_phone = input.primary_phone;
      if (input.primary_linkedin_url !== undefined) updateData.primary_linkedin_url = input.primary_linkedin_url;
      if (input.instagram_url !== undefined) updateData.instagram_url = input.instagram_url;
      if (input.linkedin_bio !== undefined) updateData.linkedin_bio = input.linkedin_bio;
      if (input.home_page_text !== undefined) updateData.home_page_text = input.home_page_text;
      if (input.company_website !== undefined) updateData.company_website = input.company_website;
      if (input.city !== undefined) updateData.city = input.city;
      if (input.state !== undefined) updateData.state = input.state;
      if (input.country !== undefined) updateData.country = input.country;
      if (input.pipeline_id !== undefined) updateData.pipeline_id = input.pipeline_id;
      if (input.stage_id !== undefined) {
        updateData.stage_id = input.stage_id;
        if (stageChanged) {
          updateData.stage_entered_at = new Date().toISOString();
        }
      }
      if (input.custom_fields !== undefined) updateData.custom_fields = input.custom_fields;
      if (input.tags !== undefined) updateData.tags = input.tags;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.lead_score !== undefined) {
        updateData.lead_score = input.lead_score;
        updateData.lead_score_updated_at = new Date().toISOString();
      }
      if (input.owner_user_id !== undefined) updateData.owner_user_id = input.owner_user_id;

      const { data, error } = await supabase
        .from('crm_contacts')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Create activity for stage change
      if (stageChanged) {
        await supabase.from('crm_activities').insert({
          organization_id: orgId,
          contact_id: id,
          activity_type: 'stage_changed',
          title: 'Stage changed',
          metadata: {
            from_stage_id: currentContact?.stage_id,
            to_stage_id: input.stage_id,
          },
          performed_by_type: 'user',
          performed_by_user_id: user.id,
        });
      }

      return data as CrmContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      toast.success('Contact updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update contact');
    },
  });
}

/**
 * Move contact to a different stage (optimized for drag & drop)
 */
export function useMoveContactToStage() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, stageId }: { contactId: string; stageId: string | null }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      // Get current stage
      const { data: currentContact } = await supabase
        .from('crm_contacts')
        .select('stage_id')
        .eq('id', contactId)
        .single();

      const { data, error } = await supabase
        .from('crm_contacts')
        .update({
          stage_id: stageId,
          stage_entered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId)
        .select()
        .single();

      if (error) throw error;

      // Create activity
      await supabase.from('crm_activities').insert({
        organization_id: orgId,
        contact_id: contactId,
        activity_type: 'stage_changed',
        title: 'Stage changed',
        metadata: {
          from_stage_id: currentContact?.stage_id,
          to_stage_id: stageId,
        },
        performed_by_type: 'user',
        performed_by_user_id: user.id,
      });

      return data as CrmContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts-by-stage'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to move contact');
    },
  });
}

function invalidateContactDeletionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  // A contact can belong to several lists; refresh their pages and separate counts.
  for (const key of [
    'crm-contacts', 'crm-contacts-filtered-ids', 'lead-list-members', 'lead-list-members-count', 'lead-lists',
    'smart-list-contacts', 'smart-list-preview', 'filtered-contacts',
    'lead-list-channel-stats', 'lead-lists-channel-stats', 'contact-list-memberships',
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Delete a contact — routes through the bulk-delete edge function
 * so cascade deletes across 15+ child tables use service_role.
 */
export function useDeleteContact() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('bulk-delete-contacts', {
        body: { contactIds: [id], organizationId: currentOrganization?.id },
      });

      if (error) throw error;
      if (data?.success !== true || data.deleted !== 1 || data.errors > 0) {
        throw new Error(data?.error || 'Contact could not be deleted. Refresh the list and try again.');
      }
    },
    onSettled: () => invalidateContactDeletionQueries(queryClient),
    onSuccess: () => {
      toast.success('Contact deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete contact');
    },
  });
}

/**
 * Bulk delete contacts via server-side edge function.
 * Uses streaming NDJSON response for real-time progress updates.
 * Each contact is deleted individually server-side (cascade across 15+ tables).
 */
export function useBulkDeleteContacts() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    // Accepts an explicit id list, or a filter-based "select all matching"
    // selection ({ sourceListId, filters }) resolved server-side by the edge
    // function so we never ship thousands of UUIDs.
    mutationFn: async (
      input: string[] | { sourceListId: string; filters: Record<string, unknown>; total?: number }
    ) => {
      const isFilter = !Array.isArray(input);
      const ids = Array.isArray(input) ? input : [];
      const knownTotal = Array.isArray(input) ? input.length : (input.total ?? 0);
      const requestBody = isFilter
        ? { sourceListId: input.sourceListId, filters: input.filters }
        : { contactIds: ids };
      const taskId = `delete-contacts-${Date.now()}`;
      backgroundTasks.start({
        id: taskId,
        type: "delete",
        label: "Deleting contacts",
        checked: 0,
        total: knownTotal,
        color: "red",
      });

      try {
        // Get auth token for direct fetch (supabase.functions.invoke doesn't support streaming)
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const res = await fetch(`${supabaseUrl}/functions/v1/bulk-delete-contacts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ...requestBody, organizationId: currentOrganization?.id }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          throw new Error(errorData?.error || `Delete failed (${res.status})`);
        }

        const lastResult = await readContactDeletionResponse(res, (progress) => {
          backgroundTasks.update(taskId, {
            checked: progress.deleted + progress.errors,
            ...(progress.total !== undefined ? { total: progress.total } : {}),
          });
        });

        return { ...lastResult, taskId };
      } catch (err) {
        backgroundTasks.finish(taskId);
        throw err;
      }
    },
    onSuccess: ({ deleted, errors, taskId }) => {
      backgroundTasks.finish(taskId);
      const msg = errors > 0
        ? `Deleted ${deleted} contacts (${errors} failed)`
        : `${deleted} contact${deleted === 1 ? '' : 's'} deleted`;
      if (deleted === 0 && errors > 0) toast.error(msg);
      else if (errors > 0 || deleted === 0) toast.warning(msg);
      else toast.success(msg);
    },
    onSettled: () => invalidateContactDeletionQueries(queryClient),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete contacts');
    },
  });
}

/**
 * Archive a contact (soft delete)
 */
export function useArchiveContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('crm_contacts')
        .update({
          status: 'archived',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Contact archived');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to archive contact');
    },
  });
}

/**
 * Bulk update contacts (for bulk actions)
 */
export function useBulkUpdateContacts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactIds,
      updates,
    }: {
      contactIds: string[];
      updates: Partial<Pick<CrmContact, 'status' | 'pipeline_id' | 'stage_id' | 'owner_user_id' | 'tags'>>;
    }) => {
      if (!user) throw new Error('Not authenticated');

      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        ...updates,
      };

      if (updates.stage_id !== undefined) {
        updateData.stage_entered_at = new Date().toISOString();
      }

      // Chunk large ID arrays to avoid URL length limits
      for (let i = 0; i < contactIds.length; i += MAX_IN_CHUNK) {
        const chunk = contactIds.slice(i, i + MAX_IN_CHUNK);
        const { error } = await supabase
          .from('crm_contacts')
          .update(updateData)
          .in('id', chunk);
        if (error) throw error;
      }
    },
    onSuccess: (_, { contactIds }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success(`Updated ${contactIds.length} contacts`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update contacts');
    },
  });
}

/**
 * Bulk-set a single custom field's value across many contacts. Uses the
 * bulk_set_contact_custom_field RPC to do a true per-row JSONB merge —
 * a plain client-side .update({ custom_fields }) across an .in() batch
 * would overwrite every selected contact's OTHER custom fields with the
 * same literal object.
 */
export function useBulkSetContactCustomField() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactIds,
      fieldKey,
      value,
    }: {
      contactIds: string[];
      fieldKey: string;
      value: string;
    }) => {
      if (!currentOrganization) throw new Error('No organization selected');

      let updated = 0;
      for (let i = 0; i < contactIds.length; i += MAX_IN_CHUNK) {
        const chunk = contactIds.slice(i, i + MAX_IN_CHUNK);
        // Cast: bulk_set_contact_custom_field isn't in the generated Supabase
        // types yet (regenerate via `npx supabase gen types` to pick it up).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('bulk_set_contact_custom_field', {
          p_organization_id: currentOrganization.id,
          p_contact_ids: chunk,
          p_field_key: fieldKey,
          p_field_value: value,
        });
        if (error) throw error;
        updated += (data as number) ?? 0;
      }
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success(`Updated custom field on ${updated} contact${updated === 1 ? '' : 's'}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update custom field');
    },
  });
}

/**
 * Add tag to contact
 */
export function useAddContactTag() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, tag }: { contactId: string; tag: string }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      // Get current tags
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('tags')
        .eq('id', contactId)
        .single();

      const currentTags = contact?.tags || [];
      if (currentTags.includes(tag)) {
        return; // Tag already exists
      }

      const { error } = await supabase
        .from('crm_contacts')
        .update({
          tags: [...currentTags, tag],
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId);

      if (error) throw error;

      // Create activity
      await supabase.from('crm_activities').insert({
        organization_id: orgId,
        contact_id: contactId,
        activity_type: 'tag_added',
        title: `Tag "${tag}" added`,
        metadata: { tag },
        performed_by_type: 'user',
        performed_by_user_id: user.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add tag');
    },
  });
}

/**
 * Remove tag from contact
 */
export function useRemoveContactTag() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, tag }: { contactId: string; tag: string }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');
      const orgId = currentOrganization.id;

      // Get current tags
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('tags')
        .eq('id', contactId)
        .single();

      const currentTags = contact?.tags || [];
      const newTags = currentTags.filter((t: string) => t !== tag);

      const { error } = await supabase
        .from('crm_contacts')
        .update({
          tags: newTags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId);

      if (error) throw error;

      // Create activity
      await supabase.from('crm_activities').insert({
        organization_id: orgId,
        contact_id: contactId,
        activity_type: 'tag_removed',
        title: `Tag "${tag}" removed`,
        metadata: { tag },
        performed_by_type: 'user',
        performed_by_user_id: user.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
    },
  });
}

/**
 * Assign or remove an owner user from a CRM contact.
 * Contact ownership determines who is responsible for managing the relationship.
 */
export function useUpdateContactOwner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      userId,
    }: {
      contactId: string;
      userId: string | null;
    }) => {
      const { data, error } = await supabase
        .from('crm_contacts')
        .update({
          owner_user_id: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      toast.success(vars.userId ? 'Contact owner assigned' : 'Contact owner removed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update contact owner');
    },
  });
}
