import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Invitation, InviteUserForm } from "@/types/organization";
import { toast } from "sonner";

// Fetch invitations for an organization
export function useInvitations(organizationId?: string) {
  const { currentOrganization } = useAuth();
  const orgId = organizationId || currentOrganization?.id;

  return useQuery({
    queryKey: ["invitations", orgId],
    queryFn: async (): Promise<Invitation[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("invitations")
        .select(`
          id,
          email,
          organization_id,
          role,
          status,
          token,
          expires_at,
          invited_by,
          accepted_at,
          created_at,
          resent_count,
          last_resent_at,
          invited_by_user:users!invitations_invited_by_fkey (
            full_name,
            email
          )
        `)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching invitations:", error);
        throw error;
      }

      // Update status for expired invitations
      const now = new Date();
      return (data || []).map((inv) => {
        let status = inv.status;
        if (status === "pending" && new Date(inv.expires_at) < now) {
          status = "expired";
        }
        return {
          ...inv,
          status,
          invited_by_user: inv.invited_by_user as Invitation["invited_by_user"],
        };
      });
    },
    enabled: !!orgId,
  });
}

// Send a new invitation
export function useSendInvitation() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      email,
      role,
      organizationId,
    }: InviteUserForm & { organizationId?: string }) => {
      const orgId = organizationId || currentOrganization?.id;
      if (!orgId || !user) {
        throw new Error("Organization context not available");
      }

      // Check if user is already a member
      const { data: existingMember } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", (
          await supabase.from("users").select("id").eq("email", email).single()
        ).data?.id || "")
        .single();

      if (existingMember) {
        throw new Error("User is already a member of this organization");
      }

      // Check if there's already a pending invitation
      const { data: existingInvite } = await supabase
        .from("invitations")
        .select("id, status")
        .eq("organization_id", orgId)
        .eq("email", email)
        .eq("status", "pending")
        .single();

      if (existingInvite) {
        throw new Error("An invitation is already pending for this email");
      }

      // Generate token and expiration
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

      // Create invitation
      const { error } = await supabase.from("invitations").insert({
        email,
        organization_id: orgId,
        role,
        token,
        expires_at: expiresAt.toISOString(),
        invited_by: user.id,
        status: "pending",
        resent_count: 0,
      });

      if (error) throw error;

      // Get the invitation ID to send the email
      const { data: newInvitation } = await supabase
        .from("invitations")
        .select("id")
        .eq("token", token)
        .single();

      if (newInvitation) {
        // Send invitation email via edge function
        const { error: emailError } = await supabase.functions.invoke("send-invitation", {
          body: { invitationId: newInvitation.id },
        });

        if (emailError) {
          console.error("Failed to send invitation email:", emailError);
          // Don't throw - invitation was created, email just failed
        }
      }

      return { email, token };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success(`Invitation sent to ${data.email}`);
    },
    onError: (error) => {
      toast.error(`Failed to send invitation: ${error.message}`);
    },
  });
}

// Resend an invitation
export function useResendInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      // Get current invitation
      const { data: invitation, error: fetchError } = await supabase
        .from("invitations")
        .select("*")
        .eq("id", invitationId)
        .single();

      if (fetchError || !invitation) {
        throw new Error("Invitation not found");
      }

      // Generate new token and expiration
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Update invitation
      const { error } = await supabase
        .from("invitations")
        .update({
          token,
          expires_at: expiresAt.toISOString(),
          status: "pending",
          resent_count: (invitation.resent_count || 0) + 1,
          last_resent_at: new Date().toISOString(),
        })
        .eq("id", invitationId);

      if (error) throw error;

      // Send invitation email via edge function
      const { error: emailError } = await supabase.functions.invoke("send-invitation", {
        body: { invitationId },
      });

      if (emailError) {
        console.error("Failed to send invitation email:", emailError);
        // Don't throw - invitation was updated, email just failed
      }

      return invitation.email;
    },
    onSuccess: (email) => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success(`Invitation resent to ${email}`);
    },
    onError: (error) => {
      toast.error(`Failed to resend invitation: ${error.message}`);
    },
  });
}

