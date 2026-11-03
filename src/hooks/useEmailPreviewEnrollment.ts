import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface EmailPreviewEnrollment {
  custom_data: Record<string, unknown> | null;
  mailbox_id: string | null;
  lead: Record<string, unknown>;
}

/** Read personalization for this contact in this sequence without enrolling it. */
export function useEmailPreviewEnrollment(sequenceId?: string, contactId?: string | null, contactEmail?: string | null) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["email-preview-enrollment", currentOrganization?.id, sequenceId, contactId, contactEmail],
    queryFn: async (): Promise<EmailPreviewEnrollment | null> => {
      if (!currentOrganization || !sequenceId || !contactId) return null;
      const orgId = currentOrganization.id;
      // Enrollment rows may predate organization_id; authorize their parent.
      const { data: sequence, error: sequenceError } = await supabase.from("email_sequences")
        .select("id").eq("id", sequenceId).eq("organization_id", orgId).single();
      if (sequenceError) throw sequenceError;
      if (!sequence) throw new Error("Sequence is unavailable in this organization");
      const { data: linkedLeads, error: leadsError } = await supabase.from("leads")
        .select("*").eq("organization_id", orgId).eq("source_id", contactId).limit(20);
      if (leadsError) throw leadsError;
      let leads = linkedLeads;
      if (!leads?.length && contactEmail?.trim()) {
        const result = await supabase.from("leads").select("*")
          .eq("organization_id", orgId).ilike("email", contactEmail.trim().replace(/[%_\\]/g, "\\$&")).limit(20);
        if (result.error) throw result.error;
        leads = result.data;
      }
      if (!leads?.length) return null;
      const { data: enrollment, error } = await supabase.from("email_sequence_enrollments")
        .select("custom_data, mailbox_id, lead_id").eq("sequence_id", sequenceId)
        .in("lead_id", leads.map((lead) => lead.id)).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!enrollment) return null;
      return {
        custom_data: enrollment.custom_data && typeof enrollment.custom_data === "object" && !Array.isArray(enrollment.custom_data)
          ? enrollment.custom_data as Record<string, unknown> : null,
        mailbox_id: enrollment.mailbox_id,
        lead: leads.find((lead) => lead.id === enrollment.lead_id) as Record<string, unknown>,
      };
    },
    enabled: !!currentOrganization && !!sequenceId && !!contactId,
    staleTime: 30_000,
  });
}
