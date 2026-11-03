/**
 * AI Lead Filter Module
 *
 * Lightweight AI scoring for unlikely-to-reply leads
 * and hostile prospect detection.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AIFilterResult {
  action: 'send' | 'skip';
  reason?: string;
  score?: number;
}

export interface AIFilterSettings {
  ai_filter_unlikely_reply: 'send' | 'skip';
  ai_filter_hostile: 'send' | 'skip';
}

const DEFAULT_SETTINGS: AIFilterSettings = {
  ai_filter_unlikely_reply: 'send',
  ai_filter_hostile: 'send',
};

export async function checkUnlikelyToReply(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  organizationId: string
): Promise<AIFilterResult> {
  let score = 0.5;

  const { data: pastSends, error: sendError } = await supabase
    .from('email_send_log')
    .select('status')
    .eq('organization_id', organizationId)
    .eq('recipient_email', lead.email)
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced'])
    .limit(20);

  if (!sendError && pastSends && pastSends.length > 0) {
    const opens = pastSends.filter((s: any) => s.status === 'opened' || s.status === 'clicked' || s.status === 'replied').length;
    const bounces = pastSends.filter((s: any) => s.status === 'bounced').length;
    const total = pastSends.length;

    if (bounces > 0) {
      score -= 0.3;
    }

    if (opens > 0) {
      score += 0.2 * (opens / total);
    }

    if (total >= 5 && opens === 0) {
      score -= 0.2;
    }
  }

  if (lead.job_title) score += 0.05;
  if (lead.company_name) score += 0.05;
  if (lead.linkedin_url) score += 0.05;

  score = Math.max(0, Math.min(1, score));

  if (score < 0.3) {
    return { action: 'skip', reason: 'unlikely_to_reply', score };
  }

  return { action: 'send', score };
}

export async function checkHostileProspect(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  organizationId: string
): Promise<AIFilterResult> {
  const { data: complaints } = await supabase
    .from('email_send_log')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('recipient_email', lead.email)
    .eq('status', 'spam')
    .limit(1);

  if (complaints && complaints.length > 0) {
    return { action: 'skip', reason: 'previous_spam_complaint', score: 0 };
  }

  const { data: bounces } = await supabase
    .from('email_send_log')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('recipient_email', lead.email)
    .eq('status', 'bounced')
    .limit(1);

  if (bounces && bounces.length > 0) {
    return { action: 'skip', reason: 'previously_bounced', score: 0.1 };
  }

  if (lead.unsubscribed || lead.status === 'unsubscribed') {
    return { action: 'skip', reason: 'unsubscribed', score: 0 };
  }

  // tags is TEXT[] from DB — could be null or unexpected type
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  if (tags.includes('hostile') || tags.includes('do-not-contact')) {
    return { action: 'skip', reason: 'flagged_hostile', score: 0 };
  }

  return { action: 'send', score: 1.0 };
}

export async function applyAIFilters(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  organizationId: string,
  settings: Partial<AIFilterSettings> = {}
): Promise<AIFilterResult> {
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };

  if (mergedSettings.ai_filter_hostile === 'skip') {
    const hostileResult = await checkHostileProspect(supabase, lead, organizationId);
    if (hostileResult.action === 'skip') {
      return hostileResult;
    }
  }

  if (mergedSettings.ai_filter_unlikely_reply === 'skip') {
    const replyResult = await checkUnlikelyToReply(supabase, lead, organizationId);
    if (replyResult.action === 'skip') {
      return replyResult;
    }
  }

  return { action: 'send', score: 1.0 };
}
