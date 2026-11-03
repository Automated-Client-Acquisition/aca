import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { checkFeatureAccess } from '../_shared/featureAccess.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LeadRow {
  id: string;
  organization_id: string;
  campaign_id: string;
  crm_contact_id: string | null;
  commenter_name: string | null;
  campaign: {
    id: string;
    name: string;
    lead_magnet_url: string | null;
    lead_magnet_title: string | null;
  } | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRole) {
    return json({ error: "Missing server configuration" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRole);

  try {
    const url = new URL(req.url);
    const leadId =
      url.searchParams.get("lead_id") ||
      (req.method === "POST" ? await extractLeadId(req.clone()) : null);

    if (!leadId) {
      return htmlError("Missing lead identifier", 400);
    }

    const { data: lead, error: leadError } = await supabase
      .from("unipile_leads")
      .select(`
        id,
        organization_id,
        campaign_id,
        crm_contact_id,
        commenter_name,
        campaign:unipile_campaigns(id, name, lead_magnet_url, lead_magnet_title)
      `)
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      return htmlError("Lead not found", 404);
    }

    const typedLead = lead as unknown as LeadRow;

    // Check feature access for lead magnets
    const featureCheck = await checkFeatureAccess(supabase, typedLead.organization_id, 'lead_magnets');
    if (!featureCheck.allowed) {
      return htmlError("This feature requires a Pro plan", 403);
    }

    const resourceUrl = typedLead.campaign?.lead_magnet_url;

    if (!resourceUrl) {
      return htmlError("Resource not configured", 400);
    }

    if (req.method === "GET") {
      await logEvent(supabase, typedLead, "page_view", {
        path: "gate",
        user_agent: req.headers.get("user-agent"),
      });

      const { data: existingCapture } = await supabase
        .from("lead_magnet_captures")
        .select("id")
        .eq("lead_id", typedLead.id)
        .maybeSingle();

      if (existingCapture) {
        await logEvent(supabase, typedLead, "resource_click", {
          source: "auto_redirect_after_existing_capture",
        });

        return redirect(resourceUrl);
      }

      return new Response(renderGatePage(typedLead), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (req.method !== "POST") {
      return htmlError("Method not allowed", 405);
    }

    const { email } = await extractSubmission(req);
    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return htmlError("Please provide a valid email address.", 400);
    }

    await supabase
      .from("lead_magnet_captures")
      .upsert(
        {
          organization_id: typedLead.organization_id,
          campaign_id: typedLead.campaign_id,
          lead_id: typedLead.id,
          email: normalizedEmail,
          source: "gate_page",
          captured_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "lead_id" },
      );

    // Mark lead as converted after successful capture on the gate.
    await supabase
      .from("unipile_leads")
      .update({ status: "converted" })
      .eq("id", typedLead.id)
      .in("status", ["pending", "dm_sent", "awaiting_connection", "comment_replied", "ai_chatting", "scoring", "low_icp", "comment_reply_failed"]);

    if (typedLead.crm_contact_id) {
      await supabase
        .from("crm_contacts")
        .update({
          primary_email: normalizedEmail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", typedLead.crm_contact_id)
        .or("primary_email.is.null,primary_email.eq.");
    }

    await logEvent(supabase, typedLead, "email_captured", {
      email_domain: normalizedEmail.split("@")[1] || null,
      source: "gate_page",
    });

    await logEvent(supabase, typedLead, "resource_click", {
      source: "post_capture_redirect",
    });

    // Auto-enroll in email sequence if configured
    try {
      const { data: campaign } = await supabase
        .from("unipile_campaigns")
        .select("smart_config")
        .eq("id", typedLead.campaign_id)
        .single();

      const smartConfig = campaign?.smart_config as Record<string, unknown> | null;
      const targetSequenceId = smartConfig?.email_capture_sequence_id as string | null;

      if (targetSequenceId && typedLead.crm_contact_id) {
        // Resolve CRM contact → leads table ID (enrollments expect leads.id, not crm_contacts.id)
        const { data: linkedLead } = await supabase
          .from("leads")
          .select("id")
          .eq("crm_contact_id", typedLead.crm_contact_id)
          .limit(1)
          .maybeSingle();

        const enrollLeadId = linkedLead?.id;
        if (!enrollLeadId) {
          console.warn(`[lead-magnet-gate] No leads record for CRM contact ${typedLead.crm_contact_id}, skipping enrollment`);
        } else {
          // Check lead isn't already enrolled in this sequence
          const { data: existing } = await supabase
            .from("email_sequence_enrollments")
            .select("id")
            .eq("sequence_id", targetSequenceId)
            .eq("lead_id", enrollLeadId)
            .eq("status", "active")
            .maybeSingle();

          if (!existing) {
            // Check target sequence is active
            const { data: targetSeq } = await supabase
              .from("email_sequences")
              .select("id, status")
              .eq("id", targetSequenceId)
              .single();

            if (targetSeq?.status === "active") {
              await supabase
                .from("email_sequence_enrollments")
                .insert({
                  sequence_id: targetSequenceId,
                  lead_id: enrollLeadId,
                  organization_id: typedLead.organization_id,
                  status: "active",
                  current_step: 0,
                  next_send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h delay
                  metadata: {
                    source: "lead_magnet_capture",
                    lead_magnet_campaign_id: typedLead.campaign_id,
                    captured_email: normalizedEmail,
                  },
                });

              console.log(`[lead-magnet-gate] Auto-enrolled lead ${enrollLeadId} in sequence ${targetSequenceId}`);
            }
          }
        }
      }
    } catch (enrollError) {
      // Non-critical — don't fail the gate page if enrollment fails
      console.error("[lead-magnet-gate] Auto-enrollment error:", enrollError);
    }

    return redirect(resourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[lead-magnet-gate]", message);
    return htmlError("Something went wrong. Please try again.", 500);
  }
});

async function logEvent(
  supabase: SupabaseClient<any>,
  lead: LeadRow,
  eventType: "page_view" | "email_captured" | "resource_click",
  metadata: Record<string, unknown>,
) {
  await supabase.from("lead_magnet_events").insert({
    organization_id: lead.organization_id,
    campaign_id: lead.campaign_id,
    lead_id: lead.id,
    event_type: eventType,
    event_metadata: metadata,
  });
}

async function extractLeadId(req: Request): Promise<string | null> {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      return body?.lead_id || null;
    }
    const form = await req.formData();
    const value = form.get("lead_id");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function extractSubmission(req: Request): Promise<{ email: string }> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json();
    return { email: String(body?.email || "") };
  }

  const form = await req.formData();
  return { email: String(form.get("email") || "") };
}

function renderGatePage(lead: LeadRow): string {
  const safeCampaignName = escapeHtml(lead.campaign?.name || "Resource Access");
  const safeTitle = escapeHtml(lead.campaign?.lead_magnet_title || "Get instant access");
  const safeName = escapeHtml(lead.commenter_name || "there");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeCampaignName}</title>
  <style>
    :root { color-scheme: light; }
    body {
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(140deg, #f8fafc, #e2e8f0);
      color: #0f172a;
    }
    .card {
      width: min(480px, calc(100vw - 32px));
      background: #fff;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      padding: 28px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
    }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
    p { margin: 0 0 18px; color: #475569; }
    .label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; }
    .input {
      width: 100%; box-sizing: border-box; padding: 12px 14px; font-size: 15px;
      border-radius: 10px; border: 1px solid #cbd5e1; margin-bottom: 12px;
    }
    .btn {
      width: 100%; border: 0; border-radius: 10px; padding: 12px 14px;
      background: #0f172a; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer;
    }
    .foot { margin-top: 12px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${safeTitle}</h1>
    <p>Hey ${safeName}, enter your best email and we will send you straight to your resource.</p>
    <form method="POST">
      <input type="hidden" name="lead_id" value="${lead.id}" />
      <label for="email" class="label">Email address</label>
      <input id="email" class="input" type="email" name="email" required placeholder="you@company.com" />
      <button class="btn" type="submit">Get Instant Access</button>
    </form>
    <p class="foot">By continuing, you agree to receive the requested resource.</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: location,
      "Cache-Control": "no-store",
    },
  });
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function htmlError(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;"><h2>Lead magnet unavailable</h2><p>${escapeHtml(message)}</p></body></html>`,
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}
