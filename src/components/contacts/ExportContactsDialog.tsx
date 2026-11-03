import { useState, useEffect } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Loader2, Mail, FileSpreadsheet, FileJson, ChevronDown, ChevronRight, Columns } from "lucide-react";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";

type ExportFormat = "csv" | "json";

// Available export columns with their display labels
export const EXPORT_COLUMNS = [
  { key: "display_name", label: "Name", group: "basic" },
  { key: "first_name", label: "First Name", group: "basic" },
  { key: "last_name", label: "Last Name", group: "basic" },
  { key: "primary_email", label: "Email", group: "contact" },
  { key: "primary_phone", label: "Phone", group: "contact" },
  { key: "company", label: "Company", group: "work" },
  { key: "job_title", label: "Job Title", group: "work" },
  { key: "primary_linkedin_url", label: "LinkedIn URL", group: "contact" },
  { key: "company_website", label: "Website", group: "work" },
  { key: "city", label: "City", group: "location" },
  { key: "state", label: "State", group: "location" },
  { key: "country", label: "Country", group: "location" },
  { key: "tags", label: "Tags", group: "metadata" },
  { key: "status", label: "Status", group: "metadata" },
  { key: "source", label: "Source", group: "metadata" },
  { key: "contact_type", label: "Type", group: "metadata" },
  { key: "lead_score", label: "Lead Score", group: "metadata" },
  { key: "is_linkedin_connection", label: "LinkedIn Connection", group: "metadata" },
  { key: "first_seen_at", label: "First Seen", group: "dates" },
  { key: "last_activity_at", label: "Last Activity", group: "dates" },
  { key: "created_at", label: "Created At", group: "dates" },
  // Enrichment data columns
  { key: "enrichment_industry", label: "Industry", group: "enrichment" },
  { key: "enrichment_company_size", label: "Company Size", group: "enrichment" },
  { key: "enrichment_seniority", label: "Seniority", group: "enrichment" },
  { key: "enrichment_department", label: "Department", group: "enrichment" },
  { key: "enrichment_technologies", label: "Technologies", group: "enrichment" },
  { key: "enrichment_email_verified", label: "Email Verified", group: "enrichment" },
  { key: "enrichment_email_confidence", label: "Email Confidence", group: "enrichment" },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];

// Default columns for export
const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  "display_name",
  "primary_email",
  "company",
  "job_title",
  "primary_linkedin_url",
  "city",
  "country",
  "status",
  "source",
];

// Column groups for better organization
const COLUMN_GROUPS = {
  basic: "Basic Info",
  contact: "Contact Info",
  work: "Work Info",
  location: "Location",
  metadata: "Metadata",
  dates: "Dates",
  enrichment: "Enrichment Data",
  custom: "Custom Fields",
} as const;

export type ExportMode = "selected" | "filtered" | "all";

interface ExportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { email: string; format: ExportFormat; columns: string[] }) => void;
  isLoading?: boolean;
  contactCount?: number;
  selectedCount?: number;
  mode?: ExportMode;
  defaultEmail?: string;
}

