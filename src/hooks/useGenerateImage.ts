import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GenerateImageParams {
  outputId: string;
  prompt: string;
  instructions?: string;
  referenceImage?: string;
  jobId?: string; // For scoped cache invalidation
}

export function useGenerateImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, prompt, instructions, referenceImage }: GenerateImageParams) => {
      // Get organization's API key for image generation
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: userOrg } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!userOrg?.organization_id) throw new Error('No organization found');

      // Call edge function to generate image
      const { data, error } = await supabase.functions.invoke('generate-image', {
        body: {
          output_id: outputId,
          prompt,
          instructions,
          reference_image: referenceImage,
          organization_id: userOrg.organization_id
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Return just the image URL for easy consumption
      return data?.image_url;
    },
    onSuccess: (_, variables) => {
      // Invalidate content outputs to refetch with new image - scoped if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
      toast.success('Image generation started');
    },
    onError: (error: Error) => {
      const lowerMessage = error.message?.toLowerCase() || '';

      // Check for missing Replicate API key
      const isMissingReplicate = lowerMessage.includes('replicate') && (lowerMessage.includes('not configured') || lowerMessage.includes('not found'));
      // Check for missing default model
      const isMissingModel = lowerMessage.includes('model') && (lowerMessage.includes('not configured') || lowerMessage.includes('not set'));

      if (isMissingReplicate) {
        toast.error("Image generation not configured", {
          description: "Please add your Replicate API key in Settings → API Keys to generate images.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else if (isMissingModel) {
        toast.error("Default model not set", {
          description: "Please select a default image generation model in Settings → Models.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else {
        toast.error("Failed to generate image", {
          description: error.message,
          duration: 5000,
        });
      }
    }
  });
}
