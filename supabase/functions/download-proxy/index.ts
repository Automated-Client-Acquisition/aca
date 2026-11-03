import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Called from plain <a href> downloads, so it cannot require a JWT. It is therefore an
// unauthenticated fetcher and must not become an open SSRF proxy: https only, public
// hosts only (re-checked on every redirect), and only media bodies are relayed back.
const MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPE = /^(image|video|audio)\/|^application\/(octet-stream|pdf|zip)\b/i;

function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error('Invalid url');
  }
  if (target.protocol !== 'https:') throw new Error('Only https URLs are allowed');
  if (target.port && target.port !== '443') throw new Error('Non-standard ports are not allowed');

  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('Host not allowed');
  }
  if (/^[\d.]+$/.test(host) || host.includes(':')) throw new Error('IP address hosts are not allowed');

  const addrs: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      addrs.push(...await Deno.resolveDns(host, type));
    } catch {
      // No record of this type.
    }
  }
  if (addrs.length === 0) throw new Error('Host did not resolve');
  if (addrs.some(isPrivateIp)) throw new Error('Host not allowed');
  return target;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const fileUrl = url.searchParams.get('url');
    const filename = (url.searchParams.get('filename') || 'download')
      .replace(/[^\w.\- ]/g, '_')
      .slice(0, 150) || 'download';

    if (!fileUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing url parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let response: Response | null = null;
    let next = fileUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let target: URL;
      try {
        target = await assertPublicHttpsUrl(next);
      } catch (e) {
        return new Response(
          JSON.stringify({ error: e instanceof Error ? e.message : 'URL not allowed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      response = await fetch(target, { redirect: 'manual' });
      const location = response.headers.get('Location');
      if (response.status >= 300 && response.status < 400 && location) {
        next = new URL(location, target).toString();
        response = null;
        continue;
      }
      break;
    }

    if (!response) {
      return new Response(
        JSON.stringify({ error: 'Too many redirects' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      console.error(`❌ Failed to fetch file: ${response.status} ${response.statusText}`);
      return new Response(
        JSON.stringify({ error: `Failed to fetch file: ${response.statusText}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the content type from the response or infer from filename
    let contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    // Infer content type from filename extension if not provided
    const ext = filename.split('.').pop()?.toLowerCase();
    if (contentType === 'application/octet-stream' && ext) {
      const mimeTypes: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
        'gif': 'image/gif',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
      };
      contentType = mimeTypes[ext] || contentType;
    }

    if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
      await response.body?.cancel();
      return new Response(
        JSON.stringify({ error: 'Only media files can be downloaded' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await response.arrayBuffer();

    console.log(`✅ Serving file: ${filename} (${body.byteLength} bytes, ${contentType})`);

    return new Response(body, {
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': body.byteLength.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('❌ Download proxy error:', error);
    return new Response(
      JSON.stringify({ error: 'Download failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
