/**
 * Registrar API Proxy — Vercel Edge Function
 *
 * Proxies requests to registrar APIs through Vercel.
 * Currently only Porkbun is supported (kept for potential future use).
 *
 * Security: requires a shared secret in the X-Proxy-Key header.
 */

export const config = { runtime: 'edge' };

const ALLOWED_HOSTS: Record<string, string> = {
  porkbun: 'https://api.porkbun.com',
};

export default async function handler(request: Request) {
  // Verify shared secret
  const PROXY_SECRET = process.env.REGISTRAR_PROXY_SECRET || '';
  const proxyKey = request.headers.get('X-Proxy-Key');
  if (!PROXY_SECRET || proxyKey !== PROXY_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Parse the target from query params
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');
  const path = url.searchParams.get('path');

  if (!provider || !path) {
    return new Response('Missing provider or path', { status: 400 });
  }

  const baseUrl = ALLOWED_HOSTS[provider];
  if (!baseUrl) {
    return new Response(`Unsupported provider: ${provider}`, { status: 400 });
  }

  const upstreamUrl = `${baseUrl}${path}`;

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (request.method === 'POST') {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(upstreamUrl, fetchOptions);
    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error('Registrar proxy error:', error);
    return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
