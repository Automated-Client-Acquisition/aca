import { useState } from "react";
import { Plus, Users, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LeadList } from "@/hooks/useLeadLists";

interface ListSelectorProps {
  lists: LeadList[];
  selectedListId: string | null;
  newListName: string;
  onSelectList: (listId: string | null) => void;
  onNewListNameChange: (name: string) => void;
}

export function ListSelector({
  lists,
  selectedListId,
  newListName,
  onSelectList,
  onNewListNameChange,
}: ListSelectorProps) {
  const [mode, setMode] = useState<"existing" | "new">(
    lists.length === 0 ? "new" : "existing"
  );

  const handleModeChange = (newMode: "existing" | "new") => {
    setMode(newMode);
    if (newMode === "new") {
      onSelectList(null);
    } else if (lists.length > 0) {
      onSelectList(lists[0].id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Select Target List</h3>
        <p className="text-sm text-muted-foreground">
          Choose an existing list or create a new one for your imported contacts
        </p>
      </div>

      <RadioGroup
        value={mode}
        onValueChange={(value) => handleModeChange(value as "existing" | "new")}
        className="space-y-4"
      >
        {/* Create New List */}
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <RadioGroupItem value="new" id="new" />
            <Label htmlFor="new" className="font-medium cursor-pointer">
              Create a new list
            </Label>
          </div>
          {mode === "new" && (
            <div className="ml-6 space-y-2">
              <Label htmlFor="list-name">List Name</Label>
              <Input
                id="list-name"
                placeholder="e.g., Q1 2026 Prospects"
                value={newListName}
                onChange={(e) => onNewListNameChange(e.target.value)}
                className="max-w-sm"
              />
            </div>
          )}
        </div>

        {/* Existing Lists */}
        {lists.length > 0 && (
          <div>
            <div className="flex items-center space-x-2 mb-3">
              <RadioGroupItem value="existing" id="existing" />
              <Label htmlFor="existing" className="font-medium cursor-pointer">
                Add to existing list
              </Label>
            </div>
            {mode === "existing" && (
              <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-auto p-1 -m-1">
                {lists.map((list) => (
                  <Card
                    key={list.id}
                    className={cn(
                      "cursor-pointer transition-all hover:border-primary/50",
                      selectedListId === list.id && "border-primary ring-1 ring-primary"
                    )}
                    onClick={() => onSelectList(list.id)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{list.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {list.lead_count} contacts
                          </div>
                        </div>
                        {selectedListId === list.id && (
                          <Check className="h-5 w-5 text-primary shrink-0" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </RadioGroup>
    </div>
  );
}
