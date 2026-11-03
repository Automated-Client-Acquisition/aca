import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { splitDisplayName } from '../_shared/linkedin-engagement/display-name.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * LinkedIn Search Import Edge Function
 *
 * Imports leads from LinkedIn people search, Sales Navigator, or Recruiter search.
 * Uses the official Unipile SDK with LinkedIn Search API: POST /api/v1/linkedin/search
 *
 * Supports two modes:
 * - URL mode: Pass LinkedIn/Sales Nav/Recruiter search URL directly
 * - Parameter mode: Structured filters with proper IDs
 *
 * Handles:
 * - URL-based and parameter-based search via Unipile SDK
 * - Deduplicating against existing contacts
 * - Creating contacts and adding to lead lists
 * - Real-time progress updates
 * - Rate limiting with exponential backoff
 */

// Search metadata structure
interface SearchMetadata {
  max_leads: number;
  search_mode?: 'url' | 'parameters';
  api_type?: 'classic' | 'sales_navigator' | 'recruiter';
  /** Set by the MCP/frontend when the caller chose api_type deliberately, so the
   * server's Sales-Nav auto-upgrade never overrides an explicit choice. */
  api_type_explicit?: boolean;
  url?: string;
  search_params?: {
    category?: 'people' | 'companies' | 'jobs' | 'posts';
    keywords?: string;
    location?: string[];
    industry?: string[];
    network_distance?: (number | string)[]; // Unipile expects numbers: 1, 2, 3
    current_company?: string[];
    company?: string[]; // Unipile uses 'company' for current company
    past_company?: string[];
    skills?: Array<{ id: string; priority: string }>;
    seniority?: string[];
    tenure?: string[];
  };
  // Legacy fields
  include_reactors?: boolean;
  include_commenters?: boolean;
  reaction_types?: string[];
  resume_cursor?: string | null;
  resume_total_found?: number;
  resume_total_imported?: number;
  resume_total_skipped?: number;
  resume_skip_reasons?: string[];
}

type IncludeFilter = string[] | { include?: string[]; exclude?: string[] };

interface UnipileSearchResponse {
  items: Record<string, unknown>[];
  paging?: {
    start: number;
    page_count: number;
    total_count: number;
  };
  cursor?: string;
  // Legacy response fields
  results?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  total?: number;
  next_cursor?: string;
}

/**
 * Detect search type from URL
 */
function detectApiType(url: string): 'classic' | 'sales_navigator' | 'recruiter' {
  if (url.includes('/talent/search/')) {
    return 'recruiter';
  }
  if (url.includes('/sales/search/') || url.includes('/sales/lists/')) {
    return 'sales_navigator';
  }
  return 'classic';
}

/**
 * Map string network distance values to numbers required by Unipile API
 * Unipile expects: 1 (1st degree), 2 (2nd degree), 3 (3rd+ degree)
 */
function mapNetworkDistance(distances: (string | number)[] | undefined): number[] | undefined {
  if (!distances || distances.length === 0) return undefined;

  const mapping: Record<string, number> = {
    'F': 1, '1': 1, '1st': 1,
    'S': 2, '2': 2, '2nd': 2,
    'O': 3, '3': 3, '3rd': 3, '3rd+': 3,
  };

  return distances
    .map(d => typeof d === 'number' ? d : mapping[d] || parseInt(d, 10))
    .filter(n => !isNaN(n) && n >= 1 && n <= 3);
}

function asIncludeFilter(values: string[] | undefined, useIncludeObject: boolean): IncludeFilter | undefined {
  if (!values || values.length === 0) return undefined;
  return useIncludeObject ? { include: values } : values;
}

async function parseApiError(response: Response): Promise<string> {
  const rawText = await response.text();
  if (!rawText) return response.statusText || 'Unipile API request failed';

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const message = parsed.message || parsed.error || parsed.detail || parsed.title;
    const type = parsed.type ? ` (${String(parsed.type)})` : '';
    if (message) return `${String(message)}${type}`;
  } catch {
    // Fall through to raw text below.
  }

  return rawText;
}

