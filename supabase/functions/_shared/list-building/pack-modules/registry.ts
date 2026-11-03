/**
 * ACA Discovery Layer — Pack Module Registry.
 *
 * Maps pack_key (matches public.pack_subscriptions.pack_key) to its producers.
 * Each pack can be served by either of two providers — see PackProvider.
 *
 * COST, AND WHY THE DEFAULT CHANGED
 * ---------------------------------------------------------------------------
 * The SignalBase actor bills PAY_PER_EVENT at **$0.04/result** (+ $0.00005
 * startup). This comment previously said $0.01, which was correct when written
 * and is now 4x low — verified against the live actor on 2026-08-17. With
 * kickoff()'s HARD_MAX of 1000 results that is $40 per refresh, roughly
 * $1,200/mo for a single daily pack.
 *
 * The aca_engine provider reads events our own collectors already gathered, so
 * a refresh costs one indexed SELECT. SignalBase remains the default during
 * shadow rollout; subscriptions opt into aca_engine until parity is proven.
 */

import type { PackModule } from './types.ts';
import {
  justFundedSaasModule,
  aggressiveHiringModule,
  newLeadershipModule,
  acquisitionsModule,
} from './signalbase/index.ts';
import {
  localFundingModule,
  localHiringModule,
  localLeadershipModule,
  localAcquisitionModule,
} from './local/index.ts';
import { unipileInboundModule } from './unipile-inbound/index.ts';
import { unipileProfileMonitorModule } from './unipile-profile-monitor/index.ts';
import {
  linkedinPostReactionsModule,
  linkedinPostCommentsModule,
} from './apify-post-engagement/index.ts';
import { linkedinPostIntentModule } from './apify-post-intent/index.ts';

/**
 * Which engine produces a pack's signals.
 *
 *   aca_engine — our own collectors (EDGAR, ATS boards, news, forums), read out
 *                of signal_events. Free per result, corroborated across
 *                sources, and the data compounds.
 *   signalbase — bring-your-own Apify key. Kept as a first-class option for
 *                orgs already using it: no forced migration, no regression, and
 *                it covers geographies our collectors haven't reached yet.
 *
 * Selected per subscription via pack_subscriptions.config.provider.
 */
export type PackProvider = 'aca_engine' | 'signalbase';

export const DEFAULT_PACK_PROVIDER: PackProvider = 'signalbase';

export interface PackDefinition {
  key: string;
  tier: 'signal' | 'trade' | 'pro_services';
  label: string;
  description: string;
  defaultCadence: 'daily' | 'weekly' | 'monthly';
  /**
   * Modules for the default provider. Retained so existing callers that read
   * `pack.modules` keep working; prefer getPackModules() for provider-aware
   * dispatch.
   */
  modules: PackModule[];
  /** Per-provider module sets. A pack need not offer every provider. */
  providers: Partial<Record<PackProvider, PackModule[]>>;
}

