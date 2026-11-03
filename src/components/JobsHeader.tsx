import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface JobsHeaderProps {
  onAddClick: () => void;
}

export function JobsHeader({ onAddClick }: JobsHeaderProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
      <Button variant="cta" onClick={onAddClick}><Plus className="mr-2 h-4 w-4" />New run</Button>
      <p className="col-span-2 text-sm text-muted-foreground">See created content and publishing results.</p>
    </div>
  );
}