// Cancel an invitation
export function useCancelInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase
        .from("invitations")
        .update({ status: "cancelled" })
        .eq("id", invitationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation cancelled");
    },
    onError: (error) => {
      toast.error(`Failed to cancel invitation: ${error.message}`);
    },
  });
}

// Delete an invitation
export function useDeleteInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase
        .from("invitations")
        .delete()
        .eq("id", invitationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete invitation: ${error.message}`);
    },
  });
}

// Accept an invitation (public, used on invitation accept page)
export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async ({
      token,
      password,
      fullName,
    }: {
      token: string;
      password?: string;
      fullName?: string;
    }) => {
      // Verify invitation - check for pending OR accepted (trigger may have already accepted it)
      const { data: invitation, error: fetchError } = await supabase
        .from("invitations")
        .select(`
          *,
          organization:organizations (
            name,
            slug
          )
        `)
        .eq("token", token)
        .in("status", ["pending", "accepted"])
        .single();

      if (fetchError || !invitation) {
        throw new Error("Invalid or expired invitation");
      }

      // If already accepted (by trigger), just return success
      if (invitation.status === "accepted") {
        return {
          organizationName: (invitation.organization as any)?.name,
          isNewUser: true,
          alreadyAccepted: true,
        };
      }

      // Check if expired
      if (new Date(invitation.expires_at) < new Date()) {
        throw new Error("This invitation has expired");
      }

      // Check if user already exists in users table
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", invitation.email)
        .single();

      let userId: string;

      if (existingUser) {
        // User exists, just add them to the organization
        userId = existingUser.id;
      } else {
        // Create new user account (fallback for non-Supabase-invite flow)
        if (!password) {
          throw new Error("Password required for new account");
        }

        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: invitation.email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });

        if (signUpError || !authData.user) {
          throw new Error(signUpError?.message || "Failed to create account");
        }

        userId = authData.user.id;
      }

      // Add user to organization_members (ignore if already exists)
      const { error: memberError } = await supabase
        .from("organization_members")
        .insert({
          user_id: userId,
          organization_id: invitation.organization_id,
          role: invitation.role || "member",
        });

      if (memberError && !memberError.message.includes("duplicate")) {
        throw memberError;
      }

      // Point the user at the invited org so they land there on next login
      await supabase
        .from("users")
        .update({ active_organization_id: invitation.organization_id })
        .eq("id", userId);

      // Update invitation status
      await supabase
        .from("invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", invitation.id);

      return {
        organizationName: (invitation.organization as any)?.name,
        isNewUser: !existingUser,
        alreadyAccepted: false,
      };
    },
    onSuccess: (data) => {
      if (data.alreadyAccepted) {
        toast.success(`Welcome to ${data.organizationName}!`);
      } else {
        toast.success(
          `Welcome to ${data.organizationName}!${
            data.isNewUser ? " Please check your email to verify your account." : ""
          }`
        );
      }
    },
    onError: (error) => {
      toast.error(`Failed to accept invitation: ${error.message}`);
    },
  });
}

// Get invitation by token (public)
export function useInvitationByToken(token: string | undefined) {
  return useQuery({
    queryKey: ["invitation-by-token", token],
    queryFn: async () => {
      if (!token) return null;

      const { data, error } = await supabase
        .from("invitations")
        .select(`
          id,
          email,
          role,
          status,
          expires_at,
          organization_id,
          organization:organizations (
            name,
            slug
          )
        `)
        .eq("token", token)
        .single();

      if (error) {
        throw new Error("Invitation not found");
      }

      // Check if expired
      const isExpired = new Date(data.expires_at) < new Date();
      // Valid if pending and not expired, or if just accepted (by trigger)
      const isValid = (data.status === "pending" && !isExpired) || data.status === "accepted";

      return {
        ...data,
        isExpired,
        isValid,
        organization: data.organization as { name: string; slug: string },
      };
    },
    enabled: !!token,
    retry: false,
  });
}
