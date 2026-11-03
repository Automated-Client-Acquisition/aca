import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Users, Video, Eye, Calendar, FileText, Plus, Loader2, ArrowRight } from "lucide-react";
import { formatDate, formatNumber } from "@/lib/tableUtils";
import { formatDistanceToNow } from "date-fns";
import { Creator } from "@/hooks/useCreators";
import { TriggerScrapeDialog } from "@/components/TriggerScrapeDialog";
import { ScheduleManagementDialog } from "@/components/ScheduleManagementDialog";
import { SchedulesList } from "@/components/SchedulesList";
import { ScrapeHistoryTable } from "@/components/ScrapeHistoryTable";
import { useActiveScrapes } from "@/hooks/useActiveScrapes";

interface CreatorDetailsDialogProps {
  creator: Creator | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatorDetailsDialog({ creator, open, onOpenChange }: CreatorDetailsDialogProps) {
  const navigate = useNavigate();
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const { activeScrapes } = useActiveScrapes({ targetType: 'creator', targetId: creator?.id || '' });

  const handleViewScrapedContent = () => {
    if (!creator) return;
    onOpenChange(false);
    navigate(`/research?tab=posts&creator=${creator.id}`);
  };

  if (!creator) return null;

  const youtubeData = creator.metadata?.youtube;
  const activeScrape = activeScrapes?.find(s => s.creator_id === creator.id);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Creator Profile
            </DialogTitle>
            <DialogDescription className="sr-only">
              View and manage creator profile details, schedules, and scrape history
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 pt-4">
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

            <div className="rounded-lg border border-border/50 bg-muted/20 p-8">
              <div className="flex items-start gap-6">
                <Avatar className="w-28 h-28 ring-2 ring-primary/20 rounded-lg">
                  {creator.avatar_url ? (
                    <AvatarImage src={creator.avatar_url} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="absolute inset-0 bg-muted animate-pulse rounded-lg" />
                  )}
                  <AvatarFallback className="text-3xl font-bold rounded-lg">{creator.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                {!creator.avatar_url && (
                  <div className="text-xs text-muted-foreground italic">Avatar pending first scrape</div>
                )}
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-foreground mb-1">{creator.display_name}</h3>
                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant="outline" className="font-medium">{creator.platform}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <TriggerScrapeDialog
                      type="creator"
                      targetId={creator.id}
                      targetName={creator.display_name}
                      platform={creator.platform}
                      size="default"
                    />
                    {creator.channel_url && (
                      <Button asChild variant="outline" size="default">
                        <a href={creator.channel_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4" />
                          View Channel
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="schedules">Schedules</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6 pt-4">
                <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
                  <div className="flex items-center gap-2 mb-6">
                    <Video className="w-5 h-5 text-muted-foreground" />
                    <h3 className="font-semibold text-base">Channel Statistics</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <StatCard 
                      icon={Users} 
                      label="Subscribers" 
                      value={creator.subscriber_count ? formatNumber(creator.subscriber_count) : <span className="text-muted-foreground text-sm">—</span>} 
                    />
                    <StatCard 
                      icon={Video} 
                      label="Videos" 
                      value={creator.video_count ? formatNumber(creator.video_count) : <span className="text-muted-foreground text-sm">—</span>} 
                    />
                    <StatCard 
                      icon={Eye} 
                      label="Total Views" 
                      value={creator.view_count ? formatNumber(creator.view_count) : <span className="text-muted-foreground text-sm">—</span>} 
                    />
                    <button
                      onClick={handleViewScrapedContent}
                      className="text-left w-full hover:bg-accent/50 rounded-lg transition-colors group"
                      disabled={!creator.total_content_items}
                    >
                      <StatCard
                        icon={FileText}
                        label="Content Items"
                        value={
                          <span className="flex items-center gap-1">
                            {formatNumber(creator.total_content_items || 0)}
                            {(creator.total_content_items || 0) > 0 && (
                              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                            )}
                          </span>
                        }
                      />
                    </button>
                  </div>
                </div>

                {(creator.description || creator.metadata?.description) && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                      <h3 className="font-semibold text-base">Description</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {creator.description || creator.metadata?.description}
                    </p>
                  </div>
                )}

                {(creator.last_scraped_at || creator.created_at) && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-muted-foreground" />
                      <h3 className="font-semibold text-base">Timeline</h3>
                    </div>
                    <div className="space-y-3">
                      {creator.created_at && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Added to platform:</span>
                          <span className="font-medium text-foreground">{formatDate(creator.created_at)}</span>
                        </div>
                      )}
                      {creator.last_scraped_at && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Last scraped:</span>
                          <span className="font-medium text-foreground">{formatDate(creator.last_scraped_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="schedules" className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Scraping Schedules</h3>
                  <Button onClick={() => setScheduleDialogOpen(true)} size="sm" variant="cta">
                    <Plus className="mr-2 h-4 w-4" />
                    New Schedule
                  </Button>
                </div>
                
                <SchedulesList type="creator" targetId={creator.id} />
              </TabsContent>

              <TabsContent value="history" className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Scrape History</h3>
                  {(creator.total_content_items || 0) > 0 && (
                    <Button onClick={handleViewScrapedContent} size="sm" variant="outline">
                      <FileText className="mr-2 h-4 w-4" />
                      View their posts
                    </Button>
                  )}
                </div>

                <ScrapeHistoryTable type="creator" targetId={creator.id} />
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      <ScheduleManagementDialog
        type="creator"
        targetId={creator.id}
        targetName={creator.display_name}
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
      />
    </>
  );
}
