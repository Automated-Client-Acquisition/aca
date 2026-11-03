import { ManualIdeaRow } from "@/types/generation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

interface ManualIdeaGridProps {
  rows: ManualIdeaRow[];
  onChange: (rows: ManualIdeaRow[]) => void;
}

export function ManualIdeaGrid({ rows, onChange }: ManualIdeaGridProps) {
  const addRow = () => {
    const newRow: ManualIdeaRow = {
      id: nanoid(),
      context: '',
    };
    
    onChange([...rows, newRow]);
  };

  const removeRow = (rowId: string) => {
    onChange(rows.filter(r => r.id !== rowId));
  };

  const updateContext = (rowId: string, value: string) => {
    onChange(rows.map(row => 
      row.id === rowId ? { ...row, context: value } : row
    ));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button onClick={addRow} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Idea
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <p className="text-muted-foreground mb-4">No ideas yet</p>
          <Button onClick={addRow} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add First Idea
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <Card key={row.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-medium flex-shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <Textarea
                    value={row.context || ''}
                    onChange={(e) => updateContext(row.id, e.target.value)}
                    placeholder="Describe your idea or provide context for content generation..."
                    className="min-h-[100px] resize-none"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(row.id)}
                  className="h-8 w-8 p-0 flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {rows.length} idea{rows.length !== 1 ? 's' : ''} added
        </div>
      )}
    </div>
  );
}
