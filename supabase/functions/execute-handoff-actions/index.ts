/**
 * Execute Handoff Actions
 *
 * Executes delivery actions for a handoff trigger:
 * - push_to_ghl: Push contact to GHL with tag, conversation thread, and lead source custom fields
 * - webhook: POST lead data to an external URL
 * - notify_team: (future) Send in-app notification
 *
 * Called by:
 * - evaluateHandoffTriggers() in rule-engine.ts (auto-triggered, fire-and-forget)
 * - useManualHandoff() in useRules.ts (manual handoff from inbox)
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient , type SupabaseClient } from 'npm:@supabase/supabase-js@^2.39.0';
import {
  getGHLAccessToken,
  upsertGHLContact,
} from '../_shared/ghl-calendar-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExecuteRequest {
  triggerId: string;
  contactId: string;
  conversationId: string;
  organizationId: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { triggerId, contactId, conversationId, organizationId }: ExecuteRequest = await req.json();

    if (!triggerId || !contactId || !conversationId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'triggerId, contactId, conversationId, and organizationId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch the trigger's actions config
    const { data: trigger, error: triggerError } = await supabase
      .from('crm_handoff_triggers')
      .select('actions')
      .eq('id', triggerId)
      .single();

    if (triggerError || !trigger) {
      return new Response(
        JSON.stringify({ success: false, error: 'Trigger not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const actions = (trigger.actions || []) as Array<{ type: string; config?: Record<string, unknown> }>;
    if (actions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No actions configured', actionsExecuted: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const actionsExecuted: Array<{ type: string; success: boolean; result?: unknown; error?: string }> = [];

    for (const action of actions) {
      try {
        if (action.type === 'push_to_ghl') {
          const result = await executeGHLPush(supabase, organizationId, contactId, conversationId, action.config || {});
          actionsExecuted.push({ type: 'push_to_ghl', success: true, result });
        } else if (action.type === 'webhook') {
          const result = await executeWebhook(supabase, organizationId, contactId, conversationId, action.config || {});
          actionsExecuted.push({ type: 'webhook', success: true, result });
        } else if (action.type === 'notify_team') {
          actionsExecuted.push({ type: 'notify_team', success: true, result: { logged: true } });
        } else {
          actionsExecuted.push({ type: action.type, success: false, error: `Unknown action type: ${action.type}` });
        }
      } catch (err) {
        console.error(`[execute-handoff-actions] Action ${action.type} failed:`, err);
        actionsExecuted.push({
          type: action.type,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update the most recent handoff log entry with executed actions
    await supabase
      .from('crm_handoff_log')
      .update({ actions_executed: actionsExecuted })
      .eq('trigger_id', triggerId)
      .eq('conversation_id', conversationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1);

    console.log(`[execute-handoff-actions] Executed ${actionsExecuted.length} actions for trigger ${triggerId}`);

    return new Response(
      JSON.stringify({ success: true, actionsExecuted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[execute-handoff-actions] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ============================================================================
// GHL Push with Tag + Custom Fields
// ============================================================================

async function executeGHLPush(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  conversationId: string,
  config: Record<string, unknown>,
): Promise<{ ghlContactId: string }> {
  // 1. Fetch contact data
  const { data: contact, error: contactError } = await supabase
    .from('crm_contacts')
    .select('id, first_name, last_name, display_name, primary_email, primary_phone, company, company_website, job_title, primary_linkedin_url, enrichment_data')
    .eq('id', contactId)
    .eq('organization_id', organizationId)
    .single();

  if (contactError || !contact) {
    throw new Error('Contact not found');
  }

  if (!contact.primary_email && !contact.primary_phone) {
    throw new Error('Contact must have at least an email or phone number');
  }

  // 2. Resolve field mappings
  const fieldMappings = (config.field_mappings || []) as Array<{ ghl_field_id: string; value_source: string }>;

  // Lazy-load expensive data only if needed
  let conversationThread: string | null = null;
  let conversationChannel: string | null = null;

  const needsThread = fieldMappings.some((m) => m.value_source === 'conversation_thread');
  const needsChannel = fieldMappings.some((m) => m.value_source === 'lead_source');

  if (needsThread) {
    conversationThread = await buildConversationThread(supabase, conversationId);
  }
  if (needsChannel) {
    const { data: conv } = await supabase
      .from('crm_conversations')
      .select('channel')
      .eq('id', conversationId)
      .single();
    conversationChannel = formatChannelName(conv?.channel || 'unknown');
  }

  // 3. Build custom fields array from mappings
  const customFields: Array<{ key: string; field_value: string }> = [];
  for (const mapping of fieldMappings) {
    if (!mapping.ghl_field_id || !mapping.value_source) continue;
    const value = resolveValueSource(mapping.value_source, contact, conversationThread, conversationChannel);
    if (value) {
      customFields.push({ key: mapping.ghl_field_id, field_value: value });
    }
  }

  // 4. Get GHL access token
  const { accessToken, locationId } = await getGHLAccessToken(supabase, organizationId);

  // 5. Build tags
  const tag = config.tag as string | undefined;
  const tags = tag ? [tag] : [];

  // 7. Push to GHL
  console.log(`[execute-handoff-actions] Pushing contact ${contactId} to GHL with ${tags.length} tags, ${customFields.length} custom fields`);

  const ghlResult = await upsertGHLContact(accessToken, locationId, {
    email: contact.primary_email || undefined,
    phone: contact.primary_phone || undefined,
    firstName: contact.first_name || undefined,
    lastName: contact.last_name || undefined,
    companyName: contact.company || undefined,
    website: contact.company_website || undefined,
    jobTitle: contact.job_title || undefined,
    linkedinUrl: contact.primary_linkedin_url || undefined,
    tags: tags.length > 0 ? tags : undefined,
    customFields: customFields.length > 0 ? customFields : undefined,
    source: 'ACA Handoff',
  });

  return { ghlContactId: ghlResult.id };
}

// ============================================================================
// Value Source Resolver
// ============================================================================

function resolveValueSource(
  source: string,
  contact: Record<string, unknown>,
  thread: string | null,
  channel: string | null,
): string {
  switch (source) {
    case 'conversation_thread':
      return thread || '';
    case 'lead_source':
      return channel || '';
    case 'contact_name':
      return (contact.display_name as string) || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '';
    case 'contact_email':
      return (contact.primary_email as string) || '';
    case 'contact_phone':
      return (contact.primary_phone as string) || '';
    case 'contact_company':
      return (contact.company as string) || '';
    case 'contact_job_title':
      return (contact.job_title as string) || '';
    case 'contact_linkedin':
      return (contact.primary_linkedin_url as string) || '';
    case 'contact_website':
      return (contact.company_website as string) || '';
    case 'company_niche':
      return getEnrichment(contact, 'company_niche');
    case 'company_offering':
      return getEnrichment(contact, 'company_offering');
    case 'company_target':
      return getEnrichment(contact, 'company_target');
    case 'primary_need':
      return getEnrichment(contact, 'primary_need');
    default:
      return '';
  }
}

function getEnrichment(contact: Record<string, unknown>, key: string): string {
  const enrichment = contact.enrichment_data as Record<string, unknown> | null;
  if (!enrichment) return '';
  const val = enrichment[key];
  if (val == null) return '';
  return typeof val === 'string' ? val : JSON.stringify(val);
}

// ============================================================================
// Conversation Thread Builder
// ============================================================================

async function buildConversationThread(
  supabase: SupabaseClient<any>,
  conversationId: string,
): Promise<string> {
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('direction, content, created_at, sender_type')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(50);

  if (!messages || messages.length === 0) return '';

  return messages
    .map((m: { direction: string; content: string; created_at: string; sender_type: string }) => {
      const time = new Date(m.created_at).toISOString().replace('T', ' ').substring(0, 16);
      const sender = m.direction === 'inbound' ? 'Lead' : (m.sender_type === 'ai' ? 'AI Agent' : 'Agent');
      const content = (m.content || '').replace(/\n/g, ' ').substring(0, 500);
      return `[${time}] ${sender}: ${content}`;
    })
    .join('\n');
}

// ============================================================================
// Channel Name Formatter
// ============================================================================

function formatChannelName(channel: string): string {
  const channelNames: Record<string, string> = {
    linkedin: 'LinkedIn',
    email: 'Email',
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    telegram: 'Telegram',
    sms: 'SMS',
    webchat: 'Web Chat',
  };
  return channelNames[channel] || channel;
}

// ============================================================================
// Webhook Execution
// ============================================================================

async function executeWebhook(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  conversationId: string,
  config: Record<string, unknown>,
): Promise<{ status: number }> {
  const url = config.url as string;
  if (!url) throw new Error('No webhook URL configured');

  // Fetch contact data for the webhook payload
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('id, first_name, last_name, display_name, primary_email, primary_phone, company, job_title, primary_linkedin_url')
    .eq('id', contactId)
    .single();

  // Fetch conversation channel
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('channel')
    .eq('id', conversationId)
    .single();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'lead_handoff',
      timestamp: new Date().toISOString(),
      organizationId,
      contact: contact || { id: contactId },
      conversationId,
      channel: conversation?.channel || 'unknown',
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }

  return { status: response.status };
}
