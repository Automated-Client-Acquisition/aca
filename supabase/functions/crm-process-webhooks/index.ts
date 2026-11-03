import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient , type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PendingWebhook {
  id: string;
  organization_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  webhook_url: string;
  auth_header_name: string | null;
  auth_header_value: string | null;
  webhook_secret: string | null;
  attempt_count: number;
  max_attempts: number;
}

// Tunables. Steady-state load is tiny (~40 events/hour), so these exist for
// burst drain — a single list build can queue 17k events at once. Raise
// WEBHOOK_CONCURRENCY only as far as the slowest destination tolerates.
const BATCH_SIZE = Number(Deno.env.get("WEBHOOK_BATCH_SIZE") ?? 50);
const CONCURRENCY = Number(Deno.env.get("WEBHOOK_CONCURRENCY") ?? 10);

// Stop claiming new batches at this point and let the next invocation carry on,
// so we return well inside the edge runtime's wall-clock limit.
const DRAIN_BUDGET_MS = 100_000;
const LEASE_SECONDS = 120;

// HMAC-SHA256 signing
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve((req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Answer immediately and drain in the background. Callers here are pg_net
  // (cron and the enqueue kick), whose request timeout defaults to 5s — and
  // the edge runtime tears the worker down when its caller disconnects. Doing
  // the drain inline therefore capped us at ~2 batches before being killed.
  // waitUntil keeps the drain alive after the response is sent.
  const draining = drainQueue();

  // @ts-ignore: EdgeRuntime is injected by the Supabase edge runtime and is
  // absent from the ambient types.
  if (typeof EdgeRuntime !== "undefined") {
    // @ts-ignore: see above.
    EdgeRuntime.waitUntil(draining);
  }

  return new Response(
    JSON.stringify({ message: "Draining webhook queue" }),
    {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});

async function drainQueue(): Promise<void> {
  const startTime = Date.now();
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Put any claims abandoned by a dead dispatcher back on the queue.
    await supabase.rpc("reclaim_stuck_webhook_events");

    // Single-flight. Enqueue kicks the dispatcher on every burst, so without
    // this a bulk insert would start dozens of overlapping drains and hammer
    // the destination. The lease expires on its own if this run dies.
    const { data: gotLease, error: leaseError } = await supabase.rpc(
      "acquire_webhook_dispatcher_lease",
      { p_lease: `${LEASE_SECONDS} seconds` }
    );

    if (leaseError) {
      console.error("Failed to acquire dispatcher lease:", leaseError);
      return;
    }

    if (!gotLease) {
      console.log("Another dispatcher is already draining");
      return;
    }

    let batches = 0;
    let drained = false;

    try {
      // Keep claiming until the queue is empty or we run out of budget. This
      // is what makes a 17k burst drain in minutes rather than 14 hours.
      while (Date.now() - startTime < DRAIN_BUDGET_MS) {
        const { data: pendingWebhooks, error: fetchError } = await supabase.rpc(
          "get_pending_webhook_events",
          { p_limit: BATCH_SIZE }
        );

        if (fetchError) {
          console.error("Failed to fetch pending webhooks:", fetchError);
          break;
        }

        if (!pendingWebhooks || pendingWebhooks.length === 0) {
          drained = true;
          break;
        }

        batches++;
        console.log(`Processing ${pendingWebhooks.length} pending webhooks`);

        // Process each webhook in parallel with concurrency limit
        const chunks: PendingWebhook[][] = [];

        for (let i = 0; i < pendingWebhooks.length; i += CONCURRENCY) {
          chunks.push(pendingWebhooks.slice(i, i + CONCURRENCY));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (webhook: PendingWebhook) => {
              processedCount++;
              const result = await processWebhook(supabase, webhook);
              if (result.success) {
                successCount++;
              } else {
                failedCount++;
              }
            })
          );
        }

        // Rows are claimed, so a lapsed lease would let a second dispatcher
        // start and reclaim them out from under us.
        await supabase.rpc("renew_webhook_dispatcher_lease", {
          p_lease: `${LEASE_SECONDS} seconds`,
        });
      }
    } finally {
      await supabase.rpc("release_webhook_dispatcher_lease");
    }

    // Ran out of budget with work left: hand off immediately rather than
    // waiting up to a minute for the next cron tick.
    if (!drained) {
      await supabase.rpc("kick_webhook_dispatcher");
    }

    console.log(
      `[webhook-dispatcher] ${JSON.stringify({
        processed: processedCount,
        success: successCount,
        failed: failedCount,
        batches,
        drained,
        duration_ms: Date.now() - startTime,
      })}`
    );
  } catch (error) {
    // The response has already gone out, so there is nothing to signal to the
    // caller. Cron re-runs us every minute and the lease self-expires.
    console.error("Error processing webhooks:", error);
  }
}

async function processWebhook(
  supabase: SupabaseClient<any>,
  webhook: PendingWebhook
): Promise<{ success: boolean; error?: string }> {
  try {
    // Build the payload
    const payload = {
      event: webhook.event_type,
      timestamp: new Date().toISOString(),
      data: webhook.event_data,
      webhook_id: webhook.id,
      organization_id: webhook.organization_id,
    };

    const payloadString = JSON.stringify(payload);

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ACA-Webhook/1.0",
      "X-Webhook-Event": webhook.event_type,
      "X-Webhook-ID": webhook.id,
    };

    // Add auth header if configured
    if (webhook.auth_header_name && webhook.auth_header_value) {
      headers[webhook.auth_header_name] = webhook.auth_header_value;
    }

    // Add signature if secret is configured
    if (webhook.webhook_secret) {
      const signature = await signPayload(payloadString, webhook.webhook_secret);
      headers["X-Webhook-Signature"] = `sha256=${signature}`;
    }

    // Send the webhook
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    let response: Response;
    try {
      response = await fetch(webhook.webhook_url, {
        method: "POST",
        headers,
        body: payloadString,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Get response body (for logging)
    let responseBody = "";
    try {
      responseBody = await response.text();
      // Truncate if too long
      if (responseBody.length > 1000) {
        responseBody = responseBody.substring(0, 1000) + "... (truncated)";
      }
    } catch {
      responseBody = "(unable to read response body)";
    }

    const success = response.ok;

    // Update the webhook status
    await supabase.rpc("mark_webhook_sent", {
      p_event_id: webhook.id,
      p_success: success,
      p_response_status: response.status,
      p_response_body: responseBody,
      p_error_message: success ? null : `HTTP ${response.status}: ${response.statusText}`,
    });

    if (success) {
      console.log(`Webhook ${webhook.id} sent successfully to ${webhook.webhook_url}`);
    } else {
      console.warn(
        `Webhook ${webhook.id} failed: ${response.status} ${response.statusText}`
      );
    }

    return { success };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error(`Webhook ${webhook.id} error:`, errorMessage);

    // Update the webhook status as failed
    await supabase.rpc("mark_webhook_sent", {
      p_event_id: webhook.id,
      p_success: false,
      p_response_status: null,
      p_response_body: null,
      p_error_message: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}
