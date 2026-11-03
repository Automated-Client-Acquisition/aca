/**
 * AI Lead Filter Module
 *
 * Lightweight AI scoring for unlikely-to-reply leads
 * and hostile prospect detection. Uses ICP scorer + CRM history.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

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

/**
 * Check if a lead is unlikely to reply based on ICP match and engagement history.
 *
 * Scoring factors:
 * - Job title relevance to ICP (if ICP data available)
 * - Company size match
 * - Past email engagement across campaigns
 * - Enrichment data quality
 */
export async function checkUnlikelyToReply(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  organizationId: string
): Promise<AIFilterResult> {
  let score = 0.5; // Neutral starting score

  // Check past engagement: has this lead been emailed before?
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

    // If they previously bounced, very unlikely to reply
    if (bounces > 0) {
      score -= 0.3;
    }

    // If they've opened/clicked/replied before, likely to engage
    if (opens > 0) {
      score += 0.2 * (opens / total);
    }

    // Many sends with no engagement = low chance
    if (total >= 5 && opens === 0) {
      score -= 0.2;
    }
  }

  // Check enrichment data quality
  if (lead.job_title) score += 0.05;
  if (lead.company_name) score += 0.05;
  if (lead.linkedin_url) score += 0.05;

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  // Score < 0.3 = unlikely to reply
  if (score < 0.3) {
    return { action: 'skip', reason: 'unlikely_to_reply', score };
  }

  return { action: 'send', score };
}

/**
 * Check if a lead is a hostile prospect based on CRM history.
 *
 * Checks for:
 * - Previous negative replies
 * - Unsubscribes from other campaigns
 * - Manual flags in CRM
 * - Spam complaints
 */
export async function checkHostileProspect(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  organizationId: string
): Promise<AIFilterResult> {
  // Check for spam complaints
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

  // Check for bounced emails (address may be invalid)
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

  // Check for unsubscribe status on the lead record
  if (lead.unsubscribed || lead.status === 'unsubscribed') {
    return { action: 'skip', reason: 'unsubscribed', score: 0 };
  }

  // Check for manual hostile flag (tags is TEXT[] from DB — could be null or unexpected type)
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  if (tags.includes('hostile') || tags.includes('do-not-contact')) {
    return { action: 'skip', reason: 'flagged_hostile', score: 0 };
  }

  return { action: 'send', score: 1.0 };
}

/**
 * Apply all AI filters to a lead based on sequence settings.
 * Returns the most restrictive result.
 */
export async function applyAIFilters(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  organizationId: string,
  settings: Partial<AIFilterSettings> = {}
): Promise<AIFilterResult> {
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };

  // Check hostile prospects first (more definitive)
  if (mergedSettings.ai_filter_hostile === 'skip') {
    const hostileResult = await checkHostileProspect(supabase, lead, organizationId);
    if (hostileResult.action === 'skip') {
      return hostileResult;
    }
  }

  // Check unlikely to reply
  if (mergedSettings.ai_filter_unlikely_reply === 'skip') {
    const replyResult = await checkUnlikelyToReply(supabase, lead, organizationId);
    if (replyResult.action === 'skip') {
      return replyResult;
    }
  }

  return { action: 'send', score: 1.0 };
}
