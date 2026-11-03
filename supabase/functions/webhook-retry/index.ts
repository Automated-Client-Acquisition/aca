import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user identity
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { eventId } = await req.json();
    if (!eventId) {
      return new Response(
        JSON.stringify({ error: "eventId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the event and verify it belongs to user's org
    const { data: event, error: fetchError } = await serviceClient
      .from("webhook_event_log")
      .select("id, organization_id, status")
      .eq("id", eventId)
      .single();

    if (fetchError || !event) {
      return new Response(
        JSON.stringify({ error: "Webhook event not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is a member of the event's organization
    const { data: membership } = await serviceClient
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", event.organization_id)
      .maybeSingle();

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (event.status !== "failed") {
      return new Response(
        JSON.stringify({ error: "Only failed webhooks can be retried" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reset the event for retry
    const { error: updateError } = await serviceClient
      .from("webhook_event_log")
      .update({
        status: "pending",
        next_retry_at: null,
        error_message: null,
        attempt_count: 0,
      })
      .eq("id", eventId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to retry webhook" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Webhook queued for retry" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error retrying webhook:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
