import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { UnipileAccount } from "./useUnipileAccounts";

// Types for account limits
export interface AccountLimit {
  id: string;
  organization_id: string;
  channel: string;
  channel_account_id: string | null;
  is_enabled: boolean;
  current_zone: "safe" | "moderate" | "faster" | "risky";
  custom_daily_limit: number | null;
  custom_hourly_limit: number | null;
  business_hours_only: boolean;
  business_hours_start: string;
  business_hours_end: string;
  timezone: string;
  active_days: number[];
  warmup_status: "not_started" | "in_progress" | "paused" | "completed";
  warmup_progress_percent: number;
}

export interface AccountWithLimits extends UnipileAccount {
  limits: {
    connection_requests: number;
    messages: number;
    inmails: number;
    profile_views: number;
    follows: number;
    post_likes: number;
  };
  schedule: {
    timezone: string;
    active_days: number[];
    business_hours_start: string;
    business_hours_end: string;
  };
  channel_limits?: AccountLimit[];
  connections_count?: number;
  connections_synced_at?: string | null;
  connections_sync_status?: string;
}

// Defensive fallback only — used if the effective-limit RPC fails to return a
// value. These mirror channel_limit_definitions.safe_daily_limit (the same
// number get_effective_daily_limit() returns when no org row exists), so even
// the fallback stays conservative and never over-states what will be sent.
// The real source of truth is the get_effective_daily_limits_for_accounts RPC.
const SAFE_FALLBACK_LIMITS: Record<string, number> = {
  linkedin_invitation: 10,
  linkedin_message: 15,
  linkedin_inmail: 10,
  linkedin_profile_view: 20,
  linkedin_follow: 20,
  linkedin_post_like: 20,
};

const DEFAULT_SCHEDULE = {
  timezone: "UTC",
  active_days: [1, 2, 3, 4, 5], // Monday to Friday
  business_hours_start: "09:00",
  business_hours_end: "19:00",
};

/**
 * Fetch all accounts with their configured limits
 */
export function useAccountsWithLimits() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["accounts-with-limits", user?.id, currentOrganization?.id],
    queryFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const orgId = currentOrganization?.id;
      if (!orgId) throw new Error("No organization selected");

      // Fetch accounts
      const { data: accounts, error: accountsError } = await supabase
        .from("unipile_accounts")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (accountsError) throw accountsError;

      // Fetch organization channel limits for these accounts
      const { data: channelLimits, error: limitsError } = await supabase
        .from("organization_channel_limits")
        .select("*")
        .eq("organization_id", orgId);

      if (limitsError) throw limitsError;

      // Resolve the TRUE effective daily limit per account+channel from the
      // backend — the same number the campaign-processor enforces via
      // check_channel_limit(). This replaces a client-side reconstruction that
      // diverged from enforcement (showed 25/40 while the gate allowed 10/15).
      // Keyed by `${accountId}|${channel}`.
      const effectiveLimits = new Map<string, number>();
      const accountIds = (accounts || []).map((a) => a.id);
      if (accountIds.length > 0) {
        const { data: effRows, error: effError } = await supabase.rpc(
          "get_effective_daily_limits_for_accounts",
          {
            p_organization_id: orgId,
            p_channel_account_ids: accountIds,
          }
        );
        if (effError) {
          // Don't break the page if the RPC is unavailable — fall back below.
          console.error("Failed to load effective channel limits:", effError);
        } else {
          for (const row of (effRows || []) as {
            channel_account_id: string;
            channel: string;
            daily_limit: number;
          }[]) {
            effectiveLimits.set(
              `${row.channel_account_id}|${row.channel}`,
              row.daily_limit
            );
          }
        }
      }

      // Map accounts with their limits
      const accountsWithLimits: AccountWithLimits[] = (accounts || []).map(
        (account) => {
          // Find limits for this account
          const accountLimits = (channelLimits || []).filter(
            (l) => l.channel_account_id === account.id
          );

          // Get schedule from any limit record (they should be the same)
          const anyLimit = accountLimits[0];

          // Use the backend-resolved effective limit; fall back to the safe
          // zone default only if the RPC returned nothing for this pair.
          const getLimitForChannel = (channel: string): number => {
            const eff = effectiveLimits.get(`${account.id}|${channel}`);
            if (eff != null) return eff;
            return SAFE_FALLBACK_LIMITS[channel] ?? 10;
          };

          return {
            ...account,
            limits: {
              connection_requests: getLimitForChannel("linkedin_invitation"),
              messages: getLimitForChannel("linkedin_message"),
              inmails: getLimitForChannel("linkedin_inmail"),
              profile_views: getLimitForChannel("linkedin_profile_view"),
              follows: getLimitForChannel("linkedin_follow"),
              post_likes: getLimitForChannel("linkedin_post_like"),
            },
            schedule: {
              timezone: anyLimit?.timezone ?? DEFAULT_SCHEDULE.timezone,
              active_days: anyLimit?.active_days ?? DEFAULT_SCHEDULE.active_days,
              business_hours_start:
                anyLimit?.business_hours_start ??
                DEFAULT_SCHEDULE.business_hours_start,
              business_hours_end:
                anyLimit?.business_hours_end ??
                DEFAULT_SCHEDULE.business_hours_end,
            },
            channel_limits: accountLimits as AccountLimit[],
          } as AccountWithLimits;
        }
      );

      return {
        accounts: accountsWithLimits,
        linkedinAccounts: accountsWithLimits.filter(
          (a) => a.provider === "LINKEDIN"
        ),
        instagramAccounts: accountsWithLimits.filter(
          (a) => a.provider === "INSTAGRAM"
        ),
        emailAccounts: accountsWithLimits.filter(
          (a) => a.provider === "EMAIL"
        ),
        whatsappAccounts: accountsWithLimits.filter(
          (a) => a.provider === "WHATSAPP"
        ),
        telegramAccounts: accountsWithLimits.filter(
          (a) => a.provider === "TELEGRAM"
        ),
        // Grouped by channel for multi-channel campaign builder
        byChannel: {
          linkedin: accountsWithLimits.filter((a) => a.provider === "LINKEDIN"),
          email: accountsWithLimits.filter((a) => a.provider === "EMAIL"),
          whatsapp: accountsWithLimits.filter((a) => a.provider === "WHATSAPP"),
          instagram: accountsWithLimits.filter((a) => a.provider === "INSTAGRAM"),
          telegram: accountsWithLimits.filter((a) => a.provider === "TELEGRAM"),
        },
      };
    },
    enabled: !!user && !!currentOrganization?.id,
    staleTime: 30000,
  });
}

