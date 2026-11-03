import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Platform SVG Icons
const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

interface PlatformLimit {
  name: string;
  limit: number;
  color: string;
  bgColor: string;
  icon: () => JSX.Element;
}

const PLATFORM_LIMITS: PlatformLimit[] = [
  { 
    name: "X/Twitter", 
    limit: 280, 
    color: "text-slate-900 dark:text-slate-100",
    bgColor: "bg-slate-100 dark:bg-slate-800",
    icon: TwitterIcon
  },
  { 
    name: "Instagram", 
    limit: 2200, 
    color: "text-pink-600 dark:text-pink-400",
    bgColor: "bg-pink-50 dark:bg-pink-950/30",
    icon: InstagramIcon
  },
  { 
    name: "LinkedIn", 
    limit: 3000, 
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    icon: LinkedInIcon
  },
  { 
    name: "Facebook", 
    limit: 63206, 
    color: "text-blue-500 dark:text-blue-300",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    icon: FacebookIcon
  },
];

interface PlatformCharacterLimitsProps {
  characterCount: number;
}

export function PlatformCharacterLimits({ characterCount }: PlatformCharacterLimitsProps) {
  const compatiblePlatforms = PLATFORM_LIMITS.filter(p => characterCount <= p.limit);

  const getTooltipContent = (platform: PlatformLimit) => {
    const isCompatible = characterCount <= platform.limit;
    const remaining = platform.limit - characterCount;
    const overage = characterCount - platform.limit;

    if (isCompatible) {
      return (
        <div className="text-xs">
          <div className="font-medium mb-1">{platform.name}</div>
          <div className="text-muted-foreground">
            {characterCount.toLocaleString()} / {platform.limit.toLocaleString()} characters
          </div>
          <div className="text-green-400 mt-1">
            ✓ {remaining.toLocaleString()} characters remaining
          </div>
        </div>
      );
    } else {
      return (
        <div className="text-xs">
          <div className="font-medium mb-1">{platform.name}</div>
          <div className="text-muted-foreground">
            {characterCount.toLocaleString()} / {platform.limit.toLocaleString()} characters
          </div>
          <div className="text-red-400 mt-1">
            ⚠ {overage.toLocaleString()} characters over limit
          </div>
        </div>
      );
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground">Platform Compatibility</h4>
          <Badge variant="secondary" className="text-xs h-5">
            {characterCount.toLocaleString()}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {PLATFORM_LIMITS.map((platform) => {
            const isCompatible = characterCount <= platform.limit;
            const StatusIcon = isCompatible ? CheckCircle2 : XCircle;
            const Icon = platform.icon;

            return (
              <Tooltip key={platform.name}>
                <TooltipTrigger asChild>
                  <div
                    className={`rounded px-2 py-1.5 flex items-center justify-between text-xs transition-colors cursor-help ${
                      isCompatible 
                        ? `${platform.bgColor} ${platform.color}` 
                        : 'bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon />
                      <span className="font-medium truncate">{platform.name}</span>
                    </div>
                    <StatusIcon className={`h-3 w-3 flex-shrink-0 ${
                      isCompatible ? 'text-green-600' : 'text-red-600'
                    }`} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {getTooltipContent(platform)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground text-center pt-1">
          {compatiblePlatforms.length === PLATFORM_LIMITS.length ? (
            <span className="text-green-600 font-medium">✓ Compatible with all platforms</span>
          ) : compatiblePlatforms.length === 0 ? (
            <span className="text-red-600 font-medium">⚠ Exceeds all platform limits</span>
          ) : (
            <span>{compatiblePlatforms.length} / {PLATFORM_LIMITS.length} platforms</span>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
