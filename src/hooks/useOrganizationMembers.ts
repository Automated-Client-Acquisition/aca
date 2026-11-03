import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { OrganizationMember, UserRole } from "@/types/organization";
import { toast } from "sonner";

// Fetch organization members
export function useOrganizationMembers(organizationId?: string) {
  const { currentOrganization } = useAuth();
  const orgId = organizationId || currentOrganization?.id;

  return useQuery({
    queryKey: ["organization-members", orgId],
    queryFn: async (): Promise<OrganizationMember[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("organization_members")
        .select(`
          id,
          user_id,
          organization_id,
          role,
          permissions,
          is_primary_owner,
          joined_at,
          created_at,
          updated_at,
          user:users (
            id,
            email,
            full_name,
            avatar_url
          )
        `)
        .eq("organization_id", orgId)
        .order("is_primary_owner", { ascending: false })
        .order("role", { ascending: true })
        .order("joined_at", { ascending: true });

      if (error) {
        console.error("Error fetching organization members:", error);
        throw error;
      }

      return (data || []).map((m) => ({
        ...m,
        user: m.user as OrganizationMember["user"],
      }));
    },
    enabled: !!orgId,
  });
}

// Update member role
export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      memberId,
      newRole,
    }: {
      memberId: string;
      newRole: UserRole;
    }) => {
      // Cannot change to super_admin via this method
      if (newRole === "super_admin") {
        throw new Error("Cannot assign super_admin role");
      }

      const { error } = await supabase
        .from("organization_members")
        .update({ role: newRole })
        .eq("id", memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      toast.success("Member role updated");
    },
    onError: (error) => {
      toast.error(`Failed to update role: ${error.message}`);
    },
  });
}

// Remove member from organization
export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (memberId: string) => {
      // First check if this is the primary owner
      const { data: member } = await supabase
        .from("organization_members")
        .select("is_primary_owner")
        .eq("id", memberId)
        .single();

      if (member?.is_primary_owner) {
        throw new Error("Cannot remove the primary owner");
      }

      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("id", memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      toast.success("Member removed");
    },
    onError: (error) => {
      toast.error(`Failed to remove member: ${error.message}`);
    },
  });
}

// Transfer ownership
export function useTransferOwnership() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      newOwnerId,
      organizationId,
    }: {
      newOwnerId: string;
      organizationId: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Get current owner's member record
      const { data: currentOwner } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("is_primary_owner", true)
        .single();

      if (!currentOwner) {
        throw new Error("Could not find current owner");
      }

      // Update current owner to admin
      await supabase
        .from("organization_members")
        .update({ is_primary_owner: false, role: "admin" })
        .eq("id", currentOwner.id);

      // Update new owner
      const { error } = await supabase
        .from("organization_members")
        .update({ is_primary_owner: true, role: "owner" })
        .eq("user_id", newOwnerId)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      toast.success("Ownership transferred");
    },
    onError: (error) => {
      toast.error(`Failed to transfer ownership: ${error.message}`);
    },
  });
}
