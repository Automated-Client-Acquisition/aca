/**
 * Reference image resolver for OpenRouter image generation.
 *
 * Reference images (brand logos, product/character shots, prior slides) are
 * often hosted on flaky third-party hosts (e.g. i.postimg.cc). When we pass raw
 * URLs to OpenRouter, the provider (Google AI Studio, OpenAI, etc.) fetches them
 * server-side — and a single 502 from that host fails the ENTIRE generation
 * with an unrecoverable 400. Fetching the bytes ourselves and inlining them as
 * data URLs means the provider never touches the third-party host.
 *
 * We also only accept the formats OpenAI's image endpoint actually decodes
 * (jpeg/png/gif/webp) and verify the downloaded bytes really are that format
 * via magic-byte signature, not just a `Content-Type: image/*` header — an SVG
 * logo or a mislabeled HTML/placeholder response (200 OK, lying content-type)
 * would otherwise sail through and get rejected downstream with
 * "does not represent a valid image". A reference we can't fetch or validate
 * is skipped (degraded, not fatal) rather than killing the job.
 */

const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Sniff the actual image format from magic bytes and confirm it matches one of
 * the four formats OpenAI's image API accepts. Returns the confirmed mime type,
 * or null if the bytes don't match any supported signature.
 */
function sniffSupportedImageMimeType(buf: Uint8Array): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export async function resolveReferenceImagesToDataUrls(urls: string[]): Promise<string[]> {
  const REF_FETCH_TIMEOUT_MS = 15000;
  const resolved: string[] = [];

  for (const url of urls) {
    // Already inline — pass through untouched.
    if (url.startsWith('data:')) {
      resolved.push(url);
      continue;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REF_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        console.warn(`[resolveReferenceImages] Skipping reference image (HTTP ${res.status}): ${url}`);
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (contentType && !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
        console.warn(`[resolveReferenceImages] Skipping unsupported reference format (${contentType}): ${url}`);
        continue;
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      const sniffedType = sniffSupportedImageMimeType(buf);
      if (!sniffedType) {
        console.warn(`[resolveReferenceImages] Skipping reference image (bytes do not match a supported image signature, claimed content-type "${contentType || 'unknown'}"): ${url}`);
        continue;
      }

      // Base64-encode in chunks to avoid call-stack overflow on large images.
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      resolved.push(`data:${sniffedType};base64,${btoa(binary)}`);
    } catch (err) {
      console.warn(`[resolveReferenceImages] Skipping reference image (fetch failed: ${err instanceof Error ? err.message : String(err)}): ${url}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return resolved;
}
