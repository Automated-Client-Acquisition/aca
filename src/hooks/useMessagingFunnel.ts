import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MessagingFunnelRow {
  campaign_id: string | null;
  channel: "sms" | "whatsapp_business";
  sent: number;
  delivered: number;
  failed: number;
  replied: number;
  positive: number;
  booked: number;
  out_of_office: number;
  auto_reply: number;
  opted_out: number;
}

/**
 * SMS / WhatsApp Business campaign funnel (messaging_funnel RPC), counted in leads:
 * sent → delivered → replied → positive → booked. Pass a campaign id for one campaign.
 */
export function useMessagingFunnel(campaignId?: string, days = 90) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["messaging-funnel", currentOrganization?.id, campaignId ?? "all", days],
    queryFn: async (): Promise<MessagingFunnelRow[]> => {
      // messaging_funnel is not in the generated types yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("messaging_funnel", {
        p_org_id: currentOrganization!.id,
        p_campaign_id: campaignId ?? null,
        p_since: new Date(Date.now() - days * 86_400_000).toISOString(),
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentOrganization,
  });
}

/** Sum rows (e.g. all campaigns of a channel). */
export function sumFunnel(rows: MessagingFunnelRow[]): Omit<MessagingFunnelRow, "campaign_id" | "channel"> {
  const zero = { sent: 0, delivered: 0, failed: 0, replied: 0, positive: 0, booked: 0, out_of_office: 0, auto_reply: 0, opted_out: 0 };
  return rows.reduce((acc, r) => {
    for (const k of Object.keys(zero) as (keyof typeof zero)[]) acc[k] += r[k] || 0;
    return acc;
  }, { ...zero });
}
