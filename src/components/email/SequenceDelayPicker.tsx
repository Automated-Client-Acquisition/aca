import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DELAY_PRESETS, formatDelayHours } from "@/lib/email-sequence-utils";

interface SequenceDelayPickerProps {
  value: number;
  onChange: (hours: number) => void;
  className?: string;
}

export function SequenceDelayPicker({
  value,
  onChange,
  className,
}: SequenceDelayPickerProps) {
  const isCustom = !DELAY_PRESETS.some((p) => p.hours === value);

  return (
    <div className={cn("space-y-3", className)}>
      <Label className="text-xs text-muted-foreground">Wait duration</Label>
      <div className="flex flex-wrap gap-2">
        {DELAY_PRESETS.map((preset) => (
          <button
            key={preset.hours}
            type="button"
            onClick={() => onChange(preset.hours)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full border transition-all",
              value === preset.hours
                ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/40 shadow-sm"
                : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">
          Custom:
        </Label>
        <Input
          type="number"
          min={1}
          max={720}
          value={isCustom ? value : ""}
          placeholder="Hours"
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v) && v > 0) onChange(v);
          }}
          className="h-8 w-24 text-xs"
        />
        <span className="text-xs text-muted-foreground">hours</span>
        {value > 0 && (
          <span className="text-xs font-medium ml-auto">
            = {formatDelayHours(value)}
          </span>
        )}
      </div>
    </div>
  );
}
