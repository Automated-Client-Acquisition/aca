// ============================================================================
// provisioning-token.ts
// ----------------------------------------------------------------------------
// HMAC-SHA256 signed tokens that gate pre-auth calls during the playbook
// onboarding flow. The orchestrator mints one when it provisions a workspace;
// the wizard then uses it to call key-save and magic-link endpoints before
// the user is logged in.
//
// Format: base64url(payload) + "." + base64url(signature)
//   payload = JSON: { jobId, organizationId, expiresAt }
// ============================================================================

interface ProvisioningTokenPayload {
  jobId: string;
  organizationId: string;
  expiresAt: number; // unix ms
}

function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export async function signProvisioningToken(
  jobId: string,
  organizationId: string,
  options?: { ttlSeconds?: number; secret?: string }
): Promise<string> {
  const secret = options?.secret ?? Deno.env.get("PROVISIONING_TOKEN_SECRET");
  if (!secret) throw new Error("PROVISIONING_TOKEN_SECRET not configured");

  const ttl = options?.ttlSeconds ?? 30 * 60; // 30 minutes
  const payload: ProvisioningTokenPayload = {
    jobId,
    organizationId,
    expiresAt: Date.now() + ttl * 1000,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(new TextEncoder().encode(payloadJson));
  const sig = await hmacSign(secret, payloadB64);
  const sigB64 = toBase64Url(sig);

  return `${payloadB64}.${sigB64}`;
}

export async function verifyProvisioningToken(
  token: string,
  options?: { secret?: string }
): Promise<ProvisioningTokenPayload> {
  const secret = options?.secret ?? Deno.env.get("PROVISIONING_TOKEN_SECRET");
  if (!secret) throw new Error("PROVISIONING_TOKEN_SECRET not configured");

  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Malformed provisioning token");

  const [payloadB64, sigB64] = parts;
  const expectedSig = await hmacSign(secret, payloadB64);
  const actualSig = fromBase64Url(sigB64);

  if (expectedSig.length !== actualSig.length) {
    throw new Error("Invalid provisioning token signature");
  }
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= expectedSig[i] ^ actualSig[i];
  }
  if (mismatch !== 0) throw new Error("Invalid provisioning token signature");

  const payloadJson = new TextDecoder().decode(fromBase64Url(payloadB64));
  const payload = JSON.parse(payloadJson) as ProvisioningTokenPayload;

  if (Date.now() > payload.expiresAt) {
    throw new Error("Provisioning token expired");
  }

  return payload;
}
