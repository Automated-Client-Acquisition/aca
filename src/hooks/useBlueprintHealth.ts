import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useStorageCredentials } from "@/hooks/useStorageCredentials";
import { useAutopilots } from "@/hooks/useAutopilots";
import { useBrandKit } from "@/hooks/useBrandKit";
import type { Blueprint } from "@/types/blueprint";
import {
  evaluateBlueprintHealth,
  type BlueprintHealth,
  type BlueprintRunStats,
  type HealthEnvironment,
} from "@/lib/blueprint-health";

/** Per-blueprint run counts and last outcome (get_blueprint_run_stats RPC). */
export function useBlueprintRunStats() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["blueprint-run-stats", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_blueprint_run_stats", {
        p_organization_id: currentOrganization!.id,
      });
      if (error) throw error;
      const map = new Map<string, BlueprintRunStats>();
      for (const row of data ?? []) {
        map.set(row.blueprint_id, {
          runs: Number(row.runs),
          succeeded: Number(row.succeeded),
          failed: Number(row.failed),
          in_progress: Number(row.in_progress),
          last_run_at: row.last_run_at,
          last_success_at: row.last_success_at,
          last_status: row.last_status,
          last_error: row.last_error,
          failed_in_last_two: Number(row.failed_in_last_two),
        });
      }
      return map;
    },
    enabled: !!currentOrganization,
    staleTime: 30_000,
  });
}

/** is_active for the OpenRouter models a set of blueprints uses. */
function useModelAvailability(modelIds: string[]) {
  const key = [...new Set(modelIds)].sort();
  return useQuery({
    queryKey: ["ai-model-availability", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_models")
        .select("model_id, is_active")
        .eq("provider", "openrouter")
        .in("model_id", key);
      if (error) throw error;
      const map = new Map<string, boolean>();
      for (const row of data ?? []) {
        // A model can be registered twice; any active row means it's usable.
        map.set(row.model_id, (map.get(row.model_id) ?? false) || !!row.is_active);
      }
      return map;
    },
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
  });
}

/** Everything the health rules need about the workspace, loaded once. */
export function useHealthEnvironment(blueprints: Pick<Blueprint, "model_config">[] | undefined) {
  const { data: apiKeys, isLoading: keysLoading } = useApiKeys();
  const { data: storage, isLoading: storageLoading } = useStorageCredentials();
  const { data: autopilots } = useAutopilots();
  const brandKit = useBrandKit();

  const modelIds = useMemo(() => {
    const ids: string[] = [];
    for (const bp of blueprints ?? []) {
      for (const slot of ["text_llm", "image_generator"] as const) {
        const cfg = bp.model_config?.[slot];
        if (cfg?.model_id && (!cfg.provider || cfg.provider === "openrouter")) ids.push(cfg.model_id);
      }
    }
    return ids;
  }, [blueprints]);
  const { data: modelActive } = useModelAvailability(modelIds);

  const env = useMemo<HealthEnvironment>(
    () => ({
      apiKeys: (apiKeys ?? []).map((k: any) => ({
        provider: k.provider,
        is_valid: k.is_valid,
        last_validated: k.last_validated,
      })),
      hasActiveStorage: (storage ?? []).some((s: any) => s.is_active !== false),
      modelActive: modelActive ?? new Map(),
      libraryCounts: {
        brand: brandKit.lists.brand.length,
        audience: brandKit.lists.audience.length,
        product: brandKit.lists.product.length,
        person: brandKit.lists.person.length,
      },
      pausedAutopilots: (autopilots ?? [])
        .filter((a: any) => a.status === "paused" && a.paused_reason)
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          paused_reason: a.paused_reason,
          blueprintIds: ((a.content_mix ?? []) as Array<{ blueprint_id: string }>).map((m) => m.blueprint_id),
        })),
    }),
    [apiKeys, storage, modelActive, brandKit.lists, autopilots],
  );

  return { env, isLoading: keysLoading || storageLoading || brandKit.isLoading };
}

/** Health for every blueprint in a list, keyed by id. */
export function useBlueprintsHealth(blueprints: Blueprint[] | undefined) {
  const { env, isLoading } = useHealthEnvironment(blueprints);
  const { data: stats } = useBlueprintRunStats();

  const health = useMemo(() => {
    const map = new Map<string, BlueprintHealth>();
    if (isLoading) return map;
    for (const bp of blueprints ?? []) {
      map.set(bp.id, evaluateBlueprintHealth(bp, env, stats?.get(bp.id)));
    }
    return map;
  }, [blueprints, env, stats, isLoading]);

  return { health, stats: stats ?? new Map<string, BlueprintRunStats>(), env, isLoading };
}

export interface BlueprintSample {
  output_id: string;
  pipeline: string | null;
  created_at: string;
  title: string | null;
  text_snippet: string | null;
  image_url: string | null;
}

/** Newest non-failed output per blueprint, for list thumbnails. */
export function useBlueprintSamples() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["blueprint-samples", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_blueprint_latest_samples", {
        p_organization_id: currentOrganization!.id,
      });
      if (error) throw error;
      const map = new Map<string, BlueprintSample>();
      for (const row of data ?? []) {
        map.set(row.blueprint_id, {
          output_id: row.output_id,
          pipeline: row.pipeline,
          created_at: row.created_at,
          title: row.title,
          text_snippet: row.text_snippet,
          image_url: row.image_url,
        });
      }
      return map;
    },
    enabled: !!currentOrganization,
    staleTime: 60_000,
  });
}
