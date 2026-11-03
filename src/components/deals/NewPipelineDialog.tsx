import { useEffect, useState } from "react";
import { Copy, Loader2, Sparkles, Square } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type DealPipeline, type PipelineTemplate, useCreateDealPipeline } from "@/hooks/crm/useDeals";
import { cn } from "@/lib/utils";

export function NewPipelineDialog({
  open,
  onOpenChange,
  copySource,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pipeline offered as "copy". */
  copySource?: DealPipeline;
  onCreated: (id: string, template: PipelineTemplate) => void;
}) {
  const createPipeline = useCreateDealPipeline();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<PipelineTemplate>("sales");

  useEffect(() => {
    if (open) {
      setName("");
      setTemplate("sales");
    }
  }, [open]);

  const options: Array<{ key: PipelineTemplate; icon: typeof Sparkles; title: string; body: string; hidden?: boolean }> = [
    {
      key: "sales",
      icon: Sparkles,
      title: "Sales process",
      body: "Lead, Qualified, Meeting booked, Proposal sent, Negotiation, with win % already set.",
    },
    {
      key: "copy",
      icon: Copy,
      title: copySource ? `Copy "${copySource.name}"` : "Copy a pipeline",
      body: "Same stages, colors and win %. No deals are copied.",
      hidden: !copySource,
    },
    {
      key: "blank",
      icon: Square,
      title: "Start blank",
      body: "Just New, Won and Lost. Add your own stages next.",
    },
  ];

  const create = async () => {
    if (!name.trim()) return;
    const id = await createPipeline.mutateAsync({ name: name.trim(), template, copyFrom: copySource?.id });
    onOpenChange(false);
    onCreated(id, template);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New pipeline</DialogTitle>
          <DialogDescription>
            Use separate pipelines for processes that move differently, like new business, renewals or partnerships.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-1.5">
            <Label htmlFor="pipeline-name">Name</Label>
            <Input
              id="pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Renewals"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>

          <div className="grid gap-2" role="radiogroup" aria-label="Start from">
            <Label>Start from</Label>
            {options
              .filter((o) => !o.hidden)
              .map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={template === o.key}
                  onClick={() => setTemplate(o.key)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    template === o.key ? "border-foreground/40 bg-muted/60 ring-1 ring-foreground/10" : "hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      template === o.key ? "border-foreground" : "border-muted-foreground/40",
                    )}
                  >
                    {template === o.key && <span className="h-2 w-2 rounded-full bg-foreground" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <o.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {o.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{o.body}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={create} disabled={!name.trim() || createPipeline.isPending}>
            {createPipeline.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
