import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";

interface SetCustomFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSubmit: (fieldKey: string, value: string) => void;
  isLoading?: boolean;
}

export function SetCustomFieldDialog({
  open,
  onOpenChange,
  selectedCount,
  onSubmit,
  isLoading,
}: SetCustomFieldDialogProps) {
  const { data: customFieldDefs } = useCustomFieldDefs();
  const [fieldKey, setFieldKey] = useState<string>("");
  const [value, setValue] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setFieldKey("");
      setValue("");
    }
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldKey || !value.trim()) return;
    onSubmit(fieldKey, value.trim());
  };

  const selectedDef = customFieldDefs?.find((f) => f.field_key === fieldKey);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Set Custom Field</DialogTitle>
            <DialogDescription>
              Apply a value to {selectedCount} selected contact{selectedCount === 1 ? "" : "s"}.
              Other custom fields on these contacts are left untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Field</Label>
              <Select value={fieldKey} onValueChange={setFieldKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a custom field..." />
                </SelectTrigger>
                <SelectContent>
                  {(customFieldDefs || []).map((f) => (
                    <SelectItem key={f.field_key} value={f.field_key}>
                      {f.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-field-value">Value</Label>
              <Input
                id="custom-field-value"
                type={selectedDef?.field_type === "number" ? "number" : selectedDef?.field_type === "date" ? "date" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter a value..."
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="cta" type="submit" disabled={!fieldKey || !value.trim() || isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply to {selectedCount} Contact{selectedCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
