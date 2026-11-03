import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserOrganization, getOrgInitials, getOrgColor } from "@/types/organization";

export function useUserOrganizations() {
  const { user, currentOrganization, isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ["user-organizations", user?.id],
    queryFn: async (): Promise<UserOrganization[]> => {
      if (!user) return [];

      // Fetch organizations through organization_members
      const { data: memberships, error: memberError } = await supabase
        .from("organization_members")
        .select(`
          role,
          organization:organizations (
            id,
            name,
            slug,
            type,
            parent_id,
            logo_url
          )
        `)
        .eq("user_id", user.id);

      if (memberError) {
        console.error("Error fetching memberships:", memberError);
        throw memberError;
      }

      // Transform to UserOrganization format
      const organizations: UserOrganization[] = (memberships || [])
        .filter((m) => m.organization)
        .map((m) => {
          const org = m.organization as any;
          return {
            id: org.id,
            name: org.name,
            slug: org.slug,
            type: org.type,
            role: m.role as UserOrganization["role"],
            is_current: currentOrganization?.id === org.id,
            parent_id: org.parent_id,
            initials: getOrgInitials(org.name),
            color: getOrgColor(org.id),
            logo_url: org.logo_url,
          };
        });

      return organizations;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get all organizations (super admin only)
export function useAllOrganizations(options?: { type?: string }) {
  const { isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ["all-organizations", options?.type],
    queryFn: async () => {
      let query = supabase
        .from("organizations")
        .select(`
          id,
          name,
          slug,
          type,
          status,
          parent_id,
          created_at,
          created_by_user_id
        `)
        .order("created_at", { ascending: false });

      if (options?.type) {
        query = query.eq("type", options.type);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching all organizations:", error);
        throw error;
      }

      return data || [];
    },
    enabled: isSuperAdmin,
  });
}
