import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GenerationItem } from "@/types/generation";
import { useAuth } from "@/contexts/AuthContext";
import { getRequiredProviders, isHardRequirement, providerLabel } from "@/lib/required-api-keys";

interface CreateGenerationJobParams {
  blueprint_id: string;
  pipeline: string;
  items: GenerationItem[];
  video_config?: any;
  output_config?: any; // For non-video visual pipelines (aspect ratio only)
  configuration: {
    blueprint_name: string;
    pipeline: string;
    model_config: any;
    image_inputs?: Record<string, string[]>;
  };
}

export function useCreateGenerationJob() {
  const queryClient = useQueryClient();
  const { currentOrganization, user } = useAuth();

  return useMutation({
    mutationFn: async ({ blueprint_id, pipeline, items, video_config, output_config, configuration }: CreateGenerationJobParams) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Pre-flight: refuse to queue a job we already know will fail dispatch.
      // The MissingApiKeyAlert in the UI handles the warm path; this is the
      // belt-and-braces check for callers that bypass the alert.
      // Distinguish missing (no row) from invalid (row exists but is_valid=false,
      // typically flagged by the nightly validate-openrouter-keys cron). Same
      // user mental model split as dispatch-generation-job.
      const required = getRequiredProviders(pipeline);
      if (required.length > 0) {
        const { data: keys } = await supabase
          .from('api_keys')
          .select('provider, is_valid')
          .eq('organization_id', currentOrganization.id);
        const usable = new Set(
          (keys ?? []).filter((k) => k.is_valid !== false).map((k) => k.provider),
        );
        const presentButInvalid = new Set(
          (keys ?? []).filter((k) => k.is_valid === false).map((k) => k.provider),
        );
        const hardUnusable = required.filter((p) => isHardRequirement(p) && !usable.has(p));
        if (hardUnusable.length > 0) {
          const invalidOnes = hardUnusable.filter((p) => presentButInvalid.has(p));
          const trulyMissing = hardUnusable.filter((p) => !presentButInvalid.has(p));
          const parts: string[] = [];
          if (trulyMissing.length > 0) {
            parts.push(
              `Missing required API key${trulyMissing.length > 1 ? 's' : ''}: ${trulyMissing.map(providerLabel).join(', ')}.`,
            );
          }
          if (invalidOnes.length > 0) {
            parts.push(
              `${invalidOnes.map(providerLabel).join(', ')} key${invalidOnes.length > 1 ? 's are' : ' is'} flagged invalid — the provider may have revoked or rotated ${invalidOnes.length > 1 ? 'them' : 'it'}.`,
            );
          }
          parts.push(`Update in Settings > API Keys.`);
          throw new Error(parts.join(' '));
        }
      }

      // Create the generation job
      const { data: job, error } = await supabase
        .from('content_generation_jobs')
        .insert([{
          organization_id: currentOrganization.id,
          user_id: user.id,
          blueprint_id,
          pipeline,
          status: 'queued',
          items: items as any,
          configuration: {
            ...configuration,
            video_config,
            output_config
          } as any,
          progress: {
            total: items.length,
            completed: 0,
            failed: 0,
          } as any,
          cost: {
            estimated: items.length * 0.05, // Placeholder
            current: 0,
          } as any,
        }])
        .select()
        .single();

      if (error) throw error;

      // Fire-and-forget: dispatch in background so we can navigate immediately
      // The job detail page polls/subscribes for updates and will show errors if dispatch fails
      supabase.functions.invoke('dispatch-generation-job', {
        body: { job_id: job.id }
      }).then(({ data: dispatchResult, error: dispatchError }) => {
        if (dispatchError) {
          console.error('Failed to dispatch job:', dispatchError);
          supabase.from('content_generation_jobs')
            .update({
              status: 'failed',
              error: dispatchError.message || 'Dispatch failed - edge function error'
            })
            .eq('id', job.id);
        } else if (dispatchResult && !dispatchResult.success && dispatchResult.error) {
          console.error('Dispatch returned error:', dispatchResult.error);
          supabase.from('content_generation_jobs')
            .update({
              status: 'failed',
              error: dispatchResult.error
            })
            .eq('id', job.id);
        }
      }).catch((err) => {
        console.error('Dispatch invocation error:', err);
      });

      return job.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
      toast.success('Generation job created successfully!');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create generation job');
    },
  });
}
