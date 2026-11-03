import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCallback, useRef, useState } from "react";

interface GenerateAiAnalysisParams {
  idea_id: string;
  title: string;
  brand_voice_id?: string;
  product_id?: string;
  content_angle_id?: string;
  additional_directions?: string;
  section?: 'hooks' | 'talking_points' | 'ctas'; // Optional: for section-specific generation
  knowledge_document_ids?: string[];
}

interface AiAnalysisResult {
  ai_analysis: {
    hooks: Array<{
      text: string;
      type: string;
      why_it_works?: string;
      application_context?: string;
      engagement_impact?: string;
    }>;
    ctas: Array<{
      text: string;
      placement: string;
      type: string;
      effectiveness?: string;
      psychological_trigger?: string;
    }>;
    script_structure?: {
      opening: string;
      body: string;
      climax: string;
      closing: string;
    };
    engagement_drivers?: string[];
    viral_elements?: string[];
    content_patterns?: string[];
    target_audience?: string;
    viral_potential?: string;
    insights?: string;
    adaptation_strategy?: string;
    platform_optimization?: string;
    audience_insights?: string;
    repurposing_ideas?: string[];
  };
  emotional_triggers: string[];
  content_framework: string;
  keywords: string[];
}

export function useGenerateAiAnalysis() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setProgress("");
  }, []);

  const mutation = useMutation({
    mutationFn: async (params: GenerateAiAnalysisParams): Promise<AiAnalysisResult> => {
      setProgress("");
      setIsStreaming(true);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content-idea`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(params),
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      // Handle SSE streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let result: AiAnalysisResult | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === "progress") {
                  setProgress((prev) => prev + parsed.content);
                } else if (parsed.type === "complete") {
                  result = parsed.result;
                } else if (parsed.type === "error") {
                  throw new Error(parsed.error);
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
                if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                  console.error("Parse error:", e);
                }
              }
            }
          }
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }

      if (!result) {
        throw new Error("No result received from AI generation");
      }

      return result;
    },
    onSuccess: (_, variables) => {
      // Invalidate ideas query to refresh the data
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      queryClient.invalidateQueries({ queryKey: ["idea", variables.idea_id] });

      // Section-specific success message
      const sectionMessages: Record<string, string> = {
        hooks: "Hooks generated successfully",
        talking_points: "Talking points generated successfully",
        ctas: "CTAs generated successfully",
      };
      const message = variables.section
        ? sectionMessages[variables.section] || "Content generated successfully"
        : "AI analysis generated successfully";
      toast.success(message);
    },
    onError: (error) => {
      if (error instanceof Error && error.name === "AbortError") {
        toast.info("Generation cancelled");
        return;
      }

      const errorMessage = error instanceof Error ? error.message : "Failed to generate AI analysis";
      const lowerMessage = errorMessage.toLowerCase();

      // Check for missing OpenRouter API key
      const isMissingOpenRouter = lowerMessage.includes('openrouter') && lowerMessage.includes('not configured');
      // Check for missing default model
      const isMissingModel = lowerMessage.includes('model') && (lowerMessage.includes('not configured') || lowerMessage.includes('not set'));

      if (isMissingOpenRouter) {
        toast.error("AI not configured", {
          description: "Please add your OpenRouter API key in Settings → API Keys to use AI features.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else if (isMissingModel) {
        toast.error("Default model not set", {
          description: "Please select a default LLM model in Settings → Models.",
          duration: 8000,
          action: {
            label: "Go to Settings",
            onClick: () => window.location.href = "/settings"
          }
        });
      } else {
        toast.error("Failed to generate AI analysis", {
          description: errorMessage,
          duration: 5000,
        });
      }
    },
  });

  return {
    generateAiAnalysis: mutation.mutate,
    generateAiAnalysisAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending || isStreaming,
    progress,
    cancelGeneration,
    error: mutation.error,
  };
}
