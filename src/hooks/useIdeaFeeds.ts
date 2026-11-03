import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIdeaTags } from "@/hooks/useIdeaTags";
import { useBlueprints } from "@/hooks/useBlueprints";
import { type AutopilotFuel, type FeedOption, type FeedTarget, type IdeaUsage, feedTargets } from "@/lib/idea-feeds";

export type { FeedOption };

/** Per autopilot: the ideas it can draw from, how many are new, and its runway. */
export function useAutopilotFuel() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["autopilot-fuel", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_autopilot_fuel", {
        p_organization_id: currentOrganization!.id,
      });
      if (error) throw error;
      return ((data ?? []) as unknown as AutopilotFuel[]).map((f) => ({
        ...f,
        entries: Array.isArray(f.entries) ? f.entries : [],
        posts_per_day: f.posts_per_day === null ? null : Number(f.posts_per_day),
        runway_days: f.runway_days === null ? null : Number(f.runway_days),
      }));
    },
    enabled: !!currentOrganization,
    staleTime: 60_000,
  });
}

/**
 * Every way to point ideas at an autopilot, active autopilots first, plus the
 * autopilots that take any idea (nothing to assign for those).
 */
export function useFeedOptions() {
  const { data: fuel = [], isLoading } = useAutopilotFuel();
  const { data: tags = [] } = useIdeaTags();
  const { data: blueprints = [] } = useBlueprints();

  return useMemo(() => {
    const tagNames = tags.map((t) => t.name);
    const blueprintName = new Map(blueprints.map((b) => [b.id, b.name]));
    const sorted = [...fuel].sort(
      (a, b) => Number(b.status === "active") - Number(a.status === "active") || a.name.localeCompare(b.name),
    );
    const options: FeedOption[] = [];
    const anyIdea: AutopilotFuel[] = [];
    for (const f of sorted) {
      const targets = feedTargets(f, tagNames);
      if (targets.length === 0 && f.draws_from_all) anyIdea.push(f);
      for (const target of targets) {
        const names = target.blueprintIds.map((id) => blueprintName.get(id)).filter(Boolean) as string[];
        options.push({
          target,
          fuel: f,
          label: target.whole || names.length === 0 ? f.name : `${f.name} · ${names.join(", ")}`,
        });
      }
    }
    return { options, anyIdea, fuel, tagNames, isLoading };
  }, [fuel, tags, blueprints, isLoading]);
}

const USAGE_PAGE = 1000;

/** How often each idea became content (PostgREST caps an RPC page at 1000 rows). */
export function useIdeaUsage() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["idea-usage", currentOrganization?.id],
    queryFn: async () => {
      const byIdea = new Map<string, IdeaUsage>();
      for (let from = 0; ; from += USAGE_PAGE) {
        const { data, error } = await supabase
          .rpc("get_idea_usage", { p_organization_id: currentOrganization!.id })
          .range(from, from + USAGE_PAGE - 1);
        if (error) throw error;
        for (const row of (data ?? []) as unknown as IdeaUsage[]) byIdea.set(row.idea_id, row);
        if (!data || data.length < USAGE_PAGE) break;
      }
      return byIdea;
    },
    enabled: !!currentOrganization,
    staleTime: 60_000,
  });
}

/** idea id -> autopilots it was removed from. */
export function useIdeaExclusions() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["idea-exclusions", currentOrganization?.id],
    queryFn: async () => {
      const byIdea = new Map<string, Set<string>>();
      for (let from = 0; ; from += USAGE_PAGE) {
        const { data, error } = await (supabase.from("autopilot_idea_exclusions" as any) as any)
          .select("idea_id, autopilot_id")
          .eq("organization_id", currentOrganization!.id)
          .order("created_at")
          .range(from, from + USAGE_PAGE - 1);
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ idea_id: string; autopilot_id: string }>) {
          const set = byIdea.get(row.idea_id) ?? new Set<string>();
          set.add(row.autopilot_id);
          byIdea.set(row.idea_id, set);
        }
        if (!data || data.length < USAGE_PAGE) break;
      }
      return byIdea;
    },
    enabled: !!currentOrganization,
    staleTime: 60_000,
  });
}

