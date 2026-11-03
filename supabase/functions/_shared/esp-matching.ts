/**
 * ESP Matching Module
 *
 * Provider matching (Gmail->Gmail, Outlook->Outlook) and
 * Server & IP Sharding and Rotation (SISR) logic.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { selectMailbox, getMailboxCandidates, weightedSelect, MailboxCandidate, RotationOptions } from "./email-rotation.ts";

/**
 * Map of email domains to provider names.
 */
const DOMAIN_TO_PROVIDER: Record<string, string> = {
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'live.com': 'outlook',
  'msn.com': 'outlook',
  'yahoo.com': 'yahoo',
  'yahoo.co.uk': 'yahoo',
  'yahoo.fr': 'yahoo',
  'ymail.com': 'yahoo',
  'aol.com': 'aol',
  'icloud.com': 'apple',
  'me.com': 'apple',
  'mac.com': 'apple',
  'protonmail.com': 'protonmail',
  'proton.me': 'protonmail',
  'zoho.com': 'zoho',
};

/**
 * Known MX record patterns to provider mapping.
 * Used as a heuristic when we can't do actual DNS lookups.
 */
const MX_DOMAIN_PATTERNS: [RegExp, string][] = [
  [/google\.com|gmail\.com|googlemail\.com/i, 'gmail'],
  [/outlook\.com|microsoft\.com|hotmail\.com/i, 'outlook'],
  [/yahoodns\.net|yahoo\.com/i, 'yahoo'],
  [/protonmail\.ch|proton\.me/i, 'protonmail'],
  [/icloud\.com|apple\.com/i, 'apple'],
  [/zoho\.com/i, 'zoho'],
];

/**
 * Get the email provider from a known domain.
 */
export function getProviderFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return DOMAIN_TO_PROVIDER[domain] || null;
}

/**
 * Guess provider from recipient email domain.
 * Uses known domain mappings first, then falls back to common
 * enterprise patterns (many companies use Google Workspace or M365).
 *
 * Note: In a production environment, this could do actual MX lookups.
 * For now we use domain heuristics since Deno edge functions
 * don't support DNS resolution directly.
 */
export function getProviderFromRecipient(recipientEmail: string): string | null {
  // Try direct domain match first
  const directMatch = getProviderFromEmail(recipientEmail);
  if (directMatch) return directMatch;

  // For custom domains, we can't determine provider without MX lookup.
  // Return null to indicate "unknown provider" - the caller should
  // fall back to any available mailbox.
  return null;
}

/**
 * Select a mailbox that matches the recipient's email provider.
 * Falls back to any available mailbox if no provider match is found.
 */
export async function selectMailboxForProvider(
  supabase: SupabaseClient,
  organizationId: string,
  recipientEmail: string,
  mailboxIds?: string[] | null
): Promise<MailboxCandidate | null> {
  const recipientProvider = getProviderFromRecipient(recipientEmail);

  if (recipientProvider) {
    // Try to find a matching provider mailbox first
    const matched = await selectMailbox(supabase, organizationId, {
      providerFilter: recipientProvider,
      mailboxIds: mailboxIds || null,
    });

    if (matched) {
      console.log(`[ESP] Provider matched: ${recipientProvider} -> ${matched.email_address}`);
      return matched;
    }

    console.log(`[ESP] No ${recipientProvider} mailbox available, falling back to any`);
  }

  // Fallback: select any available mailbox
  return selectMailbox(supabase, organizationId, {
    mailboxIds: mailboxIds || null,
  });
}

/**
 * Apply SISR (Server & IP Sharding and Rotation) to a list of mailbox candidates.
 * Prioritizes mailboxes on different server IPs from the last used one
 * to distribute sending load across infrastructure.
 */
export function applySISR(
  mailboxes: MailboxCandidate[],
  lastUsedIp?: string | null
): MailboxCandidate[] {
  if (!lastUsedIp || mailboxes.length <= 1) {
    return mailboxes;
  }

  // Sort: mailboxes on different IPs first, then same IP
  const differentIp: MailboxCandidate[] = [];
  const sameIp: MailboxCandidate[] = [];

  for (const mb of mailboxes) {
    const ip = mb.metadata?.server_ip;
    if (ip && ip === lastUsedIp) {
      sameIp.push(mb);
    } else {
      differentIp.push(mb);
    }
  }

  return [...differentIp, ...sameIp];
}

// ============================================================================
// Advanced Mailbox Selection Pipeline
// ============================================================================

export interface ESPRoutingRule {
  recipient_domain: string;
  provider: string;
}

