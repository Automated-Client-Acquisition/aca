import { FileSpreadsheet, Search, ThumbsUp, Calendar, Linkedin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ImportSource {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  available: boolean;
  requiresLinkedIn?: boolean;
}

const importSources: ImportSource[] = [
  {
    id: "csv",
    title: "Import from CSV",
    description: "Upload a CSV file with LinkedIn profile URLs and contact data",
    icon: FileSpreadsheet,
    available: true,
  },
  {
    id: "linkedin_search",
    title: "LinkedIn Search Bar",
    description: "Import leads from a LinkedIn people search URL",
    icon: Search,
    available: true,
    requiresLinkedIn: true,
  },
  {
    id: "post_reactors",
    title: "LinkedIn Post (Reactors)",
    description: "Import people who reacted to or commented on a post",
    icon: ThumbsUp,
    available: true,
    requiresLinkedIn: true,
  },
  {
    id: "event_attendees",
    title: "LinkedIn Event (Attendees)",
    description: "Import attendees from a LinkedIn event",
    icon: Calendar,
    available: true,
    requiresLinkedIn: true,
  },
];

export { importSources };

interface ImportSourceGridProps {
  onSelect: (sourceId: string) => void;
  selectedSource: string | null;
  hasLinkedInAccount?: boolean;
}

export function ImportSourceGrid({ onSelect, selectedSource, hasLinkedInAccount = false }: ImportSourceGridProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Import methods</h2>
        <p className="text-sm text-muted-foreground">
          Choose how you want to import leads into your list
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {importSources.map((source) => {
          // LinkedIn sources require a connected account
          const isAvailable = source.available && (!source.requiresLinkedIn || hasLinkedInAccount);

          return (
            <Card
              key={source.id}
              className={cn(
                "cursor-pointer transition-all hover:border-primary/50",
                selectedSource === source.id && "border-primary ring-1 ring-primary",
                !isAvailable && "opacity-60 cursor-not-allowed"
              )}
              onClick={() => isAvailable && onSelect(source.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                      isAvailable
                        ? source.requiresLinkedIn
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-600"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <source.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{source.title}</h3>
                      {source.requiresLinkedIn && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Linkedin className="h-3 w-3" />
                          LinkedIn
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{source.description}</p>
                    {source.requiresLinkedIn && !hasLinkedInAccount && (
                      <p className="text-xs text-[hsl(var(--status-warning))] mt-2">
                        Connect a LinkedIn account in Settings to use this
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
