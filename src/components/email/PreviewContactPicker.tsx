import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useContacts, type CrmContact } from "@/hooks/crm/useContacts";

interface PreviewContactPickerProps {
  contact: CrmContact | null;
  onSelect: (contact: CrmContact | null) => void;
  allowSample?: boolean;
  disabled?: boolean;
}

export function PreviewContactPicker({
  contact,
  onSelect,
  allowSample = true,
  disabled = false,
}: PreviewContactPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, isFetching, isError, refetch } = useContacts(
    { search: search.trim() || undefined, pageSize: 25 },
    { enabled: open },
  );
  const contacts = data?.data || [];
  const select = (value: CrmContact | null) => {
    onSelect(value);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          role="combobox"
          aria-label="Test contact"
          aria-expanded={open}
          className="w-full justify-between gap-2 font-normal"
        >
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            {contact?.display_name ||
              contact?.primary_email ||
              "Choose a test contact"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search test contacts"
            placeholder="Search by name, email or company…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {allowSample && <CommandItem
              value="sample"
              onSelect={() => select(null)}
              className="gap-2 py-3"
            >
              <Check
                className={`h-4 w-4 ${contact ? "opacity-0" : "opacity-100"}`}
              />
              Use sample data
            </CommandItem>}
            {isFetching && (
              <p
                role="status"
                className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching contacts…
              </p>
            )}
            {isError ? (
              <div role="alert" className="space-y-2 p-3 text-sm">
                <p>Contacts couldn’t be loaded.</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Try again
                </Button>
              </div>
            ) : !isFetching && contacts.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No contacts found. Try another name, email or company.
              </p>
            ) : (
              contacts.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => select(item)}
                  className="items-start gap-2 py-3"
                >
                  <Check
                    className={`mt-0.5 h-4 w-4 shrink-0 ${contact?.id === item.id ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {item.display_name ||
                        item.primary_email ||
                        "Unnamed contact"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[item.primary_email, item.company]
                        .filter(Boolean)
                        .join(" · ") || "No email address"}
                    </span>
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
