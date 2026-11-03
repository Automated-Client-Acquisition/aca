import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface TrackingDomain {
  id: string;
  organization_id: string;
  domain: string;
  is_verified: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Queries
// ============================================================================

export function useTrackingDomains() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["tracking_domains", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("email_tracking_domains")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as TrackingDomain[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateTrackingDomain() {
  const { currentOrganization } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (domain: string) => {
      if (!currentOrganization) throw new Error("No organization");

      // If this is the first domain, make it the default
      const { count } = await supabase
        .from("email_tracking_domains")
        .select("id", { count: "exact" })
        .eq("organization_id", currentOrganization.id);

      const isFirst = (count ?? 0) === 0;

      const { data, error } = await supabase
        .from("email_tracking_domains")
        .insert({
          organization_id: currentOrganization.id,
          domain: domain.trim().toLowerCase(),
          is_default: isFirst,
        })
        .select()
        .single();

      if (error) throw error;
      return data as TrackingDomain;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracking_domains", currentOrganization?.id] });
      toast.success("Tracking domain added");
    },
    onError: (err: Error) => {
      if (err.message?.includes("duplicate")) {
        toast.error("This domain already exists");
      } else {
        toast.error("Failed to add tracking domain");
      }
    },
  });
}

export function useDeleteTrackingDomain() {
  const { currentOrganization } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_tracking_domains")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization!.id);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracking_domains", currentOrganization?.id] });
      toast.success("Tracking domain removed");
    },
    onError: () => {
      toast.error("Failed to remove tracking domain");
    },
  });
}

export function useSetDefaultTrackingDomain() {
  const { currentOrganization } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization");

      // Clear all defaults for this org
      await supabase
        .from("email_tracking_domains")
        .update({ is_default: false })
        .eq("organization_id", currentOrganization.id);

      // Set the new default
      const { error } = await supabase
        .from("email_tracking_domains")
        .update({ is_default: true })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracking_domains", currentOrganization?.id] });
      toast.success("Default tracking domain updated");
    },
    onError: () => {
      toast.error("Failed to update default domain");
    },
  });
}
