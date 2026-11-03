import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  decryptApiKey,
  startApifyRun,
  fetchDatasetItems,
  processApifyLead,
  type BatchInfo,
  type SearchConfig,
} from './apify-leads-utils.ts';

/**
 * Shared ingest + batch-chaining logic for Apify Leads Finder imports.
 *
 * Both `apify-leads-webhook` (the primary, push-based path driven by Apify's
 * ad-hoc completion webhook) and `apify-leads-poller` (the defense-in-depth,
 * pull-based cron fallback) call into this module so the reconcile behaviour
 * is identical regardless of which side notices a batch finished.
 */

// Process leads in small concurrent chunks. Sequential awaits over 1k+ leads
// (3-5 DB roundtrips each) blow past the edge function timeout and cause Apify
// to retry the webhook forever. Concurrency=10 keeps DB pressure reasonable
// while completing within the timeout budget.
const LEAD_CONCURRENCY = 10;

type Supabase = SupabaseClient;

interface IngestArgs {
  job: Record<string, unknown>;
  batches: BatchInfo[];
  batchIndex: number;
  /** Dataset id from the webhook payload / poller run lookup, if known. */
  datasetId?: string | null;
  apifyToken: string;
  supabaseUrl: string;
  encryptionKey: string | null;
}

interface FailArgs {
  job: Record<string, unknown>;
  batches: BatchInfo[];
  batchIndex: number;
  errorMessage: string;
  apifyToken: string | null;
  supabaseUrl: string;
  encryptionKey: string | null;
}

/**
 * Ingest a SUCCEEDED batch: fetch the dataset, process every lead, mark the
 * batch succeeded, then chain the next batch (or finalize the job).
 *
 * Mutates `batches[batchIndex]` in place. Returns per-batch counts so callers
 * can surface them in their HTTP response.
 */
export async function ingestBatchDataset(
  supabase: Supabase,
  { job, batches, batchIndex, datasetId, apifyToken, supabaseUrl, encryptionKey }: IngestArgs,
): Promise<{ imported: number; skipped: number; found: number }> {
  const batch = batches[batchIndex];

  // Pick up dataset_id from the run lookup if the batch didn't already store one.
  if (datasetId) batch.dataset_id = datasetId;
  const finalDatasetId = batch.dataset_id || datasetId;
  if (!finalDatasetId) {
    throw new Error('Dataset ID not found');
  }

  // Page through the dataset (PAGE_SIZE at a time) instead of loading the whole
  // thing into memory. Slurping a full 2500-lead batch via one response.json()
  // OOM'd the edge function (HTTP 546 WORKER_RESOURCE_LIMIT), so large batches
  // never ingested. Paging keeps peak memory bounded regardless of batch size.
  const PAGE_SIZE = 500;
  let imported = 0;
  let skipped = 0;
  let found = 0;
  let offset = 0;

  while (true) {
    const items = await fetchDatasetItems(apifyToken, finalDatasetId, PAGE_SIZE, offset);
    if (items.length === 0) break;
    found += items.length;

    for (let i = 0; i < items.length; i += LEAD_CONCURRENCY) {
      const chunk = items.slice(i, i + LEAD_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (lead) => {
          try {
            return await processApifyLead(
              supabase,
              job.organization_id as string,
              job.target_list_id as string,
              lead,
            );
          } catch (err) {
            console.error('[Apify Leads Ingest] Lead processing error:', err instanceof Error ? err.message : err);
            return 'skipped' as const;
          }
        }),
      );
      for (const r of results) {
        if (r === 'imported') imported++;
        else skipped++;
      }
    }

    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  batch.leads_found = found;
  batch.leads_imported = imported;
  batch.leads_skipped = skipped;
  batch.status = 'succeeded';
  batches[batchIndex] = batch;

  console.log(`[Apify Leads Ingest] Batch ${batchIndex} complete: imported=${imported}, skipped=${skipped}, found=${found}`);

  await handleBatchComplete(supabase, job, batches, batchIndex, apifyToken, supabaseUrl, encryptionKey);

  return { imported, skipped, found };
}

/**
 * Mark a batch failed and continue the job (chain the next batch or finalize).
 * Mirrors the FAILED-status path in the webhook.
 */
export async function failBatch(
  supabase: Supabase,
  { job, batches, batchIndex, errorMessage, apifyToken, supabaseUrl, encryptionKey }: FailArgs,
): Promise<void> {
  const batch = batches[batchIndex];
  batch.status = 'failed';
  batch.error = errorMessage;
  batches[batchIndex] = batch;

  console.error(`[Apify Leads Ingest] Batch ${batchIndex} failed: ${errorMessage}`);

  await handleBatchComplete(supabase, job, batches, batchIndex, apifyToken, supabaseUrl, encryptionKey);
}

/**
 * After a batch completes (success or failure), decide whether to start
 * the next batch or finalize the job.
 */
