import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { APP_URL } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendInvitationRequest {
  invitationId: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth verification
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service client for database operations and admin auth
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    const { invitationId }: SendInvitationRequest = await req.json();

    if (!invitationId) {
      return new Response(
        JSON.stringify({ error: "Invitation ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch invitation details
    const { data: invitation, error: invitationError } = await serviceClient
      .from("invitations")
      .select(`
        id,
        email,
        token,
        role,
        organization_id,
        invited_by,
        organizations (
          name,
          slug,
          type
        )
      `)
      .eq("id", invitationId)
      .single();

    if (invitationError || !invitation) {
      console.error("Invitation fetch error:", invitationError);
      return new Response(
        JSON.stringify({ error: "Invitation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user has permission to send this invitation
    // (they should be the one who created it or an admin of the org)
    const { data: memberData } = await serviceClient
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", invitation.organization_id)
      .single();

    const canSend = invitation.invited_by === user.id ||
      ["owner", "admin"].includes(memberData?.role || "");

    if (!canSend) {
      return new Response(
        JSON.stringify({ error: "You don't have permission to send this invitation" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the redirect URL for password setup
    // After Supabase verifies the token, user will be redirected here to set their password.
    // app.automatedclientacquisition.com has no live Vercel deployment - www is the real app.
    const appUrl = APP_URL;
    const setPasswordUrl = `${appUrl}/auth/set-password`;

    // Get organization name for the invite
    const orgName = (invitation.organizations as any)?.name || "the organization";

    // Use Supabase Auth Admin to invite the user
    // This sends the email via the configured SMTP (Resend)
    // The user will be redirected to set-password page where they can create their password
    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
      invitation.email,
      {
        redirectTo: setPasswordUrl,
        data: {
          invitation_id: invitation.id,
          organization_id: invitation.organization_id,
          organization_name: orgName,
          role: invitation.role || "member",
          invitation_token: invitation.token,
        }
      }
    );

    if (inviteError) {
      console.error("Supabase invite error:", inviteError);
      return new Response(
        JSON.stringify({ error: inviteError.message || "Failed to send invitation email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Invitation sent successfully via Supabase Auth:", inviteData);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation email sent to ${invitation.email}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-invitation:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
