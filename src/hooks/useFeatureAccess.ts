import { useAuth } from "@/contexts/AuthContext";
import {
  PlanTier,
  PlanFeatures,
  FeatureName,
  PLAN_LIMITS,
  FEATURE_LABELS,
  getEffectiveFeatures,
} from "@/types/admin";

// Upgrade URL - Skool community
export const UPGRADE_URL = "https://www.skool.com/aca-xtreme/about";

export interface FeatureAccess {
  hasAccess: boolean;
  planTier: PlanTier;
  featureName: FeatureName;
  featureLabel: string;
  featureDescription: string;
  upgradeUrl: string;
}

export interface FeatureAccessHook {
  // Check single feature
  hasFeature: (feature: FeatureName) => boolean;
  // Get full feature access info
  getFeatureAccess: (feature: FeatureName) => FeatureAccess;
  // Get all features status
  features: PlanFeatures;
  // Current plan
  planTier: PlanTier;
  // Is free plan
  isFreePlan: boolean;
  // Is client organization (managed by agency - no upgrade prompts)
  isClient: boolean;
  // Should show upgrade prompts (not a client)
  showUpgradePrompts: boolean;
  // Upgrade URL
  upgradeUrl: string;
}

/**
 * Hook to check feature access based on the current organization's plan
 *
 * Note:
 * - Super admins have access to ALL features regardless of plan
 * - Client organizations (part of an agency) don't see upgrade prompts
 *   since their features are managed by their parent agency.
 */
export function useFeatureAccess(): FeatureAccessHook {
  const { currentOrganization, isClient, isSuperAdmin } = useAuth();

  // Get plan tier, default to free if not set
  const planTier = (currentOrganization?.plan_tier || "free") as PlanTier;

  // Get custom feature overrides from organization limits
  const customLimits = currentOrganization?.limits as Record<string, unknown> | null;
  const customFeatures = customLimits?.features as Partial<PlanFeatures> | null;

  // Get effective features (plan defaults + any custom overrides)
  const baseFeatures = getEffectiveFeatures(planTier, customFeatures);

  // Super admins have access to ALL features
  const features: PlanFeatures = isSuperAdmin
    ? {
        starter_packs: true,
        prompt_library: true,
        autopilots: true,
        publishing: true,
        push_to_ghl: true,
        reference_libraries: true,
        workspaces: true,
mcp_api_keys: true,
        messaging: true,
        lead_magnets: true,
        linkedin_campaigns: true,
        email_campaigns: true,
        postshiba: true,
      }
    : baseFeatures;

  // Strict check: per-org overrides come from untyped JSON (limits.features),
  // so a missing key must read as off, not undefined.
  const hasFeature = (feature: FeatureName): boolean => {
    return features[feature] === true;
  };

  const getFeatureAccess = (feature: FeatureName): FeatureAccess => {
    const labelInfo = FEATURE_LABELS[feature];
    return {
      hasAccess: features[feature] === true,
      planTier,
      featureName: feature,
      featureLabel: labelInfo.label,
      featureDescription: labelInfo.description,
      upgradeUrl: UPGRADE_URL,
    };
  };

  return {
    hasFeature,
    getFeatureAccess,
    features,
    planTier,
    isFreePlan: planTier === "free" && !isSuperAdmin,
    isClient,
    // Clients don't see upgrade prompts - their agency manages their plan
    // Super admins also don't need upgrade prompts
    // Pricing is single-tier ($67/mo for everyone). There is no higher
    // Operator tier to upgrade to, so the legacy 'Upgrade to Pro' locks
    // and CTAs that this flag drives are dead UI. Hard-off everywhere.
    showUpgradePrompts: false,
    upgradeUrl: UPGRADE_URL,
  };
}

/**
 * Simple hook to check a single feature
 */
export function useHasFeature(feature: FeatureName): boolean {
  const { hasFeature } = useFeatureAccess();
  return hasFeature(feature);
}
