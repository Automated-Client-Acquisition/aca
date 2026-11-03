import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CommandSeparator,
} from "@/components/ui/command";
import { CheckCircle2, AlertCircle, Plus, Check, X, ChevronsUpDown } from "lucide-react";
import type { CustomFieldDef } from "@/hooks/useCustomFieldDefs";
import { sanitizeFieldKey } from "@/lib/custom-fields";
import { buildAutoFieldMappings } from "@/lib/csv-field-detection";

export interface FieldMapping {
  csvColumn: string;
  targetField: string;
}

export interface TargetField {
  key: string;
  label: string;
  required?: boolean;
  description?: string;
}

export interface PendingCustomField {
  field_key: string;
  display_name: string;
  field_type: string;
}

const targetFields: TargetField[] = [
  // Contact Info
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "instagram_url", label: "Instagram", description: "Profile URL or @handle" },

  // Contact Info
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "job_title", label: "Job Title" },
  { key: "seniority", label: "Seniority" },
  { key: "departments", label: "Departments" },

  // Email
  { key: "email", label: "Email", required: true, description: "Required — used to identify and dedupe contacts" },
  { key: "email_status", label: "Email Status" },
  { key: "email_source", label: "Email Source" },
  { key: "email_confidence", label: "Email Confidence" },
  { key: "email_catchall_status", label: "Email Catch-all Status" },
  { key: "email_last_verified", label: "Email Last Verified" },
  { key: "secondary_email", label: "Secondary Email" },
  { key: "secondary_email_source", label: "Secondary Email Source" },
  { key: "tertiary_email", label: "Tertiary Email" },
  { key: "tertiary_email_source", label: "Tertiary Email Source" },

  // Phone
  { key: "work_direct_phone", label: "Work Direct Phone" },
  { key: "mobile_phone", label: "Mobile Phone" },
  { key: "home_phone", label: "Home Phone" },
  { key: "corporate_phone", label: "Corporate Phone" },
  { key: "other_phone", label: "Other Phone" },

  // Location
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },

  // Enrichment
  { key: "linkedin_bio", label: "LinkedIn Bio" },
  { key: "home_page_text", label: "Home Page Text" },

  // Company
  { key: "company", label: "Company" },
  { key: "company_website", label: "Company Website", description: "Used for company analysis & personalization" },
  { key: "company_linkedin_url", label: "Company LinkedIn URL" },
  { key: "company_address", label: "Company Address" },
  { key: "company_city", label: "Company City" },
  { key: "company_state", label: "Company State" },
  { key: "company_country", label: "Company Country" },
  { key: "company_phone", label: "Company Phone" },
  { key: "employee_count", label: "Employee Count" },
  { key: "industry", label: "Industry" },
  { key: "keywords", label: "Keywords" },
  { key: "technologies", label: "Technologies" },
  { key: "annual_revenue", label: "Annual Revenue" },
  { key: "total_funding", label: "Total Funding" },
  { key: "latest_funding", label: "Latest Funding" },
  { key: "latest_funding_amount", label: "Latest Funding Amount" },
  { key: "last_raised_at", label: "Last Raised At" },
  { key: "subsidiary_of", label: "Subsidiary Of" },
  { key: "retail_locations", label: "Number of Retail Locations" },

  // Social
  { key: "facebook_url", label: "Facebook URL" },
  { key: "twitter_url", label: "Twitter URL" },

  // CRM/Tracking
  { key: "stage", label: "Stage" },
  { key: "lists", label: "Lists" },
  { key: "last_contacted", label: "Last Contacted" },
  { key: "email_sent", label: "Email Sent" },
  { key: "email_open", label: "Email Open" },
  { key: "email_bounced", label: "Email Bounced" },
  { key: "replied", label: "Replied" },
  { key: "demoed", label: "Demoed" },

  // External IDs
  { key: "apollo_contact_id", label: "Apollo Contact ID" },
  { key: "apollo_account_id", label: "Apollo Account ID" },

  { key: "skip", label: "Skip this column" },
];

