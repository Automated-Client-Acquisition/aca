/**
 * Email Click Tracking Endpoint
 *
 * Public endpoint (verify_jwt = false) that receives click tracking hits.
 * Updates email_send_log status to 'clicked' and redirects to the original URL.
 *
 * URL format: /functions/v1/email-track-click?id={sendLogId}&url={encodedOriginalUrl}
 * Customer's tracking domain proxies to this Supabase function.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function redirectResponse(targetUrl: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      'Location': targetUrl,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const sendLogId = url.searchParams.get('id');
  const targetUrl = url.searchParams.get('url');

  // Decode and validate the target URL
  let decodedUrl: string;
  try {
    decodedUrl = targetUrl ? decodeURIComponent(targetUrl) : '';
  } catch {
    decodedUrl = targetUrl || '';
  }

  // Normalize protocol-less URLs (e.g. "skool.com/..." → "https://skool.com/...")
  if (decodedUrl && !decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
    decodedUrl = `https://${decodedUrl}`;
  }

  // Validate URL is safe to redirect to
  if (!decodedUrl || (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://'))) {
    return new Response('Invalid redirect URL', {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }

  // Every link we generate carries a send-log id. Without one this is an open redirect
  // on the customer's own tracking domain (phishing links that look like the sender).
  const invalidLink = () => new Response('Invalid tracking link', {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
  if (!sendLogId || !/^[0-9a-f-]{36}$/i.test(sendLogId)) {
    return invalidLink();
  }

  try {
    {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const { data: sendLog, error: lookupError } = await supabase
        .from('email_send_log')
        .select('id, status, clicked_at, opened_at')
        .eq('id', sendLogId)
        .maybeSingle();

      if (!lookupError && !sendLog) {
        return invalidLink();
      }

      if (sendLog && !sendLog.clicked_at && ['sent', 'delivered', 'opened'].includes(sendLog.status)) {
        const updates: Record<string, unknown> = {
          status: 'clicked',
          clicked_at: new Date().toISOString(),
        };

        // Implicit open: if they clicked, they opened
        if (!sendLog.opened_at) {
          updates.opened_at = new Date().toISOString();
        }

        await supabase
          .from('email_send_log')
          .update(updates)
          .eq('id', sendLogId);
      }
    }
  } catch (error) {
    console.error('[Email Track Click] Error:', error);
    // Still redirect — never break the user's click
  }

  return redirectResponse(decodedUrl);
});
