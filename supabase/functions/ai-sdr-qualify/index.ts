/**
 * AI SDR: Morning Qualifier (8:00 AM UTC daily)
 *
 * Pulls up to 200 unscored contacts from active lead lists.
 * Classifies each by job title (Tier 0/1/2) using pure regex — no LLM cost.
 * Writes lead_score + tier tags back to crm_contacts.
 * Enqueues Tier 1 + Tier 2 contacts into ai_sdr_queue for the midday sender.
 * Optionally calls Claude (via OpenRouter) for Tier 1 deep company research.
 * Logs every run to ai_sdr_sessions.
 *
 * Manual trigger:
 *   curl -X POST <SUPABASE_URL>/functions/v1/ai-sdr-qualify \
 *     -H "Authorization: Bearer <ANON_KEY>" \
 *     -d '{"organization_id": "...", "dry_run": true, "limit": 10}'
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { classifySdrTier, type TierResult } from '../_shared/sdr-title-classifier.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RunOptions {
  organization_id?: string; // Run for a single org (for testing)
  dry_run?: boolean;        // Score but don't write back
  limit?: number;           // Override batch size (default 200)
  deep_research?: boolean;  // Call Claude for Tier 1 company research (default false)
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
  } catch {
    // Body is optional — empty body is fine
  }

  const {
    organization_id: targetOrgId,
    dry_run: dryRun = false,
    limit = 200,
    deep_research: deepResearch = false,
  } = options;

  console.log(`[ai-sdr-qualify] Starting. dryRun=${dryRun} limit=${limit} deepResearch=${deepResearch} targetOrg=${targetOrgId ?? 'all'}`);

  // Get orgs to process
  let orgIds: string[] = [];
  if (targetOrgId) {
    orgIds = [targetOrgId];
  } else {
    const { data: orgs, error } = await supabase
      .from('lead_lists')
      .select('organization_id')
      .eq('status', 'active');
    if (error) {
      console.error('[ai-sdr-qualify] Failed to fetch orgs:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Deduplicate
    const seen = new Set<string>();
    for (const row of orgs ?? []) {
      if (!seen.has(row.organization_id)) {
        seen.add(row.organization_id);
        orgIds.push(row.organization_id);
      }
    }
  }

  console.log(`[ai-sdr-qualify] Processing ${orgIds.length} org(s)`);

  const results: Record<string, unknown>[] = [];

  for (const orgId of orgIds) {
    const result = await processOrg(supabase, orgId, { dryRun, limit, deepResearch });
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
  opts: { dryRun: boolean; limit: number; deepResearch: boolean },
) {
  const { dryRun, limit, deepResearch } = opts;

  // Create session log
  let sessionId: string | null = null;
  if (!dryRun) {
    const { data: session } = await supabase
      .from('ai_sdr_sessions')
      .insert({
        organization_id: orgId,
        run_type: 'morning_qualifier',
        status: 'running',
        config: { batch_size: limit, dry_run: dryRun, org_id: orgId },
      })
      .select('id')
      .single();
    sessionId = session?.id ?? null;
  }

  const stats = {
    leads_processed: 0,
    tier_0: 0,
    tier_1: 0,
    tier_2: 0,
    queued: 0,
    errors: 0,
  };

  try {
    // Pull unscored contacts from active lists
    const { data: contacts, error: fetchError } = await supabase
      .from('crm_contacts')
      .select(`
        id, first_name, last_name, display_name, company, job_title,
        enrichment_data, tags
      `)
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .not('tags', 'cs', '{"sdr_scored"}') // contacts that don't have 'sdr_scored' tag
      .order('first_seen_at', { ascending: false })
      .limit(limit);

    // Filter to only contacts in active lead lists
    const contactsInLists = await filterToActiveLists(supabase, orgId, contacts ?? []);

    console.log(`[ai-sdr-qualify] Org ${orgId}: ${contactsInLists.length} unscored contacts found`);

    if (contactsInLists.length === 0) {
      await finalizeSession(supabase, sessionId, stats, 'No unscored contacts in active lists');
      return { ...stats, message: 'No unscored contacts found' };
    }

    // Get OpenRouter key (only needed for Tier 1 deep research)
    let openRouterKey: string | null = null;
    if (deepResearch) {
      openRouterKey = await getOrgOpenRouterKey(supabase, orgId);
    }

    // Process each contact
    const queueItems: Record<string, unknown>[] = [];
    const contactUpdates: { id: string; lead_score: number; tags: string[] }[] = [];

    for (const contact of contactsInLists) {
      try {
        const tierResult = classifySdrTier(contact.job_title ?? null);
        stats.leads_processed++;

        // Build new tag list (preserve existing tags, add tier + sdr_scored)
        const existingTags: string[] = contact.tags ?? [];
        const newTags = [...existingTags, tierResult.tag, 'sdr_scored'];

        if (tierResult.tier === 0) {
          stats.tier_0++;
          contactUpdates.push({ id: contact.id, lead_score: tierResult.leadScore, tags: newTags });
          // Tier 0 = not a fit, don't queue
          continue;
        }

        if (tierResult.tier === 1) {
          stats.tier_1++;
        } else {
          stats.tier_2++;
        }

        // Optional: call Claude for Tier 1 company research
        let primaryNeed: string | undefined;
        if (deepResearch && tierResult.tier === 1 && openRouterKey) {
          primaryNeed = await researchTier1Contact(openRouterKey, contact);
        }

        contactUpdates.push({ id: contact.id, lead_score: tierResult.leadScore, tags: newTags });

        queueItems.push({
          organization_id: orgId,
          contact_id: contact.id,
          action_type: 'send_connection',
          priority: tierResult.priority,
          scheduled_for: new Date().toISOString(),
          status: 'pending',
          agent_decision: {
            tier: tierResult.tier,
            score: tierResult.leadScore,
            job_title: contact.job_title,
            company: contact.company,
            primary_need: primaryNeed ?? null,
          },
        });
        stats.queued++;
      } catch (err) {
        console.error(`[ai-sdr-qualify] Error processing contact ${contact.id}:`, err);
        stats.errors++;
      }
    }

    // Write back to DB (skip in dry_run)
    if (!dryRun) {
      // Batch update contacts
      for (const update of contactUpdates) {
        await supabase
          .from('crm_contacts')
          .update({ lead_score: update.lead_score, tags: update.tags, updated_at: new Date().toISOString() })
          .eq('id', update.id)
          .eq('organization_id', orgId);
      }

      // Insert queue items
      if (queueItems.length > 0) {
        const { error: queueError } = await supabase
          .from('ai_sdr_queue')
          .insert(queueItems);
        if (queueError) {
          console.error('[ai-sdr-qualify] Failed to insert queue items:', queueError);
          stats.errors++;
        }
      }
    }

    const summary = `Qualified ${stats.leads_processed} leads: ${stats.tier_1} Tier 1, ${stats.tier_2} Tier 2, ${stats.tier_0} Not a Fit. Queued ${stats.queued} for outreach.${dryRun ? ' [DRY RUN - no writes]' : ''}`;
    console.log(`[ai-sdr-qualify] ${summary}`);

    await finalizeSession(supabase, sessionId, stats, summary);
    return { ...stats, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-sdr-qualify] Fatal error for org ${orgId}:`, msg);
    if (sessionId) {
      await supabase.from('ai_sdr_sessions').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        summary: `Fatal error: ${msg}`,
        errors: stats.errors + 1,
      }).eq('id', sessionId);
    }
    return { error: msg, ...stats };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Filter contacts to only those in at least one active lead list for this org.
 */
