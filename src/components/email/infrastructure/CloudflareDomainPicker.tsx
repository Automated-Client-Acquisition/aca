import { useState, useMemo, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Cloud,
  ChevronDown,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CloudflareZone } from "@/types/email";

interface CloudflareDomainPickerProps {
  /** All domains in the user's Cloudflare account. */
  domains: CloudflareZone[];
  /** Loading state for the domains query. */
  isLoading: boolean;
  /** Lowercased domain names already in use as ACA sending domains — filtered out. */
  excludeDomains: string[];
  /** Currently selected domain name (or null when none picked). */
  value: string | null;
  /** Called when the user picks a domain or clears the selection. */
  onChange: (domain: string | null) => void;
}

/**
 * Domain picker for the "Add Sending Domain" wizard. Shows the user's
 * Cloudflare domains, filters out ones already used as ACA sending domains,
 * and highlights pending domains (NS not yet propagated). Built on shadcn's
 * Popover + Command pattern so it scales to large lists with search-as-you-type.
 */
export function CloudflareDomainPicker({
  domains,
  isLoading,
  excludeDomains,
  value,
  onChange,
}: CloudflareDomainPickerProps) {
  const [open, setOpen] = useState(false);

  // Filter out domains that are already ACA sending domains — nothing for the
  // user to do with those here. (To migrate one, they use the cloud icon on
  // the domain card.) Pending domains stay in the list with a warning label.
  const excludeSet = useMemo(
    () => new Set(excludeDomains.map((d) => d.toLowerCase())),
    [excludeDomains],
  );
  const available = useMemo(
    () => domains.filter((d) => !excludeSet.has(d.name.toLowerCase())),
    [domains, excludeSet],
  );

  // Auto-select the first active available domain when nothing is selected.
  // Saves the user a click in the common single-domain case.
  useEffect(() => {
    if (value || available.length === 0) return;
    const firstActive = available.find((d) => d.status === "active") ?? available[0];
    if (firstActive) onChange(firstActive.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.length, value]);

  const selectedDomain = available.find((d) => d.name === value);

  // ─────────────────────────────────────────────────────────────────────────
  // Empty states
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-muted/20 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your Cloudflare domains...
      </div>
    );
  }

  if (domains.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
        <div className="font-medium">No domains in your Cloudflare account yet</div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Add a domain to Cloudflare first, then come back here to use it as a sending domain.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("https://dash.cloudflare.com/?to=/:account/add-site", "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          Open Cloudflare → Add a Site
        </Button>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
        <div className="font-medium">
          All {domains.length} of your Cloudflare domains are already sending domains in ACA
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Want to add another? Add a new domain to Cloudflare first, then come back.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("https://dash.cloudflare.com/?to=/:account/add-site", "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          Add another domain to Cloudflare
        </Button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main picker — combobox + confirmation callout
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              <Cloud className="w-4 h-4 text-amber-500 flex-shrink-0" />
              {selectedDomain ? (
                <>
                  <span className="font-mono truncate">{selectedDomain.name}</span>
                  {selectedDomain.status !== "active" && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 flex-shrink-0">
                      {selectedDomain.status}
                    </Badge>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Pick a domain...</span>
              )}
            </span>
            <ChevronDown className="w-4 h-4 opacity-50 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search domains..." />
            <CommandList>
              <CommandEmpty>No domain matches.</CommandEmpty>
              <CommandGroup>
                {available.map((d) => (
                  <CommandItem
                    key={d.zone_id}
                    value={d.name}
                    onSelect={(picked) => {
                      onChange(picked);
                      setOpen(false);
                    }}
                  >
                    <Cloud className="w-3.5 h-3.5 text-amber-500 mr-2 flex-shrink-0" />
                    <span className="font-mono flex-1 truncate">{d.name}</span>
                    {d.status === "active" ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground ml-2">
                        active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 ml-2"
                        title="Nameservers still propagating — DNS verification may take longer"
                      >
                        {d.status}
                      </Badge>
                    )}
                    {value === d.name && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-2 flex-shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedDomain && (
        <Alert
          className={cn(
            "py-2",
            selectedDomain.status === "active"
              ? "border-green-500/40 bg-green-500/5"
              : "border-amber-500/40 bg-amber-500/5",
          )}
        >
          {selectedDomain.status === "active" ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <Loader2 className="w-4 h-4 text-amber-500" />
          )}
          <AlertDescription className="text-xs leading-relaxed">
            {selectedDomain.status === "active" ? (
              <>
                <span className="font-semibold text-green-700 dark:text-green-300">
                  ACA will write DNS records to {selectedDomain.name} automatically.
                </span>
                <span className="block text-muted-foreground">
                  No copy-paste needed. We'll detect and clean up any duplicate SPF / DMARC / MX
                  records before publishing.
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {selectedDomain.name} is still pending in Cloudflare.
                </span>
                <span className="block text-muted-foreground">
                  Nameservers haven't propagated yet. We can still write records, but DNS
                  verification may take longer than usual.
                </span>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
