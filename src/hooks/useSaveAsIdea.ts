import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { assignIdeasToFeed, invalidateIdeaFeeds } from "@/hooks/useIdeaFeeds";
import type { FeedTarget } from "@/lib/idea-feeds";
import { ideaNotesFromPost, ideaTitleFromPost, type ResearchPostForIdea } from "@/lib/research-ideas";

export type ResearchSource = "trending" | "post";

const POST_COLUMNS = "id, platform, title, description, url, author_name, author_handle, ai_analysis, analyzed_at, idea_id";

/**
 * Save researched posts as ideas in one click: a clean title, the post as
 * notes, a link back, and (optionally) straight into an autopilot. Replaces
 * the old "Convert to idea" dialog, which few used: 21 conversions from
 * 11,000+ scraped posts.
 */
export function useSaveResearchAsIdeas() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      contentIds,
      source,
      target,
    }: {
      contentIds: string[];
      source: ResearchSource;
      target?: FeedTarget;
    }): Promise<{ created: number; alreadySaved: number; ideaIds: string[] }> => {
      if (!currentOrganization) throw new Error("No organization selected");
      const orgId = currentOrganization.id;

      const posts: Array<ResearchPostForIdea & { idea_id: string | null }> = [];
      for (let i = 0; i < contentIds.length; i += 100) {
        const { data, error } = await supabase
          .from("research_content")
          .select(POST_COLUMNS)
          .eq("organization_id", orgId)
          .in("id", contentIds.slice(i, i + 100));
        if (error) throw error;
        posts.push(...((data ?? []) as unknown as Array<ResearchPostForIdea & { idea_id: string | null }>));
      }

      const already = posts.filter((p) => p.idea_id);
      const fresh = posts.filter((p) => !p.idea_id);
      const ideaIds = already.map((p) => p.idea_id as string);

      if (fresh.length > 0) {
        const { data: created, error } = await supabase
          .from("content_ideas")
          .insert(
            fresh.map((p) => ({
              organization_id: orgId,
              title: ideaTitleFromPost(p),
              free_text: ideaNotesFromPost(p),
              source_urls: p.url && /^https?:\/\//.test(p.url) ? p.url : null,
              metadata: { source, research_content_id: p.id, platform: p.platform },
            })),
          )
          .select("id, metadata");
        if (error) throw error;

        const now = new Date().toISOString();
        for (const idea of created ?? []) {
          const contentId = (idea.metadata as { research_content_id?: string } | null)?.research_content_id;
          if (!contentId) continue;
          ideaIds.push(idea.id);
          const { error: linkError } = await supabase
            .from("research_content")
            .update({ idea_id: idea.id, converted_to_idea: true, converted_to_idea_at: now })
            .eq("id", contentId);
          if (linkError) throw linkError;
        }
      }

      if (target && ideaIds.length > 0) await assignIdeasToFeed(orgId, ideaIds, target);
      return { created: fresh.length, alreadySaved: already.length, ideaIds };
    },
    onSuccess: ({ created, alreadySaved }, { target }) => {
      invalidateIdeaFeeds(queryClient, target?.autopilotId);
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      queryClient.invalidateQueries({ queryKey: ["trending-content"] });
      const what = created === 1 ? "Saved as an idea" : created > 1 ? `Saved ${created} ideas` : "Already in your ideas";
      toast.success(target ? `${what} for ${target.autopilotName}` : what, {
        description: alreadySaved > 0 && created > 0 ? `${alreadySaved} were already saved.` : undefined,
        action: { label: "Open Ideas", onClick: () => navigate("/ideas") },
      });
    },
    onError: (error: Error) => toast.error(`Couldn't save: ${error.message}`),
  });
}
