import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { EmailSendLogEntry, SendLogFilters } from "@/types/email";

const DEFAULT_PAGE_SIZE = 50;

export function useEmailSendLog(filters: SendLogFilters = {}) {
  const { currentOrganization } = useAuth();
  const pageSize = filters.page_size || DEFAULT_PAGE_SIZE;
  const page = filters.page || 1;

  return useQuery({
    queryKey: ["email-send-log", currentOrganization?.id, filters],
    queryFn: async () => {
      if (!currentOrganization) return { entries: [], total: 0, totalPages: 0 };

      let query = supabase
        .from("email_send_log")
        .select("*", { count: "exact" })
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (filters.mailbox_id) {
        query = query.eq("mailbox_id", filters.mailbox_id);
      }
      if (filters.campaign_id) {
        query = query.eq("campaign_id", filters.campaign_id);
      }
      if (filters.sequence_id) {
        query = query.eq("sequence_id", filters.sequence_id);
      }
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.date_from) {
        query = query.gte("created_at", filters.date_from);
      }
      if (filters.date_to) {
        query = query.lte("created_at", filters.date_to);
      }

      // Pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        entries: data as unknown as EmailSendLogEntry[],
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      };
    },
    enabled: !!currentOrganization,
  });
}
