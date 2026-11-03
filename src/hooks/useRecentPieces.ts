import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Looks of this blueprint's recent manual runs, most recent first: the turn
 * order a manual run continues from (autopilots keep their own).
 */
export function useRecentManualLookIds(blueprintId: string | undefined, enabled = true) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["recent-manual-looks", currentOrganization?.id, blueprintId],
    queryFn: async () => {
      // JSON-path alias; typed loosely because supabase-js can't infer it.
      const { data, error } = await (supabase.from("content_outputs") as any)
        .select("look_id:generation_params->look->>id")
        .eq("organization_id", currentOrganization!.id)
        .eq("blueprint_id", blueprintId!)
        .is("autopilot_id", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return ((data ?? []) as Array<{ look_id: string | null }>).map((r) => r.look_id).filter((id): id is string => !!id);
    },
    enabled: !!currentOrganization && !!blueprintId && enabled,
  });
}

export interface AutopilotPiece {
  id: string;
  job_id: string | null;
  status: string;
  created_at: string;
  title: string | null;
  caption: string | null;
  text: string | null;
  image_url: string | null;
  slide_image: string | null;
  look_label: string | null;
}

export const FEED_SIZE = 9;

/** An autopilot's latest pieces, plus how often its ideas come back. */
export function useAutopilotFeed(autopilotId: string | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["autopilot-feed", currentOrganization?.id, autopilotId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [pieces, recentCount, poolCount] = await Promise.all([
        (supabase.from("content_outputs") as any)
          .select(
            "id, job_id, status, created_at, title:data->>title, caption:stage_data->caption->>content, text:data->>text, image_url:stage_data->image->>url, slide_image:stage_data->carousel_slides->slides->0->>image_url, look_label:generation_params->look->>label",
          )
          .eq("organization_id", currentOrganization!.id)
          .eq("autopilot_id", autopilotId!)
          .neq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(FEED_SIZE),
        supabase
          .from("content_outputs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", currentOrganization!.id)
          .eq("autopilot_id", autopilotId!)
          .neq("status", "failed")
          .gte("created_at", since),
        supabase
          .from("autopilot_idea_pools")
          .select("id", { count: "exact", head: true })
          .eq("autopilot_id", autopilotId!)
          .neq("status", "failed"),
      ]);
      if (pieces.error) throw pieces.error;
      return {
        pieces: (pieces.data ?? []) as AutopilotPiece[],
        postsLast30Days: recentCount.count ?? 0,
        ideasInPool: poolCount.count ?? 0,
      };
    },
    enabled: !!currentOrganization && !!autopilotId,
  });
}
