import { useState, type SVGProps } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Youtube, Linkedin, ChevronLeft } from "lucide-react";
import { useCreateSearchTerm } from "@/hooks/useCreateSearchTerm";
import { searchTermSchema, type SearchTermFormData } from "@/lib/validations";
import { cn } from "@/lib/utils";
import { ResearchScheduleFields } from "@/components/ResearchScheduleFields";
import { defaultResearchSchedule } from "@/lib/research-schedule";
import { useAddResearchSource } from "@/hooks/useAddResearchSource";

interface AddSearchTermDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Platform = "youtube" | "tiktok" | "linkedin" | "twitter";
type Step = "platform" | "info" | "scrape";

const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const platforms = [
  { id: "youtube", name: "YouTube", icon: Youtube, color: "text-red-600" },
  { id: "tiktok", name: "TikTok", icon: (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
    </svg>
  ), color: "text-foreground" },
  { id: "linkedin", name: "LinkedIn", icon: Linkedin, color: "text-blue-600" },
  { id: "twitter", name: "X (Twitter)", icon: XIcon, color: "text-foreground" },
] as const;

export function AddSearchTermDialog({ open, onOpenChange }: AddSearchTermDialogProps) {
  const [step, setStep] = useState<Step>("platform");
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [scrapeImmediately, setScrapeImmediately] = useState(false);

  const createSearchTerm = useCreateSearchTerm();
  const [schedule, setSchedule] = useState({ ...defaultResearchSchedule });
  const sourceSetup = useAddResearchSource("search_term");

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    reset,
  } = useForm<SearchTermFormData>({
    resolver: zodResolver(searchTermSchema),
    defaultValues: {
      scrapeImmediately: false,
      maxResults: 50,
    },
  });

  const handlePlatformSelect = (platform: Platform) => {
    setSelectedPlatform(platform);
    setValue("platform", platform);
    setStep("info");
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      const newTags = [...tags, tagInput.trim()];
      setTags(newTags);
      setValue("tags", newTags);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    setValue("tags", newTags);
  };

  const onSubmit = (data: SearchTermFormData) => {
    return sourceSetup.save(async () => {
      const source = await createSearchTerm.mutateAsync(data);
      return { id: source.id, name: source.search_term, organizationId: source.organization_id };
    }, schedule, () => {
      onOpenChange(false);
      resetForm();
    });
  };

  const resetForm = () => {
    reset();
    setStep("platform");
    setSelectedPlatform(null);
    setTags([]);
    setTagInput("");
    setScrapeImmediately(false);
    setSchedule({ ...defaultResearchSchedule });
    sourceSetup.reset();
  };

  const handleClose = () => {
    if (sourceSetup.isPending) return;
    onOpenChange(false);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle>
            {step === "platform" && "Select Platform"}
            {step === "info" && `Add ${selectedPlatform ? platforms.find(p => p.id === selectedPlatform)?.name : ""} Search Term`}
            {step === "scrape" && "Scraping Configuration"}
          </DialogTitle>
          <DialogDescription>
            {step === "platform" && "Choose the platform where you want to search for content"}
            {step === "info" && "Enter the details for your search term"}
            {step === "scrape" && "Configure how you want to scrape content for this search term"}
          </DialogDescription>
        </DialogHeader>

        {step === "platform" && (
          <div className="grid grid-cols-2 gap-4 py-6">
            {platforms.map((platform) => {
              const Icon = platform.icon;
              return (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => handlePlatformSelect(platform.id as Platform)}
                  className="group relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-border bg-card p-6 transition-all hover:border-primary hover:bg-accent hover:shadow-md"
                >
                  <Icon className={cn("h-12 w-12", platform.color)} />
                  <span className="font-medium">{platform.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === "info" && (
          <form onSubmit={handleSubmit(() => setStep("scrape"), (validationErrors) => {
            if (!validationErrors.searchTerm && !validationErrors.platform) setStep("scrape");
          })} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="searchTerm">Search Term *</Label>
              <Input
                id="searchTerm"
                placeholder="e.g., AI automation, content marketing"
                {...register("searchTerm")}
              />
              {errors.searchTerm && (
                <p className="text-sm text-destructive">{errors.searchTerm.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Enter keywords or phrases to search for on {selectedPlatform}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add notes about this search term..."
                className="min-h-[100px] resize-none"
                {...register("notes")}
              />
              <p className="text-xs text-muted-foreground">
                Internal notes about what type of content you're looking for
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tags (Optional)</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add a tag"
                />
                <Button type="button" variant="outline" onClick={handleAddTag}>
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      {tag} ×
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-between gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("platform")}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={sourceSetup.isPending} onClick={handleClose}>
                  {sourceSetup.savedSource ? "Finish later" : "Cancel"}
                </Button>
                <Button variant="cta" type="submit" disabled={sourceSetup.isPending}>
                  Next: Scraping →
                </Button>
              </div>
            </div>
          </form>
        )}

        {step === "scrape" && (
          <form onSubmit={handleSubmit(onSubmit, (validationErrors) => {
            if (validationErrors.searchTerm || validationErrors.platform) setStep("info");
          })} className="space-y-4">
            <ResearchScheduleFields value={schedule} onChange={setSchedule} disabled={sourceSetup.isPending} />
            <fieldset disabled={sourceSetup.isPending || !!sourceSetup.savedSource} className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <Checkbox id="searchScrapeImmediately" checked={scrapeImmediately}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true;
                    setScrapeImmediately(enabled);
                    setValue("scrapeImmediately", enabled);
                    if (!enabled) setValue("maxResults", 50);
                  }} />
                <Label htmlFor="searchScrapeImmediately" className="cursor-pointer">Scrape content immediately after creation</Label>
              </div>
              {scrapeImmediately && (
              <div className="space-y-2">
                <Label htmlFor="maxResults">Maximum Results</Label>
                <Input
                  id="maxResults"
                  type="number"
                  min={1}
                  max={100}
                  placeholder="50"
                  {...register("maxResults", { valueAsNumber: true })}
                />
                {errors.maxResults && (
                  <p className="text-sm text-destructive">{errors.maxResults.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  How many results to scrape now (1–100)
                </p>
              </div>

              )}
            </fieldset>
            {sourceSetup.error && <p role="alert" className="text-sm text-destructive">{sourceSetup.error}</p>}
            <div className="rounded-lg border bg-muted/50 p-4">
              <h4 className="font-medium mb-2">Scraping Summary</h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>• Platform: <span className="text-foreground font-medium capitalize">{selectedPlatform}</span></p>
                <p>• Search Term: <span className="text-foreground font-medium">{watch("searchTerm")}</span></p>
                {scrapeImmediately && <p>• Immediate scrape: <span className="text-foreground font-medium">{watch("maxResults") || 50} results</span></p>}
              </div>
            </div>

            <div className="sticky bottom-0 flex flex-wrap justify-between gap-2 bg-background py-4">
              <Button
                type="button"
                variant="outline"
                disabled={sourceSetup.isPending || !!sourceSetup.savedSource}
                onClick={() => setStep("info")}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={sourceSetup.isPending} onClick={handleClose}>
                  {sourceSetup.savedSource ? "Finish later" : "Cancel"}
                </Button>
                <Button variant="cta" type="submit" disabled={sourceSetup.isPending}>
                  {sourceSetup.isPending ? "Saving..." : sourceSetup.savedSource ? (schedule.enabled ? "Retry schedule" : "Done") : schedule.enabled ? "Add search & schedule" : scrapeImmediately ? "Add search & scrape" : "Add search"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
