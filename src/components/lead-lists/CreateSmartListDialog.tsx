import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Wand2, RefreshCw, ListChecks } from "lucide-react";
import { SmartListFilterBuilder } from "@/components/lead-lists/SmartListFilterBuilder";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import { validateSmartSegmentCriteria } from "@/lib/smart-segment-rules";

interface CreateSmartListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    description?: string;
    filter_criteria: SmartListFilterCriteria;
  }) => void;
  isLoading?: boolean;
  attachTo?: "campaign" | "email sequence";
  // Optional: pre-fill criteria (for "save as smart list" from filtered view)
  initialCriteria?: SmartListFilterCriteria;
}

export function CreateSmartListDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading = false,
  attachTo,
  initialCriteria,
}: CreateSmartListDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<SmartListFilterCriteria>(
    initialCriteria || { rule_group: { id: crypto.randomUUID(), operator: "and", rules: [] } }
  );
  const initialCriteriaKey = JSON.stringify(initialCriteria || null);
  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setCriteria(JSON.parse(initialCriteriaKey) || { rule_group: { id: crypto.randomUUID(), operator: "and", rules: [] } });
  }, [open, initialCriteriaKey]);
  const validation = validateSmartSegmentCriteria(criteria);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || validation.length) return;

    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      filter_criteria: criteria,
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-2rem)] max-w-[1040px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            Create Smart Segment
          </DialogTitle>
          <DialogDescription className="max-w-2xl">
            Save an audience you can use in campaigns and email sequences. People enter or leave as they match your rules.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="space-y-6 border-b bg-muted/20 p-6 lg:border-b-0 lg:border-r">
                <div className="space-y-2">
                  <Label htmlFor="segment-name">Segment name <span className="text-destructive">*</span></Label>
                  <Input id="segment-name" placeholder="e.g., Qualified SaaS founders" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  <p className="text-xs text-muted-foreground">Use a name teammates can recognize later.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="segment-description">Description (optional)</Label>
                  <Textarea id="segment-description" placeholder="What is this audience for?" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
                <div className="hidden space-y-3 rounded-xl border bg-background p-4 lg:block">
                  <div className="flex gap-3"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-sm font-medium">Always current</p><p className="text-xs text-muted-foreground">People enter or leave as their data changes.</p></div></div>
                  <div className="flex gap-3"><ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-sm font-medium">{attachTo ? "Save and attach" : "Connect outreach next"}</p><p className="text-xs text-muted-foreground">{attachTo ? `Saving adds this segment to the current ${attachTo}. Its enrollment mode and eligibility rules still apply.` : "After saving, connect a campaign or email sequence from the segment."}</p></div></div>
                </div>
              </aside>

              <section className="min-w-0 space-y-4 p-6">
                <div>
                  <Label className="flex items-center gap-2 text-base"><Wand2 className="h-4 w-4 text-primary" />Audience rules</Label>
                  <p className="mt-1 text-sm text-muted-foreground">Start with a common audience, or add the fields that matter to you.</p>
                </div>
                <SmartListFilterBuilder criteria={criteria} onChange={setCriteria} showPreviewCount={true} active={open} />
              </section>
            </div>
          </div>

          <DialogFooter className="items-center border-t bg-background px-6 py-4">
            <p className="mr-auto text-left text-xs text-muted-foreground">{validation.length ? 'Finish the audience rules to save.' : attachTo ? `Ready to save and attach to this ${attachTo}.` : 'Your segment is ready to save.'}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="cta"
              disabled={isLoading || !name.trim() || validation.length > 0}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Smart Segment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
