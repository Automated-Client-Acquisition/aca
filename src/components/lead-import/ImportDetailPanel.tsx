import { ArrowRight, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IMPORT_SOURCES, type ImportSourceId } from "@/config/importSources";
import { ComingSoonPlaceholder } from "./placeholders/ComingSoonPlaceholder";

interface ImportDetailPanelProps {
  selectedSource: ImportSourceId | null;
  hasLinkedInAccount: boolean;
  children: React.ReactNode;
}

export function ImportDetailPanel({
  selectedSource,
  hasLinkedInAccount,
  children,
}: ImportDetailPanelProps) {
  const source = IMPORT_SOURCES.find((s) => s.id === selectedSource);

  // No source selected - show welcome state
  if (!selectedSource || !source) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6">
          <Linkedin className="h-8 w-8 text-blue-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Import from LinkedIn search bar</h2>
        <p className="text-muted-foreground max-w-md mb-6">
          Start a new search to find unlimited, unique leads on LinkedIn! Search and filter by position, company, industry, location and much more.
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowRight className="h-4 w-4" />
          <span>Select an import method from the sidebar to get started</span>
        </div>
      </div>
    );
  }

  // Coming soon sources
  if (source.comingSoon) {
    return (
      <div className="flex-1 overflow-y-auto">
        <ComingSoonPlaceholder source={source} />
      </div>
    );
  }

  // Available source - show header and children
  const Icon = source.icon;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b bg-background">
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              source.requiresLinkedIn
                ? "bg-blue-100 text-blue-700"
                : "bg-green-100 text-green-600"
            }`}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold">{source.title}</h2>
              {source.freeAccount && (
                <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                  Free Account
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">{source.description}</p>
          </div>
          <Button variant="cta" className="shrink-0">
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
