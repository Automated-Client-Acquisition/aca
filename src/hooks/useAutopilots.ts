import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type {
  Autopilot,
  CreateAutopilotInput,
  UpdateAutopilotInput,
  PublishQueueItem,
  AutomationLog,
} from "@/types/autopilot";

// ============================================================================
// Autopilot Queries
// ============================================================================

export function useAutopilots() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["autopilots", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("autopilots")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as Autopilot[];
    },
    enabled: !!currentOrganization,
  });
}

export function useAutopilot(id: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["autopilots", currentOrganization?.id, id],
    queryFn: async () => {
      if (!id || !currentOrganization) return null;

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("autopilots")
        .select("*")
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .single();

      if (error) throw error;
      return data as unknown as Autopilot;
    },
    enabled: !!id && !!currentOrganization,
  });
}

// ============================================================================
// Autopilot Mutations
// ============================================================================

export function useCreateAutopilot() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateAutopilotInput) => {
      if (!user) throw new Error("User not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Calculate next run time (callers that know the exact first slot pass it).
      const nextRunAt = input.next_run_at ? new Date(input.next_run_at) : calculateNextRunTime(input.frequency);

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("autopilots")
        .insert({
          name: input.name,
          organization_id: currentOrganization.id,
          created_by: user.id,
          status: 'active',
          content_mix: input.content_mix,
          ideas_source: input.ideas_source || 'per_blueprint',
          shared_idea_tags: input.shared_idea_tags,
          frequency: input.frequency,
          scheduling_mode: input.scheduling_mode || 'optimal',
          timezone: input.timezone || 'America/New_York',
          scheduled_times: input.scheduled_times,
          scheduled_days: input.scheduled_days ?? null,
          schedule_slots: input.schedule_slots ?? null,
          destinations: input.destinations,
          evergreen: input.evergreen,
          auto_reload_pool: input.auto_reload_pool ?? false,
          only_approved_ideas: input.only_approved_ideas ?? false,
          next_run_at: nextRunAt.toISOString(),
          total_generated: 0,
          total_published: 0,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Autopilot;
    },
    onSuccess: async (createdAutopilot) => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      toast.success("Autopilot created successfully");

      // Auto-sync pool from tags after creation
      if (createdAutopilot?.id) {
        try {
          const { data: syncResult, error: syncError } = await supabase.rpc(
            "sync_autopilot_pool_from_tags",
            { p_autopilot_id: createdAutopilot.id }
          );

          if (syncError) {
            console.error("Failed to sync autopilot pool:", syncError);
          } else if (syncResult?.added > 0) {
            console.log(`Auto-synced ${syncResult.added} ideas to pool for autopilot ${createdAutopilot.id}`);
            // Invalidate pool queries to refresh UI
            queryClient.invalidateQueries({ queryKey: ["autopilot-pool", createdAutopilot.id] });
          }
        } catch (err) {
          console.error("Error syncing autopilot pool:", err);
        }
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to create autopilot: ${error.message}`);
    },
  });
}

export function useDuplicateAutopilot() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (source: Autopilot) => {
      if (!user) throw new Error("User not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("autopilots")
        .insert({
          name: `${source.name} (Copy)`,
          organization_id: currentOrganization.id,
          created_by: user.id,
          status: 'paused',
          folder_id: source.folder_id ?? null,
          content_mix: source.content_mix,
          ideas_source: source.ideas_source,
          shared_idea_tags: source.shared_idea_tags,
          frequency: source.frequency,
          scheduling_mode: source.scheduling_mode,
          timezone: source.timezone,
          scheduled_times: source.scheduled_times,
          destinations: source.destinations,
          evergreen: source.evergreen,
          auto_reload_pool: source.auto_reload_pool ?? false,
          next_run_at: null,
          total_generated: 0,
          total_published: 0,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Autopilot;
    },
    onSuccess: async (createdAutopilot) => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      toast.success("Autopilot duplicated");

      // Auto-sync pool from tags for the new autopilot, same as on create
      if (createdAutopilot?.id) {
        try {
          const { data: syncResult, error: syncError } = await supabase.rpc(
            "sync_autopilot_pool_from_tags",
            { p_autopilot_id: createdAutopilot.id }
          );

          if (syncError) {
            console.error("Failed to sync autopilot pool:", syncError);
          } else if (syncResult?.added > 0) {
            queryClient.invalidateQueries({ queryKey: ["autopilot-pool", createdAutopilot.id] });
          }
        } catch (err) {
          console.error("Error syncing autopilot pool:", err);
        }
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to duplicate autopilot: ${error.message}`);
    },
  });
}

