import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BlueprintForm } from "./BlueprintForm";
import { useUpdateBlueprint } from "@/hooks/useBlueprints";
import type { Blueprint, CreateBlueprintInput } from "@/types/blueprint";

interface EditBlueprintDialogProps {
  blueprint: Blueprint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBlueprintDialog({ blueprint, open, onOpenChange }: EditBlueprintDialogProps) {
  const updateMutation = useUpdateBlueprint();

  if (!blueprint) return null;

  const handleSubmit = (data: CreateBlueprintInput) => {
    updateMutation.mutate(
      { id: blueprint.id, ...data },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] max-h-[95vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit Blueprint</DialogTitle>
          <DialogDescription>
            Update your content generation blueprint.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[calc(95vh-140px)]">
          <div className="px-8 py-6">
            <BlueprintForm
              defaultValues={{
                name: blueprint.name,
                description: blueprint.description || "",
                pipeline: blueprint.pipeline || "rich_article",
                master_prompt: blueprint.master_prompt || "",
                image_prompt: blueprint.image_prompt || "",
                director_prompt: blueprint.director_prompt || "",
                skip_image_generation: blueprint.skip_image_generation ?? false,
                structure: blueprint.structure,
                model_config: blueprint.model_config,
                tags: blueprint.tags || [],
                reference_image_libraries: blueprint.reference_image_libraries || [],
              }}
              onSubmit={handleSubmit}
              isSubmitting={updateMutation.isPending}
              submitLabel="Update Blueprint"
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
