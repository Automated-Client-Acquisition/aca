// Admin Organization Management Types

export type PlanTier = "free" | "pro" | "enterprise";

// ============================================================================
// Plan-Based Limits Configuration
// ============================================================================

// Feature flags for gating premium features
export interface PlanFeatures {
  starter_packs: boolean;         // Access to starter packs
  prompt_library: boolean;        // Access to prompt library
  autopilots: boolean;            // Access to autopilot system
  publishing: boolean;            // WordPress publishing integration
  push_to_ghl: boolean;           // Push to LeadConnector
  reference_libraries: boolean;   // Reference image libraries
  workspaces: boolean;            // Agency/workspace features
mcp_api_keys: boolean;          // MCP API keys for Claude integration
  messaging: boolean;             // CRM/Messaging inbox features
  lead_magnets: boolean;          // Lead magnet capture
  linkedin_campaigns: boolean;    // LinkedIn outreach campaigns
  email_campaigns: boolean;       // Email sequence campaigns
  postshiba: boolean;             // PostShiba sending connection. Off on every plan; turned on per org via limits.features.postshiba
}

export interface PlanLimits {
  // Content generation limits
  daily_generations: number;      // Max content pieces per day
  monthly_generations: number;    // Max content pieces per month

  // Cost limits (in dollars)
  daily_cost_limit: number;       // Max spend per day
  monthly_cost_limit: number;     // Max spend per month

  // Job limits
  concurrent_jobs: number;        // Max jobs running at once
  max_items_per_job: number;      // Max items in a single job

  // Feature access
  max_team_members: number;       // Max users in organization
  max_api_keys: number;           // Max API keys stored
  max_autopilots: number;         // Max autopilot configs

  // Workspace/Client limits (for agencies)
  max_workspaces: number;         // Max client workspaces (0 = no agency features, includes own org)

  // Storage (in GB)
  storage_gb: number;

  // Feature flags
  features: PlanFeatures;
}

export interface UsageMetrics {
  daily: {
    generations: number;
    cost: number;
    date: string; // ISO date string (YYYY-MM-DD)
  };
  monthly: {
    generations: number;
    cost: number;
    month: string; // ISO month string (YYYY-MM)
  };
  all_time: {
    generations: number;
    cost: number;
  };
}

// Default limits per plan tier
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  // Pricing is single-tier $67/mo for everyone — there's no real free tier
  // anymore. The 'free' record here is what new orgs default to (plan_tier
  // unset) and what existing legacy free-tier orgs map to. All features are
  // on. Quotas stay at the legacy free numbers so we can still enforce them
  // if needed, but the UI no longer surfaces them as "free vs pro" gating.
  free: {
    daily_generations: 100,
    monthly_generations: 2000,
    daily_cost_limit: 50,
    monthly_cost_limit: 500,
    concurrent_jobs: 5,
    max_items_per_job: 50,
    max_team_members: 10,
    max_api_keys: 10,
    max_autopilots: 10,
    max_workspaces: 3,
    storage_gb: 100,
    features: {
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
      postshiba: false,
    },
  },
  pro: {
    daily_generations: 100,
    monthly_generations: 2000,
    daily_cost_limit: 50,
    monthly_cost_limit: 500,
    concurrent_jobs: 5,
    max_items_per_job: 50,
    max_team_members: 10,
    max_api_keys: 10,
    max_autopilots: 10,
    max_workspaces: 3,            // 3 workspaces including own org
    storage_gb: 100,
    features: {
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
      postshiba: false,
    },
  },
  enterprise: {
    daily_generations: -1,        // -1 = unlimited
    monthly_generations: -1,
    daily_cost_limit: -1,
    monthly_cost_limit: -1,
    concurrent_jobs: -1,
    max_items_per_job: -1,
    max_team_members: -1,
    max_api_keys: -1,
    max_autopilots: -1,
    max_workspaces: -1,           // Unlimited workspaces
    storage_gb: -1,
    features: {
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
      postshiba: false,
    },
  },
};

// Helper to check if a limit is unlimited
export function isUnlimited(value: number): boolean {
  return value === -1;
}

// Helper to get effective limits for an organization
// Uses custom limits if set, otherwise falls back to plan defaults
export function getEffectiveLimits(
  planTier: PlanTier,
  customLimits?: Partial<PlanLimits> | null
): PlanLimits {
  const defaults = PLAN_LIMITS[planTier];
  if (!customLimits) return defaults;

  return {
    ...defaults,
    ...customLimits,
  };
}

// Helper to check if usage exceeds limit
export function isOverLimit(usage: number, limit: number): boolean {
  if (isUnlimited(limit)) return false;
  return usage >= limit;
}

// Helper to get usage percentage (0-100+)
export function getUsagePercentage(usage: number, limit: number): number {
  if (isUnlimited(limit)) return 0;
  if (limit === 0) return 100;
  return Math.round((usage / limit) * 100);
}

// Helper to format limit display
export function formatLimit(value: number): string {
  if (isUnlimited(value)) return "Unlimited";
  return value.toLocaleString();
}

// ============================================================================
// Admin Action Types
// ============================================================================

