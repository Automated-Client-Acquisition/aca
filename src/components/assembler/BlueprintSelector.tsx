import { useState } from "react";
import { Blueprint } from "@/types/blueprint";
import { useBlueprints } from "@/hooks/useBlueprints";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileText, Loader2, Package, ChevronDown } from "lucide-react";
import { PIPELINES } from "@/types/pipeline";

const formatSlotLabel = (text: string): string => {
  return text
    .split(/[.›>]/)
    .map(part => part.trim())
    .map(part => {
      // Convert camelCase or PascalCase to Title Case
      return part
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .split(/[\s_]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    })
    .join(' › ');
};

interface BlueprintSelectorProps {
  value: Blueprint | null;
  onChange: (blueprint: Blueprint | null) => void;
}

export function BlueprintSelector({ value, onChange }: BlueprintSelectorProps) {
  const { data: blueprints, isLoading } = useBlueprints();
  const [requirementsOpen, setRequirementsOpen] = useState(false);

  const handleValueChange = (blueprintId: string) => {
    const selected = blueprints?.find(b => b.id === blueprintId);
    onChange(selected || null);
  };

  return (
    <div className="space-y-4">
      <Select value={value?.id || ""} onValueChange={handleValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a blueprint..." />
        </SelectTrigger>
        <SelectContent className="z-50 max-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : blueprints && blueprints.length > 0 ? (
            blueprints.map((blueprint) => (
              <SelectItem key={blueprint.id} value={blueprint.id} textValue={blueprint.name}>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>{blueprint.name}</span>
                </div>
              </SelectItem>
            ))
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No blueprints found. Create one first.
            </div>
          )}
        </SelectContent>
      </Select>

      {value && (
        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h3 className="font-medium">{value.name}</h3>
              {value.description && (
                <p className="text-sm text-muted-foreground mt-1">{value.description}</p>
              )}
            </div>
          </div>
          
          {value.pipeline && (() => {
            const pipeline = PIPELINES.find(p => p.id === value.pipeline);
            const PipelineIcon = pipeline?.icon || FileText;
            return (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <PipelineIcon className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{pipeline?.name || value.pipeline}</p>
                  {pipeline?.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{pipeline.description}</p>
                  )}
                </div>
              </div>
            );
          })()}

          {value.structure?.slots && value.structure.slots.length > 0 && (
            <Collapsible open={requirementsOpen} onOpenChange={setRequirementsOpen} className="pt-3 border-t border-border">
              <CollapsibleTrigger className="flex items-center gap-2 w-full hover:opacity-70 transition-opacity">
                <Package className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  What You'll Need ({value.structure.slots.filter(s => s.required).length})
                </p>
                <ChevronDown className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${requirementsOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {value.structure.slots.filter(s => s.required).map(slot => (
                    <Badge key={slot.key} variant="outline" className="text-xs">
                      {formatSlotLabel(slot.label || slot.key)}
                    </Badge>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </Card>
      )}
    </div>
  );
}
