import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UserInput, RecipeDefaults } from "@/types/payloadBuilder";

interface BuildPayloadParams {
  provider: string;
  model_id: string;
  user_input: UserInput;
  recipe_defaults?: RecipeDefaults;
}

interface BuildPayloadResponse {
  success: boolean;
  payload: Record<string, any>;
  warnings: string[];
  missing_required: string[];
  estimated_cost?: number;
}

/**
 * Hook to build provider-specific payloads from semantic user input
 * Uses the test-payload-builder edge function
 */
export function usePayloadBuilder() {
  return useMutation({
    mutationFn: async (params: BuildPayloadParams): Promise<BuildPayloadResponse> => {
      const { provider, model_id, user_input, recipe_defaults } = params;

      const { data, error } = await supabase.functions.invoke('test-payload-builder', {
        body: {
          provider,
          model_id,
          user_input,
          recipe_defaults: recipe_defaults || {},
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data as BuildPayloadResponse;
    },
  });
}
