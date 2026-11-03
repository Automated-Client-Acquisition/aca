import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CalendarAccount {
  id: string;
  organization_id: string;
  user_id: string;
  unipile_account_id: string;
  provider: "google" | "microsoft";
  email: string;
  name: string | null;
  status: "active" | "disconnected" | "error";
  last_sync_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function useCalendarAccounts() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["calendar-accounts", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("calendar_accounts")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return data as CalendarAccount[];
    },
    enabled: !!user && !!currentOrganization?.id,
  });
}

export function useConnectCalendar() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (provider: "google" | "microsoft") => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("calendar-connect", {
        body: {
          organizationId: currentOrganization.id,
          provider: provider.toUpperCase(),
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) throw response.error;

      const result = response.data;
      if (!result.success) throw new Error(result.error);

      return result;
    },
    onSuccess: (data) => {
      // Open the auth URL in a popup
      if (data.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
          data.authUrl,
          "calendar_auth",
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );

        // Listen for success message from popup
        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === "CALENDAR_OAUTH_SUCCESS") {
            toast.success(`${event.data.provider} calendar connected successfully!`);
            queryClient.invalidateQueries({ queryKey: ["calendar-accounts"] });
            window.removeEventListener("message", handleMessage);
          } else if (event.data?.type === "CALENDAR_OAUTH_ERROR") {
            toast.error(`Failed to connect calendar: ${event.data.error}`);
            window.removeEventListener("message", handleMessage);
          }
        };

        window.addEventListener("message", handleMessage);

        // Clean up listener if popup is closed manually
        const checkPopup = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkPopup);
            window.removeEventListener("message", handleMessage);
            queryClient.invalidateQueries({ queryKey: ["calendar-accounts"] });
          }
        }, 1000);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start connection");
    },
  });
}

export function useDisconnectCalendar() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accountId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("calendar_accounts")
        .delete()
        .eq("id", accountId)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Calendar disconnected");
      queryClient.invalidateQueries({ queryKey: ["calendar-accounts"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect calendar");
    },
  });
}
