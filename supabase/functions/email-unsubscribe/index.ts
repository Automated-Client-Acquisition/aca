/**
 * Email Unsubscribe Endpoint
 *
 * Public endpoint (verify_jwt = false), reachable two ways:
 *   /u/{id}                             — short link in the email (via tracking proxy)
 *   /functions/v1/email-unsubscribe?token={token}  — legacy/direct
 *
 * The link id is the email_send_log UUID (random v4 — 122 bits, unguessable), which
 * resolves to org + lead server-side. Legacy HMAC tokens from mail already in flight
 * are still accepted.
 *
 * Method semantics follow what Smartlead/Instantly do, and they matter:
 *   - GET  → renders a confirmation page. NOTHING is mutated. Corporate link
 *            scanners (Outlook Safe Links, Proofpoint) prefetch every URL in an
 *            email; a GET that unsubscribed on sight silently opted people out
 *            of sequences they never chose to leave.
 *   - POST → performs the unsubscribe. Covers both the confirmation button and
 *            RFC 8058 one-click from the List-Unsubscribe header.
 *
 * On unsubscribe:
 *   1. Marks the specific enrollment as 'unsubscribed' (when known)
 *   2. Marks ALL other active enrollments for that lead/org as 'unsubscribed'
 *   3. Marks the CRM contact as 'unsubscribed' (prevents future sequences)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { verifyUnsubscribeToken, type UnsubscribePayload } from '../_shared/unsubscribe-token.ts';
import { applyUnsubscribe } from '../_shared/unsubscribe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// The confirmation and result pages are rendered in place, on whatever host the
// recipient landed on (their sender's tracking domain). No redirect to the ACA app:
// bouncing a cold-email recipient onto a SaaS domain they've never heard of is
// exactly the jarring hop Smartlead/Instantly avoid, and it breaks white-labeling.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract the link id/token from either shape:
 *   /u/{id}  ·  /functions/v1/email-unsubscribe/{id}  ·  ?token={token}
 */
function extractToken(url: URL): string | null {
  const qs = url.searchParams.get('token');
  if (qs) return qs;

  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last === 'u' || last === 'email-unsubscribe') return null;
  return decodeURIComponent(last);
}

/**
 * Resolve a link id/token to the identities we need to suppress.
 * Short id → email_send_log lookup. Otherwise → legacy signed token.
 */
async function resolvePayload(token: string): Promise<UnsubscribePayload | null> {
  if (UUID_RE.test(token)) {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: sendLog } = await supabase
      .from('email_send_log')
      .select('id, organization_id, lead_id')
      .eq('id', token)
      .maybeSingle();

    if (!sendLog?.lead_id || !sendLog?.organization_id) return null;

    // No enrollment id on the send log — step 2 of processUnsubscribe suppresses
    // every active enrollment for this lead/org anyway, which is the superset.
    return { sid: sendLog.id, eid: '', lid: sendLog.lead_id, oid: sendLog.organization_id };
  }

  return await verifyUnsubscribeToken(token);
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
         background:#f6f7f9; color:#16181d; padding:24px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:36px 32px;
          max-width:440px; width:100%; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size:19px; margin:0 0 10px; font-weight:600; }
  p { font-size:14px; line-height:1.55; color:#5b6070; margin:0 0 22px; }
  button { background:#16181d; color:#fff; border:0; border-radius:9px; padding:12px 22px;
           font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#33373f; }
  .note { font-size:12px; color:#9aa0ab; margin:18px 0 0; }
  @media (prefers-color-scheme: dark) {
    body { background:#0e1013; color:#f2f3f5; }
    .card { background:#16181d; border-color:#2a2e37; box-shadow:none; }
    p { color:#a9aeb9; }
    button { background:#f2f3f5; color:#16181d; }
    button:hover { background:#d8dade; }
  }
</style></head><body><div class="card">${inner}</div></body></html>`;
}

/**
 * GET landing: confirm before mutating, so link scanners can't opt people out.
 * The form posts back to the current URL (empty action) so it works on the short
 * /u/{id} path, the direct function path, and the legacy ?token= form alike.
 */
function confirmPage(): string {
  return pageShell(
    'Unsubscribe',
    `<h1>Unsubscribe from these emails?</h1>
     <p>You won't receive any further emails from this sender.</p>
     <form method="POST" action="">
       <button type="submit">Yes, unsubscribe me</button>
     </form>
     <p class="note">You can close this page if you'd rather keep receiving them.</p>`
  );
}

function resultPage(ok: boolean): string {
  return ok
    ? pageShell(
        'Unsubscribed',
        `<h1>You're unsubscribed</h1><p>You won't receive any further emails from this sender. Sorry for the interruption.</p>`
      )
    : pageShell(
        'Unsubscribe',
        `<h1>This link is no longer valid</h1><p>We couldn't process this request. Reply to the email with "unsubscribe" and you'll be removed.</p>`
      );
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function processUnsubscribe(payload: UnsubscribePayload): Promise<void> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Short-link payloads carry no enrollment id; the org-wide step covers them.
  await applyUnsubscribe(supabase, {
    organizationId: payload.oid,
    leadId: payload.lid,
    enrollmentId: payload.eid,
    sendLogId: payload.sid,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = extractToken(url);
  const isPost = req.method === 'POST';

  if (!token) {
    return isPost
      ? new Response('Invalid token', { status: 400, headers: corsHeaders })
      : htmlResponse(resultPage(false), 400);
  }

  // GET never mutates — corporate link scanners prefetch these URLs. Render the
  // confirmation page without even resolving the token (an invalid one simply
  // fails on submit, and not resolving means no DB hit per scanner prefetch).
  if (!isPost) {
    return htmlResponse(confirmPage());
  }

  // Distinguish the confirmation form (browser, wants HTML) from RFC 8058
  // one-click (mail client, wants a bare 200).
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html');

  const payload = await resolvePayload(token);
  if (!payload) {
    return wantsHtml
      ? htmlResponse(resultPage(false), 400)
      : new Response('Invalid token', { status: 400, headers: corsHeaders });
  }

  try {
    await processUnsubscribe(payload);
    return wantsHtml
      ? htmlResponse(resultPage(true))
      : new Response('OK', { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error('[Email Unsubscribe] Error:', error);
    return wantsHtml
      ? htmlResponse(resultPage(false), 500)
      : new Response('Error', { status: 500, headers: corsHeaders });
  }
});
