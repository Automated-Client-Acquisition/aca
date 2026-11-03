import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExportButtonProps {
  onExport: () => void;
  isExporting: boolean;
  progress: number;
  error: string | null;
  disabled?: boolean;
  className?: string;
}

export function ExportButton({
  onExport,
  isExporting,
  progress,
  error,
  disabled = false,
  className,
}: ExportButtonProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Button
        variant="cta"
        onClick={onExport}
        disabled={disabled || isExporting}
        className="w-full gap-2"
      >
        {isExporting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Rendering... {progress}%
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Export Video
          </>
        )}
      </Button>

      {/* Progress bar during export */}
      {isExporting && (
        <div className="space-y-1">
          <Progress value={progress} className="h-1.5" />
          <p className="text-[10px] text-muted-foreground text-center">
            {progress < 10
              ? 'Starting render...'
              : progress < 90
                ? 'Rendering video on server...'
                : 'Finalizing...'}
          </p>
        </div>
      )}

      {/* Error display */}
      {error && !isExporting && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
