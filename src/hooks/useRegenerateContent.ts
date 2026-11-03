import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RegenerateContentParams {
  outputId: string;
  stageId?: string;
  customPrompt?: string;
  instructions?: string;
  jobId?: string; // For scoped cache invalidation
}

export function useRegenerateContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, customPrompt, instructions }: RegenerateContentParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: userOrg } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!userOrg?.organization_id) throw new Error('No organization found');

      // Call edge function to regenerate content
      const { data, error } = await supabase.functions.invoke('regenerate-content', {
        body: {
          output_id: outputId,
          stage_id: stageId,
          custom_prompt: customPrompt,
          instructions: instructions,
          organization_id: userOrg.organization_id
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
      toast.success(variables.stageId
        ? 'Stage content regenerated successfully!'
        : 'Content regenerated successfully!'
      );
    },
    onError: (error: Error) => {
      const lowerMessage = error.message?.toLowerCase() || '';

      // Check for missing OpenRouter API key
      const isMissingOpenRouter = lowerMessage.includes('openrouter') && (lowerMessage.includes('not configured') || lowerMessage.includes('not found'));
      // Check for missing Replicate API key
      const isMissingReplicate = lowerMessage.includes('replicate') && (lowerMessage.includes('not configured') || lowerMessage.includes('not found'));
      // Check for missing ElevenLabs API key
      const isMissingElevenLabs = lowerMessage.includes('elevenlabs') && (lowerMessage.includes('not configured') || lowerMessage.includes('not found'));
      // Check for missing default model
      const isMissingModel = lowerMessage.includes('model') && (lowerMessage.includes('not configured') || lowerMessage.includes('not set'));

      if (isMissingOpenRouter) {
        toast.error("AI not configured", {
          description: "Please add your OpenRouter API key in Settings → API Keys to regenerate content.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else if (isMissingReplicate) {
        toast.error("Image/Video generation not configured", {
          description: "Please add your Replicate API key in Settings → API Keys.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else if (isMissingElevenLabs) {
        toast.error("Voiceover not configured", {
          description: "Please add your ElevenLabs API key in Settings → API Keys to generate voiceovers.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else if (isMissingModel) {
        toast.error("Default model not set", {
          description: "Please select a default model in Settings → Models.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else {
        toast.error("Failed to regenerate content", {
          description: error.message,
          duration: 5000,
        });
      }
    }
  });
}
