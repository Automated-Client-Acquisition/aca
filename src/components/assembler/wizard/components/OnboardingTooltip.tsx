import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { HelpCircle, X, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingTooltipProps {
  /** Unique key to track if user has dismissed this tooltip */
  tipKey: string;
  /** The content to display in the tooltip */
  title: string;
  description: string;
  /** Optional additional tips as bullet points */
  tips?: string[];
  /** Children to wrap (if using as a wrapper) */
  children?: React.ReactNode;
  /** Whether to show the trigger icon inline or as overlay */
  variant?: "inline" | "overlay";
  /** Position of the popover */
  side?: "top" | "bottom" | "left" | "right";
  /** Additional className for the trigger */
  className?: string;
  /** Force show even if already dismissed (for testing) */
  forceShow?: boolean;
}

const STORAGE_KEY_PREFIX = "onboarding_seen_";

export function OnboardingTooltip({
  tipKey,
  title,
  description,
  tips,
  children,
  variant = "inline",
  side = "top",
  className,
  forceShow = false,
}: OnboardingTooltipProps) {
  const storageKey = `${STORAGE_KEY_PREFIX}${tipKey}`;
  const [hasSeen, setHasSeen] = useState(() => {
    if (forceShow) return false;
    return localStorage.getItem(storageKey) === "true";
  });
  const [isOpen, setIsOpen] = useState(false);

  const handleDismiss = () => {
    setIsOpen(false);
    setHasSeen(true);
    localStorage.setItem(storageKey, "true");
  };

  // If user has seen and it's not forced, render children without tooltip
  if (hasSeen && !forceShow && variant === "overlay") {
    return <>{children}</>;
  }

  const content = (
    <PopoverContent
      side={side}
      className="w-80 p-0 border-primary/30 shadow-lg"
      onInteractOutside={() => setIsOpen(false)}
    >
      <div className="bg-gradient-to-br from-primary/5 to-primary/10 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full bg-primary/10">
              <Lightbulb className="h-4 w-4 text-primary" />
            </div>
            <h4 className="font-semibold text-sm">{title}</h4>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 -mr-2 -mt-1"
            onClick={handleDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>

        {tips && tips.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1.5 pl-4">
            {tips.map((tip, idx) => (
              <li key={idx} className="list-disc">
                {tip}
              </li>
            ))}
          </ul>
        )}

        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs"
          onClick={handleDismiss}
        >
          Got it!
        </Button>
      </div>
    </PopoverContent>
  );

  if (variant === "overlay" && children) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        {content}
      </Popover>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors",
            !hasSeen && "animate-pulse text-primary",
            className
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      {content}
    </Popover>
  );
}

// Pre-configured tooltips for common library types
export const ONBOARDING_TIPS = {
  characters: {
    key: "library_characters_intro",
    title: "Character Selection",
    description:
      "Characters appear as the creator in your UGC content. They define who is presenting or demonstrating your product.",
    tips: [
      "Select reference images to maintain visual consistency",
      "Characters with voice selections will use that voice for audio",
      "Multiple characters in 'separate' mode creates one output per character",
    ],
  },
  products: {
    key: "library_products_intro",
    title: "Product Selection",
    description:
      "Products are featured items in your content. Select images to ensure consistent product placement across outputs.",
    tips: [
      "Product images guide visual placement in generated content",
      "Include multiple angles for better consistency",
    ],
  },
  brands: {
    key: "library_brands_intro",
    title: "Brand Voice Selection",
    description:
      "Brand voices define the tone, style, and communication approach for your content.",
    tips: [
      "Brand visuals guide overall aesthetic",
      "Tone settings affect text generation style",
    ],
  },
  referenceImages: {
    key: "reference_images_intro",
    title: "Reference Images",
    description:
      "Reference images guide AI generation to create visually consistent outputs across all your content.",
    tips: [
      "More images generally improve consistency",
      "Select images that best represent the desired look",
      "Images are used for style reference, not exact replication",
    ],
  },
  combinationMode: {
    key: "combination_mode_intro",
    title: "Combination Mode",
    description:
      "Control how selected elements are combined with your ideas to generate outputs.",
    tips: [
      "Combine: All elements together in each output",
      "Separate: One output per element (multiplies output count)",
    ],
  },
};

// Utility to reset all onboarding tips (for testing)
export function resetOnboardingTips() {
  Object.values(ONBOARDING_TIPS).forEach((tip) => {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tip.key}`);
  });
}
