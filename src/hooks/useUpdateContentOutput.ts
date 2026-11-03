import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UpdateOutputParams {
  id: string;
  data?: any;
  stage_data?: any;
  status?: 'generating' | 'review' | 'approved' | 'rejected';
  stageId?: string;
  stageStatus?: 'approved' | 'rejected';
  jobId?: string; // For scoped cache invalidation
}

export function useUpdateContentOutput() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data, stage_data, status, stageId, stageStatus }: UpdateOutputParams) => {
      // If updating a specific stage, fetch current data first
      if (stageId && stageStatus) {
        const { data: output, error: fetchError } = await supabase
          .from('content_outputs')
          .select('data')
          .eq('id', id)
          .single();

        if (fetchError) throw fetchError;

        const outputData = output.data as any;
        const stages = outputData?.stages || [];
        
        // Update the specific stage status
        const updatedStages = stages.map((stage: any) => 
          stage.id === stageId 
            ? { ...stage, status: stageStatus }
            : stage
        );

        const { error } = await supabase
          .from('content_outputs')
          .update({ 
            data: { ...outputData, stages: updatedStages }
          })
          .eq('id', id);

        if (error) throw error;
        return;
      }

      // Regular update
      const updates: any = {};
      if (data !== undefined) updates.data = data;
      if (stage_data !== undefined) updates.stage_data = stage_data;
      if (status !== undefined) updates.status = status;

      const { error } = await supabase
        .from('content_outputs')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
      if (variables.stageId && variables.stageStatus) {
        toast.success(`Stage ${variables.stageStatus}`);
      } else if (variables.status) {
        toast.success(`Output ${variables.status === 'approved' ? 'approved' : variables.status === 'rejected' ? 'rejected' : 'updated'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update output: ${error.message}`);
    }
  });
}
