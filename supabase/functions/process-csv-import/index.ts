/**
 * Process CSV Import Job Edge Function
 *
 * Streams the CSV file, keeping only one window of rows per invocation, and
 * processes rows in batches. For large files (50k+), uses a time budget with
 * self-invocation to resume where it left off — progress is tracked via current_row
 * in the DB, not byte offsets.
 *
 * Endpoint: POST /process-csv-import
 * Body: { jobId: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { CsvParseStream } from 'jsr:@std/csv@1.0.6/parse-stream';
import { normalizeEmployeeRange, normalizeIndustryLabel } from '../_shared/enrichment/firmographics.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rows per bulk-upsert RPC call. The edge function's Postgres role
// (authenticator) has a hard 8s statement_timeout — empirically, 200 rows
// through bulk_upsert_csv_contacts reliably finished within that in a clean
// test, but real batches (larger enrichment_data blobs, ambient load) still
// timed out at 150. 75 trades some throughput for real headroom below that.
const BATCH_SIZE = 75;
const PROGRESS_UPDATE_INTERVAL = 500; // Update progress every N rows
const TIME_BUDGET_MS = 120_000; // 120s of the 150s Edge Function timeout
// Rows held in memory per invocation; the stream is cancelled once filled.
const ROWS_PER_INVOCATION = 20_000;

interface FieldMapping {
  csvColumn: string;
  targetField: string;
}

interface CSVImportJob {
  id: string;
  organization_id: string;
  target_list_id: string;
  filename: string;
  file_path: string;
  total_rows: number;
  field_mappings: FieldMapping[];
  status: string;
  current_row: number;
  imported_count: number;
  skipped_count: number;
  failed_count: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let jobId: string | null = null;

  try {
    const body = await req.json();
    jobId = body.jobId;

    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, error: 'jobId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing CSV import job: ${jobId}`);

    // Fetch the job record
    const { data: job, error: jobError } = await supabase
      .from('csv_import_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error('Job not found:', jobError);
      return new Response(
        JSON.stringify({ success: false, error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, job.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    const typedJob = job as CSVImportJob;

    if (typedJob.status === 'cancelled') {
      return new Response(
        JSON.stringify({ success: false, error: 'Job was cancelled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typedJob.status === 'completed') {
      return new Response(
        JSON.stringify({ success: true, message: 'Job already completed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark as running on first invocation
    if (typedJob.status === 'pending') {
      await supabase
        .from('csv_import_jobs')
        .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    // Atomically claim the job before doing any real work. The self-invoke
    // chain and the recovery watchdog cron can both legitimately decide to
    // invoke the same job around the same moment (e.g. a slow batch pushing
    // updated_at close to the watchdog's staleness threshold) — without this,
    // two invocations racing on the same row range doubled the work and threw
    // fresh duplicate-key errors on top of it. A failed claim just means
    // another invocation already has it; that's expected, not an error.
    const { data: claimed } = await supabase.rpc('claim_csv_import_job', { p_job_id: jobId });
    if (!claimed || claimed.length === 0) {
      console.log(`Job ${jobId} already claimed by another invocation, skipping`);
      return new Response(
        JSON.stringify({ success: true, message: 'Job already being processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!typedJob.file_path) {
      await updateJobFailed(supabase, jobId, 'No file path found in job');
      return new Response(
        JSON.stringify({ success: false, error: 'No file path found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get signed URL
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('csv-imports')
      .createSignedUrl(typedJob.file_path, 3600);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      await updateJobFailed(supabase, jobId, `Failed to get file URL: ${signedUrlError?.message}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to get file URL' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Stream the file and keep only this invocation's window of rows. Buffering
    // the whole file (bytes + decoded string + every parsed row object) blew the
    // worker memory limit on a 52MB / 195k-row CSV: it died with 546 right after
    // the download, before row 0, and the recovery cron re-ran it forever.
    const resumeFromRow = typedJob.current_row || 0;
    console.log(`Streaming CSV file from row ${resumeFromRow}...`);
    const { rows: allRows, headers: csvHeaders, reachedEof, encoding: detectedEncoding } =
      await readCsvWindow(signedUrlData.signedUrl, resumeFromRow, ROWS_PER_INVOCATION);
    const windowEnd = resumeFromRow + allRows.length;
    const totalRows = reachedEof ? windowEnd : Math.max(typedJob.total_rows || 0, windowEnd + 1);
    console.log(`Read rows ${resumeFromRow}-${windowEnd} (${detectedEncoding}, eof=${reachedEof}), ${csvHeaders.length} columns: [${csvHeaders.slice(0, 5).join(', ')}...]`);

    // Email mapping is required for deduplication; LinkedIn URL is optional
    const mappings = typedJob.field_mappings;
    const linkedInMapping = mappings.find((m) => m.targetField === 'linkedin_url');
    const emailMapping = mappings.find((m) => m.targetField === 'email');
    if (!emailMapping) {
      await updateJobFailed(supabase, jobId, 'Email mapping is required for deduplication');
      return new Response(
        JSON.stringify({ success: false, error: 'Email mapping is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resume from where previous invocation left off
    const isResuming = resumeFromRow > 0;

    if (isResuming) {
      console.log(`Resuming from row ${resumeFromRow} (previous counts: ${typedJob.imported_count} imported, ${typedJob.skipped_count} skipped, ${typedJob.failed_count} failed)`);
    }

    // Debug: log sample row on first invocation
    if (!isResuming && allRows.length > 0) {
      const sample = allRows[0];
      const linkedinVal = linkedInMapping ? sample[linkedInMapping.csvColumn] : '(no mapping)';
      const emailVal = emailMapping ? sample[emailMapping.csvColumn] : '(no mapping)';
      console.log(`Sample: LinkedIn="${(linkedinVal || '').substring(0, 80)}" Email="${(emailVal || '').substring(0, 80)}"`);
    }

    // Accumulate counts from previous invocations
    let totalImported = isResuming ? typedJob.imported_count : 0;
    let totalSkipped = isResuming ? typedJob.skipped_count : 0;
    let totalFailed = isResuming ? typedJob.failed_count : 0;
    let missingLinkedin = 0;
    let invalidLinkedin = 0;
    let duplicatesUpdated = 0;

    // Process rows starting from resume point
    let currentRow = resumeFromRow;
    let timedOut = false;

    while (currentRow < windowEnd) {
      // Check time budget
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true;
        console.log(`Time budget exceeded at row ${currentRow}/${totalRows}, will self-invoke to continue`);
        break;
      }

      // Check cancellation every 250 rows
      if (currentRow % 250 === 0 && currentRow > resumeFromRow) {
        const { data: currentJob } = await supabase
          .from('csv_import_jobs')
          .select('status')
          .eq('id', jobId)
          .single();

        if (currentJob?.status === 'cancelled') {
          console.log(`Job ${jobId} was cancelled at row ${currentRow}`);
          return new Response(
            JSON.stringify({ success: false, error: 'Job was cancelled' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Collect a batch of valid rows, skipping invalid ones
      const batchContacts: Record<string, unknown>[] = [];
      const batchStart = currentRow;

      while (batchContacts.length < BATCH_SIZE && currentRow < windowEnd) {
        // Re-check time budget inside inner loop too
        if (Date.now() - startTime > TIME_BUDGET_MS) {
          timedOut = true;
          break;
        }

        const row = allRows[currentRow - resumeFromRow];
        currentRow++;

        const url = linkedInMapping ? row[linkedInMapping.csvColumn] : '';
        const email = emailMapping ? row[emailMapping.csvColumn] : '';
        const hasEmail = email && email.trim() && email.includes('@');

        if (!hasEmail) {
          missingLinkedin++;
          totalSkipped++;
          continue;
        }
        if (url && url.trim() && !url.includes('linkedin')) {
          invalidLinkedin++;
        }

        batchContacts.push(transformRowToContact(row, mappings, typedJob.organization_id));
      }

      if (timedOut && batchContacts.length === 0) break;

      // Dedup + bulk upsert the whole batch in a single round trip.
      // batchContacts always has a primary_email here (rows without one are
      // filtered out above via hasEmail), so one set-based UPDATE-then-INSERT
      // RPC call replaces what used to be a lookup + N parallel per-row
      // UPDATEs + a separate INSERT call — that per-row round-trip pattern
      // was the actual throughput bottleneck on large files, not the DB work
      // itself. See bulk_upsert_csv_contacts for why it can't use a plain
      // INSERT ... ON CONFLICT (the matching unique index is scoped to one
      // hardcoded organization_id, not a general constraint).
      if (batchContacts.length > 0) {
        // Dedupe by lower-cased email (last row wins) — the DB match is
        // case-insensitive, and two input rows for the same email would
        // otherwise race the same UPDATE target within a single statement.
        const dedupedContacts = [...new Map(
          batchContacts.map((c) => [(c.primary_email as string).toLowerCase(), c])
        ).values()];

        const { data: upserted, error: upsertError } =
          await upsertWithSplitRetry(supabase, typedJob.organization_id, dedupedContacts);

        if (upsertError) {
          console.error(`Batch ${batchStart}-${currentRow} bulk upsert error:`, upsertError);
          totalFailed += dedupedContacts.length;
        } else if (upserted) {
          duplicatesUpdated += upserted.filter((r) => !r.is_new).length;
          totalImported += upserted.length;

          if (upserted.length > 0) {
            const listMembers = upserted.map((r) => ({
              list_id: typedJob.target_list_id,
              contact_id: r.id,
            }));

            const { error: memberError } = await supabase
              .from('lead_list_members')
              .upsert(listMembers, {
                onConflict: 'list_id,contact_id',
                ignoreDuplicates: true,
              });

            if (memberError) {
              console.error(`Failed to add ${listMembers.length} contacts to list:`, memberError);
            }
          }
        }
      }

      // Update progress periodically
      if ((currentRow - resumeFromRow) % PROGRESS_UPDATE_INTERVAL < BATCH_SIZE || timedOut) {
        const progress = Math.min(Math.round((currentRow / totalRows) * 100), 99);
        const { error: progressUpdateError } = await supabase
          .from('csv_import_jobs')
          .update({
            progress,
            current_row: currentRow,
            imported_count: totalImported,
            skipped_count: totalSkipped,
            failed_count: totalFailed,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);
        if (progressUpdateError) {
          // Don't let a transient write failure pass as a saved checkpoint — the
          // recovery cron re-invokes based on updated_at, so a silently-failed
          // write here would otherwise leave the job looking fresh but stalled.
          console.error(`Failed to save progress at row ${currentRow}:`, progressUpdateError);
        }
      }

      if (timedOut) break;
    }

    // Window exhausted but the file isn't: hand off to the next invocation.
    if (!timedOut && !reachedEof) timedOut = true;

    // If we timed out, save progress and self-invoke to continue
    if (timedOut) {
      // Save current progress + partial skip_reasons to DB
      const progress = Math.min(Math.round((currentRow / totalRows) * 100), 99);
      const partialSkipReasons = (job.skip_reasons as Record<string, number> | null) || {};
      const { error: checkpointError } = await supabase
        .from('csv_import_jobs')
        .update({
          progress,
          current_row: currentRow,
          imported_count: totalImported,
          skipped_count: totalSkipped,
          failed_count: totalFailed,
          skip_reasons: {
            missing_identifier: (partialSkipReasons.missing_identifier || 0) + missingLinkedin,
            invalid_linkedin_url: (partialSkipReasons.invalid_linkedin_url || 0) + invalidLinkedin,
            duplicates_updated: (partialSkipReasons.duplicates_updated || 0) + duplicatesUpdated,
          },
          // Release the claim so the self-invoke below can take it right away;
          // otherwise it loses to the 150s lock and the chunk idles until cron.
          processing_lock_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      if (checkpointError) {
        // A failed checkpoint write here previously caused a silent stall: the log
        // below would claim progress was saved and self-invoke anyway, while the
        // DB stayed at the prior row — the recovery cron re-invokes from that
        // still-correct prior checkpoint once updated_at goes stale.
        console.error(`Failed to save checkpoint at row ${currentRow}, recovery cron will retry:`, checkpointError);
      }

      console.log(`Saved progress: row ${currentRow}/${totalRows}, ${totalImported} imported, ${totalSkipped} skipped. Self-invoking...`);

      // Fire-and-forget self-invocation — the next invocation reads current_row from DB.
      // NOT awaited, to avoid chaining timeouts, but registered with waitUntil so the
      // platform doesn't tear down the isolate (e.g. on a redeploy) before the request
      // actually goes out — without this the self-invoke chain can silently die and the
      // job is left stuck in 'running' with nothing left to drive it forward.
      const selfInvoke = fetch(`${supabaseUrl}/functions/v1/process-csv-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ jobId }),
      }).catch((err) => {
        console.error('Self-invoke failed:', err);
      });
      try {
        (globalThis as any).EdgeRuntime?.waitUntil(selfInvoke);
      } catch (_) { /* not available in all environments */ }

      return new Response(
        JSON.stringify({
          success: true,
          progress,
          imported: totalImported,
          skipped: totalSkipped,
          failed: totalFailed,
          total: totalRows,
          complete: false,
          resumeRow: currentRow,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All rows processed — mark complete with final counts
    // Get the accumulated skip reasons from previous invocations
    const existingSkipReasons = (job.skip_reasons as Record<string, number> | null) || {};
    const finalMissingIdentifier = (existingSkipReasons.missing_identifier || 0) + missingLinkedin;
    const finalInvalidLinkedin = (existingSkipReasons.invalid_linkedin_url || 0) + invalidLinkedin;
    const finalDuplicatesUpdated = (existingSkipReasons.duplicates_updated || 0) + duplicatesUpdated;

    await supabase
      .from('csv_import_jobs')
      .update({
        status: 'completed',
        progress: 100,
        imported_count: totalImported,
        skipped_count: totalSkipped,
        failed_count: totalFailed,
        current_row: windowEnd,
        skip_reasons: {
          missing_identifier: finalMissingIdentifier,
          invalid_linkedin_url: finalInvalidLinkedin,
          duplicates_updated: finalDuplicatesUpdated,
        },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Job ${jobId} COMPLETE in ${elapsed}s: ${totalImported} imported, ${totalSkipped} skipped, ${totalFailed} failed out of ${windowEnd} rows`);

    return new Response(
      JSON.stringify({
        success: true,
        progress: 100,
        imported: totalImported,
        skipped: totalSkipped,
        failed: totalFailed,
        total: totalRows,
        complete: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing CSV import job:', error);

    if (jobId) {
      const supabase2 = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await updateJobFailed(supabase2, jobId, error instanceof Error ? error.message : 'Unknown error');
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function transformRowToContact(
  row: Record<string, string>,
  mappings: FieldMapping[],
  organizationId: string
): Record<string, unknown> {
  const contact: Record<string, unknown> = {
    organization_id: organizationId,
    display_name: '',
    source: 'csv_import',
    source_details: { csv_row: row },
  };

  const storeInEnrichment = (key: string, val: string) => {
    if (!contact.enrichment_data) {
      contact.enrichment_data = {};
    }
    (contact.enrichment_data as Record<string, unknown>)[key] = val;
  };

  // Both filter engines (useContacts.ts, filter_lead_list_members RPC) read
  // firmographics from enrichment_data.company.* — a flat top-level key like
  // storeInEnrichment('employee_count', ...) writes to a path neither engine
  // ever queries, making CSV-imported firmographics invisible to filtering.
  const mergeIntoCompany = (patch: Record<string, unknown>) => {
    if (!contact.enrichment_data) {
      contact.enrichment_data = {};
    }
    const enrichmentData = contact.enrichment_data as Record<string, unknown>;
    enrichmentData.company = { ...(enrichmentData.company as Record<string, unknown> | undefined), ...patch };
  };

  for (const mapping of mappings) {
    const value = row[mapping.csvColumn];
    if (!value || mapping.targetField === 'skip') continue;

    switch (mapping.targetField) {
      case 'linkedin_url':
        contact.primary_linkedin_url = value;
        break;
      case 'instagram_url':
        contact.instagram_url = value.trim();
        break;
      case 'first_name':
        contact.first_name = value;
        break;
      case 'last_name':
        contact.last_name = value;
        break;
      case 'job_title':
        contact.job_title = value;
        break;
      case 'email':
        contact.primary_email = value;
        break;
      case 'company':
        contact.company = value;
        break;
      case 'company_website':
        contact.company_website = value;
        break;
      case 'city':
        contact.city = value;
        break;
      case 'state':
        contact.state = value;
        break;
      case 'country':
        contact.country = value;
        break;
      case 'linkedin_bio':
        contact.linkedin_bio = value;
        break;
      case 'home_page_text':
        contact.home_page_text = value;
        break;
      case 'work_direct_phone':
      case 'mobile_phone':
      case 'corporate_phone':
        if (!contact.primary_phone) {
          contact.primary_phone = value;
        }
        storeInEnrichment(mapping.targetField, value);
        break;
      case 'employee_count':
        mergeIntoCompany({ size: normalizeEmployeeRange(value) ?? value });
        break;
      case 'industry':
        mergeIntoCompany({ industry: normalizeIndustryLabel(value) ?? value });
        break;
      case 'annual_revenue':
        mergeIntoCompany({ revenue: value });
        break;
      case 'technologies':
        mergeIntoCompany({ technologies: value.split(',').map((t) => t.trim()).filter(Boolean) });
        break;
      default:
        if (mapping.targetField.startsWith('custom:')) {
          const fieldKey = mapping.targetField.substring(7);
          if (!contact.custom_fields) {
            contact.custom_fields = {};
          }
          (contact.custom_fields as Record<string, unknown>)[fieldKey] = value;
        } else {
          storeInEnrichment(mapping.targetField, value);
        }
        break;
    }
  }

  const firstName = (contact.first_name as string) || '';
  const lastName = (contact.last_name as string) || '';
  contact.display_name = `${firstName} ${lastName}`.trim() || 'Unknown';

  return contact;
}

async function updateJobFailed(
  supabase: SupabaseClient<any>,
  jobId: string,
  errorMessage: string
) {
  await supabase
    .from('csv_import_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

/**
 * bulk_upsert_csv_contacts, halving the batch on a statement timeout (57014)
 * instead of dropping every row in it. Down to single rows; other errors fail
 * the batch as before.
 */
async function upsertWithSplitRetry(
  supabase: SupabaseClient,
  organizationId: string,
  rows: Record<string, unknown>[],
): Promise<{ data: Array<{ id: string; is_new: boolean }> | null; error: unknown }> {
  const { data, error } = await supabase.rpc('bulk_upsert_csv_contacts', {
    p_organization_id: organizationId,
    p_rows: rows,
  }) as { data: Array<{ id: string; is_new: boolean }> | null; error: { code?: string } | null };
  if (!error || error.code !== '57014' || rows.length <= 1) return { data, error };

  const mid = Math.ceil(rows.length / 2);
  const results = [
    await upsertWithSplitRetry(supabase, organizationId, rows.slice(0, mid)),
    await upsertWithSplitRetry(supabase, organizationId, rows.slice(mid)),
  ];
  const ok = results.flatMap((r) => r.data ?? []);
  const failed = results.find((r) => r.error);
  if (failed && ok.length === 0) return { data: null, error: failed.error };
  if (failed) console.error(`Split retry: ${ok.length}/${rows.length} rows upserted, rest failed:`, failed.error);
  return { data: ok, error: null };
}

/**
 * Stream-parse the CSV at `url`, returning rows [skip, skip + limit) as header-keyed
 * objects. Memory is bounded by `limit`, not file size. Encoding: BOM sniff, else
 * strict UTF-8, restarting as Windows-1252 if the bytes aren't valid UTF-8 (Excel's
 * default "CSV (Comma delimited)" export, which UTF-8 would mangle into U+FFFD).
 */
async function readCsvWindow(
  url: string,
  skip: number,
  limit: number,
  forceEncoding?: string,
): Promise<{ rows: Record<string, string>[]; headers: string[]; reachedEof: boolean; encoding: string }> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`CSV download failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  let encoding = forceEncoding ?? 'utf-8';
  let bomLen = 0;
  if (!forceEncoding) {
    if (head[0] === 0xFF && head[1] === 0xFE) { encoding = 'utf-16le'; bomLen = 2; }
    else if (head[0] === 0xFE && head[1] === 0xFF) { encoding = 'utf-16be'; bomLen = 2; }
    else if (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF) { bomLen = 3; }
  }
  const strict = encoding === 'utf-8' && !forceEncoding;

  const bytes = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(head.subarray(bomLen));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const records = bytes
    .pipeThrough(new TextDecoderStream(encoding, { fatal: strict }))
    .pipeThrough(new CsvParseStream({ lazyQuotes: true, fieldsPerRecord: -1 }));
  const it = records.getReader();

  let headers: string[] = [];
  const rows: Record<string, string>[] = [];
  let index = -1; // data row index; -1 = header row
  let reachedEof = false;
  try {
    while (true) {
      const { done, value } = await it.read();
      if (done) { reachedEof = true; break; }
      if (index === -1) {
        headers = value.map((h) => h.trim());
        index = 0;
        continue;
      }
      if (value.every((v) => v === '')) continue; // skip empty lines
      if (index >= skip) {
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = value[i] ?? ''; });
        rows.push(row);
      }
      index++;
      if (rows.length >= limit) break;
    }
  } catch (err) {
    if (strict && err instanceof TypeError) {
      await it.cancel().catch(() => {});
      return readCsvWindow(url, skip, limit, 'windows-1252');
    }
    throw err;
  }
  if (!reachedEof) await it.cancel().catch(() => {});
  return { rows, headers, reachedEof, encoding };
}
