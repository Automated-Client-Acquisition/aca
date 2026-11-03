import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

interface WaitingStateProps {
  message?: string;
  submessage?: string;
  className?: string;
}

export function WaitingState({ 
  message = "Queued for generation", 
  submessage = "Waiting for previous stages to complete",
  className 
}: WaitingStateProps) {
  return (
    <Card className={`border-dashed border-muted-foreground/30 bg-muted/10 ${className}`}>
      <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="rounded-full bg-muted p-4">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center space-y-1">
          <p className="font-medium text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground/70">{submessage}</p>
        </div>
      </CardContent>
    </Card>
  );
}
