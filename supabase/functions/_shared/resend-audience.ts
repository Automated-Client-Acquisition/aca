// ============================================================================
// resend-audience.ts
// ----------------------------------------------------------------------------
// Adds a contact to a Resend audience (mailing list). Used by the playbook
// onboarding flow to feed every lead into your email-automation pipeline.
//
// Idempotent: Resend returns 200 even if the contact already exists, so it's
// safe to call from both submit-playbook-lead and provision-playbook-workspace.
//
// Required env vars:
//   RESEND_API_KEY              — your Resend API key
//   RESEND_PLAYBOOK_AUDIENCE_ID — the audience UUID to add contacts to
//
// If either is missing, the function silently no-ops + logs a warning.
// ============================================================================

interface AddContactInput {
  email: string;
  fullName?: string;
  metadata?: Record<string, unknown>; // logged for traceability, not sent to Resend
}

interface AddContactResult {
  added: boolean;
  reason?: string;
  resendContactId?: string;
}

export async function addContactToResendAudience(input: AddContactInput): Promise<AddContactResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const audienceId = Deno.env.get("RESEND_PLAYBOOK_AUDIENCE_ID");

  if (!apiKey) {
    console.log("[resend-audience] RESEND_API_KEY missing, skipping");
    return { added: false, reason: "missing_api_key" };
  }
  if (!audienceId) {
    console.log("[resend-audience] RESEND_PLAYBOOK_AUDIENCE_ID missing, skipping");
    return { added: false, reason: "missing_audience_id" };
  }

  const [firstName, ...rest] = (input.fullName || "").trim().split(/\s+/);
  const lastName = rest.join(" ") || undefined;

  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        first_name: firstName || undefined,
        last_name: lastName,
        unsubscribed: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      // Treat already-exists as success — Resend returns 409 on duplicates
      if (res.status === 409) {
        console.log(`[resend-audience] ${input.email} already in audience`);
        return { added: true, reason: "already_existed" };
      }
      console.error(`[resend-audience] Add failed ${res.status}: ${text}`);
      return { added: false, reason: `http_${res.status}` };
    }

    const data = await res.json().catch(() => ({}));
    return { added: true, resendContactId: data?.id };
  } catch (e) {
    console.error("[resend-audience] Network error:", e);
    return { added: false, reason: "network_error" };
  }
}
