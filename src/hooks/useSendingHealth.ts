import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SendingHealth {
  /** LinkedIn / social senders the user has to reconnect ('expired' | 'error').
   *  'disconnected' is excluded: those are orphaned rows the Senders list
   *  already hides, and reconnecting them creates a new account. */
  brokenSenders: number;
  /** Mailboxes whose connection failed and need the user to reconnect them. */
  disconnectedMailboxes: number;
  /** Mailboxes the system paused on its own (domain resting, tenant issue,
   *  bounce spike, ...). Informational: most clear without user action. */
  autoPausedMailboxes: number;
}

// Sending setup moved out of the main sidebar into Settings, so a broken
// sender no longer sits in plain view. This powers the warning dot on
// Settings and the alert lines on Automations / Sequences. Head-count
// queries only — it runs on every page via the sidebar.
export function useSendingHealth() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["sending-health", currentOrganization?.id],
    queryFn: async (): Promise<SendingHealth> => {
      const orgId = currentOrganization!.id;

      const [senders, disconnected, autoPaused] = await Promise.all([
        supabase
          .from("unipile_accounts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("status", ["expired", "error"]),
        supabase
          .from("email_mailboxes")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "disconnected"),
        // A manual pause is the operator's choice, not a problem to flag.
        supabase
          .from("email_mailboxes")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "paused")
          .not("metadata->>paused_reason", "is", null)
          .neq("metadata->>paused_reason", "manual"),
      ]);

      if (senders.error) throw senders.error;
      if (disconnected.error) throw disconnected.error;
      if (autoPaused.error) throw autoPaused.error;

      return {
        brokenSenders: senders.count ?? 0,
        disconnectedMailboxes: disconnected.count ?? 0,
        autoPausedMailboxes: autoPaused.count ?? 0,
      };
    },
    enabled: !!currentOrganization,
    staleTime: 60_000,
  });
}
