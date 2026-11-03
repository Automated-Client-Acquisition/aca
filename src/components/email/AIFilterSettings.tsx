import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingsGroup,
  SettingsField,
} from "@/components/email/SequenceSettingsLayout";
import type { EmailSequenceSettings } from "@/types/email";

interface AIFilterSettingsProps {
  settings: Pick<
    EmailSequenceSettings,
    "ai_filter_unlikely_reply" | "ai_filter_hostile"
  >;
  onChange: (update: {
    ai_filter_unlikely_reply?: "skip" | "send";
    ai_filter_hostile?: "skip" | "send";
  }) => void;
}

export function AIFilterSettings({
  settings,
  onChange,
}: AIFilterSettingsProps) {
  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Before an email is sent"
        description="Choose what happens when AI flags a lead. Skipped leads appear in Filtered leads with a reason."
      >
        <SettingsField
          label="Unlikely to reply"
          description="Leads classified as a poor fit or unlikely to engage."
        >
          <Select
            value={settings.ai_filter_unlikely_reply}
            onValueChange={(value: "skip" | "send") =>
              onChange({ ai_filter_unlikely_reply: value })
            }
          >
            <SelectTrigger aria-label="Action for leads unlikely to reply">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip this lead</SelectItem>
              <SelectItem value="send">Continue sending</SelectItem>
            </SelectContent>
          </Select>
        </SettingsField>
        <SettingsField
          label="Negative or hostile intent"
          description="Leads classified as hostile based on their existing signals or replies."
        >
          <Select
            value={settings.ai_filter_hostile}
            onValueChange={(value: "skip" | "send") =>
              onChange({ ai_filter_hostile: value })
            }
          >
            <SelectTrigger aria-label="Action for hostile leads">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip this lead</SelectItem>
              <SelectItem value="send">Continue sending</SelectItem>
            </SelectContent>
          </Select>
        </SettingsField>
      </SettingsGroup>
      <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        <Badge variant="outline" className="mr-2">
          AI classification
        </Badge>
        These rules apply alongside the sequence's existing enrollment and
        suppression checks.
      </div>
    </div>
  );
}
