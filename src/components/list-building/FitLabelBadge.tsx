import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FitLabel } from "@/hooks/useListBuilding";

const STYLES: Record<FitLabel, string> = {
  Strong: "bg-green-500/15 text-green-600 border-green-500/30",
  Good: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  Weak: "bg-gray-500/15 text-gray-600 border-gray-500/30",
  Disqualify: "bg-red-500/15 text-red-600 border-red-500/30",
};

export function FitLabelBadge({ label }: { label: FitLabel }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STYLES[label])}>
      {label}
    </Badge>
  );
}
