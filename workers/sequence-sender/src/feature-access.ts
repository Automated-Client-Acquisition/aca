/**
 * Feature Access Module
 *
 * Plan-based feature gating for organizations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type FeatureName =
  | 'starter_packs'
  | 'prompt_library'
  | 'autopilots'
  | 'publishing'
  | 'push_to_ghl'
  | 'reference_libraries'
  | 'workspaces'
  | 'lead_magnets'
  | 'linkedin_campaigns'
  | 'email_campaigns';

const PLAN_FEATURES: Record<string, Record<FeatureName, boolean>> = {
  free: {
    starter_packs: false,
    prompt_library: false,
    autopilots: false,
    publishing: false,
    push_to_ghl: false,
    reference_libraries: false,
    workspaces: false,
    lead_magnets: false,
    linkedin_campaigns: false,
    email_campaigns: false,
  },
  pro: {
    starter_packs: true,
    prompt_library: true,
    autopilots: true,
    publishing: true,
    push_to_ghl: true,
    reference_libraries: true,
    workspaces: true,
    lead_magnets: true,
    linkedin_campaigns: true,
    email_campaigns: true,
  },
  enterprise: {
    starter_packs: true,
    prompt_library: true,
    autopilots: true,
    publishing: true,
    push_to_ghl: true,
    reference_libraries: true,
    workspaces: true,
    lead_magnets: true,
    linkedin_campaigns: true,
    email_campaigns: true,
  },
};

export interface FeatureCheckResult {
  allowed: boolean;
  planTier: string;
  reason?: string;
}

export async function checkFeatureAccess(
  supabase: SupabaseClient,
  organizationId: string,
  feature: FeatureName
): Promise<FeatureCheckResult> {
  const { data: org, error } = await supabase
    .from('organizations')
    .select('plan_tier, limits')
    .eq('id', organizationId)
    .single();

  if (error || !org) {
    return {
      allowed: false,
      planTier: 'unknown',
      reason: 'Organization not found',
    };
  }

  const planTier = org.plan_tier || 'free';
  const planFeatures = PLAN_FEATURES[planTier] || PLAN_FEATURES.free;

  const customFeatures = (org.limits as any)?.features;
  const featureEnabled = customFeatures?.[feature] ?? planFeatures[feature];

  if (!featureEnabled) {
    return {
      allowed: false,
      planTier,
      reason: `The "${feature}" feature requires a Pro plan or higher.`,
    };
  }

  return {
    allowed: true,
    planTier,
  };
}
