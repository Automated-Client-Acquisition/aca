/**
 * Notion Page Generator Worker — Fly.io
 *
 * Auto-stop HTTP service that processes batch Notion page generation jobs.
 * Triggered by the batch-generate-notion-pages edge function.
 * No timeout limits — runs until all contacts are processed.
 *
 * Per-contact pipeline (sequential):
 *   1. Pre-analysis (optional): Run AI company analysis first
 *   2. Generate (three-phase approach to avoid edge function timeouts):
 *      Phase 1: Edge function builds AI messages (DB queries only, ~seconds)
 *      Phase 2: Worker calls OpenRouter directly (AI generation, up to 5 min)
 *      Phase 3: Edge function creates Notion page from pre-generated content
 *
 * Routes:
 *   POST /process       — accepts { jobId }, kicks off processing async, returns 200 immediately
 *   POST /generate-one  — accepts single-contact config, generates synchronously, returns result
 *   GET  /health        — returns worker stats
 *
 * Config (env vars):
 *   PARALLEL_CONCURRENCY       — contacts processed in parallel per job (default: 2)
 *   CONTACT_TIMEOUT_MS         — per-contact safety timeout in ms (default: 600000)
 *   MAX_CONCURRENT_JOBS        — max simultaneous jobs (default: 3)
 *   IDLE_SHUTDOWN_MS           — idle time before self-stop (default: 60000)
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
 *   ENCRYPTION_KEY             — Hex encryption key for decrypting API keys from DB
 */

import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Config
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Job endpoints require the header the edge functions send
// (supabase/functions/_shared/fly-worker-auth.ts): an HMAC of the service-role key with a
// fixed label. Without it, anyone who knew this URL and a job id could re-run any org's job.
const WORKER_AUTH_SECRET = createHmac('sha256', SUPABASE_KEY).update('aca-fly-worker-v1').digest('hex');
function isAuthorizedWorkerCall(req: http.IncomingMessage): boolean {
  const got = req.headers['x-aca-worker-auth'];
  if (typeof got !== 'string' || got.length !== WORKER_AUTH_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(WORKER_AUTH_SECRET));
}
const BASE_CONCURRENCY = parseInt(process.env.PARALLEL_CONCURRENCY || '2', 10);
const CONTACT_TIMEOUT_MS = parseInt(process.env.CONTACT_TIMEOUT_MS || '600000', 10);
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_IN_CHUNK = 50;

function getParallelConcurrency(): number {
  if (stats.activeJobs <= 1) return BASE_CONCURRENCY;
  if (stats.activeJobs === 2) return Math.max(1, Math.floor(BASE_CONCURRENCY * 0.5));
  return 1;
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface NotionConfig {
  enabled: boolean;
  connectionId: string;
  databaseId: string;
  icpThreshold: number;
  productId: string;
  blueprintIds?: string[];
  blueprintId?: string;
  customPrompt?: string;
  prompt?: string;
  force?: boolean;
  model?: string;
  runAnalysisFirst?: boolean;
}

interface NotionJob {
  id: string;
  organization_id: string;
  contact_ids: string[];
  notion_config: NotionConfig | null;
  status: string;
  generated_count: number;
  skipped_count: number;
  failed_count: number;
  total_contacts: number;
  results: NotionResult[] | null;
}

interface NotionResult {
  contactId: string;
  status: 'success' | 'skipped' | 'failed';
  notionPageId?: string;
  notionPageUrl?: string;
  error?: string;
  reason?: string;
}

interface Contact {
  id: string;
  display_name: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  primary_email: string | null;
  company_website: string | null;
  primary_linkedin_url: string | null;
  enrichment_data: Record<string, unknown> | null;
  enriched_at: string | null;
  city: string | null;
  country: string | null;
  notion_page_id?: string | null;
  notion_preview_url?: string | null;
}

// ============================================================================
// Stats
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  activeJobs: 0,
  totalJobsProcessed: 0,
  totalPagesGenerated: 0,
  totalContactsFailed: 0,
  totalContactsSkipped: 0,
  totalErrors: 0,
  lastJobAt: null as string | null,
  lastJobId: null as string | null,
};

// ============================================================================
// Supabase client
// ============================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// JSON Parsing Helpers (mirrors edge function logic)
// ============================================================================

function extractJSON(content: string): string {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                    content.match(/```\s*([\s\S]*?)\s*```/);
  if (jsonMatch?.[1]) return jsonMatch[1].trim();
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0].trim();
  return content.trim();
}

