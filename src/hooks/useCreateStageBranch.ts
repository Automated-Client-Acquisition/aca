import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreateBranchParams {
  outputId: string;
  stageId: string;
  branchName?: string;
  customPrompt?: string;
  modelOverrides?: Record<string, any>;
  jobId?: string; // For scoped cache invalidation
}

export function useCreateStageBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, branchName, customPrompt, modelOverrides }: CreateBranchParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('create-stage-branch', {
        body: { 
          output_id: outputId, 
          stage_id: stageId,
          branch_name: branchName,
          custom_prompt: customPrompt,
          model_overrides: modelOverrides,
          user_id: user?.id
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
        queryClient.invalidateQueries({ queryKey: ['generation-job', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
        queryClient.invalidateQueries({ queryKey: ['generation-job'] });
      }

      toast.success('Branch created successfully. Generating variant...');
    },
    onError: (error) => {
      console.error('Branch creation error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create branch');
    }
  });
}
