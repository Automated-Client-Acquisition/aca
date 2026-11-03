import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreateVersionParams {
  blueprintId: string;
  versionName: string;
  changeDescription?: string;
}

export function useCreatePipelineVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ blueprintId, versionName, changeDescription }: CreateVersionParams) => {
      // Get current blueprint state
      const { data: blueprint, error: blueprintError } = await supabase
        .from('blueprints')
        .select('*')
        .eq('id', blueprintId)
        .single();

      if (blueprintError || !blueprint) throw new Error('Blueprint not found');

      // Store version in blueprint metadata (simplified approach - no separate table needed)
      const versions = (blueprint.model_config as any)?.versions || [];
      const newVersion = {
        version_number: versions.length + 1,
        version_name: versionName,
        change_description: changeDescription,
        snapshot: {
          name: blueprint.name,
          description: blueprint.description,
          pipeline: blueprint.pipeline,
          master_prompt: blueprint.master_prompt,
          structure: blueprint.structure,
          tags: blueprint.tags
        },
        created_at: new Date().toISOString()
      };

      versions.push(newVersion);

      const { error: updateError } = await supabase
        .from('blueprints')
        .update({
          model_config: {
            ...(blueprint.model_config as any),
            versions
          }
        })
        .eq('id', blueprintId);

      if (updateError) throw updateError;

      return newVersion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprints'] });
      toast.success('Pipeline version created');
    },
    onError: (error) => {
      console.error('Version creation error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create version');
    }
  });
}