function repairJSON(content: string): string {
  let text = extractJSON(content);
  text = text.replace(/,\s*([\]}])/g, '$1');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  let openBraces = 0, openBrackets = 0, inString = false, escape = false;
  for (const char of text) {
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') openBraces++;
    if (char === '}') openBraces--;
    if (char === '[') openBrackets++;
    if (char === ']') openBrackets--;
  }
  if (inString) text += '"';
  for (let i = 0; i < openBrackets; i++) text += ']';
  for (let i = 0; i < openBraces; i++) text += '}';
  text = text.replace(/,\s*([\]}])/g, '$1');
  return text;
}

// ============================================================================
// Encryption (port of Deno _shared/unipile-client.ts decryptApiKey to Node.js)
// ============================================================================

/**
 * Decrypt an API key encrypted with AES-256-GCM.
 * Format: base64(IV[12 bytes] + ciphertext + authTag[16 bytes])
 */
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const crypto = await import('node:crypto');

  // Decode base64 to buffer
  const combined = Buffer.from(encryptedBase64, 'base64');

  // Extract IV (first 12 bytes), ciphertext (middle), and auth tag (last 16 bytes)
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);

  // Import the hex encryption key
  const keyBuffer = Buffer.from(encryptionKeyHex, 'hex');

  // Decrypt using AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

async function fetchContactsChunked(
  contactIds: string[],
  organizationId: string,
): Promise<{ data: Contact[]; error: string | null }> {
  if (contactIds.length === 0) return { data: [], error: null };

  const allContacts: Contact[] = [];
  for (let i = 0; i < contactIds.length; i += MAX_IN_CHUNK) {
    const chunk = contactIds.slice(i, i + MAX_IN_CHUNK);
    let lastError: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id, display_name, company, first_name, last_name, job_title, primary_email, city, country, company_website, primary_linkedin_url, enrichment_data, enriched_at')
        .in('id', chunk)
        .eq('organization_id', organizationId);

      if (error) {
        lastError = error.message;
        console.error(`Chunk ${Math.floor(i / MAX_IN_CHUNK) + 1} fetch failed (attempt ${attempt + 1}):`, error.message);
        if (attempt === 0) await sleep(500);
        continue;
      }

      if (data) allContacts.push(...(data as Contact[]));
      lastError = null;
      break;
    }

    if (lastError) {
      return { data: [], error: `Failed to fetch contacts chunk: ${lastError}` };
    }
  }
  return { data: allContacts, error: null };
}

async function fetchChunkedIn(
  table: string,
  selectColumns: string,
  column: string,
  ids: string[],
  extraFilter?: (q: any) => any,
): Promise<any[]> {
  if (ids.length === 0) return [];
  const allRows: any[] = [];
  for (let i = 0; i < ids.length; i += MAX_IN_CHUNK) {
    const chunk = ids.slice(i, i + MAX_IN_CHUNK);
    let query = supabase.from(table).select(selectColumns).in(column, chunk);
    if (extraFilter) query = extraFilter(query);
    const { data } = await query;
    if (data) allRows.push(...data);
  }
  return allRows;
}

async function updateJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('email_sequence_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function isJobCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_sequence_jobs')
    .select('status')
    .eq('id', jobId)
    .single();
  return !data || data.status === 'cancelled';
}

// ============================================================================
// Core: Helper functions for Notion page generation
// ============================================================================

/** Handle a successful result from the edge function (update DB records) */
async function handleSuccessResult(
  contact: Contact,
  job: NotionJob,
  result: { notionPageId?: string; notionPageUrl?: string },
): Promise<NotionResult> {
  if (result.notionPageId && result.notionPageUrl) {
    await supabase
      .from('crm_contacts')
      .update({
        notion_preview_url: result.notionPageUrl,
        notion_page_id: result.notionPageId,
      })
      .eq('id', contact.id)
      .eq('organization_id', job.organization_id);

    await supabase
      .from('contact_email_sequences')
      .update({
        notion_preview_url: result.notionPageUrl,
        notion_page_id: result.notionPageId,
      })
      .eq('contact_id', contact.id)
      .eq('organization_id', job.organization_id)
      .in('status', ['ready', 'draft']);
  }

  console.log(`  Notion page created for ${contact.display_name}: ${result.notionPageUrl}`);
  return {
    contactId: contact.id,
    status: 'success',
    notionPageId: result.notionPageId,
    notionPageUrl: result.notionPageUrl,
  };
}

/** Fetch and decrypt the OpenRouter API key for an organization */
async function getOpenRouterKey(organizationId: string): Promise<string | null> {
  const { data: apiKeyData } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', organizationId)
    .eq('provider', 'openrouter')
    .maybeSingle();

  if (!apiKeyData?.key_encrypted) return null;

  if (!ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY not set on worker');
    return null;
  }

  return decryptApiKey(apiKeyData.key_encrypted, ENCRYPTION_KEY);
}

