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
import { Youtube, Instagram, Linkedin } from "lucide-react";
import { useCreateCreator } from "@/hooks/useCreateCreator";
import {
  creatorSchema,
  type CreatorFormData,
} from "@/lib/validations";
import { cn } from "@/lib/utils";
import { ResearchScheduleFields } from "@/components/ResearchScheduleFields";
import { defaultResearchSchedule } from "@/lib/research-schedule";
import { useAddResearchSource } from "@/hooks/useAddResearchSource";

interface AddCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Platform = "youtube" | "instagram" | "tiktok" | "linkedin" | "twitter";
type Step = "platform" | "info" | "scrape";

const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const platforms = [
  { id: "youtube", name: "YouTube", icon: Youtube, color: "text-red-600" },
  { id: "instagram", name: "Instagram", icon: Instagram, color: "text-pink-600" },
  { id: "tiktok", name: "TikTok", icon: (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
    </svg>
  ), color: "text-foreground" },
  { id: "linkedin", name: "LinkedIn", icon: Linkedin, color: "text-blue-600" },
  { id: "twitter", name: "X (Twitter)", icon: XIcon, color: "text-foreground" },
] as const;

export function AddCreatorDialog({ open, onOpenChange }: AddCreatorDialogProps) {
  const [step, setStep] = useState<Step>("platform");
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [scrapeImmediately, setScrapeImmediately] = useState(false);

  const createCreator = useCreateCreator();
  const [schedule, setSchedule] = useState({ ...defaultResearchSchedule });
  const sourceSetup = useAddResearchSource("creator");

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    reset,
  } = useForm<CreatorFormData>({
    resolver: zodResolver(creatorSchema),
    defaultValues: { scrapeImmediately: false },
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

  const onSubmit = (data: CreatorFormData) => {
    return sourceSetup.save(async () => {
      const source = await createCreator.mutateAsync(data);
      return { id: source.id, name: source.display_name, organizationId: source.organization_id };
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
            {step === "info" && `Add ${selectedPlatform ? platforms.find(p => p.id === selectedPlatform)?.name : ""} Creator`}
            {step === "scrape" && "Scraping Configuration"}
          </DialogTitle>
          <DialogDescription>
            {step === "platform" && "Choose the platform where this creator posts content"}
            {step === "info" && "Enter the creator's information"}
            {step === "scrape" && "Choose recurring scraping, an immediate scrape, or both"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((data) => step === "info" ? setStep("scrape") : onSubmit(data), (validationErrors) => {
          if (Object.keys(validationErrors).some((key) => key !== "scrapeConfig")) setStep("info");
          else setStep("scrape");
        })} className="space-y-6">
          {/* Step 1: Platform Selection */}
          {step === "platform" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {platforms.map((platform) => (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => handlePlatformSelect(platform.id as Platform)}
                  className="flex flex-col items-center justify-center gap-3 p-6 rounded-lg border-2 border-border hover:border-primary hover:bg-accent transition-all"
                >
                  <platform.icon className={cn("w-12 h-12", platform.color)} />
                  <span className="font-medium">{platform.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Creator Info */}
          {step === "info" && selectedPlatform && (
            <div className="space-y-4">
              {/* Platform-specific input */}
              <div className="space-y-2">
                {selectedPlatform === "youtube" && (
                  <>
                    <Label htmlFor="channelUrl">Channel URL *</Label>
                    <Input
                      id="channelUrl"
                      placeholder="https://youtube.com/@channelname"
                      {...register("channelUrl")}
                    />
                    {"channelUrl" in errors && errors.channelUrl && (
                      <p className="text-sm text-destructive">{errors.channelUrl.message as string}</p>
                    )}
                  </>
                )}

                {selectedPlatform === "instagram" && (
                  <>
                    <Label htmlFor="username">Username (without @) *</Label>
                    <Input
                      id="username"
                      placeholder="username"
                      {...register("username")}
                    />
                    {"username" in errors && errors.username && (
                      <p className="text-sm text-destructive">{errors.username.message as string}</p>
                    )}
                  </>
                )}

                {selectedPlatform === "tiktok" && (
                  <>
                    <Label htmlFor="username">Username (without @) *</Label>
                    <Input
                      id="username"
                      placeholder="username"
                      {...register("username")}
                    />
                    {"username" in errors && errors.username && (
                      <p className="text-sm text-destructive">{errors.username.message as string}</p>
                    )}
                  </>
                )}

                {selectedPlatform === "linkedin" && (
                  <>
                    <Label htmlFor="profileUrl">Profile URL *</Label>
                    <Input
                      id="profileUrl"
                      placeholder="https://linkedin.com/in/username"
                      {...register("profileUrl")}
                    />
                    {"profileUrl" in errors && errors.profileUrl && (
                      <p className="text-sm text-destructive">{errors.profileUrl.message as string}</p>
                    )}
                  </>
                )}

                {selectedPlatform === "twitter" && (
                  <>
                    <Label htmlFor="username">Handle (without @) *</Label>
                    <Input
                      id="username"
                      placeholder="handle"
                      {...register("username")}
                    />
                    {"username" in errors && errors.username && (
                      <p className="text-sm text-destructive">{errors.username.message as string}</p>
                    )}
                  </>
                )}
              </div>

              {/* Display Name */}
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name (Optional)</Label>
                <Input
                  id="displayName"
                  placeholder="Creator's display name"
                  {...register("displayName")}
                />
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <Label htmlFor="tags">Tags (Optional)</Label>
                <div className="flex gap-2">
                  <Input
                    id="tags"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
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
                        className="cursor-pointer"
                        onClick={() => handleRemoveTag(tag)}
                      >
                        {tag} ×
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes about this creator"
                  rows={3}
                  {...register("notes")}
                />
              </div>

              <div className="flex justify-between pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("platform")}
                >
                  ← Back
                </Button>
                <Button
                  type="submit"
                  variant="cta"
                >
                  Next: Scraping →
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Scraping Config */}
          {step === "scrape" && (
            <div className="space-y-4">
              <ResearchScheduleFields value={schedule} onChange={setSchedule} disabled={sourceSetup.isPending} />
              <fieldset disabled={sourceSetup.isPending || !!sourceSetup.savedSource} className="space-y-4">
                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="scrapeImmediately"
                    checked={scrapeImmediately}
                    onCheckedChange={(checked) => {
                      const isChecked = checked === true;
                      setScrapeImmediately(isChecked);
                      setValue("scrapeImmediately", isChecked);
                      setValue("scrapeConfig", isChecked ? {
                        postsCount: 100,
                        ...(selectedPlatform === "youtube" ? { shortsCount: 50 } : {}),
                      } : undefined);
                    }}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="scrapeImmediately" className="font-medium cursor-pointer">
                      Trigger scrape immediately
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Start collecting posts right after saving this creator
                    </p>
                  </div>
                </div>

                {scrapeImmediately && (
                  <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
                    <h4 className="font-medium">Scrape Settings</h4>

                    <div className="space-y-2">
                      <Label htmlFor="postsCount">Number of posts to scrape *</Label>
                      <Input
                        id="postsCount"
                        type="number"
                        min="1"
                        max="500"
                        placeholder="100"
                        defaultValue="100"
                        {...register("scrapeConfig.postsCount", { valueAsNumber: true })}
                      />
                      <p className="text-xs text-muted-foreground">1-500 posts</p>
                    </div>

                    {selectedPlatform === "youtube" && (
                      <div className="space-y-2">
                        <Label htmlFor="shortsCount">Number of shorts to scrape</Label>
                        <Input
                          id="shortsCount"
                          type="number"
                          min="0"
                          max="500"
                          placeholder="50"
                          defaultValue="50"
                          {...register("scrapeConfig.shortsCount", { valueAsNumber: true })}
                        />
                        <p className="text-xs text-muted-foreground">0-500 shorts</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="daysBack">Days back (optional)</Label>
                      <Input
                        id="daysBack"
                        type="number"
                        min="1"
                        placeholder="30"
                        {...register("scrapeConfig.daysBack", { setValueAs: (value) => value === "" ? undefined : Number(value) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Limit to posts from the last X days
                      </p>
                    </div>

                    {errors.scrapeConfig && (
                      <p role="alert" className="text-sm text-destructive">Use 1–500 posts, 0–500 shorts, and at least 1 day back if specified.</p>
                    )}
                    <div className="text-sm text-muted-foreground bg-accent p-3 rounded">
                      ℹ️ Scraping will start immediately after saving this creator
                    </div>
                  </div>
                )}

              </fieldset>
              {sourceSetup.error && <p role="alert" className="text-sm text-destructive">{sourceSetup.error}</p>}
              <div className="sticky bottom-0 flex flex-wrap justify-between gap-2 bg-background py-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sourceSetup.isPending || !!sourceSetup.savedSource}
                  onClick={() => setStep("info")}
                >
                  ← Back
                </Button>
                <Button
                  type="submit"
                  variant="cta"
                  disabled={sourceSetup.isPending}
                >
                  {sourceSetup.isPending ? "Saving..." : sourceSetup.savedSource ? (schedule.enabled ? "Retry schedule" : "Done") : schedule.enabled ? "Add creator & schedule" : "Add creator"}
                </Button>
              </div>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
