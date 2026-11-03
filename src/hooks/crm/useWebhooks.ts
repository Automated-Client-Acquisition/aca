import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

/**
 * Every event here is emitted by a live database trigger. `lead_captured` used
 * to be in this list and nothing ever fired it — a contact captured from a
 * campaign arrives as `contact_created` carrying `source` and
 * `source_campaign_id`, which is the same information.
 */
export type WebhookEventType =
  | "message_received"
  | "message_sent"
  | "stage_changed"
  | "tag_added"
  | "tag_removed"
  | "score_changed"
  | "sequence_completed"
  | "handoff_requested"
  | "contact_created"
  | "contact_updated"
  | "lead_replied"
  | "list_member_added"
  | "list_member_removed"
  | "signal_lead_added"
  | "campaign_entry_decided";

export interface WebhookSettings {
  id: string;
  organization_id: string;
  default_webhook_url: string | null;
  event_webhooks: Record<string, string>;
  enabled_events: WebhookEventType[];
  webhook_secret: string | null;
  auth_header_name: string;
  auth_header_value: string | null;
  max_retries: number;
  retry_delay_seconds: number;
  max_events_per_minute: number;
  is_active: boolean;
  last_event_at: string | null;
  total_events_sent: number;
  total_events_failed: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventLog {
  id: string;
  organization_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  webhook_url: string;
  status: "pending" | "success" | "failed" | "retrying";
  attempt_count: number;
  max_attempts: number;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  scheduled_at: string;
  sent_at: string | null;
  completed_at: string | null;
  next_retry_at: string | null;
  created_at: string;
}

export interface CreateWebhookSettingsInput {
  default_webhook_url?: string;
  event_webhooks?: Record<string, string>;
  enabled_events?: WebhookEventType[];
  webhook_secret?: string;
  auth_header_name?: string;
  auth_header_value?: string;
  max_retries?: number;
  retry_delay_seconds?: number;
  is_active?: boolean;
}

export interface UpdateWebhookSettingsInput extends CreateWebhookSettingsInput {}

// ============================================================================
// Query Keys
// ============================================================================

export const webhookKeys = {
  all: ["webhooks"] as const,
  settings: (orgId?: string) => [...webhookKeys.all, "settings", orgId] as const,
  logs: (orgId?: string, filters?: { status?: string; eventType?: string }) =>
    [...webhookKeys.all, "logs", orgId, filters] as const,
  stats: (orgId?: string) => [...webhookKeys.all, "stats", orgId] as const,
  subscriptions: (orgId?: string) => [...webhookKeys.all, "subscriptions", orgId] as const,
};

// ============================================================================
// Hooks - API subscriptions
// ============================================================================

/**
 * Delivery targets registered through `POST /v1/webhooks` rather than through
 * this settings page — the n8n node creates one per active workflow. Shown here
 * so a webhook nobody remembers setting up is still visible and revocable.
 */
export interface WebhookSubscription {
  id: string;
  target_url: string;
  events: WebhookEventType[];
  /**
   * Narrows delivery, applied by ACA at enqueue time rather than by the
   * receiving app. Only `list_ids` exists, and it only affects the two
   * list_member_* events. Absent or empty means every list.
   */
  filters: { list_ids?: string[] } | null;
  is_active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export function useWebhookSubscriptions() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: webhookKeys.subscriptions(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error("No organization selected");

      // `secret` is deliberately not selected — it belongs to whatever holds the
      // API token, and there is nothing to do with it on this page.
      const { data, error } = await supabase
        .from("webhook_subscriptions")
        .select("id, target_url, events, filters, is_active, source, created_at, updated_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as WebhookSubscription[];
    },
    enabled: !!orgId,
  });
}

/**
 * Names for the lead lists a subscription filters on.
 *
 * Deliberately not `useLeadLists()`: that reads every column of every list in
 * the organization, and this page needs two columns for the handful of IDs
 * actually referenced. A filter names at most 50 lists, so one `in()` is enough.
 */
