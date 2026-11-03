import { APP_URL } from "../site-config.ts";
/**
 * Where the hosted-auth popup ends up: the app's /connect/complete page.
 *
 * Supabase serves HTML from *.supabase.co/functions as text/plain, so a page returned by an edge
 * function shows its source instead of rendering. The callbacks redirect to the app instead,
 * which shows the result, tells the Senders page that opened the popup, and closes itself.
 */

const DEFAULT_APP_URL = APP_URL;

/** The origin of `appUrl` when it is a usable app address (https, or localhost in dev). */
function appOrigin(appUrl: string | null | undefined): string {
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;
    } catch {
      // not a URL: fall back to the default
    }
  }
  return DEFAULT_APP_URL;
}

export function connectCompleteUrl(
  appUrl: string | null | undefined,
  result: { ok: boolean; provider?: string | null; message?: string | null },
): string {
  const url = new URL('/connect/complete', appOrigin(appUrl));
  url.searchParams.set('status', result.ok ? 'success' : 'error');
  if (result.provider) url.searchParams.set('provider', result.provider.toLowerCase());
  if (!result.ok && result.message) url.searchParams.set('message', result.message);
  return url.toString();
}

export function redirectToConnectComplete(
  appUrl: string | null | undefined,
  result: { ok: boolean; provider?: string | null; message?: string | null },
): Response {
  return new Response(null, { status: 302, headers: { Location: connectCompleteUrl(appUrl, result) } });
}
