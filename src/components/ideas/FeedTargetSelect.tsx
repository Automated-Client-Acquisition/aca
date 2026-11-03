import { useEffect } from "react";
import { Zap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFeedOptions } from "@/hooks/useIdeaFeeds";
import { NO_FEED } from "@/lib/idea-feeds";

interface FeedTargetSelectProps {
  value: string;
  onChange: (key: string) => void;
  /** Preselect this autopilot's first feed when the value is still unset. */
  autopilotId?: string | null;
  id?: string;
}

/** "Which autopilot should post these?" for dialogs that create ideas. Hidden when there's nothing to pick. */
export function FeedTargetSelect({ value, onChange, autopilotId, id = "feed-target" }: FeedTargetSelectProps) {
  const { options, anyIdea } = useFeedOptions();

  useEffect(() => {
    if (value !== NO_FEED || !autopilotId) return;
    const preferred = options.find((o) => o.target.autopilotId === autopilotId);
    if (preferred) onChange(preferred.target.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilotId, options.length]);

  if (options.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        Use in an autopilot
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FEED}>Not yet, just save the ideas</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.target.key} value={o.target.key}>
              {o.label}
              {o.fuel.status !== "active" ? " (paused)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {anyIdea.length > 0
          ? `${anyIdea.map((f) => f.name).join(", ")} ${anyIdea.length === 1 ? "uses" : "use"} every idea anyway.`
          : "The autopilot posts them before ideas it has already used."}
      </p>
    </div>
  );
}
