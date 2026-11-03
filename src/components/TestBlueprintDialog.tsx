import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Blueprint, BlueprintSlot } from "@/types/blueprint";
import { useLibraryElementsForTesting } from "@/hooks/useLibraryElementsForTesting";

interface TestBlueprintDialogProps {
  blueprint: Blueprint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestBlueprintDialog({ blueprint, open, onOpenChange }: TestBlueprintDialogProps) {
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [context, setContext] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [stageResults, setStageResults] = useState<Record<string, any>>({});

  const handleTest = async () => {
    setIsLoading(true);
    setResult(null);
    setStageResults({});
    setCurrentStage('Initializing...');

    try {
      const { data, error } = await supabase.functions.invoke('test-blueprint', {
        body: {
          blueprintId: blueprint.id,
          slotValues,
          context: context.trim() || undefined,
        },
      });

      if (error) throw error;

      // Handle multi-stage response
      if (data.stages) {
        setStageResults(data.stages);
        setCurrentStage('All stages completed');
        toast.success(`Test completed: ${Object.keys(data.stages).length} stages executed`);
      } else {
        setResult(data.result);
        setCurrentStage(null);
        toast.success("Test completed successfully");
      }
    } catch (error) {
      setCurrentStage(null);
      toast.error(error instanceof Error ? error.message : "Failed to test blueprint");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-w-2xl h-[90vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Test Blueprint: {blueprint.name}</DialogTitle>
          <DialogDescription>
            Fill in test values for the detected variables and run a dry test.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-8 py-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="context">
                Additional Context (optional)
              </Label>
              <Textarea
                id="context"
                placeholder="Enter any additional context or instructions for this test..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={4}
                className="resize-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {blueprint.structure.slots.length > 0 && (
              <div className="pt-2 border-t">
                <Label className="text-sm text-muted-foreground mb-4 block">
                  Library Elements
                </Label>
              </div>
            )}

            {blueprint.structure.slots.map((slot) => (
              <SlotInput
                key={slot.key}
                slot={slot}
                value={slotValues[slot.key] || ''}
                onChange={(value) => setSlotValues({ ...slotValues, [slot.key]: value })}
              />
            ))}

            <Button
              onClick={handleTest}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run Test
            </Button>

            {isLoading && currentStage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{currentStage}</span>
              </div>
            )}

            {Object.keys(stageResults).length > 0 && (
              <div className="space-y-4">
                <Label>Stage Results</Label>
                {Object.entries(stageResults).map(([stageName, stageData]: [string, any]) => (
                  <div key={stageName} className="space-y-2">
                    <Label className="text-sm font-medium">{stageName}</Label>
                    <Textarea
                      value={typeof stageData === 'string' ? stageData : JSON.stringify(stageData, null, 2)}
                      readOnly
                      className="min-h-[120px] font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                ))}
              </div>
            )}

            {result && (
              <div className="space-y-2">
                <Label>Result</Label>
                <Textarea
                  value={result}
                  readOnly
                  className="min-h-[200px] font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function SlotInput({ 
  slot, 
  value, 
  onChange 
}: { 
  slot: BlueprintSlot; 
  value: string; 
  onChange: (value: string) => void;
}) {
  // Extract field name from slot key (e.g., "library_brand_voices.tone" -> "tone")
  const fieldName = slot.key.includes('.') ? slot.key.split('.').pop() : undefined;
  
  const { data: elements, isLoading } = useLibraryElementsForTesting(
    slot.type === 'library_element' ? slot.library_table : undefined,
    fieldName
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={slot.key}>
        {slot.label || slot.key}
      </Label>
      {slot.type === 'library_element' && slot.library_table && fieldName ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={slot.key} className="bg-background focus-visible:ring-2 focus-visible:ring-ring">
            <SelectValue placeholder={`Select ${slot.label || slot.key} (optional)`} />
          </SelectTrigger>
          <SelectContent className="bg-background z-50 max-h-[300px]">
            {isLoading ? (
              <SelectItem value="loading" disabled>Loading...</SelectItem>
            ) : elements && elements.length > 0 ? (
              elements.map((element: any) => (
                <SelectItem key={element.id} value={element.id}>
                  {element.name} {element[fieldName] && `(${String(element[fieldName]).substring(0, 30)}...)`}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="none" disabled>No items available</SelectItem>
            )}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={slot.key}
          placeholder={`Enter ${slot.label || slot.key} (optional)`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
    </div>
  );
}
