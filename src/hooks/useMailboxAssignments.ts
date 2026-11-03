import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MailboxAssignment {
  sequenceId: string;
  sequenceName: string;
  status: string;
}

export type MailboxAssignmentMap = Map<string, MailboxAssignment[]>;

/**
 * Bulk "which sequences each mailbox is assigned to" lookup for the org.
 *
 * Returns every sequence whose configured pool (`email_sequences.settings.
 * mailbox_ids`) references the mailbox, with the sequence's status. The picker
 * derives the two states it cares about from this:
 *   - "unused"  → mailbox appears in zero sequences (assignment list empty)
 *   - "in use"  → mailbox appears in an ACTIVE sequence other than the one
 *                 being edited (paused/draft/completed don't occupy a mailbox)
 * One query over `email_sequences` — cheap enough to run inside the picker.
 */
export function useMailboxAssignments() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["mailbox-assignments", currentOrganization?.id],
    queryFn: async (): Promise<MailboxAssignmentMap> => {
      const map: MailboxAssignmentMap = new Map();
      if (!currentOrganization) return map;

      const { data, error } = await supabase
        .from("email_sequences")
        .select("id, name, status, settings")
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;

      for (const seq of data || []) {
        const ids = (seq.settings as { mailbox_ids?: string[] } | null)?.mailbox_ids;
        if (!Array.isArray(ids)) continue;
        for (const mailboxId of ids) {
          const list = map.get(mailboxId) ?? [];
          list.push({
            sequenceId: seq.id,
            sequenceName: seq.name,
            status: seq.status,
          });
          map.set(mailboxId, list);
        }
      }

      return map;
    },
    enabled: !!currentOrganization,
  });
}
