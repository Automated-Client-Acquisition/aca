/**
 * ACA Tracking Proxy — Vercel Edge Function
 *
 * Reverse proxy that forwards email tracking requests to Supabase edge functions.
 * Customers CNAME their tracking subdomain (e.g. track.theirdomain.com) to
 * t.automatedclientacquisition.com. Vercel handles SSL automatically.
 *
 * Supported paths:
 *   /u/{id}                           → unsubscribe (short link printed in emails)
 *   /functions/v1/email-track-click   → click tracking + redirect
 *   /functions/v1/email-track-open    → open tracking pixel
 *   /functions/v1/email-unsubscribe   → unsubscribe page (legacy/direct form)
 */

export const config = { runtime: 'edge' };

// This install's Supabase project. Set SUPABASE_URL on the tracking-proxy Vercel
// project (ACA Cloud's is the production project URL).
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

const ALLOWED_PATHS = [
  '/functions/v1/email-track-click',
  '/functions/v1/email-track-open',
  '/functions/v1/email-unsubscribe',
];

// Short unsubscribe link: /u/{id} → email-unsubscribe. Keeps the URL a recipient
// sees down to host + 2 chars + id, instead of an infra-looking /functions/v1/ path.
const SHORT_UNSUBSCRIBE_RE = /^\/u\/([A-Za-z0-9._~-]+)\/?$/;

const UNSUBSCRIBE_UPSTREAM_PATH = '/functions/v1/email-unsubscribe';

// The confirmation page has only inline styles and a form that posts back to itself.
const UNSUBSCRIBE_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** Map an inbound public path to its upstream Supabase path + query. */
function resolveUpstreamPath(url: URL): string | null {
  const short = url.pathname.match(SHORT_UNSUBSCRIBE_RE);
  if (short) {
    return `${UNSUBSCRIBE_UPSTREAM_PATH}?token=${encodeURIComponent(short[1])}`;
  }

  if (ALLOWED_PATHS.some((p) => url.pathname.startsWith(p))) {
    return `${url.pathname}${url.search}`;
  }

  return null;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);

  const upstreamPath = resolveUpstreamPath(url);
  if (!upstreamPath) {
    return new Response('Not Found', { status: 404 });
  }

  if (!SUPABASE_URL) {
    console.error('[tracking-proxy] SUPABASE_URL is not set; cannot forward', url.pathname);
    return new Response('Tracking proxy is not configured', { status: 500 });
  }

  const upstreamUrl = `${SUPABASE_URL}${upstreamPath}`;

  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    // Buffer the body: the edge runtime rejects streamed request bodies without
    // duplex, and unsubscribe POSTs (confirm form, RFC 8058 one-click) are tiny.
    const body = hasBody ? await request.text() : null;

    const upstreamHeaders: Record<string, string> = { 'X-Forwarded-Host': url.host };
    // Content-Type must survive — it's how the function tells a form POST from
    // a one-click POST, and dropping it turned the body into an unparseable blob.
    const contentType = request.headers.get('content-type');
    if (contentType) upstreamHeaders['Content-Type'] = contentType;
    const accept = request.headers.get('accept');
    if (accept) upstreamHeaders['Accept'] = accept;

    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      redirect: 'manual', // Don't follow redirects — pass them through to the client
    });

    // Pass the response through as-is (preserves 302 redirects, pixel responses, HTML pages)
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    // Supabase's gateway rewrites GET text/html from *.supabase.co to text/plain
    // with a `sandbox` CSP (anti-phishing), so the unsubscribe confirmation page
    // arrived as raw source with a dead button. This host is ours: restore the
    // type the function set, with a CSP that still allows the form post.
    if (request.method === 'GET' && upstreamPath.startsWith(UNSUBSCRIBE_UPSTREAM_PATH)) {
      responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
      responseHeaders.set('Content-Security-Policy', UNSUBSCRIBE_PAGE_CSP);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Upstream request failed:', error);
    return new Response('Bad Gateway', { status: 502 });
  }
}
