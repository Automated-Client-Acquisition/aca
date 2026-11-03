import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { extractPostInfo, resolveSocialId, type UnipileAccountRef } from '../_shared/linkedin-engagement/post-resolver.ts';
import {
  fetchReactionsPage,
  fetchCommentsPage,
  matchesReactionFilter,
  extractReactionAuthor,
  extractCommentAuthor,
} from '../_shared/linkedin-engagement/engagement-fetcher.ts';
import { processUser, decryptApiKey } from '../_shared/linkedin-engagement/process-user.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG_PREFIX = '[LinkedIn Post Import]';

// Max execution time before self-terminating to avoid timeout (50s safety margin for 60s limit)
const MAX_EXECUTION_MS = 50000;
// Batch size for processing users
const BATCH_SIZE = 25;

/**
 * LinkedIn Post Import Edge Function
 *
 * Imports leads from LinkedIn post reactors and/or commenters.
 * Uses chunked processing with state persistence to handle large imports
 * that may exceed edge function timeout limits.
 *
 * Core Unipile logic (post resolution, engagement paging, contact upsert)
 * lives in _shared/linkedin-engagement/ and is shared with the
 * lead-list-source-poller.
 */
serve(async (req) => {
  console.log(`${LOG_PREFIX} Function invoked`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let jobId: string | undefined;

  try {
    console.log(`${LOG_PREFIX} Checking env vars...`);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      console.error(`${LOG_PREFIX} Missing env vars:`, {
        hasSupabaseUrl: !!supabaseUrl,
        hasSupabaseKey: !!supabaseKey,
        hasEncryptionKey: !!encryptionKey,
      });
      throw new Error('Missing required environment variables');
    }

    console.log(`${LOG_PREFIX} Parsing request body...`);
    const body = await req.json();
    jobId = body.jobId;

    if (!jobId) {
      throw new Error('jobId is required');
    }

    console.log(`${LOG_PREFIX} Starting job ${jobId}`);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify auth token (skip for internal self-invocations which use service role)
    const authHeader = req.headers.get('Authorization');
    const isServiceRole = authHeader?.includes(supabaseKey);
    if (!isServiceRole && authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        throw new Error('Unauthorized: invalid token');
      }
    }

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('linkedin_import_jobs')
      .select(`
        *,
        account:unipile_accounts(*)
      `)
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message || 'Not found'}`);
    }

    if (job.status === 'cancelled') {
      console.log(`${LOG_PREFIX} Job ${jobId} was cancelled`);
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
      })
      .eq('id', jobId);

    const account = job.account;
    if (!account || account.status !== 'active') {
      throw new Error('LinkedIn account is not active');
    }

    // Decrypt API key
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const accountRef: UnipileAccountRef = {
      unipileAccountId: account.unipile_account_id,
      dsnUrl,
      apiKey,
    };

    // Parse post URL to extract activity ID and username
    const { activityId } = extractPostInfo(job.source_url);
    if (!activityId) {
      throw new Error('Could not extract post ID from URL');
    }

    // We need to get the social_id for this post
    // Unipile requires social_id (not activity ID) for comments/reactions endpoints
    // Check if we already have it from a previous run (resumption)
    let socialId: string | null = (job.metadata as Record<string, unknown>)?.social_id as string || null;

    if (socialId) {
      console.log(`${LOG_PREFIX} Resuming with cached social_id: ${socialId}`);
    } else {
      socialId = await resolveSocialId(accountRef, job.source_url, LOG_PREFIX);
      if (!socialId) {
        throw new Error(`Could not get social_id for post. Activity ID: ${activityId}`);
      }
    }

    // At this point, socialId is guaranteed to be set (either from cache or fetched)
    console.log(`${LOG_PREFIX} Using social_id: ${socialId} for activity ID: ${activityId}`);

    // Save the social_id to metadata for resumption
    if (!job.metadata?.social_id) {
      await supabase
        .from('linkedin_import_jobs')
        .update({
          metadata: { ...job.metadata, social_id: socialId },
        })
        .eq('id', jobId);
    }

    const metadata = job.metadata as {
      max_leads?: number;
      include_reactors?: boolean;
      include_commenters?: boolean;
      reaction_types?: string[];
      // State for resumption
      social_id?: string;
      reactors_cursor?: string | null;
      commenters_cursor?: string | null;
      reactors_done?: boolean;
      commenters_done?: boolean;
      processed_ids?: string[];
    };

    const maxLeads = metadata.max_leads || 500;
    const includeReactors = metadata.include_reactors !== false;
    const includeCommenters = metadata.include_commenters !== false;
    const reactionTypes = metadata.reaction_types || [];

    console.log(`${LOG_PREFIX} Social ID: ${socialId}, reactors: ${includeReactors}, commenters: ${includeCommenters}`);

    // Resume state from previous run if available
    let totalFound = job.total_found || 0;
    let totalImported = job.total_imported || 0;
    let totalSkipped = job.total_skipped || 0;
    const processedIds = new Set<string>(metadata.processed_ids || []);
    let reactorsCursor: string | null = metadata.reactors_cursor || null;
    let commentersCursor: string | null = metadata.commenters_cursor || null;
    let reactorsDone = metadata.reactors_done || false;
    let commentersDone = metadata.commenters_done || false;

    // Track execution time for chunking
    const startTime = Date.now();

    /**
     * Check if we're approaching timeout and should save state
     */
    const shouldYield = () => {
      const elapsed = Date.now() - startTime;
      return elapsed > MAX_EXECUTION_MS;
    };

    /**
     * Save current state for resumption
     */
    const saveState = async (reason: string) => {
      console.log(`${LOG_PREFIX} Saving state: ${reason}`);
      await supabase
        .from('linkedin_import_jobs')
        .update({
          metadata: {
            ...metadata,
            social_id: socialId,
            reactors_cursor: reactorsCursor,
            commenters_cursor: commentersCursor,
            reactors_done: reactorsDone,
            commenters_done: commentersDone,
            processed_ids: Array.from(processedIds).slice(-1000), // Keep last 1000 IDs to prevent huge metadata
          },
          total_found: totalFound,
          total_imported: totalImported,
          total_skipped: totalSkipped,
          progress: Math.min(Math.round(((totalImported + totalSkipped) / maxLeads) * 100), 99),
        })
        .eq('id', jobId);
    };

    /**
     * Re-invoke this function to continue processing
     */
    const continueProcessing = () => {
      console.log(`${LOG_PREFIX} Re-invoking function to continue processing`);
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || supabaseKey;

      const continuationPromise = fetch(`${supabaseUrl}/functions/v1/linkedin-post-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ jobId }),
      }).catch(err => console.error(`${LOG_PREFIX} Failed to re-invoke:`, err));

      if ((globalThis as any).EdgeRuntime?.waitUntil) {
        (globalThis as any).EdgeRuntime.waitUntil(continuationPromise);
      }
    };

    // Fetch reactors
    if (includeReactors && !reactorsDone && totalImported + totalSkipped < maxLeads) {
      console.log(`${LOG_PREFIX} Fetching reactors... (cursor: ${reactorsCursor || 'start'})`);

      let hasMore = true;

      while (hasMore && totalImported + totalSkipped < maxLeads) {
        // Check if we should yield to avoid timeout
        if (shouldYield()) {
          console.log(`${LOG_PREFIX} Approaching timeout, saving state for continuation`);
          await saveState('timeout_reactors');
          await continueProcessing();
          return new Response(JSON.stringify({
            success: true,
            status: 'continuing',
            message: 'Processing will continue in next invocation',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if cancelled
        const { data: currentJob } = await supabase
          .from('linkedin_import_jobs')
          .select('status')
          .eq('id', jobId)
          .single();

        if (currentJob?.status === 'cancelled') {
          console.log(`${LOG_PREFIX} Job cancelled, stopping`);
          break;
        }

        const page = await fetchReactionsPage(accountRef, socialId, reactorsCursor, BATCH_SIZE, LOG_PREFIX);

        if (!page.ok) {
          if (page.rateLimited) {
            // Rate limited - save state and continue later
            await saveState('rate_limited_reactors');
            await continueProcessing();
            return new Response(JSON.stringify({
              success: true,
              status: 'rate_limited',
              message: 'Rate limited, will retry shortly',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          // Other error - mark reactors as done and try commenters
          console.log(`${LOG_PREFIX} Reactors fetch failed, moving to commenters`);
          reactorsDone = true;
          break;
        }

        const reactions = page.items;

        if (reactions.length === 0) {
          hasMore = false;
          reactorsDone = true;
          break;
        }

        totalFound += reactions.length;

        for (const reaction of reactions) {
          if (totalImported + totalSkipped >= maxLeads) break;

          // Filter by reaction type if specified
          if (!matchesReactionFilter(reaction, reactionTypes)) {
            continue;
          }

          const { userId, author } = extractReactionAuthor(reaction);
          if (!userId || processedIds.has(userId)) continue;

          processedIds.add(userId);

          try {
            const result = await processUser(
              supabase,
              job.organization_id,
              job.target_list_id,
              author,
              'post_reactor',
              {},
              LOG_PREFIX
            );

            if (result === 'imported') {
              totalImported++;
            } else {
              totalSkipped++;
            }

            // Update progress every few users
            if ((totalImported + totalSkipped) % 10 === 0) {
              await updateProgress(supabase, jobId, totalImported, totalSkipped, maxLeads, totalFound);
            }

          } catch (err) {
            console.error(`${LOG_PREFIX} Error processing reactor:`, err);
            totalSkipped++;
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Update cursor for next iteration or resumption
        reactorsCursor = page.cursor;
        hasMore = !!reactorsCursor;

        if (!hasMore) {
          reactorsDone = true;
        }

        // Update progress after each batch
        await updateProgress(supabase, jobId, totalImported, totalSkipped, maxLeads, totalFound);

        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } else if (includeReactors) {
      reactorsDone = true;
    }

    // Fetch commenters
    if (includeCommenters && !commentersDone && totalImported + totalSkipped < maxLeads) {
      console.log(`${LOG_PREFIX} Fetching commenters... (cursor: ${commentersCursor || 'start'})`);

      let hasMore = true;

      while (hasMore && totalImported + totalSkipped < maxLeads) {
        // Check if we should yield to avoid timeout
        if (shouldYield()) {
          console.log(`${LOG_PREFIX} Approaching timeout, saving state for continuation`);
          await saveState('timeout_commenters');
          await continueProcessing();
          return new Response(JSON.stringify({
            success: true,
            status: 'continuing',
            message: 'Processing will continue in next invocation',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if cancelled
        const { data: currentJob } = await supabase
          .from('linkedin_import_jobs')
          .select('status')
          .eq('id', jobId)
          .single();

        if (currentJob?.status === 'cancelled') {
          console.log(`${LOG_PREFIX} Job cancelled, stopping`);
          break;
        }

        const page = await fetchCommentsPage(accountRef, socialId, commentersCursor, BATCH_SIZE, LOG_PREFIX);

        if (!page.ok) {
          if (page.rateLimited) {
            // Rate limited - save state and continue later
            await saveState('rate_limited_commenters');
            await continueProcessing();
            return new Response(JSON.stringify({
              success: true,
              status: 'rate_limited',
              message: 'Rate limited, will retry shortly',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          // Other error - mark commenters as done
          commentersDone = true;
          break;
        }

        const comments = page.items;

        if (comments.length === 0) {
          hasMore = false;
          commentersDone = true;
          break;
        }

        totalFound += comments.length;

        for (const comment of comments) {
          if (totalImported + totalSkipped >= maxLeads) break;

          const { userId, author } = extractCommentAuthor(comment);
          if (!userId || processedIds.has(userId)) continue;

          processedIds.add(userId);

          try {
            const result = await processUser(
              supabase,
              job.organization_id,
              job.target_list_id,
              author,
              'post_commenter',
              {},
              LOG_PREFIX
            );

            if (result === 'imported') {
              totalImported++;
            } else {
              totalSkipped++;
            }

            // Update progress every few users
            if ((totalImported + totalSkipped) % 10 === 0) {
              await updateProgress(supabase, jobId, totalImported, totalSkipped, maxLeads, totalFound);
            }

          } catch (err) {
            console.error(`${LOG_PREFIX} Error processing commenter:`, err);
            totalSkipped++;
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Update cursor for next iteration or resumption
        commentersCursor = page.cursor;
        hasMore = !!commentersCursor;

        if (!hasMore) {
          commentersDone = true;
        }

        // Update progress after each batch
        await updateProgress(supabase, jobId, totalImported, totalSkipped, maxLeads, totalFound);

        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } else if (includeCommenters) {
      commentersDone = true;
    }

    // Mark complete
    await supabase
      .from('linkedin_import_jobs')
      .update({
        status: 'completed',
        progress: 100,
        total_found: totalFound,
        total_imported: totalImported,
        total_skipped: totalSkipped,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`${LOG_PREFIX} Completed: imported=${totalImported}, skipped=${totalSkipped}`);

    return new Response(JSON.stringify({
      success: true,
      totalImported,
      totalSkipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);

    // Try to mark job as failed if we have a jobId
    if (jobId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          await supabase
            .from('linkedin_import_jobs')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString(),
            })
            .eq('id', jobId);
        }
      } catch (updateError) {
        console.error(`${LOG_PREFIX} Failed to update job status:`, updateError);
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
 * Update job progress
 */
async function updateProgress(
  supabase: SupabaseClient<any>,
  jobId: string,
  imported: number,
  skipped: number,
  maxLeads: number,
  totalFound: number
) {
  const progress = Math.round(((imported + skipped) / maxLeads) * 100);
  await supabase
    .from('linkedin_import_jobs')
    .update({
      progress: Math.min(progress, 99),
      total_found: totalFound,
      total_imported: imported,
      total_skipped: skipped,
    })
    .eq('id', jobId);
}
