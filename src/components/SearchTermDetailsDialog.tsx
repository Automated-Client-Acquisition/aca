import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Search, FileText, Lightbulb, Calendar, Tag, Plus, Loader2, ArrowRight } from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { formatDistanceToNow } from "date-fns";
import { TriggerScrapeDialog } from "@/components/TriggerScrapeDialog";
import { ScheduleManagementDialog } from "@/components/ScheduleManagementDialog";
import { SchedulesList } from "@/components/SchedulesList";
import { ScrapeHistoryTable } from "@/components/ScrapeHistoryTable";
import { useActiveScrapes } from "@/hooks/useActiveScrapes";

interface SearchTerm {
  id: string;
  search_term: string;
  platform: string;
  tags?: string[];
  total_results?: number;
  last_scraped_at?: string;
  created_at?: string;
  converted_ideas_count?: number;
}

interface SearchTermDetailsDialogProps {
  searchTerm: SearchTerm | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchTermDetailsDialog({ searchTerm, open, onOpenChange }: SearchTermDetailsDialogProps) {
  const navigate = useNavigate();
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const { activeScrapes } = useActiveScrapes({ targetType: 'search_term', targetId: searchTerm?.id || '' });

  const handleViewScrapedContent = () => {
    if (!searchTerm) return;
    onOpenChange(false);
    navigate(`/research?tab=posts&search_term=${searchTerm.id}`);
  };

  if (!searchTerm) return null;

  const activeScrape = activeScrapes?.find(s => s.search_term_id === searchTerm.id);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Search Term Details
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-4 overflow-y-auto flex-1 pr-2">
            {/* Active Scrape Progress */}
            {activeScrape && (
              <Card className="border-blue-500/20 bg-blue-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                        <h3 className="font-semibold text-blue-900 dark:text-blue-100">Scrape in Progress</h3>
                      </div>
                      <div className="space-y-1 text-sm">
                        <p className="text-muted-foreground">
                          Status: <span className="text-foreground font-medium capitalize">{activeScrape.status.toLowerCase()}</span>
                        </p>
                        <p className="text-muted-foreground">
                          Started: <span className="text-foreground font-medium">{formatDistanceToNow(new Date(activeScrape.triggered_at))} ago</span>
                        </p>
                        {activeScrape.items_scraped && (
                          <p className="text-muted-foreground">
                            Items scraped: <span className="text-foreground font-medium">{activeScrape.items_scraped}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Header Section */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Search className="w-6 h-6 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-2xl font-bold text-foreground truncate">{searchTerm.search_term}</h3>
                    <Badge variant="outline" className="font-medium mt-2">{searchTerm.platform}</Badge>
                  </div>
                </div>
                <TriggerScrapeDialog
                  type="search_term"
                  targetId={searchTerm.id}
                  targetName={searchTerm.search_term}
                  platform={searchTerm.platform}
                />
              </div>
            </div>

            {/* Stats Section */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <h3 className="font-semibold text-base">Search Results</h3>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <button
                  onClick={handleViewScrapedContent}
                  className="text-left w-full hover:bg-accent/50 rounded-lg transition-colors group"
                  disabled={!searchTerm.total_results}
                >
                  <StatCard
                    icon={FileText}
                    label="Results"
                    value={
                      <span className="flex items-center gap-1">
                        {searchTerm.total_results || 0}
                        {(searchTerm.total_results || 0) > 0 && (
                          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        )}
                      </span>
                    }
                  />
                </button>
                <StatCard icon={Lightbulb} label="Converted" value={searchTerm.converted_ideas_count || 0} />
                <StatCard icon={Calendar} label="Last Scraped" value={searchTerm.last_scraped_at ? formatDate(searchTerm.last_scraped_at) : "—"} />
              </div>
            </div>

            {/* Tags Section - moved above tabs for better visibility */}
            {searchTerm.tags && searchTerm.tags.length > 0 && (
              <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Tag className="w-5 h-5 text-muted-foreground" />
                  <h3 className="font-semibold text-base">Tags</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {searchTerm.tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="font-medium">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline Section */}
            {(searchTerm.last_scraped_at || searchTerm.created_at) && (
              <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-5 h-5 text-muted-foreground" />
                  <h3 className="font-semibold text-base">Timeline</h3>
                </div>
                <div className="space-y-3">
                  {searchTerm.created_at && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Added to platform:</span>
                      <span className="font-medium text-foreground">{formatDate(searchTerm.created_at)}</span>
                    </div>
                  )}
                  {searchTerm.last_scraped_at && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last scraped:</span>
                      <span className="font-medium text-foreground">{formatDate(searchTerm.last_scraped_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Tabs defaultValue="schedules" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="schedules">Schedules</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="schedules" className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Scraping Schedules</h3>
                  <Button onClick={() => setScheduleDialogOpen(true)} size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    New Schedule
                  </Button>
                </div>

                <SchedulesList type="search_term" targetId={searchTerm.id} />
              </TabsContent>

              <TabsContent value="history" className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Scrape History</h3>
                  {(searchTerm.total_results || 0) > 0 && (
                    <Button onClick={handleViewScrapedContent} size="sm" variant="outline">
                      <FileText className="mr-2 h-4 w-4" />
                      View matching posts
                    </Button>
                  )}
                </div>

                <ScrapeHistoryTable type="search_term" targetId={searchTerm.id} />
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      <ScheduleManagementDialog
        type="search_term"
        targetId={searchTerm.id}
        targetName={searchTerm.search_term}
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
      />
    </>
  );
}
