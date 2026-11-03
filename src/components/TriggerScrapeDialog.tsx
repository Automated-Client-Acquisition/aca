import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PlayCircle, Loader2 } from "lucide-react";
import { useTriggerScrape } from "@/hooks/useTriggerScrape";

interface TriggerScrapeDialogProps {
  type: 'creator' | 'search_term';
  targetId: string;
  targetName: string;
  platform?: string;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'cta';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function TriggerScrapeDialog({
  type,
  targetId,
  targetName,
  platform,
  disabled = false,
  variant = 'cta',
  size = 'sm',
  className = ''
}: TriggerScrapeDialogProps) {
  const [open, setOpen] = useState(false);
  const [maxItems, setMaxItems] = useState(100);
  const [maxShorts, setMaxShorts] = useState(50);
  const [daysBack, setDaysBack] = useState(7);
  const [scrapeUntil, setScrapeUntil] = useState(30);
  const [limitPerSource, setLimitPerSource] = useState(10);
  const { mutate: triggerScrape, isPending } = useTriggerScrape();
  
  const isYouTube = platform?.toLowerCase() === 'youtube';
  const isTikTok = platform?.toLowerCase() === 'tiktok';
  const isLinkedIn = platform?.toLowerCase() === 'linkedin';

  const handleTrigger = () => {
    triggerScrape({
      type,
      targetId,
      targetName,
      options: {
        maxItems,
        forceRefresh: true,
        ...(isYouTube && { maxShorts, daysBack }),
        ...((isTikTok || isYouTube) && { daysBack }),
        ...(isLinkedIn && { scrapeUntil, limitPerSource })
      }
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={disabled}
          variant={variant}
          size={size}
          className={className}
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          Scrape Now
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Scrape</DialogTitle>
          <DialogDescription>
            Set the parameters for scraping {targetName}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="maxItems">Maximum Items</Label>
            <Input
              id="maxItems"
              type="number"
              min={1}
              max={1000}
              value={maxItems}
              onChange={(e) => setMaxItems(parseInt(e.target.value) || 100)}
              placeholder="Number of items to scrape"
            />
            <p className="text-sm text-muted-foreground">
              How many {isYouTube ? 'videos' : isTikTok ? 'videos' : 'items'} to scrape (1-1000)
            </p>
          </div>
          
          {(isYouTube || isTikTok) && (
            <div className="space-y-2">
              <Label htmlFor="daysBack">Content Published After</Label>
              <Input
                id="daysBack"
                type="number"
                min={1}
                max={365}
                value={daysBack}
                onChange={(e) => setDaysBack(parseInt(e.target.value) || 7)}
                placeholder="Number of days"
              />
              <p className="text-sm text-muted-foreground">
                Only scrape content from the last {daysBack} days
              </p>
            </div>
          )}
          
          {isYouTube && (
            <>
              <div className="space-y-2">
                <Label htmlFor="maxShorts">Maximum Shorts</Label>
                <Input
                  id="maxShorts"
                  type="number"
                  min={0}
                  max={1000}
                  value={maxShorts}
                  onChange={(e) => setMaxShorts(parseInt(e.target.value) || 50)}
                  placeholder="Number of shorts to scrape"
                />
                <p className="text-sm text-muted-foreground">
                  How many YouTube Shorts to scrape (0-1000)
                </p>
              </div>
            </>
          )}
          
          {isLinkedIn && (
            <>
              <div className="space-y-2">
                <Label htmlFor="scrapeUntil">Scrape Until (days back)</Label>
                <Input
                  id="scrapeUntil"
                  type="number"
                  min={1}
                  max={365}
                  value={scrapeUntil}
                  onChange={(e) => setScrapeUntil(parseInt(e.target.value) || 30)}
                  placeholder="Number of days"
                />
                <p className="text-sm text-muted-foreground">
                  Scrape posts from the last {scrapeUntil} days
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="limitPerSource">Posts Per Source</Label>
                <Input
                  id="limitPerSource"
                  type="number"
                  min={1}
                  max={100}
                  value={limitPerSource}
                  onChange={(e) => setLimitPerSource(parseInt(e.target.value) || 10)}
                  placeholder="Maximum posts per source"
                />
                <p className="text-sm text-muted-foreground">
                  Maximum number of posts to scrape per source (1-100)
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleTrigger} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                Start Scrape
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
