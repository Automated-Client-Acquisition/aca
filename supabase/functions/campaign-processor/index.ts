/**
 * Campaign Processor Edge Function (Multi-Channel)
 *
 * Processes active campaigns (LinkedIn, Email, WhatsApp, Instagram, Telegram)
 * by executing sequence steps for each lead via Unipile.
 * Runs every 5 minutes via cron job.
 *
 * Flow:
 * 1. Fetch active campaigns
 * 2. For each campaign, get leads ready for processing
 * 3. Determine channel from node type
 * 4. Get contact identity for that channel
 * 5. Execute appropriate action via Unipile SDK
 * 6. Handle channel fallback if primary fails
 * 7. Update progress and advance to next node
 * 8. Log all actions for audit trail
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { hasActiveSmsSender, resolveContactPhone, sendCampaignSms, smsReachablePhone } from '../_shared/messaging/sms.ts';
import { sendCampaignWhatsAppTemplate } from '../_shared/messaging/whatsapp.ts';
import { createClient, SupabaseClient, FunctionsHttpError } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { resolveAttachmentBinaries, appendAttachmentsToFormData } from '../_shared/attachment-utils.ts';
import { checkFeatureAccess } from '../_shared/featureAccess.ts';
import { classifyReply, type ClassificationResult } from '../_shared/reply-classifier.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';
import { evaluateFollowupRules } from '../_shared/followup-rule-engine.ts';
import { normalizeDsnUrl, parseUnipileError } from '../_shared/unipile-client.ts';
import { accountPath, isUnipileApiError, UnipileV2Client } from '../_shared/unipile/index.ts';
import * as linkedinV2 from '../_shared/unipile/linkedin-v2.ts';
import { sendDirectMessage, whatsAppUserId } from '../_shared/unipile/messaging-v2.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { normalizeDashes, sanitizeAIEmailBody, sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { applyAIFilters as applyRuleBasedFilters } from '../_shared/ai-lead-filter.ts';
import { selectInChunks } from '../_shared/chunked-query.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { fetchChatCompletions, isOllamaModel } from '../_shared/llm-client.ts';
import { findEmailViaDiscovery } from '../_shared/list-building/find-email-discovery.ts';
import { verifyEmailAddress } from '../_shared/list-verifier.ts';
import { MoltsetsAdapter, checkMoltsetsQuota, MOLTSETS_PLAN_LIMITS, type MoltsetsPlanTier } from '../_shared/enrichment/moltsets.ts';
import { logEmailProviderLookup } from '../_shared/enrichment/write-back.ts';

import { campaignEntrySender, skipEntryConnectionRequest } from '../_shared/campaign-entry-sender.ts';
import {
  type CheckOutcome,
  type ContactCheck,
  type ContactReach,
  type RouteChannel,
  contactReach,
  enteredViaTrigger,
  entryChannel,
  reachableOn,
  resolveContactCheck,
  routeOrder,
  ROUTE_NONE,
  UNIPILE_SENDER_CHANNELS,
  whatsappIdFromPhone,
} from '../_shared/contact-checks.ts';
import {
  WorkflowNode,
  WorkflowEdge,
  findStartNode,
  findNodeById,
  getNextNode,
  isTerminalNode,
  isActionNode,
  nodeRequiresSenderAccount,
  isDelayNode,
  isConditionNode,
  getMessageContent,
  getDelayDuration,
  getConnectionRequestMessage,
  getPromptContent,
  isPromptMode,
  replaceTemplateVariables,
  TemplateContext,
  isWithinBusinessHours,
  BusinessHoursConfig,
  calculateBackoffDelay,
  MAX_RETRY_COUNT,
  selectSenderAccount,
  getConditionWaitDuration,
  shouldWaitAtCondition,
} from '../_shared/workflow-utils.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { flyWorkerAuthHeaders } from '../_shared/fly-worker-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Channel definition cache (min_interval_seconds per channel)
// ============================================================================

// Maps channel type → min_interval_seconds (populated lazily once per invocation)
const channelDefCache = new Map<string, number>();
let channelDefCacheLoaded = false;

// ============================================================================
// Org custom field placeholder cache — {{custom_<key>}} fallback values
// ============================================================================

// Maps organization_id → { field_key: default_value }, lazily populated once
// per org per invocation.
const orgCustomFieldDefaultsCache = new Map<string, Record<string, string>>();

async function getOrgCustomFieldDefaults(
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<Record<string, string>> {
  const cached = orgCustomFieldDefaultsCache.get(organizationId);
  if (cached) return cached;

  const { data } = await supabase
    .from('crm_custom_field_defs')
    .select('field_key, default_value')
    .eq('organization_id', organizationId)
    .not('default_value', 'is', null);

  const defaults: Record<string, string> = {};
  for (const def of (data || [])) {
    if (def.default_value) defaults[def.field_key] = def.default_value;
  }
  orgCustomFieldDefaultsCache.set(organizationId, defaults);
  return defaults;
}

async function ensureChannelDefCache(supabase: SupabaseClient): Promise<void> {
  if (channelDefCacheLoaded) return;
  const { data } = await supabase
    .from('channel_limit_definitions')
    .select('channel, min_interval_seconds');
  if (data) {
    for (const row of data) {
      channelDefCache.set(row.channel, row.min_interval_seconds ?? 60);
    }
  }
  channelDefCacheLoaded = true;
}

// ============================================================================
// Edge function error extraction
// ============================================================================

// deno-lint-ignore no-explicit-any
async function extractFunctionError(error: any): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      return body?.error || body?.message || error.message;
    } catch {
      return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// Non-retryable error detection
// ============================================================================

const NON_RETRYABLE_PATTERNS = [
  'profile is not locked', // Unipile 422 detail text
  'Recipient cannot be reached',
  'already_blocked',
  'not_connected',
  'account_restricted',
  'sender account not active', // Sender disconnected — handled by DB trigger
  'contact has no identity', // No platform identity resolved — permanent failure
  'not supported on unipile v2', // Node type not ported to v2 yet — retrying won't help
];

// Provider-level rate limits - NOT permanent failures. These need long backoff
// (hours, not minutes) and should never permanently fail a lead. The provider
// just needs time to cool down.
const PROVIDER_RATE_LIMIT_PATTERNS = [
  'cannot_resend_yet',        // LinkedIn daily invitation cap hit
  'temporary provider limit', // Unipile generic provider throttle
];

// Errors that trigger identity re-resolution before failing
const IDENTITY_RERESOLUTION_PATTERNS = [
  'invalid_recipient',
  'malformed_request',
];

function isNonRetryableError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return NON_RETRYABLE_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

function isProviderRateLimited(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return PROVIDER_RATE_LIMIT_PATTERNS.some(p => lower.includes(p));
}

// Transient LLM/provider rate limits (e.g. OpenRouter 429, upstream model
// cool-downs). These are momentary — the lead should be RETRIED with backoff,
// never silently skipped. Skipping an LLM step (e.g. analyzeContact) leaves the
// contact un-enriched, and with a fail-closed ICP gate that means a perfectly
// good lead is dropped from the campaign because the model was busy for a minute.
const TRANSIENT_LLM_RATE_LIMIT_PATTERNS = [
  'error 429',
  '429:',
  'code":429',
  'rate-limited upstream',
  'temporarily rate-limited',
  'please retry shortly',
  'too many requests',
  'rate limit exceeded',
];

function isTransientLlmRateLimit(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return TRANSIENT_LLM_RATE_LIMIT_PATTERNS.some(p => lower.includes(p));
}

function isIdentityResolutionError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return IDENTITY_RERESOLUTION_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

// Unipile returns `errors/disconnected_account` (401) when an account is
// logged out / restricted on the underlying provider (LinkedIn, Instagram,
// etc). The DB still says "active" because /api/v1/accounts may not surface
// the drop until much later, so we flip status here on the first send failure
// to stop hammering Unipile and to show the account as disconnected on /senders.
function isDisconnectedAccountError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('disconnected_account') || lower.includes('disconnected account');
}

async function markAccountDisconnectedFromSendError(
  supabase: SupabaseClient<any>,
  accountId: string | null | undefined,
  error: string | undefined,
): Promise<void> {
  if (!accountId || !isDisconnectedAccountError(error)) return;
  const { error: updateError } = await supabase
    .from('unipile_accounts')
    .update({
      status: 'disconnected',
      error_message: 'Account disconnected from provider. Please reconnect in Settings.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .neq('status', 'disconnected');
  if (updateError) {
    console.error(`[Campaign Processor] Failed to mark account ${accountId} disconnected:`, updateError.message);
  } else {
    console.warn(`[Campaign Processor] Marked account ${accountId} disconnected after send error: ${error}`);
  }
}

// ============================================================================
// Types
// ============================================================================

// Channel types supported via Unipile
// 'sms' was missing here while _shared/channels/types.ts includes it and the
// allChannels list below already enumerates it — so SMS fell outside this
// local union everywhere this file branches on channel.
type ChannelType = 'linkedin' | 'email' | 'whatsapp' | 'instagram' | 'telegram' | 'sms' | 'messenger' | 'twitter';

// Outcome of one action. For chat sends, externalId is the Unipile chat id and
// messageId the id of the message just sent (what inbound webhooks and the
// crm_messages unique index key on).
type ActionResult = { success: boolean; error?: string; externalId?: string; messageId?: string };

// Sender accounts by channel
type SenderAccountsByChannel = Partial<Record<ChannelType, string[]>>;

interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  lead_list_id: string | null;
  // Legacy: LinkedIn-only sender accounts
  sender_account_ids: string[];
  // Multi-channel sender selection
  sender_accounts?: SenderAccountsByChannel;
  campaign_type?: 'linkedin_only' | 'email_only' | 'multi_channel' | 'sms_whatsapp';
  primary_channel?: ChannelType;
  channel_fallback_enabled?: boolean;
  fallback_order?: ChannelType[];
  sequence_nodes: WorkflowNode[];
  sequence_edges: WorkflowEdge[];
  // AI prompt mode configuration
  ai_message_config?: { defaultModel?: string; defaultTemperature?: number };
  // ICP score filtering
  icp_product_id?: string | null;
  min_icp_score?: number | null;
  // Power features
  campaign_settings?: CampaignPowerSettings;
  agent_profile_id?: string | null;
  autopilot_config?: {
    enabled: boolean;
    rules: Array<{ intent: string; action: string; calendly_link?: string; message_template?: string }>;
    require_approval: boolean;
    max_auto_replies: number;
  } | null;
  // Rate limiting
  rate_settings?: CampaignRateSettings;
  // Whether an inbound reply should halt further sends (default true — see
  // unipile-webhook-handler, which stamps replied_at on the lead)
  stop_on_reply?: boolean;
}

interface CampaignRateSettings {
  min_delay_seconds?: number;
  max_delay_seconds?: number;
}

interface CampaignPowerSettings {
  stop_on_auto_reply?: boolean;
  stop_company_on_reply?: boolean;
  ai_filter_unlikely_reply?: 'skip' | 'send';
  ai_filter_hostile?: 'skip' | 'send';
}

interface LeadProgress {
  entry_context?: Record<string, unknown> | null;
  id: string;
  campaign_id: string;
  contact_id: string;
  sender_account_id: string | null;
  status: string;
  current_node_id: string | null;
  next_action_at: string | null;
  connection_sent_at: string | null;
  connection_accepted_at: string | null;
  last_message_at: string | null;
  variation_index: number;
  error_message: string | null;
  retry_count: number;
  // Multi-channel tracking
  channel_used?: ChannelType;
  channel_attempts?: Record<string, { status: string; at: string }>;
  // CRM bridge
  crm_conversation_id?: string | null;
  // Reply classification
  lead_intent?: string | null;
  // Condition waiting
  condition_entered_at?: string | null;
  // Generated email content from generateEmails node
  generated_data?: Record<string, string> | null;
  // Stamped by unipile-webhook-handler when an inbound reply is detected
  replied_at?: string | null;
}

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  headline: string | null;
}

interface UnipileAccount {
  id: string;
  unipile_account_id: string;
  access_token_encrypted: string;
  dsn_url: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  status: string;
}

interface ContactIdentity {
  platform_user_id: string;
}

interface ProcessingResult {
  leadId: string;
  contactId: string;
  action: string;
  success: boolean;
  error?: string;
  externalId?: string;
  limitReached?: boolean;
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ---- Test Mode: process a single lead on-demand ----
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore for cron calls */ }

  if (body.testMode === true) {
    const { campaignId, progressId } = body as { campaignId: string; progressId: string };

    try {
      // Fetch campaign regardless of status (works on drafts)
      const { data: campaign, error: campaignError } = await supabase
        .from('linkedin_campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (campaignError || !campaign) {
        return new Response(JSON.stringify({ success: false, error: 'Campaign not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch the specific test progress row
      const { data: lead, error: leadError } = await supabase
        .from('campaign_lead_progress')
        .select('*')
        .eq('id', progressId)
        .single();

      if (leadError || !lead) {
        return new Response(JSON.stringify({ success: false, error: 'Progress row not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Process the single lead with delays skipped, dry-run = no real API calls
      const result = await processLead(supabase, campaign as Campaign, lead as LeadProgress, { skipDelays: true, dryRun: true });

      // Fetch updated progress row with contact join
      const { data: updatedLead } = await supabase
        .from('campaign_lead_progress')
        .select(`*, contact:crm_contacts(id, first_name, last_name, display_name, company, job_title, avatar_url)`)
        .eq('id', progressId)
        .single();

      // Fetch action logs for this test lead
      const { data: actionLogs } = await supabase
        .from('campaign_action_log')
        .select('*')
        .eq('progress_id', progressId)
        .order('created_at', { ascending: true });

      return new Response(JSON.stringify({
        success: true,
        result,
        progress: updatedLead,
        actionLogs: actionLogs || [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (error) {
      console.error('[Campaign Processor] Test mode error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // ---- Single-Lead Mode: called by Fly.io orchestrator worker ----
  if (body.processLeadId && body.campaignId) {
    const { processLeadId, campaignId } = body as { processLeadId: string; campaignId: string };

    try {
      const { data: campaign, error: campaignError } = await supabase
        .from('linkedin_campaigns')
        .select('*')
        .eq('id', campaignId)
        .eq('status', 'active')
        .single();

      if (campaignError || !campaign) {
        return new Response(JSON.stringify({ success: false, error: 'Campaign not found or not active' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check feature access
      const featureCheck = await checkFeatureAccess(supabase, campaign.organization_id, 'linkedin_campaigns');
      if (!featureCheck.allowed) {
        return new Response(JSON.stringify({ success: false, error: 'Feature not available for this plan' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: lead, error: leadError } = await supabase
        .from('campaign_lead_progress')
        .select('*')
        .eq('id', processLeadId)
        .eq('campaign_id', campaignId)
        .single();

      if (leadError || !lead) {
        return new Response(JSON.stringify({ success: false, error: 'Lead progress not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await ensureChannelDefCache(supabase);
      const result = await processLead(supabase, campaign as Campaign, lead as LeadProgress);

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('[Campaign Processor] Single-lead mode error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // ---- Normal cron mode ----
  const jobId = crypto.randomUUID();
  const startTime = Date.now();
  const results: ProcessingResult[] = [];
  const errors: string[] = [];

  try {
    console.log(`[Campaign Processor] Starting job ${jobId}`);

    // Load channel definition defaults (min_interval_seconds) for cooldown calculations
    try {
      await ensureChannelDefCache(supabase);
    } catch (cacheErr) {
      console.warn('[Campaign Processor] Failed to load channel definitions, using defaults:', cacheErr instanceof Error ? cacheErr.message : cacheErr);
    }

    // 0. Initialize leads for newly activated campaigns (async from trigger)
    try {
      const { data: needsInit } = await supabase
        .from('linkedin_campaigns')
        .select('id')
        .eq('needs_lead_init', true)
        .limit(5);

      for (const campaign of needsInit || []) {
        console.log(`[Campaign Processor] Initializing leads for campaign ${campaign.id}`);
        const { error: initError } = await supabase.rpc('initialize_campaign_leads', { p_campaign_id: campaign.id });
        if (initError) {
          console.error(`[Campaign Processor] Lead init failed for ${campaign.id}: ${initError.message}`);
        } else {
          await supabase
            .from('linkedin_campaigns')
            .update({ needs_lead_init: false })
            .eq('id', campaign.id);
          console.log(`[Campaign Processor] Lead init complete for ${campaign.id}`);
        }
      }
    } catch (initErr) {
      console.error('[Campaign Processor] Lead init check failed:', initErr instanceof Error ? initErr.message : initErr);
    }

    // 1. Fetch active campaigns
    const { data: campaigns, error: campaignsError } = await supabase
      .from('linkedin_campaigns')
      .select('*')
      .eq('status', 'active');

    if (campaignsError) {
      throw new Error(`Failed to fetch campaigns: ${campaignsError.message}`);
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('[Campaign Processor] No active campaigns found');
      try { await logJob(supabase, jobId, 'completed', startTime, { message: 'No active campaigns' }); } catch { /* non-fatal */ }
      return new Response(JSON.stringify({ success: true, message: 'No active campaigns' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Campaign Processor] Found ${campaigns.length} active campaigns`);

    // 2. Process each campaign
    for (const campaign of campaigns as Campaign[]) {
      try {
        // Check feature access for LinkedIn campaigns
        const featureCheck = await checkFeatureAccess(supabase, campaign.organization_id, 'linkedin_campaigns');
        if (!featureCheck.allowed) {
          console.warn(`[Campaign Processor] Skipping campaign ${campaign.id}: org ${campaign.organization_id} does not have linkedin_campaigns feature (plan: ${featureCheck.planTier})`);
          continue;
        }

        await processCampaign(supabase, campaign, results, errors);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Campaign Processor] Error processing campaign ${campaign.id}: ${errorMsg}`);
        errors.push(`Campaign ${campaign.id}: ${errorMsg}`);
      }
    }

    // 3. Log job completion
    const summary = {
      campaignsProcessed: campaigns.length,
      leadsProcessed: results.length,
      successful: results.filter(r => r.success && !r.limitReached).length,
      limitReached: results.filter(r => r.limitReached).length,
      failed: results.filter(r => !r.success).length,
      errors: errors.length > 0 ? errors : undefined,
    };

    try { await logJob(supabase, jobId, 'completed', startTime, summary); } catch { /* non-fatal */ }

    console.log(`[Campaign Processor] Job ${jobId} completed:`, summary);

    return new Response(JSON.stringify({ success: true, jobId, ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Campaign Processor] Fatal error:', error);

    try { await logJob(supabase, jobId, 'failed', startTime, { error: error instanceof Error ? error.message : 'Unknown error' }); } catch { /* non-fatal */ }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ============================================================================
// Campaign Processing
// ============================================================================

async function processCampaign(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  results: ProcessingResult[],
  errors: string[]
): Promise<void> {
  console.log(`[Campaign Processor] Processing campaign: ${campaign.name} (${campaign.id})`);

  // Get leads ready for processing (exclude test contacts)
  // Exclude leads waiting for connection acceptance — those are handled by
  // campaign-connection-checker, not the main processor. Including them here
  // wastes the 15-lead-per-run slots since they get skipped in processLead anyway.
  const now = new Date().toISOString();
  const { data: leads, error: leadsError } = await supabase
    .from('campaign_lead_progress')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('is_test_contact', false)
    .in('status', ['pending', 'in_progress', 'waiting', 'replied'])
    .or(`next_action_at.is.null,next_action_at.lte.${now}`)
    .or('connection_sent_at.is.null,connection_accepted_at.not.is.null')
    .order('created_at', { ascending: true })
    .limit(15); // Process 15 leads per campaign per run (keep under edge function timeout)

  if (leadsError) {
    throw new Error(`Failed to fetch leads: ${leadsError.message}`);
  }

  if (!leads || leads.length === 0) {
    console.log(`[Campaign Processor] No leads to process for campaign ${campaign.id}`);
    return;
  }

  // If campaign has ICP score filtering, filter and prioritize leads
  let filteredLeads = leads as LeadProgress[];

  try {
    if (campaign.icp_product_id && campaign.min_icp_score && campaign.min_icp_score > 0) {
      const contactIds = filteredLeads.map(l => l.contact_id);

      // Batch-fetch ICP scores for these contacts
      const scores = await selectInChunks(supabase, 'contact_product_scores', 'contact_id, icp_score', 'contact_id', contactIds,
        (q) => q.eq('product_id', campaign.icp_product_id));

      const scoreMap = new Map<string, number>();
      if (scores) {
        for (const s of scores) {
          scoreMap.set(s.contact_id, s.icp_score ?? 0);
        }
      }

      // Filter out leads below the minimum ICP score threshold
      const beforeCount = filteredLeads.length;
      filteredLeads = filteredLeads.filter(lead => {
        const score = scoreMap.get(lead.contact_id);
        // If no score exists, skip the lead (unscored contacts don't pass the filter)
        if (score === undefined) return false;
        return score >= campaign.min_icp_score!;
      });

      // Sort remaining leads by ICP score DESC (best prospects first)
      filteredLeads.sort((a, b) => {
        const scoreA = scoreMap.get(a.contact_id) ?? 0;
        const scoreB = scoreMap.get(b.contact_id) ?? 0;
        return scoreB - scoreA;
      });

      if (filteredLeads.length < beforeCount) {
        console.log(`[Campaign Processor] ICP filter: ${beforeCount} leads → ${filteredLeads.length} (min score: ${campaign.min_icp_score}, product: ${campaign.icp_product_id})`);
      }
    } else if (campaign.icp_product_id) {
      // Product selected but no min score — just prioritize by ICP score
      const contactIds = filteredLeads.map(l => l.contact_id);

      const scores = await selectInChunks(supabase, 'contact_product_scores', 'contact_id, icp_score', 'contact_id', contactIds,
        (q) => q.eq('product_id', campaign.icp_product_id));

      if (scores && scores.length > 0) {
        const scoreMap = new Map<string, number>();
        for (const s of scores) {
          scoreMap.set(s.contact_id, s.icp_score ?? 0);
        }

        filteredLeads.sort((a, b) => {
          const scoreA = scoreMap.get(a.contact_id) ?? 0;
          const scoreB = scoreMap.get(b.contact_id) ?? 0;
          return scoreB - scoreA;
        });
      }
    }
  } catch (icpErr) {
    console.warn(`[Campaign Processor] ICP scoring failed for campaign ${campaign.id}, processing without filter:`, icpErr instanceof Error ? icpErr.message : icpErr);
  }

  if (filteredLeads.length === 0) {
    console.log(`[Campaign Processor] No leads to process for campaign ${campaign.id} after ICP filtering`);
    return;
  }

  console.log(`[Campaign Processor] Found ${filteredLeads.length} leads to process`);

  // Check business hours for organization
  let businessHoursConfig: BusinessHoursConfig = { enabled: false } as BusinessHoursConfig;
  try {
    businessHoursConfig = await getBusinessHoursConfig(supabase, campaign.organization_id);
  } catch (bhErr) {
    console.warn(`[Campaign Processor] Failed to fetch business hours for org ${campaign.organization_id}, defaulting to always-on:`, bhErr instanceof Error ? bhErr.message : bhErr);
  }
  if (!isWithinBusinessHours(businessHoursConfig)) {
    console.log(`[Campaign Processor] Outside business hours for org ${campaign.organization_id}, skipping`);
    return;
  }

  // Time budget: stop processing before edge function timeout (150s max, leave 20s buffer)
  const campaignStartTime = Date.now();
  const MAX_CAMPAIGN_PROCESSING_MS = 120_000; // 2 minutes max per campaign

  // Process each lead
  for (const lead of filteredLeads) {
    // Check time budget before processing next lead
    if (Date.now() - campaignStartTime > MAX_CAMPAIGN_PROCESSING_MS) {
      console.log(`[Campaign Processor] Time budget exceeded for campaign ${campaign.id}, stopping. Processed ${results.length}/${filteredLeads.length} leads.`);
      break;
    }

    try {
      const result = await processLead(supabase, campaign, lead);
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Campaign Processor] Error processing lead ${lead.id}: ${errorMsg}`);
      errors.push(`Lead ${lead.id}: ${errorMsg}`);
      // Persist error to DB for visibility
      await supabase
        .from('campaign_lead_progress')
        .update({
          error_message: errorMsg,
          retry_count: (lead.retry_count || 0) + 1,
        })
        .eq('id', lead.id);
      results.push({
        leadId: lead.id,
        contactId: lead.contact_id,
        action: 'process',
        success: false,
        error: errorMsg,
      });
    }
  }
}

interface ProcessLeadOptions {
  skipDelays?: boolean;
  dryRun?: boolean;
}

async function processLead(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  options?: ProcessLeadOptions
): Promise<ProcessingResult> {
  // Atomically claim this lead to prevent duplicate processing by concurrent cron runs
  const { data: claimed } = await supabase
    .from('campaign_lead_progress')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', lead.id)
    .in('status', ['pending', 'in_progress', 'waiting', 'replied'])
    .select('id')
    .maybeSingle();

  if (!claimed) {
    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'skip_already_claimed',
      success: true,
    };
  }

  // Guard: don't process leads whose next_action_at is in the future
  // (e.g. waiting at a delay node). This prevents the Fly.io worker's
  // Realtime subscription from re-dispatching leads prematurely.
  if (lead.next_action_at && new Date(lead.next_action_at) > new Date()) {
    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'skip_future_action',
      success: true,
    };
  }

  const nodes = campaign.sequence_nodes || [];
  const edges = campaign.sequence_edges || [];

  // Determine current node
  let currentNode: WorkflowNode | null = null;

  if (lead.current_node_id) {
    currentNode = findNodeById(lead.current_node_id, nodes);
  }

  // Skip leads waiting for connection acceptance — these are handled by
  // campaign-connection-checker, not the main processor.
  if (
    lead.connection_sent_at &&
    !lead.connection_accepted_at &&
    currentNode?.type === 'connectionRequest'
  ) {
    console.log(
      `[Campaign Processor] Skipping lead ${lead.id} — waiting for connection acceptance (sent at ${lead.connection_sent_at})`
    );
    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'skip_waiting_connection',
      success: true,
    };
  }

  // Honor stop_on_reply generically. unipile-webhook-handler already stamps
  // replied_at + status='replied' the moment an inbound reply lands on an
  // active lead, but 'replied' is still a claimable status above (needed so
  // leads parked at a conditionReplyReceived/conditionIntent node get
  // reclaimed to evaluate that branch) and nothing here previously checked
  // replied_at before advancing a lead through a plain message/delay node —
  // so a genuine reply only actually stopped the sequence if the sequence
  // happened to route through one of those condition nodes. Sequences that
  // don't have one just kept sending. Stop here unless the current node is
  // itself the mechanism meant to react to the reply.
  if (
    lead.replied_at &&
    campaign.stop_on_reply !== false &&
    currentNode?.type !== 'conditionReplyReceived' &&
    currentNode?.type !== 'conditionIntent'
  ) {
    console.log(`[Campaign Processor] Stopping lead ${lead.id} — contact replied and stop_on_reply is enabled`);
    await supabase
      .from('campaign_lead_progress')
      .update({
        status: 'completed',
        current_node_id: null,
        error_message: 'Stopped: contact replied (stop_on_reply enabled)',
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'stopped_on_reply',
      success: true,
    };
  }

  // If the lead had a current_node_id but the node was not found, the sequence
  // was modified and the node was deleted. Reset the lead to pending so it
  // re-enters the (new) sequence at the start node on the next tick. This
  // matches the behavior of remap_leads_on_sequence_change() and the bulk
  // reset UI — terminal-completing here silently strands leads.
  if (!currentNode && lead.current_node_id) {
    const orphanedNodeId = lead.current_node_id;
    console.log(
      `[Campaign Processor] Lead ${lead.id} was on deleted node ${orphanedNodeId} — resetting to pending (sequence modified)`
    );
    await supabase
      .from('campaign_lead_progress')
      .update({
        status: 'pending',
        current_node_id: null,
        next_action_at: new Date().toISOString(),
        error_message: null,
        retry_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'reset_orphaned',
      success: true,
    };
  }

  // If no current node and no previous node (fresh lead), start from beginning
  if (!currentNode) {
    const startNode = findStartNode(nodes);
    if (!startNode) {
      throw new Error('No start node found in workflow');
    }
    currentNode = getNextNode(startNode.id, nodes, edges);

    // Persist the resolved initial node so retries don't recalculate from scratch
    if (currentNode) {
      await supabase
        .from('campaign_lead_progress')
        .update({ current_node_id: currentNode.id, status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', lead.id);
    }
  }

  if (!currentNode) {
    // No more nodes to process - mark as completed
    await supabase
      .from('campaign_lead_progress')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', lead.id);

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'complete',
      success: true,
    };
  }

  // Assign sender if not already assigned
  // Determine primary channel for initial sender assignment
  const entrySender = campaignEntrySender(lead, lead.channel_used);
  const primaryChannel = entrySender ? lead.channel_used! : campaign.primary_channel || 'linkedin';
  let senderAccountId = lead.sender_account_id;

  // A lead's sender is only "locked in" once it has actually sent something
  // through a channel (a LinkedIn connection request or any message). Up to that
  // point the sender is fungible: a connection request can go out from any
  // connected account, so the assignment must stay DYNAMIC and be re-derived from
  // the live pool of connected senders on every run. This lets newly connected
  // senders immediately absorb the un-sent backlog, and keeps a lead off a sender
  // that has since disconnected — without a manual rebalance. The chosen sender is
  // persisted only when the send succeeds (see executeAction success path).
  const senderLockedIn = !!(entrySender || lead.connection_sent_at || lead.last_message_at);
  if (entrySender) senderAccountId = entrySender;
  if (!senderLockedIn) {
    senderAccountId = null; // ignore any stale pre-pin; re-pick from live pool below
  }

  // Collect all candidate sender IDs from campaign config and validate they exist in DB.
  // This prevents FK violations when accounts are deleted but still referenced in campaign config.
  const allCandidateIds = new Set<string>();
  const allChannels: ChannelType[] = ['linkedin', 'email', 'whatsapp', 'instagram', 'telegram', 'sms'];
  for (const ch of allChannels) {
    for (const id of getSenderAccountsForChannel(campaign, ch)) {
      allCandidateIds.add(id);
    }
  }
  if (senderAccountId) allCandidateIds.add(senderAccountId);

  let validSenderIds = new Set<string>();
  let activeSenderIds = new Set<string>();
  if (allCandidateIds.size > 0) {
    const { data: existingAccounts } = await supabase
      .from('unipile_accounts')
      .select('id, status')
      .eq('organization_id', campaign.organization_id)
      .in('id', [...allCandidateIds]);
    validSenderIds = new Set((existingAccounts || []).map((a: { id: string }) => a.id));
    activeSenderIds = new Set(
      (existingAccounts || [])
        .filter((a: { status: string }) => a.status === 'active')
        .map((a: { id: string }) => a.id)
    );
  }

  // Helper: filter sender list to only accounts that exist in DB
  const getValidSenders = (channel: ChannelType): string[] =>
    getSenderAccountsForChannel(campaign, channel).filter(id => validSenderIds.has(id));

  // Helper: filter sender list to only accounts that are connected/active.
  // Assignment and reallocation must only ever pick connected senders so a
  // disconnected account never blocks a lead when other senders are available.
  const getActiveSenders = (channel: ChannelType): string[] =>
    getSenderAccountsForChannel(campaign, channel).filter(id => activeSenderIds.has(id));

  // A received conversation belongs to its original account. Wait for recovery
  // if it is removed/disconnected instead of moving the reply to another inbox.
  if (entrySender && !getActiveSenders(primaryChannel).includes(entrySender)) {
    await supabase.from('campaign_lead_progress').update({ status: 'sender_disconnected', error_message: 'The receiving account is unavailable. Restore it to continue this inbound campaign.', updated_at: new Date().toISOString() }).eq('id', lead.id);
    return { leadId: lead.id, contactId: lead.contact_id, action: 'sender_disconnected', success: false, error: 'Receiving account is unavailable' };
  }

  // If current sender was deleted, clear it
  if (senderAccountId && !validSenderIds.has(senderAccountId)) {
    console.log(`[Campaign Processor] Lead ${lead.id}: sender ${senderAccountId} no longer exists in DB, clearing`);
    senderAccountId = null;
    await supabase
      .from('campaign_lead_progress')
      .update({ sender_account_id: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id);
  }

  // Validate assigned sender is still in the campaign's sender list AND connected.
  // If it was removed from the campaign or has disconnected, reallocate to
  // another connected sender so the lead keeps flowing instead of blocking.
  if (senderAccountId) {
    const channelSenders = getActiveSenders(primaryChannel);
    if (channelSenders.length > 0 && !channelSenders.includes(senderAccountId)) {
      console.log(`[Campaign Processor] Lead ${lead.id}: assigned sender ${senderAccountId} unavailable (removed or disconnected), reassigning`);
      const hash = lead.id.split('').reduce((h: number, c: string) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      const leadIndex = Math.abs(hash) % channelSenders.length;
      senderAccountId = selectSenderAccount(channelSenders, leadIndex);
      await supabase
        .from('campaign_lead_progress')
        .update({ sender_account_id: senderAccountId })
        .eq('id', lead.id);
    }
  }

  // Dynamic assignment for not-yet-sent leads: pick from the live pool of
  // connected senders, preferring the one with the most remaining daily capacity
  // so the backlog drains across all senders instead of piling onto one. The pick
  // is held in-memory only — it is persisted when the send actually succeeds, so
  // until then every run re-evaluates against the current pool.
  if (!senderAccountId) {
    // The capacity-relevant channel is the one the current action will send on
    // (e.g. linkedin_invitation). Fall back to hash rotation for internal nodes.
    const limitChannel = currentNode ? getChannelTypeForNode(currentNode) : null;

    const channelSenders = getActiveSenders(primaryChannel);
    if (channelSenders.length > 0) {
      senderAccountId = await pickBestSender(
        supabase, campaign.organization_id, limitChannel, channelSenders, lead.id,
      );
    }

    // Last resort: any channel with a connected sender configured.
    if (!senderAccountId) {
      for (const channel of allChannels) {
        const senders = getActiveSenders(channel);
        if (senders.length > 0) {
          senderAccountId = await pickBestSender(
            supabase, campaign.organization_id, null, senders, lead.id,
          );
          if (senderAccountId) break;
        }
      }
    }
  }

  // Only require/validate a connected sender when the lead's current node
  // actually sends through a channel. Internal steps (analyzeContact,
  // verifyEmail, sendToZapMail, conditions, etc.) must keep flowing even with
  // no connected LinkedIn/email account — otherwise they freeze as
  // `sender_disconnected` and the AI enrichment never runs. The sender is
  // re-validated at the actual send node inside executeAction.
  if (currentNode && nodeRequiresSenderAccount(currentNode)) {
    if (!senderAccountId) {
      throw new Error('No sender account available for any channel');
    }

    // Check sender account is still active before processing
    const { data: senderStatus, error: senderStatusError } = await supabase
      .from('unipile_accounts')
      .select('status')
      .eq('id', senderAccountId)
      .single();

    if (senderStatusError || !senderStatus) {
      // Sender account row missing — clear for reassignment on next run
      await supabase
        .from('campaign_lead_progress')
        .update({ sender_account_id: null, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
      return {
        leadId: lead.id,
        contactId: lead.contact_id,
        action: 'skip_sender_missing',
        success: true,
      };
    }

    if (senderStatus.status !== 'active') {
      // Reallocation to another connected sender was already attempted above;
      // reaching here means no connected sender exists for this channel.
      // Match the DB trigger's definition of "not started" exactly
      const hasNotStarted =
        lead.status === 'pending' &&
        !lead.current_node_id &&
        !lead.connection_sent_at;

      if (hasNotStarted) {
        // Lead hasn't started — clear sender for reassignment on next run
        await supabase
          .from('campaign_lead_progress')
          .update({ sender_account_id: null, updated_at: new Date().toISOString() })
          .eq('id', lead.id);

        return {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'skip_sender_inactive',
          success: true,
        };
      } else {
        // Lead already started — mark as sender_disconnected
        await supabase
          .from('campaign_lead_progress')
          .update({
            status: 'sender_disconnected',
            error_message: `Sender account is ${senderStatus.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        return {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'sender_disconnected',
          success: false,
          error: `Sender account is ${senderStatus.status}`,
        };
      }
    }
  }

  // ===========================
  // Main execution loop
  // Processes instant nodes (conditions, goTo, zero-delays) in a single pass.
  // Stops at blocking nodes (actions, non-zero delays).
  // ===========================
  const MAX_STEPS = 50;
  let stepsProcessed = 0;
  let lastResult: ProcessingResult | null = null;
  // Captures the condition + result when a lead exits via a dead-end branch
  // (a condition outcome with no outgoing edge). Used to stamp a "Filtered out"
  // reason on completion instead of leaving error_message blank.
  let filteredExit: { nodeType: string; result: string } | null = null;
  const pendingActionLogs: Array<{
    node_id: string;
    node_type: string;
    action_type: string;
    status: string;
    error_message?: string;
  }> = [];

  while (currentNode && stepsProcessed < MAX_STEPS) {
    stepsProcessed++;

    // An invite entry has already established this connection. Reuse outbound
    // graphs without attempting a second connection request.
    if (skipEntryConnectionRequest(lead, currentNode.type)) {
      pendingActionLogs.push({ node_id: currentNode.id, node_type: currentNode.type, action_type: 'connection_already_established', status: 'success' });
      currentNode = getNextNode(currentNode.id, nodes, edges);
      continue;
    }

    // --- Terminal check ---
    if (isTerminalNode(currentNode.id, nodes, edges) && currentNode.type === 'end') {
      if (pendingActionLogs.length > 0) {
        await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
        pendingActionLogs.length = 0;
      }

      await supabase
        .from('campaign_lead_progress')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', lead.id);

      lastResult = {
        leadId: lead.id,
        contactId: lead.contact_id,
        action: 'complete',
        success: true,
      };
      break;
    }

    // --- Delay node ---
    if (isDelayNode(currentNode)) {
      const delayMs = options?.skipDelays ? 0 : getDelayDuration(currentNode);

      if (delayMs > 0) {
        // BLOCKING: set future next_action_at, save state, break
        if (pendingActionLogs.length > 0) {
          await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
          pendingActionLogs.length = 0;
        }

        const nextNode = getNextNode(currentNode.id, nodes, edges);
        const nextActionAt = new Date(Date.now() + delayMs);

        await supabase
          .from('campaign_lead_progress')
          .update({
            current_node_id: nextNode?.id || null,
            next_action_at: nextActionAt.toISOString(),
            status: nextNode ? 'waiting' : 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        lastResult = {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'delay',
          success: true,
        };
        break;
      } else {
        // INSTANT: zero-delay, skip through
        pendingActionLogs.push({
          node_id: currentNode.id,
          node_type: currentNode.type,
          action_type: 'delay',
          status: 'success', // 'completed' violates campaign_action_log_status_check → row silently dropped
          error_message: 'zero-delay skipped',
        });
        currentNode = getNextNode(currentNode.id, nodes, edges);
        continue;
      }
    }

    // --- Condition node ---
    if (isConditionNode(currentNode)) {
      const waitDuration = getConditionWaitDuration(currentNode);

      const conditionResult = await evaluateCondition(
        supabase, campaign, lead, currentNode, senderAccountId, options?.dryRun === true
      );

      // A sender outage blocked a Unipile check: stay on this node and run it
      // again later rather than routing the lead down a branch it may not belong on.
      if (conditionResult === CONDITION_RETRY_LATER) {
        if (pendingActionLogs.length > 0) {
          await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
          pendingActionLogs.length = 0;
        }
        const step = FILTER_STEP_LABELS[currentNode.type] || currentNode.type;
        await supabase
          .from('campaign_lead_progress')
          .update({
            current_node_id: currentNode.id,
            status: 'waiting',
            next_action_at: new Date(Date.now() + CONDITION_RETRY_DELAY_MS).toISOString(),
            error_message: `No connected sender could run the ${step}. Retrying in an hour.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);
        lastResult = {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'waiting_at_condition',
          success: true,
        };
        break;
      }

      // Determine if this is a positive outcome
      const positiveOutcomes = new Set([
        'accepted', 'replied', 'opened', 'clicked', 'open', 'available',
        'hasWhatsapp', 'enriched', 'analyzed',
      ]);
      const isPositive = positiveOutcomes.has(conditionResult);

      // --- Time-bounded condition: wait for positive outcome within period ---
      if (waitDuration !== null && !isPositive) {
        // First time entering this condition? Record the timestamp
        if (!lead.condition_entered_at) {
          await supabase
            .from('campaign_lead_progress')
            .update({
              condition_entered_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', lead.id);
          lead.condition_entered_at = new Date().toISOString();
        }

        // Still within the waiting period? Keep waiting
        if (shouldWaitAtCondition(lead.condition_entered_at, waitDuration)) {
          if (pendingActionLogs.length > 0) {
            await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
            pendingActionLogs.length = 0;
          }

          await supabase
            .from('campaign_lead_progress')
            .update({
              current_node_id: currentNode.id, // Stay on this condition node
              status: 'waiting',
              next_action_at: new Date().toISOString(), // Re-check on next processor run
              updated_at: new Date().toISOString(),
            })
            .eq('id', lead.id);

          lastResult = {
            leadId: lead.id,
            contactId: lead.contact_id,
            action: 'waiting_at_condition',
            success: true,
          };
          break;
        }

        // Waiting period expired — fall through to route to negative branch
        console.log(
          `[Campaign Processor] Lead ${lead.id} condition timeout at ${currentNode.type} ` +
          `(${((Date.now() - new Date(lead.condition_entered_at!).getTime()) / (24 * 60 * 60 * 1000)).toFixed(1)} days)`
        );
      }

      // Reply classification pipeline: when a reply is detected, classify it
      if (currentNode.type === 'conditionReplyReceived' && conditionResult === 'replied') {
        try {
          const stopped = await processReplyClassification(supabase, campaign, lead);
          if (stopped) {
            if (pendingActionLogs.length > 0) {
              await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
            }
            lastResult = {
              leadId: lead.id,
              contactId: lead.contact_id,
              action: 'stopped_by_classification',
              success: true,
            };
            break;
          }
        } catch (classifyErr) {
          console.error(`[Campaign Processor] Reply classification error for lead ${lead.id}:`, classifyErr);
        }
      }

      pendingActionLogs.push({
        node_id: currentNode.id,
        node_type: currentNode.type,
        action_type: currentNode.type,
        // Condition nodes (verifyEmail, conditionIcpScore, …) log their outcome here.
        // Must be 'success' (not 'completed'): the campaign_action_log_status_check
        // CHECK only allows pending/success/failed/skipped, and the UI timeline marks
        // a step done on status==='success'. The verdict travels in error_message.
        status: 'success',
        error_message: `condition_result=${conditionResult}`,
      });

      // Clear condition_entered_at when advancing past a condition node
      if (lead.condition_entered_at) {
        await supabase
          .from('campaign_lead_progress')
          .update({ condition_entered_at: null, updated_at: new Date().toISOString() })
          .eq('id', lead.id);
        lead.condition_entered_at = null;
      }

      const nextAfterCondition = getNextNode(currentNode.id, nodes, edges, conditionResult);
      // No edge wired for this outcome → the lead dead-ends here. Remember where
      // and why so the completion path can stamp a "Filtered out" reason.
      if (!nextAfterCondition) {
        filteredExit = { nodeType: currentNode.type, result: conditionResult };
      }
      currentNode = nextAfterCondition;
      continue;
    }

    // --- GoTo node (ALWAYS instant) ---
    if (currentNode.type === 'goTo') {
      const targetNodeId = currentNode.data.targetNodeId as string | undefined;
      const targetNode = targetNodeId ? findNodeById(targetNodeId, nodes) : null;

      if (!targetNode) {
        if (pendingActionLogs.length > 0) {
          await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
        }
        await supabase
          .from('campaign_lead_progress')
          .update({ current_node_id: null, status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', lead.id);

        lastResult = {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'goTo',
          success: false,
          error: 'Go To target node not found',
        };
        break;
      }

      // Loop protection: count visits to target (in-memory + DB)
      const inMemoryVisits = pendingActionLogs.filter(l => l.node_id === targetNodeId).length;
      const { count: dbVisitCount } = await supabase
        .from('campaign_action_log')
        .select('*', { count: 'exact', head: true })
        .eq('progress_id', lead.id)
        .eq('node_id', targetNodeId);

      if ((dbVisitCount || 0) + inMemoryVisits >= 10) {
        if (pendingActionLogs.length > 0) {
          await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
        }
        await supabase
          .from('campaign_lead_progress')
          .update({
            current_node_id: null,
            status: 'completed',
            error_message: 'Loop limit reached (10 visits)',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        console.warn(`[Campaign Processor] Lead ${lead.id} hit loop limit (10) at Go To node ${currentNode.id} → ${targetNodeId}`);

        lastResult = {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'goTo',
          success: true,
        };
        break;
      }

      pendingActionLogs.push({
        node_id: currentNode.id,
        node_type: currentNode.type,
        action_type: 'goTo',
        status: 'success', // 'completed' violates campaign_action_log_status_check → row silently dropped
        error_message: `target=${targetNodeId}`,
      });

      currentNode = targetNode;
      continue;
    }

    // Limits and cooldowns belong to the account that will actually send this action,
    // which differs from the lead's sender on non-LinkedIn channels and for leads
    // that came in through a receiving account (same pick as executeAction).
    // SMS goes out from the org's Twilio senders (messaging_senders), so limits are
    // org-level for it and no Unipile account is involved.
    const actionSenderId = TWILIO_NODE_TYPES.has(currentNode.type)
      ? null
      : isActionNode(currentNode)
        ? pickActionSender(campaign, lead, getNodeChannel(currentNode), senderAccountId)
        : senderAccountId;

    // --- Channel limit check (before action nodes) ---
    if (!options?.dryRun && isActionNode(currentNode)) {
      const channelType = getChannelTypeForNode(currentNode);
      if (channelType) {
        const limitCheck = await checkLimits(supabase, campaign.organization_id, channelType, actionSenderId);
        if (!limitCheck.allowed) {
          console.log(`[Campaign Processor] Limit reached for lead ${lead.id}: ${limitCheck.reason}`);
          // Persist where we are so we resume from this action next time
          if (pendingActionLogs.length > 0) {
            await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
            pendingActionLogs.length = 0;
          }
          // Schedule retry on the first future day that still has capacity,
          // spreading leads evenly to prevent them all piling onto tomorrow.
          const limitRetryAt = await getNextAvailableSlot(supabase, campaign.organization_id, channelType, actionSenderId);

          await supabase
            .from('campaign_lead_progress')
            .update({
              current_node_id: currentNode.id,
              status: 'waiting',
              next_action_at: limitRetryAt.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', lead.id);

          lastResult = {
            leadId: lead.id,
            contactId: lead.contact_id,
            action: currentNode.type,
            success: true,
            limitReached: true,
          };
          break;
        }
      }
    }

    // --- Account inter-action cooldown check (before action nodes) ---
    if (!options?.dryRun && isActionNode(currentNode)) {
      const cooldownChannel = getChannelTypeForNode(currentNode);
      // No account to cool down for SMS (actionSenderId is null): Twilio senders have daily caps
      if (cooldownChannel && actionSenderId) {
        const { data: cooldown, error: cooldownError } = await supabase
          .from('account_action_cooldowns')
          .select('cooldown_until')
          .eq('account_id', actionSenderId)
          .eq('channel', cooldownChannel)
          .gt('cooldown_until', new Date().toISOString())
          .maybeSingle();

        if (cooldownError) {
          console.error(`[Campaign Processor] Cooldown check failed for account ${actionSenderId}:`, cooldownError.message);
        }

        if (cooldown) {
          console.log(`[Campaign Processor] Account ${actionSenderId} on cooldown until ${cooldown.cooldown_until} for lead ${lead.id}`);
          if (pendingActionLogs.length > 0) {
            await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
            pendingActionLogs.length = 0;
          }
          await supabase
            .from('campaign_lead_progress')
            .update({
              current_node_id: currentNode.id,
              status: 'waiting',
              next_action_at: cooldown.cooldown_until,
              updated_at: new Date().toISOString(),
            })
            .eq('id', lead.id);

          lastResult = {
            leadId: lead.id,
            contactId: lead.contact_id,
            action: currentNode.type,
            success: true,
            limitReached: true,
          };
          break;
        }
      }
    }

    // --- AI Lead Filtering (before action nodes) ---
    if (!options?.dryRun && isActionNode(currentNode) && campaign.campaign_settings) {
      const filterSettings = campaign.campaign_settings;
      const shouldFilter = filterSettings.ai_filter_unlikely_reply === 'skip' || filterSettings.ai_filter_hostile === 'skip';

      if (shouldFilter) {
        const filterResult = await aiFilterLead(supabase, campaign, lead, filterSettings);
        if (filterResult === 'skip') {
          pendingActionLogs.push({
            node_id: currentNode.id,
            node_type: currentNode.type,
            action_type: currentNode.type,
            status: 'skipped',
            error_message: 'ai_filter: skipped',
          });

          // Skip past this action and continue the loop
          currentNode = getNextNode(currentNode.id, nodes, edges);
          continue;
        }
      }
    }

    // --- Action node (BLOCKING) ---
    if (isActionNode(currentNode)) {
      // Flush accumulated instant-node logs before executing the action
      if (pendingActionLogs.length > 0) {
        await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
        pendingActionLogs.length = 0;
      }

      // A sequence can return to the receiving channel after using another one.
      // Keep that original inbox even when last_message_at/channel_used changed.
      const actionChannel = getNodeChannel(currentNode);
      const actionReceiver = campaignEntrySender(lead, actionChannel);
      if (!options?.dryRun && nodeRequiresSenderAccount(currentNode) && actionReceiver && !getActiveSenders(actionChannel as ChannelType).includes(actionReceiver)) {
        const error = 'The receiving account is unavailable. Restore it to continue this inbound campaign.';
        await supabase.from('campaign_lead_progress').update({ status: 'sender_disconnected', current_node_id: currentNode.id, error_message: error, updated_at: new Date().toISOString() }).eq('id', lead.id);
        return { leadId: lead.id, contactId: lead.contact_id, action: 'sender_disconnected', success: false, error };
      }

      const result = await executeAction(
        supabase,
        campaign,
        lead,
        currentNode,
        nodes,
        edges,
        senderAccountId,
        options?.dryRun
      );

      lastResult = {
        leadId: lead.id,
        contactId: lead.contact_id,
        action: currentNode.type,
        success: result.success,
        error: result.error,
        externalId: result.externalId,
      };
      break;
    }

    // --- Unknown node type (safety fallback) ---
    console.warn(`[Campaign Processor] Unknown node type: ${currentNode.type}, advancing to next`);
    currentNode = getNextNode(currentNode.id, nodes, edges);
  }

  // Safety limit exceeded
  if (stepsProcessed >= MAX_STEPS && !lastResult) {
    console.error(`[Campaign Processor] Lead ${lead.id} exceeded MAX_STEPS (${MAX_STEPS})`);

    if (pendingActionLogs.length > 0) {
      await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
    }

    await supabase
      .from('campaign_lead_progress')
      .update({
        status: 'failed',
        error_message: `Max processing steps exceeded (${MAX_STEPS})`,
        current_node_id: currentNode?.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'max_steps_exceeded',
      success: false,
      error: `Max processing steps exceeded (${MAX_STEPS})`,
    };
  }

  // Loop exited with no current node (ran off the end of the graph)
  if (!currentNode && !lastResult) {
    if (pendingActionLogs.length > 0) {
      await flushActionLogs(supabase, campaign, lead, pendingActionLogs);
    }

    // If we ran off the end because a condition outcome had no wired branch,
    // record why so the UI can distinguish a filtered-out lead from one that
    // genuinely finished the sequence. A clean run-off (e.g. after the last
    // action node) leaves error_message untouched.
    const completionUpdate: Record<string, unknown> = {
      status: 'completed',
      current_node_id: null,
      updated_at: new Date().toISOString(),
    };
    if (filteredExit) {
      completionUpdate.error_message = describeFilteredExit(filteredExit.nodeType, filteredExit.result);
    }

    await supabase
      .from('campaign_lead_progress')
      .update(completionUpdate)
      .eq('id', lead.id);

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: filteredExit ? 'filtered_out' : 'complete',
      success: true,
    };
  }

  return lastResult || {
    leadId: lead.id,
    contactId: lead.contact_id,
    action: 'no_op',
    success: true,
  };
}

// ============================================================================
// Batch Action Log Flushing
// ============================================================================

/**
 * Batch-insert action logs accumulated during the execution loop.
 * Reduces DB round-trips for instant nodes (conditions, goTo, zero-delays).
 */
async function flushActionLogs(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  logs: Array<{
    node_id: string;
    node_type: string;
    action_type: string;
    status: string;
    error_message?: string;
  }>
): Promise<void> {
  if (logs.length === 0) return;

  const rows = logs.map(log => ({
    campaign_id: campaign.id,
    progress_id: lead.id,
    contact_id: lead.contact_id,
    node_id: log.node_id,
    node_type: log.node_type,
    action_type: log.action_type,
    status: log.status,
    error_message: log.error_message || null,
    executed_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('campaign_action_log').insert(rows);
  if (error) {
    console.error(`[Campaign Processor] Failed to batch-insert ${rows.length} action logs:`, error.message);
  }
}

// ============================================================================
// Condition Evaluation
// ============================================================================

async function evaluateCondition(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
  senderAccountId: string | null,
  dryRun = false,
): Promise<string> {
  const checks = () => channelCheckContext(supabase, campaign, lead, senderAccountId, dryRun);
  switch (node.type) {
    case 'conditionConnection':
      return evaluateConditionConnection(lead);
    case 'conditionOpenProfile':
      return evaluateConditionOpenProfile(supabase, campaign, lead);
    case 'conditionChannelAvailable':
      return evaluateConditionChannelAvailable(checks(), node);
    case 'routeByChannel':
      return evaluateRouteByChannel(checks(), node);
    case 'conditionReplyReceived':
      return evaluateConditionReplyReceived(supabase, campaign, lead, node);
    case 'conditionIntent':
      return evaluateConditionIntent(supabase, campaign, lead, node);
    case 'whatsappCheckNumber':
      return evaluateWhatsAppCheckNumber(checks());
    case 'switchChannel':
      return executeSwitchChannel(supabase, lead, node);
    case 'conditionEmailOpened':
      return evaluateConditionEmailOpened(supabase, campaign, lead, node);
    case 'conditionEmailClicked':
      return evaluateConditionEmailClicked(supabase, campaign, lead, node);
    case 'conditionEnriched':
      return evaluateConditionEnriched(supabase, lead);
    case 'conditionAnalyzed':
      return evaluateConditionAnalyzed(supabase, campaign, lead);
    case 'conditionIcpScore':
      return evaluateConditionIcpScore(supabase, campaign, lead, node);
    case 'verifyEmail':
      return evaluateVerifyEmail(supabase, campaign, lead, node);
    default:
      console.log(`[Campaign Processor] Unknown condition type: ${node.type}, using default edge`);
      return 'default';
  }
}

// ============================================================================
// Filtered-out (dead-end) exit messaging
// ============================================================================
// When a condition/check produces a result whose branch has no outgoing edge,
// the lead runs off the end of the graph and completes WITHOUT taking any
// action (e.g. an email that verifies "risky" when only the "clean" branch is
// wired). That's intentional filtering, but it used to be indistinguishable
// from a lead that ran the whole sequence. We stamp a human-readable reason so
// the UI can show a distinct "Filtered" state instead of a plain "Completed".

const FILTER_STEP_LABELS: Record<string, string> = {
  verifyEmail: 'Verify Email',
  conditionIcpScore: 'ICP Score check',
  conditionConnection: 'Connection check',
  conditionOpenProfile: 'Open Profile check',
  conditionChannelAvailable: 'Channel availability check',
  routeByChannel: 'Route by Channel',
  conditionReplyReceived: 'Reply check',
  conditionIntent: 'Reply-intent check',
  conditionEmailOpened: 'Email-opened check',
  conditionEmailClicked: 'Link-clicked check',
  conditionEnriched: 'Enrichment check',
  conditionAnalyzed: 'Analysis check',
  whatsappCheckNumber: 'WhatsApp number check',
  switchChannel: 'Channel switch',
};

const FILTER_RESULT_LABELS: Record<string, string> = {
  risky: 'email came back risky (catch-all / unknown)',
  failed: 'email is invalid',
  fail: 'score below threshold',
  notAccepted: 'connection not accepted',
  notReplied: 'no reply received',
  notOpened: 'email not opened',
  notClicked: 'link not clicked',
  noWhatsapp: 'no WhatsApp account',
  notEnriched: 'could not be enriched',
  notAnalyzed: 'could not be analysed',
  unavailable: 'channel unavailable',
  notAvailable: 'channel unavailable',
  [ROUTE_NONE]: 'no listed channel can reach this lead',
};

/**
 * Build the message stamped on a lead that exits the sequence via a dead-end
 * condition branch. The UI keys off the "Filtered out at " prefix to render a
 * distinct "Filtered" state. Keep that prefix in sync with the frontend
 * isFilteredOut() helper in src/lib/sequence-utils.ts.
 */
function describeFilteredExit(nodeType: string, result: string): string {
  const step = FILTER_STEP_LABELS[nodeType] || nodeType;
  const reason = FILTER_RESULT_LABELS[result] || `result "${result}"`;
  return `Filtered out at ${step} — ${reason}; no path is configured for this outcome.`;
}

/**
 * Check if the connection was accepted.
 * Returns 'accepted' or 'notAccepted' (camelCase to match frontend handle IDs).
 */
function evaluateConditionConnection(lead: LeadProgress): string {
  return lead.connection_accepted_at ? 'accepted' : 'notAccepted';
}

/**
 * Check if the contact's LinkedIn profile is an Open Profile (accepts InMail from anyone).
 * Returns 'open' or 'closed' to match frontend handle IDs.
 */
async function evaluateConditionOpenProfile(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
): Promise<string> {
  const { data } = await supabase
    .from('campaign_action_log')
    .select('id')
    .eq('campaign_id', campaign.id)
    .eq('progress_id', lead.id)
    .eq('action_type', 'viewProfile')
    .eq('status', 'success')
    .limit(1);

  return data && data.length > 0 ? 'open' : 'closed';
}

// ============================================================================
// Channel checks: "If Channel Available" and "Route by Channel"
// ============================================================================
// Presence checks read what the send steps use (see _shared/contact-checks.ts).
// The Unipile checks go through one of the campaign's connected senders on
// that channel. Test runs (dryRun) make no Unipile calls and answer from the
// stored data.

/**
 * Returned by a condition when a sender outage blocked a Unipile check. The lead
 * stays on the node and runs it again later instead of taking a branch it may
 * not belong on.
 */
const CONDITION_RETRY_LATER = '__retry_later__';
const CONDITION_RETRY_DELAY_MS = 60 * 60 * 1000;

interface ChannelCheckContext {
  supabase: SupabaseClient<any>;
  campaign: Campaign;
  lead: LeadProgress;
  senderAccountId: string | null;
  dryRun: boolean;
  // Loaded once per evaluation and shared by every check the node runs.
  contact?: { isLinkedinConnection: boolean; reach: ContactReach };
  /** Mobile number for SMS, looked up only by checks that need it (undefined = not loaded). */
  smsPhone?: string | null;
  senders: Map<string, { configured: number; active: string[] }>;
}

interface CheckSender {
  id: string;
  unipileAccountId: string;
  // Set for v2 senders; v1 senders use apiKey + dsnUrl.
  v2: UnipileV2Client | null;
  apiKey: string | null;
  dsnUrl: string | null;
}

type ProfileLookup =
  | { status: 'found'; profile: Record<string, unknown> }
  | { status: 'notFound' }
  | { status: 'senderDown' };

function channelCheckContext(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  senderAccountId: string | null,
  dryRun: boolean,
): ChannelCheckContext {
  return { supabase, campaign, lead, senderAccountId, dryRun, senders: new Map() };
}

async function loadCheckContact(ctx: ChannelCheckContext) {
  if (ctx.contact) return ctx.contact;
  const [{ data: contact }, { data: identities }] = await Promise.all([
    ctx.supabase
      .from('crm_contacts')
      .select('email, linkedin_url, phone, instagram_url, custom_fields, is_linkedin_connection')
      .eq('id', ctx.lead.contact_id)
      .maybeSingle(),
    ctx.supabase
      .from('crm_contact_identities')
      .select('channel, platform_user_id, platform_username, platform_profile_url')
      .eq('contact_id', ctx.lead.contact_id),
  ]);
  ctx.contact = {
    isLinkedinConnection: contact?.is_linkedin_connection === true,
    reach: contactReach(contact ?? {}, identities ?? []),
  };
  return ctx.contact;
}

/** The lead's SMS-capable number (normalised into crm_contact_phones on first use). */
async function loadSmsPhone(ctx: ChannelCheckContext): Promise<string | null> {
  if (ctx.smsPhone !== undefined) return ctx.smsPhone;
  const { data: contact } = await ctx.supabase
    .from('crm_contacts')
    .select('id, organization_id, primary_phone, phone, country, company_id')
    .eq('id', ctx.lead.contact_id)
    .maybeSingle();
  ctx.smsPhone = contact ? smsReachablePhone(await resolveContactPhone(ctx.supabase, contact)) : null;
  return ctx.smsPhone;
}

/**
 * The campaign's senders on `channel` (the lead's own sender first) and which of
 * them are connected. `configured: 0` means the campaign cannot use the channel at
 * all; configured but none active is an outage worth waiting out.
 */
async function channelSenders(ctx: ChannelCheckContext, channel: RouteChannel) {
  const cached = ctx.senders.get(channel);
  if (cached) return cached;

  const configured = getSenderAccountsForChannel(ctx.campaign, channel);
  const preferred = pickActionSender(ctx.campaign, ctx.lead, channel, ctx.senderAccountId);
  // pickActionSender falls back to the lead's LinkedIn sender, so only trust it
  // for LinkedIn, a configured sender, or the account an inbound lead arrived on.
  const preferredFits = !!preferred && (
    channel === 'linkedin' || configured.includes(preferred) || preferred === campaignEntrySender(ctx.lead, channel)
  );
  const candidates = [...new Set([...(preferredFits ? [preferred!] : []), ...configured])];

  let active: string[] = [];
  if (candidates.length > 0) {
    const { data } = await ctx.supabase
      .from('unipile_accounts')
      .select('id')
      .eq('organization_id', ctx.campaign.organization_id)
      .eq('status', 'active')
      .in('id', candidates);
    const activeIds = new Set((data ?? []).map((a: { id: string }) => a.id));
    active = candidates.filter((id) => activeIds.has(id));
  }

  const result = { configured: candidates.length, active };
  ctx.senders.set(channel, result);
  return result;
}

async function openCheckSender(ctx: ChannelCheckContext, accountId: string): Promise<CheckSender | null> {
  const { data: account } = await ctx.supabase
    .from('unipile_accounts')
    .select('id, unipile_account_id, access_token_encrypted, dsn_url, api_version')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) return null;

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  if (account.api_version === 'v2') {
    return {
      id: account.id,
      unipileAccountId: account.unipile_account_id,
      v2: new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) }),
      apiKey: null,
      dsnUrl: null,
    };
  }
  return {
    id: account.id,
    unipileAccountId: account.unipile_account_id,
    v2: null,
    apiKey: await decryptApiKey(account.access_token_encrypted, encryptionKey),
    dsnUrl: normalizeDsnUrl(account.dsn_url),
  };
}

/** A Unipile user profile, read through one sender (v1 or v2). */
async function lookupUnipileProfile(
  ctx: ChannelCheckContext,
  sender: CheckSender,
  identifier: string,
): Promise<ProfileLookup> {
  try {
    if (sender.v2) {
      const profile = await sender.v2.get<Record<string, unknown>>(
        accountPath(sender.unipileAccountId, `/users/${encodeURIComponent(identifier)}`),
      );
      return { status: 'found', profile };
    }

    const response = await fetch(
      `${sender.dsnUrl}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${sender.unipileAccountId}&notify=false`,
      { headers: { 'X-API-KEY': sender.apiKey!, 'Accept': 'application/json' } },
    );
    if (response.ok) return { status: 'found', profile: await response.json() };
    const errorText = await response.text();
    if (response.status === 401 || isDisconnectedAccountError(errorText)) {
      await markAccountDisconnectedFromSendError(ctx.supabase, sender.id, errorText);
      return { status: 'senderDown' };
    }
    if (response.status === 429 || response.status >= 500) return { status: 'senderDown' };
    return { status: 'notFound' };
  } catch (error) {
    if (isUnipileApiError(error)) {
      if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR') return { status: 'notFound' };
      if (error.code === 'DISCONNECTED_ACCOUNT') {
        await markAccountDisconnectedFromSendError(ctx.supabase, sender.id, linkedinV2.v2ErrorString(error));
      }
    }
    console.error(`[Campaign Processor] Profile lookup for ${identifier} via ${sender.id} failed:`, error);
    return { status: 'senderDown' };
  }
}

async function checkSenderConnected(ctx: ChannelCheckContext, channel: unknown): Promise<CheckOutcome> {
  if (!UNIPILE_SENDER_CHANNELS.includes(channel as RouteChannel)) return 'no';
  const senders = await channelSenders(ctx, channel as RouteChannel);
  return senders.active.length > 0 ? 'yes' : 'no';
}

/** The LinkedIn URL resolves to a profile. Saves the identity, so later steps skip the lookup. */
async function checkLinkedInFound(ctx: ChannelCheckContext): Promise<CheckOutcome> {
  const { reach } = await loadCheckContact(ctx);
  if (reach.linkedinId) return 'yes';
  if (!reach.linkedinUrl) return 'no';
  if (ctx.dryRun) return 'yes';

  const senders = await channelSenders(ctx, 'linkedin');
  if (senders.configured === 0) return 'no';
  if (senders.active.length === 0) return 'retry';

  const resolution = await resolveLinkedInIdentity(
    ctx.supabase,
    ctx.campaign.organization_id,
    ctx.lead.contact_id,
    reach.linkedinUrl,
    senders.active[0],
    ctx.campaign,
  );
  if (resolution.identity) {
    reach.linkedinId = resolution.identity.platform_user_id;
    return 'yes';
  }
  return resolution.senderOutage ? 'retry' : 'no';
}

/** The lead is a 1st-degree connection of the LinkedIn sender that would message them. */
async function checkLinkedInConnected(ctx: ChannelCheckContext): Promise<CheckOutcome> {
  if (ctx.lead.connection_accepted_at) return 'yes';
  const contact = await loadCheckContact(ctx);
  if (ctx.dryRun) return contact.isLinkedinConnection ? 'yes' : 'no';

  const found = await checkLinkedInFound(ctx);
  if (found !== 'yes') return found;

  const senders = await channelSenders(ctx, 'linkedin');
  if (senders.active.length === 0) return senders.configured === 0 ? 'no' : 'retry';
  const sender = await openCheckSender(ctx, senders.active[0]);
  if (!sender) return 'retry';

  const lookup = await lookupUnipileProfile(ctx, sender, contact.reach.linkedinId!);
  if (lookup.status === 'senderDown') return 'retry';
  if (lookup.status === 'notFound') return 'no';
  // v2 nests it under specifics; v1 has it at the top level.
  const specifics = lookup.profile.specifics as Record<string, unknown> | undefined;
  const distance = String(specifics?.network_distance ?? lookup.profile.network_distance ?? '');
  return ['FIRST_DEGREE', 'DISTANCE_1'].includes(distance) ? 'yes' : 'no';
}

/** The lead's WhatsApp id (stored, or built from a phone with a country code) is on WhatsApp. */
async function checkWhatsAppRegistered(ctx: ChannelCheckContext): Promise<CheckOutcome> {
  const { reach } = await loadCheckContact(ctx);
  if (!reach.whatsappId) return 'no';
  if (ctx.dryRun) return 'yes';

  const senders = await channelSenders(ctx, 'whatsapp');
  if (senders.configured === 0) return 'no';
  if (senders.active.length === 0) return 'retry';
  const sender = await openCheckSender(ctx, senders.active[0]);
  if (!sender) return 'retry';

  if (sender.v2) {
    // v2 answers 404 for a number that is not on WhatsApp.
    const lookup = await lookupUnipileProfile(ctx, sender, reach.whatsappId);
    return lookup.status === 'found' ? 'yes' : lookup.status === 'notFound' ? 'no' : 'retry';
  }

  // v1: a dry-run chat start only succeeds for numbers on WhatsApp.
  try {
    const response = await fetch(`${sender.dsnUrl}/api/v1/chats`, {
      method: 'POST',
      headers: { 'X-API-KEY': sender.apiKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: sender.unipileAccountId,
        attendees_ids: [reach.whatsappId],
        dry_run: true,
      }),
    });
    if (response.ok) return 'yes';
    const errorText = await response.text();
    if (response.status === 401 || isDisconnectedAccountError(errorText)) {
      await markAccountDisconnectedFromSendError(ctx.supabase, sender.id, errorText);
      return 'retry';
    }
    return 'no';
  } catch (error) {
    console.error(`[Campaign Processor] WhatsApp check failed:`, error);
    return 'retry';
  }
}

/**
 * The lead's Instagram handle resolves to a profile we can message. Saves the
 * identity the Instagram DM step sends to.
 *
 * Unverified against a live account: Unipile does not document looking up an
 * Instagram user by username (docs/planning/unipile-v2-reference.md 5.3).
 */
async function checkInstagramFound(ctx: ChannelCheckContext): Promise<CheckOutcome> {
  const { reach } = await loadCheckContact(ctx);
  if (reach.instagramId) return 'yes';
  if (!reach.instagramHandle) return 'no';
  if (ctx.dryRun) return 'yes';

  const senders = await channelSenders(ctx, 'instagram');
  if (senders.configured === 0) return 'no';
  if (senders.active.length === 0) return 'retry';
  const sender = await openCheckSender(ctx, senders.active[0]);
  if (!sender) return 'retry';

  const lookup = await lookupUnipileProfile(ctx, sender, reach.instagramHandle);
  if (lookup.status !== 'found') return lookup.status === 'notFound' ? 'no' : 'retry';

  // v2 messages Instagram users by specifics.messaging_identifier, not the profile id.
  const { profile } = lookup;
  const specifics = profile.specifics as Record<string, unknown> | undefined;
  const messagingId = sender.v2
    ? specifics?.messaging_identifier
    : profile.provider_messaging_id || profile.provider_id;
  if (typeof messagingId !== 'string' || !messagingId) return 'no';

  const { error } = await ctx.supabase.from('crm_contact_identities').insert({
    organization_id: ctx.campaign.organization_id,
    contact_id: ctx.lead.contact_id,
    channel: 'instagram',
    platform_user_id: messagingId,
    platform_username: reach.instagramHandle,
    platform_profile_url: `https://www.instagram.com/${reach.instagramHandle}/`,
    platform_metadata: { resolved_at: new Date().toISOString(), resolved_by: 'campaign_processor' },
    is_primary: true,
  });
  if (error && error.code !== '23505') {
    console.error(`[Campaign Processor] Failed to save Instagram identity for contact ${ctx.lead.contact_id}: ${error.message}`);
  }
  reach.instagramId = messagingId;
  return 'yes';
}

async function runContactCheck(
  ctx: ChannelCheckContext,
  check: ContactCheck,
  data: Record<string, unknown>,
): Promise<CheckOutcome> {
  const present = async (on: RouteChannel): Promise<CheckOutcome> =>
    reachableOn((await loadCheckContact(ctx)).reach, on) ? 'yes' : 'no';

  switch (check) {
    case 'linkedinUrl':
      return present('linkedin');
    case 'email':
      return present('email');
    case 'instagram':
      return present('instagram');
    case 'telegram':
      return present('telegram');
    case 'phone': {
      const { reach } = await loadCheckContact(ctx);
      return reach.phone || reach.whatsappId ? 'yes' : 'no';
    }
    case 'smsMobile':
      return (await loadSmsPhone(ctx)) ? 'yes' : 'no';
    case 'linkedinOnUnipile':
      return checkLinkedInFound(ctx);
    case 'linkedinConnected':
      return checkLinkedInConnected(ctx);
    case 'instagramOnUnipile':
      return checkInstagramFound(ctx);
    case 'whatsappRegistered':
      return checkWhatsAppRegistered(ctx);
    case 'senderConnected':
      return checkSenderConnected(ctx, data.channel);
    // How a campaign trigger brought the lead in (entry_context is null otherwise).
    case 'enteredViaTrigger':
      return enteredViaTrigger(ctx.lead.entry_context, data.triggerId) ? 'yes' : 'no';
    case 'enteredOnChannel':
      return entryChannel(ctx.lead.entry_context) === data.channel ? 'yes' : 'no';
  }
}

/** "If Channel Available": one check from node.data.check, Available / Not available. */
async function evaluateConditionChannelAvailable(ctx: ChannelCheckContext, node: WorkflowNode): Promise<string> {
  const check = resolveContactCheck(node.data);
  let outcome: CheckOutcome;
  if (check) {
    outcome = await runContactCheck(ctx, check, node.data);
  } else {
    // A channel with no dedicated check (messenger, twitter): any identity on it counts.
    const { data } = await ctx.supabase
      .from('crm_contact_identities')
      .select('id')
      .eq('contact_id', ctx.lead.contact_id)
      .eq('channel', node.data.channel as string)
      .limit(1);
    outcome = data && data.length > 0 ? 'yes' : 'no';
  }
  if (outcome === 'retry') return CONDITION_RETRY_LATER;
  return outcome === 'yes' ? 'available' : 'notAvailable';
}

/**
 * "Route by Channel": the lead goes down the first channel in the node's order
 * it can be reached on, else 'none'. With entryChannelFirst, a lead a trigger
 * brought in tries the channel it reached out on first. With requireSender (default on) a Unipile
 * channel is skipped when the campaign has no sender on it, and the lead waits
 * when that sender is disconnected. With verifyOnUnipile, LinkedIn, Instagram
 * and WhatsApp are confirmed on Unipile instead of trusting the stored URL,
 * handle or number.
 */
async function evaluateRouteByChannel(ctx: ChannelCheckContext, node: WorkflowNode): Promise<string> {
  const requireSender = node.data.requireSender !== false;
  const verify = node.data.verifyOnUnipile === true;

  for (const channel of routeOrder(node.data, ctx.lead.entry_context)) {
    const usesSender = requireSender && UNIPILE_SENDER_CHANNELS.includes(channel);
    if (usesSender && (await channelSenders(ctx, channel)).configured === 0) continue;
    // SMS sends from the org's Twilio senders, not the campaign's Unipile accounts
    if (channel === 'sms' && requireSender && !(await hasActiveSmsSender(ctx.supabase, ctx.campaign.organization_id))) continue;

    let outcome: CheckOutcome;
    if (verify && channel === 'linkedin') outcome = await checkLinkedInFound(ctx);
    else if (verify && channel === 'instagram') outcome = await checkInstagramFound(ctx);
    else if (verify && channel === 'whatsapp') outcome = await checkWhatsAppRegistered(ctx);
    else if (channel === 'sms') outcome = (await loadSmsPhone(ctx)) ? 'yes' : 'no';
    else outcome = reachableOn((await loadCheckContact(ctx)).reach, channel) ? 'yes' : 'no';

    if (outcome === 'yes' && usesSender && (await channelSenders(ctx, channel)).active.length === 0) {
      outcome = 'retry';
    }
    // An outage on a higher-priority channel must not push the lead down a lower one.
    if (outcome === 'retry') return CONDITION_RETRY_LATER;
    if (outcome === 'yes') return channel;
  }
  return ROUTE_NONE;
}

/**
 * Check if a reply was received within a given timeframe.
 * node.data.withinDays specifies the lookback window (default: 7 days).
 */
async function evaluateConditionReplyReceived(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  const withinDays = (node.data.withinDays as number) || 7;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('campaign_action_log')
    .select('id')
    .eq('campaign_id', campaign.id)
    .eq('progress_id', lead.id)
    .eq('action_type', 'reply_detected')
    .gte('executed_at', cutoff)
    .limit(1);

  return data && data.length > 0 ? 'replied' : 'noReply';
}

/**
 * Resolve the CRM conversation id for a lead. Prefers the conversation already
 * linked on the lead (set when we created an outbound CRM record), otherwise
 * falls back to the most recently active conversation for the contact in this org.
 */
async function resolveLeadConversationId(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
): Promise<string | null> {
  if (lead.crm_conversation_id) return lead.crm_conversation_id;

  const { data } = await supabase
    .from('crm_conversations')
    .select('id')
    .eq('organization_id', campaign.organization_id)
    .eq('contact_id', lead.contact_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * LLM-powered intent branch. Classifies the lead's most recent inbound reply
 * (within node.data.withinDays) using the shared reply-classifier and routes
 * down the matching branch handle. No reply in the window → 'no_reply'.
 *
 * Branch handles map 1:1 to LeadIntent, except unsubscribe/do_not_contact which
 * collapse into 'not_interested' (the node doesn't expose those branches).
 */
async function evaluateConditionIntent(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  const withinDays = (node.data.withinDays as number) || 14;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();

  const conversationId = await resolveLeadConversationId(supabase, campaign, lead);
  if (!conversationId) return 'no_reply';

  const { data: msg } = await supabase
    .from('crm_messages')
    .select('content, email_subject, email_from, created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!msg || !((msg.content as string | null) || '').trim()) return 'no_reply';

  const openRouterKey = await getOrgOpenRouterKey(supabase, campaign.organization_id);
  if (!openRouterKey) {
    // No key → can't classify. Treat as neutral so the lead isn't silently dropped
    // (a neutral branch is the safest "we got a reply but couldn't read it" default).
    console.warn(`[Campaign Processor] conditionIntent: no OpenRouter key for org ${campaign.organization_id}, defaulting to neutral`);
    return 'neutral';
  }

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('default_llm_model')
    .eq('organization_id', campaign.organization_id)
    .maybeSingle();
  const model = (node.data.model as string | undefined) || orgSettings?.default_llm_model || undefined;

  let classification: ClassificationResult;
  try {
    classification = await classifyReply(
      {
        from_email: (msg.email_from as string | null) || '',
        subject: (msg.email_subject as string | null) || '',
        body_text: (msg.content as string | null) || '',
      },
      openRouterKey,
      model,
    );
  } catch (err) {
    console.error(`[Campaign Processor] conditionIntent classify failed: ${err instanceof Error ? err.message : err}`);
    return 'neutral';
  }

  // Collapse intents that have no dedicated branch on the node.
  const intent = classification.intent;
  const handle = (intent === 'unsubscribe' || intent === 'do_not_contact')
    ? 'not_interested'
    : intent;

  console.log(`[Campaign Processor] conditionIntent for lead ${lead.id}: ${intent} → ${handle} (conf ${classification.confidence.toFixed(2)})`);
  return handle;
}

/**
 * "Check WhatsApp": is the lead's number registered on WhatsApp?
 * Same lookup as the If Channel Available "On WhatsApp" check.
 */
async function evaluateWhatsAppCheckNumber(ctx: ChannelCheckContext): Promise<string> {
  const outcome = await checkWhatsAppRegistered(ctx);
  if (outcome === 'retry') return CONDITION_RETRY_LATER;
  return outcome === 'yes' ? 'hasWhatsapp' : 'noWhatsapp';
}

/**
 * Switch the lead's active channel.
 * Updates channel_used on campaign_lead_progress and always takes the default edge.
 */
async function executeSwitchChannel(
  supabase: SupabaseClient<any>,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  const targetChannel = (node.data.targetChannel as string) || 'email';

  await supabase
    .from('campaign_lead_progress')
    .update({
      channel_used: targetChannel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  console.log(`[Campaign Processor] Switched channel for lead ${lead.id} to ${targetChannel}`);
  return 'default';
}

/**
 * Check if the email was opened.
 * Queries campaign_action_log for email_opened events within the configured timeframe.
 */
async function evaluateConditionEmailOpened(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  const withinDays = (node.data.withinDays as number) || 7;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('campaign_action_log')
    .select('id')
    .eq('campaign_id', campaign.id)
    .eq('progress_id', lead.id)
    .eq('action_type', 'email_opened')
    .gte('executed_at', cutoff)
    .limit(1);

  return data && data.length > 0 ? 'opened' : 'notOpened';
}

/**
 * Check if a link in the email was clicked.
 * Queries campaign_action_log for email_clicked events within the configured timeframe.
 */
async function evaluateConditionEmailClicked(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  const withinDays = (node.data.withinDays as number) || 7;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('campaign_action_log')
    .select('id')
    .eq('campaign_id', campaign.id)
    .eq('progress_id', lead.id)
    .eq('action_type', 'email_clicked')
    .gte('executed_at', cutoff)
    .limit(1);

  return data && data.length > 0 ? 'clicked' : 'notClicked';
}

/**
 * Check if the contact has AI enrichment data.
 * Returns 'enriched' if enrichment_data has meaningful content, 'notEnriched' otherwise.
 */
async function evaluateConditionEnriched(
  supabase: SupabaseClient<any>,
  lead: LeadProgress,
): Promise<string> {
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('enrichment_data')
    .eq('id', lead.contact_id)
    .single();

  const enrichment = contact?.enrichment_data;
  const hasData = enrichment && (enrichment.primary_need || enrichment.company_niche);
  return hasData ? 'enriched' : 'notEnriched';
}

/**
 * Check if the analyzeContact action was executed successfully for this lead in this campaign.
 * Returns 'analyzed' or 'notAnalyzed'.
 */
async function evaluateConditionAnalyzed(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
): Promise<string> {
  const { data } = await supabase
    .from('campaign_action_log')
    .select('id')
    .eq('campaign_id', campaign.id)
    .eq('progress_id', lead.id)
    .eq('action_type', 'analyzeContact')
    .eq('status', 'success')
    .limit(1);

  return data && data.length > 0 ? 'analyzed' : 'notAnalyzed';
}

/**
 * Branch on whether the contact's ICP fit score meets the node's threshold.
 * Product comes from node.data.productId, falling back to the campaign's
 * icp_product_id. Returns 'pass' or 'fail'.
 */
async function evaluateConditionIcpScore(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  // Product resolution, most-specific first:
  //   1. the node's own productId
  //   2. the campaign-level icp_product_id
  //   3. the product from an Analyze Contact step in the same sequence
  // (3) is the load-bearing fallback: builders routinely set the product on the
  // Analyze Contact node but leave it blank on the ICP condition. Without it the
  // gate "failed closed" and routed EVERY lead — including ones just scored ≥
  // threshold — to the fail branch, silently filtering out whole campaigns.
  const analyzeProductId = (campaign.sequence_nodes || [])
    .find((n) => n.type === 'analyzeContact' && !!(n.data?.productId as string | undefined))
    ?.data?.productId as string | undefined;
  const productId = (node.data.productId as string | undefined)
    || campaign.icp_product_id
    || analyzeProductId;
  const minScore = (node.data.minScore as number | undefined) ?? 50;
  const scoreType = (node.data.scoreType as string | undefined) || 'icp';
  const scoreColumn = scoreType === 'dm' ? 'decision_maker_score' : 'icp_score';

  if (!productId) {
    console.log(`[Campaign Processor] conditionIcpScore: no product set (node, campaign, or analyzeContact step) — failing closed`);
    return 'fail';
  }

  const { data } = await supabase
    .from('contact_product_scores')
    .select(scoreColumn)
    .eq('contact_id', lead.contact_id)
    .eq('product_id', productId)
    .maybeSingle();

  const score = ((data as Record<string, number | null> | null)?.[scoreColumn]) ?? null;
  // No score yet → fail (lead hasn't been scored; route to the fail branch,
  // where the flow can score it or end). Avoids silently passing unscored leads.
  if (score === null) return 'fail';
  return score >= minScore ? 'pass' : 'fail';
}

/**
 * Verify the contact's email inline and branch on the result.
 * Maps the canonical verification status to clean / risky / failed handles.
 * Uses the org's configured verifier (verifyEmailAddress caches + persists,
 * and the email_address_verifications trigger mirrors to crm_contacts).
 */
async function evaluateVerifyEmail(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<string> {
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('primary_email')
    .eq('id', lead.contact_id)
    .single();

  const email = contact?.primary_email as string | null;
  if (!email) return 'failed';

  // Always delegate to verifyEmailAddress, which has its own 30-day cache (keyed
  // on email + expires_at). We deliberately do NOT trust crm_contacts'
  // email_verification_status/email_verified_at directly: those carry months-old
  // 'valid' results from list import with NO freshness check, so the old skip
  // path let stale-but-now-invalid emails bypass verification and reach handoff.
  // skipIfAlreadyVerified=false forces a fresh check; otherwise the verifier's
  // cache satisfies "already verified" cheaply and re-verifies anything expired.
  const forceRefresh = node.data.skipIfAlreadyVerified === false;
  let status: string | null;
  try {
    const result = await verifyEmailAddress(supabase, campaign.organization_id, email, { forceRefresh });
    status = result.status;
  } catch (e) {
    console.warn(`[Campaign Processor] verifyEmail failed for ${email}: ${e instanceof Error ? e.message : e}`);
    // Couldn't verify — route to risky so the flow can decide, rather than drop.
    return 'risky';
  }

  // Map canonical status → branch handle.
  if (status === 'valid') return 'clean';
  if (status === 'invalid' || status === 'disposable' || status === 'spamtrap') return 'failed';
  // catch_all, role, unknown, risky, or anything else
  return 'risky';
}

// ============================================================================
// Action Execution
// ============================================================================

/** Steps that send from the org's Twilio senders (messaging_senders) instead of a Unipile account. */
const TWILIO_NODE_TYPES = new Set(['smsMessage', 'whatsappTemplate']);

type TwilioOutcome =
  | { kind: 'sent'; sid: string; to: string; body: string }
  | { kind: 'skip'; reason: string }
  | { kind: 'defer'; reason: string; retryAt: Date }
  | { kind: 'fail'; reason: string };

/**
 * Turn a Twilio step's outcome into the action result, or settle the lead here:
 *  - defer (outside sending hours, senders at their cap, template awaiting Meta):
 *    wait on this node without spending a retry
 *  - skip (no mobile, opted out, no sender for the country): retrying won't help,
 *    so the lead is skipped unless the step continues on failure
 *  - fail: regular retry with backoff
 */
async function applyTwilioOutcome(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
  outcome: TwilioOutcome,
): Promise<{ result: ActionResult; body?: string } | { early: ActionResult }> {
  const channel = node.type === 'smsMessage' ? 'sms' : 'whatsapp';
  if (outcome.kind === 'sent') {
    // externalId becomes the thread's external id: the phone number, not the message
    return { result: { success: true, externalId: outcome.to, messageId: outcome.sid }, body: outcome.body };
  }
  if (outcome.kind === 'defer') {
    await supabase
      .from('campaign_lead_progress')
      .update({
        status: 'waiting',
        current_node_id: node.id,
        next_action_at: outcome.retryAt.toISOString(),
        error_message: outcome.reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);
    return { early: { success: false, error: outcome.reason } };
  }
  if (outcome.kind === 'skip' && !node.data.continueOnFailure) {
    await supabase.from('campaign_action_log').insert({
      campaign_id: campaign.id,
      progress_id: lead.id,
      contact_id: lead.contact_id,
      node_id: node.id,
      node_type: node.type,
      action_type: node.type,
      channel,
      status: 'skipped',
      error_message: outcome.reason,
      executed_at: new Date().toISOString(),
    });
    await supabase
      .from('campaign_lead_progress')
      .update({ status: 'skipped', error_message: outcome.reason, updated_at: new Date().toISOString() })
      .eq('id', lead.id);
    return { early: { success: false, error: outcome.reason } };
  }
  // 'fail' retries with backoff; a 'skip' with continueOnFailure moves to the next node
  return { result: { success: false, error: outcome.reason } };
}

async function executeAction(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  senderAccountId: string | null,
  dryRun?: boolean
): Promise<ActionResult> {
  // Get contact details for template variables
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('id', lead.contact_id)
    .single();

  if (!contact) {
    throw new Error('Contact not found');
  }

  // Determine the channel for this node
  const nodeChannel = getNodeChannel(node);

  // Get contact identity for the appropriate channel
  let identity: ContactIdentity | null = null;
  let channelUsed: ChannelType | null = nodeChannel;

  if (nodeChannel) {
    const { data: identityData } = await supabase
      .from('crm_contact_identities')
      .select('platform_user_id')
      .eq('contact_id', lead.contact_id)
      .eq('channel', nodeChannel)
      .single();

    identity = identityData;

    // Most contacts are imported with an email or phone and never get an identity
    // row for it. Send to the contact's own column, as the channel checks assume.
    if (!identity && nodeChannel === 'email' && contact.email?.trim()) {
      identity = { platform_user_id: contact.email.trim() };
    }
    if (!identity && nodeChannel === 'whatsapp') {
      const whatsappId = whatsappIdFromPhone(contact.phone);
      if (whatsappId) identity = { platform_user_id: whatsappId };
    }

    // If no identity and fallback is enabled, try fallback channels (Twilio steps resolve
    // the phone themselves and never switch channel)
    if (!identity && campaign.channel_fallback_enabled && campaign.fallback_order && !TWILIO_NODE_TYPES.has(node.type)) {
      for (const fallbackChannel of campaign.fallback_order) {
        if (fallbackChannel === nodeChannel) continue; // Skip the channel we already tried

        const { data: fallbackIdentity } = await supabase
          .from('crm_contact_identities')
          .select('platform_user_id')
          .eq('contact_id', lead.contact_id)
          .eq('channel', fallbackChannel)
          .single();

        if (fallbackIdentity) {
          identity = fallbackIdentity;
          channelUsed = fallbackChannel;
          console.log(`[Campaign Processor] Using fallback channel ${fallbackChannel} for lead ${lead.id}`);
          break;
        }
      }
    }
  }

  // For messaging actions, we need an identity
  const requiresIdentity = [
    'connectionRequest', 'message', 'inmail', 'viewProfile', 'follow', 'warmupEngagement',
    'email', 'whatsappMessage', 'instagramDm', 'instagramFollow', 'telegramMessage',
  ].includes(node.type); // smsMessage resolves and checks the phone in sendCampaignSms

  // If no identity found and this is a LinkedIn channel, try to resolve from linkedin_url
  if (!dryRun && requiresIdentity && !identity && nodeChannel === 'linkedin' && contact.linkedin_url) {
    console.log(`[Campaign Processor] No LinkedIn identity for contact ${lead.contact_id}, attempting to resolve from URL: ${contact.linkedin_url}`);
    const resolution = await resolveLinkedInIdentity(
      supabase,
      campaign.organization_id,
      lead.contact_id,
      contact.linkedin_url,
      senderAccountId,
      campaign
    );
    identity = resolution.identity;
    if (identity) {
      console.log(`[Campaign Processor] Successfully resolved LinkedIn identity for contact ${lead.contact_id}: ${identity.platform_user_id}`);
    } else if (resolution.senderOutage) {
      // The sender account is disconnected — the profile may be perfectly
      // reachable. Park the lead in 'waiting' with a backoff so it retries
      // once a sender reconnects, mirroring the disconnected-account
      // handling on the send path. Do NOT skip it.
      const errorMsg = 'Sender account disconnected — will retry identity resolution';
      const oneHourMs = 60 * 60 * 1000;
      const nextAction = new Date(Date.now() + oneHourMs);
      console.warn(`[Campaign Processor] Sender outage during identity resolution for lead ${lead.id}, retrying at ${nextAction.toISOString()}`);
      await supabase
        .from('campaign_lead_progress')
        .update({
          error_message: errorMsg,
          retry_count: 0,
          next_action_at: nextAction.toISOString(),
          status: 'waiting',
          sender_account_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
      return { success: false, error: errorMsg };
    }
  }

  // Instagram: resolve the contact's handle (instagram_url or an instagram custom field)
  // to a messaging id, so a DM / follow step works without an "Instagram profile
  // found" check in front of it.
  if (!dryRun && !identity && nodeChannel === 'instagram') {
    const checkCtx = channelCheckContext(supabase, campaign, lead, senderAccountId, false);
    const outcome = await checkInstagramFound(checkCtx);
    if (outcome === 'yes' && checkCtx.contact?.reach.instagramId) {
      identity = { platform_user_id: checkCtx.contact.reach.instagramId };
    } else if (outcome === 'retry') {
      // Sender disconnected or lookup failed transiently: retry later, don't skip the lead.
      const errorMsg = 'Instagram sender unavailable — will retry handle lookup';
      const nextAction = new Date(Date.now() + 60 * 60 * 1000);
      await supabase
        .from('campaign_lead_progress')
        .update({
          error_message: errorMsg,
          retry_count: 0,
          next_action_at: nextAction.toISOString(),
          status: 'waiting',
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
      return { success: false, error: errorMsg };
    }
  }

  if (!dryRun && requiresIdentity && !identity) {
    const channelLabel = nodeChannel ? nodeChannel.charAt(0).toUpperCase() + nodeChannel.slice(1) : 'Unknown';
    const errorMsg = `${channelLabel} profile not found or unreachable`;
    // Mark as skipped — identity resolution already tried and failed, retrying won't help.
    // Using 'skipped' instead of 'failed' because the lead's profile simply doesn't exist
    // or has no reachable identity; this is not an execution error.
    await supabase
      .from('campaign_lead_progress')
      .update({
        status: 'skipped',
        error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);
    return { success: false, error: errorMsg };
  }

  // Get appropriate sender account for the channel being used
  const receivingSender = campaignEntrySender(lead, channelUsed);
  // SMS picks its Twilio sender itself (_shared/messaging/sms.ts)
  let actualSenderAccountId = TWILIO_NODE_TYPES.has(node.type)
    ? null
    : pickActionSender(campaign, lead, channelUsed, senderAccountId);

  // Get sender account, with fallback if inactive/missing
  let { data: account } = await supabase
    .from('unipile_accounts')
    .select('*')
    .eq('id', actualSenderAccountId)
    .eq('organization_id', campaign.organization_id)
    .single();

  // Internal/enrichment nodes (analyzeContact, verifyEmail, sendToZapMail, etc.)
  // don't send through a Unipile channel, so a missing/inactive account must not
  // block them — they simply run with no sender context.
  if (!dryRun && nodeRequiresSenderAccount(node) && (!account || account.status !== 'active')) {
    if (receivingSender) throw new Error('The receiving account is unavailable; this conversation cannot move to another sender');
    // Try other senders from the campaign pool as fallback
    const fallbackChannel = channelUsed || campaign.primary_channel || 'linkedin';
    const channelSenders = getSenderAccountsForChannel(campaign, fallbackChannel);
    let foundFallback = false;
    for (const fallbackSenderId of channelSenders) {
      if (fallbackSenderId === actualSenderAccountId) continue;
      const { data: fallbackAccount } = await supabase
        .from('unipile_accounts')
        .select('*')
        .eq('id', fallbackSenderId)
        .eq('organization_id', campaign.organization_id)
        .eq('status', 'active')
        .single();
      if (fallbackAccount) {
        console.log(`[Campaign Processor] Lead ${lead.id}: sender ${actualSenderAccountId} not active, falling back to ${fallbackSenderId}`);
        actualSenderAccountId = fallbackSenderId;
        account = fallbackAccount;
        foundFallback = true;
        break;
      }
    }
    if (!foundFallback) {
      throw new Error('No active sender account available');
    }
  }

  // Build template context
  const enrichment = contact.enrichment_data || {};
  const discovery = (contact.discovery_metadata as Record<string, unknown> | null) || {};
  const emailConfidence = discovery.email_confidence;
  const signalConfidence = discovery.signal_confidence;
  const templateContext: TemplateContext = {
    // Standard contact fields
    firstName: contact.first_name || undefined,
    lastName: contact.last_name || undefined,
    fullName: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || undefined,
    company: contact.company || undefined,
    jobTitle: contact.job_title || undefined,
    headline: contact.headline || undefined,
    location: contact.location || contact.city || undefined,
    industry: contact.industry || undefined,
    linkedinBio: contact.linkedin_bio || undefined,
    homePageText: contact.home_page_text || undefined,
    // Sender fields (populated from account)
    senderName: account?.display_name || undefined,
    // Prefer the dedicated first_name/last_name columns; fall back to splitting the
    // display name on the first space (composed last names stay intact).
    senderFirstName: account?.first_name || account?.display_name?.split(' ')[0] || undefined,
    senderLastName: account?.last_name || account?.display_name?.split(' ').slice(1).join(' ') || undefined,
    // AI Analysis fields from enrichment_data
    aiPrimaryNeed: enrichment.primary_need || undefined,
    aiPrimaryNeedReason: enrichment.primary_need_reasoning || undefined,
    aiPrimaryNeedEvidence: enrichment.primary_need_evidence || undefined,
    aiPrimaryNeedConfidence: enrichment.primary_need_confidence || undefined,
    aiColdEmailAngle: enrichment.cold_email_angle || undefined,
    aiCompanyNiche: enrichment.company_niche || undefined,
    aiCompanyOffering: enrichment.company_offering || undefined,
    aiCompanyTarget: enrichment.company_target || undefined,
    aiCompanyTagline: enrichment.company_tagline || undefined,
    aiBestHook: enrichment.best_post_hook || undefined,
    aiLinkedInTopic1: enrichment.linkedin_topics?.[0] || undefined,
    aiPriority1: enrichment.company_priorities?.[0] || undefined,
    aiGrowthSignal1: enrichment.growth_signals?.[0]?.signal || undefined,
    aiLatestFunding: enrichment.latest_funding_round || undefined,
    aiFundingAmount: enrichment.funding_amount || undefined,
    // Discovery Layer signal context (from crm_contacts.discovery_metadata)
    aiSignalType: typeof discovery.signal_type === 'string' ? discovery.signal_type : undefined,
    aiSignalDate: typeof discovery.signal_date === 'string' ? discovery.signal_date : undefined,
    aiSignalDetail: typeof discovery.signal_detail === 'string' ? discovery.signal_detail : undefined,
    aiSignalContext: typeof discovery.signal_outreach_context === 'string' ? discovery.signal_outreach_context : undefined,
    aiSignalSourceUrl: typeof discovery.signal_source_url === 'string'
      ? discovery.signal_source_url
      : typeof discovery.directory_evidence_url === 'string'
        ? discovery.directory_evidence_url
        : undefined,
    aiSignalCompanyWebsite: typeof discovery.ai_signal_company_website === 'string' ? discovery.ai_signal_company_website : undefined,
    aiSignalCompanyLinkedin: typeof discovery.ai_signal_company_linkedin === 'string' ? discovery.ai_signal_company_linkedin : undefined,
    aiSignalCompanyIndustry: typeof discovery.ai_signal_company_industry === 'string' ? discovery.ai_signal_company_industry : undefined,
    // push-moltsets-to-aca stopped mirroring these into ai_signal_* keys, so
    // fall back to the canonical company_* keys it still writes.
    aiSignalCompanySize: typeof discovery.ai_signal_company_size === 'string' ? discovery.ai_signal_company_size
      : typeof discovery.company_employee_range === 'string' ? discovery.company_employee_range : undefined,
    aiSignalRevenue: typeof discovery.ai_signal_revenue === 'string' ? discovery.ai_signal_revenue
      : typeof discovery.company_revenue_range === 'string' ? discovery.company_revenue_range : undefined,
    aiSignalPerson: typeof discovery.ai_signal_person === 'string' ? discovery.ai_signal_person : undefined,
    aiSignalNewRole: typeof discovery.ai_signal_new_role === 'string' ? discovery.ai_signal_new_role : undefined,
    aiSignalAmount: typeof discovery.ai_signal_amount === 'string' ? discovery.ai_signal_amount : undefined,
    aiSignalInvestors: typeof discovery.ai_signal_investors === 'string' ? discovery.ai_signal_investors : undefined,
    aiSignalConfidence: typeof signalConfidence === 'number' || typeof signalConfidence === 'string'
      ? String(signalConfidence)
      : undefined,
    aiPackSource: typeof discovery.pack_source === 'string' ? discovery.pack_source : undefined,
    aiDirectoryEvidenceUrl: typeof discovery.directory_evidence_url === 'string' ? discovery.directory_evidence_url : undefined,
    aiEmailConfidence: typeof emailConfidence === 'number' || typeof emailConfidence === 'string'
      ? String(emailConfidence)
      : undefined,
    aiPracticeSignal1: typeof discovery.practice_signal_1 === 'string' ? discovery.practice_signal_1 : undefined,
    // Hiring pack extras
    aiSignalRoleLocation: typeof discovery.ai_signal_role_location === 'string' ? discovery.ai_signal_role_location : undefined,
    aiSignalSeniority: typeof discovery.ai_signal_seniority === 'string' ? discovery.ai_signal_seniority : undefined,
    aiSignalEmploymentType: typeof discovery.ai_signal_employment_type === 'string' ? discovery.ai_signal_employment_type : undefined,
    aiSignalNumApplicants: typeof discovery.ai_signal_num_applicants === 'string' || typeof discovery.ai_signal_num_applicants === 'number'
      ? String(discovery.ai_signal_num_applicants)
      : undefined,
    // Deliverable URLs
    notionPreviewUrl: contact.notion_preview_url || undefined,
    // Org custom fields — {{custom_<field_key>}}. Lead's own values, with an
    // org-level placeholder fallback fetched below.
    contactCustomFields: Object.fromEntries(
      Object.entries((contact.custom_fields as Record<string, unknown>) || {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ),
    customFieldDefaults: await getOrgCustomFieldDefaults(supabase, campaign.organization_id),
  };

  // Populate generated email content from generateEmails node (if previously run)
  const generatedData = lead.generated_data || {};
  for (let i = 1; i <= 7; i++) {
    const subj = generatedData[`email_${i}_subject`];
    const body = generatedData[`email_${i}_body`];
    if (subj) templateContext[`emailSubject${i}`] = subj;
    if (body) templateContext[`emailBody${i}`] = body;
  }

  // Decrypt API key (skip in dry-run — no external calls needed).
  // `account` may be null for internal/enrichment nodes that don't use a
  // Unipile sender; those nodes never reach the channel-send code that needs
  // these values, so leave them empty in that case.
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  let apiKey = '';
  let dsnUrl = '';
  if (!dryRun && account?.access_token_encrypted && account.api_version !== 'v2') {
    apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    dsnUrl = normalizeDsnUrl(account.dsn_url);
  }
  // Unipile v2 senders: the org's own key copy or ACA's platform key, fixed host.
  const isV2Send = !dryRun && account?.api_version === 'v2' && V2_ROUTED_NODE_TYPES.has(node.type);
  const v2Client = isV2Send ? new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) }) : null;

  // Resolve message content (handles both manual and AI prompt modes)
  const messageNodeTypes = [
    'connectionRequest', 'message', 'inmail', 'email',
    'whatsappMessage', 'instagramDm', 'telegramMessage', 'smsMessage',
  ];
  let resolvedMsg: ResolvedMessage | null = null;

  if (messageNodeTypes.includes(node.type)) {
    // Get OpenRouter key only if this node uses prompt mode
    let openRouterKey: string | null = null;
    if (isPromptMode(node)) {
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', campaign.organization_id)
        .eq('provider', 'openrouter')
        .single();

      if (apiKeyData) {
        openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      }
    }

    // Fetch conversation history so AI can generate contextual follow-ups
    let conversationHistory: string | null = null;
    if (isPromptMode(node)) {
      conversationHistory = await fetchConversationHistory(
        supabase,
        campaign.id,
        lead.id,
      );
    }

    resolvedMsg = await resolveMessage(
      node,
      lead.variation_index,
      templateContext,
      { openRouterKey, supabase, organizationId: campaign.organization_id },
      campaign.ai_message_config,
      conversationHistory,
    );
  }

  // Build attachments from node media config (WhatsApp, Instagram, etc.)
  const nodeAttachments: Array<{ type: string; url: string; mimeType?: string }> = [];
  if (node.data.includeMedia && node.data.mediaUrl) {
    // node.data is Record<string, unknown>, so these need narrowing before use.
    const mediaType = String(node.data.mediaType || 'image');
    nodeAttachments.push({
      type: mediaType === 'document' ? 'file' : mediaType,
      url: String(node.data.mediaUrl),
    });
  }

  let result: ActionResult;

  // Dry-run mode: skip contact-facing API calls, simulate success
  // BUT allow internal operations like analyzeContact, generateEmails (internal enrichment, not contact-facing)
  if (dryRun && node.type !== 'analyzeContact' && node.type !== 'generateEmails') {
    result = { success: true, externalId: `dry-run-${crypto.randomUUID().slice(0, 8)}` };
  } else if (
    node.type === 'message' &&
    channelUsed === 'linkedin' &&
    (!lead.connection_accepted_at || !lead.connection_sent_at)
  ) {
    // Guard: LinkedIn regular message requires a confirmed connection (both sent and accepted).
    // This prevents 422 errors when open-profile leads skip connectionRequest.
    result = {
      success: false,
      error: 'not_connected: Lead is not connected on LinkedIn — cannot send message. A connectionRequest must be sent and accepted before messaging.',
    };
  } else if (
    node.type === 'inmail' &&
    channelUsed === 'linkedin' &&
    !lead.connection_accepted_at
  ) {
    // Guard: LinkedIn InMail also requires accepted connection
    result = {
      success: false,
      error: 'not_connected: Lead is not connected on LinkedIn — cannot send InMail.',
    };
  } else if (v2Client) {
    result = await executeV2Action(
      supabase, v2Client, account.unipile_account_id, node, lead, channelUsed,
      identity?.platform_user_id ?? null, resolvedMsg, actualSenderAccountId, nodeAttachments.length > 0,
    );
  } else try {
    switch (node.type) {
      // ============ LinkedIn Actions ============
      case 'connectionRequest':
        result = await executeConnectionRequest(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          resolvedMsg!.message
        );
        break;

      case 'message': {
        // Look up existing Unipile conversation to avoid 422 invalid_recipient
        let existingChatId: string | undefined;
        if (channelUsed === 'linkedin') {
          // Unipile chat ids belong to one account: only reuse a chat this sender owns.
          const { data: conv } = await supabase
            .from('crm_conversations')
            .select('external_conversation_id')
            .eq('contact_id', lead.contact_id)
            .eq('channel', 'linkedin')
            .eq('channel_account_id', actualSenderAccountId)
            .not('external_conversation_id', 'is', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          existingChatId = conv?.external_conversation_id || undefined;
          if (existingChatId) {
            console.log(`[Campaign Processor] Found existing chat ${existingChatId} for contact ${lead.contact_id}`);
          }
        }
        result = await executeMessage(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          resolvedMsg!.message,
          'linkedin',
          nodeAttachments,
          existingChatId,
        );
        break;
      }

      case 'inmail':
        result = await executeInmail(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          resolvedMsg!.message,
          resolvedMsg!.subject || 'Message'
        );
        break;

      case 'viewProfile':
        result = await executeViewProfile(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id
        );
        break;

      case 'follow':
        result = await executeFollow(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id
        );
        break;

      case 'likePost':
        result = await executeLikePost(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          node
        );
        break;

      case 'warmupEngagement':
        result = await executeWarmupEngagement(
          supabase,
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          node,
          lead,
          campaign.id,
          templateContext
        );
        break;

      // ============ Email Actions ============
      case 'email':
        result = await executeEmail(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id, // For email, this is the email address
          linkifyPlainUrls(resolvedMsg!.message),
          resolvedMsg!.subject || 'Message',
          !!(node.data.useHtml),
        );
        break;

      // ============ WhatsApp Actions ============
      case 'whatsappMessage':
        result = await executeWhatsAppMessage(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          resolvedMsg!.message,
          nodeAttachments
        );
        break;

      case 'whatsappCheckNumber':
        // This is a condition node handled by evaluateCondition, but if it
        // somehow reaches executeAction, treat as no-op success
        result = { success: true };
        break;

      // ============ Enrichment Actions ============
      case 'findEmail':
        result = await executeFindEmail(supabase, campaign, lead, contact);
        break;

      case 'analyzeContact':
        result = await executeAnalyzeContact(supabase, campaign, lead, contact, node, senderAccountId);
        break;

      case 'generateEmails':
        result = await executeGenerateEmails(supabase, campaign, lead, contact, node, templateContext);
        break;

      // ============ Routing Actions ============
      case 'addToList':
        result = await executeAddToList(supabase, campaign, lead, node);
        break;

      // ============ AI Agent Handoff ============
      case 'handoffToAgent':
        result = await executeHandoffToAgent(supabase, campaign, lead, node);
        break;

      // ============ Instagram Actions ============
      case 'instagramDm':
        result = await executeInstagramDm(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          resolvedMsg!.message,
          nodeAttachments
        );
        break;

      case 'instagramFollow':
        result = await executeInstagramFollow(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id
        );
        break;

      case 'instagramLikePost':
        // Similar to LinkedIn like post
        result = await executeLikePost(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          node
        );
        break;

      // ============ Telegram Actions ============
      case 'telegramMessage':
        result = await executeTelegramMessage(
          apiKey,
          dsnUrl,
          account.unipile_account_id,
          identity!.platform_user_id,
          resolvedMsg!.message,
          nodeAttachments
        );
        break;

      // ============ SMS Actions ============
      case 'smsMessage':
      case 'whatsappTemplate': {
        const outcome = node.type === 'smsMessage'
          ? await sendCampaignSms(supabase, {
            organizationId: campaign.organization_id,
            campaignId: campaign.id,
            progressId: lead.id,
            contact,
            message: resolvedMsg!.message,
          })
          : await sendCampaignWhatsAppTemplate(supabase, {
            organizationId: campaign.organization_id,
            campaignId: campaign.id,
            progressId: lead.id,
            contact,
            templateId: String(node.data.templateId ?? ''),
          });
        const applied = await applyTwilioOutcome(supabase, campaign, lead, node, outcome);
        if ('early' in applied) return applied.early;
        result = applied.result;
        // The inbox shows what was actually sent (opt-out wording, filled template)
        if (applied.body) resolvedMsg = { ...(resolvedMsg ?? { wasAiGenerated: false }), message: applied.body };
        break;
      }

      // ============ Calendar Actions ============
      case 'scheduleMeeting':
        result = await executeScheduleMeeting(
          supabase,
          campaign.organization_id,
          account.id,
          contact.id,
          campaign.id,
          lead.id,
          node,
          templateContext
        );
        break;

      // ============ Email Tool Handoff Actions ============
      case 'sendToSmartlead':
        result = await executeSendToSmartlead(
          supabase,
          campaign,
          lead,
          contact,
          node,
          templateContext
        );
        break;

      case 'sendToInstantly':
        result = await executeSendToInstantly(
          supabase,
          campaign,
          lead,
          contact,
          node,
          templateContext
        );
        break;

      case 'sendToLeadConnector':
        result = await executeSendToLeadConnector(
          supabase,
          campaign,
          lead,
          contact,
          node,
          templateContext
        );
        break;

      case 'sendToZapMail':
        result = await executeSendToZapMail(
          supabase,
          campaign,
          lead,
          contact,
          node,
          templateContext
        );
        break;

      // ============ Notion Actions ============
      case 'createNotionPage':
        result = await executeCreateNotionPage(
          supabase,
          campaign,
          lead,
          contact,
          node
        );
        break;

      default:
        result = { success: false, error: `Unknown action type: ${node.type}` };
    }
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : 'Action failed' };
  }

  // Self-healing: re-resolve identity on invalid_recipient errors
  // This fixes leads imported with bad platform_user_id values (e.g. search result ID instead of provider_id)
  let reresolutionAttempted = false;
  if (
    !result.success &&
    isIdentityResolutionError(result.error) &&
    channelUsed === 'linkedin' &&
    identity &&
    contact.linkedin_url
  ) {
    reresolutionAttempted = true;
    const staleId = identity.platform_user_id;
    console.log(`[Campaign Processor] invalid_recipient for lead ${lead.id} (stale ID: ${staleId}) — attempting identity re-resolution`);

    // Delete the stale identity
    await supabase
      .from('crm_contact_identities')
      .delete()
      .eq('contact_id', lead.contact_id)
      .eq('channel', 'linkedin')
      .eq('platform_user_id', staleId);

    // Re-resolve via Unipile /api/v1/users/ endpoint
    const { identity: newIdentity } = await resolveLinkedInIdentity(
      supabase,
      campaign.organization_id,
      lead.contact_id,
      contact.linkedin_url,
      senderAccountId,
      campaign
    );

    if (newIdentity && newIdentity.platform_user_id !== staleId) {
      console.log(`[Campaign Processor] Re-resolved identity: ${staleId} -> ${newIdentity.platform_user_id} — retrying action`);

      // Retry the action once with the corrected identity
      try {
        if (v2Client) {
          result = await executeV2Action(
            supabase, v2Client, account.unipile_account_id, node, lead, channelUsed,
            newIdentity.platform_user_id, resolvedMsg, actualSenderAccountId, nodeAttachments.length > 0,
          );
        } else switch (node.type) {
          case 'connectionRequest':
            result = await executeConnectionRequest(apiKey, dsnUrl, account.unipile_account_id, newIdentity.platform_user_id, resolvedMsg!.message);
            break;
          case 'message':
            result = await executeMessage(apiKey, dsnUrl, account.unipile_account_id, newIdentity.platform_user_id, resolvedMsg!.message, 'linkedin', nodeAttachments);
            break;
          case 'inmail':
            result = await executeInmail(apiKey, dsnUrl, account.unipile_account_id, newIdentity.platform_user_id, resolvedMsg!.message, resolvedMsg!.subject || 'Message');
            break;
          case 'viewProfile':
            result = await executeViewProfile(apiKey, dsnUrl, account.unipile_account_id, newIdentity.platform_user_id);
            break;
          case 'follow':
            result = await executeFollow(apiKey, dsnUrl, account.unipile_account_id, newIdentity.platform_user_id);
            break;
        }
        if (result.success) {
          console.log(`[Campaign Processor] Retry succeeded after identity re-resolution for lead ${lead.id}`);
        }
      } catch (retryError) {
        result = { success: false, error: retryError instanceof Error ? retryError.message : 'Retry after re-resolution failed' };
      }
    } else if (newIdentity) {
      console.log(`[Campaign Processor] Re-resolution returned same ID ${staleId} — recipient is genuinely unreachable`);
    } else {
      console.log(`[Campaign Processor] Re-resolution failed for contact ${lead.contact_id} — could not resolve from ${contact.linkedin_url}`);
    }
  }

  // Track channel used and attempts
  const channelAttempts = lead.channel_attempts || {};
  if (channelUsed && !dryRun) {
    channelAttempts[channelUsed] = { status: result.success ? 'sent' : 'failed', at: new Date().toISOString() };
  }

  // Log action with channel information
  await supabase.from('campaign_action_log').insert({
    campaign_id: campaign.id,
    progress_id: lead.id,
    contact_id: lead.contact_id,
    sender_account_id: actualSenderAccountId,
    node_id: node.id,
    node_type: node.type,
    action_type: node.type,
    channel: channelUsed || 'linkedin',
    status: result.success && !result.error ? 'success' : result.success && result.error ? 'skipped' : 'failed',
    error_message: result.error || null,
    external_id: result.externalId || null,
    executed_at: new Date().toISOString(),
    // AI prompt mode tracking
    message_content: resolvedMsg?.message || null,
    ai_generated: resolvedMsg?.wasAiGenerated || false,
    prompt_template: resolvedMsg?.promptUsed || null,
  });

  // Dry-run mode: always advance to next node, skip all side-effects
  if (dryRun) {
    const nextNode = getNextNode(node.id, nodes, edges);
    await supabase
      .from('campaign_lead_progress')
      .update({
        current_node_id: nextNode?.id || null,
        status: nextNode ? 'waiting' : 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    return result;
  }

  // Update progress
  if (result.success) {
    // Increment channel usage
    const channelType = getChannelTypeForNode(node);
    if (channelType) {
      await supabase.rpc('increment_channel_usage', {
        p_organization_id: campaign.organization_id,
        p_channel: channelType,
        p_channel_account_id: actualSenderAccountId,
        p_status: 'sent',
      });
    }

    // Increment campaign analytics metrics
    const analyticsMetric = getAnalyticsMetricForNodeType(node.type);
    if (analyticsMetric) {
      await supabase.rpc('increment_campaign_analytics', {
        p_organization_id: campaign.organization_id,
        p_campaign_id: campaign.id,
        p_account_id: actualSenderAccountId,
        p_metric: analyticsMetric,
        p_value: 1,
      });
    }

    // Set account cooldown for inter-action delay (human-like pacing)
    // Use actualSenderAccountId — may differ from senderAccountId in multi-channel fallback
    // (null for SMS: Twilio senders pace through their own daily caps)
    if (channelType && actualSenderAccountId) {
      const rateSettings = campaign.rate_settings || {};
      const defaultMinDelay = channelDefCache.get(channelType) ?? 60;
      const minDelay = rateSettings.min_delay_seconds ?? defaultMinDelay;
      const maxDelay = rateSettings.max_delay_seconds ?? Math.max(minDelay * 3, 180);
      const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      const { error: cooldownUpsertError } = await supabase
        .from('account_action_cooldowns')
        .upsert({
          organization_id: campaign.organization_id,
          account_id: actualSenderAccountId,
          channel: channelType,
          last_action_at: new Date().toISOString(),
          cooldown_until: new Date(Date.now() + randomDelay * 1000).toISOString(),
        }, { onConflict: 'account_id,channel' });

      if (cooldownUpsertError) {
        console.error(`[Campaign Processor] Failed to set cooldown for account ${actualSenderAccountId}:`, cooldownUpsertError.message);
      } else {
        console.log(`[Campaign Processor] Set ${randomDelay}s cooldown for account ${actualSenderAccountId} (channel: ${channelType})`);
      }
    }

    // Update progress based on action type
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      channel_used: channelUsed || 'linkedin',
      channel_attempts: channelAttempts,
      retry_count: 0, // node succeeded — give the next node its full retry budget
      // Lock in the sender that actually sent. Until the first successful send the
      // sender is left unpinned so assignment stays dynamic (see processLead); from
      // here on the lead must stick to this account so follow-ups continue the same
      // LinkedIn relationship / email thread.
      // SMS sends from a Twilio sender (no Unipile account): keep the lead's pinned one
      ...(TWILIO_NODE_TYPES.has(node.type) ? {} : { sender_account_id: actualSenderAccountId }),
    };

    if (node.type === 'connectionRequest') {
      // Wait for connection acceptance — handled by campaign-connection-checker.
      // next_action_at is intentionally left unset so the processor query filter
      // (connection_sent_at.is.null,connection_accepted_at.not.is.null) and the
      // processLead guard both prevent re-processing this lead.
      updates.connection_sent_at = new Date().toISOString();
      updates.status = 'waiting';
      updates.current_node_id = node.id; // Stay on this node until accepted
    } else if (['message', 'inmail', 'email', 'whatsappMessage', 'instagramDm', 'telegramMessage', 'smsMessage', 'whatsappTemplate'].includes(node.type)) {
      // All messaging actions
      updates.last_message_at = new Date().toISOString();

      // CRM Bridge: create outbound CRM record so messages appear in unified inbox
      const msgChannel = channelUsed || getNodeChannel(node) || 'linkedin';
      const msgContent = resolvedMsg?.message || '';
      if (msgContent) {
        const convId = await createCrmRecordForOutbound(supabase, campaign, lead, msgChannel, msgContent, {
          senderAccountId: actualSenderAccountId,
          recipientId: identity?.platform_user_id ?? null,
          chatId: result.externalId,
          messageId: result.messageId,
        });
        if (convId) {
          lead.crm_conversation_id = convId; // Update in-memory for later use
        }
      }

      // Move to next node
      const nextNode = getNextNode(node.id, nodes, edges);
      updates.current_node_id = nextNode?.id || null;
      updates.status = nextNode ? 'in_progress' : 'completed';
    } else if (['sendToSmartlead', 'sendToInstantly', 'sendToLeadConnector', 'sendToZapMail', 'handoffToAgent'].includes(node.type)) {
      // Handoff actions (external email tools + AI agent takeover)
      const isReviewMode = node.data.requireReview && isPromptMode(node);
      if (isReviewMode) {
        // Sequence saved for review — pause lead until user approves
        updates.status = 'pending_review';
        updates.current_node_id = node.id; // Stay on this node
      } else {
        const exitAfterHandoff = node.data.exitAfterHandoff !== false;
        if (exitAfterHandoff) {
          // Mark as handed off and exit campaign flow
          updates.status = 'handed_off';
          updates.current_node_id = null;
        } else {
          // Continue to next node
          const nextNode = getNextNode(node.id, nodes, edges);
          updates.current_node_id = nextNode?.id || null;
          updates.status = nextNode ? 'in_progress' : 'completed';
        }
      }
    } else {
      // Move to next node (follow, view profile, like, etc.)
      const nextNode = getNextNode(node.id, nodes, edges);
      updates.current_node_id = nextNode?.id || null;
      updates.status = nextNode ? 'in_progress' : 'completed';
    }

    await supabase
      .from('campaign_lead_progress')
      .update(updates)
      .eq('id', lead.id);
  } else {
    // Non-critical actions: on failure, skip to next node instead of blocking the campaign.
    // Applies to inherently non-critical node types AND any node with continueOnFailure flag.
    const NON_CRITICAL_NODES = new Set([
      'follow', 'viewProfile', 'warmupEngagement', 'likePost',
      'instagramFollow', 'instagramLikePost',
    ]);
    const shouldContinueOnFailure = NON_CRITICAL_NODES.has(node.type) || node.data.continueOnFailure;

    // Transient LLM/provider rate limits (e.g. OpenRouter 429) are momentary and
    // must be RETRIED with backoff BEFORE we honor continueOnFailure. Otherwise a
    // one-minute model cool-down skips enrichment and the lead is dropped at the
    // fail-closed ICP gate. After MAX_RETRY_COUNT attempts we fall through to the
    // continueOnFailure / critical handling below, so a lead is never stuck.
    if (isTransientLlmRateLimit(result.error) && lead.retry_count < MAX_RETRY_COUNT) {
      const newRetryCount = lead.retry_count + 1;
      const backoffMs = calculateBackoffDelay(newRetryCount);
      const nextAction = new Date(Date.now() + backoffMs);
      console.log(`[Campaign Processor] Transient rate limit on ${node.type} for lead ${lead.id}, retry ${newRetryCount}/${MAX_RETRY_COUNT} at ${nextAction.toISOString()}: ${result.error}`);
      await supabase
        .from('campaign_lead_progress')
        .update({
          error_message: result.error,
          retry_count: newRetryCount,
          next_action_at: nextAction.toISOString(),
          status: 'waiting',
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
      return { ...result, success: false };
    }

    if (shouldContinueOnFailure) {
      console.log(`[Campaign Processor] Non-critical action ${node.type} failed for lead ${lead.id}, continuing to next node: ${result.error}`);
      const nextNode = getNextNode(node.id, nodes, edges);
      await supabase
        .from('campaign_lead_progress')
        .update({
          current_node_id: nextNode?.id || null,
          status: nextNode ? 'in_progress' : 'completed',
          retry_count: 0, // fresh budget for the next node
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      // Return success=true so the loop engine continues processing instant nodes
      return { ...result, success: true, error: `skipped: ${result.error}` };
    }

    // Handle error for critical actions
    const newRetryCount = lead.retry_count + 1;

    // Surface disconnected senders on /senders by flipping DB status as soon
    // as Unipile rejects a send with errors/disconnected_account. The lead is
    // then parked in 'waiting' so it can retry on a different sender after the
    // user reconnects, instead of being permanently failed.
    if (isDisconnectedAccountError(result.error)) {
      await markAccountDisconnectedFromSendError(supabase, actualSenderAccountId, result.error);
      const oneHourMs = 60 * 60 * 1000;
      const nextAction = new Date(Date.now() + oneHourMs);
      await supabase
        .from('campaign_lead_progress')
        .update({
          error_message: result.error,
          retry_count: 0,
          next_action_at: nextAction.toISOString(),
          status: 'waiting',
          sender_account_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
      return result;
    }

    // Provider rate limits (e.g. LinkedIn daily invitation cap) are NOT permanent
    // failures. Back off for 6 hours and reset retry count so the lead is retried
    // tomorrow instead of being permanently failed.
    if (isProviderRateLimited(result.error)) {
      const sixHoursMs = 6 * 60 * 60 * 1000;
      const nextAction = new Date(Date.now() + sixHoursMs);
      console.log(`[Campaign Processor] Provider rate limit for lead ${lead.id}, backing off until ${nextAction.toISOString()}: ${result.error}`);
      await supabase
        .from('campaign_lead_progress')
        .update({
          error_message: result.error,
          retry_count: 0, // Reset - this is not a real failure
          next_action_at: nextAction.toISOString(),
          status: 'waiting',
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
    } else {
      // Detect non-retryable errors — skip retries for permanent failures
      // Also treat invalid_recipient as non-retryable if re-resolution was already attempted
      const nonRetryable = isNonRetryableError(result.error) ||
        (reresolutionAttempted && isIdentityResolutionError(result.error));

      if (nonRetryable || newRetryCount >= MAX_RETRY_COUNT) {
        if (nonRetryable) {
          console.log(`[Campaign Processor] Non-retryable error for lead ${lead.id}: ${result.error}`);
        }
        await supabase
          .from('campaign_lead_progress')
          .update({
            status: 'failed',
            error_message: result.error,
            retry_count: newRetryCount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);
      } else {
        // Schedule retry with backoff
        const backoffMs = calculateBackoffDelay(newRetryCount);
        const nextAction = new Date(Date.now() + backoffMs);

        await supabase
          .from('campaign_lead_progress')
          .update({
            error_message: result.error,
            retry_count: newRetryCount,
            next_action_at: nextAction.toISOString(),
            status: 'waiting',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);
      }
    }
  }

  return result;
}

// ============================================================================
// AI Prompt Mode - Message Resolution
// ============================================================================

interface ResolvedMessage {
  message: string;
  subject?: string;
  wasAiGenerated: boolean;
  promptUsed?: string;
}

/** Character limits per node type for AI-generated messages */
const AI_MESSAGE_CHAR_LIMITS: Record<string, number> = {
  connectionRequest: 300,
  message: 8000,
  inmail: 1900,
  email: 5000,
  whatsappMessage: 4096,
  instagramDm: 1000,
  telegramMessage: 4096,
  smsMessage: 160,
};

/**
 * Fetch conversation history for a lead in a campaign.
 * Returns previous sent messages and received replies in chronological order,
 * so the AI can generate contextually-aware follow-ups.
 */
async function fetchConversationHistory(
  supabase: SupabaseClient<any>,
  campaignId: string,
  progressId: string,
): Promise<string | null> {
  const { data: actionLogs } = await supabase
    .from('campaign_action_log')
    .select('action_type, message_content, metadata, executed_at')
    .eq('campaign_id', campaignId)
    .eq('progress_id', progressId)
    .eq('status', 'success')
    .order('executed_at', { ascending: true });

  if (!actionLogs || actionLogs.length === 0) return null;

  const entries: string[] = [];

  for (const log of actionLogs) {
    if (log.message_content) {
      entries.push(`[You sent]: ${log.message_content}`);
    } else if (log.action_type === 'reply_detected') {
      const replyText = log.metadata?.reply_text || '';
      if (replyText) {
        entries.push(`[Contact replied]: ${replyText}`);
      }
    }
  }

  return entries.length > 0 ? entries.join('\n\n') : null;
}

/**
 * Build a system prompt for execution-time AI message generation.
 * Tailored per channel/node type with appropriate constraints.
 */
function buildExecutionSystemPrompt(nodeType: string, conversationHistory?: string | null): string {
  const channelGuides: Record<string, string> = {
    connectionRequest: 'a LinkedIn connection request note. MUST be under 300 characters. Be extremely concise - just 1-2 sentences.',
    message: 'a LinkedIn direct message. Keep it under 500 characters. Be conversational, peer-level, and end with one focused question.',
    inmail: 'a LinkedIn InMail. Professional cold outreach under 800 characters. Clear value proposition with a specific CTA.',
    email: 'a cold email body. Clear value prop, specific CTA, professional but personal tone. 3-5 sentences max.',
    whatsappMessage: 'a WhatsApp message. Brief, conversational, informal tone. Under 500 characters.',
    instagramDm: 'an Instagram DM. Casual, brief, and friendly. Under 500 characters.',
    telegramMessage: 'a Telegram message. Brief and conversational. Under 500 characters.',
    smsMessage: 'an SMS text message. MUST be under 160 characters. Extremely concise.',
  };

  const guide = channelGuides[nodeType] || 'a professional outreach message';

  let prompt = `You are a direct message ghostwriter. Write ${guide}

YOUR OUTPUT = the exact message that will be sent. Nothing else.

STRICT OUTPUT RULES:
- Return ONLY the message text, ready to send as-is
- NEVER include intros like "Here's the DM:" or "Opening message for..."
- NEVER include commentary like "Why this works" or "This message..."
- NEVER include separators like "---" or "***"
- NEVER include markdown formatting like **bold** or bullet points
- NEVER include labels, headers, or meta-text of any kind
- NEVER wrap the message in quotes
- Do NOT use placeholder brackets like [name] or [company]

STYLE:
- Sound human, not like a template or AI
- Write in first person as the sender
- Be specific to the recipient — reference their actual context
- No generic flattery or filler phrases
- Peer-level tone, not vendor-pitching-to-prospect`;

  if (conversationHistory) {
    prompt += `

CONVERSATION HISTORY:
The following is the conversation so far with this contact. Use this context to write a natural follow-up that builds on previous exchanges. Do NOT repeat points already made. If the contact replied, acknowledge or reference their reply naturally.

${conversationHistory}

Write the NEXT message in this conversation.`;
  }

  return prompt;
}

/**
 * Strip AI meta-commentary, separators, and formatting artifacts from generated messages.
 * Models sometimes include preambles ("Here's the DM:"), commentary ("Why this works:"),
 * markdown formatting, or separator lines that should never be sent to a recipient.
 */
function sanitizeAiMessage(raw: string): string {
  let msg = raw.trim();

  // Remove wrapping quotes
  msg = msg.replace(/^["']|["']$/g, '');

  // Split into lines for analysis
  const lines = msg.split('\n');

  // Find the actual message by stripping preamble and commentary blocks.
  // Strategy: look for separator lines (---/***) and take the content between them,
  // or strip known preamble/commentary patterns.

  // Check for "--- message ---" sandwich pattern (message between two separators)
  const sepIndices: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*[-—]{3,}\s*$/.test(line) || /^\s*[*]{3,}\s*$/.test(line)) {
      sepIndices.push(i);
    }
  });

  if (sepIndices.length >= 2) {
    // Extract content between first two separators
    const between = lines.slice(sepIndices[0] + 1, sepIndices[1]).join('\n').trim();
    if (between.length > 20) {
      msg = between;
    }
  } else if (sepIndices.length === 1) {
    // Single separator — take whichever side looks like the actual message
    const before = lines.slice(0, sepIndices[0]).join('\n').trim();
    const after = lines.slice(sepIndices[0] + 1).join('\n').trim();
    // Commentary patterns usually appear after the separator
    const afterLooksLikeCommentary = /^\*?\*?why\s+(this|it)\s+works/i.test(after) ||
      /^(note|explanation|breakdown|analysis|reasoning)/i.test(after);
    const beforeLooksLikePreamble = /^(here'?s|opening|draft|message for)/i.test(before);
    if (afterLooksLikeCommentary || beforeLooksLikePreamble) {
      msg = afterLooksLikeCommentary ? before : after;
    }
  }

  // Remove lines that are clearly meta-commentary
  const metaPatterns = [
    /^here'?s\s+(the|a|an|your|my)\s+(opening|dm|message|draft|response)/i,
    /^(opening|draft)\s+(dm|message)\s+(for|to)\s+/i,
    /^\*?\*?why\s+(this|it)\s+works:?\*?\*?/i,
    /^(note|explanation|breakdown|tips|reasoning|strategy)s?:/i,
    /^[-•]\s+(references|mirrors|positions|keeps|under\s+\d+\s+char)/i,
    /^\s*[-—]{3,}\s*$/,
    /^\s*[*]{3,}\s*$/,
  ];

  const cleanLines = msg.split('\n').filter(line => {
    return !metaPatterns.some(pat => pat.test(line.trim()));
  });
  msg = cleanLines.join('\n').trim();

  // Strip markdown bold/italic that shouldn't appear in DMs
  msg = msg.replace(/\*\*(.+?)\*\*/g, '$1');
  msg = msg.replace(/\*(.+?)\*/g, '$1');
  msg = msg.replace(/__(.+?)__/g, '$1');
  msg = msg.replace(/_(.+?)_/g, '$1');

  // Remove leading "Message:" or "DM:" labels
  msg = msg.replace(/^(message|dm|reply|response)\s*:\s*/i, '');

  // Typography tells last. This function does its own preamble/separator
  // extraction (tuned for LinkedIn output), so it only borrows the dash
  // normalisation rather than running the whole shared sanitizer.
  return normalizeDashes(msg.trim());
}

/**
 * Generate a personalized message from an AI prompt using OpenRouter.
 */
async function generateMessageFromPrompt(
  llm: { openRouterKey: string | null; supabase: SupabaseClient; organizationId: string },
  populatedPrompt: string,
  nodeType: string,
  model?: string,
  temperature?: number,
  conversationHistory?: string | null,
): Promise<string> {
  const systemPrompt = buildExecutionSystemPrompt(nodeType, conversationHistory);
  const llmModel = model || DEFAULT_FAST_TEXT_MODEL;

  const response = await fetchChatCompletions({
    model: llmModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: populatedPrompt },
    ],
    temperature: temperature ?? 0.7,
    max_tokens: 1000,
  }, {
    openRouterApiKey: llm.openRouterKey ?? undefined,
    supabase: llm.supabase,
    organizationId: llm.organizationId,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI message generation failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  let message = data.choices?.[0]?.message?.content?.trim() || '';

  if (!message) {
    throw new Error('AI returned empty message');
  }

  // Clean up AI output artifacts
  message = sanitizeAiMessage(message);

  // Enforce character limit for the channel
  const limit = AI_MESSAGE_CHAR_LIMITS[nodeType] || 8000;
  if (message.length > limit) {
    const truncated = message.substring(0, limit);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    );
    message = lastSentenceEnd > limit * 0.5
      ? truncated.substring(0, lastSentenceEnd + 1)
      : truncated;
  }

  return message;
}

// ============================================================================
// EMAIL SEQUENCE GENERATION (AI Prompt Mode for Email Tool Handoff Nodes)
// ============================================================================

interface GeneratedEmailInSequence {
  subject: string;
  body: string;
}

function buildEmailSequenceSystemPrompt(emailCount: number): string {
  return `You are an elite cold email copywriter specializing in hyper-personalized B2B outreach.

YOUR MISSION: Generate a ${emailCount}-email sequence that feels genuinely personalized to this specific prospect.

CRITICAL RULES:
1. Each email must reference something SPECIFIC about their company, situation, or needs
2. Build a narrative arc across emails - don't repeat the same pitch
3. Keep each email SHORT (3-5 sentences for body)
4. Subject lines: 3-7 words, curiosity-driven, lowercase preferred
5. No generic phrases like "I hope this finds you well" or "I wanted to reach out"
6. Sound human and natural - do NOT sound like AI or a template
7. Write in first person as the sender
8. Do NOT use placeholder brackets like [name] or [company]. All data has already been provided.
9. Do NOT include meta-commentary like "Here's a sequence..." or labels like "Email 1:"

EMAIL SEQUENCE STRATEGY:
- Email 1: Pain-focused opener referencing their specific situation
- Email 2: Value angle with insight relevant to their niche
- Email 3: Social proof or different angle
- Email 4+: Lighter touch, breakup style, permission-based

OUTPUT FORMAT:
Return a JSON array of exactly ${emailCount} emails:
[
  { "subject": "subject line here", "body": "email body here" },
  ...
]

Return ONLY valid JSON. No markdown code fences, no explanation, no preamble.`;
}

async function generateEmailSequenceFromPrompt(
  llm: { openRouterKey: string | null; supabase: SupabaseClient; organizationId: string },
  populatedPrompt: string,
  emailCount: number,
  model?: string,
  temperature?: number,
): Promise<GeneratedEmailInSequence[]> {
  const systemPrompt = buildEmailSequenceSystemPrompt(emailCount);
  const llmModel = model || DEFAULT_FAST_TEXT_MODEL;

  const response = await fetchChatCompletions({
    model: llmModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: populatedPrompt },
    ],
    temperature: temperature ?? 0.7,
    max_tokens: 4000,
  }, {
    openRouterApiKey: llm.openRouterKey ?? undefined,
    supabase: llm.supabase,
    organizationId: llm.organizationId,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI email sequence generation failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';

  if (!content) {
    throw new Error('AI returned empty response for email sequence');
  }

  // Parse JSON - handle possible markdown code fences
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                   content.match(/```\s*([\s\S]*?)\s*```/) ||
                   [null, content];
  const jsonText = jsonMatch[1] || content;

  let parsed: unknown[];
  try {
    parsed = JSON.parse(jsonText.trim());
  } catch {
    console.error('[Campaign Processor] Failed to parse email sequence JSON:', content);
    throw new Error('AI did not return valid JSON for email sequence');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AI did not return a valid email array');
  }

  return parsed.map((email: unknown) => {
    const e = email as Record<string, string>;
    return {
      // Strip AI tells (em dashes above all) before this copy is stored and
      // sent. This path used to skip it entirely, so campaign-written sequences
      // shipped with the punctuation that most obviously reads as machine-made.
      subject: sanitizeAIOutput((e.subject || '').trim()),
      body: sanitizeAIEmailBody((e.body || '').trim()),
    };
  });
}

/**
 * Resolve email content for email tool handoff nodes.
 * In manual mode: replaces template variables in subject/body.
 * In prompt mode: generates a full email sequence via AI, returns numbered custom fields.
 */
async function resolveEmailHandoffContent(
  supabase: SupabaseClient<any>,
  campaign: { organization_id: string; ai_message_config?: { defaultModel?: string; defaultTemperature?: number } },
  node: WorkflowNode,
  variationIndex: number,
  context: TemplateContext,
): Promise<{
  personalizedSubject: string;
  personalizedBody: string;
  customFields: Record<string, string>;
  aiGenerated: boolean;
  promptTemplate?: string;
}> {
  // Check if emails were already generated by an upstream generateEmails node
  if (context.emailSubject1 && context.emailBody1) {
    console.log('[Campaign Processor] Reusing pre-generated email content from generateEmails node');
    const customFields: Record<string, string> = {};
    for (let i = 1; i <= 7; i++) {
      const s = context[`emailSubject${i}`];
      const b = context[`emailBody${i}`];
      if (s || b) {
        // TemplateContext values are string | Record | undefined; only a string
        // is substitutable — a Record would render as "[object Object]".
        customFields[`email_${i}_subject`] = typeof s === 'string' ? s : '';
        customFields[`email_${i}_body`] = typeof b === 'string' ? b : '';
      }
    }
    const emailCount = Object.keys(customFields).filter(k => k.endsWith('_subject')).length;
    customFields['email_count'] = String(emailCount);
    return {
      personalizedSubject: context.emailSubject1 || '',
      personalizedBody: context.emailBody1 || '',
      customFields,
      aiGenerated: true,
    };
  }

  if (!isPromptMode(node)) {
    // Manual mode: simple variable replacement
    const subjectTemplate = (node.data.emailSubject as string) || '';
    const bodyTemplate = (node.data.emailBody as string) || '';
    return {
      personalizedSubject: replaceTemplateVariables(subjectTemplate, context),
      personalizedBody: replaceTemplateVariables(bodyTemplate, context),
      customFields: {},
      aiGenerated: false,
    };
  }

  // AI Prompt mode
  const promptTemplate = getPromptContent(node, variationIndex);
  if (!promptTemplate) {
    throw new Error('AI prompt mode is enabled but no prompt is configured');
  }

  const emailCount = (node.data.emailCount as number) || 3;
  const populatedPrompt = replaceTemplateVariables(promptTemplate, context);

  // Get OpenRouter key (not required when the node's model runs on Ollama)
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const model = (node.data.llmModel as string) || campaign.ai_message_config?.defaultModel || undefined;
  const { data: apiKeyData } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', campaign.organization_id)
    .eq('provider', 'openrouter')
    .single();

  if (!apiKeyData && !isOllamaModel(model)) {
    throw new Error('OpenRouter API key not configured. Required for AI prompt mode email sequences.');
  }

  const openRouterKey = apiKeyData ? await decryptApiKey(apiKeyData.key_encrypted, encryptionKey) : null;

  const temperature = (node.data.llmTemperature as number) ?? campaign.ai_message_config?.defaultTemperature ?? undefined;

  console.log(`[Campaign Processor] Generating ${emailCount}-email AI sequence (model: ${model || 'default'})`);

  const generatedEmails = await generateEmailSequenceFromPrompt(
    { openRouterKey, supabase, organizationId: campaign.organization_id },
    populatedPrompt,
    emailCount,
    model,
    temperature,
  );

  console.log(`[Campaign Processor] Generated ${generatedEmails.length} emails`);

  // Build numbered custom fields
  const customFields: Record<string, string> = {};
  generatedEmails.forEach((email, index) => {
    const num = index + 1;
    customFields[`email_${num}_subject`] = email.subject;
    customFields[`email_${num}_body`] = email.body;
  });
  customFields['email_count'] = String(generatedEmails.length);

  return {
    personalizedSubject: generatedEmails[0]?.subject || '',
    personalizedBody: generatedEmails[0]?.body || '',
    customFields,
    aiGenerated: true,
    promptTemplate: populatedPrompt,
  };
}

/**
 * Save an AI-generated email sequence for review instead of pushing immediately.
 * Stores in contact_email_sequences with campaign/progress linkage.
 */
async function saveSequenceForReview(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Contact,
  node: WorkflowNode,
  emailContent: {
    personalizedSubject: string;
    personalizedBody: string;
    customFields: Record<string, string>;
    aiGenerated: boolean;
    promptTemplate?: string;
  },
  toolType: string,
): Promise<{ success: boolean; error?: string }> {
  // Extract individual emails from the numbered custom fields
  const emailCount = parseInt(emailContent.customFields['email_count'] || '0', 10);
  const emails: Array<{ step: number; subject: string; body: string; delay_days: number }> = [];

  for (let i = 1; i <= emailCount; i++) {
    const subject = emailContent.customFields[`email_${i}_subject`];
    const body = emailContent.customFields[`email_${i}_body`];
    if (subject || body) {
      emails.push({
        step: i,
        subject: subject || '',
        body: body || '',
        delay_days: i === 1 ? 0 : 3,
      });
    }
  }

  // Fallback: if no emails parsed from custom fields, use primary subject/body
  if (emails.length === 0 && emailContent.personalizedSubject) {
    emails.push({
      step: 1,
      subject: emailContent.personalizedSubject,
      body: emailContent.personalizedBody,
      delay_days: 0,
    });
  }

  // Check for existing sequence for this progress_id (avoid duplicates on re-runs)
  const { data: existing } = await supabase
    .from('contact_email_sequences')
    .select('id')
    .eq('progress_id', lead.id)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`[Campaign Processor] Sequence already exists for progress ${lead.id}, skipping duplicate`);
    return { success: true };
  }

  const { error: insertError } = await supabase
    .from('contact_email_sequences')
    .insert({
      organization_id: campaign.organization_id,
      contact_id: lead.contact_id,
      campaign_id: campaign.id,
      progress_id: lead.id,
      name: `Campaign: ${campaign.name || 'Untitled'}`,
      email_count: emails.length,
      emails,
      status: 'ready',
      generated_at: new Date().toISOString(),
      tool_type: toolType,
      node_config: {
        connectionId: node.data.connectionId,
        externalCampaignId: node.data.externalCampaignId,
        externalWorkflowId: node.data.externalWorkflowId,
        exitAfterHandoff: node.data.exitAfterHandoff,
      },
      generation_config: {
        prompt: emailContent.promptTemplate || 'Write personalized cold outreach emails.',
      },
    });

  if (insertError) {
    console.error(`[Campaign Processor] Failed to save sequence for review: ${insertError.message}`);
    return { success: false, error: `Failed to save sequence: ${insertError.message}` };
  }

  console.log(`[Campaign Processor] Saved email sequence for review (contact: ${contact.id}, tool: ${toolType})`);
  return { success: true };
}

/**
 * Resolve the final message for a node, handling both manual and prompt modes.
 * For manual mode: replaces template variables in the message.
 * For prompt mode: replaces variables in the prompt, then calls an LLM to generate the message.
 */
async function resolveMessage(
  node: WorkflowNode,
  variationIndex: number,
  context: TemplateContext,
  llm: { openRouterKey: string | null; supabase: SupabaseClient; organizationId: string },
  aiConfig?: { defaultModel?: string; defaultTemperature?: number },
  conversationHistory?: string | null,
): Promise<ResolvedMessage> {
  if (isPromptMode(node)) {
    const model = (node.data.llmModel as string) || aiConfig?.defaultModel;
    if (!llm.openRouterKey && !isOllamaModel(model)) {
      throw new Error('OpenRouter API key not configured. Required for AI prompt mode messages.');
    }

    const promptTemplate = getPromptContent(node, variationIndex);
    if (!promptTemplate) {
      throw new Error('AI prompt mode is enabled but no prompt is configured');
    }

    const populatedPrompt = replaceTemplateVariables(promptTemplate, context);

    const temperature = (node.data.llmTemperature as number) ?? aiConfig?.defaultTemperature;

    const message = await generateMessageFromPrompt(
      llm,
      populatedPrompt,
      node.type,
      model,
      temperature,
      conversationHistory,
    );

    // For InMail and Email, subject is always manual (not AI-generated)
    let subject: string | undefined;
    if (node.type === 'inmail' || node.type === 'email') {
      const rawSubject = (node.data.subject as string) || 'Message';
      subject = replaceTemplateVariables(rawSubject, context);
    }

    return { message, subject, wasAiGenerated: true, promptUsed: populatedPrompt };
  }

  // Manual mode: existing behavior
  let message: string;
  if (node.type === 'connectionRequest') {
    const raw = getConnectionRequestMessage(node, variationIndex);
    message = raw ? replaceTemplateVariables(raw, context) : '';
  } else {
    const messageTemplate = getMessageContent(node, variationIndex);
    message = replaceTemplateVariables(messageTemplate, context);
  }

  let subject: string | undefined;
  if (node.type === 'inmail' || node.type === 'email') {
    const rawSubject = (node.data.subject as string) || 'Message';
    subject = replaceTemplateVariables(rawSubject, context);
  }

  return { message, subject, wasAiGenerated: false };
}

// ============================================================================
// Enrichment Actions
// ============================================================================

/**
 * Find email for a contact using the enrichment system.
 * On success, stores the email in crm_contact_identities with channel='email'.
 */
async function executeFindEmail(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  // Check if contact already has an email identity
  const { data: existingEmail } = await supabase
    .from('crm_contact_identities')
    .select('id, platform_user_id')
    .eq('contact_id', lead.contact_id)
    .eq('channel', 'email')
    .limit(1);

  if (existingEmail && existingEmail.length > 0) {
    console.log(`[Campaign Processor] Contact ${lead.contact_id} already has email: ${existingEmail[0].platform_user_id}`);
    return { success: true };
  }

  // ============================================================================
  // 1. ACA Discovery (primary path) — pattern cache + permutations + SMTP verify.
  //    This is the moat: we resolve emails ourselves rather than paying per lookup.
  // ============================================================================
  const enrichment = (contact.enrichment_data as Record<string, unknown> | null) || {};
  const employeeCount = typeof enrichment.employee_count === 'number'
    ? enrichment.employee_count
    : typeof enrichment.headcount === 'number'
      ? enrichment.headcount
      : null;
  const industry = typeof enrichment.industry === 'string' ? enrichment.industry : null;

  try {
    const discovery = await findEmailViaDiscovery(supabase, {
      contactId: String(lead.contact_id),
      organizationId: campaign.organization_id,
      firstName: contact.first_name as string | null | undefined,
      lastName: contact.last_name as string | null | undefined,
      company: contact.company as string | null | undefined,
      companyWebsite: (contact.company_website as string | null | undefined)
        ?? (contact.website as string | null | undefined),
      existingEmail: contact.primary_email as string | null | undefined,
      companySize: employeeCount,
      industry,
    });

    if (discovery.email) {
      await logEmailProviderLookup(supabase, {
        organizationId: campaign.organization_id,
        contactId: String(lead.contact_id),
        provider: 'aca_discovery',
        outcome: 'found',
        source: 'campaign',
        leadListId: campaign.lead_list_id,
        campaignId: campaign.id,
      });
      const accept = !discovery.catchAll || discovery.confidence >= 75;
      if (accept) {
        await supabase.from('crm_contact_identities').insert({
          contact_id: lead.contact_id,
          organization_id: campaign.organization_id,
          channel: 'email',
          platform_user_id: discovery.email,
          provider: 'aca_discovery',
          verified: !discovery.catchAll,
          created_at: new Date().toISOString(),
        });

        // Bump discovery_metadata.email_confidence on the contact for variable resolution.
        await supabase
          .from('crm_contacts')
          .update({
            discovery_metadata: {
              ...((contact.discovery_metadata as Record<string, unknown>) || {}),
              email_confidence: discovery.confidence,
              email_resolved_via: discovery.reason,
            },
          })
          .eq('id', lead.contact_id);

        console.log(
          `[Campaign Processor] ACA Discovery resolved email for contact ${lead.contact_id}: ${discovery.email} (${discovery.reason}, conf=${discovery.confidence})`
        );
        return { success: true };
      }
    } else {
      await logEmailProviderLookup(supabase, {
        organizationId: campaign.organization_id,
        contactId: String(lead.contact_id),
        provider: 'aca_discovery',
        outcome: 'not_found',
        source: 'campaign',
        leadListId: campaign.lead_list_id,
        campaignId: campaign.id,
      });
      console.log(
        `[Campaign Processor] ACA Discovery did not resolve email for contact ${lead.contact_id} (reason=${discovery.reason}); falling back to legacy providers if configured.`
      );
    }
  } catch (err) {
    console.error('[Campaign Processor] ACA Discovery error', err);
    // Fall through to legacy providers — never block the step on a discovery error.
  }

  // ============================================================================
  // 2. Legacy provider fallback — only when Discovery cannot resolve. Apollo /
  //    Hunter / Prospeo run only if the org has API keys configured for them.
  // ============================================================================
  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('provider, key_encrypted, metadata')
    .eq('organization_id', campaign.organization_id)
    .in('provider', ['apollo', 'hunter', 'prospeo', 'moltsets']);

  if (!apiKeys || apiKeys.length === 0) {
    return {
      success: false,
      error: 'ACA Discovery could not resolve the email and no legacy provider keys are configured. Either wait for Discovery to crawl this domain or add an Apollo / Hunter / Prospeo / MoltSets key in Settings > API Keys as a fallback.',
    };
  }

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

  for (const keyEntry of apiKeys) {
    try {
      // MoltSets is quota-capped (BYOK plan tier) — reserve one unit of the
      // org's shared daily budget before spending a real call. The same RPC
      // gates the on-demand "Find Emails" waterfall and the daily worker, so
      // a sequence step can't blow past the org's paid daily cap either.
      if (keyEntry.provider === 'moltsets') {
        const planTier = (keyEntry.metadata as { plan?: MoltsetsPlanTier } | null)?.plan;
        const limits = planTier ? MOLTSETS_PLAN_LIMITS[planTier] : undefined;
        if (!limits) {
          console.warn('[Campaign Processor] MoltSets key has no plan tier configured, skipping');
          continue;
        }
        const granted = await checkMoltsetsQuota(supabase, campaign.organization_id, limits.dailyCap);
        if (!granted) {
          console.log('[Campaign Processor] MoltSets daily quota exhausted, skipping for this lead');
          continue;
        }
      }

      const apiKey = await decryptApiKey(keyEntry.key_encrypted, encryptionKey);
      let email: string | null = null;
      let completedLookup = false;

      if (keyEntry.provider === 'apollo') {
        email = await findEmailViaApollo(apiKey, contact);
        completedLookup = true;
      } else if (keyEntry.provider === 'hunter') {
        email = await findEmailViaHunter(apiKey, contact);
        completedLookup = true;
      } else if (keyEntry.provider === 'prospeo') {
        email = await findEmailViaProspeo(apiKey, contact);
        completedLookup = true;
      } else if (keyEntry.provider === 'moltsets') {
        const linkedinUrl = contact.linkedin_url as string | undefined;
        if (linkedinUrl && linkedinUrl.includes('/in/')) {
          const result = await new MoltsetsAdapter().enrich(apiKey, { linkedinUrl }, ['email']);
          email = result.success ? result.data.email || null : null;
          completedLookup = result.success || result.error?.code === 'NOT_FOUND';
        }
      }

      if (completedLookup) {
        await logEmailProviderLookup(supabase, {
          organizationId: campaign.organization_id,
          contactId: String(lead.contact_id),
          provider: keyEntry.provider,
          outcome: email ? 'found' : 'not_found',
          source: 'campaign',
          leadListId: campaign.lead_list_id,
          campaignId: campaign.id,
        });
      }

      if (email) {
        await supabase.from('crm_contact_identities').insert({
          contact_id: lead.contact_id,
          organization_id: campaign.organization_id,
          channel: 'email',
          platform_user_id: email,
          provider: keyEntry.provider,
          verified: true,
          created_at: new Date().toISOString(),
        });

        console.log(`[Campaign Processor] Legacy provider ${keyEntry.provider} resolved email for contact ${lead.contact_id}: ${email}`);
        return { success: true };
      }
    } catch (error) {
      console.error(`[Campaign Processor] ${keyEntry.provider} email lookup failed:`, error);
    }
  }

  return { success: false, error: 'Could not find email via ACA Discovery or any configured legacy provider' };
}

/**
 * Execute AI contact analysis by invoking the analyze-company edge function.
 * Writes enrichment_data to crm_contacts, making {{ai_*}} variables available.
 */
async function executeAnalyzeContact(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Record<string, unknown>,
  node: WorkflowNode,
  senderAccountId: string | null,
): Promise<{ success: boolean; error?: string }> {
  const skipIfAlreadyEnriched = node.data.skipIfAlreadyEnriched !== false;
  const continueOnFailure = node.data.continueOnFailure !== false;

  // Check if already enriched
  if (skipIfAlreadyEnriched) {
    const enrichment = contact.enrichment_data as Record<string, unknown> | null;
    if (enrichment && (enrichment.primary_need || enrichment.company_niche)) {
      console.log(`[Campaign Processor] Contact ${lead.contact_id} already enriched, skipping analysis`);
      return { success: true };
    }
  }

  // Get Unipile account ID for LinkedIn post fetching
  let unipileAccountId: string | undefined;
  if (senderAccountId) {
    const { data: account } = await supabase
      .from('unipile_accounts')
      .select('unipile_account_id')
      .eq('id', senderAccountId)
      .single();
    unipileAccountId = account?.unipile_account_id;
  }

  // Product: node-level override > campaign-level fallback
  const productId = (node.data.productId as string) || campaign.icp_product_id || undefined;

  // Model: node-level config (falls back to DEFAULT_FAST_TEXT_MODEL)
  const model = (node.data.model as string) || undefined;

  try {
    const { error } = await supabase.functions.invoke('analyze-company', {
      body: {
        contactId: lead.contact_id,
        companyWebsite: contact.company_website || contact.website || undefined,
        linkedinUrl: contact.linkedin_url || undefined,
        unipileAccountId,
        productId,
        model,
      },
    });

    if (error) {
      const detail = await extractFunctionError(error);
      const errMsg = `AI analysis failed: ${detail}`;
      console.error(`[Campaign Processor] analyze-company failed for contact ${lead.contact_id}: ${detail}`);
      // A transient rate limit (OpenRouter 429) is NOT a reason to skip enrichment.
      // Surface it as a failure so the dispatcher's bounded backoff retries this
      // node; continuing here would drop the lead at the fail-closed ICP gate.
      // Only permanent failures honor continueOnFailure.
      if (continueOnFailure && !isTransientLlmRateLimit(errMsg)) {
        return { success: true, error: errMsg };
      }
      return { success: false, error: errMsg };
    }

    console.log(`[Campaign Processor] Successfully analyzed contact ${lead.contact_id}`);
    return { success: true };
  } catch (err) {
    const errMsg = `AI analysis exception: ${err}`;
    console.error(`[Campaign Processor] analyze-company exception for contact ${lead.contact_id}:`, err);
    if (continueOnFailure && !isTransientLlmRateLimit(errMsg)) {
      return { success: true, error: errMsg };
    }
    return { success: false, error: errMsg };
  }
}

async function findEmailViaApollo(
  apiKey: string,
  contact: Record<string, unknown>,
): Promise<string | null> {
  const linkedinUrl = contact.linkedin_url as string | undefined;

  const body: Record<string, unknown> = {};
  if (linkedinUrl) {
    body.linkedin_url = linkedinUrl;
  } else {
    body.first_name = contact.first_name;
    body.last_name = contact.last_name;
    body.organization_name = contact.company;
  }

  const response = await fetch('https://api.apollo.io/v1/people/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;

  const data = await response.json();
  return data.person?.email || null;
}

async function findEmailViaHunter(
  apiKey: string,
  contact: Record<string, unknown>,
): Promise<string | null> {
  const firstName = contact.first_name as string || '';
  const lastName = contact.last_name as string || '';
  const company = contact.company as string || '';

  if (!firstName || !company) return null;

  const params = new URLSearchParams({
    first_name: firstName,
    last_name: lastName,
    company: company,
    api_key: apiKey,
  });

  const response = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);
  if (!response.ok) return null;

  const data = await response.json();
  return data.data?.email || null;
}

async function findEmailViaProspeo(
  apiKey: string,
  contact: Record<string, unknown>,
): Promise<string | null> {
  const linkedinUrl = contact.linkedin_url as string | undefined;
  const data: Record<string, unknown> = linkedinUrl
    ? { linkedin_url: linkedinUrl }
    : {
        first_name: contact.first_name,
        last_name: contact.last_name,
        company_name: contact.company,
        company_website: contact.company_website || contact.website,
      };
  if (!linkedinUrl && (!data.first_name || !data.last_name || !data.company_website)) return null;

  const response = await fetch('https://api.prospeo.io/enrich-person', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KEY': apiKey,
    },
    body: JSON.stringify({ data }),
  });

  if (!response.ok) return null;

  const result = await response.json();
  return result.person?.email?.email || result.response?.email?.email || null;
}

// ============================================================================
// Generate Emails Action
// ============================================================================

/**
 * Execute AI email generation and store results in campaign_lead_progress.generated_data.
 * Makes {{email_subject_1}}, {{email_body_1}}, etc. available as template variables
 * for all downstream nodes in the sequence.
 */
/**
 * Add the contact to a target lead list. Idempotent (unique on list_id+contact_id).
 * Verifies the target list belongs to the campaign's org before inserting.
 */
async function executeAddToList(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<{ success: boolean; error?: string }> {
  const listId = node.data.listId as string | undefined;
  if (!listId) return { success: false, error: 'No target list configured' };

  // Ownership check — only add to lists in this campaign's org.
  const { data: list } = await supabase
    .from('lead_lists')
    .select('id, organization_id, is_smart')
    .eq('id', listId)
    .maybeSingle();
  if (!list || list.organization_id !== campaign.organization_id) {
    return { success: false, error: 'Target list not found in this organization' };
  }
  if (list.is_smart) {
    return { success: false, error: 'Cannot add members to a smart (filter-defined) list' };
  }

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('primary_email')
    .eq('id', lead.contact_id)
    .maybeSingle();
  const emailLower = (contact?.primary_email as string | null)?.trim().toLowerCase() || null;

  const { error } = await supabase
    .from('lead_list_members')
    .upsert(
      { list_id: listId, contact_id: lead.contact_id, email_lower: emailLower },
      { onConflict: 'list_id,contact_id', ignoreDuplicates: true },
    );
  if (error) return { success: false, error: error.message };

  console.log(`[Campaign Processor] addToList: contact ${lead.contact_id} → list ${listId}`);
  return { success: true };
}

/**
 * Hand the lead's conversation off to the AI agent. Flips ai_enabled on so that
 * inbound replies are picked up by conversation-autopilot, assigns the agent
 * profile (node override, else the campaign's), and clears any pause/human-takeover
 * flags so the agent is immediately live.
 */
async function executeHandoffToAgent(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  node: WorkflowNode,
): Promise<{ success: boolean; error?: string }> {
  // A handoff tied to a channel (e.g. after a WhatsApp or SMS step) only takes that
  // thread: if the step before it was skipped there's no thread, and falling back to
  // the contact's latest conversation could hand over an unrelated LinkedIn/email one.
  const channel = typeof node.data.channel === 'string' ? node.data.channel : null;
  let conversationId: string | null;
  if (channel) {
    const { data } = await supabase
      .from('crm_conversations')
      .select('id')
      .eq('organization_id', campaign.organization_id)
      .eq('contact_id', lead.contact_id)
      .eq('channel', channel)
      .maybeSingle();
    conversationId = data?.id ?? null;
  } else {
    conversationId = await resolveLeadConversationId(supabase, campaign, lead);
  }
  if (!conversationId) {
    return { success: false, error: channel ? `No ${channel} conversation to hand off yet` : 'No conversation found for this lead to hand off' };
  }

  const agentProfileId = (node.data.agentProfileId as string | null | undefined) || campaign.agent_profile_id || null;

  const { error } = await supabase
    .from('crm_conversations')
    .update({
      ai_enabled: true,
      agent_profile_id: agentProfileId,
      ai_paused_until: null,
      human_takeover_at: null,
      human_takeover_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('organization_id', campaign.organization_id);

  if (error) return { success: false, error: error.message };

  console.log(`[Campaign Processor] handoffToAgent: conversation ${conversationId} → AI agent ${agentProfileId ?? '(campaign default)'}`);
  return { success: true };
}

async function executeGenerateEmails(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Record<string, unknown>,
  node: WorkflowNode,
  context: TemplateContext,
): Promise<{ success: boolean; error?: string }> {
  console.log(`[Campaign Processor] Executing generateEmails for contact ${contact.id}`);

  // Skip if already generated (unless explicitly disabled)
  const skipIfAlready = node.data.skipIfAlreadyGenerated !== false;
  if (skipIfAlready && lead.generated_data && Object.keys(lead.generated_data).length > 0) {
    console.log(`[Campaign Processor] Lead ${lead.id} already has generated email data, skipping`);
    return { success: true };
  }

  const emailCount = (node.data.emailCount as number) || 3;
  const promptTemplate = getPromptContent(node, lead.variation_index);
  if (!promptTemplate) {
    return { success: false, error: 'No prompt configured for email generation' };
  }

  const populatedPrompt = replaceTemplateVariables(promptTemplate, context);

  // Get OpenRouter key (not required when the node's model runs on Ollama)
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const model = (node.data.llmModel as string) || campaign.ai_message_config?.defaultModel || undefined;
  const { data: apiKeyData } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', campaign.organization_id)
    .eq('provider', 'openrouter')
    .single();

  if (!apiKeyData && !isOllamaModel(model)) {
    return { success: false, error: 'OpenRouter API key not configured. Required for Generate Emails node.' };
  }

  const openRouterKey = apiKeyData ? await decryptApiKey(apiKeyData.key_encrypted, encryptionKey) : null;
  const temperature = (node.data.llmTemperature as number) ?? campaign.ai_message_config?.defaultTemperature ?? undefined;

  console.log(`[Campaign Processor] Generating ${emailCount}-email content (model: ${model || 'default'})`);

  const generatedEmails = await generateEmailSequenceFromPrompt(
    { openRouterKey, supabase, organizationId: campaign.organization_id },
    populatedPrompt,
    emailCount,
    model,
    temperature,
  );

  console.log(`[Campaign Processor] Generated ${generatedEmails.length} emails for lead ${lead.id}`);

  // Build generated_data map
  const generatedData: Record<string, string> = {};
  generatedEmails.forEach((email, index) => {
    const num = index + 1;
    generatedData[`email_${num}_subject`] = email.subject;
    generatedData[`email_${num}_body`] = email.body;
  });
  generatedData['email_count'] = String(generatedEmails.length);

  // Persist to campaign_lead_progress
  const { error: updateError } = await supabase
    .from('campaign_lead_progress')
    .update({ generated_data: generatedData })
    .eq('id', lead.id);

  if (updateError) {
    console.error(`[Campaign Processor] Failed to save generated_data for lead ${lead.id}:`, updateError);
    return { success: false, error: `Failed to save generated email data: ${updateError.message}` };
  }

  // Update in-memory lead for immediate downstream use in same processing tick
  lead.generated_data = generatedData;

  return { success: true };
}

// ============================================================================
// Notion Actions
// ============================================================================

/**
 * Create a personalized Notion page for the contact using the generate-notion-preview function.
 * On success, stores the notion_preview_url on the crm_contacts record.
 */
async function executeCreateNotionPage(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Record<string, unknown>,
  node: WorkflowNode,
): Promise<{ success: boolean; error?: string }> {
  const connectionId = node.data.connectionId as string | undefined;
  const databaseId = node.data.databaseId as string | undefined;
  const productId = node.data.productId as string | undefined;
  const blueprintIds = (node.data.blueprintIds as string[]) || ['strategic-growth'];
  const customPrompt = node.data.customPrompt as string | undefined;
  const icpThreshold = (node.data.icpThreshold as number) || 0;
  const continueOnFailure = node.data.continueOnFailure !== false;
  const model = node.data.model as string | undefined;

  if (!connectionId || !databaseId) {
    const msg = 'Notion connection and database must be configured on the Create Notion Page node.';
    return continueOnFailure ? { success: true, error: msg } : { success: false, error: msg };
  }

  // Check ICP threshold if configured
  if (icpThreshold > 0 && productId) {
    const { data: scoreData } = await supabase
      .from('contact_product_scores')
      .select('icp_score')
      .eq('contact_id', lead.contact_id)
      .eq('product_id', productId)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const icpScore = scoreData?.icp_score ?? 0;
    if (icpScore < icpThreshold) {
      console.log(`[Campaign Processor] Skipping Notion page for contact ${lead.contact_id}: ICP score ${icpScore} < threshold ${icpThreshold}`);
      return { success: true }; // Skip but don't fail
    }
  }

  // Check if contact already has a Notion page
  if (contact.notion_preview_url) {
    console.log(`[Campaign Processor] Contact ${lead.contact_id} already has Notion page, skipping.`);
    return { success: true };
  }

  // Delegate to the Fly.io Notion worker's /generate-one endpoint.
  // IMPORTANT: This edge function has a ~150s wall-clock limit, but Notion page generation
  // can take 3-5+ minutes for AI-heavy blueprints. We use a fire-and-forget pattern:
  // POST to the worker with a short timeout — if it responds quickly (e.g., skip/fast gen),
  // use the result. If it times out, return success anyway and let the lead advance.
  // The worker runs independently and updates crm_contacts when done.
  // On the next cron pass, the check at line 3315 (contact.notion_preview_url) will skip re-generation.
  const workerUrl = Deno.env.get('NOTION_GENERATOR_WORKER_URL');
  if (!workerUrl) {
    const msg = 'NOTION_GENERATOR_WORKER_URL not configured — cannot generate Notion page';
    console.error(`[Campaign Processor] ${msg}`);
    return continueOnFailure ? { success: true, error: msg } : { success: false, error: msg };
  }

  try {
    const controller = new AbortController();
    // 15s timeout: enough time for the worker to accept the request and handle fast cases
    // (skip checks, legacy mode). For AI-heavy blueprints, we'll time out here but the
    // worker continues generating in the background.
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${workerUrl}/generate-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await flyWorkerAuthHeaders()) },
      body: JSON.stringify({
        contactId: lead.contact_id,
        connectionId,
        databaseId,
        organizationId: campaign.organization_id,
        productId: productId || undefined,
        blueprintIds,
        customPrompt: customPrompt || undefined,
        model: model || undefined,
        force: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json();

    if (data.skipped) {
      console.log(`[Campaign Processor] Notion page skipped for contact ${lead.contact_id}: ${data.error || 'already exists'}`);
      return { success: true };
    }

    if (!data.success) {
      const msg = `Notion page generation failed: ${data.error || 'Unknown error'}`;
      console.error(`[Campaign Processor] ${msg}`);
      return continueOnFailure ? { success: true, error: msg } : { success: false, error: msg };
    }

    // Worker responded in time — update in-memory contact for downstream template substitution
    if (data.notionPageUrl) {
      contact.notion_preview_url = data.notionPageUrl;
    }

    console.log(`[Campaign Processor] Notion page created for contact ${lead.contact_id}: ${data.notionPageUrl}`);
    return { success: true };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    if (isTimeout) {
      // Worker is still generating in the background — this is expected for AI-heavy blueprints.
      // Return success so the lead advances. The worker will update crm_contacts when done.
      console.log(`[Campaign Processor] Notion generation dispatched to worker for contact ${lead.contact_id} (worker still processing, will complete async)`);
      return { success: true };
    }
    const msg = `Notion page generation error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Campaign Processor] ${msg}`);
    return continueOnFailure ? { success: true, error: msg } : { success: false, error: msg };
  }
}

// ============================================================================
// Unipile API Actions
// ============================================================================

// Node types that talk to a Unipile sender. On a v2 sender they go through executeV2Action;
// every other node type (enrichment, routing, handoffs) runs exactly as on v1.
const V2_ROUTED_NODE_TYPES = new Set([
  'connectionRequest', 'message', 'inmail', 'viewProfile', 'follow', 'likePost', 'warmupEngagement',
  'email', 'whatsappMessage', 'instagramDm', 'instagramFollow', 'instagramLikePost',
  'telegramMessage', 'smsMessage',
]);

// Channels a v2 sender can act on from a campaign step.
const V2_CHANNELS = new Set(['linkedin', 'whatsapp', 'telegram', 'instagram']);

/** Actions for a Unipile v2 sender (api_version = 'v2'): LinkedIn, plus WhatsApp, Telegram and Instagram messages. */
async function executeV2Action(
  supabase: SupabaseClient<any>,
  client: UnipileV2Client,
  unipileAccountId: string,
  node: WorkflowNode,
  lead: LeadProgress,
  channel: ChannelType | null,
  recipientId: string | null,
  resolvedMsg: ResolvedMessage | null,
  senderAccountId: string | null,
  hasAttachments = false,
): Promise<ActionResult> {
  if (channel && !V2_CHANNELS.has(channel)) {
    return { success: false, error: `${node.type} is not supported on Unipile v2 senders yet` };
  }
  if (!recipientId) return { success: false, error: 'contact has no identity' };

  switch (node.type) {
    case 'connectionRequest':
      return linkedinV2.sendRelationRequest(client, unipileAccountId, recipientId, resolvedMsg?.message);

    case 'message': {
      // Chat ids belong to one account: only reuse a chat this sender owns.
      const { data: conv } = await supabase
        .from('crm_conversations')
        .select('external_conversation_id')
        .eq('contact_id', lead.contact_id)
        .eq('channel', 'linkedin')
        .eq('channel_account_id', senderAccountId)
        .not('external_conversation_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return linkedinV2.sendLinkedInMessage(client, unipileAccountId, recipientId, resolvedMsg?.message ?? '', {
        chatId: conv?.external_conversation_id || undefined,
      });
    }

    case 'inmail':
      return linkedinV2.sendLinkedInMessage(client, unipileAccountId, recipientId, resolvedMsg?.message ?? '', {
        inmail: true,
        subject: resolvedMsg?.subject,
      });

    case 'viewProfile':
      return linkedinV2.viewProfile(client, unipileAccountId, recipientId);

    case 'whatsappMessage':
    case 'telegramMessage':
    case 'instagramDm': {
      if (hasAttachments) return { success: false, error: 'Attachments are not supported on Unipile v2 senders yet' };
      const conversationChannel = node.type === 'whatsappMessage' ? 'whatsapp'
        : node.type === 'telegramMessage' ? 'telegram' : 'instagram';
      const { data: conv } = await supabase
        .from('crm_conversations')
        .select('external_conversation_id')
        .eq('contact_id', lead.contact_id)
        .eq('channel', conversationChannel)
        .eq('channel_account_id', senderAccountId)
        .not('external_conversation_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const userId = node.type === 'whatsappMessage' ? whatsAppUserId(recipientId) : recipientId;
      return sendDirectMessage(client, unipileAccountId, userId, resolvedMsg?.message ?? '', {
        chatId: conv?.external_conversation_id || undefined,
      });
    }

    default:
      return { success: false, error: `${node.type} is not supported on Unipile v2 senders yet` };
  }
}

async function executeConnectionRequest(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientId: string,
  personalizedMessage: string,
): Promise<ActionResult> {
  const body: Record<string, unknown> = {
    account_id: accountId,
    provider_id: recipientId,
  };

  if (personalizedMessage) {
    body.message = personalizedMessage;
  }

  const response = await fetch(`${dsnUrl}/api/v1/users/invite`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Connection request failed: ${response.status} - ${errorText}`);

    // If LinkedIn says we already invited this person, treat it as a success
    // so the lead advances to "waiting for acceptance" instead of retrying.
    if (response.status === 422 && errorText.includes('already_invited')) {
      console.log(`[Campaign Processor] Connection request already sent — treating as success`);
      return { success: true };
    }

    // Provider rate limit (LinkedIn daily invitation cap). Pass through the error
    // text so the retry handler can detect it and apply long backoff.
    if (response.status === 422 && (errorText.includes('cannot_resend_yet') || errorText.includes('temporary provider limit'))) {
      console.warn(`[Campaign Processor] LinkedIn provider rate limit hit — will back off: ${errorText}`);
    }

    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.id || result.invitation_id };
}

async function executeMessage(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientId: string,
  personalizedMessage: string,
  channel = 'linkedin',
  attachments: Array<{ type: string; url: string; mimeType?: string }> = [],
  chatId?: string, // Existing conversation ID — use reply endpoint instead of starting new chat
): Promise<ActionResult> {

  if (chatId) {
    // Reply to existing conversation — avoids 422 invalid_recipient when chat already exists
    let replyResponse: Response;

    if (attachments.length > 0) {
      const formData = new FormData();
      formData.append('text', personalizedMessage);
      const resolved = await resolveAttachmentBinaries(attachments);
      appendAttachmentsToFormData(formData, resolved, channel);
      replyResponse = await fetch(`${dsnUrl}/api/v1/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
        body: formData,
      });
    } else {
      replyResponse = await fetch(`${dsnUrl}/api/v1/chats/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ text: personalizedMessage }),
      });
    }

    if (!replyResponse.ok) {
      const errorText = await replyResponse.text();
      console.error(`[Campaign Processor] Message (reply to ${chatId}) failed: ${replyResponse.status} - ${errorText}`);
      // If replying fails (e.g. stale chat_id), fall through to start new chat
      if (replyResponse.status !== 404) {
        return { success: false, error: `${replyResponse.status}: ${errorText}` };
      }
      console.log(`[Campaign Processor] Chat ${chatId} not found, falling back to new chat`);
    } else {
      const sent = await replyResponse.json().catch(() => ({}));
      return { success: true, externalId: chatId, messageId: sent?.message_id };
    }
  }

  // Start new conversation
  // Use JSON body when there are no attachments (matches Unipile SDK behavior and avoids
  // FormData serialization issues with attendees_ids array that cause 422 invalid_recipient).
  if (attachments.length === 0) {
    const response = await fetch(`${dsnUrl}/api/v1/chats`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: [recipientId],
        text: personalizedMessage,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Campaign Processor] Message failed: ${response.status} - ${errorText}`);
      return { success: false, error: `${response.status}: ${errorText}` };
    }

    const result = await response.json();
    return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
  }

  // Use FormData when attachments are present
  const formData = new FormData();
  formData.append('account_id', accountId);
  formData.append('attendees_ids', JSON.stringify([recipientId]));
  formData.append('text', personalizedMessage);

  const resolved = await resolveAttachmentBinaries(attachments);
  appendAttachmentsToFormData(formData, resolved, channel);

  const response = await fetch(`${dsnUrl}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Message failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
}

async function executeInmail(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientId: string,
  personalizedMessage: string,
  personalizedSubject: string,
): Promise<ActionResult> {
  // InMail via Unipile - sent through the chats endpoint with linkedin.inmail flag
  // Use JSON body to match Unipile SDK behavior and avoid FormData serialization issues
  const response = await fetch(`${dsnUrl}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      attendees_ids: [recipientId],
      subject: personalizedSubject,
      text: personalizedMessage,
      linkedin: { inmail: true },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] InMail failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.chat_id || result.message_id || result.id, messageId: result.message_id };
}

async function executeViewProfile(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  profileId: string
): Promise<ActionResult> {
  // View profile via Unipile
  const response = await fetch(`${dsnUrl}/api/v1/users/${encodeURIComponent(profileId)}?account_id=${accountId}`, {
    method: 'GET',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] View profile failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  return { success: true };
}

async function executeFollow(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  profileId: string
): Promise<ActionResult> {
  // Fetch the user profile from Unipile to resolve the LinkedIn member identifier.
  const profileResponse = await fetch(
    `${dsnUrl}/api/v1/users/${encodeURIComponent(profileId)}?account_id=${accountId}&notify=false&linkedin_sections=*_preview`,
    {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    }
  );

  if (!profileResponse.ok) {
    const errorText = await profileResponse.text();
    console.error(`[Campaign Processor] Follow - profile fetch failed: ${profileResponse.status} - ${errorText}`);
    return { success: false, error: `Profile fetch failed: ${profileResponse.status}: ${errorText}` };
  }

  const profile = await profileResponse.json();

  // Use provider_id from the profile response (canonical ACoAAA... format)
  const fsdProfileId = profile.provider_id || profileId;

  console.log(`[Campaign Processor] Follow - using fsdProfileId "${fsdProfileId}" (provider_id: ${profile.provider_id}, input: ${profileId})`);

  // Strategy 1: Voyager raw API passthrough — follow via followingStates endpoint.
  // URL-encode the URN so colons in the path are handled correctly by the proxy.
  const followUrn = `urn:li:fsd_followingState:urn:li:fsd_profile:${fsdProfileId}`;
  const voyagerUrl = `https://www.linkedin.com/voyager/api/feed/dash/followingStates/${encodeURIComponent(followUrn)}`;

  const response = await fetch(`${dsnUrl}/api/v1/linkedin`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      method: 'POST',
      request_url: voyagerUrl,
      body: { patch: { '$set': { following: true } } },
      encoding: false,
    }),
  });

  if (response.ok) {
    return { success: true };
  }

  const errorText = await response.text();
  console.warn(`[Campaign Processor] Follow (Voyager) failed: ${response.status} - ${errorText}`);

  // Strategy 2: If Voyager rejects the request, try the non-encoded URL variant
  // (some Unipile versions handle encoding differently)
  const voyagerUrlRaw = `https://www.linkedin.com/voyager/api/feed/dash/followingStates/urn:li:fsd_followingState:urn:li:fsd_profile:${fsdProfileId}`;
  const response2 = await fetch(`${dsnUrl}/api/v1/linkedin`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      method: 'POST',
      request_url: voyagerUrlRaw,
      body: { patch: { '$set': { following: true } } },
      encoding: false,
    }),
  });

  if (response2.ok) {
    return { success: true };
  }

  const errorText2 = await response2.text();
  console.warn(`[Campaign Processor] Follow (Voyager raw) failed: ${response2.status} - ${errorText2}`);

  // Strategy 3: Try the normFollowingStates endpoint (newer LinkedIn Voyager route)
  const normUrl = `https://www.linkedin.com/voyager/api/feed/dash/normFollowingStates/${encodeURIComponent(`urn:li:fsd_followingState:urn:li:fsd_profile:${fsdProfileId}`)}`;
  const response3 = await fetch(`${dsnUrl}/api/v1/linkedin`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      method: 'POST',
      request_url: normUrl,
      body: { patch: { '$set': { following: true } } },
      encoding: false,
    }),
  });

  if (response3.ok) {
    return { success: true };
  }

  const errorText3 = await response3.text();
  console.error(`[Campaign Processor] Follow (all strategies) failed for ${fsdProfileId}. ` +
    `Voyager encoded: ${response.status} ${errorText}, Voyager raw: ${response2.status} ${errorText2}, normFollowingStates: ${response3.status} ${errorText3}`);
  return { success: false, error: `${response.status}: ${errorText}` };
}

async function executeLikePost(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  node: WorkflowNode
): Promise<ActionResult> {
  const postId = node.data.postId as string;

  if (!postId) {
    return { success: false, error: 'No post ID specified' };
  }

  // Like post via Unipile
  const response = await fetch(`${dsnUrl}/api/v1/posts/reaction`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      post_id: postId,
      reaction_type: 'like',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Like post failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  return { success: true };
}

/**
 * Execute warmup engagement action: react to and/or comment on prospect's posts
 */
async function executeWarmupEngagement(
  supabase: SupabaseClient<any>,
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  profileId: string,
  node: WorkflowNode,
  lead: LeadProgress,
  campaignId: string,
  context: TemplateContext
): Promise<ActionResult> {
  // Get warmup configuration from node data
  const engagementType = (node.data.engagementType as string) || 'reaction';
  const reactionType = (node.data.reactionType as string) || 'like';
  const commentTemplates = (node.data.commentTemplates as string[]) || [];
  const postCount = Math.min(Math.max((node.data.postCount as number) || 1, 1), 3);
  const preferHighEngagement = node.data.preferHighEngagement !== false;
  const cooldownDays = (node.data.cooldownDays as number) || 7;

  console.log(`[Campaign Processor] Warmup engagement for profile ${profileId}: type=${engagementType}, count=${postCount}`);

  // Check cooldown: don't engage if we've engaged with this contact recently
  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - cooldownDays);

  const { data: recentEngagements } = await supabase
    .from('campaign_action_log')
    .select('id')
    .eq('contact_id', lead.contact_id)
    .eq('action_type', 'warmupEngagement')
    .eq('status', 'success')
    .gte('executed_at', cooldownDate.toISOString())
    .limit(1);

  if (recentEngagements && recentEngagements.length > 0) {
    console.log(`[Campaign Processor] Warmup skipped: engaged within last ${cooldownDays} days`);
    return { success: true, externalId: 'skipped-cooldown' };
  }

  // Create Unipile SDK client (proper auth, error handling, correct endpoint routing)
  const client = new UnipileClient(dsnUrl, apiKey);

  // Fetch the prospect's recent posts via REST API
  const postsResponse = await fetch(
    `${dsnUrl}/api/v1/users/${encodeURIComponent(profileId)}/posts?account_id=${accountId}&limit=10`,
    {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    }
  );

  if (!postsResponse.ok) {
    const errorText = await postsResponse.text();
    console.error(`[Campaign Processor] Failed to fetch posts: ${postsResponse.status} - ${errorText}`);
    return { success: false, error: `Failed to fetch posts: ${postsResponse.status}` };
  }

  const postsData = await postsResponse.json();
  const posts = postsData.items || postsData.posts || [];

  if (!posts || posts.length === 0) {
    console.log(`[Campaign Processor] No posts found for profile ${profileId}`);
    return { success: true, externalId: 'no-posts-found' };
  }

  // Sort posts by engagement if preferHighEngagement is true
  let sortedPosts = [...posts];
  if (preferHighEngagement) {
    sortedPosts.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      // LinkedIn uses reaction_counter/comment_counter; Instagram uses like_count/comment_count
      const engagementA = ((a.reaction_counter as number) || (a.like_count as number) || 0) + ((a.comment_counter as number) || (a.comment_count as number) || 0);
      const engagementB = ((b.reaction_counter as number) || (b.like_count as number) || 0) + ((b.comment_counter as number) || (b.comment_count as number) || 0);
      return engagementB - engagementA;
    });
  }

  // Select posts to engage with (up to postCount)
  const selectedPosts = sortedPosts.slice(0, postCount);
  const engagedPostIds: string[] = [];
  let hasError = false;
  let lastError = '';

  // Map reaction type to Unipile format
  // Values must stay within Unipile's accepted reaction set, so type the map to
  // it rather than to plain string.
  const reactionTypeMap: Record<string, 'like' | 'celebrate' | 'support' | 'love' | 'insightful' | 'funny'> = {
    like: 'like',
    celebrate: 'celebrate',
    support: 'support',
    love: 'love',
    insightful: 'insightful',
    funny: 'funny',
  };

  for (const post of selectedPosts) {
    // Use social_id for LinkedIn (required by Unipile for reactions/comments);
    // fall back to provider_id for Instagram, id for other providers
    const postId = post.social_id || post.id;
    if (!postId) continue;

    // Execute reaction via SDK if needed
    if (engagementType === 'reaction' || engagementType === 'both') {
      try {
        await client.users.sendPostReaction({
          account_id: accountId,
          post_id: postId,
          reaction_type: reactionTypeMap[reactionType] || 'like',
        });
        console.log(`[Campaign Processor] Warmup reaction (${reactionType}) added to post ${postId}`);
      } catch (err) {
        const parsed = parseUnipileError(err);
        console.error(`[Campaign Processor] Warmup reaction failed for post ${postId}: ${parsed.message}`);
        hasError = true;
        lastError = `Reaction failed: ${parsed.message}`;
        // Continue to try comment even if reaction fails
        if (engagementType !== 'both') continue;
      }
    }

    // Execute comment via SDK if needed
    if ((engagementType === 'comment' || engagementType === 'both') && commentTemplates.length > 0) {
      // Select a random comment template and personalize it
      const templateIndex = Math.floor(Math.random() * commentTemplates.length);
      const commentTemplate = commentTemplates[templateIndex];
      const personalizedComment = replaceTemplateVariables(commentTemplate, context);

      try {
        await client.users.sendPostComment({
          account_id: accountId,
          post_id: postId,
          text: personalizedComment,
        });
        console.log(`[Campaign Processor] Warmup comment added to post ${postId}`);
      } catch (err) {
        const parsed = parseUnipileError(err);
        console.error(`[Campaign Processor] Warmup comment failed for post ${postId}: ${parsed.message}`);
        hasError = true;
        lastError = `Comment failed: ${parsed.message}`;
        continue;
      }
    }

    engagedPostIds.push(postId);
  }

  if (engagedPostIds.length === 0 && hasError) {
    return { success: false, error: lastError };
  }

  return {
    success: true,
    externalId: engagedPostIds.length > 0 ? engagedPostIds.join(',') : 'no-engagement',
  };
}

// ============================================================================
// URL Linkification for Email Bodies
// ============================================================================

/** Wrap plain-text URLs in <a> tags so they render as clickable hyperlinks in HTML emails. */
function linkifyPlainUrls(text: string): string {
  // Match URLs that are NOT already inside an href="..." or >...</a> context
  return text.replace(
    /(?<![="'>])(https?:\/\/[^\s<>"']+)/gi,
    '<a href="$1">$1</a>'
  );
}

// ============================================================================
// Multi-Channel Actions (Email, WhatsApp, Instagram, Telegram)
// ============================================================================

async function executeEmail(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientEmail: string,
  personalizedMessage: string,
  personalizedSubject: string,
  useHtml?: boolean,
): Promise<ActionResult> {
  // Validate email address
  if (!recipientEmail || !recipientEmail.includes('@')) {
    console.error(`[Campaign Processor] Invalid email address: ${recipientEmail}`);
    return { success: false, error: 'Invalid or missing email address' };
  }

  // Send email via Unipile API
  // The API expects multipart/form-data with 'to' as objects and 'body' field
  const formData = new FormData();
  formData.append('account_id', accountId);
  formData.append('to', JSON.stringify([{ identifier: recipientEmail }]));
  formData.append('subject', personalizedSubject);
  formData.append('body', useHtml ? personalizedMessage : personalizedMessage);

  const response = await fetch(`${dsnUrl}/api/v1/emails`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Email failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.tracking_id || result.provider_id || result.id };
}

async function executeWhatsAppMessage(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientPhone: string,
  personalizedMessage: string,
  attachments: Array<{ type: string; url: string; mimeType?: string }> = [],
): Promise<ActionResult> {
  const cleanedPhone = recipientPhone?.replace(/\D/g, '') || '';
  if (!cleanedPhone || cleanedPhone.length < 10) {
    console.error(`[Campaign Processor] Invalid phone number: ${recipientPhone}`);
    return { success: false, error: 'Invalid or missing phone number (minimum 10 digits required)' };
  }

  if (attachments.length === 0) {
    const response = await fetch(`${dsnUrl}/api/v1/chats`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: [cleanedPhone],
        text: personalizedMessage,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Campaign Processor] WhatsApp message failed: ${response.status} - ${errorText}`);
      return { success: false, error: `${response.status}: ${errorText}` };
    }

    const result = await response.json();
    return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
  }

  const formData = new FormData();
  formData.append('account_id', accountId);
  formData.append('attendees_ids', JSON.stringify([cleanedPhone]));
  formData.append('text', personalizedMessage);

  const resolved = await resolveAttachmentBinaries(attachments);
  appendAttachmentsToFormData(formData, resolved, 'whatsapp');

  const response = await fetch(`${dsnUrl}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] WhatsApp message failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
}

async function executeInstagramDm(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientId: string,
  personalizedMessage: string,
  attachments: Array<{ type: string; url: string; mimeType?: string }> = [],
): Promise<ActionResult> {
  if (attachments.length === 0) {
    const response = await fetch(`${dsnUrl}/api/v1/chats`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: [recipientId],
        text: personalizedMessage,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Campaign Processor] Instagram DM failed: ${response.status} - ${errorText}`);
      return { success: false, error: `${response.status}: ${errorText}` };
    }

    const result = await response.json();
    return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
  }

  const formData = new FormData();
  formData.append('account_id', accountId);
  formData.append('attendees_ids', JSON.stringify([recipientId]));
  formData.append('text', personalizedMessage);

  const resolved = await resolveAttachmentBinaries(attachments);
  appendAttachmentsToFormData(formData, resolved, 'instagram');

  const response = await fetch(`${dsnUrl}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Instagram DM failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
}

async function executeTelegramMessage(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  recipientId: string,
  personalizedMessage: string,
  attachments: Array<{ type: string; url: string; mimeType?: string }> = [],
): Promise<ActionResult> {
  if (attachments.length === 0) {
    const response = await fetch(`${dsnUrl}/api/v1/chats`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: [recipientId],
        text: personalizedMessage,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Campaign Processor] Telegram message failed: ${response.status} - ${errorText}`);
      return { success: false, error: `${response.status}: ${errorText}` };
    }

    const result = await response.json();
    return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
  }

  const formData = new FormData();
  formData.append('account_id', accountId);
  formData.append('attendees_ids', JSON.stringify([recipientId]));
  formData.append('text', personalizedMessage);

  const resolved = await resolveAttachmentBinaries(attachments);
  appendAttachmentsToFormData(formData, resolved, 'telegram');

  const response = await fetch(`${dsnUrl}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Telegram message failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, externalId: result.id || result.chat_id || result.message_id, messageId: result.message_id };
}

async function executeInstagramFollow(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  profileId: string
): Promise<ActionResult> {
  // Follow Instagram user via Unipile - uses the invite endpoint which handles follows on Instagram
  const response = await fetch(`${dsnUrl}/api/v1/users/invite`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      provider_id: profileId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Campaign Processor] Instagram follow failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  }

  return { success: true };
}

/**
 * Execute a schedule meeting action via calendar-create-event function
 */
async function executeScheduleMeeting(
  supabase: SupabaseClient<any>,
  organizationId: string,
  calendarAccountId: string,
  contactId: string,
  campaignId: string,
  progressId: string,
  node: WorkflowNode,
  context: TemplateContext
): Promise<ActionResult> {
  console.log(`[Campaign Processor] Executing scheduleMeeting for contact ${contactId}`);

  // Get meeting configuration from node data
  const titleTemplate = (node.data.titleTemplate as string) || 'Call with {firstName}';
  const durationMinutes = (node.data.durationMinutes as number) || 30;
  const conferenceProvider = (node.data.conferenceProvider as string) || 'google_meet';
  const bodyTemplate = (node.data.bodyTemplate as string) || '';
  const triggerCondition = (node.data.triggerCondition as string) || 'positive_reply';
  const templateId = node.data.templateId as string | undefined;

  // Apply template variables to title and body
  const title = replaceTemplateVariables(titleTemplate, context);
  const body = bodyTemplate ? replaceTemplateVariables(bodyTemplate, context) : undefined;

  // Check trigger condition (for now, just proceed - reply detection happens elsewhere)
  // The scheduleMeeting node should typically be placed after a conditionReplyReceived check
  console.log(`[Campaign Processor] scheduleMeeting trigger condition: ${triggerCondition}`);

  // Get contact email for meeting invitation
  const { data: contact, error: contactError } = await supabase
    .from('crm_contacts')
    .select('primary_email, first_name, last_name')
    .eq('id', contactId)
    .single();

  if (contactError || !contact) {
    console.error(`[Campaign Processor] Failed to get contact: ${contactError?.message}`);
    return { success: false, error: 'Contact not found' };
  }

  if (!contact.primary_email) {
    console.error(`[Campaign Processor] Contact ${contactId} has no email for meeting invite`);
    return { success: false, error: 'Contact has no email address for calendar invite' };
  }

  // Get connected calendar account for this organization
  const { data: calendarAccount, error: calError } = await supabase
    .from('calendar_accounts')
    .select('id, unipile_account_id, default_calendar_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (calError || !calendarAccount) {
    console.error(`[Campaign Processor] No active calendar account found for org ${organizationId}`);
    return { success: false, error: 'No connected calendar account. Connect a calendar in Settings.' };
  }

  // Calculate meeting time (default: schedule for tomorrow at 10am in organization's timezone)
  const now = new Date();
  const meetingStart = new Date(now);
  meetingStart.setDate(meetingStart.getDate() + 1); // Tomorrow
  meetingStart.setHours(10, 0, 0, 0); // 10:00 AM

  const meetingEnd = new Date(meetingStart);
  meetingEnd.setMinutes(meetingEnd.getMinutes() + durationMinutes);

  // Create calendar event via edge function
  const { data: eventResult, error: eventError } = await supabase.functions.invoke('calendar-create-event', {
    body: {
      organizationId,
      calendarAccountId: calendarAccount.id,
      calendarId: calendarAccount.default_calendar_id,
      title,
      body,
      startTime: meetingStart.toISOString(),
      endTime: meetingEnd.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      conferenceProvider: conferenceProvider !== 'none' ? conferenceProvider : undefined,
      attendees: [{
        email: contact.primary_email,
        name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || undefined,
      }],
      contactId,
      campaignId,
      progressId,
      templateId,
      notify: true,
    },
  });

  if (eventError) {
    const detail = await extractFunctionError(eventError);
    console.error(`[Campaign Processor] Calendar event creation failed: ${detail}`);
    return { success: false, error: detail };
  }

  if (!eventResult?.success) {
    console.error(`[Campaign Processor] Calendar event creation failed: ${eventResult?.error}`);
    return { success: false, error: eventResult?.error || 'Failed to create calendar event' };
  }

  console.log(`[Campaign Processor] Meeting scheduled successfully: ${eventResult.event?.id}`);
  return {
    success: true,
    externalId: eventResult.unipileEventId || eventResult.event?.id,
  };
}

// ============================================================================
// LinkedIn Identity Resolution
// ============================================================================

/**
 * Extract the public identifier (username) from a LinkedIn URL.
 * Supports formats like:
 * - https://www.linkedin.com/in/john-doe/
 * - linkedin.com/in/john-doe
 * - /in/john-doe
 */
function extractLinkedInIdentifier(url: string): string | null {
  if (!url) return null;
  const cleanUrl = url.trim();
  if (!cleanUrl.includes('/') && !cleanUrl.includes('.')) {
    return cleanUrl;
  }
  const inMatch = cleanUrl.match(/\/in\/([^\/\?#]+)/i);
  if (inMatch) return inMatch[1];
  const pubMatch = cleanUrl.match(/\/pub\/([^\/\?#]+)/i);
  if (pubMatch) return pubMatch[1];
  return null;
}

/**
 * Resolve a contact's LinkedIn URL into a Unipile provider_id and create
 * a crm_contact_identities record so subsequent actions can use it.
 *
 * This allows the campaign processor to work with contacts that were
 * imported via CSV (they have linkedin_url but no identity record yet).
 *
 * `senderOutage` distinguishes "the sender account is disconnected/unauthorized"
 * (Unipile 401 errors/disconnected_account — the profile may be perfectly
 * reachable) from a genuine profile miss, so callers can keep the lead
 * retryable instead of terminally skipping it.
 */
interface ResolvedLinkedInProfile {
  provider_id: string;
  first_name?: string;
  last_name?: string;
  public_profile_url?: string;
  profile_picture_url?: string;
  headline?: string;
  public_identifier?: string;
}

/** Stores the resolved LinkedIn identity (v1 or v2 profile, mapped to the same fields). */
async function saveLinkedInIdentity(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  identifier: string,
  linkedInUrl: string,
  profile: ResolvedLinkedInProfile,
): Promise<ContactIdentity | null> {
  const { data: identity, error: insertError } = await supabase
    .from('crm_contact_identities')
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel: 'linkedin',
      platform_user_id: profile.provider_id,
      platform_username: profile.first_name && profile.last_name
        ? `${profile.first_name} ${profile.last_name}`
        : identifier,
      platform_profile_url: profile.public_profile_url || linkedInUrl,
      platform_avatar_url: profile.profile_picture_url || null,
      platform_metadata: {
        headline: profile.headline,
        public_identifier: profile.public_identifier || identifier,
        resolved_at: new Date().toISOString(),
        resolved_by: 'campaign_processor',
      },
      is_primary: true,
    })
    .select('platform_user_id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      console.log(`[Campaign Processor] Identity already exists for contact ${contactId}, fetching existing`);
      const { data: existing } = await supabase
        .from('crm_contact_identities')
        .select('platform_user_id')
        .eq('contact_id', contactId)
        .eq('channel', 'linkedin')
        .single();
      return existing;
    }
    console.error(`[Campaign Processor] Failed to create identity for contact ${contactId}: ${insertError.message}`);
    return null;
  }
  return identity;
}

async function resolveLinkedInIdentity(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  linkedInUrl: string,
  senderAccountId: string | null,
  campaign: Campaign,
): Promise<{ identity: ContactIdentity | null; senderOutage: boolean }> {
  const identifier = extractLinkedInIdentifier(linkedInUrl);
  if (!identifier) {
    console.error(`[Campaign Processor] Could not extract LinkedIn identifier from URL: ${linkedInUrl}`);
    return { identity: null, senderOutage: false };
  }

  // Try assigned sender first, then fall back to other campaign senders
  const allSenders = getSenderAccountsForChannel(campaign, 'linkedin');
  const orderedSenders = [senderAccountId, ...allSenders.filter(id => id !== senderAccountId)];

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  let senderOutage = false;
  let attemptedAnySender = false;

  for (const accountId of orderedSenders) {
    const { data: account } = await supabase
      .from('unipile_accounts')
      .select('unipile_account_id, access_token_encrypted, dsn_url, api_version')
      .eq('id', accountId)
      .eq('status', 'active')
      .single();

    if (!account) {
      console.log(`[Campaign Processor] Sender account ${accountId} not active, trying next for identity resolution`);
      continue;
    }

    attemptedAnySender = true;

    if (account.api_version === 'v2') {
      try {
        const client = new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) });
        const p = await linkedinV2.getProfile(client, account.unipile_account_id, identifier);
        if (!p?.id) {
          console.error(`[Campaign Processor] v2 profile for ${identifier} has no id`);
          return { identity: null, senderOutage: false };
        }
        return {
          identity: await saveLinkedInIdentity(supabase, organizationId, contactId, identifier, linkedInUrl, {
            provider_id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            public_profile_url: p.profile_url,
            profile_picture_url: p.public_picture_url,
            headline: p.description,
            public_identifier: p.public_identifier,
          }),
          senderOutage: false,
        };
      } catch (error) {
        const message = linkedinV2.v2ErrorString(error);
        if (isDisconnectedAccountError(message)) {
          await markAccountDisconnectedFromSendError(supabase, accountId, message);
          senderOutage = true;
        } else if (isUnipileApiError(error) && (error.code === 'AUTHENTICATION_FAILED' || error.retryable)) {
          // Our platform key or Unipile itself, not the profile: keep the lead retryable.
          senderOutage = true;
        }
        console.error(`[Campaign Processor] v2 identity resolution failed for ${identifier} via ${accountId}: ${message}`);
        continue;
      }
    }

    try {
      const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
      const dsnUrl = normalizeDsnUrl(account.dsn_url);
      const url = `${dsnUrl}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${account.unipile_account_id}&notify=false`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401 || isDisconnectedAccountError(errorText)) {
          // Sender is logged out / unauthorized — this says nothing about the
          // profile. Flip the account status so /senders shows it and other
          // flows stop picking it, then try the next sender.
          console.error(`[Campaign Processor] Sender account ${accountId} disconnected during identity resolution for ${identifier}: ${response.status} - ${errorText}`);
          await markAccountDisconnectedFromSendError(supabase, accountId, errorText);
          senderOutage = true;
          continue;
        }
        console.error(`[Campaign Processor] LinkedIn identity resolution failed for ${identifier} via account ${accountId}: ${response.status} - ${errorText}`);
        continue;
      }

      const profile = await response.json();
      if (!profile.provider_id) {
        console.error(`[Campaign Processor] Profile for ${identifier} has no provider_id`);
        return { identity: null, senderOutage: false };
      }

      return {
        identity: await saveLinkedInIdentity(supabase, organizationId, contactId, identifier, linkedInUrl, profile),
        senderOutage: false,
      };
    } catch (error) {
      console.error(`[Campaign Processor] Error resolving LinkedIn identity via account ${accountId}:`, error);
      continue;
    }
  }

  // If no sender was even eligible to attempt the lookup (e.g. the campaign's
  // only sender is already marked disconnected), that's a sender outage too —
  // otherwise the lead would be terminally skipped on the very next run.
  if (!attemptedAnySender) {
    console.error(`[Campaign Processor] No active sender available for identity resolution of ${linkedInUrl}`);
    return { identity: null, senderOutage: true };
  }

  console.error(`[Campaign Processor] All sender accounts failed for identity resolution of ${linkedInUrl}`);
  return { identity: null, senderOutage };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the channel for a node type (for rate limiting)
 */
function getChannelTypeForNode(node: WorkflowNode): string | null {
  switch (node.type) {
    // LinkedIn
    case 'connectionRequest':
      return 'linkedin_invitation';
    case 'message':
      return 'linkedin_message';
    case 'inmail':
      return 'linkedin_inmail';
    case 'viewProfile':
      return 'linkedin_profile_view';
    case 'follow':
      return 'linkedin_follow';
    case 'likePost':
    case 'warmupEngagement':
      return 'linkedin_post_like';
    // Email
    case 'email':
      return 'email';
    // WhatsApp (Unipile and WhatsApp Business templates)
    case 'whatsappMessage':
    case 'whatsappTemplate':
      return 'whatsapp';
    case 'whatsappCheckNumber':
      return null; // Checking doesn't count
    // Instagram
    case 'instagramDm':
      return 'instagram_dm';
    case 'instagramFollow':
    case 'instagramLikePost':
      return null; // These don't count against messaging limits
    // Telegram
    case 'telegramMessage':
      return 'telegram';
    // SMS
    case 'smsMessage':
      return 'sms';
    // Calendar - no rate limits
    case 'scheduleMeeting':
      return null;
    default:
      return null;
  }
}

/**
 * Map node type to campaign_analytics metric column name
 * Returns the column name to increment, or null if not tracked
 */
function getAnalyticsMetricForNodeType(nodeType: string): string | null {
  switch (nodeType) {
    // LinkedIn actions
    case 'connectionRequest':
      return 'connections_sent';
    case 'message':
      return 'messages_sent';
    case 'inmail':
      return 'inmails_sent';
    case 'viewProfile':
      return 'profile_views';
    case 'follow':
      return 'follows';
    case 'likePost':
      return 'post_likes';
    // Non-LinkedIn channels are tracked via multi-channel KPIs from action log
    // so we don't duplicate them in campaign_analytics
    default:
      return null;
  }
}

/**
 * Get the messaging channel for a node (for identity lookup)
 */
function getNodeChannel(node: WorkflowNode): ChannelType | null {
  switch (node.type) {
    // LinkedIn nodes
    case 'connectionRequest':
    case 'message':
    case 'inmail':
    case 'viewProfile':
    case 'follow':
    case 'likePost':
    case 'warmupEngagement':
    case 'conditionConnection':
    case 'conditionOpenProfile':
      return 'linkedin';
    // Email nodes
    case 'email':
    case 'conditionEmailOpened':
    case 'conditionEmailClicked':
      return 'email';
    // Enrichment (uses LinkedIn data but doesn't require existing identity)
    case 'findEmail':
    case 'analyzeContact':
    case 'verifyEmail':
    case 'conditionIcpScore':
    case 'addToList':
      return null;
    // WhatsApp nodes
    case 'whatsappMessage':
    case 'whatsappCheckNumber':
    case 'whatsappTemplate':
      return 'whatsapp';
    // Instagram nodes
    case 'instagramDm':
    case 'instagramFollow':
    case 'instagramLikePost':
      return 'instagram';
    // Telegram nodes
    case 'telegramMessage':
      return 'telegram';
    // Calendar nodes (require email for calendar invite)
    case 'scheduleMeeting':
      return 'email';
    // Email tool handoff nodes (require email identity)
    case 'sendToSmartlead':
    case 'sendToInstantly':
    case 'sendToLeadConnector':
    case 'sendToZapMail':
      return 'email';
    // Notion nodes - no channel identity required
    case 'createNotionPage':
      return null;
    // Control/condition nodes don't have a channel
    default:
      return null;
  }
}

/**
 * Get sender accounts for a specific channel
 */
function getSenderAccountsForChannel(campaign: Campaign, channel: ChannelType): string[] {
  // First try multi-channel sender_accounts
  if (campaign.sender_accounts && campaign.sender_accounts[channel]?.length) {
    return campaign.sender_accounts[channel]!;
  }
  // Fall back to legacy sender_account_ids for LinkedIn
  if (channel === 'linkedin' && campaign.sender_account_ids?.length) {
    return campaign.sender_account_ids;
  }
  return [];
}

/**
 * The account an action on `channel` sends from (before the inactive-sender
 * fallback): the receiving account of an inbound-started lead, else a stable
 * per-lead pick from that channel's senders, else the lead's own sender.
 * Limit and cooldown checks must look at the same account the send is charged to.
 */
function pickActionSender(
  campaign: Campaign,
  lead: LeadProgress,
  channel: ChannelType | null,
  leadSenderId: string | null,
): string | null {
  const receivingSender = campaignEntrySender(lead, channel);
  if (receivingSender) return receivingSender;
  if (channel && (channel !== 'linkedin' || !!lead.entry_context)) {
    const channelSenders = getSenderAccountsForChannel(campaign, channel);
    if (channelSenders.length > 0) {
      // Deterministic hash-based rotation from lead UUID
      const hash = lead.id.split('').reduce((h: number, c: string) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      return channelSenders[Math.abs(hash) % channelSenders.length];
    }
  }
  return leadSenderId;
}

async function checkLimits(
  supabase: SupabaseClient<any>,
  organizationId: string,
  channelType: string,
  accountId: string | null
): Promise<{ allowed: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('check_channel_limit', {
    p_organization_id: organizationId,
    p_channel: channelType,
    p_channel_account_id: accountId,
  });

  if (error) {
    console.error(`[Campaign Processor] Limit check error: ${error.message}`);
    return { allowed: false, reason: error.message };
  }

  if (data && data.length > 0) {
    const limit = data[0];
    return { allowed: limit.allowed, reason: limit.reason || undefined };
  }

  return { allowed: true };
}

/**
 * Pick the best connected sender from a candidate list for a not-yet-sent lead.
 *
 * Prefers the sender with the most remaining daily capacity on the given channel
 * so backlog spreads across senders instead of saturating one. Ties, single-sender
 * pools, and the no-channel / lookup-failure cases fall back to deterministic hash
 * rotation from the lead UUID, which keeps assignment stable across runs.
 */
async function pickBestSender(
  supabase: SupabaseClient<any>,
  organizationId: string,
  channelType: string | null,
  candidates: string[],
  leadId: string,
): Promise<string | null> {
  if (!candidates || candidates.length === 0) return null;

  // Stable hash-based pick used for single-sender pools, ties, and fallbacks.
  const hash = leadId.split('').reduce((h: number, c: string) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const hashPick = selectSenderAccount(candidates, Math.abs(hash) % candidates.length);

  // No capacity signal to compare on, or nothing to balance — use the stable pick.
  if (!channelType || candidates.length === 1) return hashPick;

  // Score each candidate by remaining daily capacity (most headroom wins).
  let best: string | null = null;
  let bestRemaining = -1;
  for (const accountId of candidates) {
    try {
      const { data, error } = await supabase.rpc('check_channel_limit', {
        p_organization_id: organizationId,
        p_channel: channelType,
        p_channel_account_id: accountId,
      });
      if (error || !data || data.length === 0) continue;
      const row = data[0];
      if (!row.allowed) continue;
      const remaining = typeof row.remaining === 'number' ? row.remaining : 0;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        best = accountId;
      }
    } catch {
      // Ignore this candidate; other candidates / the fallback still decide.
    }
  }

  // If every candidate is capped (or lookups failed), keep the stable pick so the
  // lead still advances to the limit check, which reschedules it appropriately.
  return best ?? hashPick;
}

/**
 * Compute the next available scheduling slot when a channel daily limit is hit.
 *
 * Instead of blindly rescheduling to "tomorrow + random jitter" (which causes
 * all 10k leads to pile onto tomorrow and become overdue again), this function:
 *  1. Gets the effective daily limit for the account+channel
 *  2. Counts how many leads are already scheduled per future day (across all
 *     campaigns in the org for this account)
 *  3. Returns the first day that still has capacity, with an intra-day offset
 *     to spread slots evenly within the day
 *
 * Falls back to "tomorrow + jitter" if anything unexpected happens.
 */
async function getNextAvailableSlot(
  supabase: SupabaseClient<any>,
  organizationId: string,
  channelType: string,
  accountId: string | null,
): Promise<Date> {
  const LOOK_AHEAD_DAYS = 60; // search up to 60 days forward
  const FALLBACK_MS = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMilliseconds(Math.floor(Math.random() * 60 * 60 * 1000));
    return d;
  };

  try {
    // 1. Get effective daily limit for this account+channel
    const { data: limitData, error: limitError } = await supabase.rpc('get_effective_daily_limit', {
      p_organization_id: organizationId,
      p_channel: channelType,
      p_channel_account_id: accountId,
    });
    if (limitError || !limitData) return FALLBACK_MS();
    const dailyLimit: number = typeof limitData === 'number' ? limitData : (limitData[0]?.get_effective_daily_limit ?? 0);
    if (dailyLimit <= 0) return FALLBACK_MS();

    // 2. Count leads already scheduled per future day for this account
    //    We look at campaign_lead_progress where sender_account_id = accountId and
    //    next_action_at is in the future, grouped by UTC date.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const lookAheadEnd = new Date(today);
    lookAheadEnd.setUTCDate(today.getUTCDate() + LOOK_AHEAD_DAYS);

    // Only count reservations held by campaigns that are actually sending.
    // Paused/draft/completed campaigns never fire, so their waiting leads are
    // phantom reservations — counting them would let a dead campaign block the
    // per-account daily queue and push live campaigns weeks into the future.
    const { data: activeCampaigns } = await supabase
      .from('linkedin_campaigns')
      .select('id')
      .eq('status', 'active');
    const activeCampaignIds = (activeCampaigns ?? []).map((c) => c.id);
    if (activeCampaignIds.length === 0) return FALLBACK_MS();

    const { data: scheduled, error: schedError } = await supabase
      .from('campaign_lead_progress')
      .select('next_action_at')
      .eq('sender_account_id', accountId)
      .in('campaign_id', activeCampaignIds)
      .in('status', ['waiting', 'pending'])
      .gte('next_action_at', today.toISOString())
      .lt('next_action_at', lookAheadEnd.toISOString());

    if (schedError) return FALLBACK_MS();

    // Count per UTC date string
    const countByDay = new Map<string, number>();
    for (const row of (scheduled ?? [])) {
      const dateKey = row.next_action_at.substring(0, 10); // 'YYYY-MM-DD'
      countByDay.set(dateKey, (countByDay.get(dateKey) ?? 0) + 1);
    }

    // Also add today's already-sent count from channel_usage_tracking.
    // The table holds one daily row (period_hour IS NULL) alongside one row per
    // hour; without the period_hour filter this matched both and maybeSingle()
    // failed with "multiple rows returned", silently dropping today's usage.
    const todayKey = today.toISOString().substring(0, 10);
    const { data: todayUsage } = await supabase
      .from('channel_usage_tracking')
      .select('messages_sent')
      .eq('organization_id', organizationId)
      .eq('channel', channelType)
      .eq('channel_account_id', accountId)
      .eq('period_date', todayKey)
      .is('period_hour', null)
      .maybeSingle();
    if (todayUsage) {
      countByDay.set(todayKey, (countByDay.get(todayKey) ?? 0) + (todayUsage.messages_sent ?? 0));
    }

    // 3. Find first future day (starting tomorrow) with available capacity
    for (let i = 1; i <= LOOK_AHEAD_DAYS; i++) {
      const candidate = new Date(today);
      candidate.setUTCDate(today.getUTCDate() + i);
      const dateKey = candidate.toISOString().substring(0, 10);
      const alreadyScheduled = countByDay.get(dateKey) ?? 0;

      if (alreadyScheduled < dailyLimit) {
        // Spread within the day: use slot position to stagger evenly
        const slotIndex = alreadyScheduled;
        const secondsPerSlot = Math.floor((23 * 60 * 60) / Math.max(dailyLimit, 1));
        const offsetSeconds = slotIndex * secondsPerSlot + Math.floor(Math.random() * Math.min(secondsPerSlot, 600));
        candidate.setUTCSeconds(offsetSeconds);
        return candidate;
      }
    }

    // All days full within look-ahead — fall back to tomorrow+jitter
    return FALLBACK_MS();
  } catch {
    return FALLBACK_MS();
  }
}

async function getBusinessHoursConfig(
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<BusinessHoursConfig> {
  // Get organization's business hours settings from channel limits
  const { data } = await supabase
    .from('organization_channel_limits')
    .select('business_hours_only, business_hours_start, business_hours_end, timezone, active_days')
    .eq('organization_id', organizationId)
    .eq('channel', 'linkedin_invitation')
    .is('channel_account_id', null)
    .maybeSingle();

  if (!data || !data.business_hours_only) {
    return { enabled: false, timezone: 'UTC', startHour: 9, endHour: 17, workDays: [1, 2, 3, 4, 5] };
  }

  // Parse time strings
  const parseTime = (timeStr: string): number => {
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10);
  };

  return {
    enabled: true,
    timezone: data.timezone || 'UTC',
    startHour: data.business_hours_start ? parseTime(data.business_hours_start) : 9,
    endHour: data.business_hours_end ? parseTime(data.business_hours_end) : 17,
    workDays: data.active_days || [1, 2, 3, 4, 5],
  };
}

async function logJob(
  supabase: SupabaseClient<any>,
  _jobId: string,
  status: string,
  startTime: number,
  result: Record<string, unknown>
): Promise<void> {
  const duration = Date.now() - startTime;

  await supabase.from('unipile_job_logs').insert({
    job_type: 'campaign_processor',
    status,
    items_processed: (result.leadsProcessed as number) || 0,
    items_created: (result.actionsExecuted as number) || 0,
    items_failed: (result.leadsFailed as number) || 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors } : null,
    duration_ms: duration,
  });
}

// ============================================================================
// Email Tool Handoff Actions
// ============================================================================

/**
 * Execute Send to Smartlead handoff action
 * Pushes lead with personalized email content to Smartlead campaign
 */
async function executeSendToSmartlead(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Contact,
  node: WorkflowNode,
  context: TemplateContext
): Promise<ActionResult> {
  console.log(`[Campaign Processor] Executing sendToSmartlead for contact ${contact.id}`);

  const connectionId = node.data.connectionId as string;
  const externalCampaignId = node.data.externalCampaignId as string;

  if (!connectionId || !externalCampaignId) {
    return { success: false, error: 'Missing Smartlead connection or campaign ID in node configuration' };
  }

  // Resolve email content (manual or AI prompt mode)
  const emailContent = await resolveEmailHandoffContent(
    supabase, campaign, node, lead.variation_index, context,
  );

  if (!emailContent.personalizedSubject || !emailContent.personalizedBody) {
    return { success: false, error: 'Missing email subject or body content' };
  }

  // If review mode is enabled, save sequence for review instead of pushing
  if (node.data.requireReview && isPromptMode(node)) {
    return await saveSequenceForReview(supabase, campaign, lead, contact, node, emailContent, 'smartlead');
  }

  // Get contact email
  const { data: contactDetails } = await supabase
    .from('crm_contacts')
    .select('primary_email, company, job_title, linkedin_url, phone')
    .eq('id', contact.id)
    .single();

  if (!contactDetails?.primary_email) {
    return { success: false, error: 'Contact has no email address for Smartlead handoff' };
  }

  // Call push-to-smartlead edge function
  const { data: pushResult, error: pushError } = await supabase.functions.invoke('push-to-smartlead', {
    body: {
      connectionId,
      campaignId: externalCampaignId,
      contact: {
        id: contact.id,
        email: contactDetails.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contactDetails.company || contact.company,
        jobTitle: contactDetails.job_title || contact.job_title,
        linkedinUrl: contactDetails.linkedin_url,
        phone: contactDetails.phone,
      },
      personalizedSubject: emailContent.personalizedSubject,
      personalizedBody: emailContent.personalizedBody,
      customFields: emailContent.customFields,
      progressId: lead.id,
      internalCampaignId: campaign.id,
    },
  });

  if (pushError) {
    const detail = await extractFunctionError(pushError);
    console.error(`[Campaign Processor] Smartlead push failed: ${detail}`);
    return { success: false, error: detail };
  }

  if (!pushResult?.success) {
    console.error(`[Campaign Processor] Smartlead push failed: ${pushResult?.error}`);
    return { success: false, error: pushResult?.error || 'Failed to push to Smartlead' };
  }

  console.log(`[Campaign Processor] Successfully pushed to Smartlead: ${pushResult.leadId}`);
  return {
    success: true,
    externalId: pushResult.leadId,
  };
}

/**
 * Execute Send to Instantly handoff action
 * Pushes lead with personalized email content to Instantly campaign
 */
async function executeSendToInstantly(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Contact,
  node: WorkflowNode,
  context: TemplateContext
): Promise<ActionResult> {
  console.log(`[Campaign Processor] Executing sendToInstantly for contact ${contact.id}`);

  const connectionId = node.data.connectionId as string;
  const externalCampaignId = node.data.externalCampaignId as string;

  if (!connectionId || !externalCampaignId) {
    return { success: false, error: 'Missing Instantly connection or campaign ID in node configuration' };
  }

  // Resolve email content (manual or AI prompt mode)
  const emailContent = await resolveEmailHandoffContent(
    supabase, campaign, node, lead.variation_index, context,
  );

  if (!emailContent.personalizedSubject || !emailContent.personalizedBody) {
    return { success: false, error: 'Missing email subject or body content' };
  }

  // If review mode is enabled, save sequence for review instead of pushing
  if (node.data.requireReview && isPromptMode(node)) {
    return await saveSequenceForReview(supabase, campaign, lead, contact, node, emailContent, 'instantly');
  }

  // Get contact email
  const { data: contactDetails } = await supabase
    .from('crm_contacts')
    .select('primary_email, company, job_title, linkedin_url, phone, website')
    .eq('id', contact.id)
    .single();

  if (!contactDetails?.primary_email) {
    return { success: false, error: 'Contact has no email address for Instantly handoff' };
  }

  // Call push-to-instantly edge function
  const { data: pushResult, error: pushError } = await supabase.functions.invoke('push-to-instantly', {
    body: {
      connectionId,
      campaignId: externalCampaignId,
      contact: {
        id: contact.id,
        email: contactDetails.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contactDetails.company || contact.company,
        jobTitle: contactDetails.job_title || contact.job_title,
        linkedinUrl: contactDetails.linkedin_url,
        phone: contactDetails.phone,
        website: contactDetails.website,
      },
      personalizedSubject: emailContent.personalizedSubject,
      personalizedBody: emailContent.personalizedBody,
      customFields: emailContent.customFields,
      progressId: lead.id,
      internalCampaignId: campaign.id,
    },
  });

  if (pushError) {
    const detail = await extractFunctionError(pushError);
    console.error(`[Campaign Processor] Instantly push failed: ${detail}`);
    return { success: false, error: detail };
  }

  if (!pushResult?.success) {
    console.error(`[Campaign Processor] Instantly push failed: ${pushResult?.error}`);
    return { success: false, error: pushResult?.error || 'Failed to push to Instantly' };
  }

  console.log(`[Campaign Processor] Successfully pushed to Instantly: ${pushResult.leadId}`);
  return {
    success: true,
    externalId: pushResult.leadId,
  };
}

/**
 * Execute Send to LeadConnector handoff action
 * Pushes lead with personalized email content to GoHighLevel/LeadConnector
 */
async function executeSendToLeadConnector(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Contact,
  node: WorkflowNode,
  context: TemplateContext
): Promise<ActionResult> {
  console.log(`[Campaign Processor] Executing sendToLeadConnector for contact ${contact.id}`);

  const externalWorkflowId = node.data.externalWorkflowId as string | undefined;

  // Resolve email content (manual or AI prompt mode)
  const emailContent = await resolveEmailHandoffContent(
    supabase, campaign, node, lead.variation_index, context,
  );

  if (!emailContent.personalizedSubject || !emailContent.personalizedBody) {
    return { success: false, error: 'Missing email subject or body content' };
  }

  // If review mode is enabled, save sequence for review instead of pushing
  if (node.data.requireReview && isPromptMode(node)) {
    return await saveSequenceForReview(supabase, campaign, lead, contact, node, emailContent, 'leadconnector');
  }

  // Get contact email and other details
  const { data: contactDetails } = await supabase
    .from('crm_contacts')
    .select('primary_email, company, job_title, linkedin_url, phone, website')
    .eq('id', contact.id)
    .single();

  if (!contactDetails?.primary_email) {
    return { success: false, error: 'Contact has no email address for LeadConnector handoff' };
  }

  // Call push-to-leadconnector-email edge function
  const { data: pushResult, error: pushError } = await supabase.functions.invoke('push-to-leadconnector-email', {
    body: {
      organizationId: campaign.organization_id,
      workflowId: externalWorkflowId,
      contact: {
        id: contact.id,
        email: contactDetails.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contactDetails.company || contact.company,
        jobTitle: contactDetails.job_title || contact.job_title,
        linkedinUrl: contactDetails.linkedin_url,
        phone: contactDetails.phone,
        website: contactDetails.website,
      },
      personalizedSubject: emailContent.personalizedSubject,
      personalizedBody: emailContent.personalizedBody,
      customFields: emailContent.customFields,
      progressId: lead.id,
      internalCampaignId: campaign.id,
    },
  });

  if (pushError) {
    const detail = await extractFunctionError(pushError);
    console.error(`[Campaign Processor] LeadConnector push failed: ${detail}`);
    return { success: false, error: detail };
  }

  if (!pushResult?.success) {
    console.error(`[Campaign Processor] LeadConnector push failed: ${pushResult?.error}`);
    return { success: false, error: pushResult?.error || 'Failed to push to LeadConnector' };
  }

  console.log(`[Campaign Processor] Successfully pushed to LeadConnector: ${pushResult.contactId}`);
  return {
    success: true,
    externalId: pushResult.contactId,
  };
}

/**
 * Execute Send to ZapMail / Enroll in Email Sequence action
 * Creates a new email sequence or enrolls the lead in an existing one
 */
async function executeSendToZapMail(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Contact,
  node: WorkflowNode,
  context: TemplateContext
): Promise<ActionResult> {
  console.log(`[Campaign Processor] Executing sendToZapMail for contact ${contact.id}`);

  const userSelectedSequenceId = node.data.existingSequenceId || undefined;
  const isExistingMode = node.data.enrollmentMode === 'existing' && !!userSelectedSequenceId;

  // Determine the target sequence ID:
  // 1. "Add to Existing" mode → user-selected existingSequenceId
  // 2. "Create New" mode → _resolvedSequenceId from a previous lead's creation (shared across all leads)
  // 3. First lead in "Create New" → undefined (push-to-zapmail will create the sequence)
  const targetSequenceId = isExistingMode
    ? userSelectedSequenceId
    : (node.data._resolvedSequenceId || undefined);

  // Resolve email content — skip if "existing" mode with no content configured
  let emailContent: { personalizedSubject: string; personalizedBody: string; customFields: Record<string, string>; aiGenerated: boolean; promptTemplate?: string };

  if (isExistingMode && !node.data.emailSubject && !node.data.emailBody && !node.data.prompt) {
    // No content overrides — enroll with empty custom_data (sequence has its own content)
    emailContent = { personalizedSubject: '', personalizedBody: '', customFields: {}, aiGenerated: false };
  } else {
    emailContent = await resolveEmailHandoffContent(
      supabase, campaign, node, lead.variation_index, context,
    );

    // Only enforce content requirement for "create new" mode
    if (!isExistingMode && (!emailContent.personalizedSubject || !emailContent.personalizedBody)) {
      return { success: false, error: 'Missing email subject or body content' };
    }
  }

  // If review mode is enabled, save for review (works for both new and existing template sequences)
  if (node.data.requireReview && isPromptMode(node)) {
    return await saveSequenceForReview(supabase, campaign, lead, contact, node, emailContent, 'zapmail');
  }

  // Get contact email
  const { data: contactDetails } = await supabase
    .from('crm_contacts')
    .select('primary_email, company, job_title, linkedin_url')
    .eq('id', contact.id)
    .single();

  if (!contactDetails?.primary_email) {
    return { success: false, error: 'Contact has no email address for email sequence enrollment' };
  }

  // Call push-to-zapmail edge function
  const { data: pushResult, error: pushError } = await supabase.functions.invoke('push-to-zapmail', {
    body: {
      contact: {
        id: contact.id,
        email: contactDetails.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contactDetails.company || contact.company,
        jobTitle: contactDetails.job_title || contact.job_title,
        linkedinUrl: contactDetails.linkedin_url,
      },
      personalizedSubject: emailContent.personalizedSubject,
      personalizedBody: emailContent.personalizedBody,
      customFields: emailContent.customFields,
      sequenceName: `${campaign.name || 'Campaign'} · Email Sequence`,
      organizationId: campaign.organization_id,
      progressId: lead.id,
      internalCampaignId: campaign.id,
      existingSequenceId: targetSequenceId,
    },
  });

  if (pushError) {
    const detail = await extractFunctionError(pushError);
    console.error(`[Campaign Processor] Email sequence enrollment failed: ${detail}`);
    return { success: false, error: detail };
  }

  if (!pushResult?.success) {
    console.error(`[Campaign Processor] Email sequence enrollment failed: ${pushResult?.error}`);
    return { success: false, error: pushResult?.error || 'Failed to enroll in email sequence' };
  }

  console.log(`[Campaign Processor] Successfully enrolled in email sequence: sequence=${pushResult.sequenceId}, enrollment=${pushResult.enrollmentId}`);

  // Persist the sequence ID back to the node so subsequent leads reuse it (not create a new one)
  // This is critical for "Create New" mode — first lead creates the shared sequence, all others enroll in it
  if (!isExistingMode && pushResult.sequenceId && !node.data._resolvedSequenceId) {
    const updatedNodes = (campaign.sequence_nodes || []).map((n: any) =>
      n.id === node.id
        ? { ...n, data: { ...n.data, _resolvedSequenceId: pushResult.sequenceId } }
        : n
    );
    await supabase
      .from('campaigns')
      .update({ sequence_nodes: updatedNodes })
      .eq('id', campaign.id);

    // Update in-memory so remaining leads in this cron batch also reuse it
    node.data._resolvedSequenceId = pushResult.sequenceId;
    console.log(`[Campaign Processor] Persisted _resolvedSequenceId=${pushResult.sequenceId} for node ${node.id}`);
  }

  return {
    success: true,
    externalId: pushResult.enrollmentId,
  };
}

// ============================================================================
// CRM Bridge — Create inbox records for campaign messages
// ============================================================================

// Chat channels the unified inbox holds (crm_conversations.channel CHECK). Email
// threads are mailbox-scoped and recorded by the email pipeline; telegram has no
// inbox channel yet.
const INBOX_CHAT_CHANNELS = new Set<ChannelType>(['linkedin', 'instagram', 'whatsapp', 'sms']);

/**
 * Record a campaign's outbound chat message in the unified inbox, so the lead's
 * reply lands next to what they are replying to and autopilot, follow-up rules
 * and manual replies have the thread. Uses the same (org, contact, channel)
 * conversation the Unipile webhook files inbound replies into.
 */
async function createCrmRecordForOutbound(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  channel: ChannelType,
  messageContent: string,
  delivery: { senderAccountId: string | null; recipientId: string | null; chatId?: string; messageId?: string },
): Promise<string | null> {
  if (!INBOX_CHAT_CHANNELS.has(channel)) return null;

  try {
    const { data: conversationId, error: convError } = await supabase.rpc('get_or_create_conversation', {
      p_org_id: campaign.organization_id,
      p_contact_id: lead.contact_id,
      p_channel: channel,
      p_channel_account_id: delivery.senderAccountId,
      p_external_conversation_id: delivery.chatId || null,
      p_external_participant_id: delivery.recipientId,
      p_mailbox_id: null,
    });

    if (convError || !conversationId) {
      console.error(`[CRM Bridge] Failed to get conversation for lead ${lead.id}: ${convError?.message ?? 'no id returned'}`);
      return null;
    }

    if (lead.crm_conversation_id !== conversationId) {
      await supabase
        .from('campaign_lead_progress')
        .update({ crm_conversation_id: conversationId })
        .eq('id', lead.id);
    }

    // The conversation trigger maintains last_message_at, preview and counters.
    const { error: msgError } = await supabase
      .from('crm_messages')
      .insert({
        conversation_id: conversationId,
        organization_id: campaign.organization_id,
        contact_id: lead.contact_id,
        direction: 'outbound',
        sender_type: 'automation',
        content: messageContent,
        content_type: 'text',
        status: 'sent',
        external_message_id: delivery.messageId || null,
        external_thread_id: delivery.chatId || null,
        metadata: { source: 'campaign', channel, campaign_id: campaign.id, campaign_node: lead.current_node_id },
      });

    if (msgError) {
      console.error(`[CRM Bridge] Failed to insert outbound message for lead ${lead.id}: ${msgError.message}`);
    } else {
      console.log(`[CRM Bridge] Created outbound CRM record for lead ${lead.id} in conversation ${conversationId}`);
    }
    return conversationId;
  } catch (err) {
    console.error(`[CRM Bridge] Error creating CRM record:`, err);
    return null;
  }
}

// ============================================================================
// Reply Classification Pipeline
// ============================================================================

/**
 * When a reply is detected in a campaign, classify the intent and trigger
 * autopilot + follow-up rules. Also creates an inbound CRM message.
 */
async function processReplyClassification(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
): Promise<boolean> {
  try {
    // 1. Reply text. Whoever logged reply_detected (Unipile webhook, inbound sync)
    //    stored the message id in external_id and the first 500 chars in
    //    message_content; the full text is on the inbound crm_messages row.
    const { data: replyLog } = await supabase
      .from('campaign_action_log')
      .select('message_content, external_id')
      .eq('campaign_id', campaign.id)
      .eq('progress_id', lead.id)
      .eq('action_type', 'reply_detected')
      .order('executed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let inboundMessage: { id: string; content: string | null; metadata: Record<string, unknown> | null } | null = null;
    if (replyLog?.external_id) {
      const { data } = await supabase
        .from('crm_messages')
        .select('id, content, metadata')
        .eq('organization_id', campaign.organization_id)
        .eq('external_message_id', replyLog.external_id)
        .maybeSingle();
      inboundMessage = data;
    }

    const replyText = inboundMessage?.content || replyLog?.message_content || '';

    if (!replyText) {
      console.log(`[Reply Classification] No reply text found for lead ${lead.id}, skipping classification`);
      return false;
    }

    // 2. Classify the reply intent
    const openRouterKey = await getOrgOpenRouterKey(supabase, campaign.organization_id);
    let classification: ClassificationResult | null = null;

    // Use per-campaign model override → org default → hardcoded fallback
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', campaign.organization_id)
      .maybeSingle();
    const classifierModel = campaign.ai_message_config?.defaultModel || orgSettings?.default_llm_model || undefined;

    if (openRouterKey) {
      classification = await classifyReply(
        { from_email: '', subject: '', body_text: replyText },
        openRouterKey,
        classifierModel,
      );
    }

    if (!classification) {
      console.log(`[Reply Classification] Could not classify reply for lead ${lead.id}`);
      return false;
    }

    // 3. Update lead progress with intent
    await supabase
      .from('campaign_lead_progress')
      .update({
        lead_intent: classification.intent,
        intent_confidence: classification.confidence,
        intent_classified_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    console.log(`[Reply Classification] Lead ${lead.id}: intent=${classification.intent} (${(classification.confidence * 100).toFixed(0)}%)`);

    // 4. Attach the classification to the reply in the inbox. The webhook already
    //    stored the inbound message; only insert one if it never made it there.
    const classificationMeta = {
      intent: classification.intent,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
    };
    const conversationId = lead.crm_conversation_id;
    let inboundMessageId = inboundMessage?.id || '';
    if (inboundMessage) {
      await supabase
        .from('crm_messages')
        .update({ metadata: { ...(inboundMessage.metadata || {}), classification: classificationMeta } })
        .eq('id', inboundMessage.id);
    } else if (conversationId) {
      const { data: inserted } = await supabase
        .from('crm_messages')
        .insert({
          conversation_id: conversationId,
          organization_id: campaign.organization_id,
          contact_id: lead.contact_id,
          direction: 'inbound',
          sender_type: 'contact',
          content: replyText,
          content_type: 'text',
          status: 'delivered',
          external_message_id: replyLog?.external_id || null,
          metadata: { source: 'reply_classification', classification: classificationMeta },
        })
        .select('id')
        .maybeSingle();
      inboundMessageId = inserted?.id || '';
    }

    if (conversationId) {
      await supabase
        .from('crm_conversations')
        .update({ lead_intent: classification.intent })
        .eq('id', conversationId)
        .eq('organization_id', campaign.organization_id);
    }

    // 5. Evaluate follow-up rules (before stop conditions so auto_reply rules can fire)
    try {
      // Resolve CRM contact → leads table ID (follow-up rules expect leads.id)
      const { data: linkedLead } = await supabase
        .from('leads')
        .select('id')
        .eq('crm_contact_id', lead.contact_id)
        .limit(1)
        .maybeSingle();

      if (linkedLead) {
        await evaluateFollowupRules(supabase, {
          campaignId: campaign.id,
          leadId: linkedLead.id,
          organizationId: campaign.organization_id,
          intent: classification.intent as any,
          confidence: classification.confidence,
          triggerType: 'intent_match',
        });
      }
    } catch (followupErr) {
      console.error(`[Reply Classification] Followup rules error:`, followupErr);
    }

    // 6. Apply stop conditions
    const settings = campaign.campaign_settings || {};

    if (settings.stop_on_auto_reply && classification.intent === 'auto_reply') {
      console.log(`[Reply Classification] Stopping lead ${lead.id}: auto-reply detected`);
      await supabase
        .from('campaign_lead_progress')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', lead.id);
      return true;
    }

    if (settings.stop_company_on_reply) {
      // Find the contact's company
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('company')
        .eq('id', lead.contact_id)
        .eq('organization_id', campaign.organization_id)
        .single();

      if (contact?.company) {
        // Stop all other leads from this company in this campaign
        const { data: companyContacts } = await supabase
          .from('crm_contacts')
          .select('id')
          .eq('organization_id', campaign.organization_id)
          .eq('company', contact.company);

        if (companyContacts && companyContacts.length > 1) {
          const contactIds = companyContacts.map((c: any) => c.id).filter((id: string) => id !== lead.contact_id);

          await supabase
            .from('campaign_lead_progress')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('campaign_id', campaign.id)
            .in('contact_id', contactIds)
            .in('status', ['pending', 'in_progress', 'waiting']);

          console.log(`[Reply Classification] Stopped ${contactIds.length} other leads from company "${contact.company}"`);
        }
      }
    }

    // 7. Trigger autopilot (if configured). The webhook may already have drafted or
    //    sent a reply to this same inbound message; never answer it twice.
    if ((campaign.autopilot_config?.enabled || campaign.agent_profile_id) && conversationId && inboundMessageId && openRouterKey) {
      try {
        const { data: priorDraft } = await supabase
          .from('inbox_autopilot_queue')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('trigger_message_id', inboundMessageId)
          .limit(1)
          .maybeSingle();
        if (priorDraft) {
          console.log(`[Reply Classification] Autopilot already handled message ${inboundMessageId}, skipping`);
          return false;
        }

        await processAutopilot(
          supabase,
          {
            conversationId,
            contactId: lead.contact_id,
            organizationId: campaign.organization_id,
            intent: classification.intent,
            confidence: classification.confidence,
            inboundMessageId,
            campaignId: campaign.id,
            channel: lead.channel_used || 'linkedin',
            messageContent: replyText,
            model: classifierModel,
          },
          openRouterKey,
        );
      } catch (autopilotErr) {
        console.error(`[Reply Classification] Autopilot error:`, autopilotErr);
      }
    }

    return false;
  } catch (err) {
    console.error(`[Reply Classification] Error processing reply for lead ${lead.id}:`, err);
    return false;
  }
}

/**
 * Get the organization's OpenRouter API key for AI features.
 */
async function getOrgOpenRouterKey(supabase: SupabaseClient<any>, organizationId: string): Promise<string | null> {
  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData) return null;
    return await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
  } catch {
    return null;
  }
}

// ============================================================================
// AI Lead Filtering
// ============================================================================

/**
 * Evaluate a lead against AI filters before sending.
 *
 * Strategy:
 * 1. Try LLM-based filtering via OpenRouter (richer analysis using profile data)
 * 2. Fall back to rule-based filtering if no API key or LLM fails
 *
 * Returns 'send' to proceed or 'skip' to bypass this lead.
 */
async function aiFilterLead(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  settings: CampaignPowerSettings,
): Promise<'send' | 'skip'> {
  try {
    // Get contact profile for analysis
    const { data: contact } = await supabase
      .from('crm_contacts')
      .select('first_name, last_name, headline, job_title, company, primary_email, tags, status, enrichment_data, linkedin_url')
      .eq('id', lead.contact_id)
      .single();

    if (!contact) return 'send'; // No data to filter on

    const filterChecks: string[] = [];
    if (settings.ai_filter_unlikely_reply === 'skip') {
      filterChecks.push('unlikely_to_reply');
    }
    if (settings.ai_filter_hostile === 'skip') {
      filterChecks.push('hostile_prospect');
    }
    if (filterChecks.length === 0) return 'send';

    // Try LLM-based filtering first
    const openRouterKey = await getOrgOpenRouterKey(supabase, campaign.organization_id);
    if (openRouterKey) {
      const llmResult = await aiFilterLeadViaLLM(supabase, campaign, lead, contact, filterChecks, openRouterKey);
      if (llmResult !== null) return llmResult;
      // null = LLM failed, fall through to rule-based
    }

    // Fall back to rule-based filtering (same logic as email sequences)
    console.log(`[AI Filter] Using rule-based fallback for lead ${lead.id} (campaign ${campaign.id})`);
    const leadLike: Record<string, any> = {
      email: contact.primary_email,
      job_title: contact.job_title,
      company_name: contact.company,
      linkedin_url: contact.linkedin_url,
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      unsubscribed: false,
      status: contact.status,
    };

    const ruleResult = await applyRuleBasedFilters(supabase, leadLike, campaign.organization_id, {
      ai_filter_unlikely_reply: settings.ai_filter_unlikely_reply,
      ai_filter_hostile: settings.ai_filter_hostile,
    });

    if (ruleResult.action === 'skip') {
      console.log(`[AI Filter] Rule-based skip for lead ${lead.id}: ${ruleResult.reason}`);
    }
    return ruleResult.action;
  } catch (err) {
    console.error(`[AI Filter] Error for lead ${lead.id}:`, err);
    return 'send';
  }
}

/**
 * LLM-based lead filtering via OpenRouter.
 * Returns 'send' | 'skip' on success, or null if LLM call failed (caller should fall back).
 */
async function aiFilterLeadViaLLM(
  supabase: SupabaseClient<any>,
  campaign: Campaign,
  lead: LeadProgress,
  contact: Record<string, any>,
  filterChecks: string[],
  openRouterKey: string,
): Promise<'send' | 'skip' | null> {
  try {
    const profileSummary = [
      contact.first_name && contact.last_name ? `${contact.first_name} ${contact.last_name}` : null,
      contact.headline,
      contact.job_title ? `${contact.job_title} at ${contact.company || 'Unknown'}` : contact.company,
      contact.enrichment_data?.primary_need,
    ].filter(Boolean).join(' | ');

    if (!profileSummary.trim()) return null; // No meaningful profile data, fall back to rule-based

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        temperature: 0.1,
        max_tokens: 100,
        messages: [
          {
            role: 'system',
            content: `You are a lead qualification filter for B2B outreach. Evaluate the prospect profile and determine if they should be contacted.

Respond with ONLY a JSON object: { "action": "send" | "skip", "reason": "brief reason" }

Filters to check: ${filterChecks.join(', ')}

For "unlikely_to_reply": skip if the prospect is clearly a bot, spam account, inactive, or has zero relevance to B2B outreach (e.g., students, unemployed, fake profiles). Do NOT skip legitimate professionals.

For "hostile_prospect": skip only if profile contains explicit anti-outreach language, competitor employees, or known spam reporters. This should be very rare.

Default to "send" — only skip with high confidence.`,
          },
          {
            role: 'user',
            content: `Prospect: ${profileSummary}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`[AI Filter] OpenRouter API returned ${response.status} for lead ${lead.id}, falling back to rule-based`);
      return null;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    // Strip markdown code fences if present (e.g. ```json ... ```)
    const cleanText = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

    try {
      const parsed = JSON.parse(cleanText);
      if (parsed.action === 'skip' && typeof parsed.reason === 'string') {
        console.log(`[AI Filter] LLM skip for lead ${lead.id}: ${parsed.reason}`);
        return 'skip';
      }
      if (parsed.action === 'send') {
        return 'send';
      }
      // Invalid action value — fall back
      console.warn(`[AI Filter] LLM returned invalid action "${parsed.action}" for lead ${lead.id}, falling back`);
      return null;
    } catch {
      console.warn(`[AI Filter] LLM returned unparseable response for lead ${lead.id}: ${text.substring(0, 100)}`);
      return null;
    }
  } catch (err) {
    console.error(`[AI Filter] LLM error for lead ${lead.id}:`, err);
    return null;
  }
}

async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}
