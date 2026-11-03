import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

interface ContentOutput {
  id: string;
  status: string;
  current_stage?: string;
  error_message?: string | null;
  content_ideas?: { title: string } | null;
  data?: { title?: string } | null;
  [key: string]: any;
}

export function useContentOutputs(jobId: string | null, isJobProcessing?: boolean) {
  const { currentOrganization } = useAuth();
  // Track previous output states to detect changes
  const prevOutputsRef = useRef<Map<string, { status: string; current_stage?: string }>>(new Map());
  const isInitialLoadRef = useRef(true);

  const query = useQuery({
    queryKey: ['content-outputs', jobId, currentOrganization?.id],
    queryFn: async () => {
      if (!jobId) return [];

      const { data, error } = await supabase
        .from('content_outputs')
        .select('*, content_ideas!left(title, brand_voice_id, product_id), content_generation_jobs!inner(pipeline)')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []) as ContentOutput[];
    },
    enabled: !!jobId && !!currentOrganization,
    // Use polling as fallback when realtime isn't connected or during generation
    refetchInterval: (query) => {
      const outputs = query.state.data as ContentOutput[] | undefined;
      const hasGeneratingOutputs = outputs?.some(o => o.status === 'generating');

      // Poll every 2s during generation to catch webhook updates quickly
      if (isJobProcessing || hasGeneratingOutputs) {
        return 2000;
      }
      return false;
    },
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });

  // Function to show toast notifications for content updates
  const notifyContentUpdate = useCallback((
    eventType: 'INSERT' | 'UPDATE',
    newOutput: ContentOutput,
    oldOutput?: { status: string; current_stage?: string }
  ) => {
    const title = (newOutput.data as any)?.title || newOutput.content_ideas?.title || 'Content';
    const truncatedTitle = title.length > 40 ? title.slice(0, 40) + '...' : title;

    if (eventType === 'INSERT') {
      toast.success(`New content started`, {
        description: truncatedTitle,
        duration: 3000,
      });
    } else if (eventType === 'UPDATE') {
      // Check if status changed to a completion state
      const newStage = newOutput.current_stage;
      const oldStage = oldOutput?.current_stage;
      const newStatus = newOutput.status;
      const oldStatus = oldOutput?.status;

      // Content fully completed (all stages done)
      if (newStage === 'complete' && oldStage !== 'complete') {
        toast.success(`Content ready!`, {
          description: truncatedTitle,
          duration: 4000,
        });
      }
      // Stage completed (moved to review)
      else if (newStatus === 'review' && oldStatus === 'generating') {
        toast.info(`Stage completed`, {
          description: truncatedTitle,
          duration: 3000,
        });
      }
      // Content failed
      else if (newStatus === 'failed' && oldStatus !== 'failed') {
        const errorMsg = newOutput.error_message;
        toast.error(`Content failed`, {
          description: errorMsg
            ? `${truncatedTitle}: ${errorMsg.length > 100 ? errorMsg.slice(0, 100) + '...' : errorMsg}`
            : truncatedTitle,
          duration: 8000,
        });
      }
    }
  }, []);

  // Track output changes and show notifications
  useEffect(() => {
    if (!query.data) return;

    // Skip notifications on initial load
    if (isInitialLoadRef.current) {
      // Initialize tracking map
      const newMap = new Map<string, { status: string; current_stage?: string }>();
      query.data.forEach(output => {
        newMap.set(output.id, { status: output.status, current_stage: output.current_stage });
      });
      prevOutputsRef.current = newMap;
      isInitialLoadRef.current = false;
      return;
    }

    const prevMap = prevOutputsRef.current;
    const newMap = new Map<string, { status: string; current_stage?: string }>();

    query.data.forEach(output => {
      const prev = prevMap.get(output.id);

      if (!prev) {
        // New output
        notifyContentUpdate('INSERT', output);
      } else if (prev.status !== output.status || prev.current_stage !== output.current_stage) {
        // Output updated
        notifyContentUpdate('UPDATE', output, prev);
      }

      newMap.set(output.id, { status: output.status, current_stage: output.current_stage });
    });

    prevOutputsRef.current = newMap;
  }, [query.data, notifyContentUpdate]);

  // Reset initial load flag when job changes
  useEffect(() => {
    isInitialLoadRef.current = true;
    prevOutputsRef.current = new Map();
  }, [jobId]);

  return query;
}
