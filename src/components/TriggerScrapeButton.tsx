import { Button } from "@/components/ui/button";
import { PlayCircle, Loader2 } from "lucide-react";
import { useTriggerScrape } from "@/hooks/useTriggerScrape";

interface TriggerScrapeButtonProps {
  type: 'creator' | 'search_term';
  targetId: string;
  targetName: string;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'cta';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function TriggerScrapeButton({
  type,
  targetId,
  targetName,
  disabled = false,
  variant = 'cta',
  size = 'sm',
  className = ''
}: TriggerScrapeButtonProps) {
  const { mutate: triggerScrape, isPending } = useTriggerScrape();

  const handleTrigger = () => {
    triggerScrape({
      type,
      targetId,
      targetName,
      options: { maxItems: 100, forceRefresh: true }
    });
  };

  return (
    <Button
      onClick={handleTrigger}
      disabled={disabled || isPending}
      variant={variant}
      size={size}
      className={className}
    >
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Scraping...
        </>
      ) : (
        <>
          <PlayCircle className="mr-2 h-4 w-4" />
          Scrape Now
        </>
      )}
    </Button>
  );
}