export function useUpdateAutopilot() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateAutopilotInput) => {
      const updateData: any = { updated_at: new Date().toISOString() };

      // Track if tags changed (to trigger pool sync)
      const tagsChanged = input.shared_idea_tags !== undefined ||
                          input.content_mix !== undefined ||
                          input.ideas_source !== undefined;

      if (input.name !== undefined) updateData.name = input.name;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.content_mix !== undefined) updateData.content_mix = input.content_mix;
      if (input.ideas_source !== undefined) updateData.ideas_source = input.ideas_source;
      if (input.shared_idea_tags !== undefined) updateData.shared_idea_tags = input.shared_idea_tags;
      if (input.frequency !== undefined) {
        updateData.frequency = input.frequency;
        updateData.next_run_at = calculateNextRunTime(input.frequency).toISOString();
      }
      if (input.scheduling_mode !== undefined) updateData.scheduling_mode = input.scheduling_mode;
      if (input.timezone !== undefined) updateData.timezone = input.timezone;
      if (input.scheduled_times !== undefined) updateData.scheduled_times = input.scheduled_times;
      if (input.scheduled_days !== undefined) updateData.scheduled_days = input.scheduled_days;
      if (input.schedule_slots !== undefined) updateData.schedule_slots = input.schedule_slots;
      // An exact slot (scheduled mode) beats "one interval from now".
      if (input.next_run_at !== undefined) updateData.next_run_at = input.next_run_at;
      if (input.destinations !== undefined) updateData.destinations = input.destinations;
      if (input.evergreen !== undefined) updateData.evergreen = input.evergreen;
      if (input.auto_reload_pool !== undefined) updateData.auto_reload_pool = input.auto_reload_pool;
      if (input.only_approved_ideas !== undefined) updateData.only_approved_ideas = input.only_approved_ideas;

      const { data, error } = await supabase
        .from("autopilots")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return { autopilot: data as unknown as Autopilot, tagsChanged };
    },
    onSuccess: async ({ autopilot, tagsChanged }) => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id, autopilot.id] });
      toast.success("Autopilot updated successfully");

      // Auto-sync pool from tags if tags configuration changed
      if (tagsChanged && autopilot?.id) {
        try {
          const { data: syncResult, error: syncError } = await supabase.rpc(
            "sync_autopilot_pool_from_tags",
            { p_autopilot_id: autopilot.id }
          );

          if (syncError) {
            console.error("Failed to sync autopilot pool:", syncError);
          } else if (syncResult?.added > 0) {
            console.log(`Auto-synced ${syncResult.added} ideas to pool for autopilot ${autopilot.id}`);
            queryClient.invalidateQueries({ queryKey: ["autopilot-pool", autopilot.id] });
            toast.info(`Added ${syncResult.added} new ideas to pool`);
          }
        } catch (err) {
          console.error("Error syncing autopilot pool:", err);
        }
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update autopilot: ${error.message}`);
    },
  });
}

export function useDeleteAutopilot() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("autopilots")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      toast.success("Autopilot deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete autopilot: ${error.message}`);
    },
  });
}

export function useToggleAutopilotStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, status, next_run_at }: { id: string; status: 'active' | 'paused'; next_run_at?: string }) => {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString(),
      };

      // If activating, recalculate next run time (callers on a fixed schedule pass the next slot)
      if (status === 'active' && next_run_at) {
        updateData.next_run_at = next_run_at;
      } else if (status === 'active') {
        const { data: autopilot } = await supabase
          .from("autopilots")
          .select("frequency")
          .eq("id", id)
          .single();

        if (autopilot?.frequency) {
          updateData.next_run_at = calculateNextRunTime(autopilot.frequency as any).toISOString();
        }
      }

      const { data, error } = await supabase
        .from("autopilots")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Autopilot;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id, data.id] });
      toast.success(`Autopilot ${data.status === 'active' ? 'activated' : 'paused'}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update autopilot status: ${error.message}`);
    },
  });
}

