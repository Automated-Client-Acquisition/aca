import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

// Validate hex color format
function isValidHex(hex: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
}

// Normalize hex to 6-digit format
function normalizeHex(hex: string): string {
  if (!hex.startsWith('#')) {
    hex = '#' + hex;
  }
  if (hex.length === 4) {
    // Convert #RGB to #RRGGBB
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toUpperCase();
}

export function ColorPicker({
  value,
  onChange,
  label,
  disabled = false,
  className,
}: ColorPickerProps) {
  const [inputValue, setInputValue] = React.useState(value || '#000000');
  const [isOpen, setIsOpen] = React.useState(false);

  // Sync input value when external value changes
  React.useEffect(() => {
    if (value && isValidHex(value)) {
      setInputValue(normalizeHex(value));
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;

    // Add # if missing
    if (newValue && !newValue.startsWith('#')) {
      newValue = '#' + newValue;
    }

    setInputValue(newValue);

    // Only update parent if valid
    if (isValidHex(newValue)) {
      onChange(normalizeHex(newValue));
    }
  };

  const handleColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.toUpperCase();
    setInputValue(newValue);
    onChange(newValue);
  };

  const handleBlur = () => {
    // On blur, reset to last valid value if current is invalid
    if (!isValidHex(inputValue)) {
      setInputValue(value || '#000000');
    }
  };

  const displayColor = isValidHex(inputValue) ? inputValue : (value || '#000000');

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label className="text-xs text-muted-foreground">{label}</Label>
      )}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              disabled && "cursor-not-allowed opacity-50"
            )}
            disabled={disabled}
          >
            <div
              className="h-5 w-5 rounded border border-border shadow-sm flex-shrink-0"
              style={{ backgroundColor: displayColor }}
            />
            <span className="font-mono text-xs">{displayColor}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex flex-col gap-3">
            {/* Native color picker */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={displayColor}
                onChange={handleColorPickerChange}
                className="h-8 w-8 cursor-pointer rounded border-0 p-0"
                disabled={disabled}
              />
              <span className="text-xs text-muted-foreground">Pick a color</span>
            </div>

            {/* Hex input */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Hex Value</Label>
              <Input
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleBlur}
                placeholder="#000000"
                className="h-8 font-mono text-xs"
                disabled={disabled}
              />
            </div>

            {/* Color preview */}
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-full rounded border shadow-inner"
                style={{ backgroundColor: displayColor }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Preset color swatches component for quick selection
interface ColorSwatchesProps {
  colors: string[];
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ColorSwatches({
  colors,
  value,
  onChange,
  disabled = false,
}: ColorSwatchesProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          disabled={disabled}
          className={cn(
            "h-6 w-6 rounded border shadow-sm transition-transform hover:scale-110",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === color && "ring-2 ring-primary ring-offset-1",
            disabled && "cursor-not-allowed opacity-50"
          )}
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  );
}
