import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedIn } from "@/hooks/crm/useContacts";

export interface MailboxSequence {
  id: string;
  name: string;
  status: string;
  created_at: string;
  enrollment_count: number;
}

export function useMailboxSequences(mailboxId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["mailbox-sequences", mailboxId, currentOrganization?.id],
    queryFn: async (): Promise<MailboxSequence[]> => {
      if (!mailboxId || !currentOrganization) return [];

      // 1. Sequences with active enrollments using this mailbox
      const { data: enrollments, error: enrollError } = await supabase
        .from("email_sequence_enrollments")
        .select("sequence_id")
        .eq("mailbox_id", mailboxId);

      if (enrollError) throw enrollError;

      const enrollmentSequenceIds = [
        ...new Set((enrollments || []).map((e) => e.sequence_id)),
      ];

      // Count enrollments per sequence
      const countMap: Record<string, number> = {};
      (enrollments || []).forEach((e) => {
        countMap[e.sequence_id] = (countMap[e.sequence_id] || 0) + 1;
      });

      // 2. Sequences configured to use this mailbox (settings.mailbox_ids)
      const { data: configuredSeqs, error: configError } = await supabase
        .from("email_sequences")
        .select("id, name, status, created_at")
        .eq("organization_id", currentOrganization.id)
        .contains("settings", { mailbox_ids: [mailboxId] });

      if (configError) throw configError;

      // 3. Fetch sequences from enrollments (if any IDs not already in configuredSeqs)
      const configuredIds = new Set((configuredSeqs || []).map((s) => s.id));
      const missingIds = enrollmentSequenceIds.filter(
        (id) => !configuredIds.has(id)
      );

      let enrollmentSeqs: typeof configuredSeqs = [];
      if (missingIds.length > 0) {
        enrollmentSeqs = await chunkedIn(missingIds, (chunk) =>
          supabase
            .from("email_sequences")
            .select("id, name, status, created_at")
            .in("id", chunk)
            .eq("organization_id", currentOrganization.id)
        );
      }

      // 4. Merge & deduplicate
      const allSeqs = [...(configuredSeqs || []), ...enrollmentSeqs];
      const seen = new Set<string>();
      const result: MailboxSequence[] = [];

      for (const seq of allSeqs) {
        if (seen.has(seq.id)) continue;
        seen.add(seq.id);
        result.push({
          ...seq,
          enrollment_count: countMap[seq.id] || 0,
        });
      }

      return result.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    enabled: !!mailboxId && !!currentOrganization,
  });
}
