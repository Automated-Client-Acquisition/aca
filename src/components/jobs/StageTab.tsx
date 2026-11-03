import { TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type StageStatus = 'pending' | 'generating' | 'ready' | 'failed';

interface StageTabProps {
  stageId: string;
  label: string;
  status: StageStatus;
}

export function StageTab({ stageId, label, status }: StageTabProps) {
  const getStatusDotColor = () => {
    switch (status) {
      case 'ready': return "bg-green-500";
      case 'generating': return "bg-blue-500 animate-pulse";
      case 'failed': return "bg-destructive";
      case 'pending':
      default: return "bg-muted-foreground/40";
    }
  };

  return (
    <TabsTrigger
      value={stageId}
      className={cn(
        "data-[state=active]:bg-transparent",
        "data-[state=active]:shadow-none",
        "data-[state=active]:border-b-2",
        "data-[state=active]:border-primary",
        "rounded-none pb-2 relative gap-1.5"
      )}
    >
      {label}
      <span className={cn("h-2 w-2 rounded-full flex-shrink-0", getStatusDotColor())} />
    </TabsTrigger>
  );
}