export interface UpdateAccountLimitsInput {
  accountId: string;
  limits: {
    connection_requests?: number;
    messages?: number;
    inmails?: number;
    profile_views?: number;
    follows?: number;
    post_likes?: number;
  };
}

/**
 * Update limits for a specific account
 */
export function useUpdateAccountLimits() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAccountLimitsInput) => {
      if (!user) throw new Error("Not authenticated");

      const orgId = currentOrganization?.id;
      if (!orgId) throw new Error("No organization selected");

      // Map limit types to channel enum values
      const channelMap = {
        connection_requests: "linkedin_invitation",
        messages: "linkedin_message",
        inmails: "linkedin_inmail",
        profile_views: "linkedin_profile_view",
        follows: "linkedin_follow",
        post_likes: "linkedin_post_like",
      } as const;

      type ChannelValue = (typeof channelMap)[keyof typeof channelMap];

      // Update or insert each limit (partial unique indexes prevent onConflict upsert)
      const promises = Object.entries(input.limits).map(
        async ([limitType, value]) => {
          const channel = channelMap[limitType as keyof typeof channelMap] as ChannelValue | undefined;
          if (!channel || value === undefined) return;

          // Check if a row already exists for this account+channel
          const { data: existing } = await supabase
            .from("organization_channel_limits")
            .select("id")
            .eq("organization_id", orgId)
            .eq("channel", channel)
            .eq("channel_account_id", input.accountId)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from("organization_channel_limits")
              .update({
                custom_daily_limit: value,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);

            if (error) throw error;
          } else {
            const { error } = await supabase
              .from("organization_channel_limits")
              .insert({
                organization_id: orgId,
                channel,
                channel_account_id: input.accountId,
                custom_daily_limit: value,
                updated_at: new Date().toISOString(),
              });

            if (error) throw error;
          }
        }
      );

      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts-with-limits"] });
      queryClient.invalidateQueries({ queryKey: ["organization-channel-limits"] });
      toast.success("Limits updated successfully");
    },
    onError: (error) => {
      console.error("Failed to update limits:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to update limits"
      );
    },
  });
}

export interface UpdateAccountScheduleInput {
  accountId: string;
  schedule: {
    timezone?: string;
    active_days?: number[];
    business_hours_start?: string;
    business_hours_end?: string;
  };
}

/**
 * Update schedule for a specific account
 */
export function useUpdateAccountSchedule() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAccountScheduleInput) => {
      if (!user) throw new Error("Not authenticated");

      const orgId = currentOrganization?.id;
      if (!orgId) throw new Error("No organization selected");

      // Update schedule on all channel limits for this account
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.schedule.timezone !== undefined) {
        updateData.timezone = input.schedule.timezone;
      }
      if (input.schedule.active_days !== undefined) {
        updateData.active_days = input.schedule.active_days;
      }
      if (input.schedule.business_hours_start !== undefined) {
        updateData.business_hours_start = input.schedule.business_hours_start;
      }
      if (input.schedule.business_hours_end !== undefined) {
        updateData.business_hours_end = input.schedule.business_hours_end;
      }

      // First, check if there are existing records
      const { data: existing } = await supabase
        .from("organization_channel_limits")
        .select("id")
        .eq("organization_id", orgId)
        .eq("channel_account_id", input.accountId);

      if (existing && existing.length > 0) {
        // Update existing records
        const { error } = await supabase
          .from("organization_channel_limits")
          .update(updateData)
          .eq("organization_id", orgId)
          .eq("channel_account_id", input.accountId);

        if (error) throw error;
      } else {
        // Create a default record with the schedule
        const { error } = await supabase
          .from("organization_channel_limits")
          .insert({
            organization_id: orgId,
            channel: "linkedin_message", // Default channel
            channel_account_id: input.accountId,
            ...updateData,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts-with-limits"] });
      queryClient.invalidateQueries({ queryKey: ["organization-channel-limits"] });
      toast.success("Schedule updated successfully");
    },
    onError: (error) => {
      console.error("Failed to update schedule:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to update schedule"
      );
    },
  });
}
