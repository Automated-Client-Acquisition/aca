import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PIPELINES } from "@/types/pipeline";
import { useReverseEngineerBlueprint } from "@/hooks/useContentTeardown";

// Pipelines reverse-engineer-blueprint knows how to target
const TARGET_PIPELINES = ["video", "social_media_post", "instagram_carousel", "instagram_carousel_ai", "twitter_thread", "rich_article"];
const AUTO = "auto";

interface ReverseEngineerBlueprintDialogProps {
  contentIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReverseEngineerBlueprintDialog({ contentIds, open, onOpenChange }: ReverseEngineerBlueprintDialogProps) {
  const navigate = useNavigate();
  const reverseEngineer = useReverseEngineerBlueprint();
  const [pipeline, setPipeline] = useState(AUTO);
  const [name, setName] = useState("");

  const tooMany = contentIds.length > 5;
  const pipelines = PIPELINES.filter((p) => TARGET_PIPELINES.includes(p.id));

  const handleCreate = () => {
    reverseEngineer.mutate(
      { contentIds, pipeline: pipeline === AUTO ? undefined : pipeline, name },
      {
        onSuccess: ({ blueprint_id, name: createdName }) => {
          toast.success(`Blueprint "${createdName}" created. Review it before using it.`);
          onOpenChange(false);
          setName("");
          navigate(`/blueprints/${blueprint_id}`);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !reverseEngineer.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-primary" />
            Reverse-engineer into a blueprint
          </DialogTitle>
          <DialogDescription>
            {contentIds.length > 1
              ? `Extracts the formula these ${contentIds.length} posts share: hook, structure, pacing, voice and CTA.`
              : "Extracts this post's formula: hook, structure, pacing, voice and CTA."}{" "}
            Specifics become variables like {"{{topic}}"}, {"{{ai_hook}}"} and {"{{brand.tone}}"}, so you can reuse it with your own ideas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Output format</Label>
            <Select value={pipeline} onValueChange={setPipeline} disabled={reverseEngineer.isPending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Auto (match the source format)</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              You can turn a video into a carousel or a thread. The formula carries over and the format adapts.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="re-blueprint-name">Name (optional)</Label>
            <Input
              id="re-blueprint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Generated from the formula if left blank"
              disabled={reverseEngineer.isPending}
            />
          </div>
          {tooMany && <p className="text-sm text-destructive">Select up to 5 posts.</p>}
          {reverseEngineer.isPending && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing and writing the blueprint. This takes 1-2 minutes.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reverseEngineer.isPending}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleCreate} disabled={reverseEngineer.isPending || tooMany || contentIds.length === 0}>
            {reverseEngineer.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
            Create blueprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
