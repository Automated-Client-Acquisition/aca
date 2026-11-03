/**
 * Shared Encryption Module
 *
 * AES-256-GCM encryption/decryption for sensitive credentials.
 * Used by smtp-client.ts, azure-sdk.ts, and infrastructure edge functions.
 */

/**
 * Get the encryption key from the environment.
 * Expects SMTP_ENCRYPTION_KEY as a 64-character hex string (32 bytes).
 */
// Uint8Array<ArrayBuffer>, not bare Uint8Array: the latter widens to
// ArrayBufferLike (possibly SharedArrayBuffer), which is not a valid
// BufferSource for crypto.subtle.importKey.
export function getEncryptionKey(): Uint8Array<ArrayBuffer> {
  const keyHex = Deno.env.get('SMTP_ENCRYPTION_KEY');
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('SMTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(keyHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt a string value using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext.
 */
export async function encryptValue(plaintext: string): Promise<string> {
  const key = getEncryptionKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoder.encode(plaintext)
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded AES-256-GCM encrypted string.
 */
export async function decryptValue(encrypted: string): Promise<string> {
  const key = getEncryptionKey();
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Encrypt a JSON object. Convenience wrapper around encryptValue.
 */
export async function encryptJSON<T>(data: T): Promise<string> {
  return encryptValue(JSON.stringify(data));
}

/**
 * Decrypt a JSON object. Convenience wrapper around decryptValue.
 */
export async function decryptJSON<T>(encrypted: string): Promise<T> {
  const plaintext = await decryptValue(encrypted);
  return JSON.parse(plaintext);
}
