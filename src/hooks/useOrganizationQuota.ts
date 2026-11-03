import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  PlanTier,
  PlanLimits,
  UsageMetrics,
  PLAN_LIMITS,
  getEffectiveLimits,
  isUnlimited,
  isOverLimit,
  getUsagePercentage,
} from "@/types/admin";
import { SELF_HOSTED } from "@/config/site";

export interface QuotaStatus {
  allowed: boolean;
  reason?: string;
  usage: {
    daily_generations: number;
    monthly_generations: number;
  };
  limits: Partial<PlanLimits>;
  remaining: {
    daily: number;
    monthly: number;
  };
}

export interface LimitHitStats {
  daily_hits: number;
  monthly_hits: number;
  total_hits: number;
  last_daily_hit?: string;
  last_monthly_hit?: string;
  month: string;
}

export interface OrganizationQuota {
  planTier: PlanTier;
  limits: PlanLimits;
  usage: UsageMetrics;
  quotaStatus: QuotaStatus | null;
  limitHits: LimitHitStats;
  // Computed helpers
  dailyUsagePercent: number;
  monthlyUsagePercent: number;
  isAtDailyLimit: boolean;
  isAtMonthlyLimit: boolean;
  isNearDailyLimit: boolean; // > 80%
  isNearMonthlyLimit: boolean; // > 80%
}

/**
 * Hook to check the current organization's quota and usage
 */
export function useOrganizationQuota() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["organization-quota", orgId],
    queryFn: async (): Promise<OrganizationQuota | null> => {
      if (!orgId) return null;

      // Fetch organization with current usage and limit hits
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("plan_tier, limits, current_usage, limit_hits")
        .eq("id", orgId)
        .single();

      if (orgError) {
        console.error("Error fetching organization quota:", orgError);
        throw orgError;
      }

      // Call the RPC function to check quota
      const { data: quotaCheck, error: quotaError } = await supabase.rpc(
        "check_organization_quota",
        { p_org_id: orgId, p_count: 1 }
      );

      if (quotaError) {
        console.error("Error checking quota:", quotaError);
        // Don't throw, just continue with defaults
      }

      // Parse limit hit stats
      const rawLimitHits = org.limit_hits as any;
      const currentMonth = new Date().toISOString().slice(0, 7);
      const limitHits: LimitHitStats = {
        daily_hits: rawLimitHits?.month === currentMonth ? (rawLimitHits?.daily_hits || 0) : 0,
        monthly_hits: rawLimitHits?.monthly_hits || 0,
        total_hits: rawLimitHits?.total_hits || 0,
        last_daily_hit: rawLimitHits?.last_daily_hit,
        last_monthly_hit: rawLimitHits?.last_monthly_hit,
        month: rawLimitHits?.month || currentMonth,
      };

      const planTier = (org.plan_tier || "free") as PlanTier;
      const customLimits = org.limits as Partial<PlanLimits> | null;
      const effectiveLimits = getEffectiveLimits(planTier, customLimits);

      // Parse current usage
      const rawUsage = org.current_usage as any;
      const usage: UsageMetrics = {
        daily: {
          generations: rawUsage?.daily?.generations || 0,
          cost: rawUsage?.daily?.cost || 0,
          date: rawUsage?.daily?.date || new Date().toISOString().split("T")[0],
        },
        monthly: {
          generations: rawUsage?.monthly?.generations || 0,
          cost: rawUsage?.monthly?.cost || 0,
          month: rawUsage?.monthly?.month || new Date().toISOString().slice(0, 7),
        },
        all_time: {
          generations: rawUsage?.all_time?.generations || 0,
          cost: rawUsage?.all_time?.cost || 0,
        },
      };

      // Calculate percentages
      const dailyUsagePercent = getUsagePercentage(
        usage.daily.generations,
        effectiveLimits.daily_generations
      );
      const monthlyUsagePercent = getUsagePercentage(
        usage.monthly.generations,
        effectiveLimits.monthly_generations
      );

      return {
        planTier,
        limits: effectiveLimits,
        usage,
        quotaStatus: quotaCheck as QuotaStatus | null,
        limitHits,
        dailyUsagePercent,
        monthlyUsagePercent,
        isAtDailyLimit: isOverLimit(
          usage.daily.generations,
          effectiveLimits.daily_generations
        ),
        isAtMonthlyLimit: isOverLimit(
          usage.monthly.generations,
          effectiveLimits.monthly_generations
        ),
        isNearDailyLimit: dailyUsagePercent >= 80,
        isNearMonthlyLimit: monthlyUsagePercent >= 80,
      };
    },
    // Plan quotas are ACA Cloud billing; a self-hosted install has none.
    enabled: !!orgId && !SELF_HOSTED,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Hook to check if a specific action is allowed (before creating jobs)
 */
export function useCanCreateContent(itemCount: number = 1) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["can-create-content", orgId, itemCount],
    queryFn: async (): Promise<QuotaStatus> => {
      if (!orgId) {
        return {
          allowed: false,
          reason: "No organization selected",
          usage: { daily_generations: 0, monthly_generations: 0 },
          limits: {},
          remaining: { daily: 0, monthly: 0 },
        };
      }

      const { data, error } = await supabase.rpc("check_organization_quota", {
        p_org_id: orgId,
        p_count: itemCount,
      });

      if (error) {
        console.error("Error checking quota:", error);
        // Fail open for now - allow the action
        return {
          allowed: true,
          usage: { daily_generations: 0, monthly_generations: 0 },
          limits: {},
          remaining: { daily: -1, monthly: -1 },
        };
      }

      return data as QuotaStatus;
    },
    // Plan quotas are ACA Cloud billing; a self-hosted install has none.
    enabled: !!orgId && !SELF_HOSTED,
    staleTime: 10 * 1000, // 10 seconds for pre-action checks
  });
}
