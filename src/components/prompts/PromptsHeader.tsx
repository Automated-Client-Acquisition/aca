import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";

interface PromptsHeaderProps {
  onAddClick: () => void;
}

export function PromptsHeader({ onAddClick }: PromptsHeaderProps) {
  return (
    <PageHeader
      className="mb-8"
      icon={FileText}
      title="Prompt Library"
      description="Create and manage reusable prompt templates for text and image generation"
      actions={
        <Button variant="cta" className="shadow-lg" onClick={onAddClick}>
          <Plus className="w-4 h-4 mr-2" />
          New Prompt
        </Button>
      }
    />
  );
}
