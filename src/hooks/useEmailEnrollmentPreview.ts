import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeEmailEnrollmentPreview } from "@/lib/email-enrollment-result";

export interface EmailEnrollmentAudience {
  listIds?: string[];
  contactIds?: string[];
  filters?: Record<string, unknown>;
}

export function useEmailEnrollmentPreview(
  sequenceId: string | null,
  audience: EmailEnrollmentAudience,
  open: boolean,
) {
  const { currentOrganization } = useAuth();
  const hasAudience = !!(audience.listIds?.length || audience.contactIds?.length);

  return useQuery({
    queryKey: ["email-enrollment-preview", currentOrganization?.id, sequenceId, audience],
    queryFn: async () => {
      // Keep audience keys nested: an older endpoint rejects this request
      // instead of accidentally enrolling contacts while ignoring dryRun.
      const { data, error } = await supabase.functions.invoke("enroll-leads", {
        body: {
          sequenceId,
          organizationId: currentOrganization!.id,
          dryRun: true,
          previewSource: audience,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return normalizeEmailEnrollmentPreview(data);
    },
    enabled: open && !!currentOrganization && !!sequenceId && hasAudience,
    staleTime: 0,
    retry: false,
  });
}
