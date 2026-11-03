import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Building2, User, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useContacts } from "@/hooks/crm/useContacts";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";

export interface PickedContact {
  id: string;
  display_name: string;
  company?: string | null;
  primary_email?: string | null;
  company_id?: string | null;
}

export interface PickedCompany {
  id: string;
  name: string;
  domain?: string | null;
}

// Searches server-side (useContacts' search path): orgs have millions of
// contacts, so filtering a client-side page would never find most of them.
export function ContactPicker({
  value,
  onChange,
}: {
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), 250);
  const { data, isFetching } = useContacts(
    { search: term || undefined, pageSize: 25 },
    { enabled: open },
  );
  const contacts = data?.data ?? [];

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="flex items-center gap-2 truncate">
              <User className="h-4 w-4 shrink-0 text-muted-foreground" />
              {value ? value.display_name : <span className="text-muted-foreground">Link a contact</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search name or email..." value={search} onValueChange={setSearch} />
            <CommandList>
              {isFetching && contacts.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <CommandEmpty>No contacts found.</CommandEmpty>
              )}
              <CommandGroup>
                {contacts.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onChange({
                        id: c.id,
                        display_name: c.display_name,
                        company: c.company,
                        primary_email: c.primary_email,
                        company_id: (c as { company_id?: string | null }).company_id ?? null,
                      });
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0">
                      <div className="truncate">{c.display_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[c.company, c.primary_email].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => onChange(null)} aria-label="Unlink contact">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function CompanyPicker({
  value,
  onChange,
}: {
  value: PickedCompany | null;
  onChange: (company: PickedCompany | null) => void;
}) {
  const { currentOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), 250);

  const { data: companies = [], isFetching } = useQuery({
    queryKey: ["crm_companies", "picker", currentOrganization?.id, term],
    queryFn: async (): Promise<PickedCompany[]> => {
      let q = supabase
        .from("crm_companies")
        .select("id, name, domain")
        .eq("organization_id", currentOrganization!.id)
        .order("last_signal_at", { ascending: false, nullsFirst: false })
        .limit(25);
      if (term) {
        const like = `%${term.replace(/[%_,()]/g, "")}%`;
        q = q.or(`name.ilike.${like},domain.ilike.${like}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!currentOrganization,
  });

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="flex items-center gap-2 truncate">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              {value ? value.name : <span className="text-muted-foreground">Link a company</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search name or domain..." value={search} onValueChange={setSearch} />
            <CommandList>
              {isFetching && companies.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <CommandEmpty>No companies found.</CommandEmpty>
              )}
              <CommandGroup>
                {companies.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onChange(c);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0">
                      <div className="truncate">{c.name}</div>
                      {c.domain && <div className="truncate text-xs text-muted-foreground">{c.domain}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => onChange(null)} aria-label="Unlink company">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