function continueImportInBackground(
  supabaseUrl: string,
  serviceRoleKey: string,
  jobId: string,
) {
  const continuation = fetch(`${supabaseUrl}/functions/v1/linkedin-search-import`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId }),
  }).catch((err) => {
    console.error('[LinkedIn Search Import] Failed to schedule continuation:', err);
  });

  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(continuation);
  }
}

/**
 * Execute LinkedIn search via Unipile API (direct fetch)
 * Using direct fetch instead of SDK for more reliable error handling
 */
async function executeLinkedInSearch(
  dsnUrl: string,
  apiKey: string,
  accountId: string,
  metadata: SearchMetadata,
  sourceUrl: string,
  cursor?: string | null
): Promise<UnipileSearchResponse> {
  // Build request body
  let body: Record<string, unknown>;

  if (metadata.search_mode === 'parameters' && metadata.search_params) {
    // Parameter-based search - use structured filters
    // Map network_distance strings to numbers (Unipile expects 1, 2, 3)
    const networkDistance = mapNetworkDistance(metadata.search_params.network_distance);

    const companyIds = metadata.search_params.company || metadata.search_params.current_company;
    const isSalesNav = metadata.api_type === 'sales_navigator';
    const usesIncludeObjects = isSalesNav || metadata.api_type === 'recruiter';

    body = {
      api: metadata.api_type || 'classic',
      category: metadata.search_params.category || 'people',
      keywords: metadata.search_params.keywords,
      // Sales Navigator / Recruiter expect the union object { include: [...] } for
      // location too — a bare array is rejected with "Expected union value". Classic
      // takes the flat array. Route it through the same helper as the other IDs.
      location: asIncludeFilter(metadata.search_params.location, usesIncludeObjects),
      industry: asIncludeFilter(metadata.search_params.industry, usesIncludeObjects),
      network_distance: networkDistance,
      // Sales Navigator and Recruiter use { include: [...] } for several ID filters.
      // Classic uses flat arrays.
      company: asIncludeFilter(companyIds, usesIncludeObjects),
      past_company: asIncludeFilter(metadata.search_params.past_company, usesIncludeObjects),
    };

    // Remove undefined values and empty arrays
    Object.keys(body).forEach(key => {
      if (body[key] === undefined || (Array.isArray(body[key]) && (body[key] as unknown[]).length === 0)) {
        delete body[key];
      }
    });

    console.log(`[LinkedIn Search Import] Parameter-based search with body:`, JSON.stringify(body));
  } else {
    // URL-based search (default) - pass URL directly to Unipile
    const searchUrl = metadata.url || sourceUrl;
    if (!searchUrl) {
      throw new Error('No search URL provided for URL-based search mode');
    }
    // Unipile's "Search from URL" variant ONLY accepts { url }. Per the API schema:
    // "Setting this parameter will override the entire body." Adding `api` here causes
    // the request to violate the anyOf schema and Unipile hangs / returns nothing.
    // Sales Navigator vs Classic is auto-detected by Unipile from the URL itself.
    body = { url: searchUrl };
    console.log(`[LinkedIn Search Import] URL-based search with URL: ${searchUrl}`);
  }

  console.log(`[LinkedIn Search Import] API request to ${dsnUrl}/api/v1/linkedin/search:`, JSON.stringify(body));

  // Use direct fetch for more control over error handling.
  // 90s timeout: prevents the function from hanging indefinitely on a stuck Unipile request,
  // which previously left jobs stuck in 'running' until the 2h cron sweeper picked them up.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    const queryParams = new URLSearchParams({
      account_id: accountId,
      limit: '50',
    });
    if (cursor) {
      queryParams.set('cursor', cursor);
    }

    response = await fetch(`${dsnUrl}/api/v1/linkedin/search?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Unipile LinkedIn search request timed out after 90s');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await parseApiError(response);
    console.error(`[LinkedIn Search Import] API error: ${response.status} - ${errorText}`);

    // Parse error to match SDK format for consistent handling
    const error = { body: { status: response.status, message: errorText } };
    throw error;
  }

  const data = await response.json();
  console.log(`[LinkedIn Search Import] API response received, items: ${data.items?.length || 0}`);

  // Debug: Log first profile structure to understand the data format
  if (data.items?.length > 0) {
    console.log(`[LinkedIn Search Import] First profile structure:`, JSON.stringify(data.items[0], null, 2));
  }

  return data as UnipileSearchResponse;
}
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Parse body once, up front — if we try again in the catch block the stream
  // is already consumed and we silently lose the jobId, leaving jobs stuck
  // in 'running' forever when a fatal error hits.
  let jobId: string | undefined;
  let supabase: SupabaseClient<any> | undefined;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    supabase = createClient(supabaseUrl, supabaseKey);
    ({ jobId } = await req.json());

    if (!jobId) {
      throw new Error('jobId is required');
    }

    console.log(`[LinkedIn Search Import] Starting job ${jobId}`);

    // Get job details with account info
    const { data: job, error: jobError } = await supabase
      .from('linkedin_import_jobs')
      .select(`
        *,
        account:unipile_accounts(*),
        target_list:lead_lists(*)
      `)
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message || 'Not found'}`);
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, job.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Sweep any stale 'running' jobs from prior crashed invocations so they
    // don't linger as false in-progress indicators in the UI.
    await supabase
      .from('linkedin_import_jobs')
      .update({
        status: 'failed',
        error_message: 'Import timed out or the worker crashed. Please retry.',
        completed_at: new Date().toISOString(),
      })
      .eq('status', 'running')
      .lt('started_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());

    if (job.status === 'cancelled') {
      console.log(`[LinkedIn Search Import] Job ${jobId} was cancelled`);
      return new Response(JSON.stringify({ success: false, reason: 'cancelled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mark as running
    await supabase
      .from('linkedin_import_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
      })
      .eq('id', jobId);

    const account = job.account;
    if (!account || account.status !== 'active') {
      throw new Error('LinkedIn account is not active');
    }

    if (account.organization_id !== job.organization_id) {
      throw new Error('LinkedIn account does not belong to this import organization');
    }

    if (job.target_list?.organization_id && job.target_list.organization_id !== job.organization_id) {
      throw new Error('Target list does not belong to this import organization');
    }

    // Get API credentials. Prefer the current org/inherited BYOK key so imports
    // use the same source of truth as account status checks; fall back to the
    // account copy for older rows that predate api_keys.
    const apiKeyData = await resolveApiKey(supabase, job.organization_id, 'unipile');
    const encryptedApiKey = apiKeyData?.key_encrypted || account.access_token_encrypted;
    if (!encryptedApiKey) {
      throw new Error('Missing Unipile API key for LinkedIn import');
    }

    const apiKey = await decryptApiKey(encryptedApiKey, encryptionKey);
    const dsnUrl = normalizeDsnUrl(
      (apiKeyData?.metadata?.dsn_url as string | undefined) ||
      account.dsn_url
    );

    // Parse metadata
    const metadata = job.metadata as SearchMetadata;
    const maxLeads = metadata.max_leads || 100;

    // Auto-detect API type from URL if not specified
    if (!metadata.api_type && job.source_url) {
      metadata.api_type = detectApiType(job.source_url);
    }

    const connectionParams = account.metadata?.connection_params?.im;
    const premiumFeatures = connectionParams?.premiumFeatures || [];
    const premiumId = connectionParams?.premiumId;
    // Sales Navigator is a SPECIFIC premium feature, not just "has premium".
    // A bare premiumId means LinkedIn Premium (Career/Business), which does NOT
    // grant Sales Nav search — auto-upgrading those accounts sent classic
    // searches to the Sales Nav API, which then 422s ("Expected union value").
    // Require the actual sales_navigator feature flag.
    const accountHasSalesNavigator = Array.isArray(premiumFeatures)
      && premiumFeatures.includes('sales_navigator');

    // Older frontend builds could create parameter jobs as `classic` even when
    // the selected account has Sales Navigator, so the server upgrades them to
    // use the better API. But an EXPLICIT api_type is the caller's decision and
    // must be honoured — otherwise `api_type: "classic"` is silently ignored and
    // an account without Sales Nav can never run parameter mode. The MCP/frontend
    // stamp api_type_explicit; only auto-upgrade when it is absent.
    if (
      metadata.search_mode === 'parameters' &&
      metadata.api_type !== 'sales_navigator' &&
      !metadata.api_type_explicit &&
      accountHasSalesNavigator
    ) {
      metadata.api_type = 'sales_navigator';
      await supabase
        .from('linkedin_import_jobs')
        .update({
          type: 'sales_nav',
          metadata: {
            ...metadata,
            api_type: 'sales_navigator',
            server_upgraded_api_type: true,
            server_upgraded_at: new Date().toISOString(),
          },
        })
        .eq('id', jobId);
    }

    console.log(`[LinkedIn Search Import] Mode: ${metadata.search_mode || 'url'}, API: ${metadata.api_type || 'classic'}, max: ${maxLeads}`);

    // Log Sales Navigator metadata (informational only - Unipile API is the source of truth)
    if (metadata.api_type === 'sales_navigator') {
      console.log(`[LinkedIn Search Import] Sales Nav metadata - premiumId: ${premiumId}, premiumFeatures: ${JSON.stringify(premiumFeatures)}`);

      if (!premiumId && premiumFeatures.length === 0) {
        console.warn(
          '[LinkedIn Search Import] Stored metadata does not show Sales Navigator features. ' +
          'This may be stale - proceeding with import and letting Unipile API validate access.'
        );
      }
    }

    const invocationStartedAt = Date.now();
    const continuationAfterMs = 85_000;
    let totalFound = metadata.resume_total_found || 0;
    let totalImported = metadata.resume_total_imported || 0;
    let totalSkipped = metadata.resume_total_skipped || 0;
    let cursor: string | null = metadata.resume_cursor || null;
    let retryCount = 0;
    const maxRetries = 3;
    const allSkipReasons: string[] = Array.isArray(metadata.resume_skip_reasons)
      ? [...metadata.resume_skip_reasons]
      : [];

    // Paginate through search results
    while (totalImported + totalSkipped < maxLeads) {
      // Check if job was cancelled
      const { data: currentJob } = await supabase
        .from('linkedin_import_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (currentJob?.status === 'cancelled') {
        console.log(`[LinkedIn Search Import] Job cancelled, stopping`);
        break;
      }

      console.log(`[LinkedIn Search Import] Fetching page, cursor: ${cursor || 'none'}`);

      let data: UnipileSearchResponse;
      try {
        data = await executeLinkedInSearch(
          dsnUrl,
          apiKey,
          account.unipile_account_id,
          metadata,
          job.source_url,
          cursor
        );
        retryCount = 0; // Reset on success
      } catch (error) {
        const parsedError = parseUnipileError(error);
        console.error(`[LinkedIn Search Import] API error: ${parsedError.code} - ${parsedError.message}`);

        // Handle rate limiting with retry
        if (parsedError.code === 'RATE_LIMITED') {
          console.log(`[LinkedIn Search Import] Rate limited, waiting 60s...`);
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }

        // Retry on retryable errors
        if (parsedError.retryable && retryCount < maxRetries) {
          retryCount++;
          const backoffTime = 1000 * Math.pow(2, retryCount);
          console.log(`[LinkedIn Search Import] Retrying (${retryCount}/${maxRetries}) after ${backoffTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        throw new Error(parsedError.message);
      }

      // Handle response (supports both new and legacy formats)
      const profiles = data.items || data.results || data.users || [];

      if (!Array.isArray(profiles) || profiles.length === 0) {
        // If this is the first page and we got zero results, fail with a helpful message
        // instead of silently completing with 0 imported
        if (cursor === null && totalImported === 0 && totalSkipped === 0) {
          if (metadata.api_type === 'sales_navigator') {
            throw new Error(
              'Sales Navigator search returned no results. This usually means the LinkedIn account does not have an active Sales Navigator subscription, or the search URL has expired. Please verify your Sales Navigator access and try with a fresh search URL.'
            );
          }
          throw new Error(
            'LinkedIn search returned no results. The search criteria may be too restrictive, or the search URL may have expired.'
          );
        }
        console.log('[LinkedIn Search Import] No more results');
        break;
      }

      // Get total count from new or legacy response format
      if (totalFound === 0) {
        const total = data.paging?.total_count || data.total || 0;
        if (total > 0) {
          totalFound = Math.min(total, maxLeads);
          await supabase
            .from('linkedin_import_jobs')
            .update({ total_found: totalFound })
            .eq('id', jobId);
        }
      }

      // Store first profile for debugging
      if (profiles.length > 0 && totalImported === 0 && totalSkipped === 0) {
        const firstProfile = profiles[0];
        console.log(`[LinkedIn Search Import] First profile keys:`, Object.keys(firstProfile));
        console.log(`[LinkedIn Search Import] First profile id:`, firstProfile.id);
        console.log(`[LinkedIn Search Import] First profile member_urn:`, firstProfile.member_urn);
        console.log(`[LinkedIn Search Import] First profile public_identifier:`, firstProfile.public_identifier);

        // Store debug data in job metadata
        await supabase
          .from('linkedin_import_jobs')
          .update({
            metadata: {
              ...metadata,
              debug_first_profile: {
                keys: Object.keys(firstProfile),
                id: firstProfile.id,
                member_urn: firstProfile.member_urn,
                public_identifier: firstProfile.public_identifier,
                first_name: firstProfile.first_name,
                last_name: firstProfile.last_name,
              }
            }
          })
          .eq('id', jobId);
      }

      // Process each profile
      for (const profile of profiles) {
        if (totalImported + totalSkipped >= maxLeads) break;

        try {
          const result = await processProfile(
            supabase,
            job.organization_id,
            job.account_id,
            job.target_list_id,
            profile
          );

          if (result === 'imported') {
            totalImported++;
          } else {
            totalSkipped++;
            // Capture skip reason for debugging
            if (allSkipReasons.length < 10) {
              allSkipReasons.push(`Profile ${profile.id || profile.public_identifier || 'unknown'} skipped (returned 'skipped')`);
            }
          }

          // Update progress
          const progress = Math.round(((totalImported + totalSkipped) / maxLeads) * 100);
          await supabase
            .from('linkedin_import_jobs')
            .update({
              progress: Math.min(progress, 99), // Keep 99 until complete
              total_imported: totalImported,
              total_skipped: totalSkipped,
            })
            .eq('id', jobId);

        } catch (err) {
          console.error(`[LinkedIn Search Import] Error processing profile:`, err);
          totalSkipped++;
          // Capture error for debugging
          if (allSkipReasons.length < 10) {
            allSkipReasons.push(`Error processing ${profile.id || profile.public_identifier || 'unknown'}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Get next page cursor
      cursor = data.cursor || data.next_cursor || null;
      if (!cursor) {
        console.log('[LinkedIn Search Import] No more pages');
        break;
      }

      if (Date.now() - invocationStartedAt >= continuationAfterMs) {
        const { data: latestJobData } = await supabase
          .from('linkedin_import_jobs')
          .select('metadata')
          .eq('id', jobId)
          .single();

        await supabase
          .from('linkedin_import_jobs')
          .update({
            status: 'running',
            progress: Math.min(Math.round(((totalImported + totalSkipped) / maxLeads) * 100), 99),
            total_found: totalFound || totalImported + totalSkipped,
            total_imported: totalImported,
            total_skipped: totalSkipped,
            completed_at: null,
            error_message: null,
            metadata: {
              ...((latestJobData?.metadata || metadata) as Record<string, unknown>),
              resume_cursor: cursor,
              resume_total_found: totalFound,
              resume_total_imported: totalImported,
              resume_total_skipped: totalSkipped,
              resume_skip_reasons: allSkipReasons,
              continuation_scheduled_at: new Date().toISOString(),
              // Real forward progress: reset the stuck-recovery breakage counter
              // so recover_stuck_import_jobs()'s attempt budget counts CONSECUTIVE
              // failed recoveries, not lifetime pages of a large healthy import.
              resume_attempts: 0,
            },
          })
          .eq('id', jobId);

        continueImportInBackground(supabaseUrl, supabaseKey, jobId);
        console.log(`[LinkedIn Search Import] Scheduled continuation for job ${jobId} at cursor ${cursor}`);

        return new Response(JSON.stringify({
          success: true,
          continued: true,
          totalImported,
          totalSkipped,
        }), {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Delay between pages
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Get current metadata to preserve it
    const { data: currentJobData } = await supabase
      .from('linkedin_import_jobs')
      .select('metadata')
      .eq('id', jobId)
      .single();

    const finalMetadata: Record<string, unknown> = {
      ...((currentJobData?.metadata || {}) as Record<string, unknown>),
      debug_skip_reasons: allSkipReasons,
    };
    delete finalMetadata.resume_cursor;
    delete finalMetadata.resume_total_found;
    delete finalMetadata.resume_total_imported;
    delete finalMetadata.resume_total_skipped;
    delete finalMetadata.resume_skip_reasons;
    delete finalMetadata.continuation_scheduled_at;
    delete finalMetadata.resume_attempts;

    // Mark complete with debug info
    await supabase
      .from('linkedin_import_jobs')
      .update({
        status: 'completed',
        progress: 100,
        total_found: totalFound || totalImported + totalSkipped,
        total_imported: totalImported,
        total_skipped: totalSkipped,
        completed_at: new Date().toISOString(),
        error_message: null,
        metadata: finalMetadata,
      })
      .eq('id', jobId);

    console.log(`[LinkedIn Search Import] Completed: imported=${totalImported}, skipped=${totalSkipped}`);
    if (allSkipReasons.length > 0) {
      console.log(`[LinkedIn Search Import] Skip reasons:`, allSkipReasons);
    }

    return new Response(JSON.stringify({
      success: true,
      totalImported,
      totalSkipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[LinkedIn Search Import] Fatal error:', error);

    if (jobId && supabase) {
      try {
        await supabase
          .from('linkedin_import_jobs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      } catch (updateErr) {
        console.error('[LinkedIn Search Import] Failed to mark job as failed:', updateErr);
      }
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Process a single profile and create/update contact
 * Returns 'imported' if contact was added to list, 'skipped' if already in list
 */
async function processProfile(
  supabase: SupabaseClient<any>,
  organizationId: string,
  accountId: string,
  listId: string,
  profile: Record<string, unknown>
): Promise<'imported' | 'skipped'> {
  // Log the raw profile for debugging
  console.log(`[LinkedIn Search Import] Processing profile:`, JSON.stringify(profile, null, 2));

  // Extract profile data - Unipile returns different field names depending on the API
  // From SDK docs: items contain id, first_name, last_name, public_identifier, profile_url, etc.
  // The Unipile API schema shows 'member_urn' as a possible ID field
  let providerId = (
    profile.provider_id ||
    profile.id ||
    profile.member_urn ||
    profile.public_identifier ||
    profile.urn ||
    profile.entityUrn
  ) as string;

  // Fallback: use public_identifier as unique ID if nothing else found
  if (!providerId && profile.public_identifier) {
    providerId = `linkedin:${profile.public_identifier}`;
    console.log(`[LinkedIn Search Import] Using public_identifier as fallback ID: ${providerId}`);
  }

  if (!providerId) {
    console.log(`[LinkedIn Search Import] Skipping profile - no provider ID found. Available keys:`, Object.keys(profile));
    return 'skipped';
  }

  const providedFirst = (profile.first_name || profile.firstName) as string | undefined;
  const providedLast = (profile.last_name || profile.lastName) as string | undefined;
  const displayName = (
    profile.name ||
    profile.display_name ||
    profile.full_name ||
    (providedFirst && providedLast ? `${providedFirst} ${providedLast}` : null) ||
    providedFirst ||
    'Unknown'
  ) as string;

  // Classic LinkedIn search returns only a decorated `name` string (Sales Nav
  // ships the pair), which used to leave first_name NULL and break
  // {{first_name}} downstream. Provider-supplied names stay authoritative.
  const derived = splitDisplayName(displayName);
  const firstName = providedFirst || derived.firstName || undefined;
  const lastName = providedLast || derived.lastName || undefined;

  // Sales Navigator returns current_positions array with { company, role } objects
  const currentPositions = profile.current_positions as Array<Record<string, unknown>> | undefined;
  const firstPosition = Array.isArray(currentPositions) && currentPositions.length > 0 ? currentPositions[0] : null;

  const headline = (profile.headline || profile.title || profile.occupation) as string | undefined;
  // Extract job title: prefer role from current_positions (Sales Nav), then headline if it's short enough
  // Sales Nav often returns long bio text in headline, so current_positions.role is more accurate
  const jobTitle = (
    firstPosition?.role ||
    profile.title ||
    profile.occupation ||
    // Only use headline as job title if it's reasonably short (not a bio)
    (headline && headline.length <= 120 ? headline : null)
  ) as string | undefined;
  const company = (
    profile.company ||
    profile.company_name ||
    firstPosition?.company ||
    (profile.current_company as Record<string, unknown>)?.name
  ) as string | undefined;
  const avatarUrl = (
    profile.avatar_url ||
    profile.profile_picture_url ||
    profile.picture_url ||
    profile.image_url ||
    profile.picture
  ) as string | undefined;

  // Build profile URL from multiple possible sources
  // Unipile sometimes returns profile_url, sometimes public_identifier
  const publicIdentifier = profile.public_identifier as string | undefined;
  const profileUrl = (
    profile.profile_url ||
    profile.public_profile_url ||
    profile.linkedin_url ||
    (publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null) ||
    // Try to extract from provider ID if it looks like a LinkedIn URN
    (typeof providerId === 'string' && providerId.includes('linkedin') ? null : null)
  ) as string | undefined;

  // Location from LinkedIn profile - stored in city field (crm_contacts doesn't have a location column)
  const locationString = profile.location as string | undefined;

  console.log(`[LinkedIn Search Import] Extracted: providerId=${providerId}, name=${displayName}, profileUrl=${profileUrl}, publicId=${publicIdentifier}`);

  // If we have no profile URL but have a public_identifier in the providerId, try to extract it
  let finalProfileUrl = profileUrl;
  if (!finalProfileUrl && publicIdentifier) {
    finalProfileUrl = `https://www.linkedin.com/in/${publicIdentifier}`;
  }

  // If still no URL, we need to skip or use providerId as unique key
  if (!finalProfileUrl) {
    console.log(`[LinkedIn Search Import] No profile URL found, using providerId as fallback lookup`);
  }

  const accountScopedProfileData = {
    imported_at: new Date().toISOString(),
    source: 'linkedin_search',
    profile,
  };

  // Check if contact already exists by LinkedIn identity. Keep account attribution
  // explicit through linked_account_ids so inbound messages/imports do not match a
  // contact that only belongs to another connected LinkedIn account.
  // The Supabase client here is untyped, so every row comes back as `never` and
  // assigning it would narrow this variable away. Name the shape and cast.
  type ExistingContact = { id: string; first_name?: string | null; last_name?: string | null };
  let existingContact: ExistingContact | null = null;
  let identityWasLinkedToAccount = false;

  const { data: identityData } = await supabase
    .from('crm_contact_identities')
    .select('id, contact_id, linked_account_ids, raw_connection_data')
    .eq('organization_id', organizationId)
    .eq('channel', 'linkedin')
    .eq('platform_user_id', providerId)
    .maybeSingle();

  if (identityData) {
    const linkedAccountIds = (identityData.linked_account_ids || []) as string[];
    identityWasLinkedToAccount = linkedAccountIds.includes(accountId);

    if (!identityWasLinkedToAccount) {
      await supabase
        .from('crm_contact_identities')
        .update({
          linked_account_ids: [...new Set([...linkedAccountIds, accountId])],
          raw_connection_data: {
            ...((identityData.raw_connection_data || {}) as Record<string, unknown>),
            [accountId]: accountScopedProfileData,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', identityData.id);
    }

    const { data } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name')
      .eq('id', identityData.contact_id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    existingContact = data as ExistingContact | null;
  }

  let contactId: string;
  let isNewContact = false;

  if (existingContact) {
    contactId = existingContact.id;

    // Only overwrite top-level contact fields when this identity was already
    // associated with the same source account. For a newly linked account, keep
    // account-specific profile payload in raw_connection_data to avoid one
    // account's view overwriting another account's CRM fields.
    if (identityWasLinkedToAccount) {
      // A stored name may have come from enrichment or Sales Nav, both better
      // than a split off a decorated display string — only fill the gap.
      const nameFill: Record<string, string> = {};
      if (firstName && !existingContact.first_name) nameFill.first_name = firstName;
      if (lastName && !existingContact.last_name) nameFill.last_name = lastName;

      await supabase
        .from('crm_contacts')
        .update({
          display_name: displayName,
          ...nameFill,
          job_title: jobTitle || headline,
          company: company,
          avatar_url: avatarUrl,
          city: locationString, // LinkedIn location stored in city field
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId);
    }

  } else {
    isNewContact = true;
    // Create new contact
    const { data: newContact, error: contactError } = await supabase
      .from('crm_contacts')
      .insert({
        organization_id: organizationId,
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        job_title: jobTitle || headline,
        company: company,
        avatar_url: avatarUrl,
        primary_linkedin_url: finalProfileUrl,
        city: locationString, // LinkedIn location stored in city field
        source: 'linkedin_search',
        status: 'active',
      })
      .select('id')
      .single();

    if (contactError || !newContact) {
      console.error(`[LinkedIn Search Import] Failed to create contact:`, contactError);
      throw new Error(`Failed to create contact: ${contactError?.message}`);
    }

    contactId = newContact.id;
    console.log(`[LinkedIn Search Import] Created new contact: ${contactId}`);

    // Create LinkedIn identity
    const { error: identityError } = await supabase.from('crm_contact_identities').insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel: 'linkedin',
      platform_user_id: providerId,
      platform_username: displayName,
      platform_profile_url: finalProfileUrl,
      platform_avatar_url: avatarUrl,
      platform_metadata: {
        headline,
        company,
        location: locationString,
      },
      linked_account_ids: [accountId],
      raw_connection_data: {
        [accountId]: accountScopedProfileData,
      },
      is_primary: true,
    });

    if (identityError) {
      console.error(`[LinkedIn Search Import] Failed to create identity:`, identityError);
    }
  }

  // Check if contact is already in this list
  const { data: existingMember } = await supabase
    .from('lead_list_members')
    .select('id, source_data')
    .eq('list_id', listId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existingMember) {
    const sourceData = (existingMember.source_data || {}) as Record<string, unknown>;
    const sourceAccountIds = Array.isArray(sourceData.source_account_ids)
      ? sourceData.source_account_ids as string[]
      : [];

    await supabase
      .from('lead_list_members')
      .update({
        source_data: {
          ...sourceData,
          source_account_ids: [...new Set([...sourceAccountIds, accountId])],
          last_imported_account_id: accountId,
          last_imported_at: new Date().toISOString(),
        },
      })
      .eq('id', existingMember.id);

    // Contact already in list - skip count, but keep source account attribution updated.
    console.log(`[LinkedIn Search Import] Contact ${contactId} already in list ${listId}, skipping`);
    return 'skipped';
  }

  // Add to lead list
  const { error: listError } = await supabase.from('lead_list_members').insert({
    list_id: listId,
    contact_id: contactId,
    source_data: {
      import_type: 'linkedin_search',
      imported_at: new Date().toISOString(),
      source_account_id: accountId,
      source_account_ids: [accountId],
      is_new_contact: isNewContact,
    },
  });

  if (listError) {
    console.error(`[LinkedIn Search Import] Failed to add contact ${contactId} to list ${listId}:`, listError);
    return 'skipped';
  }

  // Successfully added to list
  console.log(`[LinkedIn Search Import] Successfully added contact ${contactId} to list ${listId}`);
  return 'imported';
}
