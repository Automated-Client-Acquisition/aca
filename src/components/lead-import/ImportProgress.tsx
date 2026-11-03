import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight, Info } from "lucide-react";
import type { SkipReasons } from "@/hooks/useCSVImportJob";

interface ImportProgressProps {
  status: "idle" | "importing" | "complete" | "error";
  progress: number;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  skipReasons?: SkipReasons | null;
  errorMessage?: string;
  onNavigateAway?: () => void;
  targetListId?: string | null;
}

const SKIP_REASON_LABELS: Record<string, string> = {
  missing_identifier: "Missing email",
};

export function ImportProgress({
  status,
  progress,
  totalRows,
  importedCount,
  skippedCount,
  skipReasons,
  errorMessage,
  onNavigateAway,
  targetListId,
}: ImportProgressProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        {status === "importing" && (
          <>
            <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold mb-2">Importing contacts...</h3>
            <p className="text-sm text-muted-foreground">
              Processing your CSV file in the background
            </p>
          </>
        )}

        {status === "complete" && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Import Complete</h3>
            <p className="text-sm text-muted-foreground">
              Your contacts have been successfully imported
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Import Failed</h3>
            <p className="text-sm text-destructive">{errorMessage || "An error occurred"}</p>
          </>
        )}
      </div>

      {/* Progress bar */}
      {status === "importing" && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-sm text-center text-muted-foreground">
            {Math.round(progress)}% complete
          </p>
        </div>
      )}

      {/* Stats */}
      {(() => {
        const dupsUpdated = skipReasons?.duplicates_updated || 0;
        const newContacts = importedCount - dupsUpdated;
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold">{totalRows || importedCount + skippedCount}</div>
              <div className="text-sm text-muted-foreground">Total Rows</div>
            </div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{importedCount}</div>
              <div className="text-sm text-green-600">Processed</div>
            </div>
            {dupsUpdated > 0 ? (
              <>
                <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900">
                  <div className="text-xl font-bold text-emerald-600">{newContacts}</div>
                  <div className="text-xs text-emerald-600">New Contacts</div>
                </div>
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900">
                  <div className="text-xl font-bold text-blue-600">{dupsUpdated}</div>
                  <div className="text-xs text-blue-600">Existing Updated</div>
                </div>
              </>
            ) : null}
            {skippedCount > 0 && (
              <div className={`text-center p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg ${dupsUpdated > 0 ? 'col-span-2' : ''}`}>
                <div className="text-2xl font-bold text-amber-600">{skippedCount}</div>
                <div className="text-sm text-amber-600">Skipped</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Skip reasons breakdown. Only missing_identifier (no email) reflects an
          actual skip — invalid_linkedin_url and duplicates_updated don't stop
          a row from being imported, so they're excluded here. */}
      {skippedCount > 0 && skipReasons && (skipReasons.missing_identifier ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <Info className="h-4 w-4" />
            Why were rows skipped?
          </div>
          <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
            <li className="flex items-center justify-between">
              <span>{SKIP_REASON_LABELS.missing_identifier}</span>
              <span className="font-medium tabular-nums">{skipReasons.missing_identifier!.toLocaleString()}</span>
            </li>
          </ul>
          <p className="text-xs text-amber-600 dark:text-amber-500 pt-1">
            Each row needs an email address to be imported. Rows without one are skipped.
          </p>
        </div>
      )}

      {/* Navigation options for importing state */}
      {status === "importing" && onNavigateAway && (
        <div className="pt-4 border-t">
          <div className="text-center mb-4">
            <p className="text-sm text-muted-foreground">
              You can safely navigate away. The import will continue in the background.
            </p>
          </div>
          <Button onClick={onNavigateAway} variant="outline" className="w-full">
            <ArrowRight className="h-4 w-4 mr-2" />
            {targetListId ? "Go to List" : "Go to Lists"}
          </Button>
        </div>
      )}
    </div>
  );
}
