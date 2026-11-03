import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CreateAccountPayload {
  request_id: string;
  email: string;
  full_name: string;
  plan_tier: "free" | "pro" | "enterprise";
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  const hostedOnly = hostedOnlyResponse("Community signup", corsHeaders);
  if (hostedOnly) return hostedOnly;


  const debugLog: string[] = [];
  const log = (msg: string) => {
    debugLog.push(msg);
    console.log(msg);
  };

  try {
    log("Step 1: Checking auth header");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", debug: debugLog }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log("Step 2: Creating Supabase clients");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    log("Step 3: Verifying user auth");
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      log("Auth error: " + JSON.stringify(authError));
      return new Response(
        JSON.stringify({ error: "Unauthorized", debug: debugLog }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    log("Step 3b: User verified: " + user.id);

    log("Step 4: Checking super admin status");
    const { data: userRecord, error: adminCheckError } = await supabaseAdmin
      .from("users")
      .select("is_super_admin")
      .eq("id", user.id)
      .single();

    log("Step 4b: Admin check result: " + JSON.stringify(userRecord) + " error: " + JSON.stringify(adminCheckError));

    if (!userRecord?.is_super_admin) {
      return new Response(
        JSON.stringify({ error: "Only super admins can create accounts", debug: debugLog }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log("Step 5: Parsing request body");
    let payload: CreateAccountPayload;
    try {
      const bodyText = await req.text();
      log("Step 5a: Raw body length: " + bodyText.length);
      payload = JSON.parse(bodyText);
      log("Step 5b: Parsed payload keys: " + Object.keys(payload).join(", "));
    } catch (parseError) {
      log("Step 5 ERROR: Failed to parse body: " + String(parseError));
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", details: String(parseError), debug: debugLog }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { request_id, email, full_name, plan_tier } = payload;

    if (!request_id || !email || !full_name || !plan_tier) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ATOMIC LOCK: Try to claim this request
    log("Step 5c: Attempting to atomically claim request");
    const { data: claimedRequest, error: claimError } = await supabaseAdmin
      .from("signup_requests")
      .update({
        status: "processing",
        updated_at: new Date().toISOString()
      })
      .eq("id", request_id)
      .eq("status", "approved")
      .is("created_user_id", null)
      .select("id, status, created_user_id, created_organization_id")
      .single();

    if (claimError || !claimedRequest) {
      log("Could not claim request: " + JSON.stringify(claimError));

      const { data: existingRequest } = await supabaseAdmin
        .from("signup_requests")
        .select("status, created_user_id, created_organization_id")
        .eq("id", request_id)
        .single();

      if (existingRequest?.created_user_id) {
        return new Response(
          JSON.stringify({
            success: true,
            already_processed: true,
            user_id: existingRequest.created_user_id,
            organization_id: existingRequest.created_organization_id,
            message: "Request was already processed",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (existingRequest?.status === "processing") {
        return new Response(
          JSON.stringify({
            success: false,
            in_progress: true,
            message: "Request is currently being processed",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Request not found or not ready for processing", status: existingRequest?.status }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log("Step 5d: Successfully claimed request, proceeding with account creation");

    log("Step 6: Checking if user exists");
    const { data: existingUsers } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    log("Step 6b: Existing user check: " + (existingUsers?.id || "not found"));
    if (existingUsers?.id) {
      await supabaseAdmin
        .from("signup_requests")
        .update({
          status: "approved",
          created_user_id: existingUsers.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request_id);

      return new Response(
        JSON.stringify({
          success: true,
          user_existed: true,
          user_id: existingUsers.id,
          message: "User already exists",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log("Step 7: Fetching signup request for additional data");
    const { data: signupRequest } = await supabaseAdmin
      .from("signup_requests")
      .select("source_data")
      .eq("id", request_id)
      .single();

    const skoolProfileUrl = signupRequest?.source_data?.skool_profile_url || null;
    const firstName = signupRequest?.source_data?.first_name || full_name.split(" ")[0] || null;
    const lastName = signupRequest?.source_data?.last_name || full_name.split(" ").slice(1).join(" ") || null;

    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";

    log("Step 8: Inviting user via native Supabase invite");
    // Use Supabase's native inviteUserByEmail - this is the proper way to invite users
    // It creates the user, generates a secure token, and sends the invite email
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/set-password`,
      data: {
        full_name,
        first_name: firstName,
        last_name: lastName,
        source: "community_signup",
      },
    });

    if (inviteError || !inviteData.user) {
      log("Error inviting user: " + JSON.stringify(inviteError));
      // Reset request status so it can be retried
      await supabaseAdmin
        .from("signup_requests")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", request_id);
      return new Response(
        JSON.stringify({ error: "Failed to invite user", details: JSON.stringify(inviteError), debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = inviteData.user.id;
    log("Step 8b: Invited user with ID: " + userId);

    // Generate organization slug from name
    const nameParts = full_name.toLowerCase().split(" ");
    const baseSlug = nameParts.join("-").replace(/[^a-z0-9-]/g, "");
    const orgSlug = `${baseSlug}-${Date.now().toString(36)}`;

    log("Step 9: Creating organization");
    const { data: newOrg, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: `${full_name}'s Workspace`,
        slug: orgSlug,
        type: "standalone",
        status: "active",
        plan_tier,
        settings: {},
        limits: {},
        current_usage: {
          daily: { generations: 0, cost: 0, date: new Date().toISOString().split("T")[0] },
          monthly: { generations: 0, cost: 0, month: new Date().toISOString().slice(0, 7) },
          all_time: { generations: 0, cost: 0 },
        },
      })
      .select()
      .single();

    if (orgError || !newOrg) {
      log("Error creating organization: " + JSON.stringify(orgError));
      // Rollback: delete the invited user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin
        .from("signup_requests")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", request_id);
      return new Response(
        JSON.stringify({ error: "Failed to create organization", details: JSON.stringify(orgError), debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log("Step 10: Creating user record in users table");
    const { error: userRecordError } = await supabaseAdmin
      .from("users")
      .insert({
        id: userId,
        organization_id: newOrg.id,
        email,
        full_name,
        first_name: firstName,
        last_name: lastName,
        skool_profile_url: skoolProfileUrl,
        role: "owner",
      });

    if (userRecordError) {
      log("Error creating user record: " + JSON.stringify(userRecordError));
    }

    log("Step 11: Adding user as organization member");
    const { error: memberError } = await supabaseAdmin
      .from("organization_members")
      .insert({
        organization_id: newOrg.id,
        user_id: userId,
        role: "owner",
        is_primary_owner: true,
      });

    if (memberError) {
      log("Error adding organization member: " + JSON.stringify(memberError));
    }

    log("Step 12: Creating organization settings");
    const { error: settingsError } = await supabaseAdmin
      .from("organization_settings")
      .insert({
        organization_id: newOrg.id,
        onboarding_completed: false,
        onboarding_step: 'welcome'
      });

    if (settingsError) {
      log("Error creating organization settings: " + JSON.stringify(settingsError));
    }

    log("Step 13: Updating signup request as completed");
    await supabaseAdmin
      .from("signup_requests")
      .update({
        status: "approved",
        created_user_id: userId,
        created_organization_id: newOrg.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request_id);

    log(`Created account for ${email} with org ${newOrg.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        organization_id: newOrg.id,
        message: "Account created successfully. Invite email sent.",
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log("CATCH ERROR: " + errorMessage);
    log("Stack: " + errorStack);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: errorMessage, debug: debugLog }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
