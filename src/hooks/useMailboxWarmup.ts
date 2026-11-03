import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export type WarmupPlacement = "inbox" | "junk" | "missing";

export interface WarmupSend {
  id: string;
  from_mailbox_id: string;
  to_mailbox_id: string;
  subject: string;
  status: string;
  placement: WarmupPlacement | null;
  rescued_at: string | null;
  replied_at: string | null;
  is_reply: boolean;
  transport: string | null;
  sent_at: string | null;
  error: string | null;
}

export interface WarmupStats {
  sent: number;
  delivered: number;
  inbox: number;
  junk: number;
  rescued: number;
  repliesReceived: number;
  failed: number;
  /**
   * Share of verified deliveries that reached the Inbox rather than Junk.
   * This is the honest reputation signal — a raw send count says nothing about
   * whether anything actually arrived where it needed to.
   * `null` when nothing has been verified yet, so the UI can say "no data"
   * instead of rendering a misleading 0%.
   */
  inboxRate: number | null;
}

const RECENT_LIMIT = 50;

/**
 * Warmup activity for a single mailbox.
 *
 * Reads `email_warmup_sends`, NOT `email_send_log` — warmup traffic is kept out
 * of the send log so it cannot distort customer-facing deliverability analytics.
 */
export function useMailboxWarmup(mailboxId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["mailbox-warmup", mailboxId, currentOrganization?.id],
    queryFn: async () => {
      if (!mailboxId) return null;

      // Outbound warmup this mailbox sent.
      const { data: outbound, error: outErr } = await supabase
        .from("email_warmup_sends")
        .select(
          "id, from_mailbox_id, to_mailbox_id, subject, status, placement, rescued_at, replied_at, is_reply, transport, sent_at, error",
        )
        .eq("from_mailbox_id", mailboxId)
        .order("sent_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (outErr) throw outErr;

      // Replies this mailbox received back — the engagement half of warmup.
      const { count: repliesReceived } = await supabase
        .from("email_warmup_sends")
        .select("id", { count: "exact", head: true })
        .eq("to_mailbox_id", mailboxId)
        .eq("is_reply", true);

      const rows = (outbound || []) as WarmupSend[];

      const delivered = rows.filter((r) => r.status === "delivered");
      const inbox = delivered.filter((r) => r.placement === "inbox").length;
      const junk = delivered.filter((r) => r.placement === "junk").length;

      const stats: WarmupStats = {
        sent: rows.filter((r) => r.status !== "failed").length,
        delivered: delivered.length,
        inbox,
        junk,
        rescued: rows.filter((r) => r.rescued_at).length,
        repliesReceived: repliesReceived ?? 0,
        failed: rows.filter((r) => r.status === "failed").length,
        inboxRate: inbox + junk > 0 ? inbox / (inbox + junk) : null,
      };

      return { stats, recent: rows.slice(0, RECENT_LIMIT) };
    },
    enabled: !!mailboxId && !!currentOrganization,
  });
}

/** Opt a mailbox in or out of the warmup mesh. */
export function useToggleMailboxWarmup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mailboxId, enabled }: { mailboxId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("email_mailboxes")
        .update({ warmup_enabled: enabled })
        .eq("id", mailboxId);
      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-warmup"] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox"] });
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes"] });
      toast.success(enabled ? "Warmup enabled" : "Warmup disabled");
    },
    onError: (e: Error) => toast.error(`Could not update warmup: ${e.message}`),
  });
}