/** Call edge function directly (for legacy mode where AI is fast enough) */
async function callEdgeFunctionDirect(
  contact: Contact,
  job: NotionJob,
  notionConfig: NotionConfig,
  forceOverride?: boolean,
): Promise<NotionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTACT_TIMEOUT_MS);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-notion-preview`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contactId: contact.id,
      productId: notionConfig.productId,
      connectionId: notionConfig.connectionId,
      databaseId: notionConfig.databaseId,
      organizationId: job.organization_id,
      blueprintIds: notionConfig.blueprintIds || (notionConfig.blueprintId ? [notionConfig.blueprintId] : ['strategic-growth']),
      customPrompt: notionConfig.customPrompt,
      model: notionConfig.model,
      force: forceOverride ?? notionConfig.force ?? false,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const result = await response.json();

  if (result.success) {
    if (result.skipped) {
      const reason = result.reason === 'generation_in_progress'
        ? 'Generation already in progress by another job'
        : 'Contact already has a Notion page';
      return { contactId: contact.id, status: 'skipped', error: reason, reason: result.reason || 'already_exists' };
    }
    return handleSuccessResult(contact, job, result);
  } else {
    return { contactId: contact.id, status: 'failed', error: result.error || 'Generation failed' };
  }
}

// ============================================================================
// Core: Generate Notion page for a single contact (three-phase approach)
// ============================================================================

async function generateOneNotionPage(
  contact: Contact,
  job: NotionJob,
  notionConfig: NotionConfig,
  forceOverride?: boolean,
): Promise<NotionResult> {
  try {
    const rawBlueprintIds = notionConfig.blueprintIds ?? (notionConfig.blueprintId ? [notionConfig.blueprintId] : null);
    const isLegacyMode = (!rawBlueprintIds || rawBlueprintIds.length === 0) && !!notionConfig.prompt;
    const blueprintIds = rawBlueprintIds && rawBlueprintIds.length > 0 ? rawBlueprintIds : ['strategic-growth'];

    // For legacy mode (simple prompts), use the edge function directly (fast enough)
    if (isLegacyMode) {
      return await callEdgeFunctionDirect(contact, job, notionConfig, forceOverride);
    }

    // ── Phase 1: Get AI messages from edge function ──
    console.log(`  [Phase 1] Building AI messages for ${contact.display_name}...`);
    const phase1Controller = new AbortController();
    const phase1Timeout = setTimeout(() => phase1Controller.abort(), 60_000); // 60s for DB queries

    let phase1Result: any;
    try {
      const phase1Response = await fetch(`${SUPABASE_URL}/functions/v1/generate-notion-preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactId: contact.id,
          productId: notionConfig.productId,
          connectionId: notionConfig.connectionId,
          databaseId: notionConfig.databaseId,
          organizationId: job.organization_id,
          blueprintIds,
          customPrompt: notionConfig.customPrompt,
          model: notionConfig.model,
          force: forceOverride ?? notionConfig.force ?? false,
          buildMessagesOnly: true,
        }),
        signal: phase1Controller.signal,
      });
      phase1Result = await phase1Response.json();
    } finally {
      clearTimeout(phase1Timeout);
    }

    // Handle skipped/error responses from Phase 1
    if (phase1Result.skipped) {
      const reason = phase1Result.reason === 'generation_in_progress'
        ? 'Generation already in progress by another job'
        : 'Contact already has a Notion page';
      console.log(`  Notion skipped for ${contact.display_name}: ${reason}`);
      return {
        contactId: contact.id,
        status: 'skipped',
        error: reason,
        reason: phase1Result.reason || 'already_exists',
      };
    }

    if (!phase1Result.success) {
      throw new Error(phase1Result.error || 'Phase 1 failed');
    }

    if (!phase1Result.buildMessagesOnly || !phase1Result.aiRequest) {
      // Edge function handled it directly (shouldn't happen, but handle gracefully)
      if (phase1Result.notionPageId) {
        return handleSuccessResult(contact, job, phase1Result);
      }
      throw new Error('Unexpected phase 1 response');
    }

    const { messages, maxTokens, temperature, model, openRouterKey } = phase1Result.aiRequest;

    // ── Phase 2: Call OpenRouter directly (no timeout limit) ──
    console.log(`  [Phase 2] Calling OpenRouter (model=${model}, maxTokens=${maxTokens}) for ${contact.display_name}...`);

    if (!openRouterKey) {
      throw new Error('OpenRouter API key not returned by edge function');
    }

    const aiController = new AbortController();
    const aiTimeout = setTimeout(() => aiController.abort(), 300_000); // 5 min timeout (generous)

    let content: string;
    try {
      const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': SUPABASE_URL,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: aiController.signal,
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error(`  OpenRouter error for ${contact.display_name}:`, aiResponse.status, errorText.slice(0, 300));
        throw new Error(`AI generation failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
      content = aiData.choices?.[0]?.message?.content || '';
      if (!content) throw new Error('No content in AI response');
    } finally {
      clearTimeout(aiTimeout);
    }

    console.log(`  [Phase 2] AI response received (${content.length} chars) for ${contact.display_name}`);

    // ── Parse JSON with repair logic ──
    let docDef: any = null;

    // Attempt 1: direct parse
    try {
      const jsonText = extractJSON(content);
      docDef = JSON.parse(jsonText);
    } catch {
      // Attempt 2: repair
      try {
        const repaired = repairJSON(content);
        docDef = JSON.parse(repaired);
        console.log(`  JSON repaired successfully for ${contact.display_name}`);
      } catch {
        // Attempt 3: retry with stricter AI prompt
        console.log(`  JSON parse failed for ${contact.display_name}, retrying with stricter prompt...`);

        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 300_000);
        let retryContent: string;
        try {
          const retryResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': SUPABASE_URL,
            },
            body: JSON.stringify({
              model,
              messages: [
                ...messages,
                { role: 'assistant', content },
                { role: 'user', content: 'Your output was not valid JSON. Please output ONLY the JSON object with no additional text, no markdown fences, no explanation. Start with { and end with }.' },
              ],
              temperature: 0.3,
              max_tokens: maxTokens,
              response_format: { type: 'json_object' },
            }),
            signal: retryController.signal,
          });

          if (!retryResponse.ok) throw new Error(`AI retry failed: ${retryResponse.status}`);
          const retryData = await retryResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          retryContent = retryData.choices?.[0]?.message?.content || '';
          if (!retryContent) throw new Error('No content in AI retry response');
        } finally {
          clearTimeout(retryTimeout);
        }

        try {
          const retryJson = extractJSON(retryContent);
          docDef = JSON.parse(retryJson);
        } catch {
          // Attempt 4: repair the retry content
          try {
            const repaired = repairJSON(retryContent);
            docDef = JSON.parse(repaired);
            console.log(`  JSON repaired after retry for ${contact.display_name}`);
          } catch {
            throw new Error('Failed to parse AI-generated Notion content after retry and repair');
          }
        }
      }
    }

    if (!docDef?.title || !Array.isArray(docDef.blocks)) {
      throw new Error('Invalid document structure: missing title or blocks array');
    }

    console.log(`  [Phase 2] Parsed ${docDef.blocks.length} blocks for "${docDef.title}"`);

    // ── Phase 3: Send pre-generated content to edge function for Notion creation ──
    console.log(`  [Phase 3] Creating Notion page for ${contact.display_name}...`);
    const phase3Controller = new AbortController();
    const phase3Timeout = setTimeout(() => phase3Controller.abort(), 120_000); // 120s for Notion API

    let phase3Result: any;
    try {
      const phase3Response = await fetch(`${SUPABASE_URL}/functions/v1/generate-notion-preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactId: contact.id,
          productId: notionConfig.productId,
          connectionId: notionConfig.connectionId,
          databaseId: notionConfig.databaseId,
          organizationId: job.organization_id,
          blueprintIds,
          customPrompt: notionConfig.customPrompt,
          model: notionConfig.model,
          force: forceOverride ?? notionConfig.force ?? false,
          preGeneratedDocDef: docDef,
        }),
        signal: phase3Controller.signal,
      });
      phase3Result = await phase3Response.json();
    } finally {
      clearTimeout(phase3Timeout);
    }

    if (phase3Result.success) {
      if (phase3Result.skipped) {
        const reason = phase3Result.reason === 'generation_in_progress'
          ? 'Generation already in progress by another job'
          : 'Contact already has a Notion page';
        console.log(`  Notion skipped for ${contact.display_name}: ${reason}`);
        return {
          contactId: contact.id,
          status: 'skipped',
          error: reason,
          reason: phase3Result.reason || 'already_exists',
        };
      }

      return handleSuccessResult(contact, job, phase3Result);
    } else {
      throw new Error(phase3Result.error || 'Phase 3 failed');
    }

  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    const errorMsg = isTimeout
      ? `Timed out (${CONTACT_TIMEOUT_MS / 1000}s)`
      : (err instanceof Error ? err.message : 'Unknown error');
    console.error(`  Notion error for ${contact.display_name}:`, errorMsg);
    return {
      contactId: contact.id,
      status: 'failed',
      error: errorMsg,
    };
  }
}

