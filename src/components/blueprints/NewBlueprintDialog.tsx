import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutTemplate, Wand2, PenLine, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BlueprintStarterPackDialog } from "./BlueprintStarterPackDialog";
import { ImportPostDialog } from "@/components/ideas/ImportPostDialog";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";

interface NewBlueprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Three ways to start a blueprint. Each one ends in the Studio. */
export function NewBlueprintDialog({ open, onOpenChange }: NewBlueprintDialogProps) {
  const navigate = useNavigate();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [fromPostOpen, setFromPostOpen] = useState(false);
  const { hasFeature } = useFeatureAccess();
  const canUseTemplates = hasFeature("starter_packs");

  const options = [
    {
      icon: canUseTemplates ? LayoutTemplate : Lock,
      title: "Start from a template",
      body: "Proven formats with the writing already set up. Pick one and adjust it.",
      onClick: () => {
        onOpenChange(false);
        if (canUseTemplates) setTemplatesOpen(true);
        else window.open(UPGRADE_URL, "_blank");
      },
    },
    {
      icon: Wand2,
      title: "Copy a post you like",
      body: "Paste a link or the text. We pull out its hook, shape, length and call to action.",
      onClick: () => {
        onOpenChange(false);
        setFromPostOpen(true);
      },
    },
    {
      icon: PenLine,
      title: "Start blank",
      body: "Pick a format and fill in four short sections while the preview updates.",
      onClick: () => {
        onOpenChange(false);
        navigate("/blueprints/new");
      },
    },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New blueprint</DialogTitle>
            <DialogDescription>A blueprint is a reusable format: it turns any topic into a finished piece.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            {options.map((o) => (
              <button
                key={o.title}
                type="button"
                onClick={o.onClick}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <o.icon className="h-5 w-5 text-primary" />
                <span className="text-sm font-semibold">{o.title}</span>
                <span className="text-xs text-muted-foreground leading-relaxed">{o.body}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <BlueprintStarterPackDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <ImportPostDialog open={fromPostOpen} onOpenChange={setFromPostOpen} mode="blueprint" />
    </>
  );
}
