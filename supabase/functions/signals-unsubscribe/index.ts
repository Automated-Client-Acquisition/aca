// ============================================================================
// signals-unsubscribe
// ----------------------------------------------------------------------------
// Public (verify_jwt = false). Flips a signals_subscribers row to
// 'unsubscribed' by its per-row token.
//   GET  ?token=...  → unsubscribe + friendly HTML confirmation page
//   POST ?token=...  → RFC 8058 one-click (email clients), returns 200
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const SITE_URL = PUBLIC_SITE_URL;

async function unsubscribe(token: string): Promise<boolean> {
  if (!token) return false;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase
    .from("signals_subscribers")
    .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .select("id");
  if (error) {
    console.error("[signals-unsubscribe] update failed:", error);
    return false;
  }
  return (data?.length || 0) > 0;
}

function page(ok: boolean): Response {
  const title = ok ? "You're unsubscribed" : "Link not recognized";
  const body = ok
    ? "You won't receive the daily buying-signals email anymore. Changed your mind? You can resubscribe anytime."
    : "We couldn't find that subscription. It may have already been removed.";
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title></head>
<body style="margin:0;background:#F2EEE6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:14vh auto;padding:36px 32px;background:#fff;border:1px solid #C9C2AE;border-radius:14px;text-align:center;">
    <div style="font:600 12px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.12em;text-transform:uppercase;color:#15140F;margin-bottom:18px;">ACA <span style="color:#D4361A;">·</span> Buying Signals</div>
    <h1 style="font:600 26px/1.2 Georgia,serif;color:#15140F;margin:0 0 10px;">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#6B6759;margin:0 0 22px;">${body}</p>
    <a href="${SITE_URL}/signals" style="display:inline-block;background:#D4361A;color:#fff;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;text-decoration:none;">Back to signals →</a>
  </div>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (req.method === "POST") {
    // One-click unsubscribe from the mail client — body/headers handled, 200 expected.
    const ok = await unsubscribe(token);
    return new Response(JSON.stringify({ unsubscribed: ok }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ok = await unsubscribe(token);
  return page(ok);
});
