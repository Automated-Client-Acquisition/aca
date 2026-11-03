/** Explicit allowlist shared by editor and campaign mutations. */
export const CAMPAIGN_WRITABLE_FIELDS = [
  "name", "description", "status", "lead_list_id", "lead_list_ids", "exclusion_list_ids",
  "exclude_other_campaigns", "exclude_same_sender", "auto_enroll_new_members", "enroll_filter_criteria",
  "sender_account_ids", "sender_accounts", "sequence_nodes", "sequence_edges", "stop_on_reply",
  "campaign_settings", "rate_settings", "autopilot_config", "agent_profile_id", "icp_product_id",
  "min_icp_score", "campaign_type", "primary_channel", "channel_fallback_enabled", "fallback_order",
  "total_leads", "processed_leads", "replied_count", "connection_rate", "started_at", "paused_at",
  "completed_at", "ai_message_config",
  "entry_triggers",
] as const;

export function campaignWritePayload(values: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeCampaignEditorSnapshot(values);
  return Object.fromEntries(CAMPAIGN_WRITABLE_FIELDS
    .filter(field => normalized[field] !== undefined)
    .map(field => [field, normalized[field]]));
}

/** Ignore canvas measurements and selection when comparing or saving a draft. */
export function normalizeCampaignEditorSnapshot<T extends Record<string, unknown>>(values: T): T {
  const runtimeFields = new Set(["selected", "measured", "width", "height", "dragging", "positionAbsolute", "initialWidth", "initialHeight"]);
  const graphItem = (item: Record<string, unknown>) => {
    const result = Object.fromEntries(Object.entries(item).filter(([key]) => !runtimeFields.has(key)));
    if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
      result.data = Object.fromEntries(Object.entries(result.data).filter(([key]) => !key.startsWith("__")));
    }
    return result;
  };
  return {
    ...values,
    ...(Array.isArray(values.sequence_nodes) ? { sequence_nodes: values.sequence_nodes.map(graphItem) } : {}),
    ...(Array.isArray(values.sequence_edges) ? { sequence_edges: values.sequence_edges.map(graphItem) } : {}),
  };
}

export type CampaignSaveStatus = "saved" | "unsaved" | "saving" | "error";

export function campaignEditorNameError(name: string): string | null {
  if (!name.trim()) return "Enter a campaign name to save your changes.";
  if (name.length > 255) return "Campaign names must be 255 characters or less.";
  return null;
}

export function unavailableCampaignSenderChannels(
  senderAccounts: Partial<Record<"linkedin" | "email" | "whatsapp" | "instagram" | "telegram" | "messenger" | "twitter" | "sms", string[]>>,
  legacyLinkedIn: string[],
  accounts: { id: string; status: string; provider: string }[],
): string[] {
  const selected = { ...senderAccounts };
  if (!selected.linkedin?.length && legacyLinkedIn.length) selected.linkedin = legacyLinkedIn;
  return Object.entries(selected).filter(([, ids]) => ids?.length).filter(([channel, ids]) =>
    !ids.some(id => accounts.some(account => {
      const provider = account.provider.toLowerCase();
      const matches = channel === "email" ? ["email", "google", "outlook", "mail"].includes(provider) : provider === channel;
      return account.id === id && account.status === "active" && matches;
    })),
  ).map(([channel]) => channel);
}

/** Serialize writes, coalesce queued drafts, and retain failed/latest work for retry. */
export function createCampaignSaveQueue<T>(
  initial: T,
  persist: (snapshot: T) => Promise<void>,
  onStatus: (status: CampaignSaveStatus, error?: unknown) => void,
) {
  let latest = initial;
  let latestKey = JSON.stringify(initial);
  let savedKey = latestKey;
  let running: Promise<void> | null = null;
  let lastError: unknown;
  const publish = () => onStatus(running ? "saving" : lastError ? "error"
    : latestKey !== savedKey ? "unsaved" : "saved", lastError);

  return {
    update(snapshot: T) {
      latest = snapshot;
      latestKey = JSON.stringify(snapshot);
      publish();
    },
    hasUnsavedChanges() { return !!running || !!lastError || latestKey !== savedKey; },
    flush(force = false): Promise<void> {
      if (running) return running;
      if (!force && !lastError && latestKey === savedKey) return Promise.resolve();
      lastError = undefined;
      // Assign the promise before the first write so status and concurrent flush
      // calls observe the same request even when persist rejects synchronously.
      running = Promise.resolve().then(async () => {
        let mustWrite = force;
        do {
          const snapshot = latest;
          const snapshotKey = latestKey;
          await persist(snapshot);
          savedKey = snapshotKey;
          mustWrite = false;
        } while (mustWrite || latestKey !== savedKey);
      }).catch(error => {
        lastError = error;
        throw error;
      }).finally(() => {
        running = null;
        publish();
      });
      publish();
      return running;
    },
  };
}