/**
 * Wrapper that retries generation when a stale "generating" claim blocks the contact.
 * On retry, force=true is sent so the edge function clears the stuck claim unconditionally.
 */
async function generateOneNotionPageWithRetry(
  contact: Contact,
  job: NotionJob,
  notionConfig: NotionConfig,
): Promise<NotionResult> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // On retry attempts, force=true to clear the stuck 'generating' claim
    const forceOnRetry = attempt > 0 ? true : undefined;
    const result = await generateOneNotionPage(contact, job, notionConfig, forceOnRetry);
    if (result.status === 'skipped' && result.reason === 'generation_in_progress' && attempt < MAX_RETRIES) {
      console.log(`  Retry ${attempt + 1}/${MAX_RETRIES}: waiting 5s then forcing claim for ${contact.display_name}`);
      await sleep(5_000);
      continue;
    }
    return result;
  }
  return { contactId: contact.id, status: 'failed', error: 'Stuck in generating state after retries' };
}

// ============================================================================
// Core: Process a full job
// ============================================================================

async function processJob(jobId: string): Promise<void> {
  stats.activeJobs++;
  cancelIdleShutdown();
  stats.lastJobId = jobId;
  stats.lastJobAt = new Date().toISOString();

  console.log(`[Job ${jobId}] Starting processing`);

  try {
    // 1. Fetch job record
    const { data: job, error: jobError } = await supabase
      .from('email_sequence_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`[Job ${jobId}] Not found:`, jobError);
      return;
    }

    const typedJob = job as NotionJob;
    if (typedJob.status !== 'running') {
      console.log(`[Job ${jobId}] Not in running state (${typedJob.status}), skipping`);
      return;
    }

    const notionConfig = typedJob.notion_config;
    if (!notionConfig?.enabled) {
      await updateJobFailed(jobId, 'Missing Notion configuration');
      return;
    }

    // Sanitize contact_ids
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const contactIds = (typedJob.contact_ids || []).filter(
      (id): id is string => typeof id === 'string' && uuidRe.test(id),
    );

    if (contactIds.length === 0) {
      await updateJobFailed(jobId, 'No valid contact IDs');
      return;
    }

    // 2. Fetch all contacts
    const { data: contacts, error: contactsError } = await fetchContactsChunked(
      contactIds, typedJob.organization_id,
    );

    if (contactsError) {
      console.error(`[Job ${jobId}] Failed to fetch contacts:`, contactsError);
      await updateJobFailed(jobId, contactsError);
      return;
    }

    console.log(`[Job ${jobId}] Fetched ${contacts.length} contacts`);

    await supabase
      .from('email_sequence_jobs')
      .update({
        total_contacts: contacts.length,
      })
      .eq('id', jobId);

    // 3. Pre-analysis (optional) — run AI analysis on unanalyzed contacts
    if (notionConfig.runAnalysisFirst) {
      const unanalyzed = contacts.filter(
        c => !c.enriched_at && (c.company_website || c.primary_linkedin_url),
      );

      if (unanalyzed.length > 0) {
        console.log(`[Job ${jobId}] Pre-analysis: ${unanalyzed.length} contacts need AI analysis`);

        await supabase
          .from('email_sequence_jobs')
          .update({
            current_contact_name: `Analyzing ${unanalyzed.length} contacts before generating pages...`,
          })
          .eq('id', jobId);

        let analyzedCount = 0;
        let analyzeFailedCount = 0;

        for (const contact of unanalyzed) {
          if (await isJobCancelled(jobId)) break;

          try {
            await supabase
              .from('email_sequence_jobs')
              .update({
                current_contact_name: `Analyzing ${contact.display_name} (${analyzedCount + 1}/${unanalyzed.length})...`,
              })
              .eq('id', jobId);

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONTACT_TIMEOUT_MS);

            const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-company`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                contactId: contact.id,
                companyWebsite: contact.company_website,
                linkedinUrl: contact.primary_linkedin_url,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);

            const result = await response.json();
            if (result.success) {
              analyzedCount++;
              // Refresh enrichment_data for later use
              const { data: refreshed } = await supabase
                .from('crm_contacts')
                .select('enrichment_data, enriched_at')
                .eq('id', contact.id)
                .single();
              if (refreshed) {
                contact.enrichment_data = refreshed.enrichment_data;
                contact.enriched_at = refreshed.enriched_at;
              }
            } else {
              analyzeFailedCount++;
              console.warn(`  Pre-analysis failed for ${contact.display_name}: ${result.error}`);
            }

            await sleep(500);
          } catch (err) {
            analyzeFailedCount++;
            console.error(`  Pre-analysis error for ${contact.display_name}:`, err);
          }
        }

        console.log(`[Job ${jobId}] Pre-analysis complete: ${analyzedCount} analyzed, ${analyzeFailedCount} failed`);
      }
    }

    // 4. ICP threshold setup
    const threshold = notionConfig.icpThreshold || 0;
    let productScoreMap = new Map<string, number>();
    if (notionConfig.productId && contactIds.length > 0) {
      const productScores = await fetchChunkedIn(
        'contact_product_scores', 'contact_id, icp_score', 'contact_id', contactIds,
        (q: any) => q.eq('product_id', notionConfig.productId),
      );
      for (const ps of productScores) {
        productScoreMap.set(ps.contact_id, ps.icp_score ?? 0);
      }
    }

    // 5. Build processed set and classify contacts
    const processedIds = new Set(
      (typedJob.results || []).map(r => r.contactId),
    );

    const eligible: Contact[] = [];
    const skippable: Contact[] = [];

    for (const c of contacts) {
      if (processedIds.has(c.id)) continue;
      const productScore = productScoreMap.get(c.id);
      let icpScore: number;
      if (productScore !== undefined) {
        icpScore = productScore;
      } else {
        icpScore = Number(c.enrichment_data?.icp_score) || 0;
      }
      if (threshold > 0 && icpScore < threshold) {
        skippable.push(c);
      } else {
        eligible.push(c);
      }
    }

    console.log(`[Job ${jobId}] ${eligible.length} eligible, ${skippable.length} below threshold, ${processedIds.size} already processed`);

    // 6. Collect results
    const allResults: NotionResult[] = [...(typedJob.results || [])];
    let generatedCount = typedJob.generated_count || 0;
    let failedCount = typedJob.failed_count || 0;
    let skippedCount = typedJob.skipped_count || 0;

    // Add skipped contacts
    for (const c of skippable) {
      allResults.push({
        contactId: c.id,
        status: 'skipped',
        error: `ICP score below threshold (${threshold})`,
      });
      skippedCount++;
    }

    // 7. Process eligible contacts in parallel batches
    let i = 0;
    let batchNum = 0;
    while (i < eligible.length) {
      if (await isJobCancelled(jobId)) {
        console.log(`[Job ${jobId}] Cancelled, stopping`);
        break;
      }

      const concurrency = getParallelConcurrency();
      const batch = eligible.slice(i, i + concurrency);
      i += batch.length;
      batchNum++;

      const batchNames = batch.map(c => c.display_name).join(', ');
      const totalProcessed = allResults.length + batch.length;
      const progress = Math.round((totalProcessed / contacts.length) * 100);

      await supabase
        .from('email_sequence_jobs')
        .update({
          progress: Math.min(progress, 99),
          current_contact_name: `Generating Notion page for ${batchNames}...`,
          generated_count: generatedCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
        })
        .eq('id', jobId);

      console.log(`[Job ${jobId}] Batch ${batchNum} (×${concurrency}): ${batchNames} (${totalProcessed}/${contacts.length})`);

      const results = await Promise.allSettled(
        batch.map(c => generateOneNotionPageWithRetry(c, typedJob, notionConfig)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const r = result.value;
          allResults.push(r);
          if (r.status === 'success') generatedCount++;
          else if (r.status === 'failed') failedCount++;
          else if (r.status === 'skipped') skippedCount++;
        } else {
          console.error(`[Job ${jobId}] Unexpected rejection:`, result.reason);
          failedCount++;
        }
      }

      // Save progress after each batch
      await supabase
        .from('email_sequence_jobs')
        .update({
          generated_count: generatedCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
          results: allResults,
        })
        .eq('id', jobId);
    }

    // 8. Finalize
    const wasCancelled = await isJobCancelled(jobId);
    const finalStatus = wasCancelled ? 'cancelled' : 'completed';
    const finalGenerated = allResults.filter(r => r.status === 'success').length;
    const finalSkipped = allResults.filter(r => r.status === 'skipped').length;
    const finalFailed = allResults.filter(r => r.status === 'failed').length;

    await supabase
      .from('email_sequence_jobs')
      .update({
        status: finalStatus,
        progress: 100,
        current_contact_name: null,
        generated_count: finalGenerated,
        skipped_count: finalSkipped,
        failed_count: finalFailed,
        results: allResults,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`[Job ${jobId}] ${finalStatus}: ${finalGenerated} pages, ${finalSkipped} skipped, ${finalFailed} failed`);

    stats.totalJobsProcessed++;
    stats.totalPagesGenerated += finalGenerated;
    stats.totalContactsFailed += finalFailed;
    stats.totalContactsSkipped += finalSkipped;

  } catch (error) {
    console.error(`[Job ${jobId}] Fatal error:`, error);
    stats.totalErrors++;
    await updateJobFailed(jobId, error instanceof Error ? error.message : 'Unknown worker error');
  } finally {
    stats.activeJobs--;

    // Check for pending jobs queued while at capacity
    if (stats.activeJobs < MAX_CONCURRENT_JOBS) {
      try {
        const { data: pendingJobs } = await supabase
          .from('email_sequence_jobs')
          .select('id')
          .eq('status', 'pending')
          .eq('job_type', 'notion_pages')
          .order('created_at', { ascending: true })
          .limit(1);

        if (pendingJobs && pendingJobs.length > 0) {
          const nextJob = pendingJobs[0];
          // Atomic claim: only transition if still pending (prevents double-processing race)
          const { data: claimed } = await supabase
            .from('email_sequence_jobs')
            .update({ status: 'running', started_at: new Date().toISOString() })
            .eq('id', nextJob.id)
            .eq('status', 'pending')
            .select('id');
          if (!claimed || claimed.length === 0) {
            console.log(`[Worker] Job ${nextJob.id} already claimed by another worker`);
          } else {
            console.log(`[Worker] Picking up queued job ${nextJob.id}`);
          }
          if (claimed && claimed.length > 0) processJob(nextJob.id).catch(err => {
            console.error(`[Worker] Failed to process queued job ${nextJob.id}:`, err);
          });
        }
      } catch (err) {
        console.error('[Worker] Failed to check for pending jobs:', err);
      }
    }

    if (stats.activeJobs <= 0) {
      scheduleIdleShutdown();
    }
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ...stats,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      currentConcurrency: getParallelConcurrency(),
    }));
    return;
  }

  if (req.url === '/process' && req.method === 'POST') {
    if (!isAuthorizedWorkerCall(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    cancelIdleShutdown();
    try {
      const body = await readBody(req);
      const { jobId } = JSON.parse(body);

      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'jobId is required' }));
        return;
      }

      if (stats.activeJobs >= MAX_CONCURRENT_JOBS) {
        console.log(`[Worker] Rejecting job ${jobId}: at capacity (${stats.activeJobs}/${MAX_CONCURRENT_JOBS})`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Worker at capacity (${stats.activeJobs}/${MAX_CONCURRENT_JOBS} concurrent jobs). Try again shortly.`,
          retryAfter: 60,
        }));
        return;
      }

      // SSE stream for acceptance confirmation
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      res.write(`data: ${JSON.stringify({ accepted: true, jobId })}\n\n`);

      const keepAlive = setInterval(() => {
        if (!res.destroyed) {
          res.write(`data: ${JSON.stringify({ ping: true, stats: { activeJobs: stats.activeJobs } })}\n\n`);
        }
      }, 30_000);

      try {
        await processJob(jobId);
        res.write(`data: ${JSON.stringify({ done: true, jobId })}\n\n`);
      } catch (err) {
        console.error(`[Job ${jobId}] Unhandled error:`, err);
        res.write(`data: ${JSON.stringify({ error: true, jobId, message: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
      } finally {
        clearInterval(keepAlive);
        res.end();
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
    return;
  }

  // ── POST /generate-one — synchronous single-contact generation ──
  if (req.url === '/generate-one' && req.method === 'POST') {
    if (!isAuthorizedWorkerCall(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    cancelIdleShutdown();
    stats.activeJobs++;
    try {
      const body = JSON.parse(await readBody(req));
      const { contactId, connectionId, databaseId, organizationId, productId, blueprintIds, customPrompt, model, force } = body;

      if (!contactId || !connectionId || !databaseId || !organizationId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'contactId, connectionId, databaseId, and organizationId are required' }));
        return;
      }

      // Fetch the contact
      const { data: contactData, error: contactError } = await supabase
        .from('crm_contacts')
        .select('id, display_name, company, notion_page_id, notion_preview_url')
        .eq('id', contactId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (contactError || !contactData) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Contact not found: ${contactError?.message || contactId}` }));
        return;
      }

      // Only the fields needed by generateOneNotionPage — other Contact fields are unused
      const contact = {
        id: contactData.id,
        display_name: contactData.display_name || 'Unknown',
        company: contactData.company || null,
      } as Contact;

      // Build a minimal job-like object for the pipeline
      const pseudoJob: NotionJob = {
        id: `generate-one-${Date.now()}`,
        organization_id: organizationId,
        contact_ids: [contactId],
        notion_config: null,
        status: 'running',
        generated_count: 0,
        skipped_count: 0,
        failed_count: 0,
        total_contacts: 1,
        results: null,
      };

      const notionConfig: NotionConfig = {
        enabled: true,
        connectionId,
        databaseId,
        icpThreshold: 0,
        productId: productId || '',
        blueprintIds: blueprintIds || ['strategic-growth'],
        customPrompt,
        force: force ?? false,
        model,
      };

      console.log(`[generate-one] Starting for ${contact.display_name} (${contactId})`);
      const result = await generateOneNotionPageWithRetry(contact, pseudoJob, notionConfig);
      console.log(`[generate-one] Done for ${contact.display_name}: ${result.status}`);

      res.writeHead(result.status === 'success' ? 200 : result.status === 'skipped' ? 200 : 422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: result.status === 'success',
        skipped: result.status === 'skipped',
        notionPageId: result.notionPageId,
        notionPageUrl: result.notionPageUrl,
        error: result.error,
      }));
    } catch (error) {
      console.error('[generate-one] Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      stats.activeJobs--;
      if (stats.activeJobs <= 0) scheduleIdleShutdown();
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ============================================================================
// Self-stop lifecycle
// ============================================================================

const IDLE_SHUTDOWN_MS = parseInt(process.env.IDLE_SHUTDOWN_MS || '60000', 10);
let idleShutdownTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleShutdown(): void {
  cancelIdleShutdown();
  if (stats.activeJobs > 0) return;

  console.log(`[Worker] No active jobs, scheduling shutdown in ${IDLE_SHUTDOWN_MS / 1000}s`);
  idleShutdownTimer = setTimeout(async () => {
    if (stats.activeJobs > 0) {
      console.log('[Worker] Job started during idle period, cancelling shutdown');
      return;
    }
    await selfStop();
  }, IDLE_SHUTDOWN_MS);
}

function cancelIdleShutdown(): void {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
}

async function selfStop(): Promise<void> {
  const machineId = process.env.FLY_MACHINE_ID;
  const appName = process.env.FLY_APP_NAME;

  if (!machineId || !appName) {
    console.log('[Worker] Not on Fly.io, skipping self-stop');
    return;
  }

  console.log(`[Worker] Self-stopping machine ${machineId}`);
  try {
    const httpMod = await import('node:http');
    await new Promise<void>((resolve, reject) => {
      const req = httpMod.request({
        socketPath: '/.fly/api',
        path: `/v1/apps/${appName}/machines/${machineId}/stop`,
        method: 'POST',
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          console.log(`[Worker] Self-stop response: ${res.statusCode} ${body}`);
          resolve();
        });
      });
      req.on('error', reject);
      req.end();
    });
  } catch (err) {
    console.error('[Worker] Self-stop failed:', err);
    process.exit(0);
  }
}

