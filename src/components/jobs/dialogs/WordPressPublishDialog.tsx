import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Globe,
  CalendarIcon,
  Loader2,
  ExternalLink,
  Settings,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ArticleData {
  title: string;
  text: string;
  image_url?: string;
  seo?: {
    meta_title?: string;
    meta_description?: string;
    slug?: string;
    focus_keyword?: string;
  };
  metadata?: {
    excerpt?: string;
    categories?: string[];
    tags?: string[];
    featured_image_alt?: string;
    author?: string;
  };
}

interface WordPressPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleData: ArticleData;
  outputId: string;
}

type PublishStatus = "draft" | "pending" | "publish";

interface WordPressSite {
  id: string;
  name: string;
  site_url: string;
  is_valid: boolean;
}

export function WordPressPublishDialog({
  open,
  onOpenChange,
  articleData,
  outputId,
}: WordPressPublishDialogProps) {
  const { user, currentOrganization } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("draft");
  const [scheduleDate, setScheduleDate] = useState<Date>();
  const [scheduleTime, setScheduleTime] = useState("12:00");
  const [wpCategories, setWpCategories] = useState<string[]>([]);
  const [wpTags, setWpTags] = useState<string[]>([]);

  // WordPress sites (would be fetched from API keys)
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);

  // Fetch WordPress sites using currentOrganization from AuthContext
  useEffect(() => {
    const fetchData = async () => {
      if (!user || !currentOrganization) return;

      try {
        // Use currentOrganization from AuthContext - it already respects impersonation
        const { data: wpSites } = await supabase
          .from("wordpress_sites")
          .select("id, name, site_url, is_valid")
          .eq("organization_id", currentOrganization.id)
          .eq("is_active", true)
          .order("name");

        if (wpSites && wpSites.length > 0) {
          setSites(wpSites);
          // Select the first valid site, or just the first one
          const validSite = wpSites.find(s => s.is_valid) || wpSites[0];
          setSelectedSite(validSite.id);
        }
      } catch (err) {
        console.error("Error fetching WordPress sites:", err);
      } finally {
        setLoadingSites(false);
      }
    };

    if (open) {
      fetchData();
    }
  }, [open, user, currentOrganization?.id]);

  // Initialize categories/tags from article metadata
  useEffect(() => {
    if (articleData.metadata?.categories) {
      setWpCategories(articleData.metadata.categories);
    }
    if (articleData.metadata?.tags) {
      setWpTags(articleData.metadata.tags);
    }
  }, [articleData]);

  const handlePublish = async () => {
    if (!selectedSite) {
      toast.error("Please select a WordPress site");
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      // Prepare scheduled datetime if applicable
      let scheduledAt: string | undefined;
      if (publishStatus === "publish" && scheduleDate) {
        const [hours, minutes] = scheduleTime.split(":");
        const scheduledDate = new Date(scheduleDate);
        scheduledDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        scheduledAt = scheduledDate.toISOString();
      }

      // Call the edge function to publish
      const response = await supabase.functions.invoke("publish-to-wordpress", {
        body: {
          output_id: outputId,
          site_id: selectedSite,
          article: {
            title: articleData.seo?.meta_title || articleData.title,
            content: articleData.text,
            excerpt: articleData.metadata?.excerpt,
            slug: articleData.seo?.slug,
            status: publishStatus,
            categories: wpCategories,
            tags: wpTags,
            featured_image_url: articleData.image_url,
            featured_image_alt: articleData.metadata?.featured_image_alt,
            meta_description: articleData.seo?.meta_description,
            focus_keyword: articleData.seo?.focus_keyword,
            scheduled_at: scheduledAt,
          },
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const result = response.data;

      if (result.success) {
        setPublishedUrl(result.post_url);
        toast.success(
          publishStatus === "draft"
            ? "Draft saved to WordPress"
            : publishStatus === "pending"
            ? "Article submitted for review"
            : scheduledAt
            ? "Article scheduled for publishing"
            : "Article published to WordPress"
        );
      } else {
        throw new Error(result.error || "Failed to publish");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to publish to WordPress";
      setError(message);
      toast.error(message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleClose = () => {
    setPublishedUrl(null);
    setError(null);
    onOpenChange(false);
  };

  const noSitesConfigured = !loadingSites && sites.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Publish to WordPress
          </DialogTitle>
          <DialogDescription>
            Publish "{articleData.title}" to your WordPress site
          </DialogDescription>
        </DialogHeader>

        {publishedUrl ? (
          // Success state
          <div className="py-6 space-y-4">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold">
                  {publishStatus === "draft"
                    ? "Draft Saved!"
                    : publishStatus === "pending"
                    ? "Submitted for Review!"
                    : "Published!"}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Your article has been sent to WordPress
                </p>
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button asChild>
                <a href={publishedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View in WordPress
                </a>
              </Button>
            </div>
          </div>
        ) : noSitesConfigured ? (
          // No sites configured state
          <div className="py-6 space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No WordPress sites configured. Add your WordPress credentials in
                Settings to enable publishing.
              </AlertDescription>
            </Alert>
            <div className="flex justify-center">
              <Button variant="outline" asChild>
                <a href="/settings?tab=integrations">
                  <Settings className="h-4 w-4 mr-2" />
                  Go to Settings
                </a>
              </Button>
            </div>
          </div>
        ) : (
          // Form state
          <div className="space-y-6 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Site Selection */}
            <div className="space-y-2">
              <Label>WordPress Site</Label>
              {loadingSites ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading sites...
                </div>
              ) : (
                <Select value={selectedSite} onValueChange={setSelectedSite}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        <div className="flex items-center gap-2">
                          <span>{site.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({new URL(site.site_url).hostname})
                          </span>
                          {!site.is_valid && (
                            <Badge variant="destructive" className="text-xs">
                              Disconnected
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Separator />

            {/* Publish Status */}
            <div className="space-y-3">
              <Label>Publish Status</Label>
              <RadioGroup
                value={publishStatus}
                onValueChange={(v) => setPublishStatus(v as PublishStatus)}
                className="grid grid-cols-3 gap-2"
              >
                <div>
                  <RadioGroupItem
                    value="draft"
                    id="draft"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="draft"
                    className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    <span className="text-sm font-medium">Draft</span>
                    <span className="text-xs text-muted-foreground">
                      Save without publishing
                    </span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem
                    value="pending"
                    id="pending"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="pending"
                    className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    <span className="text-sm font-medium">Pending</span>
                    <span className="text-xs text-muted-foreground">
                      Submit for review
                    </span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem
                    value="publish"
                    id="publish"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="publish"
                    className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    <span className="text-sm font-medium">Publish</span>
                    <span className="text-xs text-muted-foreground">
                      Go live immediately
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Schedule (only for publish status) */}
            {publishStatus === "publish" && (
              <div className="space-y-2">
                <Label>Schedule (Optional)</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !scheduleDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {scheduleDate ? format(scheduleDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={scheduleDate}
                        onSelect={setScheduleDate}
                        disabled={(date) => date < new Date()}
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-28"
                  />
                  {scheduleDate && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setScheduleDate(undefined)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to publish immediately
                </p>
              </div>
            )}

            {/* Categories & Tags Preview */}
            {(wpCategories.length > 0 || wpTags.length > 0) && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  Categories & Tags (from Metadata tab)
                </Label>
                <div className="flex flex-wrap gap-1">
                  {wpCategories.map((cat) => (
                    <Badge key={cat} variant="secondary">
                      {cat}
                    </Badge>
                  ))}
                  {wpTags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handlePublish}
                disabled={isPublishing || !selectedSite}
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : publishStatus === "draft" ? (
                  "Save Draft"
                ) : publishStatus === "pending" ? (
                  "Submit for Review"
                ) : scheduleDate ? (
                  "Schedule"
                ) : (
                  "Publish Now"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
