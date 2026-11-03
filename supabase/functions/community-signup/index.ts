import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GHLWebhookPayload {
  // Standard GHL form fields - adapt based on your actual GHL form field names
  email?: string;
  Email?: string;
  full_name?: string;
  fullName?: string;
  name?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  skool_username?: string;
  skoolUsername?: string;
  skool_profile?: string;
  skoolProfile?: string;
  // GHL may nest data
  contact?: {
    email?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  };
  // Raw fields for flexibility
  [key: string]: unknown;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  const hostedOnly = hostedOnlyResponse("Community signup", corsHeaders);
  if (hostedOnly) return hostedOnly;


  try {
    // Parse request body - handle both JSON and form-encoded data
    let payload: GHLWebhookPayload;
    const contentType = req.headers.get("content-type") || "";
    const rawBody = await req.text();

    console.log("Content-Type:", contentType);
    console.log("Raw body:", rawBody);

    if (contentType.includes("application/x-www-form-urlencoded")) {
      // Parse form-encoded data manually
      payload = {} as GHLWebhookPayload;
      const params = new URLSearchParams(rawBody);
      for (const [key, value] of params.entries()) {
        (payload as Record<string, unknown>)[key] = value;
      }
    } else {
      // Parse JSON
      payload = rawBody ? JSON.parse(rawBody) : {};
    }

    console.log("Parsed webhook payload:", JSON.stringify(payload, null, 2));

    // Extract email (try multiple field names) - handle non-string values safely
    const rawEmail = payload.email || payload.Email || payload.contact?.email || "";
    const email = (typeof rawEmail === "string" ? rawEmail : String(rawEmail || "")).trim().toLowerCase();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract full name (try multiple field names and combinations) - handle non-string values safely
    const toString = (val: unknown): string => (typeof val === "string" ? val : String(val || "")).trim();

    let fullName = "";
    if (payload.full_name) {
      fullName = toString(payload.full_name);
    } else if (payload.fullName) {
      fullName = toString(payload.fullName);
    } else if (payload.name) {
      fullName = toString(payload.name);
    } else if (payload.contact?.name) {
      fullName = toString(payload.contact.name);
    } else {
      // Try to combine first and last name
      const firstName = toString(payload.firstName || payload.first_name || payload.contact?.firstName || "");
      const lastName = toString(payload.lastName || payload.last_name || payload.contact?.lastName || "");
      fullName = `${firstName} ${lastName}`.trim();
    }

    if (!fullName) {
      return new Response(
        JSON.stringify({ error: "Full name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract Skool username (try multiple field names including GHL's "Skool profile url")
    const rawSkool = payload.skool_username || payload.skoolUsername || payload.skool_profile || payload.skoolProfile || payload["Skool profile url"] || "";
    const skoolUsername = toString(rawSkool);

    // Create Supabase client with service role for admin operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if there's already a pending request for this email
    const { data: existingRequest } = await supabase
      .from("signup_requests")
      .select("id, status")
      .eq("email", email)
      .eq("status", "pending")
      .single();

    if (existingRequest) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Signup request already exists",
          request_id: existingRequest.id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to check if user already has an account (non-blocking if admin API unavailable)
    try {
      const { data: usersData } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000, // Get all users to filter client-side
      });

      const existingUser = usersData?.users?.find(
        (u) => u.email?.toLowerCase() === email
      );

      if (existingUser) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "An account with this email already exists",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (adminErr) {
      // Admin API may not be available - continue without this check
      console.log("Admin API check skipped:", adminErr);
    }

    // Insert signup request
    const { data: request, error: insertError } = await supabase
      .from("signup_requests")
      .insert({
        email,
        full_name: fullName,
        skool_username: skoolUsername || null,
        source: "ghl",
        source_data: payload,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting signup request:", insertError);

      // Handle unique constraint violation (duplicate pending request)
      if (insertError.code === "23505") {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Signup request already exists",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to create signup request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Created signup request:", request.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Signup request created successfully",
        request_id: request.id,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error processing webhook:", errorMessage, error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: errorMessage,
        hint: "Check if the webhook payload contains email and full_name fields"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
