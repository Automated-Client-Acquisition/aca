import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface LocationData {
  city: string | null;
  state: string | null;
  country: string | null;
}

interface EditableLocationCellProps {
  city: string | null;
  state: string | null;
  country: string | null;
  onSave: (location: LocationData) => Promise<void>;
  className?: string;
}

export function EditableLocationCell({
  city,
  state,
  country,
  onSave,
  className,
}: EditableLocationCellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localCity, setLocalCity] = useState(city || "");
  const [localState, setLocalState] = useState(state || "");
  const [localCountry, setLocalCountry] = useState(country || "");

  const handleOpen = (open: boolean) => {
    if (open) {
      setLocalCity(city || "");
      setLocalState(state || "");
      setLocalCountry(country || "");
    }
    setIsOpen(open);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        city: localCity.trim() || null,
        state: localState.trim() || null,
        country: localCountry.trim() || null,
      });
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const formatLocation = () => {
    const parts = [city, state, country].filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 3) return `${city}, ${state}`;
    return parts.join(", ");
  };

  // Full location for tooltip
  const fullLocation = [city, state, country].filter(Boolean).join(", ");

  const displayLocation = formatLocation();

  // Only show tooltip if there's content that might be truncated
  const shouldShowTooltip = displayLocation && fullLocation.length > 20;

  const triggerContent = (
    <div
      className={cn(
        "group flex items-start gap-1 cursor-pointer rounded px-1 -mx-1 hover:bg-muted/50 min-h-[28px]",
        className
      )}
    >
      {displayLocation ? (
        <span className="flex items-start gap-1 break-words line-clamp-2">
          <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
          {displayLocation}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
    </div>
  );

  return (
    <Popover open={isOpen} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        {shouldShowTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>{triggerContent}</TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px]">
              <p className="break-words">{fullLocation}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          triggerContent
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">Location</div>

          <div className="space-y-2">
            <div>
              <Label htmlFor="city" className="text-xs">City</Label>
              <Input
                id="city"
                placeholder="City"
                value={localCity}
                onChange={(e) => setLocalCity(e.target.value)}
                className="h-8 text-sm mt-1"
              />
            </div>
            <div>
              <Label htmlFor="state" className="text-xs">State / Region</Label>
              <Input
                id="state"
                placeholder="State or Region"
                value={localState}
                onChange={(e) => setLocalState(e.target.value)}
                className="h-8 text-sm mt-1"
              />
            </div>
            <div>
              <Label htmlFor="country" className="text-xs">Country</Label>
              <Input
                id="country"
                placeholder="Country"
                value={localCountry}
                onChange={(e) => setLocalCountry(e.target.value)}
                className="h-8 text-sm mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
