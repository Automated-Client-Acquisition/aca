/**
 * AI SDR: Midday Sender (12:00 PM UTC daily)
 *
 * Pulls pending ai_sdr_queue items (scheduled_for <= now).
 * For Tier 1 leads: calls Claude (via OpenRouter) to generate a personalized
 * LinkedIn connection note (max 300 chars), then enrolls into the SDR Tier 1 campaign.
 * For Tier 2 leads: enrolls directly into the SDR Tier 2 campaign (standard template).
 * Respects daily LinkedIn invitation rate limits.
 * Logs run to ai_sdr_sessions.
 *
 * Prerequisite: Two campaigns must exist named '__sdr_tier_1__' and '__sdr_tier_2__'
 * (active status) in each org. Create them once in the UI.
 *
 * Manual trigger:
 *   curl -X POST <SUPABASE_URL>/functions/v1/ai-sdr-send \
 *     -H "Authorization: Bearer <ANON_KEY>" \
 *     -d '{"organization_id": "...", "dry_run": true}'
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_LINKEDIN_PER_RUN = 60; // Hard cap per invocation
const SDR_TIER1_CAMPAIGN_NAME = '__sdr_tier_1__';
const SDR_TIER2_CAMPAIGN_NAME = '__sdr_tier_2__';

interface RunOptions {
  organization_id?: string;
  dry_run?: boolean;
  limit?: number; // Override max (default MAX_LINKEDIN_PER_RUN)
}

// ============================================================================
// Entry point
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let options: RunOptions = {};
  try {
    options = await req.json();
  } catch { /* empty body ok */ }

  const {
    organization_id: targetOrgId,
    dry_run: dryRun = false,
    limit = MAX_LINKEDIN_PER_RUN,
  } = options;

  console.log(`[ai-sdr-send] Starting. dryRun=${dryRun} limit=${limit} targetOrg=${targetOrgId ?? 'all'}`);

  // Get orgs to process
  let orgIds: string[] = [];
  if (targetOrgId) {
    orgIds = [targetOrgId];
  } else {
    const { data: orgs } = await supabase
      .from('ai_sdr_queue')
      .select('organization_id')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString());
    const seen = new Set<string>();
    for (const row of orgs ?? []) {
      if (!seen.has(row.organization_id)) {
        seen.add(row.organization_id);
        orgIds.push(row.organization_id);
      }
    }
  }

  console.log(`[ai-sdr-send] Processing ${orgIds.length} org(s)`);

  const results: Record<string, unknown>[] = [];
  for (const orgId of orgIds) {
    const result = await processOrg(supabase, orgId, { dryRun, limit });
    results.push({ organization_id: orgId, ...result });
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// ============================================================================
// Per-org processing
// ============================================================================

async function processOrg(
  supabase: SupabaseClient<any>,
  orgId: string,
  opts: { dryRun: boolean; limit: number },
) {
  const { dryRun, limit } = opts;

  // Create session log
  let sessionId: string | null = null;
  if (!dryRun) {
    const { data: session } = await supabase
      .from('ai_sdr_sessions')
      .insert({
        organization_id: orgId,
        run_type: 'midday_sender',
        status: 'running',
        config: { dry_run: dryRun, org_id: orgId, max_limit: limit },
      })
      .select('id')
      .single();
    sessionId = session?.id ?? null;
  }

  const stats = { leads_processed: 0, actions_taken: 0, errors: 0 };

  try {
    // Check today's LinkedIn invitation budget
    const { data: usageRows } = await supabase
      .from('channel_usage_tracking')
      .select('messages_sent')
      .eq('organization_id', orgId)
      .eq('channel', 'linkedin_invitation')
      .eq('period_date', new Date().toISOString().slice(0, 10))
      .is('period_hour', null);

    const sentToday = (usageRows ?? []).reduce((sum, r) => sum + (r.messages_sent ?? 0), 0);
    const budgetRemaining = Math.max(0, limit - sentToday);

    console.log(`[ai-sdr-send] Org ${orgId}: ${sentToday} sent today, ${budgetRemaining} remaining`);

    if (budgetRemaining === 0) {
      const msg = `Daily LinkedIn invitation limit reached (${sentToday} sent)`;
      await finalizeSession(supabase, sessionId, stats, msg);
      return { ...stats, message: msg };
    }

    // Fetch pending queue items (capped at budget)
    const { data: queueItems, error: queueError } = await supabase
      .from('ai_sdr_queue')
      .select(`
        id, contact_id, action_type, priority, agent_decision,
        crm_contacts!inner(
          id, first_name, last_name, display_name, company, job_title,
          primary_email, primary_linkedin_url, tags, enrichment_data
        )
      `)
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: true })
      .order('scheduled_for', { ascending: true })
      .limit(budgetRemaining);

    if (queueError) {
      throw new Error(`Failed to fetch queue: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      const msg = 'No pending queue items';
      await finalizeSession(supabase, sessionId, stats, msg);
      return { ...stats, message: msg };
    }

    console.log(`[ai-sdr-send] Org ${orgId}: ${queueItems.length} items to process`);

    // Get SDR campaign IDs
    const campaignIds = await getSdrCampaignIds(supabase, orgId);
    if (!campaignIds.tier1 && !campaignIds.tier2) {
      const msg = `No SDR campaigns found. Create campaigns named '${SDR_TIER1_CAMPAIGN_NAME}' and '${SDR_TIER2_CAMPAIGN_NAME}'`;
      console.warn(`[ai-sdr-send] ${msg}`);
      await finalizeSession(supabase, sessionId, stats, msg);
      return { ...stats, warning: msg };
    }

    // Get OpenRouter key for Tier 1 personalization
    const openRouterKey = await getOrgOpenRouterKey(supabase, orgId);

    // Process each queue item
    for (const item of queueItems) {
      const contact = (item as Record<string, unknown>).crm_contacts as Record<string, unknown>;
      const agentDecision = (item as Record<string, unknown>).agent_decision as Record<string, unknown> ?? {};
      const tier = agentDecision.tier as number ?? 2;
      const isTier1 = tier === 1 && agentDecision.job_title;

      try {
        // Mark as in_progress
        if (!dryRun) {
          await supabase.from('ai_sdr_queue').update({
            status: 'in_progress',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', item.id);
        }

        let generatedNote: string | null = null;
        let enrolledCampaignId: string | null = null;
        let generatedData: Record<string, string> | undefined;

        if (isTier1 && campaignIds.tier1) {
          // --- TIER 1: Claude-personalized connection note ---
          if (openRouterKey) {
            generatedNote = await generateConnectionNote(openRouterKey, contact, agentDecision);
          }
          enrolledCampaignId = campaignIds.tier1;
          if (generatedNote) {
            generatedData = { connection_note: generatedNote };
          }
        } else if (campaignIds.tier2) {
          // --- TIER 2: Standard campaign automation ---
          enrolledCampaignId = campaignIds.tier2;
        }

        if (enrolledCampaignId && !dryRun) {
          // Enroll contact into the SDR campaign via campaign_lead_progress
          const progressRow: Record<string, unknown> = {
            campaign_id: enrolledCampaignId,
            contact_id: contact.id,
            status: 'pending',
            next_action_at: new Date().toISOString(),
          };
          if (generatedData) {
            progressRow.generated_data = generatedData;
          }

          const { error: enrollError } = await supabase
            .from('campaign_lead_progress')
            .upsert(progressRow, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true });

          if (enrollError) {
            throw new Error(`Failed to enroll contact: ${enrollError.message}`);
          }

          // Update queue item as completed
          await supabase.from('ai_sdr_queue').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            agent_decision: {
              ...agentDecision,
              message_used: generatedNote,
              enrolled_campaign: enrolledCampaignId,
            },
          }).eq('id', item.id);
        } else if (dryRun) {
          console.log(`[ai-sdr-send] DRY RUN - Would enroll contact ${contact.id} (Tier ${tier}) into campaign ${enrolledCampaignId}. Note: ${generatedNote ?? '(standard template)'}`);
        }

        stats.actions_taken++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ai-sdr-send] Error processing queue item ${item.id}:`, msg);
        stats.errors++;
        if (!dryRun) {
          await supabase.from('ai_sdr_queue').update({
            status: 'failed',
            error_message: msg,
            updated_at: new Date().toISOString(),
          }).eq('id', item.id);
        }
      }

      stats.leads_processed++;
    }

    const summary = `Processed ${stats.leads_processed} leads, enrolled ${stats.actions_taken} into campaigns. ${stats.errors} errors.${dryRun ? ' [DRY RUN]' : ''}`;
    console.log(`[ai-sdr-send] ${summary}`);
    await finalizeSession(supabase, sessionId, stats, summary);
    return { ...stats, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-sdr-send] Fatal error for org ${orgId}:`, msg);
    if (sessionId) {
      await supabase.from('ai_sdr_sessions').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        summary: `Fatal error: ${msg}`,
      }).eq('id', sessionId);
    }
    return { error: msg, ...stats };
  }
}

// ============================================================================
// Claude personalization (Tier 1 only)
// ============================================================================

async function generateConnectionNote(
  openRouterKey: string,
  contact: Record<string, unknown>,
  agentDecision: Record<string, unknown>,
): Promise<string> {
  const firstName = contact.first_name as string ?? '';
  const company = contact.company as string ?? '';
  const jobTitle = contact.job_title as string ?? '';
  const primaryNeed = agentDecision.primary_need as string ?? '';

  const systemPrompt = `You write LinkedIn connection request notes for B2B sales outreach.