export function useTriggerAutopilot() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (autopilotId: string) => {
      const { data, error } = await supabase.functions.invoke('trigger-autopilot', {
        body: { autopilot_id: autopilotId }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to trigger autopilot');

      return data as { success: boolean; job_id?: string; details?: { blueprint_name: string; idea_title: string; from_pool: boolean } };
    },
    onSuccess: (data, autopilotId) => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id, autopilotId] });
      queryClient.invalidateQueries({ queryKey: ["automation-logs", autopilotId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(
        data.details
          ? `Generation started: ${data.details.idea_title.substring(0, 40)}...`
          : "Content generation triggered!"
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to trigger autopilot: ${error.message}`);
    },
  });
}

/**
 * Recent rotation picks per autopilot (blueprint ids, newest first), so the
 * screens can show whose turn is next. Runs a pinned slot chose don't count,
 * matching process-autopilots.
 */
export function useAutopilotRotationHistory(autopilotIds: string[]) {
  const { currentOrganization } = useAuth();
  const ids = [...autopilotIds].sort();

  return useQuery({
    queryKey: ["autopilot-rotation-history", currentOrganization?.id, ids],
    queryFn: async () => {
      const history: Record<string, string[]> = {};
      if (ids.length === 0) return history;
      // A plain string: the generated types can't follow a ->> JSON path select.
      const columns: string = "autopilot_id, blueprint_id, pinned:configuration->>slot_pinned";
      const { data, error } = await supabase
        .from("content_generation_jobs")
        .select(columns)
        .eq("organization_id", currentOrganization!.id)
        .in("autopilot_id", ids)
        .order("created_at", { ascending: false })
        .limit(Math.min(1000, ids.length * 40));
      if (error) throw error;
      for (const row of (data ?? []) as unknown as Array<{ autopilot_id: string; blueprint_id: string | null; pinned: string | null }>) {
        if (!row.blueprint_id || row.pinned === "true") continue;
        (history[row.autopilot_id] ??= []).push(row.blueprint_id);
      }
      return history;
    },
    enabled: !!currentOrganization && ids.length > 0,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// Publish Queue Queries
// ============================================================================

/** An autopilot's last finished posts (published or failed), newest first. */
export function useRecentPublishes(autopilotId: string | undefined, limit: number = 6) {
  return useQuery({
    queryKey: ["publish-queue", autopilotId, "recent", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("publish_queue")
        .select("id, status, platform, last_error, scheduled_for, published_at")
        .eq("autopilot_id", autopilotId!)
        .in("status", ["published", "failed"])
        .order("scheduled_for", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as Array<Pick<PublishQueueItem, "id" | "status" | "platform" | "last_error" | "scheduled_for" | "published_at">>;
    },
    enabled: !!autopilotId,
  });
}

export function usePublishQueue(autopilotId?: string) {
  return useQuery({
    queryKey: ["publish-queue", autopilotId],
    queryFn: async () => {
      let query = supabase
        .from("publish_queue")
        .select(`
          *,
          autopilots:autopilot_id (id, name),
          content_outputs:output_id (id, data, stage_data, pipeline, job_id)
        `)
        .order("scheduled_for", { ascending: false })
        .limit(2000);

      if (autopilotId) {
        query = query.eq("autopilot_id", autopilotId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const items = data || [];

      // Collect unique account IDs by platform to fetch account info
      const wordpressAccountIds = [...new Set(
        items.filter(i => i.platform === 'wordpress').map(i => i.account_id)
      )];
      const ghlAccountIds = [...new Set(
        items.filter(i => i.platform === 'ghl').map(i => i.account_id)
      )];

      // Fetch WordPress sites
      const wordpressSites: Record<string, { name: string; url?: string }> = {};
      if (wordpressAccountIds.length > 0) {
        const { data: wpData } = await supabase
          .from("wordpress_sites")
          .select("id, name, site_url")
          .in("id", wordpressAccountIds);

        wpData?.forEach(site => {
          wordpressSites[site.id] = { name: site.name, url: site.site_url };
        });
      }

      // Fetch GHL tokens (use location_id as the name since there's no friendly name)
      const ghlAccounts: Record<string, { name: string }> = {};
      if (ghlAccountIds.length > 0) {
        const { data: ghlData } = await supabase
          .from("ghl_oauth_tokens")
          .select("id, location_id")
          .in("location_id", ghlAccountIds);

        ghlData?.forEach(token => {
          ghlAccounts[token.location_id] = {
            name: `GHL Location` // Can be improved if we have a name field
          };
        });
      }

      return items.map((item: any) => {
        let account: { name: string; url?: string; avatar_url?: string } | undefined;

        if (item.platform === 'wordpress' && wordpressSites[item.account_id]) {
          account = wordpressSites[item.account_id];
        } else if (item.platform === 'ghl' && ghlAccounts[item.account_id]) {
          account = ghlAccounts[item.account_id];
        }

        return {
          ...item,
          autopilot: item.autopilots,
          content_output: item.content_outputs,
          account,
        };
      }) as PublishQueueItem[];
    },
  });
}

export function usePendingPublishCount() {
  return useQuery({
    queryKey: ["publish-queue-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("publish_queue")
        .select("id", { count: "exact" })
        .eq("status", "pending");

      if (error) throw error;
      return count || 0;
    },
  });
}

export function useDeletePublishQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("publish_queue")
        .delete()
        .eq("id", itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publish-queue"] });
      queryClient.invalidateQueries({ queryKey: ["publish-queue-count"] });
      toast.success("Item removed from queue");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });
}

export function useReschedulePublishQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      scheduledFor,
    }: {
      itemId: string;
      scheduledFor: string;
    }) => {
      const { error } = await supabase
        .from("publish_queue")
        .update({ scheduled_for: scheduledFor })
        .eq("id", itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publish-queue"] });
      toast.success("Item rescheduled");
    },
    onError: (error: Error) => {
      toast.error(`Failed to reschedule: ${error.message}`);
    },
  });
}

// ============================================================================
// Automation Logs Queries
// ============================================================================

export function useAutomationLogs(autopilotId: string, limit: number = 50) {
  return useQuery({
    queryKey: ["automation-logs", autopilotId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_logs")
        .select("*")
        .eq("autopilot_id", autopilotId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as unknown as AutomationLog[];
    },
    enabled: !!autopilotId,
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateNextRunTime(frequency: { amount: number; unit: string }): Date {
  const now = new Date();
  const { amount, unit } = frequency;

  switch (unit) {
    case 'hour':
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    case 'day':
      return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
    case 'week':
      return new Date(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Default to 1 day
  }
}

// ============================================================================
// Evergreen Stats Query
// ============================================================================

export interface EvergreenStats {
  eligibleCount: number;
  queuedRepostsCount: number;
  totalReposts: number;
}

export function useEvergreenStats(autopilotId: string | undefined) {
  return useQuery({
    queryKey: ["evergreen-stats", autopilotId],
    queryFn: async (): Promise<EvergreenStats> => {
      if (!autopilotId) {
        return { eligibleCount: 0, queuedRepostsCount: 0, totalReposts: 0 };
      }

      // Get eligible content count (published, evergreen_eligible, under max reposts)
      const { count: eligibleCount, error: eligibleError } = await supabase
        .from("content_publications")
        .select("id", { count: "exact" })
        .eq("autopilot_id", autopilotId)
        .eq("evergreen_eligible", true);

      if (eligibleError) throw eligibleError;

      // Get queued reposts count
      const { count: queuedRepostsCount, error: queuedError } = await supabase
        .from("publish_queue")
        .select("id", { count: "exact" })
        .eq("autopilot_id", autopilotId)
        .eq("is_repost", true)
        .eq("status", "pending");

      if (queuedError) throw queuedError;

      // Get total reposts made (sum of repost_count from content_publications)
      const { data: publications, error: repostError } = await supabase
        .from("content_publications")
        .select("repost_count")
        .eq("autopilot_id", autopilotId);

      if (repostError) throw repostError;

      const totalReposts = (publications || []).reduce(
        (sum, pub) => sum + (pub.repost_count || 0),
        0
      );

      return {
        eligibleCount: eligibleCount || 0,
        queuedRepostsCount: queuedRepostsCount || 0,
        totalReposts,
      };
    },
    enabled: !!autopilotId,
  });
}

// ============================================================================
// Quick Settings Update (for inline toggles)
// ============================================================================

export function useUpdateAutopilotSettings() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      settings,
    }: {
      id: string;
      settings: {
        auto_reload_pool?: boolean;
        evergreen?: Autopilot["evergreen"];
      };
    }) => {
      const updateData: any = { updated_at: new Date().toISOString() };

      if (settings.auto_reload_pool !== undefined) {
        updateData.auto_reload_pool = settings.auto_reload_pool;
      }
      if (settings.evergreen !== undefined) {
        updateData.evergreen = settings.evergreen;
      }

      const { data, error } = await supabase
        .from("autopilots")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Autopilot;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["autopilots", currentOrganization?.id, data.id] });
      toast.success("Settings updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update settings: ${error.message}`);
    },
  });
}
