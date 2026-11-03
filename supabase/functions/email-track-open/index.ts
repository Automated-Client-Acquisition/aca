/**
 * Email Open Tracking Endpoint
 *
 * Public endpoint (verify_jwt = false) that receives open tracking pixel hits.
 * Updates email_send_log status to 'opened' and returns a 1x1 transparent PNG.
 *
 * URL format: /functions/v1/email-track-open?id={sendLogId}
 * Customer's tracking domain proxies to this Supabase function.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

// 1x1 transparent PNG (68 bytes)
const PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

function pixelResponse(): Response {
  return new Response(PIXEL_PNG, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(PIXEL_PNG.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    });
  }

  try {
    const url = new URL(req.url);
    const sendLogId = url.searchParams.get('id');

    if (!sendLogId) {
      return pixelResponse();
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fire-and-forget: update status, always return pixel immediately
    const { data: sendLog } = await supabase
      .from('email_send_log')
      .select('id, status, opened_at')
      .eq('id', sendLogId)
      .single();

    if (sendLog && !sendLog.opened_at && ['sent', 'delivered'].includes(sendLog.status)) {
      await supabase
        .from('email_send_log')
        .update({
          status: 'opened',
          opened_at: new Date().toISOString(),
        })
        .eq('id', sendLogId);
    }
  } catch (error) {
    console.error('[Email Track Open] Error:', error);
  }

  return pixelResponse();
});
