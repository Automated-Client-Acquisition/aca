import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useMarkLeadsInvalid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadIds: string[]) => {
      const { error } = await supabase
        .from("leads")
        .update({ email_status: "invalid" })
        .in("id", leadIds);
      if (error) throw error;
      return { count: leadIds.length };
    },
    onSuccess: ({ count }) => {
      queryClient.invalidateQueries({ queryKey: ["email-leads-by-status"] });
      toast.success(`${count} lead${count !== 1 ? "s" : ""} marked as invalid`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to mark leads: ${error.message}`);
    },
  });
}

export function useExcludeLeadsFromSequences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadIds: string[]) => {
      // 1. Mark leads as invalid so they're filtered from future sequences
      const { error: leadError } = await supabase
        .from("leads")
        .update({ email_status: "invalid" })
        .in("id", leadIds);
      if (leadError) throw leadError;

      // 2. Cancel all active enrollments for these leads
      const { data, error: enrollError } = await supabase
        .from("email_sequence_enrollments")
        .update({ status: "bounced", next_send_at: null })
        .in("lead_id", leadIds)
        .eq("status", "active")
        .select("id");
      if (enrollError) throw enrollError;

      return { leadsUpdated: leadIds.length, enrollmentsCancelled: data?.length || 0 };
    },
    onSuccess: ({ leadsUpdated, enrollmentsCancelled }) => {
      queryClient.invalidateQueries({ queryKey: ["email-leads-by-status"] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollments"] });
      toast.success(
        `${leadsUpdated} lead${leadsUpdated !== 1 ? "s" : ""} excluded, ${enrollmentsCancelled} active enrollment${enrollmentsCancelled !== 1 ? "s" : ""} cancelled`
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to exclude leads: ${error.message}`);
    },
  });
}
