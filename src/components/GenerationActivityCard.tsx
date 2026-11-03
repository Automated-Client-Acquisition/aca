import { Card } from "@/components/ui/card";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { subHours } from "date-fns";

export function GenerationActivityCard() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['generation-activity'],
    queryFn: async () => {
      // Count active generation jobs
      const { count: activeJobs } = await supabase
        .from('content_generation_jobs')
        .select('id', { count: 'exact' })
        .in('status', ['queued', 'processing'])
        .limit(0);

      // Count recent completions (last 24h)
      const { count: recentCompletions } = await supabase
        .from('content_generation_jobs')
        .select('id', { count: 'exact' })
        .eq('status', 'completed')
        .gte('completed_at', subHours(new Date(), 24).toISOString())
        .limit(0);

      return {
        activeJobs: activeJobs || 0,
        recentCompletions: recentCompletions || 0,
      };
    },
    refetchInterval: 10000, // Refresh every 10s
  });

  // Subscribe to realtime changes
  useEffect(() => {
    const channel = supabase
      .channel('generation-activity-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'content_generation_jobs',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['generation-activity'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  if (isLoading) {
    return <Skeleton className="h-24 w-64" />;
  }

  const hasActivity = (data?.activeJobs || 0) > 0;

  return (
    <Card 
      className={cn(
        "p-4 transition-all border-border/50",
        hasActivity && "border-primary/20 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          hasActivity ? "bg-primary/10" : "bg-muted"
        )}>
          <Sparkles className={cn(
            "w-5 h-5",
            hasActivity ? "text-primary" : "text-muted-foreground"
          )} />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            AI Generation Activity
            {(data?.activeJobs || 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Generating
              </span>
            )}
          </h3>
          
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {(data?.activeJobs || 0) > 0 ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 text-blue-600 dark:text-blue-400 animate-spin" />
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  {data?.activeJobs} generation job{data?.activeJobs !== 1 ? 's' : ''} running
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span>No active generation jobs</span>
              </div>
            )}
            
            {(data?.recentCompletions || 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                <span>{data?.recentCompletions} completed (24h)</span>
              </div>
            )}
            
            {!hasActivity && (data?.recentCompletions || 0) === 0 && (
              <div className="text-muted-foreground">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