/**
 * Make ideas feed an autopilot: tag them with the tag it draws from, then pull
 * them into its pool so the next run can pick them (without the sync they wait
 * until the pool runs dry).
 */
export async function assignIdeasToFeed(organizationId: string, ideaIds: string[], target: FeedTarget) {
  // Match like the autopilot does (case-insensitive); ilike would treat _ and % as wildcards.
  const { data: tags, error: tagError } = await supabase
    .from("idea_tags")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (tagError) throw tagError;
  // Assigning again undoes an earlier "remove from autopilot".
  const { error: includeError } = await supabase.rpc("include_ideas_in_autopilot" as any, {
    p_autopilot_id: target.autopilotId,
    p_idea_ids: ideaIds,
  } as any);
  if (includeError) throw includeError;

  const wanted = target.tagName.trim().toLowerCase();
  const tag = (tags ?? []).find((t) => t.name.trim().toLowerCase() === wanted);
  if (!tag) throw new Error(`The tag "${target.tagName}" no longer exists`);

  for (let i = 0; i < ideaIds.length; i += 500) {
    const rows = ideaIds.slice(i, i + 500).map((idea_id) => ({ idea_id, tag_id: tag.id }));
    const { error } = await supabase
      .from("idea_tag_assignments")
      .upsert(rows, { onConflict: "idea_id,tag_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  const { error: syncError } = await supabase.rpc("sync_autopilot_pool_from_tags", {
    p_autopilot_id: target.autopilotId,
  });
  if (syncError) throw syncError;
}

/** Everything that shows which ideas feed which autopilot. */
export function invalidateIdeaFeeds(queryClient: ReturnType<typeof useQueryClient>, autopilotId?: string) {
  queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
  queryClient.invalidateQueries({ queryKey: ["idea-usage"] });
  queryClient.invalidateQueries({ queryKey: ["idea-exclusions"] });
  queryClient.invalidateQueries({ queryKey: ["autopilot-fuel"] });
  queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
  queryClient.invalidateQueries({ queryKey: ["autopilot-pool-stats-all"] });
  if (autopilotId) {
    queryClient.invalidateQueries({ queryKey: ["autopilot-pool-entries", autopilotId] });
    queryClient.invalidateQueries({ queryKey: ["autopilot-pool-stats", autopilotId] });
  }
}

export function useAssignIdeasToAutopilot() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ ideaIds, target }: { ideaIds: string[]; target: FeedTarget }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      await assignIdeasToFeed(currentOrganization.id, ideaIds, target);
    },
    onSuccess: (_, { ideaIds, target }) => {
      invalidateIdeaFeeds(queryClient, target.autopilotId);
      toast.success(
        `${ideaIds.length} idea${ideaIds.length === 1 ? "" : "s"} now feed${ideaIds.length === 1 ? "s" : ""} ${target.autopilotName}`,
      );
    },
    onError: (error: Error) => {
      toast.error(`Couldn't assign the ideas: ${error.message}`);
    },
  });
}

/** Stop autopilots from using ideas. The ideas and their tags stay as they are. */
export function useRemoveIdeasFromAutopilots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ideaIds, autopilotIds }: { ideaIds: string[]; autopilotIds: string[] }) => {
      for (const autopilotId of autopilotIds) {
        for (let i = 0; i < ideaIds.length; i += 500) {
          const { error } = await supabase.rpc("exclude_ideas_from_autopilot" as any, {
            p_autopilot_id: autopilotId,
            p_idea_ids: ideaIds.slice(i, i + 500),
          } as any);
          if (error) throw error;
        }
      }
    },
    onSuccess: (_, { ideaIds, autopilotIds }) => {
      invalidateIdeaFeeds(queryClient);
      autopilotIds.forEach((id) => invalidateIdeaFeeds(queryClient, id));
      toast.success(
        `${ideaIds.length} idea${ideaIds.length === 1 ? "" : "s"} removed from ${autopilotIds.length} autopilot${autopilotIds.length === 1 ? "" : "s"}`,
      );
    },
    onError: (error: Error) => {
      toast.error(`Couldn't remove the ideas: ${error.message}`);
    },
  });
}
