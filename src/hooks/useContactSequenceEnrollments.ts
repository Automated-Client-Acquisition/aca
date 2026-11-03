import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ============================================================================
// Types
// ============================================================================

export type EnrollmentSource = "linkedin" | "email";

export interface ContactEnrollment {
  /** Which outreach system this enrollment comes from. */
  source: EnrollmentSource;
  enrollment_id: string;
  /** linkedin_campaigns.id or email_sequences.id — used to link to the detail page. */
  sequence_id: string;
  sequence_name: string;
  /** Status of the campaign/sequence object (active, paused, draft, ...). */
  sequence_status: string;
  /** This contact's per-enrollment status (pending, active, completed, ...). */
  enrollment_status: string;
  /** True when the enrollment is still ongoing (not completed/failed/bounced/...). */
  is_active: boolean;
  /** True when this enrollment was armed by a lead-magnet delivery. */
  is_followup: boolean;
  /** Next email send or OOO resume time, depending on the enrollment state. */
  next_action_at: string | null;
  pause_reason: string | null;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch the campaigns / sequences a CRM contact is currently enrolled in,
 * across both LinkedIn (campaign_lead_progress) and email
 * (email_sequence_enrollments, matched by email). Backed by the
 * `get_contact_enrollments` RPC, which resolves and RLS-scopes both sources
 * in a single round trip. Lead-magnet recovery enrollments come first, then
 * other active outreach, so the Inbox can show the operationally relevant state.
 */
export function useContactSequenceEnrollments(contactId: string | null | undefined) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["contact-enrollments", contactId, currentOrganization?.id],
    queryFn: async () => {
      if (!contactId) return [];
      const { data, error } = await supabase.rpc("get_contact_enrollments", {
        p_contact_id: contactId,
      });
      if (error) throw error;
      return (data ?? []) as ContactEnrollment[];
    },
    enabled: !!contactId && !!user && !!currentOrganization,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
