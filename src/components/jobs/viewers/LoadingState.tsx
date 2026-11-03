import { Loader2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  message?: string;
  submessage?: string;
  className?: string;
}

export function LoadingState({ 
  message = "Generating content...", 
  submessage = "This may take a moment",
  className 
}: LoadingStateProps) {
  return (
    <Card className={cn(
      "relative overflow-hidden border-2",
      "bg-gradient-to-br from-primary/5 via-background to-secondary/5",
      "animate-gradient-shift bg-[length:200%_200%]",
      className
    )}>
      {/* Glassmorphism overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent backdrop-blur-sm" />
      
      {/* Animated background particles */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-primary rounded-full animate-float" />
        <div className="absolute top-3/4 right-1/4 w-2 h-2 bg-secondary rounded-full animate-float [animation-delay:0.5s]" />
        <div className="absolute top-1/2 right-1/3 w-1.5 h-1.5 bg-accent rounded-full animate-float [animation-delay:1s]" />
      </div>

      <CardContent className="relative flex flex-col items-center justify-center py-12 space-y-6">
        {/* Main icon with glow effect */}
        <div className="relative">
          <div className="absolute inset-0 animate-glow-pulse rounded-full" 
               style={{ '--glow-color': 'hsl(var(--primary))' } as React.CSSProperties} />
          <Loader2 className="relative h-16 w-16 animate-spin text-primary drop-shadow-lg" />
          <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-primary animate-pulse" />
        </div>

        {/* Text content */}
        <div className="text-center space-y-2">
          <p className="font-semibold text-xl tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            {message}
          </p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {submessage}
          </p>
        </div>
        
        {/* Animated progress dots */}
        <div className="flex gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s] shadow-lg shadow-primary/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s] shadow-lg shadow-primary/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-primary animate-bounce shadow-lg shadow-primary/50" />
        </div>

        {/* Shimmer effect at bottom */}
        <div className="w-full max-w-xs h-1 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-transparent via-primary to-transparent animate-shimmer"
            style={{ backgroundSize: '1000px 100%' }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
