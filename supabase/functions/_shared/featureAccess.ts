import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

// Feature names matching the frontend PlanFeatures interface
export type FeatureName =
  | "starter_packs"
  | "prompt_library"
  | "autopilots"
  | "publishing"
  | "push_to_ghl"
  | "reference_libraries"
  | "workspaces"
  | "lead_magnets"
  | "linkedin_campaigns"
  | "email_campaigns"
  // Off on every plan; turned on per org via organizations.limits.features.postshiba.
  | "postshiba";

// Plan features for each tier
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
    postshiba: false,
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
    postshiba: false,
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
    postshiba: false,
  },
};

export interface FeatureCheckResult {
  allowed: boolean;
  planTier: string;
  reason?: string;
}

/**
 * Check if an organization has access to a specific feature
 */
export async function checkFeatureAccess(
  supabase: SupabaseClient,
  organizationId: string,
  feature: FeatureName
): Promise<FeatureCheckResult> {
  // Fetch organization plan tier and any custom feature overrides
  const { data: org, error } = await supabase
    .from("organizations")
    .select("plan_tier, limits")
    .eq("id", organizationId)
    .single();

  if (error || !org) {
    return {
      allowed: false,
      planTier: "unknown",
      reason: "Organization not found",
    };
  }

  const planTier = org.plan_tier || "free";
  const planFeatures = PLAN_FEATURES[planTier] || PLAN_FEATURES.free;

  // Check for custom feature overrides in limits
  const customFeatures = (org.limits as any)?.features;
  const featureEnabled = customFeatures?.[feature] ?? planFeatures[feature];

  if (!featureEnabled) {
    return {
      allowed: false,
      planTier,
      reason: `The "${feature}" feature requires a Pro plan or higher. Upgrade at https://www.skool.com/aca-xtreme/about`,
    };
  }

  return {
    allowed: true,
    planTier,
  };
}

/**
 * Validate feature access and throw error if not allowed
 */
export async function requireFeature(
  supabase: SupabaseClient,
  organizationId: string,
  feature: FeatureName
): Promise<void> {
  const result = await checkFeatureAccess(supabase, organizationId, feature);

  if (!result.allowed) {
    throw new Error(result.reason || `Feature "${feature}" is not available for your plan.`);
  }
}
