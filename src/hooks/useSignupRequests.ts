import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PlanTier } from "@/types/admin";

export type SignupRequestStatus = "pending" | "approved" | "rejected";

export interface SignupRequest {
  id: string;
  email: string;
  full_name: string;
  skool_username: string | null;
  source: string;
  source_data: Record<string, unknown>;
  status: SignupRequestStatus;
  assigned_plan_tier: PlanTier | null;
  processed_by: string | null;
  processed_at: string | null;
  rejection_reason: string | null;
  admin_notes: string | null;
  created_user_id: string | null;
  created_organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignupRequestStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

/**
 * Hook to fetch all signup requests
 */
export function useSignupRequests(status?: SignupRequestStatus) {
  return useQuery({
    queryKey: ["signup-requests", status],
    queryFn: async () => {
      let query = supabase
        .from("signup_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (status) {
        query = query.eq("status", status);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching signup requests:", error);
        throw error;
      }

      return data as SignupRequest[];
    },
  });
}

/**
 * Hook to fetch signup request stats
 */
export function useSignupRequestStats() {
  return useQuery({
    queryKey: ["signup-request-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_signup_request_stats");

      if (error) {
        console.error("Error fetching signup request stats:", error);
        throw error;
      }

      return data as SignupRequestStats;
    },
  });
}

/**
 * Hook to approve a signup request
 */
export function useApproveSignupRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      planTier,
      adminNotes,
    }: {
      requestId: string;
      planTier: PlanTier;
      adminNotes?: string;
    }) => {
      // First, approve the request in the database
      const { data: approveResult, error: approveError } = await supabase.rpc(
        "approve_signup_request",
        {
          p_request_id: requestId,
          p_plan_tier: planTier,
          p_admin_notes: adminNotes || null,
        }
      );

      if (approveError) {
        throw approveError;
      }

      const result = approveResult as {
        success: boolean;
        error?: string;
        user_existed?: boolean;
        needs_account_creation?: boolean;
        email?: string;
        full_name?: string;
        plan_tier?: string;
      };

      if (!result.success) {
        throw new Error(result.error || "Failed to approve request");
      }

      // If user already exists, we're done
      if (result.user_existed) {
        return { ...result, message: "User already exists - request approved" };
      }

      // If we need to create the account, call the Edge Function
      if (result.needs_account_creation) {
        const { data: createResult, error: createError } = await supabase.functions.invoke(
          "create-community-account",
          {
            body: {
              request_id: requestId,
              email: result.email,
              full_name: result.full_name,
              plan_tier: result.plan_tier,
            },
          }
        );

        if (createError) {
          // Log the full response for debugging
          console.error("Edge function error:", createError);
          console.error("Edge function response data:", createResult);
          // Try to get error details from the response
          if (createError.context) {
            try {
              const errorBody = await createError.context.json();
              console.error("Edge function error body:", errorBody);
            } catch (e) {
              console.error("Could not parse error body");
            }
          }
          throw createError;
        }

        return createResult;
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signup-requests"] });
      queryClient.invalidateQueries({ queryKey: ["signup-request-stats"] });
      toast.success("Signup request approved! Account created and invitation sent.");
    },
    onError: (error) => {
      console.error("Error approving signup request:", error);
      toast.error(`Failed to approve request: ${error.message}`);
    },
  });
}

/**
 * Hook to reject a signup request
 */
export function useRejectSignupRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      reason,
    }: {
      requestId: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc("reject_signup_request", {
        p_request_id: requestId,
        p_reason: reason || null,
      });

      if (error) {
        throw error;
      }

      const result = data as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || "Failed to reject request");
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signup-requests"] });
      queryClient.invalidateQueries({ queryKey: ["signup-request-stats"] });
      toast.success("Signup request rejected");
    },
    onError: (error) => {
      console.error("Error rejecting signup request:", error);
      toast.error(`Failed to reject request: ${error.message}`);
    },
  });
}
