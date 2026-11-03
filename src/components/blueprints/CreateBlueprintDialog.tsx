import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus } from "lucide-react";
import { BlueprintForm } from "./BlueprintForm";
import { useCreateBlueprint } from "@/hooks/useBlueprints";
import type { CreateBlueprintInput } from "@/types/blueprint";

export function CreateBlueprintDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateBlueprint();

  const handleSubmit = (data: CreateBlueprintInput) => {
    createMutation.mutate(data, {
      onSuccess: () => {
        setOpen(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="cta">
          <Plus className="mr-2 h-4 w-4" />
          New Blueprint
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] w-[1400px] max-h-[95vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create Blueprint</DialogTitle>
          <DialogDescription>
            Define how your content should be generated using AI models.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[calc(95vh-140px)]">
          <div className="px-8 py-6">
            <BlueprintForm
              onSubmit={handleSubmit}
              isSubmitting={createMutation.isPending}
              submitLabel="Create Blueprint"
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
