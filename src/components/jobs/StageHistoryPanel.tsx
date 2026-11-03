import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { History, Clock, User, CheckCircle2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface StageVersion {
  version: number;
  timestamp: string;
  user_id?: string;
  action: 'generated' | 'approved' | 'rejected' | 'regenerated';
  cost?: number;
  model_used?: string;
  generation_time_ms?: number;
}

interface StageHistoryPanelProps {
  stageId: string;
  stageName: string;
  versions: StageVersion[];
  currentVersion: number;
}

export function StageHistoryPanel({
  stageId,
  stageName,
  versions,
  currentVersion,
}: StageHistoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!versions || versions.length <= 1) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-4">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <History className="mr-2 h-4 w-4" />
          View Stage History ({versions.length} versions)
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <ScrollArea className="h-[300px] rounded-md border">
          <div className="p-4 space-y-3">
            {versions.map((version, index) => (
              <div
                key={`${stageId}-${version.version}`}
                className={`p-3 rounded-lg border ${
                  version.version === currentVersion
                    ? 'bg-accent/50 border-accent'
                    : 'bg-card'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={version.version === currentVersion ? "default" : "outline"}>
                      Version {version.version}
                    </Badge>
                    {version.version === currentVersion && (
                      <Badge variant="secondary">Current</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {version.action === 'approved' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                    {version.action === 'rejected' && (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatDistanceToNow(new Date(version.timestamp), { addSuffix: true })}
                    </span>
                  </div>

                  {version.model_used && (
                    <div className="text-muted-foreground">
                      Model: <span className="text-foreground">{version.model_used}</span>
                    </div>
                  )}

                  {version.generation_time_ms && (
                    <div className="text-muted-foreground">
                      Time: <span className="text-foreground">
                        {(version.generation_time_ms / 1000).toFixed(1)}s
                      </span>
                    </div>
                  )}

                  {version.cost && (
                    <div className="text-muted-foreground">
                      Cost: <span className="text-foreground">
                        ${version.cost.toFixed(4)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
