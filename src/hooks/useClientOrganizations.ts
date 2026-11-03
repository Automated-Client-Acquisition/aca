import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ClientOrganization, CreateClientForm } from "@/types/organization";
import { toast } from "sonner";

// Fetch client organizations for an agency
export function useClientOrganizations(agencyId?: string) {
  const { currentOrganization, isAgency } = useAuth();
  const orgId = agencyId || currentOrganization?.id;

  // Enable query if org is agency (by isAgency flag OR by type)
  const isAgencyOrg = isAgency || currentOrganization?.type === "agency";

  return useQuery({
    queryKey: ["client-organizations", orgId],
    queryFn: async (): Promise<ClientOrganization[]> => {
      if (!orgId) return [];

      // Use the database function to get clients with metrics
      const { data, error } = await supabase.rpc("get_agency_clients_with_metrics", {
        p_agency_id: orgId,
      });

      if (error) {
        console.error("Error fetching client organizations:", error);
        // Fallback to simple query if function doesn't exist
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("organizations")
          .select("id, name, slug, status, created_at, parent_id, logo_url")
          .eq("parent_id", orgId)
          .order("created_at", { ascending: false });

        if (fallbackError) throw fallbackError;
        return (fallbackData as unknown as ClientOrganization[]) || [];
      }

      return data || [];
    },
    enabled: !!orgId && isAgencyOrg,
  });
}

// Create a new client organization
export function useCreateClientOrganization() {
  const queryClient = useQueryClient();
  const { user, currentOrganization, refreshOrganizationContext } = useAuth();

  return useMutation({
    mutationFn: async ({
      name,
      slug,
    }: CreateClientForm) => {
      if (!currentOrganization || !user) {
        throw new Error("Organization context not available");
      }

      // Call edge function to create client (bypasses RLS)
      const { data, error } = await supabase.functions.invoke("create-client-organization", {
        body: { name, slug },
      });

      console.log("Create client response:", { data, error });

      if (error) {
        // Try to extract error message from the response body
        let errorMessage = "Failed to create client";
        try {
          const context = (error as any)?.context;
          if (context?.body) {
            const parsed = JSON.parse(context.body);
            errorMessage = parsed.error || errorMessage;
          } else if (error.message) {
            errorMessage = error.message;
          }
        } catch {
          errorMessage = error.message || errorMessage;
        }
        throw new Error(errorMessage);
      }

      if (!data?.success) {
        throw new Error(data?.error || "Failed to create client");
      }

      // IMPORTANT: Refresh org context BEFORE returning to ensure isAgency is updated
      // This prevents race conditions where navigation happens before context refresh
      await refreshOrganizationContext();

      return data.organization;
    },
    onSuccess: (data) => {
      // Invalidate both client list and user's org list (for sidebar switcher)
      queryClient.invalidateQueries({ queryKey: ["client-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["user-organizations"] });
      toast.success(`Client "${data.name}" created successfully`);
    },
    onError: (error) => {
      toast.error(`Failed to create client: ${error.message}`);
    },
  });
}

// Update client organization
export function useUpdateClientOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      status,
    }: {
      id: string;
      name?: string;
      status?: string;
    }) => {
      const updates: Record<string, any> = {};
      if (name) updates.name = name;
      if (status) updates.status = status;

      const { error } = await supabase
        .from("organizations")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-organizations"] });
      toast.success("Client updated");
    },
    onError: (error) => {
      toast.error(`Failed to update client: ${error.message}`);
    },
  });
}

// Archive/Reactivate client organization
export function useArchiveClientOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      archive,
    }: {
      id: string;
      archive: boolean;
    }) => {
      const { error } = await supabase
        .from("organizations")
        .update({ status: archive ? "archived" : "active" })
        .eq("id", id);

      if (error) throw error;
      return { archived: archive };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["client-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["client-organization"] });
      toast.success(data.archived ? "Client archived" : "Client reactivated");
    },
    onError: (error) => {
      toast.error(`Failed to update client: ${error.message}`);
    },
  });
}

// Delete client organization
export function useDeleteClientOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      // Check if client has any content
      const { count: contentCount } = await supabase
        .from("content_outputs")
        .select("id", { count: "exact" })
        .eq("organization_id", clientId);

      if (contentCount && contentCount > 0) {
        throw new Error("Cannot delete client with existing content. Archive it instead.");
      }

      // Delete organization (cascade will handle related records)
      const { error } = await supabase
        .from("organizations")
        .delete()
        .eq("id", clientId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-organizations"] });
      toast.success("Client deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete client: ${error.message}`);
    },
  });
}

// Get single client with full details
export function useClientOrganization(clientId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["client-organization", clientId],
    queryFn: async () => {
      if (!clientId) return null;

      const { data: rawData, error } = await supabase
        .from("organizations")
        .select(`
          id,
          name,
          slug,
          type,
          status,
          parent_id,
          created_at,
          settings,
          logo_url,
          organization_settings (
            onboarding_completed,
            api_key_strategy,
            inherit_api_keys_from_parent,
            default_llm_model,
            default_image_generator_model
          )
        `)
        .eq("id", clientId)
        .single();

      if (error) throw error;

      // Cast to handle logo_url field not being in generated types yet
      const data = rawData as unknown as {
        id: string;
        name: string;
        slug: string;
        type: string;
        status: string | null;
        parent_id: string | null;
        created_at: string;
        settings: any;
        logo_url?: string | null;
        organization_settings: {
          onboarding_completed: boolean | null;
          api_key_strategy: string | null;
          inherit_api_keys_from_parent: boolean | null;
          default_llm_model: string | null;
          default_image_generator_model: string | null;
        } | null;
      };

      // Verify this is a child of current org
      if (data.parent_id !== currentOrganization?.id) {
        throw new Error("Access denied");
      }

      // Get member count
      const { count: memberCount } = await supabase
        .from("organization_members")
        .select("id", { count: "exact" })
        .eq("organization_id", clientId);

      // Get content stats
      const { data: contentStats } = await supabase
        .from("content_outputs")
        .select("type")
        .eq("organization_id", clientId);

      const contentByType: Record<string, number> = {};
      (contentStats || []).forEach((c) => {
        contentByType[c.type] = (contentByType[c.type] || 0) + 1;
      });

      return {
        ...data,
        member_count: memberCount || 0,
        content_stats: contentByType,
        total_content: contentStats?.length || 0,
      };
    },
    enabled: !!clientId && !!currentOrganization,
  });
}
