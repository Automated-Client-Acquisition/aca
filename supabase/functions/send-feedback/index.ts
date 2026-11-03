import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { OPS_ALERT_EMAIL, fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FeedbackRequest {
  topic: string;
  feedback: string;
  images?: string[];
  userEmail?: string;
  userId?: string;
  url?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const { topic, feedback, images, userEmail, userId, url }: FeedbackRequest = await req.json();

    if (!topic || !feedback) {
      return new Response(
        JSON.stringify({ error: "Topic and feedback are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const topicLabels: Record<string, string> = {
      bug: "Bug Report",
      feature: "Feature Request",
      improvement: "Improvement Suggestion",
      question: "Question",
      other: "Other",
    };

    // Build email HTML
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; border-bottom: 2px solid #7c3aed; padding-bottom: 10px;">
          New Feedback: ${topicLabels[topic] || topic}
        </h2>

        <div style="background: #f3f0ff; border: 2px solid #7c3aed; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">From:</p>
          <p style="margin: 0; color: #1f2937; font-weight: 600; font-size: 18px;">${userEmail || "Anonymous"}</p>
          ${userId ? `<p style="margin: 8px 0 0 0; color: #6b7280; font-size: 12px;">User ID: ${userId}</p>` : ""}
        </div>

        ${url ? `
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Page URL:</p>
          <a href="${url}" style="color: #7c3aed; word-break: break-all;">${url}</a>
        </div>
        ` : ""}

        <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Feedback:</p>
          <p style="margin: 0; color: #111827; white-space: pre-wrap; line-height: 1.6;">${feedback}</p>
        </div>

        ${images && images.length > 0 ? `
        <div style="margin: 16px 0;">
          <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 14px;">Attachments (${images.length} image${images.length > 1 ? "s" : ""}):</p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${images.map((img, i) => `
              <img src="${img}" alt="Attachment ${i + 1}" style="max-width: 200px; max-height: 200px; border-radius: 8px; border: 1px solid #e5e7eb;" />
            `).join("")}
          </div>
        </div>
        ` : ""}

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
          <p>Sent from ACA</p>
          <p>Timestamp: ${new Date().toISOString()}</p>
        </div>
      </div>
    `;

    // Send email via Resend
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress("team"),
        to: [OPS_ALERT_EMAIL],
        subject: `[Feedback] ${topicLabels[topic] || topic} - ${userEmail || "Anonymous"}`,
        html: emailHtml,
        reply_to: userEmail || undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Resend API error:", errorData);
      throw new Error(`Failed to send email: ${response.status}`);
    }

    const result = await response.json();
    console.log("Feedback email sent:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Feedback sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-feedback:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