export interface AdvancedSelectionOptions {
  organizationId: string;
  recipientEmail: string;
  mailboxIds?: string[] | null;
  providerMatching?: boolean;
  espRoutingRules?: ESPRoutingRule[];
  sisrEnabled?: boolean;
  hypersendMode?: boolean;
  leadId?: string;
}

/**
 * Advanced mailbox selection with full feature support.
 *
 * Pipeline:
 *   1. Custom ESP routing rules (exact domain match → force provider)
 *   2. Auto provider matching (Gmail→Gmail, Outlook→Outlook)
 *   3. Fetch candidates (with hypersend 3x limit expansion)
 *   4. Fallback if forced provider yielded no results
 *   5. SISR reorder (prefer different server IP from last send)
 *   6. Hypersend eligibility filter (auto-disable degraded mailboxes)
 *   7. Weighted random selection by health_score
 */
export async function selectMailboxAdvanced(
  supabase: SupabaseClient,
  opts: AdvancedSelectionOptions
): Promise<MailboxCandidate | null> {
  const {
    organizationId, recipientEmail, mailboxIds,
    providerMatching, espRoutingRules, sisrEnabled,
    hypersendMode, leadId,
  } = opts;

  const recipientDomain = recipientEmail.split('@')[1]?.toLowerCase();
  let forcedProvider: string | null = null;

  // 1. Custom ESP routing rules (highest priority)
  if (espRoutingRules && espRoutingRules.length > 0 && recipientDomain) {
    const matchedRule = espRoutingRules.find(
      r => r.recipient_domain.toLowerCase() === recipientDomain
    );
    if (matchedRule) {
      forcedProvider = matchedRule.provider;
      console.log(`[ESP] Custom rule matched: ${recipientDomain} -> ${forcedProvider}`);
    }
  }

  // 2. Auto provider matching (if no custom rule matched)
  if (!forcedProvider && providerMatching) {
    forcedProvider = getProviderFromRecipient(recipientEmail);
    if (forcedProvider) {
      console.log(`[ESP] Provider auto-match: ${recipientDomain} -> ${forcedProvider}`);
    }
  }

  // 3. Fetch candidates with optional provider filter
  let candidates = await getMailboxCandidates(supabase, organizationId, {
    providerFilter: forcedProvider,
    mailboxIds: mailboxIds || null,
    hypersendMode,
  });

  // 4. Fallback: if forced provider yielded no results, try any provider
  if (candidates.length === 0 && forcedProvider) {
    console.log(`[ESP] No ${forcedProvider} mailbox available, falling back to any`);
    candidates = await getMailboxCandidates(supabase, organizationId, {
      mailboxIds: mailboxIds || null,
      hypersendMode,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // 5. SISR reorder
  if (sisrEnabled && leadId) {
    const lastUsedIp = await getLastUsedIpForLead(supabase, leadId);
    candidates = applySISR(candidates, lastUsedIp);
  }

  // 6. Hypersend eligibility filter
  if (hypersendMode) {
    candidates = filterHypersendEligible(candidates);
    if (candidates.length === 0) {
      return null;
    }
  }

  // 7. Weighted random selection
  return weightedSelect(candidates);
}

/**
 * Look up the server IP used for the last email sent to this lead.
 * Drives SISR: the next send should use a different IP if possible.
 */
async function getLastUsedIpForLead(
  supabase: SupabaseClient,
  leadId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('email_send_log')
    .select('mailbox_id')
    .eq('lead_id', leadId)
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data?.mailbox_id) return null;

  const { data: mailbox } = await supabase
    .from('email_mailboxes')
    .select('metadata')
    .eq('id', data.mailbox_id)
    .single();

  return (mailbox?.metadata as any)?.server_ip || null;
}

/**
 * Filter candidates for hypersend eligibility.
 * Mailboxes past their normal daily_limit (only included due to 3x expansion)
 * must still have health > 0.80 and bounce < 0.05 to remain eligible.
 */
function filterHypersendEligible(candidates: MailboxCandidate[]): MailboxCandidate[] {
  return candidates.filter(m => {
    // Mailbox is past its normal limit — it was only included due to hypersend 3x
    if (m.daily_sent >= m.daily_limit) {
      if (m.health_score <= 0.80 || (m.bounce_rate ?? 0) >= 0.05) {
        console.warn(`[Hypersend] Auto-disabling for ${m.email_address}: health=${m.health_score}, bounce=${m.bounce_rate}`);
        return false;
      }
    }
    return true;
  });
}
