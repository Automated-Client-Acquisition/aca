import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Globe, Search } from "lucide-react";

interface DomainOption {
  id: string;
  domain: string;
}

interface MailboxDomainFilterPopoverProps {
  selectedDomainIds: string[];
  onSelectedDomainsChange: (ids: string[]) => void;
  domainOptions: DomainOption[];
  domainMailboxCounts?: Map<string, number>;
}

export function MailboxDomainFilterPopover({
  selectedDomainIds,
  onSelectedDomainsChange,
  domainOptions,
  domainMailboxCounts,
}: MailboxDomainFilterPopoverProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return domainOptions;
    const q = search.toLowerCase();
    return domainOptions.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domainOptions, search]);

  const toggleDomain = (id: string) => {
    const updated = selectedDomainIds.includes(id)
      ? selectedDomainIds.filter((d) => d !== id)
      : [...selectedDomainIds, id];
    onSelectedDomainsChange(updated);
  };

  const clearAll = () => onSelectedDomainsChange([]);

  if (domainOptions.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="default" className="gap-2">
          <Globe className="h-4 w-4" />
          Domains
          {selectedDomainIds.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-5 rounded-full px-1.5 text-xs"
            >
              {selectedDomainIds.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px]" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Filter by domain</h4>
            {selectedDomainIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-auto p-1 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>

          {domainOptions.length > 8 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search domains..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          )}

          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                No domains match &ldquo;{search}&rdquo;
              </p>
            ) : (
              filtered.map((d) => (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center space-x-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded"
                  onClick={() => toggleDomain(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleDomain(d.id);
                    }
                  }}
                >
                  <Checkbox
                    checked={selectedDomainIds.includes(d.id)}
                    onCheckedChange={() => toggleDomain(d.id)}
                  />
                  <Label className="flex-1 cursor-pointer text-sm font-normal truncate">
                    {d.domain}
                  </Label>
                  {domainMailboxCounts && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {domainMailboxCounts.get(d.id) || 0}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {search && filtered.length !== domainOptions.length && (
            <p className="text-[11px] text-muted-foreground text-center">
              {filtered.length} of {domainOptions.length} domains
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
