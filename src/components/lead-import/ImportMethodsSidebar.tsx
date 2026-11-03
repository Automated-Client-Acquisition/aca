import { IMPORT_SOURCES, type ImportSourceId } from "@/config/importSources";
import { ImportMethodCard } from "./ImportMethodCard";

interface ImportMethodsSidebarProps {
  selectedSource: ImportSourceId | null;
  onSelectSource: (sourceId: ImportSourceId) => void;
  hasLinkedInAccount: boolean;
}

export function ImportMethodsSidebar({
  selectedSource,
  onSelectSource,
  hasLinkedInAccount,
}: ImportMethodsSidebarProps) {
  return (
    <div className="w-80 shrink-0 border-r bg-card">
      <div className="px-4 py-3 border-b">
        <h2 className="font-semibold text-sm">Import methods</h2>
      </div>
      <div className="p-2 space-y-0.5">
        {IMPORT_SOURCES.map((source) => {
          // Determine if source is disabled
          const needsLinkedIn = source.requiresLinkedIn && !hasLinkedInAccount;
          const isDisabled = !source.available || needsLinkedIn;

          return (
            <ImportMethodCard
              key={source.id}
              source={source}
              isSelected={selectedSource === source.id}
              isDisabled={isDisabled}
              onClick={() => {
                if (!isDisabled) {
                  onSelectSource(source.id as ImportSourceId);
                }
              }}
            />
          );
        })}
      </div>
      {!hasLinkedInAccount && (
        <div className="p-4 border-t">
          <p className="text-xs text-muted-foreground">
            Connect a LinkedIn account in Settings to use LinkedIn import methods.
          </p>
        </div>
      )}
    </div>
  );
}
