import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  SettingsGroup,
  SettingsToggle,
  SettingsField,
} from "@/components/email/SequenceSettingsLayout";
import type { EmailSequenceSettings } from "@/types/email";

interface DeliverabilitySettingsProps {
  settings: EmailSequenceSettings;
  onChange: (update: Partial<EmailSequenceSettings>) => void;
}

export function DeliverabilitySettings({
  settings,
  onChange,
}: DeliverabilitySettingsProps) {
  const domainLimitId = useId();
  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Delivery rules"
        description="Choose how senders are matched and how often a company is contacted."
      >
        <SettingsToggle
          label="Send the first email as plain text"
          description="Remove HTML formatting from the opening email, including images, links and tracking pixels."
          checked={settings.first_email_text_only}
          onChange={(checked) => onChange({ first_email_text_only: checked })}
        />
        <SettingsToggle
          label="Match the recipient's email provider"
          description="Prefer a sender with the same provider as the recipient when one is available."
          checked={settings.provider_matching}
          onChange={(checked) => onChange({ provider_matching: checked })}
        />
        <SettingsField
          label="Daily limit per company"
          htmlFor={domainLimitId}
          description="Maximum emails to the same recipient company domain each day. Leave empty for no limit."
        >
          <div className="relative">
            <Input
              id={domainLimitId}
              type="number"
              inputMode="numeric"
              min={0}
              value={settings.limit_per_company_domain ?? ""}
              placeholder="No limit"
              className="pr-20"
              onChange={(event) => {
                const value = event.target.value;
                if (!value) onChange({ limit_per_company_domain: null });
                else if (Number.isInteger(Number(value)) && Number(value) >= 0)
                  onChange({ limit_per_company_domain: Number(value) });
              }}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              emails/day
            </span>
          </div>
        </SettingsField>
      </SettingsGroup>
      <details
        className="group rounded-xl border"
        open={settings.sisr_enabled || settings.hypersend_mode || undefined}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>
            Advanced delivery options{" "}
            <Badge variant="outline" className="ml-2 text-xs">
              {settings.sisr_enabled || settings.hypersend_mode
                ? "Enabled"
                : "Optional"}
            </Badge>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-180" />
        </summary>
        <div className="space-y-6 border-t p-4 sm:p-5">
          <SettingsToggle
            label="Server and IP rotation"
            description="Enable SISR (server and IP sharding and rotation) for this sequence."
            checked={settings.sisr_enabled}
            onChange={(checked) => onChange({ sisr_enabled: checked })}
          />
          <SettingsToggle
            label="Hypersend"
            badge={
              <Badge
                variant="outline"
                className="border-amber-500/30 text-amber-700 dark:text-amber-300"
              >
                Higher volume
              </Badge>
            }
            description="Bypass normal throttling. Intended for warmed mailboxes; high bounce rates can disable this mode."
            checked={settings.hypersend_mode}
            onChange={(checked) => onChange({ hypersend_mode: checked })}
          />
        </div>
      </details>
    </div>
  );
}
