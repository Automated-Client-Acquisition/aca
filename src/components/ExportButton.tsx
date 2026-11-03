import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileJson, FileSpreadsheet, Loader2 } from "lucide-react";
import { exportToCSV, exportToJSON, type ExportColumn } from "@/lib/exportUtils";
import { toast } from "sonner";

interface ExportButtonProps {
  data?: any[];
  /** Fetches the rows at click time, for tables that only hold the current page */
  loadData?: () => Promise<unknown[]>;
  columns: ExportColumn[];
  filename: string;
}

export function ExportButton({ data, loadData, columns, filename }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: "csv" | "json") => {
    const label = format.toUpperCase();
    setExporting(true);
    try {
      const rows = loadData ? await loadData() : data ?? [];
      const timestamp = new Date().toISOString().split('T')[0];
      if (format === "csv") exportToCSV(rows, columns, `${filename}_${timestamp}.csv`);
      else exportToJSON(rows, columns, `${filename}_${timestamp}.json`);
      toast.success(`Exported ${rows.length} rows to ${label}`);
      setOpen(false);
    } catch (error) {
      toast.error(`Failed to export ${label}`);
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={exporting}>
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2 cursor-pointer">
          <FileSpreadsheet className="w-4 h-4" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")} className="gap-2 cursor-pointer">
          <FileJson className="w-4 h-4" />
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
