import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

interface EditableListProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
}

export function EditableList({ items, onChange, placeholder = "Add item...", multiline = false }: EditableListProps) {
  const [newItem, setNewItem] = useState("");

  const handleAdd = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  const handleBlur = () => {
    // Auto-add pending text when user clicks outside
    if (newItem.trim()) {
      handleAdd();
    }
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, value: string) => {
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !multiline) {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-start gap-2">
          {multiline ? (
            <Textarea
              value={item}
              onChange={(e) => handleUpdate(idx, e.target.value)}
              className="flex-1 text-sm min-h-[100px]"
              rows={4}
              placeholder={placeholder}
            />
          ) : (
            <Textarea
              value={item}
              onChange={(e) => handleUpdate(idx, e.target.value)}
              className="flex-1 resize-none text-sm"
              rows={1}
              placeholder={placeholder}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => handleRemove(idx)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      
      <div className="flex items-start gap-2">
        {multiline ? (
          <Textarea
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="flex-1 text-sm min-h-[100px]"
            rows={2}
            placeholder={placeholder}
          />
        ) : (
          <Textarea
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="flex-1 resize-none text-sm"
            rows={1}
            placeholder={placeholder}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setNewItem("")}
          disabled={!newItem.trim()}
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleAdd}
          disabled={!newItem.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
