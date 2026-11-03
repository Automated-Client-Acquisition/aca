import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExportContactsInput {
  email: string;
  format: "csv" | "json";
  columns?: string[];
  contactIds?: string[];
  filters?: {
    status?: string;
    source?: string;
    contactType?: string;
    search?: string;
    linkedinOnly?: boolean;
  };
}

interface ExportContactsResponse {
  success: boolean;
  message: string;
  contactCount: number;
}

export function useExportContacts() {
  return useMutation({
    mutationFn: async (input: ExportContactsInput): Promise<ExportContactsResponse> => {
      const { data, error } = await supabase.functions.invoke("export-contacts-email", {
        body: input,
      });

      if (error) {
        throw new Error(error.message || "Failed to export contacts");
      }

      if (!data.success) {
        throw new Error(data.error || "Failed to export contacts");
      }

      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to export contacts");
    },
  });
}
