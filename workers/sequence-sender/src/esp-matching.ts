/**
 * ESP Matching Module
 *
 * Provider matching (Gmail->Gmail, Outlook->Outlook) and
 * Server & IP Sharding and Rotation (SISR) logic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectMailbox, getMailboxCandidates, weightedSelect, type MailboxCandidate, type RotationOptions } from './email-rotation.js';

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

export function getProviderFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return DOMAIN_TO_PROVIDER[domain] || null;
}

export function getProviderFromRecipient(recipientEmail: string): string | null {
  const directMatch = getProviderFromEmail(recipientEmail);
  if (directMatch) return directMatch;
  return null;
}

export async function selectMailboxForProvider(
  supabase: SupabaseClient,
  organizationId: string,
  recipientEmail: string,
  mailboxIds?: string[] | null
): Promise<MailboxCandidate | null> {
  const recipientProvider = getProviderFromRecipient(recipientEmail);

  if (recipientProvider) {
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

  return selectMailbox(supabase, organizationId, {
    mailboxIds: mailboxIds || null,
  });
}

export function applySISR(
  mailboxes: MailboxCandidate[],
  lastUsedIp?: string | null
): MailboxCandidate[] {
  if (!lastUsedIp || mailboxes.length <= 1) {
    return mailboxes;
  }

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

  if (espRoutingRules && espRoutingRules.length > 0 && recipientDomain) {
    const matchedRule = espRoutingRules.find(
      r => r.recipient_domain.toLowerCase() === recipientDomain
    );
    if (matchedRule) {
      forcedProvider = matchedRule.provider;
      console.log(`[ESP] Custom rule matched: ${recipientDomain} -> ${forcedProvider}`);
    }
  }

  if (!forcedProvider && providerMatching) {
    forcedProvider = getProviderFromRecipient(recipientEmail);
    if (forcedProvider) {
      console.log(`[ESP] Provider auto-match: ${recipientDomain} -> ${forcedProvider}`);
    }
  }

  let candidates = await getMailboxCandidates(supabase, organizationId, {
    providerFilter: forcedProvider,
    mailboxIds: mailboxIds || null,
    hypersendMode,
  });

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

  if (sisrEnabled && leadId) {
    const lastUsedIp = await getLastUsedIpForLead(supabase, leadId);
    candidates = applySISR(candidates, lastUsedIp);
  }

  if (hypersendMode) {
    candidates = filterHypersendEligible(candidates);
    if (candidates.length === 0) {
      return null;
    }
  }

  return weightedSelect(candidates);
}

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

function filterHypersendEligible(candidates: MailboxCandidate[]): MailboxCandidate[] {
  return candidates.filter(m => {
    if (m.daily_sent >= m.daily_limit) {
      if (m.health_score <= 0.80 || (m.bounce_rate ?? 0) >= 0.05) {
        console.warn(`[Hypersend] Auto-disabling for ${m.email_address}: health=${m.health_score}, bounce=${m.bounce_rate}`);
        return false;
      }
    }
    return true;
  });
}
