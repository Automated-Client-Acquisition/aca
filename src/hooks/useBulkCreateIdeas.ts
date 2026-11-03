import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BulkCreateIdeasParams {
  contexts: string[];
}

interface CreatedIdea {
  id: string;
  title: string;
}

export function useBulkCreateIdeas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contexts }: BulkCreateIdeasParams): Promise<CreatedIdea[]> => {
      // Get current user and organization
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!userData?.organization_id) {
        throw new Error("No organization found");
      }

      // Prepare idea records for insertion
      const ideaRecords = contexts.map(context => ({
        organization_id: userData.organization_id,
        title: context.substring(0, 100), // Use first 100 chars as title
        // All other fields will use their defaults
      }));

      // Bulk insert
      const { data, error } = await supabase
        .from('content_ideas')
        .insert(ideaRecords)
        .select('id, title');

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Failed to create ideas");

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
      // Toast is handled by caller to avoid showing when no ideas are actually created
    },
    onError: (error: Error) => {
      toast.error(`Failed to save ideas: ${error.message}`);
    },
  });
}