export const PACK_REGISTRY: Record<string, PackDefinition> = {
  just_funded_saas: {
    key: 'just_funded_saas',
    tier: 'signal',
    label: 'Just-Funded SaaS',
    description:
      'Companies that closed a funding round recently. Sourced from SEC Form D filings plus trade press, cross-checked against each other — a round confirmed by both a legal filing and reporting scores higher than one seen once. Each record carries amount, industry, headcount, and the executives named on the filing.',
    defaultCadence: 'daily',
    modules: [localFundingModule],
    providers: { aca_engine: [localFundingModule], signalbase: [justFundedSaasModule] },
  },
  aggressive_hiring: {
    key: 'aggressive_hiring',
    tier: 'signal',
    label: 'Aggressive Hiring',
    description:
      'Companies opening new roles, measured from their own applicant-tracking boards. Because we snapshot each board over time, this is a real delta — roles opened since we last looked — not a count of standing vacancies. Includes department and seniority.',
    defaultCadence: 'weekly',
    modules: [localHiringModule],
    providers: { aca_engine: [localHiringModule], signalbase: [aggressiveHiringModule] },
  },
  new_leadership: {
    key: 'new_leadership',
    tier: 'signal',
    label: 'New Leadership',
    description:
      'C-level / VP / Head-of role changes. New decision-makers reset their tool stack, which makes the weeks after a leadership move the widest buying window a vendor gets.',
    defaultCadence: 'weekly',
    modules: [localLeadershipModule],
    providers: { aca_engine: [localLeadershipModule], signalbase: [newLeadershipModule] },
  },
  recent_acquisitions: {
    key: 'recent_acquisitions',
    tier: 'signal',
    label: 'Recent Acquisitions',
    description:
      'M&A activity — both acquirers and targets, sourced from SEC 8-K items 1.01/2.01 plus press. Buyers consolidate vendors after a deal; targets get new leadership.',
    defaultCadence: 'weekly',
    modules: [localAcquisitionModule],
    providers: { aca_engine: [localAcquisitionModule], signalbase: [acquisitionsModule] },
  },
  unipile_inbound: {
    key: 'unipile_inbound',
    tier: 'signal',
    label: 'LinkedIn Inbound',
    description:
      'New followers, fresh connections, post engagers, and pending invites who aren\'t in your CRM yet — pulled live from your LinkedIn account. Real-time via webhook, no credits used.',
    defaultCadence: 'daily',
    modules: [unipileInboundModule],
    providers: { aca_engine: [unipileInboundModule] },
  },
  linkedin_post_engagement: {
    key: 'linkedin_post_engagement',
    tier: 'signal',
    label: 'Competitor & Creator Monitor',
    description:
      'List the LinkedIn profiles you want to watch — competitors, thought leaders, customers, your own. Each refresh we auto-scan their recent posts and surface every reactor and commenter. Powered by your connected LinkedIn account — no per-result fees. Specific post URLs are also supported as a secondary mode for one-off captures.',
    defaultCadence: 'weekly',
    modules: [
      // Primary — profile monitor via Unipile ($0/refresh, your already-connected account does the scraping)
      unipileProfileMonitorModule,
      // Secondary — specific post URL mode via Apify (paid per result; useful when no Unipile account is connected
      // or for one-off captures of a single viral post you want to scrape once without burning your account's
      // LinkedIn rate-limit budget)
      linkedinPostReactionsModule,
      linkedinPostCommentsModule,
    ],
    providers: {
      aca_engine: [
        unipileProfileMonitorModule,
        linkedinPostReactionsModule,
        linkedinPostCommentsModule,
      ],
    },
  },
  linkedin_post_intent: {
    key: 'linkedin_post_intent',
    tier: 'signal',
    label: 'LinkedIn Topic Intent',
    description:
      'Keyword search across recent LinkedIn posts. Surfaces individuals posting publicly about a topic you solve for. ~$0.005 per matched post.',
    defaultCadence: 'weekly',
    modules: [linkedinPostIntentModule],
    providers: { aca_engine: [linkedinPostIntentModule] },
  },
};

export function getPackDefinition(key: string): PackDefinition | null {
  return PACK_REGISTRY[key] ?? null;
}

/**
 * Resolve which modules run for a subscription.
 *
 * Falls back to the default provider when the requested one isn't offered for
 * this pack (the forum-intent pack has no SignalBase equivalent, for instance),
 * and falls back again to `modules` so a pack that predates this field still
 * dispatches. Returning [] would look identical to "no signals today" and hide
 * a config error as a quiet nothing.
 */
export function getPackModules(pack: PackDefinition, provider?: string | null): PackModule[] {
  const requested = (provider ?? DEFAULT_PACK_PROVIDER) as PackProvider;
  return (
    pack.providers?.[requested]
    ?? pack.providers?.[DEFAULT_PACK_PROVIDER]
    ?? pack.modules
    ?? []
  );
}

/** Providers actually available for a pack — drives the subscription UI. */
export function availableProviders(pack: PackDefinition): PackProvider[] {
  return Object.entries(pack.providers ?? {})
    .filter(([, mods]) => Array.isArray(mods) && mods.length > 0)
    .map(([p]) => p as PackProvider);
}

export function listPackKeys(): string[] {
  return Object.keys(PACK_REGISTRY);
}
