import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient , type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { authenticateRequest } from "../_shared/cli-auth.ts";
import { enqueueCampaignEntryEvent } from "../_shared/campaign-entry-events.ts";
import { buildExternalCampaignEntryEvent } from "../_shared/campaign-entry-source-adapters.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Supported actions from n8n.
 *
 * `create_task` used to be listed here with no `case` to handle it, so it fell
 * through to "Unknown action" — there is no task table in this schema. It is
 * gone rather than stubbed: an action name that always fails is worse than one
 * that does not exist, because a workflow author reads the list as a promise.
 */
type ActionType =
  | "send_message"
  | "add_tag"
  | "remove_tag"
  | "change_stage"
  | "update_score"
  | "add_note"
  | "enroll_in_sequence"
  | "remove_from_sequence"
  | "set_ai_handling"
  | "assign_to_user"
  | "campaign_event";

interface N8nPayload {
  // Identification
  organization_id: string;
  webhook_secret?: string; // For verification

  // Action
  action: ActionType;

  // Targeting (at least one required)
  contact_id?: string;
  conversation_id?: string;
  contact_email?: string;
  contact_phone?: string;

  // Action-specific data
  data: Record<string, unknown>;

  // Optional: Reference to original event
  source_event_id?: string;
  source_webhook_id?: string;
}

interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse payload
    const payload: N8nPayload = await req.json();

    if (!payload.action) {
      return new Response(JSON.stringify({ error: "action is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    /*
     * Two ways in, and one of them must succeed.
     *
     * 1. `Authorization: Bearer aca_…` — the same organization-scoped token the
     *    rest of /v1 uses. The organization comes from the token, so the caller
     *    does not paste a UUID and cannot address someone else's tenant. This is
     *    what the n8n community node uses, and it is why that node needs only one
     *    credential: a second credential carrying `x-webhook-secret` would have
     *    to be attached to every request, leaking the secret onto ordinary reads.
     *
     * 2. `x-webhook-secret` + `organization_id` in the body — the original shape,
     *    kept for anyone already wired up that way.
     *
     * Previously the secret check was skipped entirely when an organization had
     * no `webhook_secret` set, which left every action reachable by anyone who
     * knew the organization UUID. Now a request that presents neither credential
     * is rejected.
     */
    let organizationId: string | null = null;

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const caller = await authenticateRequest(req, supabase);
        organizationId = caller.organization_id;
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid or revoked API token" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!organizationId) {
        return new Response(
          JSON.stringify({ error: "This endpoint requires an organization-scoped API token" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // A token that names a different tenant than the body is a bug worth
      // surfacing, not something to silently resolve in the token's favour.
      if (payload.organization_id && payload.organization_id !== organizationId) {
        return new Response(
          JSON.stringify({ error: "organization_id does not match the API token" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      if (!payload.organization_id) {
        return new Response(
          JSON.stringify({ error: "organization_id is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data: webhookSettings } = await supabase
        .from("organization_webhook_settings")
        .select("webhook_secret")
        .eq("organization_id", payload.organization_id)
        .maybeSingle();

      const providedSecret =
        payload.webhook_secret || req.headers.get("x-webhook-secret");

      if (!webhookSettings?.webhook_secret || providedSecret !== webhookSettings.webhook_secret) {
        return new Response(
          JSON.stringify({ error: "Invalid webhook secret" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      organizationId = payload.organization_id;
    }

    // Everything downstream reads payload.organization_id; pin it to whatever
    // authentication actually established.
    payload.organization_id = organizationId;

    // The service-role client bypasses RLS, and every handler acts on these ids
    // directly: a caller-supplied id from another tenant must be rejected here.
    const notFound = (what: string) =>
      new Response(JSON.stringify({ error: `${what} not found` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    if (payload.contact_id) {
      const { data: ownedContact } = await supabase
        .from("crm_contacts")
        .select("id")
        .eq("id", payload.contact_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!ownedContact) return notFound("Contact");
    }
    if (payload.conversation_id) {
      const { data: ownedConversation } = await supabase
        .from("crm_conversations")
        .select("id")
        .eq("id", payload.conversation_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!ownedConversation) return notFound("Conversation");
    }

    // Resolve contact ID if not provided directly
    let contactId = payload.contact_id;

    if (!contactId && payload.contact_email) {
      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("id")
        .eq("organization_id", payload.organization_id)
        .eq("primary_email", payload.contact_email)
        .maybeSingle();
      contactId = contact?.id;
    }

    if (!contactId && payload.contact_phone) {
      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("id")
        .eq("organization_id", payload.organization_id)
        .eq("primary_phone", payload.contact_phone)
        .maybeSingle();
      contactId = contact?.id;
    }

    if (!contactId && payload.conversation_id) {
      const { data: conversation } = await supabase
        .from("crm_conversations")
        .select("contact_id")
        .eq("id", payload.conversation_id)
        .maybeSingle();
      contactId = conversation?.contact_id;
    }

    // Validate and sanitize event evidence before storing the integration log.
    // Provider invitation decisions can only originate from ACA's server poller.
    let campaignEvent: ReturnType<typeof buildExternalCampaignEntryEvent> | undefined;
    if (payload.action === "campaign_event") {
      try {
        campaignEvent = buildExternalCampaignEntryEvent(
          organizationId,
          contactId,
          payload.data,
          payload.source_event_id,
        );
      } catch (eventError) {
        return new Response(JSON.stringify({
          success: false,
          message: eventError instanceof Error ? eventError.message : "Invalid campaign event",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Log the incoming message
    const { data: incomingMessage, error: logError } = await supabase
      .from("webhook_incoming_messages")
      .insert({
        organization_id: payload.organization_id,
        source_webhook_id: payload.source_webhook_id,
        source_event_id: payload.source_event_id,
        action: payload.action,
        action_data: campaignEvent ? {
          event_id: campaignEvent.eventId,
          type: campaignEvent.type,
          campaign_id: campaignEvent.campaignId,
          channel: campaignEvent.channel,
          text: campaignEvent.text,
          post_id: campaignEvent.postId,
          signal_type: campaignEvent.signalType,
          event_name: campaignEvent.eventName,
          metadata: campaignEvent.context?.metadata,
        } : payload.data,
        contact_id: contactId,
        conversation_id: payload.conversation_id,
        status: "processing",
      })
      .select()
      .single();

    if (logError) {
      console.error("Failed to log incoming message:", logError);
    }

    // Execute the action
    let result: ActionResult;

    try {
      switch (payload.action) {
        case "send_message":
          result = await handleSendMessage(
            supabase,
            payload.organization_id,
            contactId,
            payload.conversation_id,
            payload.data
          );
          break;

        case "add_tag":
          result = await handleAddTag(
            supabase,
            payload.organization_id,
            contactId!,
            payload.data
          );
          break;

        case "remove_tag":
          result = await handleRemoveTag(
            supabase,
            payload.organization_id,
            contactId!,
            payload.data
          );
          break;

        case "change_stage":
          result = await handleChangeStage(
            supabase,
            payload.organization_id,
            contactId!,
            payload.data
          );
          break;

        case "update_score":
          result = await handleUpdateScore(
            supabase,
            contactId!,
            payload.data
          );
          break;

        case "add_note":
          result = await handleAddNote(
            supabase,
            payload.organization_id,
            contactId!,
            payload.data
          );
          break;

        case "enroll_in_sequence":
          result = await handleEnrollInSequence(
            payload.organization_id,
            contactId!,
            payload.data
          );
          break;

        case "remove_from_sequence":
          result = await handleRemoveFromSequence(
            supabase,
            payload.organization_id,
            contactId,
            payload.data
          );
          break;

        case "set_ai_handling":
          result = await handleSetAiHandling(
            supabase,
            payload.conversation_id!,
            payload.data
          );
          break;

        case "assign_to_user":
          result = await handleAssignToUser(
            supabase,
            payload.conversation_id!,
            payload.data
          );
          break;

        case "campaign_event": {
          const queued = await enqueueCampaignEntryEvent(supabase, campaignEvent!);
          result = {
            success: true,
            message: queued.queued > 0 ? "Campaign event queued" : queued.duplicate > 0 ? "Campaign event already received" : "No active campaign trigger matched",
            data: { queued: queued.queued, duplicates: queued.duplicate, event_ids: queued.eventIds },
          };
          break;
        }

        default:
          result = {
            success: false,
            message: `Unknown action: ${payload.action}`,
          };
      }
    } catch (actionError) {
      result = {
        success: false,
        message: actionError instanceof Error ? actionError.message : "Action failed",
      };
    }

    // Update the incoming message log
    if (incomingMessage) {
      await supabase
        .from("webhook_incoming_messages")
        .update({
          status: result.success ? "completed" : "failed",
          error_message: result.success ? null : result.message,
          result_data: result.data,
          processed_at: new Date().toISOString(),
        })
        .eq("id", incomingMessage.id);
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing n8n response:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ============================================================================
// Action Handlers
// ============================================================================

async function handleSendMessage(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string | undefined,
  conversationId: string | undefined,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const content = data.content as string;
  const channel = data.channel as string | undefined;

  if (!content) {
    return { success: false, message: "Message content is required" };
  }

  // Get or create conversation
  let convId = conversationId;

  if (!convId && contactId && channel) {
    // Find existing conversation or create one
    const { data: existingConv } = await supabase
      .from("crm_conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("channel", channel)
      .limit(1)
      .maybeSingle();

    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error } = await supabase
        .from("crm_conversations")
        .insert({
          organization_id: organizationId,
          contact_id: contactId,
          channel: channel,
          status: "open",
        })
        .select()
        .single();

      if (error) {
        return { success: false, message: `Failed to create conversation: ${error.message}` };
      }
      convId = newConv.id;
    }
  }

  if (!convId) {
    return { success: false, message: "Could not determine conversation" };
  }

  // Get conversation details
  const { data: conversation } = await supabase
    .from("crm_conversations")
    .select("contact_id, channel")
    .eq("id", convId)
    .single();

  if (!conversation) {
    return { success: false, message: "Conversation not found" };
  }

  // Queue the message
  const { data: queueItem, error } = await supabase
    .from("crm_message_queue")
    .insert({
      organization_id: organizationId,
      contact_id: conversation.contact_id,
      conversation_id: convId,
      channel: conversation.channel,
      content: content,
      content_type: "text",
      source_type: "automation",
      priority: (data.priority as number) || 5,
      scheduled_for: data.scheduled_for || new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return { success: false, message: `Failed to queue message: ${error.message}` };
  }

  return {
    success: true,
    message: "Message queued successfully",
    data: { queue_item_id: queueItem.id },
  };
}

async function handleAddTag(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const tagName = data.tag_name as string;
  const tagId = data.tag_id as string;

  if (!tagName && !tagId) {
    return { success: false, message: "tag_name or tag_id is required" };
  }

  let actualTagId = tagId;

  if (!actualTagId && tagName) {
    // Find or create tag
    const { data: existingTag } = await supabase
      .from("crm_tags")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", tagName)
      .maybeSingle();

    if (existingTag) {
      actualTagId = existingTag.id;
    } else {
      const { data: newTag, error } = await supabase
        .from("crm_tags")
        .insert({
          organization_id: organizationId,
          name: tagName,
          color: data.color || "#6366f1",
        })
        .select()
        .single();

      if (error) {
        return { success: false, message: `Failed to create tag: ${error.message}` };
      }
      actualTagId = newTag.id;
    }
  }

  // Add tag to contact
  const { error } = await supabase
    .from("crm_contact_tags")
    .upsert(
      { contact_id: contactId, tag_id: actualTagId, organization_id: organizationId },
      { onConflict: "contact_id,tag_id" }
    );

  if (error) {
    return { success: false, message: `Failed to add tag: ${error.message}` };
  }

  return { success: true, message: "Tag added successfully" };
}

async function handleRemoveTag(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const tagName = data.tag_name as string;
  let tagId = data.tag_id as string;

  if (!tagName && !tagId) {
    return { success: false, message: "tag_name or tag_id is required" };
  }

  if (!tagId && tagName) {
    const { data: existingTag } = await supabase
      .from("crm_tags")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", tagName)
      .maybeSingle();

    if (!existingTag) {
      return { success: false, message: `Tag "${tagName}" not found` };
    }
    tagId = existingTag.id;
  }

  const { error } = await supabase
    .from("crm_contact_tags")
    .delete()
    .eq("contact_id", contactId)
    .eq("tag_id", tagId);

  if (error) {
    return { success: false, message: `Failed to remove tag: ${error.message}` };
  }

  return { success: true, message: "Tag removed successfully" };
}

async function handleChangeStage(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const stageName = data.stage_name as string;
  let stageId = data.stage_id as string;

  if (!stageName && !stageId) {
    return { success: false, message: "stage_name or stage_id is required" };
  }

  if (!stageId && stageName) {
    const { data: existingStage } = await supabase
      .from("crm_pipeline_stages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", stageName)
      .maybeSingle();

    if (!existingStage) {
      return { success: false, message: `Stage "${stageName}" not found` };
    }
    stageId = existingStage.id;
  }

  const { error } = await supabase
    .from("crm_contacts")
    .update({
      stage_id: stageId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (error) {
    return { success: false, message: `Failed to change stage: ${error.message}` };
  }

  return { success: true, message: "Stage changed successfully" };
}

async function handleUpdateScore(
  supabase: SupabaseClient<any>,
  contactId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const scoreDelta = data.score_delta as number;
  const absoluteScore = data.score as number;

  if (scoreDelta === undefined && absoluteScore === undefined) {
    return { success: false, message: "score or score_delta is required" };
  }

  if (absoluteScore !== undefined) {
    const { error } = await supabase
      .from("crm_contacts")
      .update({
        lead_score: absoluteScore,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);

    if (error) {
      return { success: false, message: `Failed to update score: ${error.message}` };
    }
  } else {
    // Use delta
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("lead_score")
      .eq("id", contactId)
      .maybeSingle();

    const newScore = (contact?.lead_score || 0) + scoreDelta;

    const { error } = await supabase
      .from("crm_contacts")
      .update({
        lead_score: newScore,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);

    if (error) {
      return { success: false, message: `Failed to update score: ${error.message}` };
    }
  }

  return { success: true, message: "Score updated successfully" };
}

async function handleAddNote(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const content = data.content as string;

  if (!content) {
    return { success: false, message: "Note content is required" };
  }

  const { error } = await supabase.from("crm_notes").insert({
    organization_id: organizationId,
    contact_id: contactId,
    content: content,
    is_pinned: data.is_pinned || false,
  });

  if (error) {
    return { success: false, message: `Failed to add note: ${error.message}` };
  }

  return { success: true, message: "Note added successfully" };
}

/**
 * Enrolling and un-enrolling both used to talk to `crm_sequence_enrollments`,
 * which has zero rows — it is a second, unused sequence system. The live one is
 * `email_sequence_enrollments` (24k rows), driven by the `enroll-leads` edge
 * function, and it keys on `leads.id`, not `crm_contacts.id`. The bridge between
 * the two is `leads.source_id`, which carries the contact id for rows created
 * with `source = 'crm_contact'`.
 */

/** Resolve a CRM contact to the `leads` rows that mirror it. */
async function leadIdsForContact(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source_id", contactId);

  if (error) throw new Error(error.message);
  return (data || []).map((row: { id: string }) => row.id);
}

/** Confirm a sequence is this organization's before acting on its enrollments. */
async function assertSequenceInOrg(
  supabase: SupabaseClient<any>,
  organizationId: string,
  sequenceId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("email_sequences")
    .select("id")
    .eq("id", sequenceId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sequence not found");
}

async function handleEnrollInSequence(
  organizationId: string,
  contactId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const sequenceId = data.sequence_id as string;

  if (!sequenceId) {
    return { success: false, message: "sequence_id is required" };
  }

  // Forward to `enroll-leads` for exactly the reason /v1/enrollments does: it
  // owns the one-active-sequence-per-lead guard, suppression, the crm_contact →
  // leads mirror and mailbox-pool resolution. Reimplementing any of that here
  // would drift.
  const response = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/enroll-leads`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        sequenceId,
        organizationId,
        contactIds: [contactId],
        delayHours: typeof data.delay_hours === "number" ? data.delay_hours : undefined,
        allowConcurrent: data.allow_concurrent === true,
      }),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      success: false,
      message: `Failed to enroll: ${result?.error ?? `HTTP ${response.status}`}`,
    };
  }

  // enroll-leads reports per-bucket counts and has no `success` key. Enrolling
  // nothing is a real outcome (already enrolled, suppressed, no email) and must
  // not be reported as a win.
  if ((result?.enrolled ?? 0) < 1) {
    return {
      success: false,
      message: "Contact was not enrolled",
      data: result,
    };
  }

  return {
    success: true,
    message: "Enrolled in sequence successfully",
    data: result,
  };
}

/** Statuses a caller may move an enrollment to, mirroring update_enrollment_status. */
const ENROLLMENT_STOP_STATUSES = ["completed", "paused", "unsubscribed"];

async function handleRemoveFromSequence(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string | undefined,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const sequenceId = data.sequence_id as string;
  const enrollmentId = data.enrollment_id as string;

  if (!sequenceId && !enrollmentId) {
    return { success: false, message: "sequence_id or enrollment_id is required" };
  }

  const status = (data.status as string) || "completed";
  if (!ENROLLMENT_STOP_STATUSES.includes(status)) {
    return {
      success: false,
      message: `status must be one of: ${ENROLLMENT_STOP_STATUSES.join(", ")}`,
    };
  }

  let query = supabase
    .from("email_sequence_enrollments")
    .update({ status, next_send_at: null });

  if (enrollmentId) {
    // Scope by the owning sequence: email_sequence_enrollments.organization_id
    // is NULL on the large majority of rows, so it cannot be the tenancy check.
    const { data: enrollment, error } = await supabase
      .from("email_sequence_enrollments")
      .select("id, sequence_id")
      .eq("id", enrollmentId)
      .maybeSingle();

    if (error) return { success: false, message: `Failed to remove: ${error.message}` };
    if (!enrollment) return { success: false, message: "Enrollment not found" };

    await assertSequenceInOrg(supabase, organizationId, enrollment.sequence_id);
    query = query.eq("id", enrollmentId);
  } else {
    if (!contactId) {
      return { success: false, message: "A contact could not be resolved from the payload" };
    }

    await assertSequenceInOrg(supabase, organizationId, sequenceId);

    const leadIds = await leadIdsForContact(supabase, organizationId, contactId);
    if (leadIds.length === 0) {
      return { success: false, message: "Contact has no lead record in this sequence" };
    }

    query = query.eq("sequence_id", sequenceId).in("lead_id", leadIds).eq("status", "active");
  }

  const { data: updated, error } = await query.select("id");

  if (error) {
    return { success: false, message: `Failed to remove: ${error.message}` };
  }

  const count = (updated || []).length;
  if (count === 0) {
    return { success: false, message: "No active enrollment matched" };
  }

  return {
    success: true,
    message: `Removed from sequence (${count} enrollment${count === 1 ? "" : "s"} set to ${status})`,
    data: { updated: count, status },
  };
}

async function handleSetAiHandling(
  supabase: SupabaseClient<any>,
  conversationId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const aiHandling = data.ai_handling as boolean;

  if (aiHandling === undefined) {
    return { success: false, message: "ai_handling is required" };
  }

  // The column is `ai_enabled`. This used to write `ai_handling`, which does not
  // exist on crm_conversations — every call reported success and changed nothing.
  const { error } = await supabase
    .from("crm_conversations")
    .update({
      ai_enabled: aiHandling,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (error) {
    return { success: false, message: `Failed to update: ${error.message}` };
  }

  return { success: true, message: `AI handling ${aiHandling ? "enabled" : "disabled"}` };
}

async function handleAssignToUser(
  supabase: SupabaseClient<any>,
  conversationId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  const userId = data.user_id as string | null;

  // `assigned_to_user_id` is the real column — `assigned_to_id` does not exist,
  // so this action silently no-opped. `assigned_to_type` is genuine.
  const { error } = await supabase
    .from("crm_conversations")
    .update({
      assigned_to_user_id: userId,
      assigned_to_type: userId ? "user" : "unassigned",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (error) {
    return { success: false, message: `Failed to assign: ${error.message}` };
  }

  return {
    success: true,
    message: userId ? "Assigned to user" : "Unassigned",
  };
}
