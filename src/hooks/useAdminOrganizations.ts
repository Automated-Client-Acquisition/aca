import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  AdminOrganization,
  AdminOrganizationDetail,
  AdminActionLog,
  AdminFilters,
  PlanTier,
  AdminActionType,
} from "@/types/admin";
import { toast } from "sonner";

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch all organizations with metrics (super admin only)
 */
export function useAdminOrganizations(filters?: AdminFilters) {
  const { isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ["admin-organizations", filters],
    queryFn: async (): Promise<AdminOrganization[]> => {
      const { data, error } = await supabase.rpc("get_all_organizations_with_metrics", {
        p_type_filter: filters?.type || null,
        p_status_filter: filters?.status || null,
        p_plan_filter: filters?.plan || null,
        p_search: filters?.search || null,
        p_include_suspended: filters?.includeSuspended ?? true,
      });

      if (error) {
        console.error("Error fetching admin organizations:", error);
        throw error;
      }

      return (data || []).map((org: any) => ({
        ...org,
        plan_tier: org.plan_tier || "free",
        is_suspended: org.is_suspended || false,
        api_key_count: org.api_key_count || 0,
        logo_url: org.logo_url || null,
      }));
    },
    enabled: isSuperAdmin,
  });
}

/**
 * Fetch single organization with full details (super admin only)
 */
export function useAdminOrganization(orgId: string | undefined) {
  const { isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ["admin-organization", orgId],
    queryFn: async (): Promise<AdminOrganizationDetail | null> => {
      if (!orgId) return null;

      // Fetch organization with members
      const { data: org, error } = await supabase
        .from("organizations")
        .select(`
          *,
          organization_members (
            id,
            user_id,
            role,
            is_primary_owner,
            user:users (id, email, full_name, first_name, last_name, skool_profile_url)
          )
        `)
        .eq("id", orgId)
        .single();

      if (error) throw error;

      // Fetch parent organization name if applicable
      let parentName: string | null = null;
      if (org.parent_id) {
        const { data: parent } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", org.parent_id)
          .single();
        parentName = parent?.name || null;
      }

      // Get counts
      const { count: userCount } = await supabase
        .from("organization_members")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId);

      const { count: contentCount } = await supabase
        .from("content_outputs")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId);

      const { count: jobsCount } = await supabase
        .from("content_generation_jobs")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId);

      const { count: apiKeyCount } = await supabase
        .from("api_keys")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId);

      // Get owner email
      const ownerMember = org.organization_members?.find((m: any) => m.is_primary_owner);
      const ownerEmail = ownerMember?.user?.email || null;

      // Cast to include logo_url which may not be in generated types yet
      const orgData = org as typeof org & { logo_url?: string | null };

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        type: org.type,
        status: org.status,
        plan_tier: org.plan_tier || "free",
        is_suspended: org.is_suspended || false,
        suspended_at: org.suspended_at,
        suspended_by: org.suspended_by,
        suspension_reason: org.suspension_reason,
        parent_id: org.parent_id,
        parent_name: parentName,
        created_at: org.created_at,
        plan_changed_at: org.plan_changed_at,
        plan_changed_by: org.plan_changed_by,
        settings: org.settings,
        limits: org.limits,
        current_usage: org.current_usage,
        user_count: userCount || 0,
        content_count: contentCount || 0,
        jobs_count: jobsCount || 0,
        api_key_count: apiKeyCount || 0,
        owner_email: ownerEmail,
        logo_url: orgData.logo_url,
        members: org.organization_members,
      };
    },
    enabled: isSuperAdmin && !!orgId,
  });
}

/**
 * Fetch admin action logs
 */
export function useAdminActionLogs(orgId?: string, actionType?: AdminActionType) {
  const { isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ["admin-action-logs", orgId, actionType],
    queryFn: async (): Promise<AdminActionLog[]> => {
      const { data, error } = await supabase.rpc("get_admin_action_logs", {
        p_organization_id: orgId || null,
        p_action_type: actionType || null,
        p_limit: 100,
      });

      if (error) {
        console.error("Error fetching admin action logs:", error);
        throw error;
      }

      return data || [];
    },
    enabled: isSuperAdmin,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Change organization plan tier
 */
export function useChangeOrganizationPlan() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      orgId,
      newPlan,
      notes,
    }: {
      orgId: string;
      newPlan: PlanTier;
      notes?: string;
    }) => {
      // Get current org data for audit log
      const { data: org, error: fetchError } = await supabase
        .from("organizations")
        .select("name, plan_tier")
        .eq("id", orgId)
        .single();

      if (fetchError) throw fetchError;

      const previousPlan = org?.plan_tier || "free";

      // Update plan
      const { error: updateError } = await supabase
        .from("organizations")
        .update({
          plan_tier: newPlan,
          plan_changed_at: new Date().toISOString(),
          plan_changed_by: user?.id,
        })
        .eq("id", orgId);

      if (updateError) throw updateError;

      // Log action
      const { error: logError } = await supabase.from("admin_action_logs").insert({
        admin_user_id: user!.id,
        target_organization_id: orgId,
        target_organization_name: org?.name || "Unknown",
        action_type: "plan_change",
        previous_value: { plan_tier: previousPlan },
        new_value: { plan_tier: newPlan },
        notes,
      });

      if (logError) console.error("Error logging action:", logError);

      return { previousPlan, newPlan, orgName: org?.name };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organization"] });
      queryClient.invalidateQueries({ queryKey: ["admin-action-logs"] });
      toast.success(`${data.orgName}: Plan changed from ${data.previousPlan} to ${data.newPlan}`);
    },
    onError: (error) => {
      toast.error(`Failed to change plan: ${error.message}`);
    },
  });
}