RULES:
- Maximum 300 characters (STRICT - cut if needed)
- No emojis
- No "I noticed" or "I came across"
- Be specific to their role and company
- Sound like a peer, not a vendor
- Return ONLY the message text. No quotes, no explanation.`;

  const userPrompt = `Contact: ${firstName}
Title: ${jobTitle}${company ? ` at ${company}` : ''}${primaryNeed ? `\nContext: ${primaryNeed}` : ''}
Write a personalized LinkedIn connection note.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 150,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  // Sanitize before truncating, so the 300-char budget is spent on the message
  // rather than on preamble and em dashes.
  let note = sanitizeAIOutput((json.choices?.[0]?.message?.content ?? '').trim());

  // Enforce 300-char limit
  if (note.length > 300) {
    note = note.substring(0, 297) + '...';
  }

  return note;
}

// ============================================================================
// Helpers
// ============================================================================

async function getSdrCampaignIds(
  supabase: SupabaseClient<any>,
  orgId: string,
): Promise<{ tier1: string | null; tier2: string | null }> {
  const { data } = await supabase
    .from('linkedin_campaigns')
    .select('id, name')
    .eq('organization_id', orgId)
    .in('name', [SDR_TIER1_CAMPAIGN_NAME, SDR_TIER2_CAMPAIGN_NAME])
    .eq('status', 'active');

  const result = { tier1: null as string | null, tier2: null as string | null };
  for (const row of data ?? []) {
    if (row.name === SDR_TIER1_CAMPAIGN_NAME) result.tier1 = row.id;
    if (row.name === SDR_TIER2_CAMPAIGN_NAME) result.tier2 = row.id;
  }
  return result;
}

async function getOrgOpenRouterKey(
  supabase: SupabaseClient<any>,
  organizationId: string,
): Promise<string | null> {
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

async function finalizeSession(
  supabase: SupabaseClient<any>,
  sessionId: string | null,
  stats: { leads_processed: number; actions_taken: number; errors: number },
  summary: string,
) {
  if (!sessionId) return;
  await supabase.from('ai_sdr_sessions').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    leads_processed: stats.leads_processed,
    actions_taken: stats.actions_taken,
    errors: stats.errors,
    summary,
  }).eq('id', sessionId);
}

async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);
  const keyBytes = Uint8Array.from(
    encryptionKeyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, cryptoKey, ciphertextWithTag,
  );
  return new TextDecoder().decode(decrypted);
}
