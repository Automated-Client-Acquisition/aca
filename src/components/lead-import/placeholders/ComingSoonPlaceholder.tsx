import { Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportSource } from "@/config/importSources";

interface ComingSoonPlaceholderProps {
  source: ImportSource;
}

export function ComingSoonPlaceholder({ source }: ComingSoonPlaceholderProps) {
  const Icon = source.icon;

  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>

      <h2 className="text-xl font-semibold mb-2">{source.title}</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        {source.description}
      </p>

      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full mb-6">
        <Clock className="h-4 w-4" />
        <span className="text-sm font-medium">Coming Soon</span>
      </div>

      {source.requiresPremium && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Sparkles className="h-4 w-4" />
          <span>Requires {source.id.includes("sales_nav") ? "Sales Navigator" : "LinkedIn Recruiter"} subscription</span>
        </div>
      )}

      <p className="text-sm text-muted-foreground max-w-sm">
        We're working on bringing this feature to you. Stay tuned for updates!
      </p>

      <Button variant="outline" className="mt-6" disabled>
        Notify me when available
      </Button>
    </div>
  );
}
