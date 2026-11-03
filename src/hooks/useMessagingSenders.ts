import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// messaging_senders / contact_phone_backfill_jobs are not in the generated types yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TwilioConnection {
  id: string;
  key_hint: string | null;
  is_valid: boolean;
  last_validated: string | null;
  account_sid: string;
  account_name: string | null;
  default_country: string | null;
}

export interface MessagingSender {
  id: string;
  api_key_id: string | null;
  channel: "sms" | "whatsapp_business";
  address: string;
  address_type: "long_code" | "short_code" | "toll_free" | "alphanumeric" | "whatsapp";
  country: string | null;
  two_way: boolean;
  daily_new_contact_cap: number;
  wa_display_name: string | null;
  wa_quality_rating: string | null;
  wa_messaging_limit: string | null;
  status: "active" | "pending" | "disabled" | "error";
  status_detail: string | null;
}

export interface PhoneBackfillJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  processed: number;
  valid: number;
  invalid: number;
  no_country: number;
  error: string | null;
  finished_at: string | null;
}

export function useTwilioConnections() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["api-keys", "twilio", currentOrganization?.id],
    queryFn: async (): Promise<TwilioConnection[]> => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, key_hint, is_valid, last_validated, metadata")
        .eq("organization_id", currentOrganization!.id)
        .eq("provider", "twilio")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, string | null>;
        return {
        id: row.id,
        key_hint: row.key_hint,
        is_valid: row.is_valid,
        last_validated: row.last_validated,
        account_sid: meta.account_sid ?? "",
        account_name: meta.friendly_name ?? null,
        default_country: meta.default_country ?? null,
        };
      });
    },
    enabled: !!currentOrganization,
  });
}

export function useMessagingSenders() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["messaging-senders", currentOrganization?.id],
    queryFn: async (): Promise<MessagingSender[]> => {
      const { data, error } = await db
        .from("messaging_senders")
        .select("id, api_key_id, channel, address, address_type, country, two_way, daily_new_contact_cap, wa_display_name, wa_quality_rating, wa_messaging_limit, status, status_detail")
        .eq("organization_id", currentOrganization!.id)
        .order("channel", { ascending: true })
        .order("address", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentOrganization,
  });
}

export function usePhoneBackfillJob() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["phone-backfill-job", currentOrganization?.id],
    queryFn: async (): Promise<PhoneBackfillJob | null> => {
      const { data, error } = await db
        .from("contact_phone_backfill_jobs")
        .select("id, status, processed, valid, invalid, no_country, error, finished_at")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 5000 : false;
    },
  });
}

interface ImportResult {
  key_id?: string;
  account_name?: string;
  imported: number;
  sms: number;
  whatsapp: number;
  removed: number;
  warnings: string[];
}

async function invokeTwilioConnect(body: Record<string, unknown>): Promise<ImportResult> {
  const { data, error } = await supabase.functions.invoke("twilio-connect", { body });
  if (error) {
    // supabase-js hides the function's JSON error behind a generic message
    const context = (error as { context?: Response }).context;
    const detail = await Promise.resolve(context?.json?.()).catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function importSummary(data: ImportResult) {
  const parts = [`${data.sms} SMS sender${data.sms === 1 ? "" : "s"}`, `${data.whatsapp} WhatsApp sender${data.whatsapp === 1 ? "" : "s"}`];
  return parts.join(", ");
}

function useInvalidateMessaging() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["api-keys", "twilio"] });
    queryClient.invalidateQueries({ queryKey: ["messaging-senders"] });
    queryClient.invalidateQueries({ queryKey: ["phone-backfill-job"] });
  };
}

export function useConnectTwilio() {
  const { currentOrganization } = useAuth();
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (params: { accountSid: string; authToken: string; defaultCountry: string | null }) =>
      invokeTwilioConnect({
        action: "connect",
        organization_id: currentOrganization!.id,
        account_sid: params.accountSid,
        auth_token: params.authToken,
        default_country: params.defaultCountry,
      }),
    onSuccess: (data) => {
      invalidate();
      toast.success(`Connected ${data.account_name || "Twilio"}: ${importSummary(data)}`);
      for (const warning of data.warnings ?? []) toast.warning(warning);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSyncTwilio() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (keyId: string) => invokeTwilioConnect({ action: "sync", key_id: keyId }),
    onSuccess: (data) => {
      invalidate();
      toast.success(`Synced: ${importSummary(data)}`);
      for (const warning of data.warnings ?? []) toast.warning(warning);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDisconnectTwilio() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (keyId: string) => invokeTwilioConnect({ action: "disconnect", key_id: keyId }),
    onSuccess: () => {
      invalidate();
      toast.success("Twilio disconnected");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateMessagingSender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...changes }: { id: string; status?: "active" | "disabled"; daily_new_contact_cap?: number }) => {
      const { error } = await db.from("messaging_senders").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messaging-senders"] }),
    onError: (err: Error) => toast.error(err.message),
  });
}