// ============================================================================
// Startup
// ============================================================================

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Worker] Notion generator listening on 0.0.0.0:${PORT}`);

  // Resume orphaned running jobs
  try {
    const { data: orphanedJobs } = await supabase
      .from('email_sequence_jobs')
      .select('id')
      .eq('status', 'running')
      .eq('job_type', 'notion_pages')
      .order('created_at', { ascending: true });

    if (orphanedJobs && orphanedJobs.length > 0) {
      const toResume = orphanedJobs.slice(0, MAX_CONCURRENT_JOBS);
      console.log(`[Worker] Found ${orphanedJobs.length} orphaned job(s), resuming ${toResume.length} (max ${MAX_CONCURRENT_JOBS})...`);
      for (const job of toResume) {
        console.log(`[Worker] Resuming orphaned job ${job.id}`);
        processJob(job.id).catch(err => {
          console.error(`[Worker] Failed to resume job ${job.id}:`, err);
        });
      }
    } else {
      scheduleIdleShutdown();
    }
  } catch (err) {
    console.error('[Worker] Failed to check for orphaned jobs:', err);
  }
});

// ============================================================================
// Graceful shutdown
// ============================================================================

let shutdownRequested = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  const deadline = Date.now() + 30_000;
  while (stats.activeJobs > 0 && Date.now() < deadline) {
    console.log(`[Worker] Waiting for ${stats.activeJobs} active job(s)...`);
    await sleep(2000);
  }

  if (stats.activeJobs > 0) {
    console.error(`[Worker] Force shutdown with ${stats.activeJobs} active job(s)`);
  }

  server.close(() => {
    console.log('[Worker] HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Worker] Forced exit after 30s');
    process.exit(1);
  }, 30_000);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught exception (non-fatal):', err.message);
  stats.totalErrors++;
});

process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection (non-fatal):', reason);
  stats.totalErrors++;
});
