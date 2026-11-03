import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";

interface SearchableSelectOption {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  recommended?: boolean;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  showProvider?: boolean;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  showProvider = false,
}: SearchableSelectProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOptions = options.filter((option) => {
    const query = searchQuery.toLowerCase();
    return (
      option.name.toLowerCase().includes(query) ||
      option.id.toLowerCase().includes(query) ||
      option.description?.toLowerCase().includes(query) ||
      option.provider?.toLowerCase().includes(query)
    );
  });

  const selectedOption = options.find((o) => o.id === value);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="text"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>
      {searchQuery && (
        <p className="text-xs text-muted-foreground">
          Found {filteredOptions.length} model{filteredOptions.length !== 1 ? 's' : ''}
        </p>
      )}
      <div className="relative">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={placeholder}>
              {selectedOption && (
                <span className="truncate block">{selectedOption.name}</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-[400px] w-[var(--radix-select-trigger-width)] z-50 bg-background">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {searchQuery ? `No models matching "${searchQuery}"` : "No models available"}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <SelectItem key={option.id} value={option.id} className="cursor-pointer py-3" textValue={option.name}>
                  <div className="flex flex-col gap-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm break-words">{option.name}</span>
                      {option.recommended && (
                        <Badge className="text-xs bg-green-500/20 text-green-600 border-green-500/30">Recommended</Badge>
                      )}
                      {showProvider && option.provider && (
                        <Badge variant="outline" className="text-xs">{option.provider}</Badge>
                      )}
                    </div>
                    {option.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2 leading-tight">
                        {option.description}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-8 top-1/2 -translate-y-1/2 h-7 w-7 hover:bg-muted"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onValueChange("");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