async function filterToActiveLists(
  supabase: SupabaseClient<any>,
  orgId: string,
  contacts: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (contacts.length === 0) return [];

  const contactIds = contacts.map((c) => c.id as string);

  const { data: members } = await supabase
    .from('lead_list_members')
    .select('contact_id, list_id, lead_lists!inner(status, organization_id)')
    .in('contact_id', contactIds)
    .eq('lead_lists.organization_id', orgId)
    .eq('lead_lists.status', 'active');

  const validContactIds = new Set((members ?? []).map((m) => m.contact_id as string));
  return contacts.filter((c) => validContactIds.has(c.id as string));
}

/**
 * Get the org's OpenRouter API key (same pattern as campaign-processor).
 */
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

/**
 * Optional: use Claude to generate a short "primary need" summary for Tier 1 leads.
 * Stored in agent_decision.primary_need for use by the Midday Sender.
 */
async function researchTier1Contact(
  openRouterKey: string,
  contact: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const firstName = contact.first_name as string ?? '';
    const company = contact.company as string ?? '';
    const jobTitle = contact.job_title as string ?? '';

    if (!company && !jobTitle) return undefined;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.6',
        messages: [
          {
            role: 'system',
            content: `You are a B2B sales intelligence assistant. Given a prospect's job title and company,
write a 1-sentence hypothesis about their primary business pain point related to sales or marketing.
Return ONLY the pain point sentence. No preamble, no explanation, max 100 characters.`,
          },
          {
            role: 'user',
            content: `Title: ${jobTitle}\nCompany: ${company}`,
          },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
    });

    if (!response.ok) return undefined;
    const json = await response.json();
    return (json.choices?.[0]?.message?.content ?? '').trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finalize the session row with stats + summary.
 */
async function finalizeSession(
  supabase: SupabaseClient<any>,
  sessionId: string | null,
  stats: Record<string, number>,
  summary: string,
) {
  if (!sessionId) return;
  await supabase.from('ai_sdr_sessions').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    leads_processed: stats.leads_processed,
    actions_taken: stats.queued,
    errors: stats.errors,
    summary,
  }).eq('id', sessionId);
}

/**
 * AES-256-GCM decryption (same implementation as campaign-processor).
 */
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
