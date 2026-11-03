import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { FieldMapping, targetFields } from "./CSVFieldMapper";

function getFieldLabel(targetField: string): { label: string; required?: boolean } {
  if (targetField.startsWith("custom:")) {
    const key = targetField.substring(7);
    return { label: `Custom: ${key}` };
  }
  const field = targetFields.find((f) => f.key === targetField);
  return { label: field?.label || targetField, required: field?.required };
}

interface CSVPreviewProps {
  data: Record<string, string>[];
  mappings: FieldMapping[];
  totalRows: number;
}

export function CSVPreview({ data, mappings, totalRows }: CSVPreviewProps) {
  // Get only mapped fields (not skipped)
  const activeMappings = mappings.filter((m) => m.targetField !== "skip");

  // Transform data to show mapped values
  const transformedData = data.slice(0, 10).map((row) => {
    const transformed: Record<string, string> = {};
    for (const mapping of activeMappings) {
      const { label } = getFieldLabel(mapping.targetField);
      transformed[label] = row[mapping.csvColumn] || "";
    }
    return transformed;
  });

  // Validate rows — email is the only field the import actually requires
  // (see process-csv-import): rows without email are skipped, LinkedIn URL is optional.
  const emailMapping = mappings.find((m) => m.targetField === "email");
  const validRows = data.filter((row) => {
    if (!emailMapping) return false;
    const email = row[emailMapping.csvColumn];
    return email && email.includes("@");
  });

  const invalidRows = data.length - validRows.length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="text-sm">
            <strong>{validRows.length}</strong> valid contacts
          </span>
        </div>
        {invalidRows > 0 && (
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-[hsl(var(--status-warning))]" />
            <span className="text-sm text-[hsl(var(--status-warning))]">
              <strong>{invalidRows}</strong> rows missing email (will be skipped)
            </span>
          </div>
        )}
        {totalRows > 10 && (
          <Badge variant="secondary">
            Showing first 10 of {totalRows} rows
          </Badge>
        )}
      </div>

      {/* Preview Table */}
      <div className="border rounded-lg overflow-auto max-h-[400px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              {activeMappings.map((mapping) => {
                const { label, required } = getFieldLabel(mapping.targetField);
                return (
                  <TableHead key={mapping.csvColumn}>
                    <div className="flex items-center gap-1">
                      {label}
                      {required && <span className="text-red-500">*</span>}
                    </div>
                  </TableHead>
                );
              })}
              <TableHead className="w-20">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transformedData.map((row, index) => {
              const emailField = targetFields.find((f) => f.key === "email");
              const hasEmail = emailField
                ? row[emailField.label]?.includes("@")
                : false;

              return (
                <TableRow key={index}>
                  <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                  {activeMappings.map((mapping) => {
                    const { label } = getFieldLabel(mapping.targetField);
                    const value = row[label] || "";
                    const isLinkedIn = mapping.targetField === "linkedin_url";

                    return (
                      <TableCell key={mapping.csvColumn} className="max-w-[200px]">
                        {isLinkedIn && value ? (
                          <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:underline truncate"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{value}</span>
                          </a>
                        ) : (
                          <span className="truncate block">{value || "—"}</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    {hasEmail ? (
                      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                        Valid
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30 bg-[hsl(var(--status-warning))]/10">
                        Skip
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