export type AdminActionType =
  | "plan_change"
  | "suspend"
  | "unsuspend"
  | "archive"
  | "unarchive"
  | "delete"
  | "edit_settings"
  | "edit_name"
  | "edit_limits"
  | "network_review";

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  type: "standalone" | "agency" | "client";
  status: string | null;
  plan_tier: PlanTier;
  is_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  parent_id: string | null;
  parent_name: string | null;
  created_at: string;
  user_count: number;
  content_count: number;
  jobs_count: number;
  api_key_count: number;
  owner_email: string | null;
  logo_url?: string | null;
}

export interface AdminOrganizationDetail extends AdminOrganization {
  suspended_by: string | null;
  plan_changed_at: string | null;
  plan_changed_by: string | null;
  settings: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  current_usage: Record<string, unknown> | null;
  logo_url?: string | null;
  members?: Array<{
    id: string;
    user_id: string;
    role: string;
    is_primary_owner: boolean;
    user: {
      id: string;
      email: string;
      full_name: string | null;
    } | null;
  }>;
}

export interface AdminActionLog {
  id: string;
  admin_user_id: string;
  admin_email: string;
  admin_name: string | null;
  target_organization_id: string | null;
  target_organization_name: string;
  action_type: AdminActionType;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

export interface AdminFilters {
  type?: string;
  status?: string;
  plan?: string;
  search?: string;
  includeSuspended?: boolean;
}

// Plan tier display configuration
export const PLAN_TIERS: Record<
  PlanTier,
  { label: string; color: string; description: string }
> = {
  free: {
    label: "Starter",
    color: "bg-gray-100 text-gray-800 border-gray-200",
    description: "Basic features with limited usage",
  },
  pro: {
    label: "Pro",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    description: "Advanced features for growing teams",
  },
  enterprise: {
    label: "Enterprise",
    color: "bg-primary/10 text-primary border-primary/20",
    description: "Full platform access with priority support",
  },
};

// Admin action type display configuration
export const ACTION_TYPE_LABELS: Record<
  AdminActionType,
  { label: string; color: string }
> = {
  plan_change: { label: "Plan Changed", color: "text-blue-600" },
  suspend: { label: "Suspended", color: "text-red-600" },
  unsuspend: { label: "Unsuspended", color: "text-green-600" },
  archive: { label: "Archived", color: "text-yellow-600" },
  unarchive: { label: "Unarchived", color: "text-green-600" },
  delete: { label: "Deleted", color: "text-red-600" },
  edit_settings: { label: "Settings Updated", color: "text-gray-600" },
  edit_name: { label: "Name Changed", color: "text-gray-600" },
  edit_limits: { label: "Limits Updated", color: "text-orange-600" },
  network_review: { label: "Network Access", color: "text-purple-600" },
};

// Helper function to get plan tier badge props
export function getPlanTierBadge(planTier: PlanTier | string | null) {
  const tier = (planTier || "free") as PlanTier;
  return PLAN_TIERS[tier] || PLAN_TIERS.free;
}

// Helper function to get action type display info
export function getActionTypeDisplay(actionType: AdminActionType) {
  return ACTION_TYPE_LABELS[actionType] || { label: actionType, color: "text-gray-600" };
}

// ============================================================================
// Feature Access Helpers
// ============================================================================

export type FeatureName = keyof PlanFeatures;

// Feature display configuration
export const FEATURE_LABELS: Record<FeatureName, { label: string; description: string }> = {
  starter_packs: {
    label: "Starter Packs",
    description: "Pre-built templates to jumpstart your content creation",
  },
  prompt_library: {
    label: "Prompt Library",
    description: "Save and reuse your best-performing prompts",
  },
  autopilots: {
    label: "Autopilots",
    description: "Automated content generation on a schedule",
  },
  publishing: {
    label: "WordPress Publishing",
    description: "Publish directly to your WordPress sites",
  },
  push_to_ghl: {
    label: "Social Publishing",
    description: "Publish content to social media platforms",
  },
  reference_libraries: {
    label: "Reference Libraries",
    description: "Organize and reuse reference images",
  },
  workspaces: {
    label: "Workspaces",
    description: "Manage multiple clients or projects",
  },
  mcp_api_keys: {
    label: "MCP API Keys",
    description: "Connect Claude Desktop or other MCP clients to your account",
  },
  messaging: {
    label: "Messaging",
    description: "CRM inbox with multi-channel conversations and automation",
  },
  lead_magnets: {
    label: "Lead Magnets",
    description: "Automated lead capture from social media comments and DMs",
  },
  linkedin_campaigns: {
    label: "LinkedIn Campaigns",
    description: "Automated LinkedIn outreach with multi-step sequences and AI personalization",
  },
  email_campaigns: {
    label: "Email Campaigns",
    description: "Cold email sequences with warmup, deliverability tracking, and multi-mailbox rotation",
  },
  postshiba: {
    label: "PostShiba",
    description: "Send email through your own PostShiba team",
  },
};

// Helper to check if a feature is available for a plan
export function hasFeature(planTier: PlanTier, feature: FeatureName): boolean {
  return PLAN_LIMITS[planTier].features[feature];
}

// Helper to get features for a plan with custom overrides
export function getEffectiveFeatures(
  planTier: PlanTier,
  customFeatures?: Partial<PlanFeatures> | null
): PlanFeatures {
  const defaults = PLAN_LIMITS[planTier].features;
  if (!customFeatures) return defaults;

  return {
    ...defaults,
    ...customFeatures,
  };
}
