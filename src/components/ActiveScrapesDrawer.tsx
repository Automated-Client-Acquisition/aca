import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useActiveScrapes } from "@/hooks/useActiveScrapes";
import { useAbortScrape } from "@/hooks/useAbortScrape";
import { useResetStaleScrape, useResetAllStaleScrapes } from "@/hooks/useResetStaleScrape";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScrapeStatusBadge } from "./ScrapeStatusBadge";
import { NextScrapeIndicator } from "./NextScrapeIndicator";
import { PlatformBadge } from "./PlatformBadge";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Calendar, AlertTriangle, Loader2, XCircle, Pause, Trash2, RotateCcw, Clock } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { toast } from "sonner";

interface ActiveScrapesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Helper to check if a scrape is stale (running for more than 1 hour)
function isStaleScrape(triggeredAt: string): boolean {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  return new Date(triggeredAt).getTime() < oneHourAgo;
}

export function ActiveScrapesDrawer({ open, onOpenChange }: ActiveScrapesDrawerProps) {
  const { activeScrapes, isLoading: activeScrapsLoading } = useActiveScrapes();
  const { mutate: abortScrape, isPending: isAborting } = useAbortScrape();
  const { mutate: resetScrape, isPending: isResetting } = useResetStaleScrape();
  const { mutate: resetAllStale, isPending: isResettingAll } = useResetAllStaleScrapes();

  // Count stale scrapes
  const staleScrapeCount = activeScrapes?.filter(s => isStaleScrape(s.triggered_at)).length || 0;

  // Get upcoming schedules
  const { data: upcomingSchedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ['upcoming-schedules'],
    queryFn: async () => {
      const [creatorSchedules, searchSchedules] = await Promise.all([
        supabase
          .from('scrape_schedules')
          .select('id, frequency_type, next_run_at, creator_id')
          .eq('is_active', true)
          .order('next_run_at', { ascending: true })
          .limit(5),
        supabase
          .from('search_schedules')
          .select('id, frequency_type, next_run_at, search_term_id')
          .eq('is_active', true)
          .order('next_run_at', { ascending: true })
          .limit(5)
      ]);

      // Fetch creator/search term details separately
      const creatorIds = (creatorSchedules.data || []).map(s => s.creator_id).filter(Boolean);
      const searchTermIds = (searchSchedules.data || []).map(s => s.search_term_id).filter(Boolean);

      const [creators, searchTerms] = await Promise.all([
        creatorIds.length > 0 
          ? supabase.from('research_creators').select('id, display_name, platform').in('id', creatorIds)
          : { data: [] },
        searchTermIds.length > 0
          ? supabase.from('research_search_terms').select('id, search_term, platform').in('id', searchTermIds)
          : { data: [] }
      ]);

      const creatorMap = new Map((creators.data || []).map(c => [c.id, c]));
      const searchTermMap = new Map((searchTerms.data || []).map(s => [s.id, s]));

      const combined = [
        ...(creatorSchedules.data || []).map(s => {
          const creator = creatorMap.get(s.creator_id!);
          return {
            ...s,
            type: 'creator' as const,
            name: creator?.display_name || 'Unknown',
            platform: creator?.platform || 'unknown'
          };
        }),
        ...(searchSchedules.data || []).map(s => {
          const searchTerm = searchTermMap.get(s.search_term_id!);
          return {
            ...s,
            type: 'search_term' as const,
            name: searchTerm?.search_term || 'Unknown',
            platform: searchTerm?.platform || 'unknown'
          };
        })
      ].sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime()).slice(0, 10);

      return combined;
    },
    enabled: open,
  });

  // Get recent failures
  const { data: recentFailures } = useQuery({
    queryKey: ['recent-failures'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_scrape_runs')
        .select('run_id, status, error_message, completed_at, creator_id, search_term_id, apify_run_url')
        .eq('status', 'FAILED')
        .order('completed_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      // Fetch creator/search term names
      const creatorIds = (data || []).map(f => f.creator_id).filter(Boolean);
      const searchTermIds = (data || []).map(f => f.search_term_id).filter(Boolean);

      const [creators, searchTerms] = await Promise.all([
        creatorIds.length > 0
          ? supabase.from('research_creators').select('id, display_name, platform').in('id', creatorIds)
          : { data: [] },
        searchTermIds.length > 0
          ? supabase.from('research_search_terms').select('id, search_term, platform').in('id', searchTermIds)
          : { data: [] }
      ]);

      const creatorMap = new Map((creators.data || []).map(c => [c.id, c]));
      const searchTermMap = new Map((searchTerms.data || []).map(s => [s.id, s]));

      return (data || []).map(f => {
        const creator = creatorMap.get(f.creator_id!);
        const searchTerm = searchTermMap.get(f.search_term_id!);
        return {
          ...f,
          name: creator?.display_name || searchTerm?.search_term || 'Unknown',
          platform: creator?.platform || searchTerm?.platform || 'unknown'
        };
      });
    },
    enabled: open,
  });

  // Mutations for pause/delete schedules
  const queryClient = useQueryClient();

  const toggleScheduleMutation = useMutation({
    mutationFn: async ({ scheduleId, type, isActive }: { scheduleId: string; type: 'creator' | 'search_term'; isActive: boolean }) => {
      const tableName = type === 'creator' ? 'scrape_schedules' : 'search_schedules';
      const { error } = await supabase
        .from(tableName)
        .update({ is_active: !isActive })
        .eq('id', scheduleId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['upcoming-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success(variables.isActive ? 'Schedule paused' : 'Schedule resumed');
    },
    onError: (error: Error) => {
      toast.error('Failed to update schedule', { description: error.message });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async ({ scheduleId, type }: { scheduleId: string; type: 'creator' | 'search_term' }) => {
      const tableName = type === 'creator' ? 'scrape_schedules' : 'search_schedules';
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', scheduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upcoming-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Schedule deleted');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete schedule', { description: error.message });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Scraping Activity</SheetTitle>
          <SheetDescription>
            View active scrapes, upcoming schedules, and recent failures
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-6">
          <div className="space-y-6">
            {/* Active Scrapes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Active Scrapes ({activeScrapes?.length || 0})
                </h3>
                {staleScrapeCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resetAllStale(1)}
                    disabled={isResettingAll}
                    className="h-7 text-xs gap-1"
                  >
                    {isResettingAll ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Reset {staleScrapeCount} Stale
                  </Button>
                )}
              </div>
              
              {activeScrapsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : activeScrapes?.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No active scrapes
                </p>
              ) : (
                <div className="space-y-2">
                  {activeScrapes?.map((scrape) => {
                    const isStale = isStaleScrape(scrape.triggered_at);
                    return (
                      <div
                        key={scrape.run_id}
                        className={`border rounded-lg p-3 space-y-2 ${isStale ? 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {isStale ? (
                              <Clock className="h-4 w-4 text-amber-600 flex-shrink-0" />
                            ) : (
                              <Loader2 className="h-4 w-4 text-blue-600 animate-spin flex-shrink-0" />
                            )}
                            <span className="font-medium text-sm truncate">
                              {isStale ? 'Stale Scrape' : 'Active Scrape'}
                            </span>
                            {isStale && (
                              <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px] px-1.5 py-0">
                                No webhook received
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <ScrapeStatusBadge status={scrape.status as any} size="sm" />
                            {isStale ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => resetScrape(scrape.run_id)}
                                disabled={isResetting}
                                className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-100"
                                title="Reset stale scrape"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => abortScrape(scrape.run_id)}
                                disabled={isAborting}
                                className="h-7 w-7 p-0"
                                title="Abort scrape"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Started {formatDistanceToNow(new Date(scrape.triggered_at))} ago</span>
                          {scrape.items_scraped > 0 && <span>• {scrape.items_scraped} items</span>}
                        </div>
                        {isStale && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            This scrape may be stuck. Check if the Apify webhook is configured correctly.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* Upcoming Schedules */}
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Upcoming Schedules
              </h3>
              
              {schedulesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : upcomingSchedules?.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No active schedules
                </p>
              ) : (
                <div className="space-y-2">
                  {upcomingSchedules?.map((schedule) => {
                    const scheduleType = schedule.type === 'creator' ? 'creator' : 'search_term';
                    return (
                      <div key={schedule.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <PlatformBadge platform={schedule.platform} variant="default" className="flex-shrink-0" />
                            <span className="font-medium text-sm truncate">{schedule.name}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-xs capitalize">
                              {schedule.frequency_type}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleScheduleMutation.mutate({
                                scheduleId: schedule.id,
                                type: scheduleType,
                                isActive: true
                              })}
                              disabled={toggleScheduleMutation.isPending}
                              className="h-7 w-7 p-0"
                              title="Pause schedule"
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteScheduleMutation.mutate({
                                scheduleId: schedule.id,
                                type: scheduleType
                              })}
                              disabled={deleteScheduleMutation.isPending}
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              title="Delete schedule"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <NextScrapeIndicator
                          nextRunAt={schedule.next_run_at}
                          frequency={schedule.frequency_type}
                          className="text-xs"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* Recent Failures */}
            {recentFailures && recentFailures.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Recent Failures ({recentFailures.length})
                </h3>
                
                <div className="space-y-2">
                  {recentFailures.map((failure: any) => (
                    <div key={failure.run_id} className="border border-destructive/20 bg-destructive/5 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <PlatformBadge platform={failure.platform} variant="outline" className="flex-shrink-0" />
                          <span className="font-medium text-sm truncate">
                            {failure.name}
                          </span>
                        </div>
                        <ScrapeStatusBadge status="FAILED" size="sm" animated={false} />
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Failed {formatDistanceToNow(new Date(failure.completed_at))} ago
                      </p>
                      {failure.error_message && (
                        <p className="text-xs text-destructive line-clamp-2">
                          {failure.error_message}
                        </p>
                      )}
                      {failure.apify_run_url && (
                        <Button variant="ghost" size="sm" className="h-7 mt-2" asChild>
                          <a href={failure.apify_run_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            View in Apify
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