/**
 * Suspend or unsuspend an organization
 */
export function useSuspendOrganization() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      orgId,
      suspend,
      reason,
    }: {
      orgId: string;
      suspend: boolean;
      reason?: string;
    }) => {
      // Get current org data
      const { data: org, error: fetchError } = await supabase
        .from("organizations")
        .select("name, is_suspended")
        .eq("id", orgId)
        .single();

      if (fetchError) throw fetchError;

      // Update suspension status
      const updates = suspend
        ? {
            is_suspended: true,
            suspended_at: new Date().toISOString(),
            suspended_by: user?.id,
            suspension_reason: reason || null,
          }
        : {
            is_suspended: false,
            suspended_at: null,
            suspended_by: null,
            suspension_reason: null,
          };

      const { error: updateError } = await supabase
        .from("organizations")
        .update(updates)
        .eq("id", orgId);

      if (updateError) throw updateError;

      // Log action
      const { error: logError } = await supabase.from("admin_action_logs").insert({
        admin_user_id: user!.id,
        target_organization_id: orgId,
        target_organization_name: org?.name || "Unknown",
        action_type: suspend ? "suspend" : "unsuspend",
        previous_value: { is_suspended: org?.is_suspended },
        new_value: { is_suspended: suspend, reason },
      });

      if (logError) console.error("Error logging action:", logError);

      return { suspended: suspend, orgName: org?.name };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organization"] });
      queryClient.invalidateQueries({ queryKey: ["admin-action-logs"] });
      toast.success(
        data.suspended
          ? `${data.orgName} has been suspended`
          : `${data.orgName} has been unsuspended`
      );
    },
    onError: (error) => {
      toast.error(`Failed to update suspension: ${error.message}`);
    },
  });
}

/**
 * Archive or unarchive an organization
 */
export function useAdminArchiveOrganization() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orgId, archive }: { orgId: string; archive: boolean }) => {
      // Get current org data
      const { data: org, error: fetchError } = await supabase
        .from("organizations")
        .select("name, status")
        .eq("id", orgId)
        .single();

      if (fetchError) throw fetchError;

      // Update status
      const { error: updateError } = await supabase
        .from("organizations")
        .update({ status: archive ? "archived" : "active" })
        .eq("id", orgId);

      if (updateError) throw updateError;

      // Log action
      const { error: logError } = await supabase.from("admin_action_logs").insert({
        admin_user_id: user!.id,
        target_organization_id: orgId,
        target_organization_name: org?.name || "Unknown",
        action_type: archive ? "archive" : "unarchive",
        previous_value: { status: org?.status },
        new_value: { status: archive ? "archived" : "active" },
      });

      if (logError) console.error("Error logging action:", logError);

      return { archived: archive, orgName: org?.name };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organization"] });
      queryClient.invalidateQueries({ queryKey: ["admin-action-logs"] });
      toast.success(
        data.archived
          ? `${data.orgName} has been archived`
          : `${data.orgName} has been reactivated`
      );
    },
    onError: (error) => {
      toast.error(`Failed to update status: ${error.message}`);
    },
  });
}

/**
 * Delete an organization
 */
export function useAdminDeleteOrganization() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orgId, orgName }: { orgId: string; orgName: string }) => {
      // Log before deletion (since org will be deleted)
      const { error: logError } = await supabase.from("admin_action_logs").insert({
        admin_user_id: user!.id,
        target_organization_id: orgId,
        target_organization_name: orgName,
        action_type: "delete",
        previous_value: { id: orgId, name: orgName },
        new_value: null,
      });

      if (logError) console.error("Error logging action:", logError);

      // Delete organization
      const { error: deleteError } = await supabase
        .from("organizations")
        .delete()
        .eq("id", orgId);

      if (deleteError) throw deleteError;

      return { orgName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-action-logs"] });
      toast.success(`${data.orgName} has been deleted`);
    },
    onError: (error) => {
      toast.error(`Failed to delete organization: ${error.message}`);
    },
  });
}

/**
 * Update organization name or settings
 */
export function useAdminUpdateOrganization() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      orgId,
      updates,
      actionType = "edit_settings",
    }: {
      orgId: string;
      updates: Partial<{
        name: string;
        settings: Record<string, unknown>;
        limits: Record<string, unknown>;
      }>;
      actionType?: AdminActionType;
    }) => {
      // Get current org data
      const { data: org, error: fetchError } = await supabase
        .from("organizations")
        .select("name, settings, limits")
        .eq("id", orgId)
        .single();

      if (fetchError) throw fetchError;

      // Update organization
      const { error: updateError } = await supabase
        .from("organizations")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", orgId);

      if (updateError) throw updateError;

      // Log action
      const { error: logError } = await supabase.from("admin_action_logs").insert({
        admin_user_id: user!.id,
        target_organization_id: orgId,
        target_organization_name: org?.name || "Unknown",
        action_type: actionType,
        previous_value: { name: org?.name, settings: org?.settings, limits: org?.limits },
        new_value: updates,
      });

      if (logError) console.error("Error logging action:", logError);

      return { orgName: updates.name || org?.name };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organization"] });
      queryClient.invalidateQueries({ queryKey: ["admin-action-logs"] });
      toast.success(`${data.orgName} has been updated`);
    },
    onError: (error) => {
      toast.error(`Failed to update organization: ${error.message}`);
    },
  });
}
