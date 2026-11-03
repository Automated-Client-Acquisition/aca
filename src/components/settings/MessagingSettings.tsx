import { TwilioSendersCard } from "@/components/settings/TwilioSendersCard";
import { WhatsAppTemplatesCard } from "@/components/settings/WhatsAppTemplatesCard";
import { useTwilioConnections } from "@/hooks/useMessagingSenders";
import { MessagingFunnelCard } from "@/components/campaigns/MessagingFunnelCard";
import { DbrCampaignCard } from "@/components/settings/DbrCampaignCard";

export function MessagingSettings() {
  const { data: connections = [] } = useTwilioConnections();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">SMS &amp; WhatsApp</h2>
        <p className="text-muted-foreground">
          Text and WhatsApp Business messages sent from your own Twilio account, for automations and the inbox.
        </p>
      </div>
      <MessagingFunnelCard title="Results across campaigns" />
      <TwilioSendersCard />
      <WhatsAppTemplatesCard connected={connections.length > 0} />
      <DbrCampaignCard connected={connections.length > 0} />
    </div>
  );
}