export async function handleBatchComplete(
  supabase: Supabase,
  job: Record<string, unknown>,
  batches: BatchInfo[],
  completedBatchIndex: number,
  apifyToken: string | null,
  supabaseUrl: string,
  encryptionKey: string | null,
): Promise<void> {
  const jobId = job.id as string;
  const totalBatches = batches.length;
  const nextBatchIndex = completedBatchIndex + 1;

  // Calculate running totals
  let totalFound = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  for (const b of batches) {
    totalFound += b.leads_found;
    totalImported += b.leads_imported;
    totalSkipped += b.leads_skipped;
  }

  const progress = Math.round(((completedBatchIndex + 1) / totalBatches) * 100);

  // Check if there are more batches and job isn't cancelled
  if (nextBatchIndex < totalBatches) {
    // Re-read current job state. Guards two races:
    //  1. The job was cancelled while we were processing.
    //  2. The next batch was already started by the other reconcile path
    //     (webhook vs poller) — starting it again would spawn a duplicate,
    //     billed Apify run.
    const { data: currentJob } = await supabase
      .from('apify_leads_import_jobs')
      .select('status, batches')
      .eq('id', jobId)
      .single();

    if (currentJob?.status === 'cancelled') {
      console.log(`[Apify Leads Ingest] Job ${jobId} cancelled, not starting next batch`);
      await supabase
        .from('apify_leads_import_jobs')
        .update({ batches, total_found: totalFound, total_imported: totalImported, total_skipped: totalSkipped })
        .eq('id', jobId);
      return;
    }

    const liveBatches = (currentJob?.batches as BatchInfo[] | null) ?? [];
    const liveNext = liveBatches[nextBatchIndex];
    if (liveNext && liveNext.status !== 'pending') {
      // Someone else already advanced this batch. Persist our totals/batch
      // results for the batch we just finished, but don't double-start.
      console.log(`[Apify Leads Ingest] Job ${jobId} batch ${nextBatchIndex} already ${liveNext.status}, skipping double-start`);
      await supabase
        .from('apify_leads_import_jobs')
        .update({ total_found: totalFound, total_imported: totalImported, total_skipped: totalSkipped })
        .eq('id', jobId);
      return;
    }

    // Start next batch - fetch token if not passed (e.g. called from error recovery)
    try {
      let token = apifyToken;
      if (!token) {
        if (!encryptionKey) {
          throw new Error('Cannot start next batch: no API token and no encryption key');
        }
        const { data: apiKey } = await supabase
          .from('api_keys')
          .select('key_encrypted')
          .eq('organization_id', job.organization_id as string)
          .eq('provider', 'apify')
          .eq('is_valid', true)
          .single();

        if (!apiKey) {
          throw new Error('Apify API key not found for next batch');
        }
        token = await decryptApiKey(apiKey.key_encrypted as string, encryptionKey);
      }

      const searchConfig = job.search_config as SearchConfig;
      const totalRequested = job.total_requested as number;
      const batchSize = (job.batch_size as number) || 2500;
      const batchFetchCount = Math.min(batchSize, totalRequested - (nextBatchIndex * batchSize));

      const webhookUrl = `${supabaseUrl}/functions/v1/apify-leads-webhook?jobId=${jobId}&batchIndex=${nextBatchIndex}`;
      const { runId, datasetId } = await startApifyRun(token, searchConfig, batchFetchCount, webhookUrl);

      batches[nextBatchIndex] = {
        ...batches[nextBatchIndex],
        apify_run_id: runId,
        dataset_id: datasetId,
        status: 'running',
      };

      await supabase
        .from('apify_leads_import_jobs')
        .update({
          current_batch: nextBatchIndex,
          progress: Math.min(progress, 99),
          total_found: totalFound,
          total_imported: totalImported,
          total_skipped: totalSkipped,
          batches,
        })
        .eq('id', jobId);

      console.log(`[Apify Leads Ingest] Started batch ${nextBatchIndex}: run=${runId}`);
      return;

    } catch (err) {
      console.error(`[Apify Leads Ingest] Failed to start batch ${nextBatchIndex}:`, err);
      // Mark remaining batches as failed and finalize
      for (let i = nextBatchIndex; i < totalBatches; i++) {
        batches[i].status = 'failed';
        batches[i].error = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  // All batches done (or remaining batches failed) - finalize job
  const allFailed = batches.every((b) => b.status === 'failed');
  const finalStatus = allFailed ? 'failed' : 'completed';

  // Update lead list count
  const { count: memberCount } = await supabase
    .from('lead_list_members')
    .select('id', { count: 'exact', head: true })
    .eq('list_id', job.target_list_id as string);

  if (memberCount !== null) {
    await supabase
      .from('lead_lists')
      .update({ lead_count: memberCount, updated_at: new Date().toISOString() })
      .eq('id', job.target_list_id as string);
  }

  await supabase
    .from('apify_leads_import_jobs')
    .update({
      status: finalStatus,
      progress: 100,
      total_found: totalFound,
      total_imported: totalImported,
      total_skipped: totalSkipped,
      completed_at: new Date().toISOString(),
      estimated_cost_usd: (totalFound / 1000) * 1.5,
      batches,
    })
    .eq('id', jobId);

  console.log(`[Apify Leads Ingest] Job ${jobId} ${finalStatus}: imported=${totalImported}, skipped=${totalSkipped}, found=${totalFound}`);
}
