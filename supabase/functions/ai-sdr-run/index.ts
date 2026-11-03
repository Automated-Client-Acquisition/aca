/**
 * AI SDR Run - Orchestration Edge Function
 *
 * Thin orchestration layer for the autonomous AI SDR.
 * Claude calls this to get its work queue, log actions, and trigger scoring.
 * All SQL, budget math, and state management lives here - Claude never writes SQL.
 *
 * Actions:
 *   get_work_queue    - Returns new connections, ready leads, unscored leads, budget, pipeline health
 *   log_action        - Logs an SDR action (connection sent, DM sent, sequence created, etc.)
 *   trigger_scoring   - Calls analyze-companies-batch for a batch of contact IDs
 *   get_status        - Returns pipeline health + recent session summary
 *
 * Endpoint: POST /ai-sdr-run
 * Body: { organization_id, action, ...params }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { AuthError } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { organization_id, action } = body;

    if (!organization_id) return json({ error: 'organization_id required' }, 400);

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (service key, or a user JWT / aca_ token for that org).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      const e = authErr as AuthError;
      return json({ error: e?.message ?? 'Unauthorized' }, e?.status ?? 401);
    }

    switch (action) {
      case 'get_work_queue':
        return json(await getWorkQueue(supabase, organization_id, body));

      case 'log_action':
        return json(await logAction(supabase, organization_id, body));

      case 'trigger_scoring':
        return json(await triggerScoring(supabase, organization_id, body));

      case 'get_status':
        return json(await getStatus(supabase, organization_id));

      default:
        return json({ error: `Unknown action: ${action}. Use get_work_queue, log_action, trigger_scoring, or get_status` }, 400);
    }
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    console.error('[ai-sdr-run] Error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
});

// =============================================================================
// get_work_queue
// =============================================================================

async function getWorkQueue(supabase: any, orgId: string, body: any) {
  const limit = body.limit || 50;

  // Run all queries in parallel
  const [
    newConnections,
    tier1Ready,
    tier2Ready,
    unscoredLeads,
    budget,
    pipelineHealth,
  ] = await Promise.all([
    queryNewConnections(supabase, orgId, limit),
    queryTier1Ready(supabase, orgId, limit),
    queryTier2Ready(supabase, orgId, limit),
    queryUnscoredLeads(supabase, orgId, limit),
    queryBudget(supabase, orgId),
    queryPipelineHealth(supabase, orgId),
  ]);

  return {
    new_connections: newConnections,
    ready_for_outreach: {
      tier1: tier1Ready,
      tier2: tier2Ready,
    },
    unscored_leads: unscoredLeads,
    budget,
    pipeline_health: pipelineHealth,
  };
}

// Contacts who accepted connection request but haven't been DM'd yet
async function queryNewConnections(supabase: any, orgId: string, limit: number) {
  const { data, error } = await supabase.rpc('ai_sdr_new_connections', {
    p_org_id: orgId,
    p_limit: limit,
  }).catch(() => ({ data: null, error: 'RPC not found' }));

  // Fallback to direct query if RPC doesn't exist yet
  if (error || !data) {
    const { data: contacts } = await supabase
      .from('crm_contacts')
      .select(`
        id, display_name, job_title, company, tags, enrichment_data,
        primary_linkedin_url, primary_email
      `)
      .eq('organization_id', orgId)
      .contains('tags', ['sdr_outreach_sent'])
      .not('tags', 'cs', '{sdr_connected}')
      .not('tags', 'cs', '{sdr_do_not_contact}')
      .order('first_seen_at', { ascending: false })
      .limit(limit);

    // Filter to those who actually have a linkedin conversation (accepted)
    if (!contacts?.length) return [];

    const contactIds = contacts.map((c: any) => c.id);
    const { data: convs } = await supabase
      .from('crm_conversations')
      .select('contact_id, id, unipile_chat_id, channel_account_id')
      .eq('organization_id', orgId)
      .eq('channel', 'linkedin')
      .in('contact_id', contactIds);

    const connectedIds = new Set((convs || []).map((c: any) => c.contact_id));
    const convMap = new Map((convs || []).map((c: any) => [c.contact_id, c]));

    return contacts
      .filter((c: any) => connectedIds.has(c.id))
      .map((c: any) => {
        const conv = convMap.get(c.id);
        return {
          ...c,
          conversation_id: conv?.id,
          unipile_chat_id: conv?.unipile_chat_id,
          channel_account_id: conv?.channel_account_id,
        };
      });
  }

  return data;
}

// Contacts scored 80+ ICP and 70+ DM, not yet contacted
async function queryTier1Ready(supabase: any, orgId: string, limit: number) {
  const { data } = await supabase
    .from('crm_contacts')
    .select(`
      id, display_name, job_title, company, primary_email,
      primary_linkedin_url, enrichment_data, tags
    `)
    .eq('organization_id', orgId)
    .not('tags', 'cs', '{sdr_outreach_sent}')
    .not('tags', 'cs', '{sdr_do_not_contact}')
    .not('tags', 'cs', '{sdr_skip}')
    .contains('tags', ['sdr_ready_tier1'])
    .order('first_seen_at', { ascending: false })
    .limit(limit);

  if (!data?.length) return [];

  // Enrich with ICP scores
  const contactIds = data.map((c: any) => c.id);
  const { data: scores } = await supabase
    .from('contact_product_scores')
    .select('contact_id, icp_score, decision_maker_score, primary_need, primary_need_reasoning')
    .eq('organization_id', orgId)
    .in('contact_id', contactIds);

  const scoreMap = new Map((scores || []).map((s: any) => [s.contact_id, s]));

  return data.map((c: any) => ({
    ...c,
    scores: scoreMap.get(c.id) || null,
  }));
}

// Contacts scored 50+, not yet contacted
async function queryTier2Ready(supabase: any, orgId: string, limit: number) {
  const { data } = await supabase
    .from('crm_contacts')
    .select(`
      id, display_name, job_title, company, primary_email,
      primary_linkedin_url, tags
    `)
    .eq('organization_id', orgId)
    .not('tags', 'cs', '{sdr_outreach_sent}')
    .not('tags', 'cs', '{sdr_do_not_contact}')
    .not('tags', 'cs', '{sdr_skip}')
    .contains('tags', ['sdr_ready_tier2'])
    .order('first_seen_at', { ascending: false })
    .limit(limit);

  return data || [];
}

// Contacts in active lead lists with no ICP score
async function queryUnscoredLeads(supabase: any, orgId: string, limit: number) {
  // Use a raw query for the JOIN logic
  const { data } = await supabase.rpc('ai_sdr_unscored_leads', {
    p_org_id: orgId,
    p_limit: limit,
  }).catch(() => ({ data: null }));

  if (data) return data;

  // Fallback: get contacts in active lists that don't have scores
  const { data: lists } = await supabase
    .from('lead_lists')
    .select('id')
    .eq('organization_id', orgId)
    .eq('status', 'active');

  if (!lists?.length) return [];

  const listIds = lists.map((l: any) => l.id);
  const { data: members } = await supabase
    .from('lead_list_members')
    .select('contact_id')
    .in('lead_list_id', listIds)
    .limit(500);

  if (!members?.length) return [];

  const memberIds = [...new Set(members.map((m: any) => m.contact_id))];

  // Get contacts that haven't been scored or tagged
  const { data: contacts } = await supabase
    .from('crm_contacts')
    .select('id, display_name, job_title, company, primary_linkedin_url, company_website, ai_analysis_status')
    .eq('organization_id', orgId)
    .in('id', memberIds.slice(0, limit * 2)) // over-fetch to allow filtering
    .not('tags', 'cs', '{sdr_analysis_triggered}')
    .not('tags', 'cs', '{sdr_scored}')
    .not('tags', 'cs', '{sdr_ready_tier1}')
    .not('tags', 'cs', '{sdr_ready_tier2}')
    .not('tags', 'cs', '{sdr_skip}')
    .not('tags', 'cs', '{sdr_do_not_contact}')
    .limit(limit);

  // Filter out those that already have product scores
  if (!contacts?.length) return [];

  const contactIds = contacts.map((c: any) => c.id);
  const { data: existingScores } = await supabase
    .from('contact_product_scores')
    .select('contact_id')
    .eq('organization_id', orgId)
    .in('contact_id', contactIds);

  const scoredSet = new Set((existingScores || []).map((s: any) => s.contact_id));

  return contacts.filter((c: any) => !scoredSet.has(c.id));
}

// LinkedIn + email budget for today
async function queryBudget(supabase: any, orgId: string) {
  // Get LinkedIn accounts
  const { data: accounts } = await supabase
    .from('unipile_accounts')
    .select('id, display_name, provider, status')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .eq('provider', 'LINKEDIN');

  // Get today's usage
  const today = new Date().toISOString().split('T')[0];
  const { data: usage } = await supabase
    .from('channel_usage_tracking')
    .select('channel_account_id, messages_sent, effective_limit, usage_percent')
    .eq('organization_id', orgId)
    .eq('period_date', today);

  const usageMap = new Map((usage || []).map((u: any) => [u.channel_account_id, u]));

  const linkedinAccounts = (accounts || []).map((a: any) => {
    const u = usageMap.get(a.id);
    const sent = u?.messages_sent || 0;
    const connectionLimit = 20; // conservative daily limit
    const dmLimit = 50;
    return {
      id: a.id,
      name: a.display_name,
      connections_remaining: Math.max(0, connectionLimit - sent),
      dms_remaining: Math.max(0, dmLimit - sent),
      usage_percent: u?.usage_percent || 0,
    };
  });

  // Email mailbox count - only connected ones
  const { count: mailboxCount } = await supabase
    .from('email_mailboxes')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('imap_connected', true);

  return {
    linkedin_accounts: linkedinAccounts,
    total_linkedin_connections_remaining: linkedinAccounts.reduce((s: number, a: any) => s + a.connections_remaining, 0),
    total_linkedin_dms_remaining: linkedinAccounts.reduce((s: number, a: any) => s + a.dms_remaining, 0),
    email_mailbox_count: mailboxCount || 0,
  };
}

// Pipeline health snapshot
async function queryPipelineHealth(supabase: any, orgId: string) {
  // Count contacts by SDR tag
  const tagCounts = async (tag: string) => {
    const { count } = await supabase
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .contains('tags', [tag]);
    return count || 0;
  };

  const [tier1Ready, tier2Ready, outreachSent, connected, skip, scoringTriggered] = await Promise.all([
    tagCounts('sdr_ready_tier1'),
    tagCounts('sdr_ready_tier2'),
    tagCounts('sdr_outreach_sent'),
    tagCounts('sdr_connected'),
    tagCounts('sdr_skip'),
    tagCounts('sdr_analysis_triggered'),
  ]);

  // Subtract already-sent from ready counts
  const tier1Unsent = Math.max(0, tier1Ready - outreachSent);
  const tier2Unsent = Math.max(0, tier2Ready - outreachSent);

  return {
    tier1_ready: tier1Unsent,
    tier2_ready: tier2Unsent,
    outreach_sent: outreachSent,
    connected: connected,
    scoring_in_progress: scoringTriggered,
    skipped: skip,
    needs_refill: (tier1Unsent + tier2Unsent) < 50 && scoringTriggered < 50,
  };
}

// =============================================================================
// log_action
// =============================================================================

async function logAction(supabase: any, orgId: string, body: any) {
  const { contact_id, action_type, details, channel, account_id } = body;

  if (!contact_id || !action_type) {
    return { error: 'contact_id and action_type required' };
  }

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('id', contact_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!contact) throw new AuthError('Contact not found', 404);

  // Log to contact notes for visibility
  const noteContent = `[AI SDR] ${action_type}: ${details || ''}`.trim();
  await supabase
    .from('crm_contact_notes')
    .insert({
      contact_id,
      organization_id: orgId,
      content: noteContent,
      is_pinned: false,
    });

  // If this is a connection send or DM, also auto-enable AI on the conversation
  if (action_type === 'connection_sent' || action_type === 'dm_sent') {
    await enableAutopilotOnConversation(supabase, orgId, contact_id);
  }

  return { success: true, logged: action_type };
}

// =============================================================================
// trigger_scoring
// =============================================================================

async function triggerScoring(supabase: any, orgId: string, body: any) {
  const { contact_ids } = body;

  if (!contact_ids?.length) return { error: 'contact_ids array required' };

  // Only act on contacts that belong to this org (the tagging below works by id alone).
  const { data: ownedContacts, error: ownedError } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', contact_ids);
  if (ownedError) throw new Error(`Failed to verify contacts: ${ownedError.message}`);
  const ownedIds: string[] = (ownedContacts || []).map((c: any) => c.id);
  if (!ownedIds.length) throw new AuthError('Contacts not found', 404);

  // Get a Unipile LinkedIn account for enrichment
  const { data: accounts } = await supabase
    .from('unipile_accounts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .eq('provider', 'LINKEDIN')
    .limit(1);

  const unipileAccountId = accounts?.[0]?.id || null;

  // Call analyze-companies-batch internally
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const resp = await fetch(`${supabaseUrl}/functions/v1/analyze-companies-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      contactIds: ownedIds,
      organizationId: orgId,
      unipileAccountId: unipileAccountId,
    }),
  });

  const result = await resp.json();

  // Use raw SQL to append tag (supabase-js can't do array_append)
  for (const id of ownedIds) {
    await supabase.rpc('append_contact_tag', {
      p_contact_id: id,
      p_tag: 'sdr_analysis_triggered',
    }).catch(() => {
      // If RPC doesn't exist, fall back to reading + writing tags
      return appendTagFallback(supabase, orgId, id, 'sdr_analysis_triggered');
    });
  }

  return {
    success: true,
    triggered: ownedIds.length,
    batch_result: result,
  };
}

async function appendTagFallback(supabase: any, orgId: string, contactId: string, tag: string) {
  const { data } = await supabase
    .from('crm_contacts')
    .select('tags')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single();

  const tags = data?.tags || [];
  if (!tags.includes(tag)) {
    tags.push(tag);
    await supabase
      .from('crm_contacts')
      .update({ tags })
      .eq('id', contactId)
      .eq('organization_id', orgId);
  }
}

// =============================================================================
// get_status
// =============================================================================

async function getStatus(supabase: any, orgId: string) {
  const health = await queryPipelineHealth(supabase, orgId);
  const budget = await queryBudget(supabase, orgId);

  return {
    pipeline_health: health,
    budget,
    summary: `Pipeline: ${health.tier1_ready} Tier 1 ready, ${health.tier2_ready} Tier 2 ready, ${health.outreach_sent} contacted, ${health.connected} connected. LinkedIn budget: ${budget.total_linkedin_connections_remaining} connections remaining across ${budget.linkedin_accounts.length} accounts.`,
  };
}

// =============================================================================
// Auto-enable autopilot on SDR conversations
// =============================================================================

async function enableAutopilotOnConversation(supabase: any, orgId: string, contactId: string) {
  // Find the default agent profile (or one named "SDR")
  const { data: profiles } = await supabase
    .from('ai_agent_profiles')
    .select('id, name, is_default')
    .eq('organization_id', orgId)
    .or('is_default.eq.true,name.ilike.%SDR%')
    .limit(2);

  if (!profiles?.length) return;

  // Prefer SDR-named profile, fall back to default
  const sdrProfile = profiles.find((p: any) => p.name.toLowerCase().includes('sdr')) || profiles[0];

  // Enable AI on all conversations for this contact
  await supabase
    .from('crm_conversations')
    .update({
      ai_enabled: true,
      agent_profile_id: sdrProfile.id,
    })
    .eq('contact_id', contactId)
    .eq('organization_id', orgId);
}
