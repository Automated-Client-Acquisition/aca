import type { ComponentPropsWithoutRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

type CampaignSetupSliderProps = ComponentPropsWithoutRef<
  typeof SliderPrimitive.Root
> & { "aria-label": string };

// The shared Slider does not forward labels to its interactive thumb. Keep
// this labeled, single-value control scoped to campaign setup.
export function CampaignSetupSlider({
  "aria-label": label,
  "aria-describedby": describedBy,
  className,
  ...props
}: CampaignSetupSliderProps) {
  return (
    <SliderPrimitive.Root
      {...props}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-foreground/60" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-describedby={describedBy}
        className="block h-5 w-5 rounded-full border-2 border-foreground/50 bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  );
}
