import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Lightbulb,
  Check,
  Loader2,
  Gift
} from "lucide-react";
import {
  starterIdeas,
  getStarterPackCounts,
  type StarterIdea,
} from "@/data/starterPack";
import { useStarterPackImport } from "@/hooks/useStarterPackImport";
import { cn } from "@/lib/utils";

interface IdeasStarterPackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IdeasStarterPackDialog({ open, onOpenChange }: IdeasStarterPackDialogProps) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const { importItems, isImporting } = useStarterPackImport();
  const counts = getStarterPackCounts();

  const totalSelected = selection.size;
  const allSelected = totalSelected === counts.ideas;

  const toggleItem = (id: string) => {
    setSelection((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelection(new Set(starterIdeas.map((i) => i.id)));
  };

  const deselectAll = () => {
    setSelection(new Set());
  };

  const handleImport = async () => {
    await importItems({
      brandVoices: [],
      characters: [],
      icps: [],
      products: [],
      blocks: [],
      ideas: starterIdeas.filter((i) => selection.has(i.id)),
    });
    onOpenChange(false);
    setSelection(new Set());
  };

  // Group ideas by category
  const ideasByCategory = useMemo(() => {
    const grouped: Record<string, StarterIdea[]> = {};
    starterIdeas.forEach((idea) => {
      if (!grouped[idea.category]) {
        grouped[idea.category] = [];
      }
      grouped[idea.category].push(idea);
    });
    return grouped;
  }, []);

  const categoryStyles: Record<string, string> = {
    "Authority Building": "bg-primary/10 text-primary border-primary/30",
    "Social Proof": "bg-green-500/10 text-green-600 border-green-500/30",
    "Product Launch": "bg-blue-500/10 text-blue-600 border-blue-500/30",
    "Objection Handling": "bg-cta/10 text-cta border-cta/30",
    "Education": "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
    "Engagement": "bg-pink-500/10 text-pink-600 border-pink-500/30",
    "Storytelling": "bg-primary/10 text-primary border-primary/30",
    "Urgency": "bg-red-500/10 text-red-600 border-red-500/30",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[85vh] overflow-hidden p-0">
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-yellow-500/10 via-orange-500/5 to-transparent">
          <div className="absolute top-4 right-8">
            <Badge className="bg-yellow-500 text-white border-0 gap-1">
              <Gift className="w-3 h-3" />
              {counts.ideas} Templates
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center shadow-lg">
              <Lightbulb className="w-6 h-6 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Content Ideas Starter Pack</DialogTitle>
              <DialogDescription className="mt-0.5">
                Import proven content templates to kickstart your content strategy
              </DialogDescription>
            </div>
          </div>
          <div className="mt-4 p-2.5 rounded-lg bg-yellow-500/20 border border-yellow-500/30">
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              <Sparkles className="w-3.5 h-3.5 inline mr-1.5" />
              Imported ideas will trigger AI generation to create hooks, CTAs, and content frameworks
            </p>
          </div>
        </div>

        {/* Selection controls */}
        <div className="shrink-0 px-6 py-3 border-b flex items-center justify-between bg-muted/30">
          <span className="text-sm font-medium">
            {totalSelected} of {counts.ideas} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={allSelected ? deselectAll : selectAll}
          >
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
        </div>

        {/* Ideas list grouped by category */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="p-4 space-y-6">
            {Object.entries(ideasByCategory).map(([category, ideas]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge
                    variant="outline"
                    className={cn("text-xs font-medium", categoryStyles[category])}
                  >
                    {category}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {ideas.filter(i => selection.has(i.id)).length} / {ideas.length} selected
                  </span>
                </div>
                <div className="space-y-2">
                  {ideas.map((idea) => (
                    <div
                      key={idea.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                        selection.has(idea.id)
                          ? "border-yellow-500 bg-yellow-500/5"
                          : "border-border hover:border-yellow-500/30 hover:bg-muted/50"
                      )}
                      onClick={() => toggleItem(idea.id)}
                    >
                      <Checkbox
                        checked={selection.has(idea.id)}
                        className="mt-0.5"
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => toggleItem(idea.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground leading-relaxed">
                          {idea.title}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {idea.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      {selection.has(idea.id) && (
                        <div className="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {totalSelected > 0 ? `${totalSelected} ideas selected` : "Select ideas to import"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={totalSelected === 0 || isImporting}
              className="bg-gradient-cta text-cta-foreground hover:opacity-90 min-w-[140px]"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Import ({totalSelected})
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
