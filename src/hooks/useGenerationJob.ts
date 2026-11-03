import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

type GenerationJob = Database['public']['Tables']['content_generation_jobs']['Row'];

export function useGenerationJob(jobId: string | null, onComplete?: () => void) {
  const queryClient = useQueryClient();
  const previousStatusRef = useRef<string | null>(null);
  const { data: job, refetch } = useQuery({
    queryKey: ['generation-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      const { data, error } = await supabase
        .from('content_generation_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling if job is complete or failed
      if (!data || data.status === 'completed' || data.status === 'failed') {
        return false;
      }
      // Poll every 3 seconds while pending/processing
      return 3000;
    },
  });

  // Real-time subscription for job updates with stage notifications
  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`generation-job-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'content_generation_jobs',
          filter: `id=eq.${jobId}`
        },
        () => {
          queryClient.refetchQueries({ queryKey: ['generation-job', jobId] });
          queryClient.refetchQueries({ queryKey: ['content-outputs-progress', jobId] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'content_outputs',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          const newData = payload.new as any;
          
          // Show stage progress notifications
          if (newData?.current_stage && payload.eventType === 'UPDATE') {
            if (newData.current_stage === 'complete') {
              toast.success('All stages completed', {
                description: 'Content is ready for review'
              });
            } else if (newData.status === 'review') {
              toast.info(`Stage "${newData.current_stage}" completed`, {
                description: 'Waiting for your approval'
              });
            }
          }
          
          queryClient.refetchQueries({ queryKey: ['content-outputs-progress', jobId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, queryClient]);

  // Get actual output count for fallback
  const { data: outputsData } = useQuery({
    queryKey: ['content-outputs-progress', jobId],
    queryFn: async () => {
      if (!jobId) return [];
      
      const { data, error } = await supabase
        .from('content_outputs')
        .select('id, status, error_message')
        .eq('job_id', jobId);

      if (error) throw error;
      return data || [];
    },
    enabled: !!jobId,
    refetchInterval: 5000,
  });

  // Corrected progress using actual output count as fallback
  const correctedProgress = useMemo(() => {
    if (!job) return null;
    
    const progress = job.progress as any;
    const actualCompleted = outputsData?.length || 0;
    const dbCompleted = progress?.completed || 0;
    const dbFailed = progress?.failed || 0;
    
    // Use the maximum of database count and actual output count
    const correctedCompleted = Math.max(dbCompleted, actualCompleted);
    
    return {
      total: progress?.total || 0,
      completed: correctedCompleted,
      failed: dbFailed
    };
  }, [job, outputsData]);

  useEffect(() => {
    // Only show notifications when status actually changes, not on initial mount
    const currentStatus = job?.status;
    const previousStatus = previousStatusRef.current;
    
    if (currentStatus && previousStatus && currentStatus !== previousStatus) {
      if (currentStatus === 'completed') {
        const items = typeof job.items === 'object' && Array.isArray(job.items) ? job.items : [];
        const count = items.length;
        toast.success(`Generated ${count} content piece${count !== 1 ? 's' : ''}!`, {
          description: 'All stages completed successfully'
        });
        queryClient.invalidateQueries({ queryKey: ['content-angles'] });
        onComplete?.();
      } else if (currentStatus === 'failed') {
        const errorMsg = typeof job.error === 'string' ? job.error : 'Failed to generate content';
        toast.error('Generation failed', {
          description: errorMsg
        });
        onComplete?.();
      } else if (currentStatus === 'review') {
        toast.info('Content ready for review', {
          description: 'Review and approve/reject generated content'
        });
      }
    }
    
    // Update the previous status
    previousStatusRef.current = currentStatus || null;
  }, [job?.status, job?.items, job?.error, onComplete, queryClient]);

  return {
    job,
    correctedProgress,
    isGenerating: job?.status === 'queued' || job?.status === 'processing',
    refetch,
  };
}
