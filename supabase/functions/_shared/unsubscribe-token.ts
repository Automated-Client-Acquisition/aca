/**
 * Unsubscribe Token Module (Deno)
 *
 * Generates and verifies HMAC-signed tokens for email unsubscribe links.
 * Uses SMTP_ENCRYPTION_KEY as the HMAC secret.
 */

export interface UnsubscribePayload {
  sid: string; // sendLogId
  eid: string; // enrollmentId
  lid: string; // leadId
  oid: string; // orgId
}

const HMAC_ALGO = { name: 'HMAC', hash: 'SHA-256' };

async function getHmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('SMTP_ENCRYPTION_KEY');
  if (!secret) throw new Error('SMTP_ENCRYPTION_KEY not set');
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), HMAC_ALGO, false, ['sign', 'verify']);
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Uint8Array<ArrayBuffer>, not bare Uint8Array: the latter widens to
// ArrayBufferLike, which is not a valid BufferSource for crypto.subtle.
function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Generate a signed unsubscribe token.
 * Format: base64url(payload).base64url(hmac)
 */
export async function generateUnsubscribeToken(
  sendLogId: string,
  enrollmentId: string,
  leadId: string,
  orgId: string
): Promise<string> {
  const payload: UnsubscribePayload = { sid: sendLogId, eid: enrollmentId, lid: leadId, oid: orgId };
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(JSON.stringify(payload));
  const payloadB64 = toBase64Url(payloadBytes.buffer);

  const key = await getHmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
  const sigB64 = toBase64Url(sig);

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify and decode an unsubscribe token.
 * Returns the payload if valid, null otherwise.
 */
export async function verifyUnsubscribeToken(token: string): Promise<UnsubscribePayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  try {
    const payloadBytes = fromBase64Url(payloadB64);
    const sigBytes = fromBase64Url(sigB64);
    const key = await getHmacKey();

    // Pass the views, not .buffer: ArrayBufferLike isn't a valid BufferSource,
    // and a view's buffer can be longer than the view itself.
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as UnsubscribePayload;
    if (!payload.sid || !payload.eid || !payload.lid || !payload.oid) return null;

    return payload;
  } catch {
    return null;
  }
}