export function ExportContactsDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  contactCount = 0,
  selectedCount = 0,
  mode = "all",
  defaultEmail = "",
}: ExportContactsDialogProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(DEFAULT_EXPORT_COLUMNS)
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const { data: customFieldDefs } = useCustomFieldDefs();
  const allExportColumns = [
    ...EXPORT_COLUMNS,
    ...(customFieldDefs || []).map((f) => ({
      key: `custom_${f.field_key}` as const,
      label: f.display_name,
      group: "custom" as const,
    })),
  ];

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setEmail(defaultEmail);
      setFormat("csv");
      setSelectedColumns(new Set(DEFAULT_EXPORT_COLUMNS));
      setColumnsOpen(false);
    }
  }, [open, defaultEmail]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !isValidEmail(trimmedEmail)) return;
    if (selectedColumns.size === 0) return;
    onSubmit({ email: trimmedEmail, format, columns: Array.from(selectedColumns) });
  };

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const toggleColumn = (key: string) => {
    const newSet = new Set(selectedColumns);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setSelectedColumns(newSet);
  };

  const selectAllColumns = () => {
    setSelectedColumns(new Set(allExportColumns.map((c) => c.key)));
  };

  const selectDefaultColumns = () => {
    setSelectedColumns(new Set(DEFAULT_EXPORT_COLUMNS));
  };

  const toggleGroup = (group: string) => {
    const groupColumns = allExportColumns.filter((c) => c.group === group);
    const allSelected = groupColumns.every((c) => selectedColumns.has(c.key));
    const newSet = new Set(selectedColumns);

    if (allSelected) {
      groupColumns.forEach((c) => newSet.delete(c.key));
    } else {
      groupColumns.forEach((c) => newSet.add(c.key));
    }
    setSelectedColumns(newSet);
  };

  const canSubmit = email.trim() && isValidEmail(email.trim()) && selectedColumns.size > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Export Contacts</DialogTitle>
            <DialogDescription>
              {mode === "selected" && selectedCount > 0 ? (
                <>Export {selectedCount.toLocaleString()} selected contact{selectedCount !== 1 ? "s" : ""}. The file will be sent to your email.</>
              ) : mode === "filtered" && contactCount > 0 ? (
                <>Export {contactCount.toLocaleString()} contact{contactCount !== 1 ? "s" : ""} matching your filters. The file will be sent to your email.</>
              ) : contactCount > 0 ? (
                <>Export all {contactCount.toLocaleString()} contacts. The file will be sent to your email.</>
              ) : (
                <>Export your contacts. The file will be sent to your email.</>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="exportEmail">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="exportEmail"
                  type="email"
                  placeholder="your@email.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                We'll send the export file to this email address
              </p>
            </div>

            {/* Format selection */}
            <div className="space-y-2">
              <Label>Export Format</Label>
              <RadioGroup
                value={format}
                onValueChange={(value) => setFormat(value as ExportFormat)}
                className="grid grid-cols-2 gap-4"
              >
                <div>
                  <RadioGroupItem
                    value="csv"
                    id="format-csv"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="format-csv"
                    className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  >
                    <FileSpreadsheet className="mb-2 h-6 w-6" />
                    <span className="text-sm font-medium">CSV</span>
                    <span className="text-xs text-muted-foreground">
                      Excel compatible
                    </span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem
                    value="json"
                    id="format-json"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="format-json"
                    className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  >
                    <FileJson className="mb-2 h-6 w-6" />
                    <span className="text-sm font-medium">JSON</span>
                    <span className="text-xs text-muted-foreground">
                      For developers
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Column selection */}
            <Collapsible open={columnsOpen} onOpenChange={setColumnsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                >
                  <span className="flex items-center gap-2">
                    <Columns className="h-4 w-4" />
                    Columns to Export
                    <span className="text-xs text-muted-foreground">
                      ({selectedColumns.size} selected)
                    </span>
                  </span>
                  {columnsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex gap-2 mb-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectAllColumns}
                    className="text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectDefaultColumns}
                    className="text-xs"
                  >
                    Reset to Default
                  </Button>
                </div>
                <ScrollArea className="h-[200px] border rounded-md p-2">
                  <div className="space-y-4">
                    {Object.entries(COLUMN_GROUPS).map(([groupKey, groupLabel]) => {
                      const groupColumns = allExportColumns.filter(
                        (c) => c.group === groupKey
                      );
                      if (groupColumns.length === 0) return null;

                      const allSelected = groupColumns.every((c) =>
                        selectedColumns.has(c.key)
                      );
                      const someSelected =
                        !allSelected &&
                        groupColumns.some((c) => selectedColumns.has(c.key));

                      return (
                        <div key={groupKey} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`group-${groupKey}`}
                              checked={allSelected}
                              className={someSelected ? "data-[state=unchecked]:bg-muted" : ""}
                              onCheckedChange={() => toggleGroup(groupKey)}
                            />
                            <Label
                              htmlFor={`group-${groupKey}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {groupLabel}
                            </Label>
                          </div>
                          <div className="ml-6 space-y-1">
                            {groupColumns.map((col) => (
                              <div key={col.key} className="flex items-center gap-2">
                                <Checkbox
                                  id={`col-${col.key}`}
                                  checked={selectedColumns.has(col.key)}
                                  onCheckedChange={() => toggleColumn(col.key)}
                                />
                                <Label
                                  htmlFor={`col-${col.key}`}
                                  className="text-sm font-normal cursor-pointer"
                                >
                                  {col.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="cta" type="submit" disabled={!canSubmit || isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Export {selectedColumns.size} Columns
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
