/**
 * PostShiba webhook signatures, shared by postshiba-inbound (catch-all inbox)
 * and postshiba-events (delivery events):
 *   X-Capsule-Timestamp: unix seconds
 *   X-Capsule-Signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${rawBody}`>
 */

const SIGNATURE_MAX_AGE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** Constant-time check of a PostShiba signature, rejecting timestamps older than 5 minutes. */
export async function verifyCapsuleSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!timestamp || !signature?.startsWith('sha256=')) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_MAX_AGE_SECONDS) return false;
  const received = hexToBytes(signature.slice(7));
  if (!received) return false;
  const expected = await hmac(secret, `${timestamp}.${rawBody}`);
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ received[i];
  return diff === 0;
}

/** Headers for re-sending a body as if PostShiba had signed it (replays). */
export async function capsuleSignatureHeaders(rawBody: string, secret: string): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const mac = await hmac(secret, `${timestamp}.${rawBody}`);
  return {
    'X-Capsule-Timestamp': timestamp,
    'X-Capsule-Signature': 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