export function useLeadListNames(listIds: string[]) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;
  const ids = [...new Set(listIds)].sort();

  return useQuery({
    queryKey: ["lead-list-names", orgId, ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_lists")
        .select("id, name")
        .eq("organization_id", orgId!)
        .in("id", ids);

      if (error) throw error;
      return Object.fromEntries((data || []).map((list) => [list.id, list.name])) as Record<
        string,
        string
      >;
    },
    enabled: !!orgId && ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeleteWebhookSubscription() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("webhook_subscriptions")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId!);

      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.subscriptions(orgId) });
      toast.success("Webhook subscription removed");
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove subscription: ${error.message}`);
    },
  });
}

// ============================================================================
// Hooks - Settings
// ============================================================================

export function useWebhookSettings() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: webhookKeys.settings(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("organization_webhook_settings")
        .select("*")
        .eq("organization_id", orgId)
        .maybeSingle();

      if (error) throw error;
      return data as WebhookSettings | null;
    },
    enabled: !!orgId,
  });
}

export function useCreateWebhookSettings() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async (input: CreateWebhookSettingsInput) => {
      if (!orgId) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("organization_webhook_settings")
        .insert({
          organization_id: orgId,
          default_webhook_url: input.default_webhook_url,
          event_webhooks: input.event_webhooks || {},
          enabled_events: input.enabled_events || [],
          webhook_secret: input.webhook_secret,
          auth_header_name: input.auth_header_name || "Authorization",
          auth_header_value: input.auth_header_value,
          max_retries: input.max_retries ?? 3,
          retry_delay_seconds: input.retry_delay_seconds ?? 60,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as WebhookSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.settings(orgId) });
      toast.success("Webhook settings created");
    },
    onError: (error) => {
      console.error("Failed to create webhook settings:", error);
      toast.error("Failed to create webhook settings");
    },
  });
}

export function useUpdateWebhookSettings() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async ({
      settingsId,
      input,
    }: {
      settingsId: string;
      input: UpdateWebhookSettingsInput;
    }) => {
      const { data, error } = await supabase
        .from("organization_webhook_settings")
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq("id", settingsId)
        .select()
        .single();

      if (error) throw error;
      return data as WebhookSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.settings(orgId) });
      toast.success("Webhook settings updated");
    },
    onError: (error) => {
      console.error("Failed to update webhook settings:", error);
      toast.error("Failed to update webhook settings");
    },
  });
}

export function useToggleWebhookActive() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async ({
      settingsId,
      isActive,
    }: {
      settingsId: string;
      isActive: boolean;
    }) => {
      const { data, error } = await supabase
        .from("organization_webhook_settings")
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", settingsId)
        .select()
        .single();

      if (error) throw error;
      return data as WebhookSettings;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.settings(orgId) });
      toast.success(`Webhooks ${data.is_active ? "enabled" : "disabled"}`);
    },
    onError: (error) => {
      console.error("Failed to toggle webhooks:", error);
      toast.error("Failed to toggle webhooks");
    },
  });
}

export function useGenerateWebhookSecret() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async (settingsId: string) => {
      // Generate a secure random secret
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      const secret = Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { data, error } = await supabase
        .from("organization_webhook_settings")
        .update({
          webhook_secret: secret,
          updated_at: new Date().toISOString(),
        })
        .eq("id", settingsId)
        .select()
        .single();

      if (error) throw error;
      return data as WebhookSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.settings(orgId) });
      toast.success("New webhook secret generated");
    },
    onError: (error) => {
      console.error("Failed to generate secret:", error);
      toast.error("Failed to generate secret");
    },
  });
}

// ============================================================================
// Hooks - Event Logs
// ============================================================================

interface UseWebhookLogsOptions {
  status?: "pending" | "success" | "failed" | "retrying";
  eventType?: WebhookEventType;
  limit?: number;
}

export function useWebhookLogs(options: UseWebhookLogsOptions = {}) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: webhookKeys.logs(orgId, { status: options.status, eventType: options.eventType }),
    queryFn: async () => {
      if (!orgId) throw new Error("No organization selected");

      let query = supabase
        .from("webhook_event_log")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(options.limit || 50);

      if (options.status) {
        query = query.eq("status", options.status);
      }

      if (options.eventType) {
        query = query.eq("event_type", options.eventType);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as WebhookEventLog[];
    },
    enabled: !!orgId,
  });
}

export function useRetryWebhook() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await supabase.functions.invoke("webhook-retry", {
        body: { eventId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.logs(orgId) });
      toast.success("Webhook queued for retry");
    },
    onError: (error) => {
      console.error("Failed to retry webhook:", error);
      toast.error("Failed to retry webhook");
    },
  });
}

// ============================================================================
// Hooks - Stats
// ============================================================================

export function useWebhookStats() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: webhookKeys.stats(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error("No organization selected");

      // Get counts by status
      const { data: logs, error } = await supabase
        .from("webhook_event_log")
        .select("status, created_at, webhook_url, error_message")
        .eq("organization_id", orgId)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      const rows = logs || [];

      // Per-destination health, because a total failure count cannot tell you
      // WHICH endpoint is broken — and with several destinations configured, one
      // dead URL otherwise reads as "webhooks are failing".
      const byDestination = new Map<string, DestinationHealth>();
      for (const row of rows) {
        const url = String(row.webhook_url);
        const entry = byDestination.get(url) ?? {
          url,
          total: 0,
          success: 0,
          failed: 0,
          pending: 0,
          retrying: 0,
          lastError: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        };
        const at = String(row.created_at);
        entry.total += 1;
        if (row.status === "success") {
          entry.success += 1;
          if (!entry.lastSuccessAt || at > entry.lastSuccessAt) entry.lastSuccessAt = at;
        }
        if (row.status === "failed") {
          entry.failed += 1;
          // The rows arrive unordered, so "last error" has to be the newest
          // failure's message, not whichever one the scan happened to see first.
          if (!entry.lastFailureAt || at > entry.lastFailureAt) {
            entry.lastFailureAt = at;
            if (row.error_message) entry.lastError = String(row.error_message);
          }
        }
        if (row.status === "pending") entry.pending += 1;
        if (row.status === "retrying") entry.retrying += 1;
        byDestination.set(url, entry);
      }

      return {
        total: rows.length,
        pending: rows.filter((l) => l.status === "pending").length,
        success: rows.filter((l) => l.status === "success").length,
        failed: rows.filter((l) => l.status === "failed").length,
        retrying: rows.filter((l) => l.status === "retrying").length,
        destinations: [...byDestination.values()].sort((a, b) => b.total - a.total),
      };
    },
    enabled: !!orgId,
  });
}

export interface DestinationHealth {
  url: string;
  total: number;
  success: number;
  failed: number;
  pending: number;
  retrying: number;
  lastError: string | null;
  /** Newest delivery of each outcome, so status can reflect now, not the window. */
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

/** Has this destination delivered successfully since the last time it failed? */
export function hasRecovered(health: DestinationHealth): boolean {
  if (!health.lastSuccessAt) return false;
  if (!health.lastFailureAt) return true;
  return health.lastSuccessAt > health.lastFailureAt;
}

/**
 * Is this destination working?
 *
 * "Broken" is deliberately strict: attempted more than a couple of times and
 * never once succeeded. A single failure among successes is a blip, not a
 * misconfiguration, and calling it broken would train people to ignore the
 * badge.
 *
 * Recency wins over the window's totals. An endpoint that failed 732 times and
 * was then fixed keeps failed > success for the rest of the 24 hours, and
 * reporting it as failing for another day — while it delivers everything
 * perfectly — is the same lie in the other direction.
 */
export function destinationStatus(
  health: DestinationHealth | undefined,
): "delivering" | "failing" | "broken" | "waiting" | "idle" {
  if (!health || health.total === 0) return "idle";
  const attempted = health.success + health.failed;
  if (attempted === 0) return "waiting";
  if (hasRecovered(health)) return "delivering";
  if (health.success === 0 && attempted >= 3) return "broken";
  if (health.failed > health.success) return "failing";
  return "delivering";
}

// ============================================================================
// Helper Functions
// ============================================================================

export const ALL_WEBHOOK_EVENTS: WebhookEventType[] = [
  "message_received",
  "message_sent",
  "stage_changed",
  "tag_added",
  "tag_removed",
  "score_changed",
  "sequence_completed",
  "handoff_requested",
  "contact_created",
  "contact_updated",
  "lead_replied",
  "list_member_added",
  "list_member_removed",
  "signal_lead_added",
  "campaign_entry_decided",
];

export function getEventTypeLabel(type: WebhookEventType): string {
  const labels: Record<WebhookEventType, string> = {
    message_received: "Message Received",
    message_sent: "Message Sent",
    stage_changed: "Stage Changed",
    tag_added: "Tag Added",
    tag_removed: "Tag Removed",
    score_changed: "Score Changed",
    sequence_completed: "Sequence Completed",
    handoff_requested: "Handoff Requested",
    contact_created: "Contact Created",
    contact_updated: "Contact Updated",
    lead_replied: "Lead Replied",
    list_member_added: "Added to Lead List",
    list_member_removed: "Removed from Lead List",
    signal_lead_added: "Signal Lead Added",
    campaign_entry_decided: "Campaign Entry Decided",
  };
  return labels[type] || type;
}

export function getEventTypeDescription(type: WebhookEventType): string {
  const descriptions: Record<WebhookEventType, string> = {
    message_received: "When an inbound message is received",
    message_sent: "When an outbound message is sent",
    stage_changed: "When a contact moves to a different pipeline stage",
    tag_added: "When a tag is added to a contact",
    tag_removed: "When a tag is removed from a contact",
    score_changed: "When a contact's lead score changes",
    sequence_completed: "When a lead reaches the end of an email sequence",
    campaign_entry_decided: "When a campaign trigger qualifies, reviews, skips, declines or enrolls a person",
    handoff_requested: "When a human takes over a conversation from the AI",
    contact_created: "When a new contact is created",
    contact_updated: "When a contact's information is updated",
    lead_replied: "When an enrolled lead replies to a sequence email",
    list_member_added: "When a contact is added to a lead list",
    list_member_removed: "When a contact is removed from a lead list",
    signal_lead_added:
      "When a buying signal puts a lead on a lead list, with the signal's context attached",
  };
  return descriptions[type] || "";
}
