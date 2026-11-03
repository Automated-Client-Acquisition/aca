import { useId } from "react";
import { CalendarClock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ResearchScheduleDraft } from "@/lib/research-schedule";

interface Props {
  value: ResearchScheduleDraft;
  onChange: (value: ResearchScheduleDraft) => void;
  disabled?: boolean;
  alwaysEnabled?: boolean;
}

export function ResearchScheduleFields({ value, onChange, disabled, alwaysEnabled = false }: Props) {
  const id = useId();
  const patch = (changes: Partial<ResearchScheduleDraft>) => onChange({ ...value, ...changes });
  const intervals = { hourly: "one hour", daily: "one day", weekly: "one week" };

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
      {!alwaysEnabled && <div className="flex items-start gap-3">
        <Checkbox id={`${id}-enabled`} checked={value.enabled} disabled={disabled}
          onCheckedChange={(checked) => patch({ enabled: checked === true })} />
        <div className="space-y-1 min-w-0">
          <Label htmlFor={`${id}-enabled`} className="flex items-center gap-2 cursor-pointer">
            <CalendarClock className="h-4 w-4 shrink-0" /> Schedule automatic scraping
          </Label>
          <p className="text-sm text-muted-foreground">Keep this source up to date with recurring scrapes.</p>
        </div>
      </div>}
      {(alwaysEnabled || value.enabled) && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-frequency`}>Frequency</Label>
              <Select value={value.frequency} disabled={disabled}
                onValueChange={(frequency: ResearchScheduleDraft["frequency"]) => patch({ frequency })}>
                <SelectTrigger id={`${id}-frequency`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Every hour</SelectItem>
                  <SelectItem value="daily">Every day</SelectItem>
                  <SelectItem value="weekly">Every week</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-items`}>Posts per scheduled run</Label>
              <Input id={`${id}-items`} type="number" min={1} max={1000} step={1} required
                value={value.maxItems} disabled={disabled} onChange={(e) => patch({ maxItems: e.target.value })} />
              <p className="text-xs text-muted-foreground">1–1,000 posts per run</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id={`${id}-pause`} checked={value.autoPause} disabled={disabled}
              onCheckedChange={(checked) => patch({ autoPause: checked === true })} />
            <div className="space-y-1">
              <Label htmlFor={`${id}-pause`} className="cursor-pointer">Auto-pause after failures</Label>
              <p className="text-xs text-muted-foreground">Pause after 3 consecutive failed runs.</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">First scheduled scrape: {intervals[value.frequency]} after saving.{!alwaysEnabled && " You can also scrape immediately below."}</p>
        </>
      )}
    </div>
  );
}
