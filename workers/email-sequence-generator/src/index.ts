/**
 * Email Sequence Generator Worker — Fly.io
 *
 * Auto-stop HTTP service that processes email sequence generation jobs.
 * Triggered by the process-email-sequence-job edge function.
 * No timeout limits — runs until all contacts are processed.
 *
 * Per-contact pipeline (sequential):
 *   1. Notion (optional): Generate personalized Notion preview page
 *   2. Generate: Create email sequence via generate-email-sequence
 *   3. Push (optional): Push the generated sequence to the selected email tool
 *
 * Routes:
 *   POST /process  — accepts { jobId }, kicks off processing async, returns 200 immediately
 *   GET  /health   — returns worker stats
 *
 * Config (env vars):
 *   PARALLEL_CONCURRENCY       — contacts processed in parallel per job (default: 3)
 *   CONTACT_TIMEOUT_MS         — per-contact safety timeout in ms (default: 150000)
 *   MAX_CONCURRENT_JOBS        — max simultaneous jobs (default: 3)
 *   IDLE_SHUTDOWN_MS           — idle time before self-stop (default: 60000)
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
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
const BASE_CONCURRENCY = parseInt(process.env.PARALLEL_CONCURRENCY || '3', 10);
const CONTACT_TIMEOUT_MS = parseInt(process.env.CONTACT_TIMEOUT_MS || '150000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_IN_CHUNK = 50;

function getParallelConcurrency(): number {
  if (stats.activeJobs <= 1) return BASE_CONCURRENCY;
  if (stats.activeJobs === 2) return Math.max(2, Math.floor(BASE_CONCURRENCY * 0.6));
  return 2;
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface JobResult {
  contactId: string;
  status: 'success' | 'skipped' | 'failed' | 'pushed';
  sequenceId?: string;
  error?: string;
}

interface PushConfig {
  toolType: 'smartlead' | 'instantly' | 'successai' | 'internal';
  connectionId?: string;
  externalCampaignId?: string;
  sequenceName?: string;
  mailboxTagFilter?: string[];
  existingSequenceId?: string;
  createAsDraft?: boolean;
  resolvedSequenceId?: string;
  internalSettings?: {
    dailyLimit?: number;
    openTracking?: boolean;
    clickTracking?: boolean;
    stopOnReply?: boolean;
    fullSettings?: Record<string, unknown>;
    autopilotConfig?: Record<string, unknown>;
    agentProfileId?: string | null;
  };
}

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
  model?: string;
}

interface EmailSequenceJob {
  id: string;
  organization_id: string;
  contact_ids: string[];
  model: string;
  email_count: number;
  generation_config: {
    tone?: string;
    ctaType?: string;
    customCta?: string;
    productId?: string;
    outcomes?: string[];
    delayPattern?: string;
    prompt?: string;
    knowledgeDocumentIds?: string[];
    pushConfig?: PushConfig;
  };
  notion_config: NotionConfig | null;
  status: string;
  results: JobResult[] | null;
  generated_count: number;
  skipped_count: number;
  failed_count: number;
  pushed_count: number;
  notion_generated_count: number;
  notion_failed_count: number;
  total_contacts: number;
}

interface GeneratedEmail {
  subject: string;
  body: string;
  delay_days: number;
}

interface Contact {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  primary_email: string | null;
  company_website: string | null;
  primary_linkedin_url: string | null;
  enrichment_data: Record<string, unknown> | null;
  notion_preview_url: string | null;
}

// ============================================================================
// Stats
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  activeJobs: 0,
  totalJobsProcessed: 0,
  totalContactsGenerated: 0,
  totalContactsFailed: 0,
  totalContactsSkipped: 0,
  totalContactsPushed: 0,
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
        .select('id, display_name, first_name, last_name, company, job_title, primary_email, company_website, primary_linkedin_url, enrichment_data, notion_preview_url')
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

async function selectInChunks(
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

async function updateInChunks(
  table: string,
  updateData: Record<string, unknown>,
  column: string,
  ids: string[],
  extraFilter?: (q: any) => any,
): Promise<void> {
  for (let i = 0; i < ids.length; i += MAX_IN_CHUNK) {
    const chunk = ids.slice(i, i + MAX_IN_CHUNK);
    let query = supabase.from(table).update(updateData).in(column, chunk);
    if (extraFilter) query = extraFilter(query);
    await query;
  }
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

// ============================================================================
// Core: Process a single contact through the 3-phase pipeline
// ============================================================================

async function processOneContact(
  contact: Contact,
  job: EmailSequenceJob,
  notionConfig: NotionConfig | null,
  notionEnabled: boolean,
  pushConfig: PushConfig | undefined,
  productScoreMap: Map<string, number>,
  sharedSequenceIdRef: { value: string | null },
): Promise<{ result: JobResult; notionGenerated: boolean; notionFailed: boolean }> {
  let notionGenerated = false;
  let notionFailed = false;

  // ---- PHASE 1: Notion (optional) ----
  if (notionEnabled && !contact.notion_preview_url) {
    // Re-fetch to avoid stale data from parallel processing
    const { data: freshContact } = await supabase
      .from('crm_contacts')
      .select('notion_preview_url')
      .eq('id', contact.id)
      .single();
    if (freshContact?.notion_preview_url) {
      contact.notion_preview_url = freshContact.notion_preview_url;
    }
  }

  if (notionEnabled && !contact.notion_preview_url) {
    const threshold = notionConfig!.icpThreshold || 0;
    const productScore = productScoreMap.get(contact.id);
    const enrichment = contact.enrichment_data;
    const hasProductScore = productScore !== undefined;
    const icpScore = hasProductScore ? productScore : (Number(enrichment?.icp_score) || 0);
    const passesThreshold = !hasProductScore || icpScore >= threshold;

    if (passesThreshold) {
      console.log(`  [Notion] Generating for ${contact.display_name} (ICP: ${hasProductScore ? icpScore : 'unscored'})`);

      const MAX_NOTION_RETRIES = 2;
      let notionSuccess = false;

      for (let attempt = 0; attempt <= MAX_NOTION_RETRIES && !notionSuccess; attempt++) {
        if (attempt > 0) {
          const backoffMs = attempt * 3000;
          console.log(`  [Notion] Retry ${attempt + 1}/${MAX_NOTION_RETRIES + 1} for ${contact.display_name} after ${backoffMs}ms`);
          await sleep(backoffMs);
        }

        try {
          const blueprintIds = notionConfig!.blueprintIds || (notionConfig!.blueprintId ? [notionConfig!.blueprintId] : ['strategic-growth']);

          // ── Phase 1: Get AI messages from edge function ──
          const phase1Controller = new AbortController();
          const phase1Timeout = setTimeout(() => phase1Controller.abort(), 60_000);

          const phase1Response = await fetch(`${SUPABASE_URL}/functions/v1/generate-notion-preview`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contactId: contact.id,
              productId: notionConfig!.productId,
              connectionId: notionConfig!.connectionId,
              databaseId: notionConfig!.databaseId,
              organizationId: job.organization_id,
              blueprintIds,
              customPrompt: notionConfig!.customPrompt,
              model: notionConfig!.model,
              force: false,
              buildMessagesOnly: true,
            }),
            signal: phase1Controller.signal,
          });
          clearTimeout(phase1Timeout);

          const phase1Result = await phase1Response.json();

          // Handle skipped/error from Phase 1
          if (phase1Result.success && phase1Result.skipped) {
            if (phase1Result.notionPageUrl) {
              contact.notion_preview_url = phase1Result.notionPageUrl;
              notionSuccess = true;
            } else if (phase1Result.reason === 'generation_in_progress') {
              console.log(`  [Notion] In progress for ${contact.display_name}, waiting 5s`);
              await sleep(5000);
              const { data: recheck } = await supabase
                .from('crm_contacts')
                .select('notion_preview_url, notion_page_id')
                .eq('id', contact.id)
                .single();
              if (recheck?.notion_preview_url) {
                contact.notion_preview_url = recheck.notion_preview_url;
                notionSuccess = true;
              }
            }
            if (notionSuccess) continue; // next retry iteration or exit
          }

          if (!phase1Result.success) {
            throw new Error(phase1Result.error || 'Phase 1 failed');
          }

          if (!phase1Result.buildMessagesOnly || !phase1Result.aiRequest) {
            // Direct result (shouldn't happen but handle gracefully)
            if (phase1Result.notionPageUrl) {
              contact.notion_preview_url = phase1Result.notionPageUrl;
              notionGenerated = !phase1Result.skipped;
              notionSuccess = true;
              continue;
            }
            throw new Error('Unexpected Phase 1 response');
          }

          const { messages, maxTokens, temperature, model: aiModel, openRouterKey } = phase1Result.aiRequest;
          if (!openRouterKey) throw new Error('No OpenRouter key in Phase 1 response');

          // ── Phase 2: Call OpenRouter directly ──
          console.log(`  [Notion] Phase 2: Calling AI for ${contact.display_name}...`);
          const aiController = new AbortController();
          const aiTimeout = setTimeout(() => aiController.abort(), 300_000); // 5 min

          const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': SUPABASE_URL,
            },
            body: JSON.stringify({
              model: aiModel,
              messages,
              temperature,
              max_tokens: maxTokens,
              response_format: { type: 'json_object' },
            }),
            signal: aiController.signal,
          });
          clearTimeout(aiTimeout);

          if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new Error(`AI generation failed: ${aiResponse.status} - ${errorText.slice(0, 200)}`);
          }

          const aiData = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const aiContent = aiData.choices?.[0]?.message?.content;
          if (!aiContent) throw new Error('No content in AI response');

          // Parse JSON with repair logic (4-level fallback)
          let docDef: any = null;
          try {
            docDef = JSON.parse(extractJSON(aiContent));
          } catch {
            try {
              docDef = JSON.parse(repairJSON(aiContent));
              console.log(`  [Notion] JSON repaired for ${contact.display_name}`);
            } catch {
              // Retry AI with stricter prompt
              console.log(`  [Notion] JSON parse failed, retrying AI for ${contact.display_name}...`);
              const retryController = new AbortController();
              const retryTimeout = setTimeout(() => retryController.abort(), 300_000);
              const retryResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openRouterKey}`,
                  'Content-Type': 'application/json',
                  'HTTP-Referer': SUPABASE_URL,
                },
                body: JSON.stringify({
                  model: aiModel,
                  messages: [
                    ...messages,
                    { role: 'assistant', content: aiContent },
                    { role: 'user', content: 'Your output was not valid JSON. Please output ONLY the JSON object with no additional text, no markdown fences, no explanation. Start with { and end with }.' },
                  ],
                  temperature: 0.3,
                  max_tokens: maxTokens,
                  response_format: { type: 'json_object' },
                }),
                signal: retryController.signal,
              });
              clearTimeout(retryTimeout);

              if (!retryResponse.ok) throw new Error(`AI retry failed: ${retryResponse.status}`);
              const retryData = await retryResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
              const retryContent = retryData.choices?.[0]?.message?.content;
              if (!retryContent) throw new Error('No content in AI retry');

              try {
                docDef = JSON.parse(extractJSON(retryContent));
              } catch {
                try {
                  docDef = JSON.parse(repairJSON(retryContent));
                } catch {
                  throw new Error('Failed to parse AI-generated Notion content after retry');
                }
              }
            }
          }

          if (!docDef?.title || !Array.isArray(docDef.blocks)) {
            throw new Error('Invalid document structure: missing title or blocks');
          }

          console.log(`  [Notion] Phase 2: Parsed ${docDef.blocks.length} blocks for ${contact.display_name}`);

          // ── Phase 3: Create Notion page via edge function ──
          console.log(`  [Notion] Phase 3: Creating Notion page for ${contact.display_name}...`);
          const phase3Controller = new AbortController();
          const phase3Timeout = setTimeout(() => phase3Controller.abort(), 120_000);

          const phase3Response = await fetch(`${SUPABASE_URL}/functions/v1/generate-notion-preview`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contactId: contact.id,
              productId: notionConfig!.productId,
              connectionId: notionConfig!.connectionId,
              databaseId: notionConfig!.databaseId,
              organizationId: job.organization_id,
              blueprintIds,
              customPrompt: notionConfig!.customPrompt,
              model: notionConfig!.model,
              force: false,
              preGeneratedDocDef: docDef,
            }),
            signal: phase3Controller.signal,
          });
          clearTimeout(phase3Timeout);

          const notionResult = await phase3Response.json();

          if (notionResult.success) {
            if (notionResult.notionPageUrl) {
              contact.notion_preview_url = notionResult.notionPageUrl;
              if (!notionResult.skipped) {
                notionGenerated = true;
                console.log(`  [Notion] Created for ${contact.display_name}: ${notionResult.notionPageUrl}`);
              }
              notionSuccess = true;
            } else if (notionResult.reason === 'generation_in_progress') {
              console.log(`  [Notion] In progress for ${contact.display_name}, waiting 5s`);
              await sleep(5000);
              const { data: recheck } = await supabase
                .from('crm_contacts')
                .select('notion_preview_url, notion_page_id')
                .eq('id', contact.id)
                .single();
              if (recheck?.notion_preview_url) {
                contact.notion_preview_url = recheck.notion_preview_url;
                notionSuccess = true;
              } else if (recheck?.notion_page_id === 'generating') {
                await supabase
                  .from('crm_contacts')
                  .update({ notion_page_id: null })
                  .eq('id', contact.id)
                  .eq('notion_page_id', 'generating');
              }
            }
          } else {
            const errorMsg = notionResult.error || 'Unknown error';
            console.error(`  [Notion] Failed for ${contact.display_name} (attempt ${attempt + 1}):`, errorMsg);
            const isTransient = /timeout|rate.?limit|429|502|503|504|network|connection|ECONNRESET/i.test(errorMsg);
            if (!isTransient || attempt === MAX_NOTION_RETRIES) {
              notionFailed = true;
              notionSuccess = true; // Exit retry loop
            }
          }
        } catch (err) {
          const isTimeout = err instanceof DOMException && err.name === 'AbortError';
          const errMsg = isTimeout ? `Timed out` : (err instanceof Error ? err.message : String(err));
          console.error(`  [Notion] Error for ${contact.display_name} (attempt ${attempt + 1}):`, errMsg);
          if (attempt === MAX_NOTION_RETRIES) {
            notionFailed = true;
          }
        }
      }
    }
  }

  // ---- PHASE 2: Generate email sequence ----
  console.log(`  [Generate] Generating sequence for ${contact.display_name}`);

  let sequenceId: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-email-sequence`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contactId: contact.id,
        emailCount: job.email_count,
        config: job.generation_config,
        model: job.model,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const result = await response.json();

    if (result.success) {
      sequenceId = result.sequenceId;
    } else {
      return {
        result: { contactId: contact.id, status: 'failed', error: result.error || 'Generation failed' },
        notionGenerated,
        notionFailed,
      };
    }
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    const errorMsg = isTimeout ? 'Generation timed out' : (error instanceof Error ? error.message : 'Unknown error');
    return {
      result: { contactId: contact.id, status: 'failed', error: errorMsg },
      notionGenerated,
      notionFailed,
    };
  }

  // ---- PHASE 3: Push (optional) ----
  if (pushConfig && sequenceId) {
    try {
      const pushResult = await pushContact(job, pushConfig, contact, sequenceId, sharedSequenceIdRef.value);

      if (pushResult.success) {
        if (pushResult.sharedSequenceId && !sharedSequenceIdRef.value) {
          sharedSequenceIdRef.value = pushResult.sharedSequenceId;
        }
        return {
          result: { contactId: contact.id, status: 'pushed', sequenceId },
          notionGenerated,
          notionFailed,
        };
      } else {
        console.error(`  [Push] Failed for ${contact.display_name}: ${pushResult.error}`);
        // Push failed but generation succeeded
        return {
          result: { contactId: contact.id, status: 'success', sequenceId },
          notionGenerated,
          notionFailed,
        };
      }
    } catch (err) {
      console.error(`  [Push] Error for ${contact.display_name}:`, err);
      return {
        result: { contactId: contact.id, status: 'success', sequenceId },
        notionGenerated,
        notionFailed,
      };
    }
  }

  return {
    result: { contactId: contact.id, status: 'success', sequenceId: sequenceId! },
    notionGenerated,
    notionFailed,
  };
}

// ============================================================================
// Push helper
// ============================================================================

async function pushContact(
  job: EmailSequenceJob,
  pushConfig: PushConfig,
  contact: Contact,
  sequenceId: string,
  sharedSequenceId: string | null,
): Promise<{ success: boolean; sharedSequenceId?: string; error?: string }> {
  const { data: seqRows } = await supabase
    .from('contact_email_sequences')
    .select('id, contact_id, emails, notion_preview_url')
    .eq('id', sequenceId)
    .limit(1);

  const seq = seqRows?.[0] ?? null;
  if (!seq) return { success: false, error: 'Sequence not found' };
  if (!contact.primary_email) return { success: false, error: 'No email address' };

  const emails = seq.emails as GeneratedEmail[];
  const customFields: Record<string, string> = {};
  emails.forEach((email: GeneratedEmail, idx: number) => {
    const stepNum = idx + 1;
    customFields[`email_${stepNum}_subject`] = email.subject;
    customFields[`email_${stepNum}_body`] = email.body;
    customFields[`email_${stepNum}_delay`] = String(email.delay_days);
  });
  customFields['email_count'] = String(emails.length);
  customFields['notion_preview_url'] = seq.notion_preview_url || '';

  const pushFunctionName = pushConfig.toolType === 'smartlead'
    ? 'push-to-smartlead'
    : pushConfig.toolType === 'instantly'
    ? 'push-to-instantly'
    : pushConfig.toolType === 'internal'
    ? 'push-to-zapmail'
    : 'push-to-successai';

  const contactPayload = {
    id: contact.id,
    email: contact.primary_email,
    firstName: contact.first_name,
    lastName: contact.last_name,
    company: contact.company,
    jobTitle: contact.job_title,
    linkedinUrl: contact.primary_linkedin_url,
    website: contact.company_website,
  };

  const pushBody = pushConfig.toolType === 'internal'
    ? {
        contact: contactPayload,
        personalizedSubject: emails[0]?.subject || '',
        personalizedBody: emails[0]?.body || '',
        customFields,
        sequenceName: pushConfig.sequenceName || `Outreach - ${new Date().toLocaleDateString()}`,
        organizationId: job.organization_id,
        internalSettings: pushConfig.internalSettings,
        mailboxTagFilter: pushConfig.mailboxTagFilter,
        existingSequenceId: sharedSequenceId || undefined,
        createAsDraft: pushConfig.createAsDraft,
        knowledgeDocumentIds: job.generation_config?.knowledgeDocumentIds || undefined,
      }
    : {
        connectionId: pushConfig.connectionId,
        campaignId: pushConfig.externalCampaignId,
        contact: contactPayload,
        personalizedSubject: emails[0]?.subject || '',
        personalizedBody: emails[0]?.body || '',
        customFields,
        organizationId: job.organization_id,
      };

  const pushResponse = await fetch(`${SUPABASE_URL}/functions/v1/${pushFunctionName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pushBody),
  });

  const pushResult = await pushResponse.json();

  if (pushResult.success) {
    await supabase
      .from('contact_email_sequences')
      .update({
        status: 'pushed',
        pushed_to_tool: pushConfig.toolType === 'internal' ? 'zapmail' : pushConfig.toolType,
        pushed_at: new Date().toISOString(),
        external_campaign_id: pushConfig.externalCampaignId || null,
        connection_id: pushConfig.connectionId || null,
      })
      .eq('id', sequenceId);

    return { success: true, sharedSequenceId: pushResult.sequenceId || undefined };
  }

  return { success: false, error: pushResult.error || 'Push failed' };
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

    const typedJob = job as EmailSequenceJob;
    if (typedJob.status !== 'running') {
      console.log(`[Job ${jobId}] Not in running state (${typedJob.status}), skipping`);
      return;
    }

    // 2. Fetch all contacts
    const { data: contacts, error: contactsError } = await fetchContactsChunked(
      typedJob.contact_ids, typedJob.organization_id,
    );

    if (contactsError) {
      console.error(`[Job ${jobId}] Failed to fetch contacts:`, contactsError);
      await updateJobFailed(jobId, contactsError);
      return;
    }

    console.log(`[Job ${jobId}] Fetched ${contacts.length} contacts`);

    await supabase
      .from('email_sequence_jobs')
      .update({ total_contacts: contacts.length })
      .eq('id', jobId);

    // 3. Build set of already-processed contact IDs
    const existingResultMap = new Map<string, JobResult>();
    for (const r of (typedJob.results || [])) {
      existingResultMap.set(r.contactId, r);
    }

    const notionConfig = typedJob.notion_config;
    const notionEnabled = !!(notionConfig?.enabled && notionConfig.connectionId);
    const pushConfig = typedJob.generation_config?.pushConfig;

    // Contacts that were generated but not yet pushed
    const pendingPushContacts: { contact: Contact; sequenceId: string }[] = [];
    const allSkippable: Contact[] = [];
    const allProcessable: Contact[] = [];

    for (const c of contacts) {
      const existing = existingResultMap.get(c.id);
      if (existing) {
        if (existing.status === 'success' && pushConfig && existing.sequenceId) {
          pendingPushContacts.push({ contact: c, sequenceId: existing.sequenceId });
        }
        continue;
      }

      const enrichment = c.enrichment_data;
      const hasEnrichment = !!(enrichment &&
        Object.keys(enrichment).length > 0 &&
        (enrichment.primary_need || enrichment.company_niche));

      if (hasEnrichment) {
        allProcessable.push(c);
      } else {
        allSkippable.push(c);
      }
    }

    console.log(`[Job ${jobId}] ${allProcessable.length} to process, ${pendingPushContacts.length} pending push, ${allSkippable.length} to skip, ${existingResultMap.size} already done`);

    // 4. ICP threshold setup for Notion
    let productScoreMap = new Map<string, number>();
    if (notionEnabled && notionConfig!.productId) {
      const contactIdsToCheck = allProcessable.map(c => c.id);
      if (contactIdsToCheck.length > 0) {
        const productScores = await selectInChunks(
          'contact_product_scores', 'contact_id, icp_score', 'contact_id', contactIdsToCheck,
          (q: any) => q.eq('product_id', notionConfig!.productId),
        );
        for (const ps of productScores) {
          productScoreMap.set(ps.contact_id, ps.icp_score ?? 0);
        }
      }

      // Clear stale 'generating' sentinels
      await updateInChunks(
        'crm_contacts', { notion_page_id: null }, 'id', allProcessable.map(c => c.id),
        (q: any) => q.eq('notion_page_id', 'generating').is('notion_preview_url', null),
      );
    }

    // 5. Collect results
    const allResults: JobResult[] = [...(typedJob.results || [])];
    let generatedCount = typedJob.generated_count || 0;
    let failedCount = typedJob.failed_count || 0;
    let skippedCount = typedJob.skipped_count || 0;
    let pushedCount = typedJob.pushed_count || 0;
    let notionGeneratedCount = typedJob.notion_generated_count || 0;
    let notionFailedCount = typedJob.notion_failed_count || 0;

    // Shared sequence ID tracking
    let sharedSequenceIdRef = {
      value: pushConfig?.existingSequenceId || null,
    };
    if (!sharedSequenceIdRef.value && pushConfig?.toolType === 'internal') {
      const firstPushed = (typedJob.results || []).find((r: JobResult) => r.status === 'pushed' && r.sequenceId);
      if (firstPushed) sharedSequenceIdRef.value = firstPushed.sequenceId!;
    }

    // Add skipped contacts
    for (const contact of allSkippable) {
      allResults.push({
        contactId: contact.id,
        status: 'skipped',
        error: 'No enrichment data — run Company Analysis first',
      });
      skippedCount++;
    }

    // 6. Process pending pushes from previous partial run
    for (const { contact, sequenceId } of pendingPushContacts) {
      if (await isJobCancelled(jobId)) break;

      try {
        const pushResult = await pushContact(typedJob, pushConfig!, contact, sequenceId, sharedSequenceIdRef.value);
        if (pushResult.success) {
          if (pushResult.sharedSequenceId && !sharedSequenceIdRef.value) {
            sharedSequenceIdRef.value = pushResult.sharedSequenceId;
          }
          // Upgrade from 'success' to 'pushed' in results
          const existingIdx = allResults.findIndex(r => r.contactId === contact.id);
          if (existingIdx >= 0) {
            allResults[existingIdx] = { contactId: contact.id, status: 'pushed', sequenceId };
          } else {
            allResults.push({ contactId: contact.id, status: 'pushed', sequenceId });
          }
          pushedCount++;
        }
      } catch (err) {
        console.error(`[Job ${jobId}] Pending push error for ${contact.display_name}:`, err);
      }
    }

    // 7. Process contacts in parallel batches
    let i = 0;
    let batchNum = 0;
    while (i < allProcessable.length) {
      if (await isJobCancelled(jobId)) {
        console.log(`[Job ${jobId}] Cancelled, stopping`);
        break;
      }

      const concurrency = getParallelConcurrency();
      const batch = allProcessable.slice(i, i + concurrency);
      i += batch.length;
      batchNum++;

      const batchNames = batch.map(c => c.display_name).join(', ');
      const totalProcessed = allResults.length + batch.length;
      const progress = Math.round((totalProcessed / contacts.length) * 100);

      await supabase
        .from('email_sequence_jobs')
        .update({
          progress: Math.min(progress, 99),
          current_contact_name: batchNames,
          generated_count: generatedCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
          pushed_count: pushedCount,
          notion_generated_count: notionGeneratedCount,
          notion_failed_count: notionFailedCount,
        })
        .eq('id', jobId);

      console.log(`[Job ${jobId}] Batch ${batchNum} (×${concurrency}): ${batchNames} (${totalProcessed}/${contacts.length})`);

      const results = await Promise.allSettled(
        batch.map(c => processOneContact(c, typedJob, notionConfig, notionEnabled, pushConfig, productScoreMap, sharedSequenceIdRef)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { result: jr, notionGenerated, notionFailed } = result.value;
          allResults.push(jr);
          if (jr.status === 'success') generatedCount++;
          else if (jr.status === 'pushed') { generatedCount++; pushedCount++; }
          else if (jr.status === 'failed') failedCount++;
          else if (jr.status === 'skipped') skippedCount++;
          if (notionGenerated) notionGeneratedCount++;
          if (notionFailed) notionFailedCount++;
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
          pushed_count: pushedCount,
          notion_generated_count: notionGeneratedCount,
          notion_failed_count: notionFailedCount,
          results: allResults,
        })
        .eq('id', jobId);
    }

    // 8. Finalize
    const wasCancelled = await isJobCancelled(jobId);
    const finalStatus = wasCancelled ? 'cancelled' : 'completed';
    const finalGenerated = allResults.filter(r => r.status === 'success' || r.status === 'pushed').length;
    const finalSkipped = allResults.filter(r => r.status === 'skipped').length;
    const finalFailed = allResults.filter(r => r.status === 'failed').length;
    const finalPushed = allResults.filter(r => r.status === 'pushed').length;

    const completionUpdate: Record<string, unknown> = {
      status: finalStatus,
      progress: 100,
      current_contact_name: null,
      generated_count: finalGenerated,
      skipped_count: finalSkipped,
      failed_count: finalFailed,
      pushed_count: finalPushed,
      notion_generated_count: notionGeneratedCount,
      notion_failed_count: notionFailedCount,
      results: allResults,
      completed_at: new Date().toISOString(),
    };

    // Save resolvedSequenceId for frontend "Open in Builder" link
    if (sharedSequenceIdRef.value && pushConfig?.toolType === 'internal') {
      completionUpdate.generation_config = {
        ...typedJob.generation_config,
        pushConfig: {
          ...pushConfig,
          resolvedSequenceId: sharedSequenceIdRef.value,
        },
      };
    }

    await supabase
      .from('email_sequence_jobs')
      .update(completionUpdate)
      .eq('id', jobId);

    console.log(`[Job ${jobId}] ${finalStatus}: ${finalGenerated} generated, ${finalPushed} pushed, ${finalSkipped} skipped, ${finalFailed} failed`);

    stats.totalJobsProcessed++;
    stats.totalContactsGenerated += finalGenerated;
    stats.totalContactsFailed += finalFailed;
    stats.totalContactsSkipped += finalSkipped;
    stats.totalContactsPushed += finalPushed;

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
          .eq('job_type', 'email_sequence')
          .order('created_at', { ascending: true })
          .limit(1);

        if (pendingJobs && pendingJobs.length > 0) {
          const nextJob = pendingJobs[0];
          console.log(`[Worker] Picking up queued job ${nextJob.id}`);
          await supabase
            .from('email_sequence_jobs')
            .update({ status: 'running', started_at: new Date().toISOString() })
            .eq('id', nextJob.id);
          processJob(nextJob.id).catch(err => {
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

async function isJobCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_sequence_jobs')
    .select('status')
    .eq('id', jobId)
    .single();
  return data?.status === 'cancelled';
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
  console.log(`[Worker] Email sequence generator listening on 0.0.0.0:${PORT}`);

  // Resume orphaned running jobs
  try {
    const { data: orphanedJobs } = await supabase
      .from('email_sequence_jobs')
      .select('id')
      .eq('status', 'running')
      .eq('job_type', 'email_sequence')
      .order('created_at', { ascending: true });

    if (orphanedJobs && orphanedJobs.length > 0) {
      console.log(`[Worker] Found ${orphanedJobs.length} orphaned job(s), resuming...`);
      for (const job of orphanedJobs) {
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
