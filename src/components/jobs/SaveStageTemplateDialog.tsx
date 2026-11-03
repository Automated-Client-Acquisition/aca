import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Save } from "lucide-react";
import { useSaveStageTemplate } from "@/hooks/useSaveStageTemplate";

interface SaveStageTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputId: string;
  stageId: string;
  stageName: string;
}

export function SaveStageTemplateDialog({
  open,
  onOpenChange,
  outputId,
  stageId,
  stageName,
}: SaveStageTemplateDialogProps) {
  const [templateName, setTemplateName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const saveTemplate = useSaveStageTemplate();

  const handleSave = () => {
    if (!templateName.trim()) return;

    saveTemplate.mutate(
      {
        outputId,
        stageId,
        templateName,
        templateDescription: description || undefined,
        isPublic,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setTemplateName("");
          setDescription("");
          setIsPublic(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Save Stage Template
          </DialogTitle>
          <DialogDescription>
            Save {stageName} configuration for reuse
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Template Name *</Label>
            <Input
              id="template-name"
              placeholder="e.g., High Quality Script, Fast Generation"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Description</Label>
            <Textarea
              id="template-description"
              placeholder="Describe when to use this template..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="is-public">Share with Organization</Label>
              <div className="text-sm text-muted-foreground">
                Make this template available to team members
              </div>
            </div>
            <Switch
              id="is-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveTemplate.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleSave}
            disabled={!templateName.trim() || saveTemplate.isPending}
          >
            {saveTemplate.isPending ? "Saving..." : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
