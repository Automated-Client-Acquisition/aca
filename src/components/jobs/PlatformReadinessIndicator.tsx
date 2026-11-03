import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getPlatformReadiness, PlatformReadiness } from '@/lib/platformRequirements';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface PlatformReadinessIndicatorProps {
  outputData: any;
  mode?: 'compact' | 'expanded';
  className?: string;
}

export function PlatformReadinessIndicator({ 
  outputData, 
  mode = 'compact',
  className 
}: PlatformReadinessIndicatorProps) {
  const platforms = getPlatformReadiness(outputData);
  const readyPlatforms = platforms.filter(p => p.isReady);
  const notReadyPlatforms = platforms.filter(p => !p.isReady);

  if (mode === 'compact') {
    return (
      <TooltipProvider>
        <div className={cn("flex items-center gap-1", className)}>
          {platforms.map((platform) => {
            const Icon = platform.icon;
            return (
              <Tooltip key={platform.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded text-xs font-medium transition-colors",
                      platform.isReady 
                        ? "bg-green-500/10 text-green-600 dark:text-green-400" 
                        : "bg-muted text-muted-foreground opacity-40"
                    )}
                    style={platform.isReady ? { 
                      backgroundColor: `${platform.color}15`,
                      color: platform.color 
                    } : undefined}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <div className="font-semibold">{platform.name}</div>
                  {platform.isReady ? (
                    <div className="text-green-600 dark:text-green-400">✓ Ready to publish</div>
                  ) : (
                    <div className="text-amber-600 dark:text-amber-400">
                      Needs: {platform.missingRequirements.join(', ')}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
        </div>
      </TooltipProvider>
    );
  }

  // Expanded mode
  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-xs font-medium text-muted-foreground">Platform Compatibility</div>
      <div className="flex flex-wrap gap-2">
        {readyPlatforms.map((platform) => {
          const Icon = platform.icon;
          return (
            <Badge
              key={platform.id}
              variant="outline"
              className="gap-1.5 border-0 font-medium"
              style={{ 
                backgroundColor: `${platform.color}15`,
                color: platform.color 
              }}
            >
              <CheckCircle2 className="h-3 w-3" />
              <span className="flex items-center gap-1">
                <Icon className="w-3 h-3" />
                <span>{platform.name}</span>
              </span>
            </Badge>
          );
        })}
        {notReadyPlatforms.map((platform) => {
          const Icon = platform.icon;
          return (
            <Badge
              key={platform.id}
              variant="outline"
              className="gap-1.5 bg-muted/50 text-muted-foreground border-0"
            >
              <AlertCircle className="h-3 w-3" />
              <span className="flex items-center gap-1">
                <Icon className="w-3 h-3 opacity-50" />
                <span>{platform.name}</span>
              </span>
              <span className="text-[10px] opacity-70">
                (needs {platform.missingRequirements.join(', ')})
              </span>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
