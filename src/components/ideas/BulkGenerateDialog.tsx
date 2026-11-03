import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBlueprints } from "@/hooks/useBlueprints";
import { Blueprint } from "@/types/blueprint";
import { PIPELINES } from "@/types/pipeline";
import { Search, FileText, Loader2, Sparkles, Check } from "lucide-react";

interface BulkGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
}

export function BulkGenerateDialog({ open, onOpenChange, selectedIds }: BulkGenerateDialogProps) {
  const navigate = useNavigate();
  const { data: blueprints, isLoading } = useBlueprints();
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBlueprints = useMemo(() => {
    if (!blueprints) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) return blueprints;
    return blueprints.filter(
      (b) =>
        b.name.toLowerCase().includes(query) ||
        b.description?.toLowerCase().includes(query) ||
        b.pipeline?.toLowerCase().includes(query)
    );
  }, [blueprints, searchQuery]);

  const handleContinue = () => {
    if (!selectedBlueprint) return;
    const ideaParams = selectedIds.join(",");
    navigate(`/create?blueprint=${selectedBlueprint.id}&ideas=${ideaParams}`);
    onOpenChange(false);
  };

  const handleClose = () => {
    setSelectedBlueprint(null);
    setSearchQuery("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate Content for {selectedIds.length} Idea{selectedIds.length !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search blueprints..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <ScrollArea className="h-[300px] pr-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredBlueprints.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "No blueprints match your search" : "No blueprints found. Create one first."}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredBlueprints.map((blueprint) => {
                  const isSelected = selectedBlueprint?.id === blueprint.id;
                  const pipeline = PIPELINES.find((p) => p.id === blueprint.pipeline);
                  const PipelineIcon = pipeline?.icon || FileText;

                  return (
                    <Card
                      key={blueprint.id}
                      className={`p-4 cursor-pointer transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "hover:bg-accent/50"
                      }`}
                      onClick={() => setSelectedBlueprint(blueprint)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                          {isSelected ? (
                            <Check className="h-5 w-5" />
                          ) : (
                            <PipelineIcon className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{blueprint.name}</span>
                            {pipeline && (
                              <Badge variant="secondary" className="text-xs shrink-0">
                                {pipeline.name}
                              </Badge>
                            )}
                          </div>
                          {blueprint.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {blueprint.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleContinue} disabled={!selectedBlueprint}>
            <Sparkles className="h-4 w-4 mr-2" />
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
