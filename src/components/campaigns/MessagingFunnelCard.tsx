import { MessageSquareText } from "lucide-react";
import { sumFunnel, useMessagingFunnel, type MessagingFunnelRow } from "@/hooks/useMessagingFunnel";

const CHANNEL_LABELS: Record<MessagingFunnelRow["channel"], string> = {
  sms: "SMS",
  whatsapp_business: "WhatsApp Business",
};

/** "12% of delivered"; below the sample floor the rate is hidden (1/1 = 100% means nothing). */
function rate(part: number, base: number, floor: number): string | null {
  if (base < floor || base === 0) return null;
  return `${Math.round((part / base) * 100)}%`;
}

function Step({ label, value, rateText, base }: { label: string; value: number; rateText?: string | null; base?: string }) {
  return (
    <div className="flex-1 min-w-[7rem] rounded-lg border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {base && (
        <div className="text-xs text-muted-foreground">{rateText ? `${rateText} of ${base}` : `of ${base}`}</div>
      )}
    </div>
  );
}

function FunnelRow({ title, f }: { title: string; f: ReturnType<typeof sumFunnel> }) {
  const segregated = [
    f.out_of_office > 0 ? `${f.out_of_office} out of office` : null,
    f.auto_reply > 0 ? `${f.auto_reply} auto-replies` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-2">
        <Step label="Sent" value={f.sent} />
        <Step label="Delivered" value={f.delivered} rateText={rate(f.delivered, f.sent, 1)} base="sent" />
        <Step label="Replied" value={f.replied} rateText={rate(f.replied, f.delivered, 1)} base="delivered" />
        <Step label="Positive" value={f.positive} rateText={rate(f.positive, f.replied, 5)} base="replies" />
        <Step label="Booked" value={f.booked} rateText={rate(f.booked, f.positive, 3)} base="positive" />
      </div>
      <p className="text-xs text-muted-foreground">
        {[
          segregated.length > 0 ? `${segregated.join(" · ")}, kept out of replies` : null,
          f.opted_out > 0 ? `${f.opted_out} opted out` : null,
          f.failed > 0 ? `${f.failed} failed to send` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

/**
 * Sent → delivered → replied → positive → booked for SMS and WhatsApp Business
 * campaign steps, in leads, with step conversions. Renders nothing until a
 * Twilio campaign send exists.
 */
export function MessagingFunnelCard({ campaignId, title = "SMS & WhatsApp funnel" }: { campaignId?: string; title?: string }) {
  const { data: rows = [], isLoading } = useMessagingFunnel(campaignId);
  if (isLoading || rows.length === 0) return null;

  const channels = (["whatsapp_business", "sms"] as const).filter((ch) => rows.some((r) => r.channel === ch));
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">
          Last 90 days, counted in leads. Each rate is a step conversion from the step before.
        </p>
      </div>
      {channels.map((ch) => (
        <FunnelRow key={ch} title={CHANNEL_LABELS[ch]} f={sumFunnel(rows.filter((r) => r.channel === ch))} />
      ))}
    </div>
  );
}
