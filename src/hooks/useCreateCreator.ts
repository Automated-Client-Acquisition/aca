import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { CreatorFormData } from "@/lib/validations";
import { useAuth } from "@/contexts/AuthContext";

interface CreateCreatorInput {
  displayName?: string;
  platform: string;
  channelUrl?: string;
  channelId?: string;
  username?: string;
  profileUrl?: string;
  tags?: string[];
  notes?: string;
  scrapeImmediately: boolean;
  scrapeConfig?: {
    postsCount: number;
    shortsCount?: number;
    daysBack?: number;
  };
}

export function useCreateCreator() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (data: CreatorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const organizationId = currentOrganization.id;

      // Extract channel/profile info based on platform
      let channelUrl: string | null = null;
      let channelId: string | null = null;

      if (data.platform === "youtube" && "channelUrl" in data) {
        channelUrl = data.channelUrl;
        // Extract channel ID from URL if possible
        const urlMatch = data.channelUrl.match(/(?:@|channel\/|c\/)([^/?]+)/);
        channelId = urlMatch ? urlMatch[1] : null;
      } else if (data.platform === "instagram" && "username" in data) {
        channelId = data.username;
        channelUrl = `https://instagram.com/${data.username}`;
      } else if (data.platform === "tiktok" && "username" in data) {
        channelId = data.username;
        channelUrl = `https://tiktok.com/@${data.username}`;
      } else if (data.platform === "linkedin" && "profileUrl" in data) {
        channelUrl = data.profileUrl;
        const urlMatch = data.profileUrl.match(/\/in\/([^/?]+)/);
        channelId = urlMatch ? urlMatch[1] : null;
      } else if (data.platform === "twitter" && "username" in data) {
        channelId = data.username;
        channelUrl = `https://x.com/${data.username}`;
      }

      // Insert creator
      const { data: creator, error } = await supabase
        .from("research_creators")
        .insert({
          id: crypto.randomUUID(),
          display_name: data.displayName || channelId || "Unnamed Creator",
          platform: data.platform,
          channel_url: channelUrl,
          channel_id: channelId,
          tags: data.tags || null,
          notes: data.notes || null,
          organization_id: organizationId,
        })
        .select()
        .single();

      if (error) throw error;

      // Step 2: Trigger content scraping (profile data will be populated by webhook)
      if (data.scrapeImmediately) {
        console.log('[Create Creator] Triggering immediate content scrape for', data.platform);
        try {
          const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('trigger-scrape', {
            body: {
              type: 'creator',
              targetId: creator.id,
              organizationId,
              options: {
                maxItems: data.scrapeConfig?.postsCount ?? 100,
                maxShorts: data.scrapeConfig && 'shortsCount' in data.scrapeConfig ? data.scrapeConfig.shortsCount : undefined,
                daysBack: data.scrapeConfig?.daysBack,
                forceRefresh: true,
              }
            }
          });
          if (scrapeError) throw scrapeError;
          if (scrapeResult?.error || scrapeResult?.success === false) {
            throw new Error(scrapeResult.error || scrapeResult.message || 'Scraping could not be started');
          }
          if (scrapeResult?.skipped) {
            toast({
              title: "Creator added; scrape skipped",
              description: scrapeResult.reason || "You can start a scrape from the creator's details.",
            });
          } else {
            toast({
              title: "Creator added and scrape started!",
              description: `${creator.display_name} has been added and scraping is in progress.`,
            });
          }
        } catch (error) {
          console.error('[Create Creator] Failed to trigger scrape:', error);
          toast({
            title: "Creator added, but scraping could not start",
            description: `${error instanceof Error ? error.message : 'Please try scraping again'} You can retry from the creator's details.`,
            variant: "destructive",
          });
        }
      }

      return creator;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["research-creators"] });
      
      if (!variables.scrapeImmediately) {
        toast({
          title: "Creator added successfully!",
          description: `${data.display_name} has been added to your creators list.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add creator",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
