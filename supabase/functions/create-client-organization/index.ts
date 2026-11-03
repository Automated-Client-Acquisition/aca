import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CreateClientRequest {
  name: string;
  slug?: string;
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

    // Create Supabase client with user's token
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

    // Service client for elevated operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    const { name, slug }: CreateClientRequest = await req.json();

    if (!name || name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Client name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's current organization
    const { data: userData, error: userDataError } = await serviceClient
      .from("users")
      .select("organization_id, active_organization_id")
      .eq("id", user.id)
      .single();

    if (userDataError || !userData) {
      return new Response(
        JSON.stringify({ error: "Could not fetch user data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parentOrgId = userData.active_organization_id || userData.organization_id;

    // Check user's role in the parent organization
    const { data: memberData } = await serviceClient
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", parentOrgId)
      .single();

    // Also check if user is super admin
    const { data: superAdminData } = await serviceClient
      .from("users")
      .select("is_super_admin")
      .eq("id", user.id)
      .single();

    // Check if user is the org creator
    const { data: orgData } = await serviceClient
      .from("organizations")
      .select("created_by_user_id")
      .eq("id", parentOrgId)
      .single();

    const userRole = memberData?.role;
    const isSuperAdmin = superAdminData?.is_super_admin;
    const isOrgCreator = orgData?.created_by_user_id === user.id;

    // Allow: super admins, owners, admins, or org creators
    const canCreateClient = isSuperAdmin ||
      ["owner", "admin"].includes(userRole || "") ||
      isOrgCreator;

    if (!canCreateClient) {
      return new Response(
        JSON.stringify({ error: "Only owners and admins can create client organizations" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate slug from name if not provided
    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Check if slug is unique
    const { data: existingOrgs } = await serviceClient
      .from("organizations")
      .select("id")
      .eq("slug", finalSlug)
      .limit(1);

    if (existingOrgs && existingOrgs.length > 0) {
      return new Response(
        JSON.stringify({ error: "An organization with this slug already exists" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the client organization
    const { data: newOrg, error: createError } = await serviceClient
      .from("organizations")
      .insert({
        name: name.trim(),
        slug: finalSlug,
        type: "client",
        parent_id: parentOrgId,
        created_by_user_id: user.id,
        status: "active",
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating organization:", createError);
      return new Response(
        JSON.stringify({ error: "Failed to create client organization" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create organization_settings for the new client
    // Client orgs skip onboarding wizard, so mark as completed to enable the checklist
    await serviceClient.from("organization_settings").insert({
      organization_id: newOrg.id,
      onboarding_completed: true,
      checklist_dismissed: false,
      api_key_strategy: "inherit",
      inherit_api_keys_from_parent: true,
    });

    // Update parent org type to 'agency' if not already
    await serviceClient
      .from("organizations")
      .update({ type: "agency" })
      .eq("id", parentOrgId)
      .neq("type", "agency");

    // Add the creating user to the new org as owner
    const { error: memberError } = await serviceClient.from("organization_members").insert({
      user_id: user.id,
      organization_id: newOrg.id,
      role: "owner",
      is_primary_owner: true,
    });

    if (memberError) {
      console.error("Error adding member:", memberError);
    }

    // Also add to user_organizations if that table is used (upsert to handle conflicts)
    const { error: userOrgError } = await serviceClient
      .from("user_organizations")
      .upsert({
        user_id: user.id,
        organization_id: newOrg.id,
      }, { onConflict: "user_id,organization_id" });

    if (userOrgError) {
      console.error("Error adding user_organization:", userOrgError);
    }

    // Update user's can_access_organizations
    const { data: currentUser } = await serviceClient
      .from("users")
      .select("can_access_organizations")
      .eq("id", user.id)
      .single();

    const currentOrgs = currentUser?.can_access_organizations || [];
    if (!currentOrgs.includes(newOrg.id)) {
      const { error: updateError } = await serviceClient
        .from("users")
        .update({
          can_access_organizations: [...currentOrgs, newOrg.id],
        })
        .eq("id", user.id);

      if (updateError) {
        console.error("Error updating can_access_organizations:", updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        organization: newOrg,
        message: `Client "${name}" created successfully`
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in create-client-organization:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
