import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowRight, Layers, ArrowLeft, ArrowUp, ZoomIn, Scissors, X } from 'lucide-react';
import type { TransitionType } from '@/hooks/useVideoEditor';

interface TransitionPickerProps {
  /** Currently selected transition type, or null if none */
  value: TransitionType | null;
  /** Called when a transition type is selected */
  onChange: (type: TransitionType) => void;
  /** Called to remove the transition entirely */
  onRemove?: () => void;
  /** Label context, e.g. "Between Clip 1 and Clip 2" */
  label?: string;
  /** Compact layout (inline row instead of grid) */
  compact?: boolean;
}

const TRANSITION_OPTIONS: {
  type: TransitionType;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    type: 'cut',
    label: 'Cut',
    description: 'Hard cut, no effect',
    icon: Scissors,
  },
  {
    type: 'crossfade',
    label: 'Crossfade',
    description: 'Smooth opacity blend',
    icon: Layers,
  },
  {
    type: 'slide_left',
    label: 'Slide Left',
    description: 'New clip slides in from right',
    icon: ArrowLeft,
  },
  {
    type: 'slide_up',
    label: 'Slide Up',
    description: 'New clip slides up from bottom',
    icon: ArrowUp,
  },
  {
    type: 'zoom',
    label: 'Zoom',
    description: 'Zoom into the new clip',
    icon: ZoomIn,
  },
];

export function TransitionPicker({
  value,
  onChange,
  onRemove,
  label,
  compact = false,
}: TransitionPickerProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {label && (
          <span className="text-[10px] text-muted-foreground mr-1">{label}</span>
        )}
        {TRANSITION_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = value === opt.type;
          return (
            <Button
              key={opt.type}
              variant={isSelected ? 'default' : 'ghost'}
              size="icon"
              className={cn(
                'h-7 w-7',
                isSelected && 'bg-cta text-cta-foreground hover:bg-cta-hover',
              )}
              onClick={() => onChange(opt.type)}
              title={opt.label}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          );
        })}
        {onRemove && value && value !== 'cut' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            title="Remove transition"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5" />
          <span>{label}</span>
        </div>
      )}

      <div className="grid grid-cols-5 gap-1.5">
        {TRANSITION_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = value === opt.type;

          return (
            <button
              key={opt.type}
              onClick={() => onChange(opt.type)}
              className={cn(
                'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all',
                isSelected
                  ? 'border-cta bg-cta/10 dark:bg-cta/5'
                  : 'border-border bg-background hover:border-cta/50 hover:bg-muted/30',
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
                  isSelected ? 'bg-cta/20 text-cta' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  isSelected ? 'text-cta' : 'text-muted-foreground',
                )}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      {value && (
        <p className="text-[10px] text-muted-foreground">
          {TRANSITION_OPTIONS.find((o) => o.type === value)?.description}
        </p>
      )}
    </div>
  );
}
