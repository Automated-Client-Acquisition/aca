/**
 * recover-dropped-replies (service role only)
 *
 * Operator tool: asks the aca-imap-poller worker (POST /recover-replies) to
 * re-fetch m365 mailboxes' mail for the given windows and file the replies
 * that never reached the inbox, without re-running enrollments, classification
 * or the autopilot. Lives here because the worker's shared secret is only in
 * edge secrets.
 *
 * Body: { items: [{ mailbox_id, from, to }] } with ISO times.
 * Added 2026-10-23 after the worker's slow contact lookup dropped replies.
 */

import { isServiceRoleRequest } from '../_shared/org-access.ts';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!isServiceRoleRequest(req)) return json({ error: 'service role only' }, 403);

  const pollerUrl = Deno.env.get('IMAP_POLLER_WEBHOOK_URL');
  const internalSecret = Deno.env.get('INTERNAL_WEBHOOK_SECRET');
  if (!pollerUrl || !internalSecret) return json({ error: 'worker URL or secret not configured' }, 503);

  const body = await req.text();
  const res = await fetch(`${new URL(pollerUrl).origin}/recover-replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
    body,
    signal: AbortSignal.timeout(140_000),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
});