const CREATE_CUSTOM_VALUE = "__create_custom__";

interface FieldComboboxProps {
  value: string;
  onChange: (value: string) => void;
  allCustomFields: { key: string; label: string; field_key: string }[];
  showCreateCustom: boolean;
  getMappingLabel: (value: string) => string;
}

function FieldCombobox({ value, onChange, allCustomFields, showCreateCustom, getMappingLabel }: FieldComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[220px] justify-between font-normal h-8 text-sm"
        >
          <span className="truncate">{getMappingLabel(value)}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fields..." className="h-9 focus-visible:ring-0 focus-visible:ring-offset-0" />
          <CommandList>
            <CommandEmpty>No field found.</CommandEmpty>
            <CommandGroup heading="Predefined Fields">
              {targetFields.filter((f) => f.key !== "skip").map((field) => (
                <CommandItem
                  key={field.key}
                  value={field.label}
                  onSelect={() => {
                    onChange(field.key);
                    setOpen(false);
                  }}
                  className="text-sm"
                >
                  {field.label}
                  {field.required && <span className="ml-1 text-xs text-red-500">*</span>}
                  {value === field.key && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>

            {allCustomFields.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Custom Variables">
                  {allCustomFields.map((f) => (
                    <CommandItem
                      key={f.key}
                      value={`${f.label} custom_${f.field_key}`}
                      onSelect={() => {
                        onChange(f.key);
                        setOpen(false);
                      }}
                      className="text-sm"
                    >
                      <span className="truncate">{f.label}</span>
                      {value === f.key && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="Skip this column"
                onSelect={() => {
                  onChange("skip");
                  setOpen(false);
                }}
                className="text-sm text-muted-foreground"
              >
                Skip this column
                {value === "skip" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </CommandItem>
              {showCreateCustom && (
                <CommandItem
                  value="Create as Custom Variable"
                  onSelect={() => {
                    onChange(CREATE_CUSTOM_VALUE);
                    setOpen(false);
                  }}
                  className="text-sm"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5 text-violet-600" />
                  <span className="text-violet-600">Create Custom Variable</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface CSVFieldMapperProps {
  headers: string[];
  mappings: FieldMapping[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
  previewData: Record<string, string>[];
  existingCustomFields?: CustomFieldDef[];
  pendingCustomFields?: PendingCustomField[];
  onCustomFieldCreate?: (field: PendingCustomField) => void;
}

export function CSVFieldMapper({
  headers,
  mappings,
  onMappingsChange,
  previewData,
  existingCustomFields = [],
  pendingCustomFields = [],
  onCustomFieldCreate,
}: CSVFieldMapperProps) {
  const [creatingForColumn, setCreatingForColumn] = useState<string | null>(null);
  const [customDisplayName, setCustomDisplayName] = useState("");

  // Initialize mappings with auto-detection if not already set
  const effectiveMappings = useMemo(() => {
    if (mappings.length > 0) return mappings;
    return buildAutoFieldMappings(headers);
  }, [headers, mappings]);

  // Email is the required identifier for deduplication
  const hasEmailMapped = effectiveMappings.some((m) => m.targetField === 'email');
  const isValid = hasEmailMapped;

  // All custom fields: existing org fields + newly created pending ones
  const allCustomFields = useMemo(() => {
    const existing = existingCustomFields.map((f) => ({
      key: `custom:${f.field_key}`,
      label: f.display_name,
      field_key: f.field_key,
    }));
    const pending = pendingCustomFields.map((f) => ({
      key: `custom:${f.field_key}`,
      label: f.display_name,
      field_key: f.field_key,
    }));
    // Deduplicate by key
    const seen = new Set<string>();
    return [...existing, ...pending].filter((f) => {
      if (seen.has(f.key)) return false;
      seen.add(f.key);
      return true;
    });
  }, [existingCustomFields, pendingCustomFields]);

  const handleMappingChange = (csvColumn: string, targetField: string) => {
    if (targetField === CREATE_CUSTOM_VALUE) {
      setCreatingForColumn(csvColumn);
      setCustomDisplayName(csvColumn);
      return;
    }

    const newMappings = effectiveMappings.map((m) =>
      m.csvColumn === csvColumn ? { ...m, targetField } : m
    );
    onMappingsChange(newMappings);
  };

  const handleConfirmCustomField = () => {
    if (!creatingForColumn || !customDisplayName.trim() || !onCustomFieldCreate) return;

    const fieldKey = sanitizeFieldKey(customDisplayName);
    if (!fieldKey) return;

    // Create the custom field definition
    onCustomFieldCreate({
      field_key: fieldKey,
      display_name: customDisplayName.trim(),
      field_type: "text",
    });

    // Update the mapping to point to the custom field
    const newMappings = effectiveMappings.map((m) =>
      m.csvColumn === creatingForColumn
        ? { ...m, targetField: `custom:${fieldKey}` }
        : m
    );
    onMappingsChange(newMappings);

    setCreatingForColumn(null);
    setCustomDisplayName("");
  };

  const handleCancelCustomField = () => {
    setCreatingForColumn(null);
    setCustomDisplayName("");
  };

  // Get sample values for a column
  const getSampleValues = (column: string): string[] => {
    return previewData
      .slice(0, 3)
      .map((row) => row[column])
      .filter(Boolean);
  };

  // Get display label for a mapping value
  const getMappingLabel = (targetField: string): string => {
    if (targetField.startsWith("custom:")) {
      const custom = allCustomFields.find((f) => f.key === targetField);
      return custom ? `Custom: ${custom.label}` : targetField;
    }
    const field = targetFields.find((f) => f.key === targetField);
    return field?.label || targetField;
  };

  return (
    <div className="space-y-6">
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        {isValid ? (
          <>
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span className="text-sm font-medium text-green-600">
              Email field mapped
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <span className="text-sm font-medium text-amber-600">
              Map the Email column — it is required to identify contacts
            </span>
          </>
        )}
      </div>

      {/* Mapping table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium text-sm">CSV Column</th>
              <th className="text-left p-3 font-medium text-sm">Sample Data</th>
              <th className="text-left p-3 font-medium text-sm">Map To</th>
            </tr>
          </thead>
          <tbody>
            {effectiveMappings.map((mapping, index) => {
              const samples = getSampleValues(mapping.csvColumn);
              const isCustom = mapping.targetField.startsWith("custom:");
              const predefinedField = targetFields.find((f) => f.key === mapping.targetField);
              const isRequired = mapping.targetField === 'email';
              const isCreating = creatingForColumn === mapping.csvColumn;

              return (
                <tr key={mapping.csvColumn} className={index % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{mapping.csvColumn}</span>
                      {isRequired && (
                        <Badge variant="outline" className="text-xs">
                          Identifier
                        </Badge>
                      )}
                      {isCustom && (
                        <Badge variant="outline" className="text-xs bg-violet-500/10 text-violet-600 border-violet-500/20">
                          Custom Variable
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                      {samples.length > 0 ? samples.join(", ") : "—"}
                    </div>
                  </td>
                  <td className="p-3">
                    {isCreating ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={customDisplayName}
                          onChange={(e) => setCustomDisplayName(e.target.value)}
                          placeholder="Variable name..."
                          className="h-8 w-[140px] text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleConfirmCustomField();
                            if (e.key === "Escape") handleCancelCustomField();
                          }}
                        />
                        <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                          {`{{custom_${sanitizeFieldKey(customDisplayName)}}}`}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-600"
                          onClick={handleConfirmCustomField}
                          disabled={!customDisplayName.trim() || !sanitizeFieldKey(customDisplayName)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={handleCancelCustomField}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <FieldCombobox
                        value={mapping.targetField}
                        onChange={(value) => handleMappingChange(mapping.csvColumn, value)}
                        allCustomFields={allCustomFields}
                        showCreateCustom={!!onCustomFieldCreate}
                        getMappingLabel={getMappingLabel}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { targetFields };
