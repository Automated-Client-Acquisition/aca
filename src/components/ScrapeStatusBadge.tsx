import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

type ScrapeStatus = 'RUNNING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'IDLE';

interface ScrapeStatusBadgeProps {
  status: ScrapeStatus;
  animated?: boolean;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ScrapeStatusBadge({ 
  status, 
  animated = true, 
  showLabel = true, 
  size = 'md',
  className 
}: ScrapeStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'RUNNING':
      case 'PROCESSING':
        return {
          icon: Loader2,
          label: status === 'RUNNING' ? 'Scraping' : 'Processing',
          className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
          iconClassName: animated ? 'animate-spin' : ''
        };
      case 'SUCCEEDED':
        return {
          icon: CheckCircle2,
          label: 'Success',
          className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
          iconClassName: ''
        };
      case 'FAILED':
        return {
          icon: XCircle,
          label: 'Failed',
          className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
          iconClassName: ''
        };
      default:
        return {
          icon: Circle,
          label: 'Idle',
          className: 'bg-muted text-muted-foreground border-border',
          iconClassName: ''
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'text-xs h-5',
    md: 'text-xs h-6',
    lg: 'text-sm h-7'
  };

  const iconSizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4'
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        config.className,
        sizeClasses[size],
        animated && (status === 'RUNNING' || status === 'PROCESSING') && 'scrape-active',
        className
      )}
    >
      <Icon className={cn(iconSizeClasses[size], config.iconClassName, showLabel && 'mr-1.5')} />
      {showLabel && config.label}
    </Badge>
  );
}
